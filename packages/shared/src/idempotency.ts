import { createHash } from 'node:crypto';

/** Strings are hashed as UTF-8. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Hash of the inputs' extracted-text hashes, in canonical (pre-shuffle) order. SPEC 4.4. */
export function inputsSha256(textSha256s: readonly string[]): string {
  return sha256(JSON.stringify(textSha256s));
}

export interface TrialKeyParts {
  experimentId: string;
  modelId: string;
  task: 'score' | 'rank';
  jobId: string;
  pool: string;
  repeatIndex: number;
  promptVersion: string;
  inputsSha256: string;
}

/**
 * Deterministic trial key. Fields are serialised as a JSON array, so values that
 * contain a separator cannot collide (["a|b","c"] vs ["a","b|c"]).
 */
export function trialKey(p: TrialKeyParts): string {
  return sha256(
    JSON.stringify([
      p.experimentId,
      p.modelId,
      p.task,
      p.jobId,
      p.pool,
      p.repeatIndex,
      p.promptVersion,
      p.inputsSha256,
    ]),
  );
}
