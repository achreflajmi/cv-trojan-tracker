import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { parseOutput, type CallRequest, type CallResult, type ModelAdapter } from '@ctt/shared';

/**
 * Per-model settings from config/models.yaml. What is allowed depends on the model
 * (e.g. some models reject `disabled` thinking), so the owner sets it per model and
 * the value is recorded with every run.
 */
const AnthropicSettings = z.strictObject({
  thinking: z.enum(['omit', 'adaptive', 'disabled', 'between_tools']).default('omit'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
});

function thinkingParam(
  mode: z.infer<typeof AnthropicSettings>['thinking'],
): Anthropic.ThinkingConfigParam | undefined {
  switch (mode) {
    case 'omit':
      return undefined;
    case 'adaptive':
      return { type: 'adaptive' };
    case 'disabled':
      return { type: 'disabled' };
    case 'between_tools':
      return { type: 'between_tools' };
  }
}

export class AnthropicAdapter implements ModelAdapter {
  readonly provider = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey = process.env.ANTHROPIC_API_KEY,
    workspaceId = process.env.ANTHROPIC_WORKSPACE_ID,
  ) {
    // An explicit key from .env, so we never fall back to some other credential
    // (e.g. a CLI login profile) and bill a different account by accident.
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (put it in .env)');
    this.client = new Anthropic({
      apiKey,
      // maxRetries 0: the SDK would also retry 408/409 and dropped connections, where the
      // first attempt may already have been billed. Retries follow our own policy instead.
      maxRetries: 0,
      // Keys not scoped to a workspace must name one on every request.
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
  }

  async call(req: CallRequest): Promise<CallResult> {
    const settings = AnthropicSettings.parse(req.settings);
    const thinking = thinkingParam(settings.thinking);
    const started = performance.now();

    // No refusal fallbacks: a fallback would silently answer with a different model,
    // which would corrupt a per-model measurement. A refusal is recorded as an outcome.
    const res = await this.client.messages.create({
      model: req.modelId,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        format: { type: 'json_schema', schema: req.jsonSchema },
        ...(settings.effort ? { effort: settings.effort } : {}),
      },
      ...(thinking ? { thinking } : {}),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    });

    const rawText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const thinkingTokens = res.usage.output_tokens_details?.thinking_tokens;

    return {
      rawText,
      parsed: parseOutput(rawText, req.outputSchema),
      returnedModelId: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        ...(thinkingTokens === undefined ? {} : { thinkingTokens }),
      },
      latencyMs: Math.round(performance.now() - started),
      finishReason: res.stop_reason ?? 'unknown',
    };
  }
}
