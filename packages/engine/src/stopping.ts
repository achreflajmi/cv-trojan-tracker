/**
 * Sequential stopping (SPEC 3.7, proposals #1 and #8). Pure functions: no database.
 *
 * A cell is (extractor x variant), e.g. "pdfjs|DATA-WHITE", for one model and task.
 * Its effect is the score lift: for each profile, the mean score of the injected CV
 * minus the mean score of the CLEAN CV (repeats averaged within the profile first,
 * then paired by profile). The stopping rule uses a 95% t-interval of those
 * per-profile differences. The reported CIs come from the Python bootstrap (Stage 6).
 */

const Z_975 = 1.959963984540054;
/** Exact two-sided 95% t critical values for very small df, where the series is poor. */
const T_975_SMALL: Record<number, number> = { 1: 12.7062, 2: 4.3027, 3: 3.1824, 4: 2.7764 };

/** 97.5% quantile of Student's t with `df` degrees of freedom (Cornish-Fisher, A&S 26.7.5). */
export function tQuantile975(df: number): number {
  if (!Number.isInteger(df) || df < 1) throw new Error(`df must be a positive integer, got ${df}`);
  const small = T_975_SMALL[df];
  if (small !== undefined) return small;
  const z = Z_975;
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160;
  return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
}

export interface Interval {
  n: number;
  mean: number;
  halfWidth: number;
}

/** Mean and 95% t-interval half-width of paired differences. Infinite with fewer than 2. */
export function tInterval(diffs: readonly number[]): Interval {
  const n = diffs.length;
  if (n === 0) return { n, mean: Number.NaN, halfWidth: Number.POSITIVE_INFINITY };
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, halfWidth: Number.POSITIVE_INFINITY };
  const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1);
  return { n, mean, halfWidth: (tQuantile975(n - 1) * Math.sqrt(variance)) / Math.sqrt(n) };
}

const average = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One profile's view of one cell: which model inputs give its two sides. */
export interface CellMember {
  cell: string;
  profile: string;
  /** Input whose scores form the "injected" side (or arm B for the A/A cell). */
  treated: string;
  /** Input whose scores form the reference side (CLEAN, arm A). */
  reference: string;
}

/**
 * Per-cell intervals from valid scores per input. Unparseable answers are not scores;
 * they are counted elsewhere. A profile with no valid score on either side is skipped.
 */
export function cellIntervals(
  members: readonly CellMember[],
  scores: ReadonlyMap<string, readonly number[]>,
): Map<string, Interval> {
  const diffs = new Map<string, number[]>();
  for (const m of members) {
    const treated = scores.get(m.treated) ?? [];
    const reference = scores.get(m.reference) ?? [];
    const list = diffs.get(m.cell) ?? [];
    if (treated.length > 0 && reference.length > 0)
      list.push(average(treated) - average(reference));
    diffs.set(m.cell, list);
  }
  return new Map([...diffs].map(([cell, d]) => [cell, tInterval(d)]));
}

export interface StoppingRule {
  min_repeats: number;
  max_repeats: number;
  target_half_width: number;
}

export type CellState = 'sampling' | 'precise' | 'cap';

/** After `repeatsDone` full repeats: is the cell finished, and why? */
export function cellState(interval: Interval, repeatsDone: number, rule: StoppingRule): CellState {
  if (repeatsDone >= rule.max_repeats) return 'cap';
  if (repeatsDone >= rule.min_repeats && interval.halfWidth <= rule.target_half_width)
    return 'precise';
  return 'sampling';
}

/** Inputs that still need another repeat: both sides of every cell still sampling. */
export function inputsToContinue(
  members: readonly CellMember[],
  states: ReadonlyMap<string, CellState>,
): Set<string> {
  const keep = new Set<string>();
  for (const m of members) {
    if (states.get(m.cell) === 'sampling') {
      keep.add(m.treated);
      keep.add(m.reference);
    }
  }
  return keep;
}
