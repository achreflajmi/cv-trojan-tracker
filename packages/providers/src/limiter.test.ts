import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreOutput, scoreJsonSchema, type CallRequest, type ProviderPolicy } from '@ctt/shared';
import { ProviderHttpError } from './errors.ts';
import { FakeAdapter } from './fake.ts';
import { Limiter, withPolicy } from './limiter.ts';

/** A promise plus its resolver, to finish tasks in a chosen order. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Limiter', () => {
  it('never runs more than max tasks at once, and starts waiters in FIFO order', async () => {
    const limiter = new Limiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let peak = 0;

    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i);
        peak = Math.max(peak, limiter.active);
        await gate.promise;
        return i;
      }),
    );

    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[0]?.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    gates[2]?.resolve();
    gates[3]?.resolve();

    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
    expect(limiter.active).toBe(0);
  });

  it('frees the slot when a task throws', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(() => Promise.resolve('next'))).resolves.toBe('next');
    expect(limiter.active).toBe(0);
  });

  it('rejects a nonsensical limit', () => {
    expect(() => new Limiter(0)).toThrow();
    expect(() => new Limiter(1.5)).toThrow();
  });
});

describe('withPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const policy: ProviderPolicy = {
    max_concurrency: 2,
    retry: { max_attempts: 3, base_delay_ms: 100, max_delay_ms: 1000 },
  };
  const req: CallRequest = {
    modelId: 'fake-scripted-1',
    system: 's',
    user: 'u',
    jsonSchema: scoreJsonSchema,
    outputSchema: ScoreOutput,
    maxTokens: 10,
    settings: {},
    idempotencyKey: 'k',
  };

  it('retries a 429 from the provider and limits concurrency across calls', async () => {
    const fake = new FakeAdapter();
    let inFlight = 0;
    let peak = 0;
    let first = true;
    const flaky = {
      provider: fake.provider,
      call: async (r: CallRequest) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        if (first) {
          first = false;
          throw new ProviderHttpError(429, 'slow down');
        }
        return fake.call(r);
      },
    };
    const adapter = withPolicy(flaky, policy, { random: () => 0.5 });

    const calls = Promise.all([1, 2, 3, 4, 5].map(() => adapter.call(req)));
    await vi.runAllTimersAsync();
    const results = await calls;

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.parsed !== null)).toBe(true);
    expect(fake.calls).toHaveLength(5); // 6 attempts, 5 answers
    expect(peak).toBe(2);
  });
});
