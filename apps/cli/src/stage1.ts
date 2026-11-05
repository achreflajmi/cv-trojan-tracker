import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Job, Profile, injectedText, renderCv, type CvVariant } from '@ctt/corpus';
import { extractWithPdfjs, hiddenTextPresent, PDFJS_VERSION } from '@ctt/extract';
import { createAdapter } from '@ctt/providers';
import {
  costEur,
  fillTemplate,
  findModel,
  inputsSha256,
  loadPrompt,
  loadYaml,
  ModelsConfig,
  PricesConfig,
  ScoreOutput,
  scoreJsonSchema,
  sha256,
  trialKey,
  worstCaseCostEur,
  type ModelAdapter,
} from '@ctt/shared';

export interface Stage1Options {
  modelKey: string;
  /** EUR the owner approved for this run; required for any paid model. */
  confirmBudgetEur?: number;
  outDir: string;
  /** For tests: inject an adapter instead of creating one from config. */
  adapter?: ModelAdapter;
}

const VARIANTS: { label: string; variant: CvVariant }[] = [
  { label: 'CLEAN', variant: { condition: 'CLEAN' } },
  { label: 'DATA-WHITE', variant: { condition: 'DATA', hiding: 'WHITE' } },
];

/** Stage 1: one job, one profile, CLEAN vs DATA/WHITE, pdf.js extraction, one call each. */
export async function runStage1(opts: Stage1Options): Promise<void> {
  const models = loadYaml('config/models.yaml', ModelsConfig);
  const prices = loadYaml('config/prices.yaml', PricesConfig);
  const model = findModel(models, opts.modelKey);
  const job = loadYaml('battery/jobs/junior-backend-engineer.yaml', Job);
  const profile = loadYaml('battery/fixtures/stage1-profile.yaml', Profile);
  const prompt = loadPrompt('battery/prompts/screener.v1.md', 'screener.v1');
  mkdirSync(opts.outDir, { recursive: true });

  // 1. Render, extract, check survival.
  const prepared = [];
  for (const { label, variant } of VARIANTS) {
    const pdf = await renderCv(profile, job, variant);
    writeFileSync(join(opts.outDir, `${label}.pdf`), pdf);
    const text = await extractWithPdfjs(pdf);
    const hidden = injectedText(job, variant);
    const survived = hidden === null ? null : hiddenTextPresent(text, hidden);
    const user = fillTemplate(prompt.userTemplate, { job: job.text.trim(), cv: text });
    prepared.push({ label, variant, pdfSha256: sha256(pdf), text, survived, user });
    console.log(
      `${label}: ${text.length} chars extracted, hidden text survived: ${survived ?? 'n/a'}`,
    );
  }

  // 2. Budget gate: worst case must be known and approved before any paid call.
  const worstCase = prepared.reduce(
    (sum, p) =>
      sum +
      worstCaseCostEur(
        prices,
        model.model_id,
        Buffer.byteLength(prompt.system + p.user),
        model.max_tokens,
      ),
    0,
  );
  console.log(`Worst-case cost for ${prepared.length} calls: EUR ${worstCase.toFixed(4)}`);
  if (model.provider !== 'fake') {
    if (opts.confirmBudgetEur === undefined || opts.confirmBudgetEur < worstCase) {
      throw new Error(
        `Refusing to call ${model.model_id}: pass --confirm-budget <EUR> of at least ${worstCase.toFixed(4)}`,
      );
    }
  }

  // 3. One call per CV.
  const adapter = opts.adapter ?? createAdapter(model.provider);
  const results = [];
  for (const p of prepared) {
    const key = trialKey({
      experimentId: 'stage1',
      modelId: model.model_id,
      task: 'score',
      jobId: `${job.slug}@${job.version}`,
      pool: 'single',
      repeatIndex: 0,
      promptVersion: prompt.version,
      inputsSha256: inputsSha256([sha256(p.text)]),
    });
    try {
      const r = await adapter.call({
        modelId: model.model_id,
        system: prompt.system,
        user: p.user,
        jsonSchema: scoreJsonSchema,
        outputSchema: ScoreOutput,
        maxTokens: model.max_tokens,
        ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
        settings: model.settings,
        idempotencyKey: key,
      });
      const cost = costEur(prices, model.model_id, r.usage);
      const parsed = r.parsed as ScoreOutput | null;
      console.log(
        `${p.label}: ${parsed ? `score ${parsed.score}, ${parsed.decision}` : 'UNPARSEABLE'}` +
          ` (finish: ${r.finishReason}, model: ${r.returnedModelId}, EUR ${cost.toFixed(5)})`,
      );
      results.push({ label: p.label, idempotencyKey: key, ...r, costEur: cost });
    } catch (error) {
      console.log(`${p.label}: CALL FAILED: ${(error as Error).message}`);
      results.push({ label: p.label, idempotencyKey: key, error: (error as Error).message });
    }
  }

  // 4. Save everything needed to audit the run.
  const record = {
    createdAt: new Date().toISOString(),
    model,
    prompt: { version: prompt.version, system: prompt.system },
    extractor: { name: 'pdfjs', version: PDFJS_VERSION },
    job: { slug: job.slug, version: job.version },
    profile: { id: profile.id, fit_band: profile.fit_band },
    inputs: prepared.map(({ label, variant, pdfSha256, text, survived }) => ({
      label,
      variant,
      pdfSha256,
      textSha256: sha256(text),
      hiddenTextSurvived: survived,
      text,
    })),
    results,
  };
  const file = join(opts.outDir, `responses-${record.createdAt.replaceAll(':', '-')}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`Raw responses saved to ${file}`);
}
