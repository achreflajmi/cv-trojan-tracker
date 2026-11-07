import type { PlanRow } from '@ctt/db';
import {
  costEur,
  fillTemplate,
  inputsSha256,
  worstCaseCostEur,
  type ModelEntry,
  type PricesConfig,
  type Prompt,
} from '@ctt/shared';
import type { Experiment } from './experiment.ts';
import type { CellMember } from './stopping.ts';

/** Arm A is every normal trial; arm B is the second, independent CLEAN arm for A/A. */
export type Arm = 'A' | 'B';
const POOL: Record<Arm, string> = { A: 'single', B: 'aa' };

/** One distinct model input (deduplicated by job + extracted text, SPEC 3.3 / #4). */
export interface PlannedInput {
  /** `${jobId}|${inputsSha256}|${pool}`, the same key runScores() returns. */
  key: string;
  jobId: number;
  pool: string;
  inputsSha256: string;
  extractionId: number;
  cvDocumentId: number;
  user: string;
  worstCaseEur: number;
}

export interface Plan {
  inputs: PlannedInput[];
  members: CellMember[];
  cells: string[];
  /** Calls if every cell stops at min_repeats / runs to max_repeats. */
  callsMin: number;
  callsMax: number;
  /** Upper bound: every input at max_repeats, every call at max_tokens (SPEC 4.5, #11). */
  upperBoundEur: number;
  /** Rough: min_repeats, ~4 bytes per input token, 300 output tokens. For orientation only. */
  typicalEur: number;
  /** Extractions in scope, before deduplication. */
  extractions: number;
}

function variantLabel(row: PlanRow): string {
  return row.hidingMethod ? `${row.condition}-${row.hidingMethod}` : row.condition;
}

function inScope(row: PlanRow, e: Experiment): boolean {
  if (!e.conditions.includes(row.condition as Experiment['conditions'][number])) return false;
  if (row.hidingMethod === null) return true;
  return e.hiding_methods.includes(row.hidingMethod as Experiment['hiding_methods'][number]);
}

export function buildPlan(
  rows: readonly PlanRow[],
  experiment: Experiment,
  model: ModelEntry,
  prompt: Prompt,
  prices: PricesConfig,
): Plan {
  const scoped = rows.filter((r) => inScope(r, experiment));
  const inputs = new Map<string, PlannedInput>();

  const inputFor = (row: PlanRow, arm: Arm): string => {
    const hash = inputsSha256([row.textSha256]);
    const key = `${row.jobId}|${hash}|${POOL[arm]}`;
    if (!inputs.has(key)) {
      const user = fillTemplate(prompt.userTemplate, { job: row.jobText.trim(), cv: row.text });
      inputs.set(key, {
        key,
        jobId: row.jobId,
        pool: POOL[arm],
        inputsSha256: hash,
        extractionId: row.extractionId,
        cvDocumentId: row.cvDocumentId,
        user,
        worstCaseEur: worstCaseCostEur(
          prices,
          model.model_id,
          Buffer.byteLength(prompt.system + user, 'utf8'),
          model.max_tokens,
        ),
      });
    }
    return key;
  };

  // Group rows per (job, profile, extractor): that is where CLEAN and a variant pair up.
  const groups = new Map<string, PlanRow[]>();
  for (const row of scoped) {
    const g = `${row.jobId}|${row.profile}|${row.extractor}`;
    groups.set(g, [...(groups.get(g) ?? []), row]);
  }

  const members: CellMember[] = [];
  for (const group of groups.values()) {
    const clean = group.find((r) => r.condition === 'CLEAN');
    if (!clean) throw new Error(`profile ${group[0]?.profile} has no CLEAN extraction`);
    const reference = inputFor(clean, 'A');
    for (const row of group) {
      if (row === clean) continue;
      members.push({
        cell: `${row.extractor}|${variantLabel(row)}`,
        profile: `${row.jobId}|${row.profile}`,
        treated: inputFor(row, 'A'),
        reference,
      });
    }
    if (experiment.include_aa) {
      members.push({
        cell: `${clean.extractor}|AA`,
        profile: `${clean.jobId}|${clean.profile}`,
        treated: inputFor(clean, 'B'),
        reference,
      });
    }
  }

  const list = [...inputs.values()];
  const { min_repeats, max_repeats } = experiment.stopping;
  const typicalPerCall = (i: PlannedInput) =>
    costEur(prices, model.model_id, {
      inputTokens: Math.ceil(Buffer.byteLength(i.user, 'utf8') / 4),
      outputTokens: Math.min(300, model.max_tokens),
    });

  return {
    inputs: list,
    members,
    cells: [...new Set(members.map((m) => m.cell))].sort(),
    callsMin: list.length * min_repeats,
    callsMax: list.length * max_repeats,
    upperBoundEur: list.reduce((s, i) => s + i.worstCaseEur, 0) * max_repeats,
    typicalEur: list.reduce((s, i) => s + typicalPerCall(i), 0) * min_repeats,
    extractions: scoped.length,
  };
}
