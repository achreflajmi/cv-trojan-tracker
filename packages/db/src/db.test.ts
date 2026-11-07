import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS_DIR } from './migrate.ts';
import {
  claimCall,
  completeCall,
  createRun,
  upsertExperiment,
  upsertJob,
  upsertModel,
} from './queries.ts';
import { createTestDb, type TestDb } from './testing.ts';

describe.skipIf(!process.env.DATABASE_URL)('database schema', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('applies migrations once; a second run is a no-op', async () => {
    const client = await t.pool.connect();
    try {
      expect(await migrate(client)).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('refuses to run when an applied migration was edited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctt-migrations-'));
    cpSync(fileURLToPath(MIGRATIONS_DIR), dir, { recursive: true });
    const file = join(dir, '001_initial.sql');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n-- edited\n');
    const client = await t.pool.connect();
    try {
      await expect(migrate(client, pathToFileURL(dir + '/'))).rejects.toThrow(
        /edited after being applied/,
      );
    } finally {
      client.release();
    }
  });

  it('rejects a hidden condition without a hiding method (CHECK constraint)', async () => {
    const jobId = await upsertJob(t.pool, { slug: 'j', version: 1, title: 't', text: 'x' });
    const { rows } = await t.pool.query<{ id: string }>(
      "INSERT INTO profile (job_id, external_id, seed, fit_band, data_json) VALUES ($1, 'p', 's', 'weak', '{}') RETURNING id",
      [jobId],
    );
    await expect(
      t.pool.query(
        "INSERT INTO cv_document (profile_id, condition, hiding_method, pdf_sha256, path) VALUES ($1, 'DATA', NULL, 'x', 'x')",
        [rows[0]?.id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('allows only one completed call per trial, even with raw SQL', async () => {
    const jobId = await upsertJob(t.pool, { slug: 'j2', version: 1, title: 't', text: 'x' });
    const modelId = await upsertModel(t.pool, { provider: 'fake', modelId: 'm', settings: {} });
    const experimentId = await upsertExperiment(t.pool, {
      name: 'e',
      promptVersion: 'v',
      preregCommit: null,
    });
    const runId = await createRun(t.pool, { experimentId, modelId, budgetEur: 10 });
    const { rows } = await t.pool.query<{ id: string }>(
      "INSERT INTO trial (run_id, task, job_id, pool_composition, repeat_index, inputs_sha256, shuffle_seed, idempotency_key) VALUES ($1, 'score', $2, 'single', 0, 'h', 's', 'unique-key') RETURNING id",
      [runId, jobId],
    );
    const trialId = Number(rows[0]?.id);

    // Same idempotency key again: rejected by UNIQUE.
    await expect(
      t.pool.query(
        "INSERT INTO trial (run_id, task, job_id, pool_composition, repeat_index, inputs_sha256, shuffle_seed, idempotency_key) VALUES ($1, 'score', $2, 'single', 0, 'h', 's', 'unique-key')",
        [runId, jobId],
      ),
    ).rejects.toThrow(/duplicate key/);

    // Second claim while the first is in flight: refused.
    const first = await claimCall(t.pool, runId, trialId, 0.01);
    expect(first.kind).toBe('claimed');
    expect((await claimCall(t.pool, runId, trialId, 0.01)).kind).toBe('in-flight');

    // Complete it; a later claim sees the completed call.
    if (first.kind !== 'claimed') throw new Error('unreachable');
    await completeCall(
      t.pool,
      runId,
      first.callId,
      {
        rawText: '{}',
        parsed: null,
        returnedModelId: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
        finishReason: 'end_turn',
      },
      0.005,
    );
    expect((await claimCall(t.pool, runId, trialId, 0.01)).kind).toBe('already-completed');

    // Bypassing the code: a second completed row is still impossible.
    await expect(
      t.pool.query(
        "INSERT INTO call (trial_id, status, reserved_eur, raw_text, cost_eur) VALUES ($1, 'completed', 0, '{}', 0)",
        [trialId],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('refuses a claim that would exceed the run budget', async () => {
    const jobId = await upsertJob(t.pool, { slug: 'j3', version: 1, title: 't', text: 'x' });
    const modelId = await upsertModel(t.pool, { provider: 'fake', modelId: 'm3', settings: {} });
    const experimentId = await upsertExperiment(t.pool, {
      name: 'e3',
      promptVersion: 'v',
      preregCommit: null,
    });
    const runId = await createRun(t.pool, { experimentId, modelId, budgetEur: 0.05 });
    const { rows } = await t.pool.query<{ id: string }>(
      "INSERT INTO trial (run_id, task, job_id, pool_composition, repeat_index, inputs_sha256, shuffle_seed, idempotency_key) VALUES ($1, 'score', $2, 'single', 0, 'h', 's', 'k3') RETURNING id",
      [runId, jobId],
    );
    expect(await claimCall(t.pool, runId, Number(rows[0]?.id), 0.06)).toMatchObject({
      kind: 'over-budget',
    });
  });
});
