import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPool,
  exportCalls,
  exportExperimentInfo,
  exportRankInputs,
  exportVariants,
  type ExportRankInput,
  type ExportVariant,
} from '@ctt/db';
import { parsePoolLabel } from '@ctt/engine';
import { inputsSha256 } from '@ctt/shared';

/**
 * rank.csv: one row per completed rank call. target_rank is the target candidate's
 * 1-based place in the model's ranking (empty if the answer was unparseable).
 */
export function rankRows(experiment: string, inputs: ExportRankInput[]): Record<string, unknown>[] {
  const byTrial = new Map<number, ExportRankInput[]>();
  for (const i of inputs) byTrial.set(i.trialId, [...(byTrial.get(i.trialId) ?? []), i]);
  const rows: Record<string, unknown>[] = [];
  for (const members of byTrial.values()) {
    const first = members[0];
    const pool = first ? parsePoolLabel(first.pool) : null;
    if (!first || !pool) continue;
    const ranking = (first.parsed as { ranking?: string[] } | null)?.ranking ?? null;
    // Candidate IDs are C<position + 1> (presentation order).
    const rankOf = (position: number): number | null => {
      const i = ranking?.indexOf(`C${position + 1}`) ?? -1;
      return i >= 0 ? i + 1 : null;
    };
    const target = members.find((m) => m.profile === pool.target);
    const targetRank = target ? rankOf(target.position) : null;
    const injectedRanks = members
      .filter((m) => m.condition !== 'CLEAN')
      .map((m) => rankOf(m.position))
      .filter((r): r is number => r !== null);
    rows.push({
      experiment,
      run_id: first.runId,
      provider: first.provider,
      model: first.modelId,
      job: first.job,
      extractor: pool.extractor,
      pool: `${first.job}|p${pool.pool}`,
      k: pool.k,
      variant: pool.variant,
      target: pool.target,
      repeat: first.repeatIndex,
      pool_size: members.length,
      parsed: ranking ? 1 : 0,
      target_rank: targetRank ?? '',
      target_top3: targetRank === null ? '' : targetRank <= 3 ? 1 : 0,
      target_position: target ? target.position + 1 : '',
      injected_mean_rank: injectedRanks.length
        ? injectedRanks.reduce((a, b) => a + b, 0) / injectedRanks.length
        : '',
      cost_eur: first.costEur,
    });
  }
  return rows;
}

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
    const info = await exportExperimentInfo(db, experiment);
    const meta = {
      experiment,
      prompt_version: info?.promptVersion ?? null,
      prereg_commit: info?.preregCommit ?? null,
      exported_at: new Date().toISOString(),
      calls: calls.length,
      rows: rows.length,
      models,
      extractors: [...new Set(variants.map((v) => `${v.extractor} ${v.extractorVersion}`))],
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'calls.csv'), csv(rows));
    const rank = rankRows(experiment, await exportRankInputs(db, experiment));
    if (rank.length > 0) writeFileSync(join(outDir, 'rank.csv'), csv(rank));
    writeFileSync(join(outDir, 'survival.csv'), csv(survival));
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(
      `Exported ${calls.length} calls as ${rows.length} rows, ${survival.length} survival rows -> ${outDir}`,
    );
  } finally {
    await db.end();
  }
}
