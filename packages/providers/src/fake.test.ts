import { describe, expect, it } from 'vitest';
import { ScoreOutput, scoreJsonSchema, type CallRequest } from '@ctt/shared';
import { FakeAdapter } from './fake.ts';

const req: CallRequest = {
  modelId: 'fake-scripted-1',
  system: 'system',
  user: 'user',
  jsonSchema: scoreJsonSchema,
  outputSchema: ScoreOutput,
  maxTokens: 100,
  settings: {},
  idempotencyKey: 'k',
};

describe('FakeAdapter', () => {
  it('returns scripted answers in order and records requests', async () => {
    const answers = [
      '{"score": 40, "decision": "reject", "reason": "a"}',
      '{"score": 80, "decision": "advance", "reason": "b"}',
    ];
    const fake = new FakeAdapter((_, n) => answers[n] ?? '');
    expect((await fake.call(req)).parsed).toMatchObject({ score: 40 });
    expect((await fake.call(req)).parsed).toMatchObject({ score: 80 });
    expect(fake.calls).toHaveLength(2);
  });

  it('reports a malformed answer as parsed = null, keeping the raw text', async () => {
    const fake = new FakeAdapter(() => 'I think this candidate is great!');
    const result = await fake.call(req);
    expect(result.parsed).toBeNull();
    expect(result.rawText).toBe('I think this candidate is great!');
  });
});
