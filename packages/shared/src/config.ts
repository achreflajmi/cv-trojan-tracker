import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const ModelEntry = z
  .strictObject({
    key: z.string().min(1),
    provider: z.enum(['anthropic', 'openai', 'google', 'openrouter', 'fake']),
    model_id: z.string().min(1),
    max_tokens: z.number().int().positive(),
    temperature: z.number().optional(),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  // OpenRouter variants (":free", ":nitro", ...) change routing or pricing between calls.
  .refine((m) => m.provider !== 'openrouter' || !m.model_id.includes(':'), {
    message: 'OpenRouter models must use the plain model ID, without a ":variant" suffix',
    path: ['model_id'],
  });
export type ModelEntry = z.infer<typeof ModelEntry>;

export const ModelsConfig = z.strictObject({ models: z.array(ModelEntry) });
export type ModelsConfig = z.infer<typeof ModelsConfig>;

const dated = { date: z.iso.date(), source: z.string().min(1) };

export const PricesConfig = z.strictObject({
  usd_to_eur: z.strictObject({ rate: z.number().positive(), ...dated }).nullable(),
  models: z.record(
    z.string(),
    z.strictObject({
      input_usd_per_mtok: z.number().nonnegative(),
      output_usd_per_mtok: z.number().nonnegative(),
      /** Prices only apply up to this prompt size; larger prompts are refused. */
      max_prompt_tokens: z.number().int().positive().optional(),
      /** Last UTC day the price applies (promotional prices); later calls are refused. */
      valid_until: z.iso.date().optional(),
      ...dated,
    }),
  ),
});
export type PricesConfig = z.infer<typeof PricesConfig>;

const ProviderPolicy = z.strictObject({
  /** Calls in flight at once to this provider, per process. */
  max_concurrency: z.number().int().positive(),
  retry: z.strictObject({
    /** Total attempts including the first; 1 = never retry. */
    max_attempts: z.number().int().positive(),
    base_delay_ms: z.number().int().positive(),
    /** Backoff ceiling; a retry-after longer than this ends the retries. */
    max_delay_ms: z.number().int().positive(),
  }),
});
export type ProviderPolicy = z.infer<typeof ProviderPolicy>;

export const ProvidersConfig = z.strictObject({
  providers: z.partialRecord(
    z.enum(['anthropic', 'openai', 'google', 'openrouter', 'fake']),
    ProviderPolicy,
  ),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfig>;

export function loadYaml<T>(path: string, schema: z.ZodType<T>): T {
  return schema.parse(parse(readFileSync(path, 'utf8')));
}

export function findModel(config: ModelsConfig, key: string): ModelEntry {
  const model = config.models.find((m) => m.key === key);
  if (!model) {
    const known = config.models.map((m) => m.key).join(', ');
    throw new Error(`Unknown model key "${key}". Known: ${known}`);
  }
  return model;
}
