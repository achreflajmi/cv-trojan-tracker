import type { ProviderPolicy } from '@ctt/shared';
import { httpStatus, retryAfterMs } from './errors.ts';

export type RetryPolicy = ProviderPolicy['retry'];

export interface RetryDeps {
  /** Injected so tests can use fake timers; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** In [0, 1); injected so tests are deterministic. */
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

/**
 * Only 429 (rate limited) and 5xx (server error) are retried. Both are answered
 * requests that providers do not bill, so a retry cannot pay twice. Everything else
 * is final:
 * - other 4xx: the request itself is wrong; repeating it gives the same answer;
 * - no status (dropped connection, timeout): the first attempt may have been billed;
 * - an unparseable answer is not an error at all: it is an outcome (parsed = null).
 */
export function isRetryable(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

/** "Full jitter" exponential backoff: uniform in [0, min(max, base * 2^(attempt-1))). */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const cap = Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (attempt - 1));
  return Math.floor(random() * cap);
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  { sleep = defaultSleep, random = Math.random, onRetry }: RetryDeps = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!isRetryable(error) || attempt >= policy.max_attempts) throw error;
      // The server's own estimate wins over our backoff when it is longer. If it asks
      // for more than our ceiling, give up now instead of holding a worker for minutes.
      const asked = retryAfterMs(error);
      if (asked !== undefined && asked > policy.max_delay_ms) throw error;
      const delayMs = Math.max(asked ?? 0, backoffMs(attempt, policy, random));
      onRetry?.({ attempt, delayMs, status: httpStatus(error) ?? 0 });
      await sleep(delayMs);
    }
  }
}
