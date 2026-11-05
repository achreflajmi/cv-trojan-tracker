import type { ZodType } from 'zod';

export type Provider = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'fake';

export interface CallRequest {
  modelId: string;
  system: string;
  user: string;
  /** JSON Schema sent to the provider's structured-output feature. */
  jsonSchema: Record<string, unknown>;
  /** Our own validation of the answer; the provider's schema support is not trusted. */
  outputSchema: ZodType;
  maxTokens: number;
  temperature?: number;
  /** Provider-specific settings from config/models.yaml (thinking, effort, ...). */
  settings: Record<string, unknown>;
  idempotencyKey: string;
}

export interface CallResult {
  rawText: string;
  /** null when the answer is not JSON or fails outputSchema: an "unparseable" outcome. */
  parsed: unknown;
  returnedModelId: string;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number };
  latencyMs: number;
  finishReason: string;
}

export interface ModelAdapter {
  provider: Provider;
  call(req: CallRequest): Promise<CallResult>;
}

/** Parse and validate a model answer. Never throws: failure is data, not an error. */
export function parseOutput(rawText: string, schema: ZodType): unknown {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}
