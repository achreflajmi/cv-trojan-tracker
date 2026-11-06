import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  committedEur,
  runStatus,
  upsertCvDocument,
  upsertExtraction,
  upsertJob,
  upsertProfile,
} from '@ctt/db';
import { createTestDb, type TestDb } from '@ctt/db/testing';
import { FakeAdapter } from '@ctt/providers';
import { sha256, type ModelEntry, type Prompt } from '@ctt/shared';
import type { Experiment } from './experiment.ts';
import { planFor, runExperiment, type RunOptions } from './run.ts';
import { FAKE_MODEL_ID, TEST_PRICES } from './testing/fixture.ts';

const PROFILES = 6;
const LIFT = 10;

const experiment: Experiment = {
  name: 'engine-test',
  prompt: 'unused',
  prompt_version: 'test',
  task: 'score',
  jobs: ['engine-job'],
  fit_bands: ['medium'],
  conditions: ['CLEAN', 'DATA'],
  hiding_methods: ['WHITE', 'OFFPAGE'],
  extractors: ['pdfjs'],
  include_aa: true,
  stopping: { min_repeats: 2, max_repeats: 4, target_half_width: 100 },
};
const model: ModelEntry = {
  key: 'fake',
  provider: 'fake',
  model_id: FAKE_MODEL_ID,
  max_tokens: 50,
  settings: {},
};
const prompt: Prompt = {
  version: 'test',
  system: 'Score the CV.',
  userTemplate: '{{job}}\n{{cv}}',
};

/**
 * Scripted model: a per-profile base score, +LIFT when the hidden keywords reach it,
 * and a small deterministic noise per call so the A/A arm is not trivially identical.
 */
function scriptedModel(): FakeAdapter {
  return new FakeAdapter((req, n) => {
    const profile = Number(/profile (\d+)/.exec(req.user)?.[1] ?? 0);
    const lift = req.user.includes('HIDDEN KEYWORDS') ? LIFT : 0;
    const score = 40 + profile * 3 + lift + ((n * 7) % 5) - 2;
    return JSON.stringify({
      score,
      decision: score > 60 ? 'advance' : 'reject',
      reason: 'scripted',
    });
  });
}

/** One job, 6 medium profiles; per profile CLEAN, DATA-WHITE (text survives) and
 * DATA-OFFPAGE (text dropped, so identical to CLEAN: deduplicated into one input). */
