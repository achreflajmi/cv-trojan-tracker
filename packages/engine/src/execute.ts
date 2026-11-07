import type pg from 'pg';
import {
  claimCall,
  completeCall,
  failCall,
  pendingTrials,
  recoverOrphanedClaims,
  type PendingTrial,
} from '@ctt/db';
import {
  costEur,
  worstCaseCostEur,
  type CallRequest,
  type ModelAdapter,
  type PricesConfig,
} from '@ctt/shared';

export interface ExecuteContext {
  db: pg.Pool;
  runId: number;
  adapter: ModelAdapter;
  prices: PricesConfig;
  /** Builds the provider request for a trial (prompt + extracted CV text). */
  buildRequest: (trial: PendingTrial) => Promise<CallRequest>;
}

export type Outcome = 'completed' | 'skipped' | 'in-flight' | 'failed' | 'over-budget';

/** HTTP error responses (status present) are not billed; a dropped connection may be. */
function maybeBilled(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== 'number';
}

/** Claim, call, settle. Each database step is atomic; the API call sits between them. */
export async function executeTrial(ctx: ExecuteContext, trial: PendingTrial): Promise<Outcome> {
  const req = await ctx.buildRequest(trial);
  const reserve = worstCaseCostEur(
    ctx.prices,
    req.modelId,
    Buffer.byteLength(req.system + req.user, 'utf8'),
    req.maxTokens,
  );

  const claim = await claimCall(ctx.db, ctx.runId, trial.id, reserve);
  switch (claim.kind) {
    case 'already-completed':
      return 'skipped';
    case 'in-flight':
      return 'in-flight';
    case 'over-budget':
      return 'over-budget';
    case 'claimed':
      break;
  }

  let result;
  try {
    result = await ctx.adapter.call(req);
  } catch (error) {
    await failCall(ctx.db, ctx.runId, claim.callId, (error as Error).message, maybeBilled(error));
    return 'failed';
  }
  await completeCall(
    ctx.db,
    ctx.runId,
    claim.callId,
    result,
    costEur(ctx.prices, req.modelId, result.usage),
  );
  return 'completed';
}

/**
 * Run (or resume) every pending trial of a run, one at a time. Stage 5 replaces the
 * loop with queue workers; the claim protocol stays the same.
 *
 * `recoverOrphans`: on a resume, claims left by a dead process are released first.
 * Only safe when no other worker is running for this run, so concurrent workers pass false.
 */
export async function runPending(
  ctx: ExecuteContext,
  { recoverOrphans = true }: { recoverOrphans?: boolean } = {},
): Promise<Record<Outcome, number> & { recovered: number }> {
  const recovered = recoverOrphans ? await recoverOrphanedClaims(ctx.db, ctx.runId) : 0;
  const counts = {
    completed: 0,
    skipped: 0,
    'in-flight': 0,
    failed: 0,
    'over-budget': 0,
    recovered,
  };
  for (const trial of await pendingTrials(ctx.db, ctx.runId)) {
    const outcome = await executeTrial(ctx, trial);
    counts[outcome]++;
    if (outcome === 'over-budget') break; // no new calls once the cap is reached
  }
  return counts;
}
