import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPool, exportCalls, exportVariants, type ExportVariant } from '@ctt/db';
import { inputsSha256 } from '@ctt/shared';

/** RFC 4180 CSV: quote every field that needs it. */
function csv(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return '';
  const headers = Object.keys(first);
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return (
    [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n') +
    '\n'
  );
}

function label(v: ExportVariant): string {
  return v.hidingMethod ? `${v.condition}-${v.hidingMethod}` : v.condition;
}

/**
 * ctt export: long-format data for analysis/ and apps/web.
 * - calls.csv: one row per (completed call x CV variant it stands for). Deduplicated
 *   calls (SPEC 3.3) fan back out to every variant whose extracted text they used.
 * - survival.csv: method x extractor survival per CV.
 * - meta.json: experiment, export time, models, extractor versions.
 */
export async function exportExperiment(experiment: string, outDir: string): Promise<void> {
  const db = createPool();
  try {
    const calls = await exportCalls(db, experiment);
    if (calls.length === 0) throw new Error(`No completed calls for experiment "${experiment}"`);
    const variants = await exportVariants(db);

    // A call's input is identified by (job, inputs_sha256); score trials have one input.
    const byInput = new Map<string, ExportVariant[]>();
    for (const v of variants) {
      const key = `${v.jobId}|${inputsSha256([v.textSha256])}`;
      byInput.set(key, [...(byInput.get(key) ?? []), v]);
    }

    const rows: Record<string, unknown>[] = [];
    for (const c of calls) {
      if (c.task !== 'score') continue; // rank trials are exported by the rank exporter
      const parsed = c.parsed as { score?: number; decision?: string } | null;
      for (const v of byInput.get(`${c.jobId}|${c.inputsSha256}`) ?? []) {
        // The A/A arm (pool 'aa') re-scores CLEAN only.
        if (c.pool === 'aa' && v.condition !== 'CLEAN') continue;
        rows.push({
          experiment,
          run_id: c.runId,
          provider: c.provider,
          model: c.modelId,
          job: v.job,
          profile: v.profile,
          fit_band: v.fitBand,
          extractor: v.extractor,
          condition: v.condition,
          hiding_method: v.hidingMethod ?? '',
          variant: label(v),
          arm: c.pool === 'aa' ? 'B' : 'A',
          repeat: c.repeatIndex,
          parsed: parsed ? 1 : 0,
          score: parsed?.score ?? '',
          advance: parsed ? (parsed.decision === 'advance' ? 1 : 0) : '',
          finish_reason: c.finishReason ?? '',
          returned_model_id: c.returnedModelId ?? '',
          cost_eur: c.costEur,
          input_hash: c.inputsSha256,
        });
      }
    }

    const survival = variants
      .filter((v) => v.condition !== 'CLEAN')
      .map((v) => ({
        job: v.job,
        profile: v.profile,
        extractor: v.extractor,
        extractor_version: v.extractorVersion,
        condition: v.condition,
        hiding_method: v.hidingMethod ?? '',
        hidden_text_present: v.hiddenTextPresent === null ? '' : v.hiddenTextPresent ? 1 : 0,
      }));

    const models = [
      ...new Map(
        calls.map((c) => [
          c.runId,
          { run_id: c.runId, provider: c.provider, model: c.modelId, settings: c.modelSettings },
        ]),
      ).values(),
    ];
    const meta = {
      experiment,
      exported_at: new Date().toISOString(),
      calls: calls.length,
      rows: rows.length,
      models,
      extractors: [...new Set(variants.map((v) => `${v.extractor} ${v.extractorVersion}`))],
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'calls.csv'), csv(rows));
    writeFileSync(join(outDir, 'survival.csv'), csv(survival));
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(
      `Exported ${calls.length} calls as ${rows.length} rows, ${survival.length} survival rows -> ${outDir}`,
    );
  } finally {
    await db.end();
  }
}
