import OpenAI from 'openai';
import { z } from 'zod';
import { parseOutput, type CallRequest, type CallResult, type ModelAdapter } from '@ctt/shared';
import { requireUsage } from './errors.ts';

/**
 * Per-model settings from config/models.yaml. `reasoning_effort: none` turns reasoning
 * off on models that allow it (SPEC 3.9); models that do not allow it get the lowest
 * accepted value, and models.yaml says so.
 */
const OpenAISettings = z.strictObject({
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
});

export interface OpenAIAdapterOptions {
  apiKey?: string | undefined;
  /** Tests inject a fake HTTP layer here; production uses the global fetch. */
  fetch?: typeof fetch;
}

/** Uses the Responses API with Structured Outputs (`text.format: json_schema`). */
export class OpenAIAdapter implements ModelAdapter {
  readonly provider = 'openai' as const;
  private readonly client: OpenAI;

  constructor({ apiKey = process.env.OPENAI_API_KEY, fetch }: OpenAIAdapterOptions = {}) {
    // An explicit key from .env only, so no other credential is ever billed by accident.
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set (put it in .env)');
    this.client = new OpenAI({
      apiKey,
      // The SDK retries 408/409 and dropped connections by default; those may already
      // be billed. Our own retry policy (retry.ts) decides instead.
      maxRetries: 0,
      ...(fetch ? { fetch } : {}),
    });
  }

  async call(req: CallRequest): Promise<CallResult> {
    const settings = OpenAISettings.parse(req.settings);
    const started = performance.now();

    const res = await this.client.responses.create({
      model: req.modelId,
      instructions: req.system,
      input: req.user,
      max_output_tokens: req.maxTokens,
      text: {
        format: { type: 'json_schema', name: 'answer', schema: req.jsonSchema, strict: true },
      },
      // Synthetic CVs need no server-side copy; nothing reads it back.
      store: false,
      ...(settings.reasoning_effort ? { reasoning: { effort: settings.reasoning_effort } } : {}),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    });

    // A refusal arrives as its own content part instead of text. It is kept as the raw
    // answer (so it is stored and parsed = null) and reported as the finish reason.
    let refusal: string | undefined;
    for (const item of res.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content) if (part.type === 'refusal') refusal = part.refusal;
    }
    const rawText = refusal ?? res.output_text;
    const usage = requireUsage(res.usage, 'openai');
    const reasoningTokens = usage.output_tokens_details.reasoning_tokens;

    return {
      rawText,
      parsed: parseOutput(rawText, req.outputSchema),
      returnedModelId: res.model,
      usage: {
        inputTokens: usage.input_tokens,
        // Already includes reasoning tokens, which are billed as output.
        outputTokens: usage.output_tokens,
        ...(reasoningTokens === undefined ? {} : { thinkingTokens: reasoningTokens }),
      },
      latencyMs: Math.round(performance.now() - started),
      finishReason: finishReason(res, refusal !== undefined),
    };
  }
}

function finishReason(res: OpenAI.Responses.Response, refused: boolean): string {
  if (refused) return 'refusal';
  if (res.status === 'incomplete') return res.incomplete_details?.reason ?? 'incomplete';
  return res.status ?? 'unknown';
}
