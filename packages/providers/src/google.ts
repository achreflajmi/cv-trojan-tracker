import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { parseOutput, type CallRequest, type CallResult, type ModelAdapter } from '@ctt/shared';
import { requireUsage } from './errors.ts';

/**
 * Per-model settings from config/models.yaml. Gemini 3+ models take a thinking level;
 * which levels exist, and whether thinking can be turned off at all, depends on the
 * model (see the thinking docs). Older models take a token budget instead (0 = off).
 */
const GoogleSettings = z
  .strictObject({
    thinking_level: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    thinking_budget: z.number().int().min(0).optional(),
  })
  .refine((s) => s.thinking_level === undefined || s.thinking_budget === undefined, {
    message: 'set thinking_level or thinking_budget, not both',
  });

const LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

export interface GoogleAdapterOptions {
  apiKey?: string | undefined;
  /** Tests inject a fake HTTP layer here; production uses the global fetch. */
  fetch?: typeof fetch;
}

/** Gemini API (not Vertex AI) with structured output (`responseJsonSchema`). */
export class GoogleAdapter implements ModelAdapter {
  readonly provider = 'google' as const;
  private readonly client: GoogleGenAI;

  constructor({ apiKey = process.env.GEMINI_API_KEY, fetch }: GoogleAdapterOptions = {}) {
    // An explicit key from .env only (the SDK would also look at GOOGLE_API_KEY).
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set (put it in .env)');
    this.client = new GoogleGenAI({
      apiKey,
      vertexai: false,
      httpOptions: {
        // 1 attempt = no SDK retries; our own policy (retry.ts) decides.
        retryOptions: { attempts: 1 },
        ...(fetch ? { fetch } : {}),
      },
    });
  }

  async call(req: CallRequest): Promise<CallResult> {
    const settings = GoogleSettings.parse(req.settings);
    const started = performance.now();

    const res = await this.client.models.generateContent({
      model: req.modelId,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: req.jsonSchema,
        ...(settings.thinking_level
          ? { thinkingConfig: { thinkingLevel: LEVELS[settings.thinking_level] } }
          : {}),
        ...(settings.thinking_budget === undefined
          ? {}
          : { thinkingConfig: { thinkingBudget: settings.thinking_budget } }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      },
    });

    // `text` skips thought parts; it is undefined when the answer was blocked.
    const rawText = res.text ?? '';
    const usage = requireUsage(res.usageMetadata, 'google');
    const thoughts = usage.thoughtsTokenCount;

    return {
      rawText,
      parsed: parseOutput(rawText, req.outputSchema),
      // modelVersion is the model that actually answered; never substitute the request.
      returnedModelId: res.modelVersion ?? 'unknown',
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        // Gemini reports thinking separately from the answer, but bills both as output
        // ("output price, including thinking tokens"), so cost needs the sum.
        outputTokens: (usage.candidatesTokenCount ?? 0) + (thoughts ?? 0),
        ...(thoughts === undefined ? {} : { thinkingTokens: thoughts }),
      },
      latencyMs: Math.round(performance.now() - started),
      finishReason: finishReason(res),
    };
  }
}

function finishReason(res: GenerateContentResponse): string {
  // A blocked prompt has no candidates; the reason is in promptFeedback.
  const blocked = res.promptFeedback?.blockReason;
  if (blocked) return `blocked:${blocked}`;
  return res.candidates?.[0]?.finishReason ?? 'unknown';
}
