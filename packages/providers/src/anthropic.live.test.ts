import { describe, expect, it } from 'vitest';
import { findModel, loadYaml, ModelsConfig, ScoreOutput, scoreJsonSchema } from '@ctt/shared';
import { AnthropicAdapter } from './anthropic.ts';

// Costs money. Runs only with RUN_LIVE=1 and LIVE_ANTHROPIC_MODEL=<key in config/models.yaml>,
// after the owner has confirmed a budget.
const modelKey = process.env.LIVE_ANTHROPIC_MODEL;

describe.skipIf(process.env.RUN_LIVE !== '1' || !modelKey)('Anthropic adapter (live)', () => {
  it('returns a schema-valid score', async () => {
    const model = findModel(loadYaml('config/models.yaml', ModelsConfig), modelKey ?? '');
    const result = await new AnthropicAdapter().call({
      modelId: model.model_id,
      system: 'Rate the candidate. Answer with JSON only.',
      user: 'Job: barista. CV: 3 years as a barista.',
      jsonSchema: scoreJsonSchema,
      outputSchema: ScoreOutput,
      maxTokens: model.max_tokens,
      settings: model.settings,
      idempotencyKey: 'live-test',
    });
    expect(result.parsed).not.toBeNull();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });
});
