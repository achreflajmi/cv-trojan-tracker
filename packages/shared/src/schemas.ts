import { z } from 'zod';

export const ScoreOutput = z.strictObject({
  score: z.number().int().min(0).max(100),
  decision: z.enum(['advance', 'reject']),
  reason: z.string().max(300),
});
export type ScoreOutput = z.infer<typeof ScoreOutput>;

/**
 * Sent to providers. Kept minimal on purpose: range and length limits are not
 * supported by every provider's structured-output mode, so ScoreOutput enforces them.
 */
export const scoreJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    decision: { type: 'string', enum: ['advance', 'reject'] },
    reason: { type: 'string' },
  },
  required: ['score', 'decision', 'reason'],
  additionalProperties: false,
};