async function seedCorpus(t: TestDb): Promise<void> {
  const jobId = await upsertJob(t.pool, {
    slug: 'engine-job',
    version: 1,
    title: 'Engine job',
    text: 'Job text',
  });
  for (let i = 0; i < PROFILES; i++) {
    const profileId = await upsertProfile(t.pool, {
      jobId,
      externalId: `p${i}`,
      seed: `s${i}`,
      fitBand: 'medium',
      data: {},
    });
    const clean = `CV of profile ${i}`;
    const variants: [string, string | null, string, boolean | null][] = [
      ['CLEAN', null, clean, null],
      ['DATA', 'WHITE', `${clean}\nHIDDEN KEYWORDS`, true],
      ['DATA', 'OFFPAGE', clean, false],
    ];
    for (const [condition, hiding, text, present] of variants) {
      const cv = await upsertCvDocument(t.pool, {
        profileId,
        condition,
        hiding,
        pdfSha256: sha256(`${i}${condition}${hiding}`),
        path: 'x.pdf',
      });
      await upsertExtraction(t.pool, {
        cvDocumentId: cv,
        extractor: 'pdfjs',
        version: 'test',
        text,
        textSha256: sha256(text),
        hiddenPresent: present,
      });
    }
  }
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)('engine run (Stage 5)', () => {
  let t: TestDb;
  let n = 0;
  const options = (overrides: Partial<RunOptions>): RunOptions => ({
    db: t.pool,
    redisUrl: process.env.REDIS_URL ?? '',
    experiment,
    model,
    prompt,
    prices: TEST_PRICES,
    budget: { per_run_cap_eur: 1000, monthly_cap_eur: 1000 },
    confirmBudgetEur: 1000,
    adapter: scriptedModel(),
    concurrency: 4,
    queueName: `test-${t.schema}-${n++}`,
    ...overrides,
  });

  beforeAll(async () => {
    t = await createTestDb();
    await seedCorpus(t);
  });
  afterAll(async () => {
    await t.drop();
  });

  it('plans deduplicated inputs: OFFPAGE shares the CLEAN input', async () => {
    const plan = await planFor(options({}));
    // Per profile: CLEAN (arm A), DATA-WHITE, CLEAN arm B for A/A. OFFPAGE adds nothing.
    expect(plan.inputs).toHaveLength(PROFILES * 3);
    expect(plan.extractions).toBe(PROFILES * 3);
    expect(plan.cells).toEqual(['pdfjs|AA', 'pdfjs|DATA-OFFPAGE', 'pdfjs|DATA-WHITE']);
    expect(plan.callsMax).toBe(PROFILES * 3 * 4);
  });

  it('runs to completion, stops by precision, and recovers the planted lift', async () => {
    const adapter = scriptedModel();
    const result = await runExperiment(
      options({ adapter, experiment: { ...experiment, name: 'complete' } }),
    );
    expect(result.status).toBe('completed');
    expect(result.repeats).toBe(2); // target is wide, so every cell stops at min_repeats
    expect(adapter.calls).toHaveLength(PROFILES * 3 * 2);

    const data = result.cells.get('pdfjs|DATA-WHITE');
    expect(data?.state).toBe('precise');
    expect(data?.mean).toBeGreaterThan(LIFT - 2);
    expect(data?.mean).toBeLessThan(LIFT + 2);
    // Same model input as CLEAN, same calls: the lift is exactly zero by construction.
    expect(result.cells.get('pdfjs|DATA-OFFPAGE')).toMatchObject({ mean: 0, halfWidth: 0 });
    expect(Math.abs(result.cells.get('pdfjs|AA')?.mean ?? 99)).toBeLessThan(2);

    const status = await runStatus(t.pool, result.runId);
    expect(status).toMatchObject({
      status: 'completed',
      completed: PROFILES * 3 * 2,
      failed: 0,
      inFlight: 0,
    });
  });

  it('keeps sampling up to the cap when the target is not reached', async () => {
    const adapter = scriptedModel();
    const result = await runExperiment(
      options({
        adapter,
        experiment: {
          ...experiment,
          name: 'to-cap',
          stopping: { min_repeats: 2, max_repeats: 3, target_half_width: 0.001 },
        },
      }),
    );
    expect(result.repeats).toBe(3);
    expect(result.cells.get('pdfjs|DATA-WHITE')?.state).toBe('cap');
    // OFFPAGE is exactly zero-width, so it stops; its inputs are CLEAN, still needed by others.
    expect(result.cells.get('pdfjs|DATA-OFFPAGE')?.state).toBe('precise');
  });

  it('stops at the budget cap with a fake adapter and never exceeds it (Stage 5 done-when)', async () => {
    const adapter = scriptedModel();
    // EUR. At TEST_PRICES a fake call reserves ~0.09 worst case but settles to ~0.03, so
    // the full run (36 calls) would cost ~1.1: a 0.5 cap must stop it part-way.
    const cap = 0.5;
    const result = await runExperiment(
      options({
        adapter,
        experiment: { ...experiment, name: 'budget-cap' },
        budget: { per_run_cap_eur: cap, monthly_cap_eur: 1000 },
      }),
    );
    const status = await runStatus(t.pool, result.runId);
    expect(result.status).toBe('stopped_budget');
    expect(status.status).toBe('stopped_budget');
    expect(adapter.calls.length).toBeGreaterThan(0);
    expect(adapter.calls.length).toBeLessThan(PROFILES * 3 * 2);
    expect(await committedEur(t.pool, result.runId)).toBeLessThanOrEqual(cap);
    expect(status.inFlight).toBe(0);
  });

  it('refuses to start when --confirm-budget is below the upper bound', async () => {
    const adapter = scriptedModel();
    await expect(
      runExperiment(
        options({
          adapter,
          experiment: { ...experiment, name: 'refused' },
          confirmBudgetEur: 0.01,
        }),
      ),
    ).rejects.toThrow(/below the upper bound/);
    expect(adapter.calls).toHaveLength(0);
  });

  it('resumes an interrupted run without paying again for completed trials', async () => {
    const name = 'resume';
    // First attempt dies after 5 calls (the adapter throws a non-HTTP error = possibly billed).
    let calls = 0;
    const flaky = new FakeAdapter(() => {
      if (++calls > 5) throw new Error('process crashed');
      return JSON.stringify({ score: 50, decision: 'reject', reason: 'x' });
    });
    const first = await runExperiment(
      options({ adapter: flaky, experiment: { ...experiment, name } }),
    );
    const firstCompleted = (await runStatus(t.pool, first.runId)).completed;
    expect(firstCompleted).toBe(5);

    // Most calls of the first batch failed, so the circuit breaker stopped the run
    // instead of planning more failing repeats. Running again resumes it.
    expect(first.status).toBe('failed');
    expect(first.repeats).toBe(0);
    const healthy = scriptedModel();
    const second = await runExperiment(
      options({ adapter: healthy, experiment: { ...experiment, name } }),
    );
    expect(second.runId).toBe(first.runId);
    const duplicates = await t.pool.query(
      "SELECT trial_id FROM call WHERE status = 'completed' GROUP BY trial_id HAVING count(*) > 1",
    );
    expect(duplicates.rowCount).toBe(0);
    expect(healthy.calls.length).toBe(PROFILES * 3 * 2 - firstCompleted);
  });
});
