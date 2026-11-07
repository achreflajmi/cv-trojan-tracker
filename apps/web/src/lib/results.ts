// Types and pure helpers for results.json (written by analysis/ `ctt-analyze`).
// Pure functions only: the page reads the file at build time and passes it in.

export interface Interval {
  n_profiles?: number;
  estimate: number | null;
  ci_low: number | null;
  ci_high: number | null;
  p: number | null;
}

export interface Cell {
  model: string;
  extractor: string;
  variant: string;
  condition: string;
  hiding_method: string | null;
  score_lift: Record<string, Interval>;
  advance_lift: Record<string, Interval>;
  unparseable_rate: number | null;
  p_bh: number | null;
  effect: boolean;
}

export interface AaCell {
  model: string;
  extractor: string;
  score: Record<string, Interval>;
}

export interface RankCell {
  model: string;
  extractor: string;
  variant: string;
  k: number;
  n_pools: number;
  rank_lift: Interval;
  top3_lift: Interval;
  effect: boolean;
}

export interface SurvivalRow {
  condition: string;
  hiding_method: string;
  extractor: string;
  n: number;
  survival_rate: number | null;
}

export interface Results {
  settings: {
    resamples: number;
    seed: number;
    fdr: number;
    sesoi_points: number;
    primary_bands: string[];
  };
  cells: Cell[];
  aa: AaCell[];
  rank_cells: RankCell[];
  survival: SurvivalRow[];
  meta: {
    sample?: boolean;
    experiment: string;
    exported_at: string;
    prereg_commit?: string | null;
    note?: string;
    survival_is_measured?: boolean;
  };
}

export const PRIMARY = 'primary';

export interface Headline {
  kind: 'effect' | 'none';
  cell: Cell;
  interval: Interval;
  noiseFloor: Interval | null;
}

/**
 * The headline (SPEC 9): the largest pre-registered effect, or, if none passes the
 * effect rule, the largest observed lift, stated as "no effect".
 */
export function headline(r: Results): Headline | null {
  const scored = r.cells.filter(
    (c) => c.score_lift[PRIMARY]?.estimate !== null && c.score_lift[PRIMARY] !== undefined,
  );
  if (scored.length === 0) return null;
  const size = (c: Cell) => Math.abs(c.score_lift[PRIMARY]?.estimate ?? 0);
  const effects = scored.filter((c) => c.effect);
  const pool = effects.length > 0 ? effects : scored;
  const cell = [...pool].sort((a, b) => size(b) - size(a))[0];
  if (!cell) return null;
  const aa = r.aa.find((a) => a.model === cell.model && a.extractor === cell.extractor);
  return {
    kind: effects.length > 0 ? 'effect' : 'none',
    cell,
    interval: cell.score_lift[PRIMARY] as Interval,
    noiseFloor: aa?.score[PRIMARY] ?? null,
  };
}

export function fmt(x: number | null | undefined, digits = 1, signed = true): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  const s = x.toFixed(digits);
  return signed && x > 0 ? `+${s}` : s.replace('-', '−');
}

export function fmtCi(i: Interval | null | undefined, digits = 1): string {
  if (!i || i.ci_low === null || i.ci_high === null) return '–';
  return `${fmt(i.ci_low, digits)} to ${fmt(i.ci_high, digits)}`;
}

/** Models in a fixed order (alphabetical) so a model keeps its color everywhere. */
export function modelOrder(r: Results): string[] {
  return [...new Set(r.cells.map((c) => c.model))].sort();
}

export function variantLabel(variant: string): string {
  const [condition, method] = variant.split('-');
  const names: Record<string, string> = {
    DATA: 'Hidden keywords',
    INSTR: 'Hidden instruction',
    HIDDEN_NEUTRAL: 'Hidden neutral text',
    VIS_DATA: 'Visible keywords',
    VIS_INSTR: 'Visible instruction',
  };
  const base = names[condition ?? ''] ?? condition ?? variant;
  return method ? `${base} · ${method.toLowerCase().replace('_', ' ')}` : base;
}
