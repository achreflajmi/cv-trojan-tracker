import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const ModelEntry = z.strictObject({
  key: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google', 'openrouter', 'fake']),
  model_id: z.string().min(1),
  max_tokens: z.number().int().positive(),
  temperature: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
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
      ...dated,
    }),
  ),
});
export type PricesConfig = z.infer<typeof PricesConfig>;

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
