// Test helper: a scripted fetch, so adapter tests exercise the real SDKs (request
// serialisation, response parsing, error classes) without any network access.

export interface Scripted {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Recorded {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

export function scriptedFetch(...responses: Scripted[]) {
  const requests: Recorded[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    // Some SDKs pass a Request object, others a URL plus init.
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.text();
    requests.push({
      url: request.url,
      headers: request.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    });
    const next = responses.shift();
    if (!next) throw new Error('scriptedFetch: no response left');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

/** A fetch that fails like a dropped connection (no HTTP status). */
export const droppedConnection = (async () => {
  throw new TypeError('fetch failed');
}) as typeof fetch;
