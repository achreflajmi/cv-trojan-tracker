import { Rng } from '@ctt/corpus';
import type { PlanRow } from '@ctt/db';
import {
  costEur,
  fillTemplate,
  inputsSha256,
  worstCaseCostEur,
  type ModelEntry,
  type PricesConfig,
  type Prompt,
} from '@ctt/shared';
import type { Experiment } from './experiment.ts';
import type { Plan, PlannedInput } from './plan.ts';

/**
 * Rank task planner (SPEC 3.5, proposal #5). Per job, `pools_per_job` pools of
 * `pool_size` profiles (mixed fit, chosen by seed). In every pool one TARGET candidate
 * from the medium/weak bands is the one injected in the 1-of-N pool, and is one of
 * the k injected in a k-of-N pool. Every injected pool has a MATCHED 0-injected pool:
 * the same profiles, all CLEAN. Rank lift = rank of the target in the clean pool
 * minus its rank in the injected pool (positive = moved up).
 *
 * The pool label in `trial.pool_composition` records everything the analysis needs:
 *   `<extractor>|p<i>|k<k>|<variant>|t=<target profile>`
 */
export function poolLabel(p: {
  extractor: string;
  pool: number;
  k: number;
  variant: string;
  target: string;
}): string {
  return `${p.extractor}|p${p.pool}|k${p.k}|${p.variant}|t=${p.target}`;
}

export function parsePoolLabel(label: string) {
  const m = /^([^|]+)\|p(\d+)\|k(\d+)\|([^|]+)\|t=(.+)$/.exec(label);
  if (!m) return null;
  return {
    extractor: m[1] ?? '',
    pool: Number(m[2]),
    k: Number(m[3]),
    variant: m[4] ?? '',
    target: m[5] ?? '',
  };
}

function variantLabel(row: PlanRow): string {
  return row.hidingMethod ? `${row.condition}-${row.hidingMethod}` : row.condition;
}

export interface RankPool {
  job: string;
  index: number;
  profiles: string[];
  target: string;
  /** The k injected profiles for each composition k (target first). */
  injected: Map<number, string[]>;
}

/** Deterministic pools for one job. Bands are balanced as far as the job allows. */
export function makePools(
  job: string,
  profiles: { id: string; band: string }[],
  rank: NonNullable<Experiment['rank']>,
): RankPool[] {
  const byBand = (b: string) =>
    profiles
      .filter((p) => p.band === b)
      .map((p) => p.id)
      .sort();
  const pools: RankPool[] = [];
  for (let i = 0; i < rank.pools_per_job; i++) {
    const rng = new Rng(`rank|${job}|pool${i}`);
    const size = rank.pool_size;
    const quota = { strong: Math.round(size * 0.3), weak: Math.round(size * 0.3) };
    const medium = size - quota.strong - quota.weak;
    const pick = (band: string, n: number) =>
      rng.sample(byBand(band), Math.min(n, byBand(band).length));
    const chosen = [
      ...pick('strong', quota.strong),
      ...pick('medium', medium),
      ...pick('weak', quota.weak),
    ];
    if (chosen.length < size) {
      const rest = profiles.map((p) => p.id).filter((id) => !chosen.includes(id));
      chosen.push(...rng.sample(rest, size - chosen.length));
    }
    const candidates = chosen
      .filter((id) => profiles.find((p) => p.id === id)?.band !== 'strong')
      .sort();
    const target = rng.pick(candidates);
    const pool = candidates.filter((c) => c !== target);
    const others = rng.sample(
      pool,
      Math.min(pool.length, Math.max(0, Math.max(...rank.compositions) - 1)),
    );
    if (others.length < Math.max(...rank.compositions) - 1) {
      throw new Error(
        `job ${job} pool ${i}: not enough medium/weak profiles for k=${Math.max(...rank.compositions)}`,
      );
    }
    const injected = new Map<number, string[]>(
      rank.compositions.map((k) => [k, k === 0 ? [] : [target, ...others.slice(0, k - 1)]]),
    );
    pools.push({ job, index: i, profiles: chosen.sort(), target, injected });
  }
  return pools;
}

