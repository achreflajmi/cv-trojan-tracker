import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { committedEur } from '@ctt/db';
import { createTestDb, type TestDb } from '@ctt/db/testing';
import { runPending } from './execute.ts';
import { buildFakeRequest, createRunFixture, slowFake, TEST_PRICES } from './testing/fixture.ts';

const WORKER = fileURLToPath(new URL('./testing/kill-worker.ts', import.meta.url));

async function completedCount(t: TestDb, runId: number): Promise<number> {
  const { rows } = await t.pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM call c JOIN trial t ON t.id = c.trial_id WHERE t.run_id = $1 AND c.status = 'completed'",
    [runId],
  );
  return Number(rows[0]?.n);
}

function startWorker(t: TestDb, runId: number, msPerCall: number) {
  const child = spawn(process.execPath, [WORKER, t.schema, String(runId), String(msPerCall)], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited, stderr: () => stderr };
}

describe.skipIf(!process.env.DATABASE_URL)('resume after kill (SPEC 6, Stage 3)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('killing a run mid-way and restarting creates zero duplicate call rows', async () => {
    const TRIALS = 30;
    const runId = await createRunFixture(t.pool, TRIALS, 1000);

    // 1. Start a worker and kill it (SIGKILL: no cleanup code runs) after some progress.
    const first = startWorker(t, runId, 40);
    const deadline = Date.now() + 20_000;
    while ((await completedCount(t, runId)) < 8) {
      if (Date.now() > deadline) throw new Error(`worker made no progress: ${first.stderr()}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    first.child.kill('SIGKILL');
    await first.exited;
    const afterKill = await completedCount(t, runId);
    expect(afterKill).toBeGreaterThan(0);
    expect(afterKill).toBeLessThan(TRIALS);

    // 2. Restart and let it finish.
    const second = startWorker(t, runId, 1);
    expect(await second.exited, second.stderr()).toBe(0);

    // 3. Every trial has exactly one completed call; none has two.
    const { rows } = await t.pool.query<{ completed: string; trials: string }>(
      `SELECT count(*) FILTER (WHERE completed = 1) AS completed, count(*) AS trials FROM (
         SELECT t.id, count(c.id) FILTER (WHERE c.status = 'completed') AS completed
         FROM trial t LEFT JOIN call c ON c.trial_id = t.id WHERE t.run_id = $1 GROUP BY t.id) x`,
      [runId],
    );
    expect(Number(rows[0]?.trials)).toBe(TRIALS);
    expect(Number(rows[0]?.completed)).toBe(TRIALS);
    const duplicates = await t.pool.query(
      "SELECT trial_id FROM call WHERE status = 'completed' GROUP BY trial_id HAVING count(*) > 1",
    );
    expect(duplicates.rowCount).toBe(0);

    // 4. No claim is left dangling, and an interrupted call is accounted as possibly paid.
    const states = await t.pool.query<{ status: string; n: string }>(
      'SELECT status, count(*) AS n FROM call GROUP BY status',
    );
    const byStatus = Object.fromEntries(states.rows.map((r) => [r.status, Number(r.n)]));
    expect(byStatus.claimed ?? 0).toBe(0);
    const orphaned = byStatus.failed ?? 0;
    const ledger = await t.pool.query<{ kind: string; n: string }>(
      "SELECT kind, count(*) AS n FROM budget_ledger WHERE run_id = $1 AND kind = 'orphaned' GROUP BY kind",
      [runId],
    );
    expect(Number(ledger.rows[0]?.n ?? 0)).toBe(orphaned);
  }, 60_000);

  it('two workers on the same run never call the API twice for one trial', async () => {
    const TRIALS = 20;
    const runId = await createRunFixture(t.pool, TRIALS, 1000);
    const a = slowFake(5);
    const b = slowFake(5);
    const ctx = { db: t.pool, runId, prices: TEST_PRICES, buildRequest: buildFakeRequest };
    await Promise.all([
      runPending({ ...ctx, adapter: a }, { recoverOrphans: false }),
      runPending({ ...ctx, adapter: b }, { recoverOrphans: false }),
    ]);
    expect(a.calls.length + b.calls.length).toBe(TRIALS);
    expect(await completedCount(t, runId)).toBe(TRIALS);
  });

  it('stops starting calls at the budget cap and never exceeds it', async () => {
    // Each fake call: worst case = (bytes + 50 tokens) x EUR 0.001; actual is lower.
    const runId = await createRunFixture(t.pool, 50, 0.5);
    const adapter = slowFake(0);
    const counts = await runPending({
      db: t.pool,
      runId,
      adapter,
      prices: TEST_PRICES,
      buildRequest: buildFakeRequest,
    });
    expect(counts['over-budget']).toBe(1);
    expect(adapter.calls.length).toBeLessThan(50);
    expect(await committedEur(t.pool, runId)).toBeLessThanOrEqual(0.5);
  });
});
