import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  allVariants,
  generateProfiles,
  injectedText,
  loadBattery,
  renderCv,
  variantLabel,
  type Condition,
  type HidingMethod,
} from '@ctt/corpus';
import {
  extractWithPdfjs,
  extractWithPoppler,
  findPoppler,
  hiddenTextPresent,
  PDFJS_VERSION,
} from '@ctt/extract';
import { sha256 } from '@ctt/shared';

const CORPUS_DIR = 'data/corpus';
const MANIFEST = join(CORPUS_DIR, 'manifest.json');
const EXTRACTIONS = join(CORPUS_DIR, 'extractions.jsonl');

export interface ManifestEntry {
  job: string;
  jobVersion: number;
  profileId: string;
  fitBand: string;
  seed: string;
  condition: Condition;
  hiding: HidingMethod | null;
  label: string;
  injectedText: string | null;
  path: string;
  pdfSha256: string;
}

export interface ExtractionRecord {
  label: string;
  job: string;
  profileId: string;
  condition: Condition;
  hiding: HidingMethod | null;
  pdfSha256: string;
  extractor: 'pdfjs' | 'poppler';
  extractorVersion: string;
  text: string;
  textSha256: string;
  /** null for CLEAN (nothing injected). */
  hiddenTextPresent: boolean | null;
}

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** ctt generate: profiles (battery/profiles) and every CV variant as PDF (data/corpus). */
export async function generate(): Promise<void> {
  const battery = loadBattery();
  const manifest: ManifestEntry[] = [];
  for (const job of battery.jobs) {
    const profiles = generateProfiles(job, battery.common, battery.names);
    for (const profile of profiles) {
      write(
        join('battery/profiles', job.slug, `${profile.id}.json`),
        JSON.stringify(profile, null, 2),
      );
      for (const variant of allVariants()) {
        const label = variantLabel(variant);
        const pdf = await renderCv(profile, job, variant, battery);
        const path = join(CORPUS_DIR, 'pdfs', job.slug, profile.id, `${label}.pdf`);
        write(path, pdf);
        manifest.push({
          job: job.slug,
          jobVersion: job.version,
          profileId: profile.id,
          fitBand: profile.fit_band,
          seed: profile.seed,
          condition: variant.condition,
          hiding: variant.hiding ?? null,
          label,
          injectedText: injectedText(job, variant, battery),
          path,
          pdfSha256: sha256(pdf),
        });
      }
    }
    console.log(
      `${job.slug}: ${profiles.length} profiles, ${profiles.length * allVariants().length} PDFs`,
    );
  }
  write(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Manifest: ${manifest.length} PDFs -> ${MANIFEST}`);
}

/** Run `fn` over `items` with at most `limit` in flight, keeping output order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/** ctt extract: both extractors on every PDF, with hidden-text survival. */
export async function extract(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as ManifestEntry[];
  const poppler = await findPoppler();
  console.log(`Extractors: pdfjs ${PDFJS_VERSION}, poppler ${poppler.version} (${poppler.path})`);

  const records = await mapLimit(manifest, 8, async (entry) => {
    const pdf = readFileSync(entry.path);
    const texts = {
      pdfjs: { text: await extractWithPdfjs(pdf), version: PDFJS_VERSION },
      poppler: { text: await extractWithPoppler(pdf, poppler), version: poppler.version },
    };
    return (['pdfjs', 'poppler'] as const).map((extractor): ExtractionRecord => ({
      label: entry.label,
      job: entry.job,
      profileId: entry.profileId,
      condition: entry.condition,
      hiding: entry.hiding,
      pdfSha256: entry.pdfSha256,
      extractor,
      extractorVersion: texts[extractor].version,
      text: texts[extractor].text,
      textSha256: sha256(texts[extractor].text),
      hiddenTextPresent:
        entry.injectedText === null
          ? null
          : hiddenTextPresent(texts[extractor].text, entry.injectedText),
    }));
  });
  const flat = records.flat();
  write(EXTRACTIONS, flat.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${flat.length} extractions -> ${EXTRACTIONS}`);
}

export function loadExtractions(): ExtractionRecord[] {
  return readFileSync(EXTRACTIONS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExtractionRecord);
}

/** ctt survival: the method x extractor survival table, plus what the model really sees. */
export function survival(): void {
  const records = loadExtractions();
  const extractors = ['pdfjs', 'poppler'] as const;
  const labels = [...new Set(records.map((r) => r.label))].filter((l) => l !== 'CLEAN');

  // For each (profile, extractor), the CLEAN text and the visible-condition texts.
  const key = (r: ExtractionRecord, label: string): string =>
    `${r.job}|${r.profileId}|${r.extractor}|${label}`;
  const byKey = new Map(records.map((r) => [key(r, r.label), r.textSha256]));
  const visibleTwin: Partial<Record<Condition, string>> = { DATA: 'VIS_DATA', INSTR: 'VIS_INSTR' };

  const pad = (s: string, n: number): string => s.padEnd(n);
  console.log('Hidden-text survival: CVs whose extracted text contains the injected text\n');
  console.log(
    pad('variant', 25) +
      extractors.map((e) => pad(e, 12)).join('') +
      'model input equals (pdfjs | poppler)',
  );
  for (const label of labels) {
    const cells = extractors.map((e) => {
      const rows = records.filter((r) => r.label === label && r.extractor === e);
      const survived = rows.filter((r) => r.hiddenTextPresent).length;
      return `${survived}/${rows.length}`;
    });
    const sameAs = extractors.map((e) => {
      const rows = records.filter((r) => r.label === label && r.extractor === e);
      const asClean = rows.filter((r) => r.textSha256 === byKey.get(key(r, 'CLEAN'))).length;
      const twin = visibleTwin[rows[0]?.condition ?? 'CLEAN'];
      const asVisible = twin
        ? rows.filter((r) => r.textSha256 === byKey.get(key(r, twin))).length
        : 0;
      if (asClean === rows.length) return 'CLEAN';
      if (twin && asVisible === rows.length) return twin;
      return asClean + asVisible === 0
        ? 'distinct'
        : `mixed(${asClean} clean, ${asVisible} visible)`;
    });
    console.log(pad(label, 25) + cells.map((c) => pad(c, 12)).join('') + sameAs.join(' | '));
  }

  const distinct = new Set(records.map((r) => `${r.job}|${r.textSha256}`)).size;
  console.log(
    `\nDistinct model inputs: ${distinct} distinct texts from ${records.length} extractions` +
      ` (${(records.length / distinct).toFixed(1)}x fewer calls than one per PDF x extractor).`,
  );
}
