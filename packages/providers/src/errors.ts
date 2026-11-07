/**
 * An HTTP error response from a provider, with a numeric `status`.
 *
 * The engine relies on that field (execute.ts, D-029): an error WITH a status is an
 * answered request that was not billed, so its budget reservation is released; an error
 * WITHOUT one (dropped connection, timeout) may have been billed and is kept as spent.
 * Use it only for status >= 400: a 200 whose body the SDK could not read was billed.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly headers: Headers | undefined;

  constructor(status: number, message: string, headers?: Headers, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.headers = headers;
  }
}

/**
 * A successful answer must report token usage, or its cost is unknown. Throwing an
 * error WITHOUT a status keeps the call's reservation as possibly spent, which is the
 * safe side: the budget may over-count, never under-count.
 */
export function requireUsage<T>(usage: T | null | undefined, provider: string): T {
  if (usage === null || usage === undefined) {
    throw new Error(`${provider} answered without token usage; the cost cannot be settled`);
  }
  return usage;
}

/** The numeric HTTP status of an error, if it has one (SDK errors and ProviderHttpError). */
export function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Milliseconds the server asked us to wait, from `retry-after-ms` or `retry-after`
 * (seconds or an HTTP date). undefined when absent or unreadable.
 */
export function retryAfterMs(error: unknown, now: number = Date.now()): number | undefined {
  const raw = (error as { headers?: unknown } | null)?.headers;
  const get = (name: string): string | null | undefined => {
    if (raw instanceof Headers) return raw.get(name);
    if (raw && typeof raw === 'object') {
      const value = (raw as Record<string, unknown>)[name];
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  };

  const msHeader = get('retry-after-ms');
  if (msHeader) {
    const ms = Number(msHeader);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }

  const header = get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
