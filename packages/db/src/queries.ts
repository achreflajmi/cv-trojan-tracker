import type pg from 'pg';
import type { CallResult } from '@ctt/shared';
import { toEur, withTransaction } from './pool.ts';

type Db = pg.Pool;

/** Insert-or-get: returns the id of the row matching the unique key. */
async function upsertId(
  db: Db | pg.ClientBase,
  insert: string,
  params: unknown[],
  select: string,
  selectParams: unknown[],
): Promise<number> {
  const inserted = await db.query<{ id: string }>(
    `${insert} ON CONFLICT DO NOTHING RETURNING id`,
    params,
  );
  const row = inserted.rows[0] ?? (await db.query<{ id: string }>(select, selectParams)).rows[0];
  if (!row) throw new Error(`upsert found no row: ${select}`);
  return Number(row.id);
}

export function upsertModel(
  db: Db,
  m: { provider: string; modelId: string; settings: object },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO model (provider, model_id, settings_json) VALUES ($1, $2, $3)',
    [m.provider, m.modelId, JSON.stringify(m.settings)],
    'SELECT id FROM model WHERE provider = $1 AND model_id = $2 AND settings_json = $3::jsonb',
    [m.provider, m.modelId, JSON.stringify(m.settings)],
  );
}

export function upsertJob(
  db: Db,
  j: { slug: string; version: number; title: string; text: string },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO job (slug, version, title, text) VALUES ($1, $2, $3, $4)',
    [j.slug, j.version, j.title, j.text],
    'SELECT id FROM job WHERE slug = $1 AND version = $2',
    [j.slug, j.version],
  );
}

export function upsertProfile(
  db: Db,
  p: { jobId: number; externalId: string; seed: string; fitBand: string; data: object },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO profile (job_id, external_id, seed, fit_band, data_json) VALUES ($1, $2, $3, $4, $5)',
    [p.jobId, p.externalId, p.seed, p.fitBand, JSON.stringify(p.data)],
    'SELECT id FROM profile WHERE job_id = $1 AND external_id = $2',
    [p.jobId, p.externalId],
  );
}

export function upsertCvDocument(
  db: Db,
  d: {
    profileId: number;
    condition: string;
    hiding: string | null;
    pdfSha256: string;
    path: string;
  },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO cv_document (profile_id, condition, hiding_method, pdf_sha256, path) VALUES ($1, $2, $3, $4, $5)',
    [d.profileId, d.condition, d.hiding, d.pdfSha256, d.path],
    'SELECT id FROM cv_document WHERE profile_id = $1 AND condition = $2 AND hiding_method IS NOT DISTINCT FROM $3::text',
    [d.profileId, d.condition, d.hiding],
  );
}

export function upsertExtraction(
  db: Db,
  e: {
    cvDocumentId: number;
    extractor: string;
    version: string;
    text: string;
    textSha256: string;
    hiddenPresent: boolean | null;
  },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO extraction (cv_document_id, extractor, extractor_version, text, text_sha256, hidden_text_present) VALUES ($1, $2, $3, $4, $5, $6)',
    [e.cvDocumentId, e.extractor, e.version, e.text, e.textSha256, e.hiddenPresent],
    'SELECT id FROM extraction WHERE cv_document_id = $1 AND extractor = $2 AND extractor_version = $3',
    [e.cvDocumentId, e.extractor, e.version],
  );
}

export function upsertExperiment(
  db: Db,
  e: { name: string; promptVersion: string; preregCommit: string | null },
): Promise<number> {
  return upsertId(
    db,
    'INSERT INTO experiment (name, prompt_version, prereg_commit) VALUES ($1, $2, $3)',
    [e.name, e.promptVersion, e.preregCommit],
    'SELECT id FROM experiment WHERE name = $1',
    [e.name],
  );
}

export async function createRun(
  db: Db,
  r: { experimentId: number; modelId: number; budgetEur: number },
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO run (experiment_id, model_id, budget_eur) VALUES ($1, $2, $3) RETURNING id',
    [r.experimentId, r.modelId, r.budgetEur],
  );
  return Number(rows[0]?.id);
}

export async function setRunStatus(db: Db, runId: number, status: string): Promise<void> {
  await db.query(
    `UPDATE run SET status = $2,
       started_at = COALESCE(started_at, CASE WHEN $2 = 'running' THEN now() END),
       finished_at = CASE WHEN $2 IN ('completed', 'stopped_budget', 'failed') THEN now() ELSE finished_at END
     WHERE id = $1`,
    [runId, status],
  );
}

