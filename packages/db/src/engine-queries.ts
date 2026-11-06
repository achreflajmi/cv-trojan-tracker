import type pg from 'pg';
import { toEur } from './pool.ts';

type Db = pg.Pool;

export interface PlanRow {
  extractionId: number;
  cvDocumentId: number;
  extractor: string;
  text: string;
  textSha256: string;
  condition: string;
  hidingMethod: string | null;
  profile: string;
  fitBand: string;
  jobId: number;
  jobSlug: string;
  jobText: string;
}

/** Every extraction matching an experiment's filters, with its job and profile. */
export async function loadPlanRows(
  db: Db,
  f: { jobs: string[]; fitBands: string[]; extractors: string[] },
): Promise<PlanRow[]> {
  const { rows } = await db.query<{
    extraction_id: string;
    cv_document_id: string;
    extractor: string;
    text: string;
    text_sha256: string;
    condition: string;
    hiding_method: string | null;
    external_id: string;
    fit_band: string;
    job_id: string;
    slug: string;
    job_text: string;
  }>(
    `SELECT e.id AS extraction_id, d.id AS cv_document_id, e.extractor, e.text, e.text_sha256,
            d.condition, d.hiding_method, p.external_id, p.fit_band, j.id AS job_id, j.slug, j.text AS job_text
     FROM extraction e
     JOIN cv_document d ON d.id = e.cv_document_id
     JOIN profile p ON p.id = d.profile_id
     JOIN job j ON j.id = p.job_id
     WHERE j.slug = ANY($1) AND p.fit_band = ANY($2) AND e.extractor = ANY($3)
     ORDER BY j.slug, p.external_id, e.extractor, d.condition, d.hiding_method NULLS FIRST`,
    [f.jobs, f.fitBands, f.extractors],
  );
  return rows.map((r) => ({
    extractionId: Number(r.extraction_id),
    cvDocumentId: Number(r.cv_document_id),
    extractor: r.extractor,
    text: r.text,
    textSha256: r.text_sha256,
    condition: r.condition,
    hidingMethod: r.hiding_method,
    profile: r.external_id,
    fitBand: r.fit_band,
    jobId: Number(r.job_id),
    jobSlug: r.slug,
    jobText: r.job_text,
  }));
}

/** What a worker needs to build the provider request for one trial. */
export interface TrialRequestData {
  trialId: number;
  idempotencyKey: string;
  task: string;
  jobText: string;
  /** CV texts in presentation order (trial_input.position): one for score, the pool for rank. */
  cvTexts: string[];
}

export async function trialRequestData(db: Db, trialId: number): Promise<TrialRequestData> {
  const { rows } = await db.query<{
    idempotency_key: string;
    task: string;
    job_text: string;
    cv_text: string;
  }>(
    `SELECT t.idempotency_key, t.task, j.text AS job_text, e.text AS cv_text
     FROM trial t
     JOIN job j ON j.id = t.job_id
     JOIN trial_input ti ON ti.trial_id = t.id
     JOIN extraction e ON e.id = ti.extraction_id
     WHERE t.id = $1
     ORDER BY ti.position`,
    [trialId],
  );
  const r = rows[0];
  if (!r) throw new Error(`trial ${trialId} has no input`);
  return {
    trialId,
    idempotencyKey: r.idempotency_key,
    task: r.task,
    jobText: r.job_text,
    cvTexts: rows.map((x) => x.cv_text),
  };
}

/** Valid scores of a run, keyed by job, inputs hash and arm (pool composition). */
export async function runScores(db: Db, runId: number): Promise<{ key: string; score: number }[]> {
  const { rows } = await db.query<{
    job_id: string;
    inputs_sha256: string;
    pool: string;
    score: number;
  }>(
    `SELECT t.job_id, t.inputs_sha256, t.pool_composition AS pool, (c.parsed_json->>'score')::int AS score
     FROM call c JOIN trial t ON t.id = c.trial_id
     WHERE t.run_id = $1 AND c.status = 'completed' AND c.parsed_json IS NOT NULL`,
    [runId],
  );
  return rows.map((r) => ({ key: `${r.job_id}|${r.inputs_sha256}|${r.pool}`, score: r.score }));
}

/** An unfinished run of this experiment and model, to resume ('failed' = stopped by the
 * circuit breaker or interrupted; completed and budget-stopped runs are final). */
export async function findOpenRun(
  db: Db,
  experimentId: number,
  modelId: number,
): Promise<number | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM run WHERE experiment_id = $1 AND model_id = $2 AND status IN ('planned', 'running', 'failed')
     ORDER BY id DESC LIMIT 1`,
    [experimentId, modelId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** EUR committed in the current UTC calendar month across all runs (SPEC 4.5 monthly cap). */
export async function monthCommittedEur(db: Db, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { rows } = await db.query<{ total: string | null }>(
    'SELECT COALESCE(SUM(delta_eur), 0) AS total FROM budget_ledger WHERE created_at >= $1',
    [start],
  );
  return toEur(rows[0]?.total ?? null);
}

export interface RunStatus {
  id: number;
  experiment: string;
  provider: string;
  modelId: string;
  status: string;
  budgetEur: number;
  committedEur: number;
  trials: number;
  completed: number;
  unparseable: number;
  failed: number;
  inFlight: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function runStatus(db: Db, runId: number): Promise<RunStatus> {
  const { rows } = await db.query<{
    id: string;
    experiment: string;
    provider: string;
    model_id: string;
    status: string;
    budget_eur: string;
    committed: string | null;
    trials: string;
    completed: string;
    unparseable: string;
    failed: string;
    in_flight: string;
    started_at: Date | null;
    finished_at: Date | null;
  }>(
    `SELECT r.id, x.name AS experiment, m.provider, m.model_id, r.status, r.budget_eur,
       (SELECT SUM(delta_eur) FROM budget_ledger b WHERE b.run_id = r.id) AS committed,
       (SELECT count(*) FROM trial t WHERE t.run_id = r.id) AS trials,
       (SELECT count(*) FROM call c JOIN trial t ON t.id = c.trial_id WHERE t.run_id = r.id AND c.status = 'completed') AS completed,
       (SELECT count(*) FROM call c JOIN trial t ON t.id = c.trial_id WHERE t.run_id = r.id AND c.status = 'completed' AND c.parsed_json IS NULL) AS unparseable,
       (SELECT count(*) FROM call c JOIN trial t ON t.id = c.trial_id WHERE t.run_id = r.id AND c.status = 'failed') AS failed,
       (SELECT count(*) FROM call c JOIN trial t ON t.id = c.trial_id WHERE t.run_id = r.id AND c.status = 'claimed') AS in_flight,
       r.started_at, r.finished_at
     FROM run r JOIN experiment x ON x.id = r.experiment_id JOIN model m ON m.id = r.model_id
     WHERE r.id = $1`,
    [runId],
  );
  const r = rows[0];
  if (!r) throw new Error(`run ${runId} does not exist`);
  return {
    id: Number(r.id),
    experiment: r.experiment,
    provider: r.provider,
    modelId: r.model_id,
    status: r.status,
    budgetEur: toEur(r.budget_eur),
    committedEur: toEur(r.committed),
    trials: Number(r.trials),
    completed: Number(r.completed),
    unparseable: Number(r.unparseable),
    failed: Number(r.failed),
    inFlight: Number(r.in_flight),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
