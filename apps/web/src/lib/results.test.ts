import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fmt, fmtCi, headline, modelOrder, variantLabel, type Results } from './results.ts';

const sample = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/results.sample.json', import.meta.url)),
    'utf8',
  ),
) as Results;

describe('results helpers', () => {
  it('marks the fixture as sample data', () => {
    expect(sample.meta.sample).toBe(true);
  });

  it('headlines the largest pre-registered effect, with its noise floor', () => {
    const h = headline(sample);
    expect(h?.kind).toBe('effect');
    expect(h?.cell.model).toBe('model-a');
    expect(h?.cell.variant).toBe('DATA-WHITE'); // planted +8, the largest
    expect(h?.noiseFloor).not.toBeNull();
  });

  it('says "no effect" when nothing passes the effect rule', () => {
    const none: Results = { ...sample, cells: sample.cells.map((c) => ({ ...c, effect: false })) };
    expect(headline(none)?.kind).toBe('none');
  });

  it('formats signed numbers and intervals with a real minus sign', () => {
    expect(fmt(2.345)).toBe('+2.3');
    expect(fmt(-1.2)).toBe('−1.2');
    expect(fmt(null)).toBe('–');
    expect(fmtCi({ estimate: 1, ci_low: -0.5, ci_high: 2, p: 0.1 })).toBe('−0.5 to +2.0');
  });

  it('keeps model order stable and labels variants in plain words', () => {
    expect(modelOrder(sample)).toEqual(['model-a', 'model-b']);
    expect(variantLabel('DATA-WHITE')).toBe('Hidden keywords · white');
    expect(variantLabel('VIS_DATA')).toBe('Visible keywords');
  });
});
