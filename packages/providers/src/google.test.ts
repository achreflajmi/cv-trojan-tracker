import { describe, expect, it } from 'vitest';
import { ScoreOutput, scoreJsonSchema, type CallRequest } from '@ctt/shared';
import { GoogleAdapter } from './google.ts';
import { isRetryable } from './retry.ts';
import { droppedConnection, scriptedFetch } from './test-http.ts';

const ANSWER = '{"score": 44, "decision": "reject", "reason": "Too little experience."}';

const request = (over: Partial<CallRequest> = {}): CallRequest => ({
  modelId: 'gemini-test',
  system: 'You screen CVs.',
  user: 'Job: X. CV: Y.',
  jsonSchema: scoreJsonSchema,
  outputSchema: ScoreOutput,
  maxTokens: 512,
  settings: { thinking_level: 'low' },
  idempotencyKey: 'k1',
  ...over,
});

function response(text = ANSWER, over: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 12,
      totalTokenCount: 132,
    },
    modelVersion: 'gemini-test-001',
    responseId: 'r1',
    ...over,
  };
}

const adapter = (f: typeof fetch) => new GoogleAdapter({ apiKey: 'test-key', fetch: f });

describe('GoogleAdapter', () => {
  it('refuses to start without a key', () => {
    expect(() => new GoogleAdapter({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
  });

  it('sends the JSON schema, system prompt, token cap and thinking level; no temperature', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request());

    const [sent] = http.requests;
    expect(sent?.url).toContain('models/gemini-test:generateContent');
    expect(sent?.body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'Job: X. CV: Y.' }] }],
      systemInstruction: { parts: [{ text: 'You screen CVs.' }] },
      generationConfig: {
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseJsonSchema: scoreJsonSchema,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    });
    expect(sent?.body.generationConfig).not.toHaveProperty('temperature');
  });

  it('sends temperature only when configured; a thinking budget for older models', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    await adapter(http.fetch).call(request({ temperature: 0, settings: { thinking_budget: 0 } }));
    expect(http.requests[0]?.body.generationConfig).toMatchObject({
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('rejects contradictory or unknown settings before calling the API', async () => {
    const http = scriptedFetch();
    const a = adapter(http.fetch);
    await expect(
      a.call(request({ settings: { thinking_level: 'low', thinking_budget: 0 } })),
    ).rejects.toThrow();
    await expect(a.call(request({ settings: { reasoning_effort: 'none' } }))).rejects.toThrow();
    expect(http.requests).toHaveLength(0);
  });

  it('maps answer, model version, and bills thinking tokens as output', async () => {
    const http = scriptedFetch({ status: 200, body: response() });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({
      rawText: ANSWER,
      parsed: { score: 44, decision: 'reject' },
      returnedModelId: 'gemini-test-001',
      // 20 answer tokens + 12 thinking tokens, both billed at the output price.
      usage: { inputTokens: 100, outputTokens: 32, thinkingTokens: 12 },
      finishReason: 'STOP',
    });
  });

  it('stores a malformed answer with parsed = null instead of throwing', async () => {
    const http = scriptedFetch({ status: 200, body: response('Score: 44') });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({ rawText: 'Score: 44', parsed: null });
  });

  it('records a blocked prompt as an outcome', async () => {
    const http = scriptedFetch({
      status: 200,
      body: {
        promptFeedback: { blockReason: 'SAFETY' },
        usageMetadata: { promptTokenCount: 100, totalTokenCount: 100 },
        modelVersion: 'gemini-test-001',
      },
    });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({
      rawText: '',
      parsed: null,
      finishReason: 'blocked:SAFETY',
      usage: { inputTokens: 100, outputTokens: 0 },
    });
  });

  it('records a safety stop of the answer by its finish reason', async () => {
    const body = {
      ...response(''),
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'SAFETY', index: 0 }],
    };
    const http = scriptedFetch({ status: 200, body });
    const result = await adapter(http.fetch).call(request());
    expect(result).toMatchObject({ parsed: null, finishReason: 'SAFETY' });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
  ])('throws HTTP %i with a numeric status (retryable: %s), once', async (status, retryable) => {
    const http = scriptedFetch(
      { status, body: { error: { code: status, message: 'x', status: 'ERR' } } },
      { status: 200, body: response() },
    );
    const error: unknown = await adapter(http.fetch)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status });
    expect(isRetryable(error)).toBe(retryable);
    expect(http.requests).toHaveLength(1); // no SDK-internal retry
  });

  it('throws a dropped connection WITHOUT a status (possibly billed)', async () => {
    const error: unknown = await adapter(droppedConnection)
      .call(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: unknown }).status).toBeUndefined();
  });
});
