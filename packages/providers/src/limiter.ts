import type { ModelAdapter, ProviderPolicy } from '@ctt/shared';
import { withRetry, type RetryDeps } from './retry.ts';

/**
 * At most `max` tasks run at once; the rest wait in FIFO order. In-process only:
 * two processes each get their own limit (Stage 5 sizes workers with that in mind).
 */
export class Limiter {
  readonly max: number;
  #active = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`Invalid concurrency limit: ${max}`);
    this.max = max;
  }

  get active(): number {
    return this.#active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.max) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#active++;
    }
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter (the count stays the same), so a
      // newcomer can never jump the queue between release and wake-up.
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }
}

/**
 * Wraps an adapter with its provider's policy from config/providers.yaml: a
 * concurrency limit and the retry rules. A slot is held during backoff, so a provider
 * that rate-limits us also gets fewer concurrent requests until it recovers.
 */
export function withPolicy(
  adapter: ModelAdapter,
  policy: ProviderPolicy,
  deps: RetryDeps = {},
): ModelAdapter {
  const limiter = new Limiter(policy.max_concurrency);
  return {
    provider: adapter.provider,
    call: (req) => limiter.run(() => withRetry(() => adapter.call(req), policy.retry, deps)),
  };
}
