import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exportRankInputs,
  upsertCvDocument,
  upsertExtraction,
  upsertJob,
  upsertProfile,
} from '@ctt/db';
import { createTestDb, type TestDb } from '@ctt/db/testing';
import { planFor, runExperiment, type Experiment } from '@ctt/engine';
import { FakeAdapter } from '@ctt/providers';
import { sha256, type ModelEntry, type Prompt } from '@ctt/shared';
import { rankRows } from './export.ts';

const BANDS = ['strong', 'medium', 'weak'] as const;

const experiment: Experiment = {
  name: 'rank-test',
  prompt: 'unused',
  prompt_version: 'ranker.test',
  task: 'rank',
  rank: { pools_per_job: 2, pool_size: 10, compositions: [0, 1, 5] },
  jobs: ['rank-job'],
  fit_bands: ['strong', 'medium', 'weak'],
  conditions: ['CLEAN', 'DATA'],
  hiding_methods: ['WHITE'],
  extractors: ['pdfjs'],
  include_aa: false,
  stopping: { min_repeats: 2, max_repeats: 2, target_half_width: 1 },
};
const model: ModelEntry = {
  key: 'fake',
  provider: 'fake',
  model_id: 'fake-scripted-1',
  max_tokens: 200,
  settings: {},
};
const prompt: Prompt = {
  version: 'ranker.test',
  system: 'Rank.',
  userTemplate: '{{job}}\n{{candidates}}',
};

/** Ranks CVs with hidden keywords first, then by profile number (a stable "quality"). */
function keywordLovingRanker(): FakeAdapter {
  return new FakeAdapter((req) => {
    const candidates = [
      ...req.user.matchAll(/<candidate id="(C\d+)">\n([^]*?)\n<\/candidate>/g),
    ].map((m) => ({
      id: m[1] ?? '',
      injected: (m[2] ?? '').includes('HIDDEN KEYWORDS'),
      quality: Number(/profile (\d+)/.exec(m[2] ?? '')?.[1] ?? 0),
    }));
    candidates.sort((a, b) => Number(b.injected) - Number(a.injected) || b.quality - a.quality);
    return JSON.stringify({ ranking: candidates.map((c) => c.id) });
  });
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)('rank task (SPEC 3.5)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    const jobId = await upsertJob(t.pool, {
      slug: 'rank-job',
      version: 1,
      title: 'Rank job',
      text: 'Job text',
    });
    for (let i = 0; i < 15; i++) {
      const profileId = await upsertProfile(t.pool, {
        jobId,
        externalId: `p${String(i).padStart(2, '0')}`,
        seed: `s${i}`,
        fitBand: BANDS[i % 3] ?? 'weak',
        data: {},
      });
      for (const [condition, hiding, text] of [
        ['CLEAN', null, `CV of profile ${i}`],
        ['DATA', 'WHITE', `CV of profile ${i}\nHIDDEN KEYWORDS`],
      ] as const) {
        const cv = await upsertCvDocument(t.pool, {
          profileId,
          condition,
          hiding,
          pdfSha256: sha256(`${i}${condition}`),
          path: 'x',
        });
        await upsertExtraction(t.pool, {
          cvDocumentId: cv,
          extractor: 'pdfjs',
          version: 't',
          text,
          textSha256: sha256(text),
          hiddenPresent: hiding ? true : null,
        });
      }
    }
  });
  afterAll(async () => {
    await t.drop();
  });

  it('plans matched pools: per pool one clean, one 1-of-10 and one 5-of-10 pool', async () => {
    const plan = await planFor({
      db: t.pool,
      experiment,
      model,
      prompt,
      prices: {
        usd_to_eur: null,
        models: {
          'fake-scripted-1': {
            input_usd_per_mtok: 0,
            output_usd_per_mtok: 0,
            date: '2026-11-06',
            source: 'test',
          },
        },
      },
    });
    expect(plan.inputs).toHaveLength(2 * 3);
    expect(plan.inputs.every((i) => i.inputs.length === 10)).toBe(true);
    expect(plan.cells).toEqual(['pdfjs|DATA-WHITE|k1', 'pdfjs|DATA-WHITE|k5']);
    expect(plan.callsMax).toBe(6 * 2);
  });

  it('runs, shuffles the order per repeat, and measures the target moving up', async () => {
    const adapter = keywordLovingRanker();
    const result = await runExperiment({
      db: t.pool,
      redisUrl: process.env.REDIS_URL ?? '',
      experiment,
      model,
      prompt,
      prices: {
        usd_to_eur: null,
        models: {
          'fake-scripted-1': {
            input_usd_per_mtok: 0,
            output_usd_per_mtok: 0,
            date: '2026-11-06',
            source: 'test',
          },
        },
      },
      budget: { per_run_cap_eur: 1, monthly_cap_eur: 1 },
      confirmBudgetEur: 1,
      adapter,
      concurrency: 2,
      queueName: `rank-${t.schema}`,
    });
    expect(result.status).toBe('completed');
    expect(adapter.calls).toHaveLength(12);

    // Same pool, two repeats: the presentation order differs (position bias averaged out).
    const orders = await t.pool.query<{ pool: string; repeat_index: number; order: string }>(
      `SELECT t.pool_composition AS pool, t.repeat_index, string_agg(ti.cv_document_id::text, ',' ORDER BY ti.position) AS order
       FROM trial t JOIN trial_input ti ON ti.trial_id = t.id GROUP BY t.id`,
    );
    const byPool = new Map<string, Set<string>>();
    for (const r of orders.rows) byPool.set(r.pool, (byPool.get(r.pool) ?? new Set()).add(r.order));
    expect([...byPool.values()].some((s) => s.size > 1)).toBe(true);

    const rows = rankRows('rank-test', await exportRankInputs(t.pool, 'rank-test'));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.parsed === 1)).toBe(true);
    for (const r of rows.filter((x) => x.k === 1)) {
      const clean = rows.find((c) => c.k === 0 && c.pool === r.pool && c.repeat === r.repeat);
      expect(r.target_rank).toBe(1); // the only injected CV goes first
      expect(Number(clean?.target_rank)).toBeGreaterThan(1); // without the injection it is not first
    }
  });
});
