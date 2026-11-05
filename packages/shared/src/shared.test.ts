import { describe, expect, it } from 'vitest';
import {
  costEur,
  inputsSha256,
  MissingPriceError,
  parseOutput,
  ScoreOutput,
  trialKey,
  worstCaseCostEur,
  type PricesConfig,
  type TrialKeyParts,
} from './index.ts';

describe('parseOutput', () => {
  it('accepts a valid answer', () => {
    const raw = '{"score": 72, "decision": "advance", "reason": "Good fit."}';
    expect(parseOutput(raw, ScoreOutput)).toEqual({
      score: 72,
      decision: 'advance',
      reason: 'Good fit.',
    });
  });

  it.each([
    ['not JSON', 'Score: 72'],
    ['score out of range', '{"score": 140, "decision": "advance", "reason": "x"}'],
    ['non-integer score', '{"score": 72.5, "decision": "advance", "reason": "x"}'],
    ['unknown decision', '{"score": 72, "decision": "maybe", "reason": "x"}'],
    ['extra field', '{"score": 72, "decision": "advance", "reason": "x", "note": "y"}'],
    [
      'reason too long',
      JSON.stringify({ score: 72, decision: 'advance', reason: 'x'.repeat(301) }),
    ],
  ])('returns null for %s (an unparseable outcome, not an exception)', (_, raw) => {
    expect(parseOutput(raw, ScoreOutput)).toBeNull();
  });
});

describe('trialKey', () => {
  const base: TrialKeyParts = {
    experimentId: 'exp',
    modelId: 'model-a',
    task: 'score',
    jobId: 'job@1',
    pool: 'single',
    repeatIndex: 0,
    promptVersion: 'screener.v1',
    inputsSha256: inputsSha256(['clean-text-hash']),
  };

  it('is stable for the same inputs', () => {
    expect(trialKey(base)).toBe(trialKey({ ...base }));
    expect(trialKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when only the CV text differs (SPEC 4.4, proposal #15)', () => {
    const injected = { ...base, inputsSha256: inputsSha256(['data-white-text-hash']) };
    expect(trialKey(injected)).not.toBe(trialKey(base));
  });

  it('differs for each field', () => {
    const variants: Partial<TrialKeyParts>[] = [
      { experimentId: 'exp2' },
      { modelId: 'model-b' },
      { task: 'rank' },
      { jobId: 'job@2' },
      { pool: '1-of-10' },
      { repeatIndex: 1 },
      { promptVersion: 'screener.v2' },
    ];
    const keys = new Set(variants.map((v) => trialKey({ ...base, ...v })));
    keys.add(trialKey(base));
    expect(keys.size).toBe(variants.length + 1);
  });

  it('cannot be fooled by moving a separator between fields', () => {
    const a = trialKey({ ...base, experimentId: 'a|b', modelId: 'c' });
    const b = trialKey({ ...base, experimentId: 'a', modelId: 'b|c' });
    expect(a).not.toBe(b);
  });

  it('depends on input order (canonical order is the caller’s job)', () => {
    expect(inputsSha256(['x', 'y'])).not.toBe(inputsSha256(['y', 'x']));
  });
});

describe('cost', () => {
  const prices: PricesConfig = {
    usd_to_eur: { rate: 0.5, date: '2026-11-05', source: 'test' },
    models: {
      paid: { input_usd_per_mtok: 2, output_usd_per_mtok: 10, date: '2026-11-05', source: 'test' },
      free: { input_usd_per_mtok: 0, output_usd_per_mtok: 0, date: '2026-11-05', source: 'test' },
    },
  };

  it('converts token usage to EUR', () => {
    // 1M input * $2 + 0.5M output * $10 = $7 -> EUR 3.5
    expect(costEur(prices, 'paid', { inputTokens: 1_000_000, outputTokens: 500_000 })).toBeCloseTo(
      3.5,
    );
  });

  it('bounds the worst case by prompt bytes and max_tokens', () => {
    // 1000 bytes * $2/M + 2000 tokens * $10/M = $0.022 -> EUR 0.011
    expect(worstCaseCostEur(prices, 'paid', 1000, 2000)).toBeCloseTo(0.011);
  });

  it('refuses a model without a price', () => {
    expect(() => costEur(prices, 'unknown', { inputTokens: 1, outputTokens: 1 })).toThrow(
      MissingPriceError,
    );
  });

  it('refuses a paid model when the exchange rate is missing, but not a free one', () => {
    const noRate = { ...prices, usd_to_eur: null };
    expect(() => costEur(noRate, 'paid', { inputTokens: 1, outputTokens: 1 })).toThrow(
      MissingPriceError,
    );
    expect(costEur(noRate, 'free', { inputTokens: 1, outputTokens: 1 })).toBe(0);
  });
});