export function buildRankPlan(
  rows: readonly PlanRow[],
  experiment: Experiment,
  model: ModelEntry,
  prompt: Prompt,
  prices: PricesConfig,
): Plan {
  const rank = experiment.rank;
  if (!rank) throw new Error('rank experiment without a rank section');
  const variants = new Set<string>();
  for (const r of rows) {
    const inScope =
      experiment.conditions.includes(r.condition as Experiment['conditions'][number]) &&
      (r.hidingMethod === null ||
        experiment.hiding_methods.includes(r.hidingMethod as Experiment['hiding_methods'][number]));
    if (inScope && r.condition !== 'CLEAN') variants.add(variantLabel(r));
  }

  // row lookup: job | profile | extractor | variant
  const lookup = new Map(
    rows.map((r) => [`${r.jobSlug}|${r.profile}|${r.extractor}|${variantLabel(r)}`, r]),
  );
  const specs: PlannedInput[] = [];
  const cells = new Set<string>();

  for (const job of experiment.jobs) {
    const jobRows = rows.filter((r) => r.jobSlug === job && r.condition === 'CLEAN');
    const profiles = [
      ...new Map(jobRows.map((r) => [r.profile, { id: r.profile, band: r.fitBand }])).values(),
    ];
    if (profiles.length < rank.pool_size)
      throw new Error(`job ${job}: ${profiles.length} profiles, pool_size ${rank.pool_size}`);
    for (const pool of makePools(job, profiles, rank)) {
      for (const extractor of experiment.extractors) {
        const add = (k: number, variant: string): void => {
          const injected = new Set(pool.injected.get(k) ?? []);
          const members = pool.profiles.map((id) => {
            const row = lookup.get(
              `${job}|${id}|${extractor}|${injected.has(id) ? variant : 'CLEAN'}`,
            );
            if (!row) throw new Error(`missing extraction ${job}/${id}/${extractor}/${variant}`);
            return row;
          });
          const hash = inputsSha256(members.map((m) => m.textSha256)); // canonical (sorted) order
          const label = poolLabel({
            extractor,
            pool: pool.index,
            k,
            variant: k === 0 ? 'CLEAN' : variant,
            target: pool.target,
          });
          if (k > 0) cells.add(`${extractor}|${variant}|k${k}`);
          const user = fillTemplate(prompt.userTemplate, {
            job: (members[0]?.jobText ?? '').trim(),
            candidates: members
              .map((m, i) => `<candidate id="C${i + 1}">\n${m.text}\n</candidate>`)
              .join('\n\n'),
          });
          specs.push({
            key: `${members[0]?.jobId}|${hash}|${label}`,
            jobId: members[0]?.jobId ?? 0,
            pool: label,
            inputsSha256: hash,
            inputs: members.map((m) => ({
              cvDocumentId: m.cvDocumentId,
              extractionId: m.extractionId,
            })),
            user,
            worstCaseEur: worstCaseCostEur(
              prices,
              model.model_id,
              Buffer.byteLength(prompt.system + user, 'utf8'),
              model.max_tokens,
            ),
          });
        };
        add(0, 'CLEAN');
        for (const variant of [...variants].sort()) {
          for (const k of rank.compositions.filter((c) => c > 0)) add(k, variant);
        }
      }
    }
  }

  const repeats = experiment.stopping.max_repeats;
  const typical = specs.reduce(
    (s, i) =>
      s +
      costEur(prices, model.model_id, {
        inputTokens: Math.ceil(Buffer.byteLength(i.user, 'utf8') / 4),
        outputTokens: Math.min(300, model.max_tokens),
      }),
    0,
  );
  return {
    inputs: specs,
    members: [],
    cells: [...cells].sort(),
    callsMin: specs.length * repeats,
    callsMax: specs.length * repeats,
    upperBoundEur: specs.reduce((s, i) => s + i.worstCaseEur, 0) * repeats,
    typicalEur: typical * repeats,
    extractions: specs.reduce((s, i) => s + i.inputs.length, 0),
  };
}
