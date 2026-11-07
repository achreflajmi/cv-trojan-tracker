import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderHttpError, retryAfterMs } from './errors.ts';
import { backoffMs, isRetryable, withRetry, type RetryPolicy } from './retry.ts';

const policy: RetryPolicy = { max_attempts: 4, base_delay_ms: 1000, max_delay_ms: 10_000 };
const http = (status: number, headers?: Record<string, string>) =>
  new ProviderHttpError(status, `HTTP ${status}`, headers ? new Headers(headers) : undefined);

/** fn that fails with the given errors in order, then succeeds. */
function failing(...errors: unknown[]) {
  return vi.fn(async (attempt: number) => {
    const error = errors[attempt - 1];
    if (error !== undefined) throw error;
    return `ok after ${attempt}`;
  });
}

describe('isRetryable', () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [529, true],
    [400, false],
    [401, false],
    [402, false],
    [404, false],
    [408, false],
    [409, false],
    [422, false],
  ])('HTTP %i -> %s', (status, expected) => {
    expect(isRetryable(http(status))).toBe(expected);
  });

  it('never retries an error without a status (dropped connection may be billed)', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(false);
    expect(isRetryable(new Error('timeout'))).toBe(false);
  });
});

describe('backoffMs', () => {
  it('doubles the ceiling per attempt, capped at max_delay_ms, with full jitter', () => {
    const top = () => 0.999999;
    expect(backoffMs(1, policy, top)).toBe(999);
    expect(backoffMs(2, policy, top)).toBe(1999);
    expect(backoffMs(3, policy, top)).toBe(3999);
    expect(backoffMs(5, policy, top)).toBe(9999); // 16 s capped to 10 s
    expect(backoffMs(3, policy, () => 0)).toBe(0);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds, milliseconds and HTTP dates', () => {
    expect(retryAfterMs(http(429, { 'retry-after': '3' }))).toBe(3000);
    expect(retryAfterMs(http(429, { 'retry-after-ms': '250', 'retry-after': '3' }))).toBe(250);
    const now = Date.parse('2026-11-05T10:00:00Z');
    expect(retryAfterMs(http(429, { 'retry-after': 'Thu, 05 Nov 2026 10:00:07 GMT' }), now)).toBe(
      7000,
    );
    expect(retryAfterMs(http(429))).toBeUndefined();
    expect(retryAfterMs(http(429, { 'retry-after': 'soon' }))).toBeUndefined();
  });
});

describe('withRetry (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 429 and 5xx with backoff, then returns the answer', async () => {
    const fn = failing(http(429), http(503));
    const delays: number[] = [];
    const done = withRetry(fn, policy, {
      random: () => 0.5,
      onRetry: ({ delayMs }) => delays.push(delayMs),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499); // first backoff is 0.5 * 1000 ms
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000); // second backoff is 0.5 * 2000 ms
    await expect(done).resolves.toBe('ok after 3');
    expect(delays).toEqual([500, 1000]);
  });

  it('waits at least as long as retry-after asks', async () => {
    const fn = failing(http(429, { 'retry-after': '5' }));
    const done = withRetry(fn, policy, { random: () => 0 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe('ok after 2');
  });

  it('gives up at once when retry-after exceeds max_delay_ms', async () => {
    const error = http(429, { 'retry-after': '60' });
    const fn = failing(error);
    await expect(withRetry(fn, policy)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops after max_attempts and rethrows the last error', async () => {
    const last = http(500);
    const fn = failing(http(500), http(500), http(500), last);
    const done = withRetry(fn, policy, { random: () => 0.1 });
    const settled = expect(done).rejects.toBe(last);
    await vi.runAllTimersAsync();
    await settled;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['HTTP 400', http(400)],
    ['HTTP 401', http(401)],
    ['a dropped connection', new TypeError('fetch failed')],
  ])('never retries %s', async (_, error) => {
    const fn = failing(error);
    await expect(withRetry(fn, policy)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never retries an unparseable answer (it is a result, not an error)', async () => {
    const fn = vi.fn(async () => ({ rawText: 'not json', parsed: null }));
    await expect(withRetry(fn, policy)).resolves.toEqual({ rawText: 'not json', parsed: null });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('max_attempts 1 means no retry at all', async () => {
    const error = http(429);
    const fn = failing(error);
    await expect(withRetry(fn, { ...policy, max_attempts: 1 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