export interface NewTrial {
  runId: number;
  task: 'score' | 'rank';
  jobId: number;
  poolComposition: string;
  repeatIndex: number;
  inputsSha256: string;
  shuffleSeed: string;
  idempotencyKey: string;
  inputs: { position: number; cvDocumentId: number; extractionId: number }[];
}

/**
 * Insert a trial and its inputs once. A second insert with the same idempotency key
 * returns the existing trial and changes nothing (the UNIQUE constraint decides).
 */
export async function insertTrial(db: Db, t: NewTrial): Promise<{ id: number; created: boolean }> {
  return withTransaction(db, async (c) => {
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO trial (run_id, task, job_id, pool_composition, repeat_index, inputs_sha256, shuffle_seed, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        t.runId,
        t.task,
        t.jobId,
        t.poolComposition,
        t.repeatIndex,
        t.inputsSha256,
        t.shuffleSeed,
        t.idempotencyKey,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      const existing = await c.query<{ id: string }>(
        'SELECT id FROM trial WHERE idempotency_key = $1',
        [t.idempotencyKey],
      );
      return { id: Number(existing.rows[0]?.id), created: false };
    }
    for (const input of t.inputs) {
      await c.query(
        'INSERT INTO trial_input (trial_id, position, cv_document_id, extraction_id) VALUES ($1, $2, $3, $4)',
        [id, input.position, input.cvDocumentId, input.extractionId],
      );
    }
    return { id: Number(id), created: true };
  });
}

export interface PendingTrial {
  id: number;
  idempotencyKey: string;
}

/** Trials of a run that do not have a completed call yet, oldest first. */
export async function pendingTrials(db: Db, runId: number): Promise<PendingTrial[]> {
  const { rows } = await db.query<{ id: string; idempotency_key: string }>(
    `SELECT t.id, t.idempotency_key FROM trial t
     WHERE t.run_id = $1
       AND NOT EXISTS (SELECT 1 FROM call c WHERE c.trial_id = t.id AND c.status = 'completed')
     ORDER BY t.id`,
    [runId],
  );
  return rows.map((r) => ({ id: Number(r.id), idempotencyKey: r.idempotency_key }));
}

/**
 * Lock ordering rule: every transaction that writes the budget ledger locks the run
 * row FIRST. Without it, a claim (holding the run lock, waiting on a call row's unique
 * index) and a completion (holding the call row, waiting for the run lock via the
 * ledger's foreign key) can deadlock. Returns the run's budget.
 */
async function lockRun(c: pg.ClientBase, runId: number): Promise<number> {
  const { rows } = await c.query<{ budget_eur: string }>(
    'SELECT budget_eur FROM run WHERE id = $1 FOR UPDATE',
    [runId],
  );
  if (!rows[0]) throw new Error(`run ${runId} does not exist`);
  return toEur(rows[0].budget_eur);
}

export type Claim =
  | { kind: 'claimed'; callId: number }
  | { kind: 'already-completed' }
  | { kind: 'in-flight' }
  | { kind: 'over-budget'; committedEur: number; budgetEur: number };

/**
 * Step 1 of a paid call: check the budget, record the claim and reserve the
 * worst-case cost, in one transaction, BEFORE calling the API.
 * - The run row is locked (FOR UPDATE), so concurrent workers check the budget one at
 *   a time and can never reserve past the cap together (SPEC 4.5, #10).
 * - The partial unique indexes guarantee that a trial can never be completed twice or
 *   claimed by two workers at once (SPEC 4.4, #16).
 */
