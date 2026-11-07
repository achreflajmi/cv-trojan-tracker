import type pg from 'pg';
import {
  createRun,
  insertTrial,
  upsertCvDocument,
  upsertExperiment,
  upsertExtraction,
  upsertJob,
  upsertModel,
  upsertProfile,
  type PendingTrial,
} from '@ctt/db';
import { FakeAdapter } from '@ctt/providers';
import {
  inputsSha256,
  ScoreOutput,
  scoreJsonSchema,
  sha256,
  trialKey,
  type CallRequest,
  type ModelAdapter,
  type PricesConfig,
} from '@ctt/shared';

export const FAKE_MODEL_ID = 'fake-scripted-1';

/** Non-zero prices so the ledger arithmetic is exercised (1 token = EUR 0.001). */
export const TEST_PRICES: PricesConfig = {
  usd_to_eur: { rate: 1, date: '2026-11-05', source: 'test' },
  models: {
    [FAKE_MODEL_ID]: {
      input_usd_per_mtok: 1000,
      output_usd_per_mtok: 1000,
      date: '2026-11-05',
      source: 'test',
    },
  },
};

/** One job, one profile, one CV, and `n` score trials (repeats) in a new run. */
export async function createRunFixture(db: pg.Pool, n: number, budgetEur: number): Promise<number> {
  const jobId = await upsertJob(db, {
    slug: 'fixture-job',
    version: 1,
    title: 'Fixture',
    text: 'Job text',
  });
  const profileId = await upsertProfile(db, {
    jobId,
    externalId: 'fixture-01',
    seed: 'fixture',
    fitBand: 'medium',
    data: {},
  });
  const cvId = await upsertCvDocument(db, {
    profileId,
    condition: 'CLEAN',
    hiding: null,
    pdfSha256: 'x',
    path: 'x.pdf',
  });
  const text = 'CV text';
  const extractionId = await upsertExtraction(db, {
    cvDocumentId: cvId,
    extractor: 'pdfjs',
    version: 'test',
    text,
    textSha256: sha256(text),
    hiddenPresent: null,
  });
  const modelId = await upsertModel(db, { provider: 'fake', modelId: FAKE_MODEL_ID, settings: {} });
  const experimentId = await upsertExperiment(db, {
    name: `fixture-${Date.now()}`,
    promptVersion: 'test',
    preregCommit: null,
  });
  const runId = await createRun(db, { experimentId, modelId, budgetEur });

  const inputs = inputsSha256([sha256(text)]);
  for (let repeat = 0; repeat < n; repeat++) {
    const key = trialKey({
      experimentId: String(experimentId),
      modelId: FAKE_MODEL_ID,
      task: 'score',
      jobId: String(jobId),
      pool: 'single',
      repeatIndex: repeat,
      promptVersion: 'test',
      inputsSha256: inputs,
    });
    await insertTrial(db, {
      runId,
      task: 'score',
      jobId,
      poolComposition: 'single',
      repeatIndex: repeat,
      inputsSha256: inputs,
      shuffleSeed: key,
      idempotencyKey: key,
      inputs: [{ position: 0, cvDocumentId: cvId, extractionId }],
    });
  }
  return runId;
}

export async function buildFakeRequest(trial: PendingTrial): Promise<CallRequest> {
  return {
    modelId: FAKE_MODEL_ID,
    system: 'system',
    user: `trial ${trial.id}`,
    jsonSchema: scoreJsonSchema,
    outputSchema: ScoreOutput,
    maxTokens: 50,
    settings: {},
    idempotencyKey: trial.idempotencyKey,
  };
}

/** A fake adapter that takes `ms` per call, so a test can kill a worker mid-call. */
export function slowFake(ms: number): ModelAdapter & { calls: CallRequest[] } {
  const fake = new FakeAdapter();
  return {
    provider: 'fake',
    calls: fake.calls,
    call: async (req) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return fake.call(req);
    },
  };
}
