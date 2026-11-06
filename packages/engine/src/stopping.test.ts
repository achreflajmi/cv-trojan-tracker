import { describe, expect, it } from 'vitest';
import {
  cellIntervals,
  cellState,
  inputsToContinue,
  tInterval,
  tQuantile975,
  type CellMember,
} from './stopping.ts';

describe('tQuantile975', () => {
  // Reference values from standard t tables (two-sided 95%).
  it.each([
    [1, 12.706],
    [4, 2.776],
    [5, 2.571],
    [10, 2.228],
    [30, 2.042],
    [60, 2.0],
    [120, 1.98],
  ])('df=%i -> %f', (df, expected) => {
    expect(tQuantile975(df)).toBeCloseTo(expected, 2);
  });

  it('approaches the normal quantile for large df', () => {
    expect(tQuantile975(100_000)).toBeCloseTo(1.96, 3);
  });
});

describe('tInterval', () => {
  it('computes mean and half-width by hand', () => {
    // diffs 1,2,3: mean 2, sd 1, n 3 -> half-width = 4.3027 * 1 / sqrt(3) = 2.4842
    const i = tInterval([1, 2, 3]);
    expect(i.mean).toBe(2);
    expect(i.halfWidth).toBeCloseTo(2.4842, 3);
  });

  it('is infinitely wide with fewer than two points', () => {
    expect(tInterval([5]).halfWidth).toBe(Infinity);
    expect(tInterval([]).halfWidth).toBe(Infinity);
  });

  it('is zero-width when every difference is identical', () => {
    expect(tInterval([0, 0, 0, 0]).halfWidth).toBe(0);
  });
});

describe('cellIntervals', () => {
  const members: CellMember[] = [
    { cell: 'DATA', profile: 'p1', treated: 'p1-data', reference: 'p1-clean' },
    { cell: 'DATA', profile: 'p2', treated: 'p2-data', reference: 'p2-clean' },
    { cell: 'DATA', profile: 'p3', treated: 'p3-data', reference: 'p3-clean' },
  ];

  it('averages repeats within a profile before pairing (not by repeat index)', () => {
    const scores = new Map([
      ['p1-data', [60, 70]], // mean 65
      ['p1-clean', [50]], //    mean 50 -> +15
      ['p2-data', [40]],
      ['p2-clean', [40, 40, 40]], // 0
      ['p3-data', [55]],
      ['p3-clean', [50]], // +5
    ]);
    const i = cellIntervals(members, scores).get('DATA');
    expect(i?.n).toBe(3);
    expect(i?.mean).toBeCloseTo(20 / 3);
  });

  it('skips a profile with no valid score on one side (e.g. all unparseable)', () => {
    const scores = new Map([
      ['p1-data', [60]],
      ['p1-clean', [50]],
      ['p2-data', []],
      ['p2-clean', [40]],
    ]);
    expect(cellIntervals(members, scores).get('DATA')?.n).toBe(1);
  });
});

describe('stopping decision', () => {
  const rule = { min_repeats: 3, max_repeats: 10, target_half_width: 4 };

  it('never stops before min_repeats, even when precise', () => {
    expect(cellState({ n: 50, mean: 1, halfWidth: 0.5 }, 2, rule)).toBe('sampling');
  });

  it('stops when precise after min_repeats', () => {
    expect(cellState({ n: 50, mean: 1, halfWidth: 3.9 }, 3, rule)).toBe('precise');
    expect(cellState({ n: 50, mean: 1, halfWidth: 4.1 }, 3, rule)).toBe('sampling');
  });

  it('stops at the cap however wide the interval is', () => {
    expect(cellState({ n: 50, mean: 1, halfWidth: 40 }, 10, rule)).toBe('cap');
  });

  it('continues both sides of sampling cells only', () => {
    const members: CellMember[] = [
      { cell: 'A', profile: 'p', treated: 'a', reference: 'clean' },
      { cell: 'B', profile: 'p', treated: 'b', reference: 'clean' },
    ];
    const keep = inputsToContinue(
      members,
      new Map([
        ['A', 'sampling'],
        ['B', 'precise'],
      ]),
    );
    expect([...keep].sort()).toEqual(['a', 'clean']);
  });
});
