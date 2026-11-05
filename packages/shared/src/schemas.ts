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

/**
 * Rank task (SPEC 3.5): every candidate of the pool exactly once, best first.
 * Built per pool, because a valid answer is a permutation of that pool's IDs.
 */
export function rankOutputFor(candidateIds: readonly string[]) {
  const expected = [...candidateIds].sort();
  return z.strictObject({
    ranking: z
      .array(z.string())
      .refine(
        (r) => r.length === expected.length && [...r].sort().every((id, i) => id === expected[i]),
        'ranking must list every candidate of the pool exactly once',
      ),
  });
}

/** Minimal on purpose, like scoreJsonSchema: the permutation check is done by zod. */
export const rankJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: { ranking: { type: 'array', items: { type: 'string' } } },
  required: ['ranking'],
  additionalProperties: false,
};
