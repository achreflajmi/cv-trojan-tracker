import { HTTPClient, OpenRouter } from '@openrouter/sdk';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import type { ChatResult } from '@openrouter/sdk/models';
import { z } from 'zod';
import { parseOutput, type CallRequest, type CallResult, type ModelAdapter } from '@ctt/shared';
import { ProviderHttpError, requireUsage } from './errors.ts';

/**
 * Per-model settings from config/models.yaml.
 *
 * `provider` pins ONE upstream endpoint (slug as listed on the model's OpenRouter page,
 * e.g. "mistral/zdr"); fallbacks are always off. Otherwise OpenRouter may serve the
 * same model ID from different hosts, quantisations and prices from call to call, and
 * we would no longer measure one model.
 */
const OpenRouterSettings = z.strictObject({
  provider: z.string().min(1),
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
});

/**
 * Variant suffixes (":free", ":nitro", ":floor", ...) change routing or pricing; ":free"
 * variants are also rate-limited and may log prompts. Only plain model IDs are allowed.
 */
export function assertPlainModelId(modelId: string): void {
  if (modelId.includes(':')) {
    throw new Error(`OpenRouter model "${modelId}" uses a variant suffix; use the plain model ID`);
  }
}

export interface OpenRouterAdapterOptions {
  apiKey?: string | undefined;
  /** Tests inject a fake HTTP layer here; production uses the global fetch. */
  fetch?: typeof fetch;
}

/** Chat Completions through the official OpenRouter SDK, with structured outputs. */
export class OpenRouterAdapter implements ModelAdapter {
  readonly provider = 'openrouter' as const;
  private readonly client: OpenRouter;

  constructor({ apiKey = process.env.OPENROUTER_API_KEY, fetch }: OpenRouterAdapterOptions = {}) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (put it in .env)');
    this.client = new OpenRouter({
      apiKey,
      // The SDK can retry connection errors, which may already be billed. Off; our own
      // policy (retry.ts) decides.
      retryConfig: { strategy: 'none' },
      ...(fetch ? { httpClient: new HTTPClient({ fetcher: fetch }) } : {}),
    });
  }

  async call(req: CallRequest): Promise<CallResult> {
    assertPlainModelId(req.modelId);
    const settings = OpenRouterSettings.parse(req.settings);
    const started = performance.now();

    let res: ChatResult;
    try {
      res = await this.client.chat.send({
        chatRequest: {
          model: req.modelId,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          maxTokens: req.maxTokens,
          responseFormat: {
            type: 'json_schema',
            jsonSchema: { name: 'answer', schema: req.jsonSchema, strict: true },
          },
          provider: {
            order: [settings.provider],
            only: [settings.provider],
            allowFallbacks: false,
            // Refuse endpoints that would silently ignore the schema or reasoning setting.
            requireParameters: true,
          },
          ...(settings.reasoning_effort
            ? { reasoning: { effort: settings.reasoning_effort } }
            : {}),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
          stream: false,
        },
      });
    } catch (error) {
      // The SDK's HTTP errors carry `statusCode`; the engine expects `status` (D-029).
      // Status < 400 means a delivered (billed) answer the SDK could not read: rethrown
      // unchanged, without `status`, so its reservation is kept.
      if (error instanceof OpenRouterError && error.statusCode >= 400) {
        throw new ProviderHttpError(error.statusCode, error.message, error.headers, {
          cause: error,
        });
      }
      throw error;
    }

    const choice = res.choices[0];
    const message = choice?.message;
    const refusal = message?.refusal ?? undefined;
    const rawText = refusal ?? contentText(message?.content);
    const usage = requireUsage(res.usage, 'openrouter');
    const reasoningTokens = usage.completionTokensDetails?.reasoningTokens ?? undefined;

    return {
      rawText,
      parsed: parseOutput(rawText, req.outputSchema),
      returnedModelId: res.model,
      usage: {
        inputTokens: usage.promptTokens,
        // Includes reasoning tokens (OpenAI-compatible usage), billed as output.
        outputTokens: usage.completionTokens,
        ...(reasoningTokens === undefined ? {} : { thinkingTokens: reasoningTokens }),
      },
      latencyMs: Math.round(performance.now() - started),
      finishReason: refusal === undefined ? (choice?.finishReason ?? 'unknown') : 'refusal',
    };
  }
}

type Content = NonNullable<ChatResult['choices'][number]['message']['content']>;

function contentText(content: Content | null | undefined): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}
