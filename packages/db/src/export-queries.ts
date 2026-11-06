import type pg from 'pg';

type Db = pg.Pool;

export interface ExportCall {
  runId: number;
  provider: string;
  modelId: string;
  modelSettings: unknown;
  task: string;
  jobId: number;
  pool: string;
  repeatIndex: number;
  inputsSha256: string;
  parsed: unknown;
  finishReason: string | null;
  costEur: number;
  returnedModelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Every completed call of an experiment (unparseable ones included, parsed = null). */
export async function exportCalls(db: Db, experiment: string): Promise<ExportCall[]> {
  const { rows } = await db.query<{
    run_id: string;
    provider: string;
    model_id: string;
    settings_json: unknown;
    task: string;
    job_id: string;
    pool: string;
    repeat_index: number;
    inputs_sha256: string;
    parsed_json: unknown;
    finish_reason: string | null;
    cost_eur: string;
    returned_model_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
  }>(
    `SELECT r.id AS run_id, m.provider, m.model_id, m.settings_json, t.task, t.job_id,
            t.pool_composition AS pool, t.repeat_index, t.inputs_sha256, c.parsed_json,
            c.finish_reason, c.cost_eur, c.returned_model_id, c.input_tokens, c.output_tokens
     FROM call c
     JOIN trial t ON t.id = c.trial_id
     JOIN run r ON r.id = t.run_id
     JOIN experiment x ON x.id = r.experiment_id
     JOIN model m ON m.id = r.model_id
     WHERE x.name = $1 AND c.status = 'completed'
     ORDER BY r.id, t.id`,
    [experiment],
  );
  return rows.map((r) => ({
    runId: Number(r.run_id),
    provider: r.provider,
    modelId: r.model_id,
    modelSettings: r.settings_json,
    task: r.task,
    jobId: Number(r.job_id),
    pool: r.pool,
    repeatIndex: r.repeat_index,
    inputsSha256: r.inputs_sha256,
    parsed: r.parsed_json,
    finishReason: r.finish_reason,
    costEur: Number(r.cost_eur),
    returnedModelId: r.returned_model_id,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
  }));
}

export interface ExportRankInput {
  runId: number;
  provider: string;
  modelId: string;
  trialId: number;
  pool: string;
  repeatIndex: number;
  parsed: unknown;
  costEur: number;
  job: string;
  position: number;
  profile: string;
  condition: string;
  hidingMethod: string | null;
}

/** Completed rank calls with every pool member in presentation order (one row per member). */
export async function exportRankInputs(db: Db, experiment: string): Promise<ExportRankInput[]> {
  const { rows } = await db.query<{
    run_id: string;
    provider: string;
    model_id: string;
    trial_id: string;
    pool: string;
    repeat_index: number;
    parsed_json: unknown;
    cost_eur: string;
    slug: string;
    position: number;
    external_id: string;
    condition: string;
    hiding_method: string | null;
  }>(
    `SELECT r.id AS run_id, m.provider, m.model_id, t.id AS trial_id, t.pool_composition AS pool,
            t.repeat_index, c.parsed_json, c.cost_eur, j.slug, ti.position, p.external_id,
            d.condition, d.hiding_method
     FROM call c
     JOIN trial t ON t.id = c.trial_id
     JOIN run r ON r.id = t.run_id
     JOIN experiment x ON x.id = r.experiment_id
     JOIN model m ON m.id = r.model_id
     JOIN job j ON j.id = t.job_id
     JOIN trial_input ti ON ti.trial_id = t.id
     JOIN cv_document d ON d.id = ti.cv_document_id
     JOIN profile p ON p.id = d.profile_id
     WHERE x.name = $1 AND c.status = 'completed' AND t.task = 'rank'
     ORDER BY t.id, ti.position`,
    [experiment],
  );
  return rows.map((r) => ({
    runId: Number(r.run_id),
    provider: r.provider,
    modelId: r.model_id,
    trialId: Number(r.trial_id),
    pool: r.pool,
    repeatIndex: r.repeat_index,
    parsed: r.parsed_json,
    costEur: Number(r.cost_eur),
    job: r.slug,
    position: r.position,
    profile: r.external_id,
    condition: r.condition,
    hidingMethod: r.hiding_method,
  }));
}

export interface ExportVariant {
  jobId: number;
  job: string;
  profile: string;
  fitBand: string;
  extractor: string;
  extractorVersion: string;
  condition: string;
  hidingMethod: string | null;
  textSha256: string;
  hiddenTextPresent: boolean | null;
}

/** Every extraction (CV variant x extractor): maps a call's input back to the variants it stands for. */
export async function exportVariants(db: Db): Promise<ExportVariant[]> {
  const { rows } = await db.query<{
    job_id: string;
    slug: string;
    external_id: string;
    fit_band: string;
    extractor: string;
    extractor_version: string;
    condition: string;
    hiding_method: string | null;
    text_sha256: string;
    hidden_text_present: boolean | null;
  }>(
    `SELECT j.id AS job_id, j.slug, p.external_id, p.fit_band, e.extractor, e.extractor_version,
            d.condition, d.hiding_method, e.text_sha256, e.hidden_text_present
     FROM extraction e
     JOIN cv_document d ON d.id = e.cv_document_id
     JOIN profile p ON p.id = d.profile_id
     JOIN job j ON j.id = p.job_id
     ORDER BY j.slug, p.external_id, e.extractor, d.condition, d.hiding_method NULLS FIRST`,
  );
  return rows.map((r) => ({
    jobId: Number(r.job_id),
    job: r.slug,
    profile: r.external_id,
    fitBand: r.fit_band,
    extractor: r.extractor,
    extractorVersion: r.extractor_version,
    condition: r.condition,
    hidingMethod: r.hiding_method,
    textSha256: r.text_sha256,
    hiddenTextPresent: r.hidden_text_present,
  }));
}
