import { describe, expect, it } from 'vitest';
import { ModelsConfig, ScoreOutput, scoreJsonSchema, type CallRequest } from '@ctt/shared';
import { OpenRouterAdapter } from './openrouter.ts';
import { isRetryable } from './retry.ts';
import { droppedConnection, scriptedFetch } from './test-http.ts';

const ANSWER = '{"score": 58, "decision": "reject", "reason": "Partial match."}';

const request = (over: Partial<CallRequest> = {}): CallRequest => ({
  modelId: 'vendor/open-model',
  system: 'You screen CVs.',
  user: 'Job: X. CV: Y.',
  jsonSchema: scoreJsonSchema,
  outputSchema: ScoreOutput,
  maxTokens: 512,
  settings: { provider: 'vendor/zdr', reasoning_effort: 'low' },
  idempotencyKey: 'k1',
  ...over,
});

function response(message: Record<string, unknown> = {}, finishReason = 'stop') {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    created: 1,
    model: 'vendor/open-model-20261006',
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: 'assistant', content: ANSWER, refusal: null, ...message },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      completion_tokens_details: { reasoning_tokens: 25 },
    },
  };
}

const adapter = (f: typeof fetch) => new OpenRouterAdapter({ apiKey: 'test-key', fetch: f });

describe('OpenRouterAdapter', () => {
  it('refuses to start without a key', () => {
    expect(() => new OpenRouterAdapter({ apiKey: '' })).toThrow(/OPENROUTER_API_KEY/);
  });

  it('pins one upstream endpoint with fallbacks off and sends the schema', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request());

    const [sent] = http.requests;
    expect(sent?.url).toMatch(/\/chat\/completions$/);
    expect(sent?.body).toMatchObject({
      model: 'vendor/open-model',
      messages: [
        { role: 'system', content: 'You screen CVs.' },
        { role: 'user', content: 'Job: X. CV: Y.' },
      ],
      max_tokens: 512,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true, schema: scoreJsonSchema },
      },
      provider: {
        order: ['vendor/zdr'],
        only: ['vendor/zdr'],
        allow_fallbacks: false,
        require_parameters: true,
      },
      reasoning: { effort: 'low' },
      stream: false,
    });
    expect(sent?.body).not.toHaveProperty('temperature');
  });

  it('sends temperature only when configured', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request({ temperature: 0.7 }));
    expect(http.requests[0]?.body).toMatchObject({ temperature: 0.7 });
  });

  it('requires a pinned provider and refuses variant model IDs such as :free', async () => {
    const http = scriptedFetch();
    const a = adapter(http.fetch);
    await expect(a.call(request({ settings: {} }))).rejects.toThrow();
    await expect(a.call(request({ modelId: 'vendor/open-model:free' }))).rejects.toThrow(/variant/);
    expect(http.requests).toHaveLength(0);
  });

  it('refuses :free variants already when config/models.yaml is loaded', () => {
    const entry = { key: 'x', provider: 'openrouter', model_id: 'a/b:free', max_tokens: 10 };
    expect(ModelsConfig.safeParse({ models: [entry] }).success).toBe(false);
  });

  it('maps answer, returned model ID, usage with reasoning tokens and finish reason', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({
      rawText: ANSWER,
      parsed: { score: 58, decision: 'reject' },
      returnedModelId: 'vendor/open-model-20261006',
      usage: { inputTokens: 100, outputTokens: 40, thinkingTokens: 25 },
      finishReason: 'stop',
    });
  });

  it('stores a malformed answer with parsed = null instead of throwing', async () => {
    const http = scriptedFetch({ status: 200, body: response({ content: '```json\n{}' }) });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({ rawText: '```json\n{}', parsed: null });
  });

  it('records refusals and content filtering as outcomes', async () => {
    const http = scriptedFetch(
      { status: 200, body: response({ content: null, refusal: 'Not able to rate this.' }) },
      { status: 200, body: response({ content: '' }, 'content_filter') },
    );
    const a = adapter(http.fetch);
    expect(await a.call(request())).toMatchObject({
      rawText: 'Not able to rate this.',
      parsed: null,
      finishReason: 'refusal',
    });
    expect(await a.call(request())).toMatchObject({ parsed: null, finishReason: 'content_filter' });
  });

  it.each([
    [429, true],
    [502, true],
    [402, false],
  ])(
    'throws HTTP %i as an error with a numeric status (retryable: %s)',
    async (status, retryable) => {
      const http = scriptedFetch({
        status,
        body: { error: { code: status, message: 'x' } },
        headers: { 'retry-after': '3' },
      });
      const error: unknown = await adapter(http.fetch)
        .call(request())
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status, name: 'ProviderHttpError' });
      expect(isRetryable(error)).toBe(retryable);
      expect((error as { headers: Headers }).headers.get('retry-after')).toBe('3');
      expect(http.requests).toHaveLength(1);
    },
  );

  it('throws a dropped connection WITHOUT a status (possibly billed)', async () => {
    const error: unknown = await adapter(droppedConnection)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: unknown }).status).toBeUndefined();
  });
});
