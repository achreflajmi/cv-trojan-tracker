import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type pg from 'pg';
import {
  createRun,
  findOpenRun,
  insertTrial,
  loadPlanRows,
  monthCommittedEur,
  pendingTrials,
  recoverOrphanedClaims,
  runScores,
  setRunStatus,
  trialRequestData,
  upsertExperiment,
  upsertModel,
} from '@ctt/db';
import {
  fillTemplate,
  ScoreOutput,
  scoreJsonSchema,
  sha256,
  trialKey,
  type ModelAdapter,
  type ModelEntry,
  type PricesConfig,
  type Prompt,
} from '@ctt/shared';
import { executeTrial, type Outcome } from './execute.ts';
import type { BudgetConfig, Experiment } from './experiment.ts';
import { buildPlan, type Plan } from './plan.ts';
import { cellIntervals, cellState, inputsToContinue, type CellState } from './stopping.ts';

export interface RunOptions {
  db: pg.Pool;
  redisUrl: string;
  experiment: Experiment;
  model: ModelEntry;
  prompt: Prompt;
  prices: PricesConfig;
  budget: BudgetConfig;
  /** EUR the owner confirmed; must cover the plan's upper bound (SPEC 4.5). */
  confirmBudgetEur: number;
  adapter: ModelAdapter;
  concurrency: number;
  /** Queue name; tests use a unique one. */
  queueName?: string;
  /** git commit of prereg.yaml, recorded on the experiment (SPEC 3.8). */
  preregCommit?: string | null;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface RunResult {
  runId: number;
  status: 'completed' | 'stopped_budget' | 'failed';
  repeats: number;
  cells: Map<string, { state: CellState; n: number; mean: number; halfWidth: number }>;
}

/**
 * Settings fingerprint in the trial key: the same model ID with different settings
 * (e.g. another reasoning level) is a different measurement and must not be skipped.
 */
export function modelFingerprint(m: ModelEntry): string {
  const settings = {
    max_tokens: m.max_tokens,
    temperature: m.temperature ?? null,
    settings: m.settings,
  };
  return `${m.provider}:${m.model_id}#${sha256(JSON.stringify(settings)).slice(0, 12)}`;
}

/** Effective cap = min(confirmed, per-run cap, what is left of the monthly cap). SPEC 4.5, #13. */
export async function effectiveCapEur(
  o: Pick<RunOptions, 'db' | 'budget' | 'confirmBudgetEur' | 'now'>,
) {
  const monthLeft =
    o.budget.monthly_cap_eur - (await monthCommittedEur(o.db, (o.now ?? (() => new Date()))()));
  return Math.min(o.confirmBudgetEur, o.budget.per_run_cap_eur, monthLeft);
}

export async function planFor(
  o: Pick<RunOptions, 'db' | 'experiment' | 'model' | 'prompt' | 'prices'>,
): Promise<Plan> {
  const rows = await loadPlanRows(o.db, {
    jobs: o.experiment.jobs,
    fitBands: o.experiment.fit_bands,
    extractors: o.experiment.extractors,
  });
  if (rows.length === 0)
    throw new Error('No extractions match this experiment. Run `ctt ingest` first.');
  return buildPlan(rows, o.experiment, o.model, o.prompt, o.prices);
}

export async function runExperiment(o: RunOptions): Promise<RunResult> {
  const log = o.log ?? (() => {});
  const plan = await planFor(o);
  if (o.confirmBudgetEur < plan.upperBoundEur) {
    throw new Error(
      `Refusing to run: --confirm-budget ${o.confirmBudgetEur} is below the upper bound EUR ${plan.upperBoundEur.toFixed(4)} (see ctt plan).`,
    );
  }
  const cap = await effectiveCapEur(o);
  if (cap <= 0) throw new Error('No budget left this month (config/budget.yaml monthly_cap_eur).');
  if (cap < plan.upperBoundEur)
    log(
      `Note: effective cap EUR ${cap.toFixed(4)} is below the upper bound; the run may stop at the cap.`,
    );

  const experimentId = await upsertExperiment(o.db, {
    name: o.experiment.name,
    promptVersion: o.experiment.prompt_version,
    preregCommit: o.preregCommit ?? null,
  });
  const modelId = await upsertModel(o.db, {
    provider: o.model.provider,
    modelId: o.model.model_id,
    settings: {
      max_tokens: o.model.max_tokens,
      temperature: o.model.temperature ?? null,
      settings: o.model.settings,
    },
  });
  const resumed = await findOpenRun(o.db, experimentId, modelId);
  const runId = resumed ?? (await createRun(o.db, { experimentId, modelId, budgetEur: cap }));
  log(
    `${resumed ? 'Resuming' : 'Starting'} run ${runId}: ${plan.inputs.length} distinct inputs, ${plan.cells.length} cells, cap EUR ${cap.toFixed(4)}`,
  );

  // No worker is alive yet, so claims left by a dead process can be released safely.
  const recovered = await recoverOrphanedClaims(o.db, runId);
  if (recovered > 0) log(`Recovered ${recovered} orphaned claim(s), counted as possibly paid.`);
  await setRunStatus(o.db, runId, 'running');

  const queueName = o.queueName ?? 'ctt-calls';
  const connection = new Redis(o.redisUrl, { maxRetriesPerRequest: null }); // BullMQ workers require null
  const queue = new Queue(queueName, { connection });
  const fingerprint = modelFingerprint(o.model);
  let overBudget = false;
  // Circuit breaker: if most calls of a batch fail (provider down, bad key, crash),
  // stop instead of planning more failing calls. A later `ctt run` resumes the run.
  const batch = { completed: 0, failed: 0 };
  let tripped = false;
  const checkBreaker = (): void => {
    if (batch.failed > 0 && batch.failed > batch.completed) tripped = true;
    batch.completed = 0;
    batch.failed = 0;
  };

  // The worker only decides WHO calls next; the database claim protocol (Stage 3)
  // decides WHETHER a call may happen, so a duplicated job can never pay twice.
  const worker = new Worker<{ runId: number; trialId: number }, Outcome>(
    queueName,
    async (job) => {
      if (job.data.runId !== runId) return 'skipped';
      const data = await trialRequestData(o.db, job.data.trialId);
      const outcome = await executeTrial(
        {
          db: o.db,
          runId,
          adapter: o.adapter,
          prices: o.prices,
          buildRequest: async () => ({
            modelId: o.model.model_id,
            system: o.prompt.system,
            user: fillTemplate(o.prompt.userTemplate, {
              job: data.jobText.trim(),
              cv: data.cvText,
            }),
            jsonSchema: scoreJsonSchema,
            outputSchema: ScoreOutput,
            maxTokens: o.model.max_tokens,
            ...(o.model.temperature === undefined ? {} : { temperature: o.model.temperature }),
            settings: o.model.settings,
            idempotencyKey: data.idempotencyKey,
          }),
        },
        { id: data.trialId, idempotencyKey: data.idempotencyKey },
      );
      if (outcome === 'over-budget') overBudget = true;
      if (outcome === 'completed') batch.completed++;
      if (outcome === 'failed') batch.failed++;
      return outcome;
    },
    // Failed jobs are not retried by BullMQ: retries belong to the adapter policy (429/5xx only).
    {
      connection,
      concurrency: o.concurrency,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  );

  const enqueuePending = async (): Promise<number> => {
    const pending = await pendingTrials(o.db, runId);
    await queue.addBulk(
      pending.map((t) => ({
        name: 'call',
        data: { runId, trialId: t.id },
        // jobId dedupes the queue; attempts: 1 because BullMQ must not retry a paid call.
        opts: { jobId: `run-${runId}-trial-${t.id}`, attempts: 1 },
      })),
    );
    return pending.length;
  };

  const drained = async (): Promise<void> => {
    for (;;) {
      const c = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      if ((c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) + (c.prioritized ?? 0) === 0)
        return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const states = new Map<string, CellState>(plan.cells.map((c) => [c, 'sampling']));
  const intervals = new Map<string, { n: number; mean: number; halfWidth: number }>();
  let repeat = 0;
  try {
    // A resumed run first finishes trials that were planned but never completed.
    if (resumed) {
      await enqueuePending();
      await drained();
      checkBreaker();
    }
    const { min_repeats, max_repeats } = o.experiment.stopping;
    for (; repeat < max_repeats && !overBudget && !tripped; repeat++) {
      const active =
        repeat < min_repeats
          ? new Set(plan.inputs.map((i) => i.key))
          : inputsToContinue(plan.members, states);
      if (active.size === 0) break;
      for (const input of plan.inputs.filter((i) => active.has(i.key))) {
        const key = trialKey({
          experimentId: o.experiment.name,
          modelId: fingerprint,
          task: o.experiment.task,
          jobId: String(input.jobId),
          pool: input.pool,
          repeatIndex: repeat,
          promptVersion: o.experiment.prompt_version,
          inputsSha256: input.inputsSha256,
        });
        await insertTrial(o.db, {
          runId,
          task: o.experiment.task,
          jobId: input.jobId,
          poolComposition: input.pool,
          repeatIndex: repeat,
          inputsSha256: input.inputsSha256,
          shuffleSeed: key,
          idempotencyKey: key,
          inputs: [
            { position: 0, cvDocumentId: input.cvDocumentId, extractionId: input.extractionId },
          ],
        });
      }
      await enqueuePending();
      await drained();
      checkBreaker();
      if (tripped) break;

      // Sequential stopping after each full repeat.
      const scores = new Map<string, number[]>();
      for (const s of await runScores(o.db, runId))
        scores.set(s.key, [...(scores.get(s.key) ?? []), s.score]);
      for (const [cell, interval] of cellIntervals(plan.members, scores)) {
        intervals.set(cell, interval);
        if (states.get(cell) === 'sampling')
          states.set(cell, cellState(interval, repeat + 1, o.experiment.stopping));
      }
      const open = [...states.values()].filter((s) => s === 'sampling').length;
      log(
        `Repeat ${repeat + 1}: ${active.size} inputs called; ${open} of ${states.size} cells still sampling.`,
      );
    }

    if (overBudget) {
      await queue.drain(true); // no new calls start; in-flight ones have already settled
      await setRunStatus(o.db, runId, 'stopped_budget');
      log(`Stopped at the budget cap (EUR ${cap.toFixed(4)}).`);
    } else if (tripped) {
      await queue.drain(true);
      await setRunStatus(o.db, runId, 'failed');
      log('Stopped: most calls in the last batch failed. Fix the cause, then run again to resume.');
    } else {
      await setRunStatus(o.db, runId, 'completed');
    }
  } finally {
    await worker.close();
    await queue.close();
    connection.disconnect();
  }

  const cells = new Map(
    plan.cells.map((c) => {
      const i = intervals.get(c) ?? { n: 0, mean: Number.NaN, halfWidth: Number.POSITIVE_INFINITY };
      return [c, { state: states.get(c) ?? 'sampling', ...i }];
    }),
  );
  const status = overBudget ? 'stopped_budget' : tripped ? 'failed' : 'completed';
  return { runId, status, repeats: repeat, cells };
}
