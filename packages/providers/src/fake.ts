import { parseOutput, type CallRequest, type CallResult, type ModelAdapter } from '@ctt/shared';

/** Decides the raw answer text for a request. `n` counts calls made so far (0-based). */
export type Script = (req: CallRequest, n: number) => string;

const defaultScript: Script = () =>
  JSON.stringify({
    score: 50,
    decision: 'reject',
    reason: 'Scripted answer from the fake adapter.',
  });

/**
 * Free, offline adapter for development and tests. Token usage is approximated as
 * one token per 4 bytes, which is enough for testing cost arithmetic.
 */
export class FakeAdapter implements ModelAdapter {
  readonly provider = 'fake' as const;
  readonly calls: CallRequest[] = [];
  private readonly script: Script;

  constructor(script: Script = defaultScript) {
    this.script = script;
  }

  call(req: CallRequest): Promise<CallResult> {
    const rawText = this.script(req, this.calls.length);
    this.calls.push(req);
    const bytes = Buffer.byteLength(req.system + req.user, 'utf8');
    return Promise.resolve({
      rawText,
      parsed: parseOutput(rawText, req.outputSchema),
      returnedModelId: req.modelId,
      usage: { inputTokens: Math.ceil(bytes / 4), outputTokens: Math.ceil(rawText.length / 4) },
      latencyMs: 0,
      finishReason: 'end_turn',
    });
  }
}
