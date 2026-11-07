import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattery, Profile } from '@ctt/corpus';
import {
  createPool,
  runStatus,
  upsertCvDocument,
  upsertExtraction,
  upsertJob,
  upsertProfile,
} from '@ctt/db';
import { BudgetConfig, effectiveCapEur, loadExperiment, planFor, runExperiment } from '@ctt/engine';
import { createPolicyAdapter } from '@ctt/providers';
import {
  findModel,
  loadPrompt,
  loadYaml,
  ModelsConfig,
  PricesConfig,
  ProvidersConfig,
} from '@ctt/shared';
import { loadExtractions, type ManifestEntry } from './corpus.ts';

/** ctt ingest: load the generated corpus (profiles, PDFs, extractions) into Postgres. */
export async function ingest(): Promise<void> {
  const db = createPool();
  try {
    const battery = loadBattery();
    const manifest = JSON.parse(
      readFileSync('data/corpus/manifest.json', 'utf8'),
    ) as ManifestEntry[];
    const jobIds = new Map<string, number>();
    for (const job of battery.jobs) {
      jobIds.set(
        job.slug,
        await upsertJob(db, {
          slug: job.slug,
          version: job.version,
          title: job.title,
          text: job.text,
        }),
      );
    }
    const profileIds = new Map<string, number>();
    const cvIds = new Map<string, number>();
    for (const entry of manifest) {
      const jobId = jobIds.get(entry.job);
      if (jobId === undefined) throw new Error(`manifest job ${entry.job} is not in battery/jobs`);
      const profileKey = `${entry.job}|${entry.profileId}`;
      let profileId = profileIds.get(profileKey);
      if (profileId === undefined) {
        const profile = loadYaml(
          join('battery/profiles', entry.job, `${entry.profileId}.json`),
          Profile,
        );
        profileId = await upsertProfile(db, {
          jobId,
          externalId: profile.id,
          seed: profile.seed,
          fitBand: profile.fit_band,
          data: profile,
        });
        profileIds.set(profileKey, profileId);
      }
      cvIds.set(
        `${entry.job}|${entry.profileId}|${entry.label}`,
        await upsertCvDocument(db, {
          profileId,
          condition: entry.condition,
          hiding: entry.hiding,
          pdfSha256: entry.pdfSha256,
          path: entry.path,
        }),
      );
    }
    let n = 0;
    for (const r of loadExtractions()) {
      const cvId = cvIds.get(`${r.job}|${r.profileId}|${r.label}`);
      if (cvId === undefined)
        throw new Error(`extraction for unknown CV ${r.job}/${r.profileId}/${r.label}`);
      await upsertExtraction(db, {
        cvDocumentId: cvId,
        extractor: r.extractor,
        version: r.extractorVersion,
        text: r.text,
        textSha256: r.textSha256,
        hiddenPresent: r.hiddenTextPresent,
      });
      n++;
    }
    console.log(
      `Ingested ${jobIds.size} jobs, ${profileIds.size} profiles, ${cvIds.size} CVs, ${n} extractions.`,
    );
  } finally {
    await db.end();
  }
}

function loadRunInputs(experimentName: string, modelKey: string) {
  const experiment = loadExperiment(experimentName);
  return {
    experiment,
    model: findModel(loadYaml('config/models.yaml', ModelsConfig), modelKey),
    prompt: loadPrompt(experiment.prompt, experiment.prompt_version),
    prices: loadYaml('config/prices.yaml', PricesConfig),
    budget: loadYaml('config/budget.yaml', BudgetConfig),
  };
}

/** ctt plan: calls and cost before anything is spent (SPEC 4.5). */
export async function plan(experimentName: string, modelKey: string): Promise<void> {
  const db = createPool();
  try {
    const inputs = loadRunInputs(experimentName, modelKey);
    const p = await planFor({ db, ...inputs });
    const cap = await effectiveCapEur({ db, budget: inputs.budget, confirmBudgetEur: Infinity });
    console.log(
      `Experiment ${inputs.experiment.name}, model ${inputs.model.key} (${inputs.model.model_id})`,
    );
    console.log(`  extractions in scope:   ${p.extractions}`);
    console.log(`  distinct model inputs:  ${p.inputs.length}  (after deduplication)`);
    console.log(`  cells:                  ${p.cells.length}`);
    console.log(
      `  calls:                  ${p.callsMin} (all cells stop at min) to ${p.callsMax} (all at cap)`,
    );
    console.log(
      `  upper bound:            EUR ${p.upperBoundEur.toFixed(4)}  (cap repeats, max_tokens output)`,
    );
    console.log(`  typical (rough):        EUR ${p.typicalEur.toFixed(4)}`);
    console.log(
      `  budget available:       EUR ${cap.toFixed(4)}  (min of per-run cap and monthly remainder)`,
    );
    console.log(
      `Run with: pnpm ctt run --experiment ${experimentName} --model ${modelKey} --confirm-budget ${Math.max(0.01, Math.ceil(p.upperBoundEur * 100) / 100)}`,
    );
  } finally {
    await db.end();
  }
}

/** ctt run: queue workers, budget guard and sequential stopping. Re-running resumes. */
export async function run(
  experimentName: string,
  modelKey: string,
  confirmBudgetEur: number,
): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set (see .env.example)');
  const db = createPool();
  try {
    const inputs = loadRunInputs(experimentName, modelKey);
    const providers = loadYaml('config/providers.yaml', ProvidersConfig);
    const result = await runExperiment({
      db,
      redisUrl,
      ...inputs,
      confirmBudgetEur,
      adapter: createPolicyAdapter(inputs.model.provider, providers),
      concurrency: providers.providers[inputs.model.provider]?.max_concurrency ?? 4,
      log: (line) => console.log(line),
    });
    console.log(`Run ${result.runId} ${result.status} after ${result.repeats} repeat(s).`);
    console.log('cell                         state     n    lift    +/-');
    for (const [cell, c] of result.cells) {
      console.log(
        `${cell.padEnd(28)} ${c.state.padEnd(9)} ${String(c.n).padStart(3)} ${c.mean.toFixed(1).padStart(7)} ${c.halfWidth.toFixed(1).padStart(6)}`,
      );
    }
    console.log(
      'Lifts are in score points (injected minus CLEAN). Final CIs come from the analysis (Stage 6).',
    );
  } finally {
    await db.end();
  }
}

/** ctt status: progress and spend of one run. */
export async function status(runId: number): Promise<void> {
  const db = createPool();
  try {
    const s = await runStatus(db, runId);
    console.log(`Run ${s.id}: ${s.experiment} / ${s.provider} ${s.modelId} — ${s.status}`);
    console.log(
      `  trials ${s.trials}, completed calls ${s.completed} (unparseable ${s.unparseable}), failed ${s.failed}, in flight ${s.inFlight}`,
    );
    console.log(
      `  committed EUR ${s.committedEur.toFixed(4)} of cap EUR ${s.budgetEur.toFixed(4)}`,
    );
    console.log(
      `  started ${s.startedAt?.toISOString() ?? '-'}, finished ${s.finishedAt?.toISOString() ?? '-'}`,
    );
  } finally {
    await db.end();
  }
}
