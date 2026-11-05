import { describe, expect, it } from 'vitest';
import { ScoreOutput, scoreJsonSchema, type CallRequest } from '@ctt/shared';
import { OpenAIAdapter } from './openai.ts';
import { isRetryable } from './retry.ts';
import { droppedConnection, scriptedFetch } from './test-http.ts';

const ANSWER = '{"score": 61, "decision": "advance", "reason": "Meets most requirements."}';

const request = (over: Partial<CallRequest> = {}): CallRequest => ({
  modelId: 'gpt-test',
  system: 'You screen CVs.',
  user: 'Job: X. CV: Y.',
  jsonSchema: scoreJsonSchema,
  outputSchema: ScoreOutput,
  maxTokens: 512,
  settings: { reasoning_effort: 'none' },
  idempotencyKey: 'k1',
  ...over,
});

function response(over: Record<string, unknown> = {}, content?: unknown[]) {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-test-2026-10-01',
    output: [
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: content ?? [{ type: 'output_text', text: ANSWER, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 4 },
      total_tokens: 150,
    },
    incomplete_details: null,
    error: null,
    ...over,
  };
}

const adapter = (f: typeof fetch) => new OpenAIAdapter({ apiKey: 'test-key', fetch: f });

describe('OpenAIAdapter', () => {
  it('refuses to start without a key', () => {
    expect(() => new OpenAIAdapter({ apiKey: '' })).toThrow(/OPENAI_API_KEY/);
  });

  it('sends the schema as strict structured output, reasoning off, no temperature', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request());

    const [sent] = http.requests;
    expect(sent?.url).toMatch(/\/responses$/);
    expect(sent?.body).toMatchObject({
      model: 'gpt-test',
      instructions: 'You screen CVs.',
      input: 'Job: X. CV: Y.',
      max_output_tokens: 512,
      store: false,
      reasoning: { effort: 'none' },
      text: {
        format: { type: 'json_schema', name: 'answer', strict: true, schema: scoreJsonSchema },
      },
    });
    expect(sent?.body).not.toHaveProperty('temperature');
  });

  it('sends temperature only when configured, and no reasoning when unset', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request({ temperature: 0.2, settings: {} }));
    expect(http.requests[0]?.body).toMatchObject({ temperature: 0.2 });
    expect(http.requests[0]?.body).not.toHaveProperty('reasoning');
  });

  it('rejects unknown settings before calling the API', async () => {
    const http = scriptedFetch();
    await expect(
      adapter(http.fetch).call(request({ settings: { effort: 'low' } })),
    ).rejects.toThrow();
    expect(http.requests).toHaveLength(0);
  });

  it('maps answer, returned model ID, usage with reasoning tokens and finish reason', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({
      rawText: ANSWER,
      parsed: { score: 61, decision: 'advance' },
      returnedModelId: 'gpt-test-2026-10-01',
      usage: { inputTokens: 120, outputTokens: 30, thinkingTokens: 4 },
      finishReason: 'completed',
    });
  });

  it('stores a malformed answer with parsed = null instead of throwing', async () => {
    const content = [{ type: 'output_text', text: '{"score": 61, "decision":', annotations: [] }];
    const http = scriptedFetch({ status: 200, body: response({}, content) });
    const result = await adapter(http.fetch).call(request());
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('{"score": 61, "decision":');
  });

  it('records a refusal as an outcome', async () => {
    const content = [{ type: 'refusal', refusal: 'I cannot help with that.' }];
    const http = scriptedFetch({ status: 200, body: response({}, content) });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({
      rawText: 'I cannot help with that.',
      parsed: null,
      finishReason: 'refusal',
    });
  });

  it('reports a truncated answer by its incomplete reason', async () => {
    const http = scriptedFetch({
      status: 200,
      body: response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    });
    const result = await adapter(http.fetch).call(request());
    expect(result.finishReason).toBe('max_output_tokens');
  });

  it('throws HTTP errors with a numeric status (not billed) and keeps retry-after', async () => {
    const http = scriptedFetch({
      status: 429,
      body: { error: { message: 'Rate limit', type: 'rate_limit' } },
      headers: { 'retry-after': '2' },
    });
    const error: unknown = await adapter(http.fetch)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429 });
    expect(isRetryable(error)).toBe(true);
    expect((error as { headers: Headers }).headers.get('retry-after')).toBe('2');
  });

  it('throws a 400 as a non-retryable error with status', async () => {
    const http = scriptedFetch({ status: 400, body: { error: { message: 'bad schema' } } });
    const error: unknown = await adapter(http.fetch)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400 });
    expect(isRetryable(error)).toBe(false);
  });

  it('throws a dropped connection WITHOUT a status (possibly billed)', async () => {
    const error: unknown = await adapter(droppedConnection)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: unknown }).status).toBeUndefined();
  });
});
