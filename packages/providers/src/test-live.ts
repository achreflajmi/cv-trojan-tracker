// Shared by the *.live.test.ts files. Live tests cost money: they run only through
// `RUN_LIVE=1 pnpm test:live`, after the owner has confirmed a EUR budget.
import { expect } from 'vitest';
import {
  loadYaml,
  ModelsConfig,
  ProvidersConfig,
  ScoreOutput,
  scoreJsonSchema,
  type ModelEntry,
  type Provider,
} from '@ctt/shared';
import { createPolicyAdapter } from './index.ts';

const KEY_VAR = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
} as const;

/** true when this provider's live test must not run. */
export function skipLive(provider: keyof typeof KEY_VAR): boolean {
  return process.env.RUN_LIVE !== '1' || !process.env[KEY_VAR[provider]];
}

/**
 * The model to test: LIVE_<PROVIDER>_MODEL (a key in config/models.yaml) or, by
 * default, the first model of that provider in the file.
 */
function liveModel(provider: Provider): ModelEntry {
  const models = loadYaml('config/models.yaml', ModelsConfig).models;
  const wanted = process.env[`LIVE_${provider.toUpperCase()}_MODEL`];
  const model = models.find((m) => m.provider === provider && (!wanted || m.key === wanted));
  if (!model) throw new Error(`No ${provider} model ${wanted ?? ''} in config/models.yaml`);
  return model;
}

/** One trial through the full path: policy (retry + limit), adapter, zod validation. */
export async function oneLiveTrial(provider: Provider): Promise<void> {
  const model = liveModel(provider);
  const adapter = createPolicyAdapter(provider, loadYaml('config/providers.yaml', ProvidersConfig));
  const result = await adapter.call({
    modelId: model.model_id,
    system: 'Rate the candidate for the job. Answer with JSON only.',
    user: 'Job: barista. CV: 3 years as a barista.',
    jsonSchema: scoreJsonSchema,
    outputSchema: ScoreOutput,
    maxTokens: model.max_tokens,
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    settings: model.settings,
    idempotencyKey: `live-test-${provider}`,
  });
  // Printed so the owner can record the returned model ID and the token use.
  console.log(provider, {
    returnedModelId: result.returnedModelId,
    finishReason: result.finishReason,
    usage: result.usage,
  });
  expect(result.parsed).not.toBeNull();
  expect(result.returnedModelId).not.toBe('unknown');
  expect(result.usage.inputTokens).toBeGreaterThan(0);
  expect(result.usage.outputTokens).toBeLessThanOrEqual(model.max_tokens);
}