export async function claimCall(
  db: Db,
  runId: number,
  trialId: number,
  reservedEur: number,
): Promise<Claim> {
  return withTransaction(db, async (c) => {
    const budgetEur = await lockRun(c, runId);
    const spent = await c.query<{ total: string | null }>(
      'SELECT COALESCE(SUM(delta_eur), 0) AS total FROM budget_ledger WHERE run_id = $1',
      [runId],
    );
    const committed = toEur(spent.rows[0]?.total ?? null);
    if (committed + reservedEur > budgetEur)
      return { kind: 'over-budget', committedEur: committed, budgetEur };

    const done = await c.query("SELECT 1 FROM call WHERE trial_id = $1 AND status = 'completed'", [
      trialId,
    ]);
    if (done.rowCount) return { kind: 'already-completed' };
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO call (trial_id, status, reserved_eur) VALUES ($1, 'claimed', $2)
       ON CONFLICT (trial_id) WHERE status = 'claimed' DO NOTHING RETURNING id`,
      [trialId, reservedEur],
    );
    const callId = inserted.rows[0]?.id;
    if (callId === undefined) return { kind: 'in-flight' };
    await c.query(
      "INSERT INTO budget_ledger (run_id, call_id, kind, delta_eur, reason) VALUES ($1, $2, 'reserve', $3, 'worst case before call')",
      [runId, callId, reservedEur],
    );
    return { kind: 'claimed', callId: Number(callId) };
  });
}

/** Step 2: store the answer and settle the reservation to the actual cost, atomically. */
export async function completeCall(
  db: Db,
  runId: number,
  callId: number,
  result: CallResult,
  costEur: number,
): Promise<void> {
  await withTransaction(db, async (c) => {
    await lockRun(c, runId);
    const updated = await c.query<{ reserved_eur: string }>(
      `UPDATE call SET status = 'completed', raw_text = $2, parsed_json = $3, returned_model_id = $4,
         input_tokens = $5, output_tokens = $6, thinking_tokens = $7, cost_eur = $8,
         latency_ms = $9, finish_reason = $10, finished_at = now()
       WHERE id = $1 AND status = 'claimed' RETURNING reserved_eur`,
      [
        callId,
        result.rawText,
        result.parsed === null ? null : JSON.stringify(result.parsed),
        result.returnedModelId,
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.thinkingTokens ?? null,
        costEur,
        result.latencyMs,
        result.finishReason,
      ],
    );
    const reserved = updated.rows[0]?.reserved_eur;
    if (reserved === undefined) throw new Error(`call ${callId} is not in 'claimed' state`);
    await c.query(
      "INSERT INTO budget_ledger (run_id, call_id, kind, delta_eur, reason) VALUES ($1, $2, 'settle', $3, 'actual cost minus reservation')",
      [runId, callId, costEur - toEur(reserved)],
    );
  });
}

/**
 * Step 2 (failure): the API answered with an error status (not billed), so the
 * reservation is released. If we cannot know whether it was billed (e.g. the
 * connection dropped), the reservation is kept as 'orphaned'.
 */
export async function failCall(
  db: Db,
  runId: number,
  callId: number,
  error: string,
  maybeBilled: boolean,
): Promise<void> {
  await withTransaction(db, async (c) => {
    await lockRun(c, runId);
    const updated = await c.query<{ reserved_eur: string }>(
      "UPDATE call SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'claimed' RETURNING reserved_eur",
      [callId, error],
    );
    const reserved = updated.rows[0]?.reserved_eur;
    if (reserved === undefined) return;
    await c.query(
      'INSERT INTO budget_ledger (run_id, call_id, kind, delta_eur, reason) VALUES ($1, $2, $3, $4, $5)',
      maybeBilled
        ? [runId, callId, 'orphaned', 0, 'outcome unknown; reservation kept as possibly paid']
        : [
            runId,
            callId,
            'settle',
            -toEur(reserved),
            'API error, not billed; reservation released',
          ],
    );
  });
}

/**
 * On resume: claims left by a process that died mid-call. The API may have been
 * paid, so the reservation stays in the ledger ('orphaned') and the trial is retried.
 * Only call this when no worker for the run is alive.
 */
export async function recoverOrphanedClaims(db: Db, runId: number): Promise<number> {
  return withTransaction(db, async (c) => {
    await lockRun(c, runId);
    const { rows } = await c.query<{ id: string }>(
      `UPDATE call SET status = 'failed', error = 'orphaned claim: process died during the call', finished_at = now()
       WHERE status = 'claimed' AND trial_id IN (SELECT id FROM trial WHERE run_id = $1)
       RETURNING id`,
      [runId],
    );
    for (const r of rows) {
      await c.query(
        "INSERT INTO budget_ledger (run_id, call_id, kind, delta_eur, reason) VALUES ($1, $2, 'orphaned', 0, 'process died during the call; reservation kept as possibly paid')",
        [runId, r.id],
      );
    }
    return rows.length;
  });
}

/** Committed spend for a run: actual costs plus reservations still open or orphaned. */
export async function committedEur(db: Db, runId: number): Promise<number> {
  const { rows } = await db.query<{ total: string | null }>(
    'SELECT COALESCE(SUM(delta_eur), 0) AS total FROM budget_ledger WHERE run_id = $1',
    [runId],
  );
  return toEur(rows[0]?.total ?? null);
}
