import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateProfiles,
  HIDING_METHODS,
  injectedText,
  loadBattery,
  renderCv,
  type HidingMethod,
} from '@ctt/corpus';
import { sha256 } from '@ctt/shared';
import {
  extractWithPdfjs,
  extractWithPoppler,
  findPoppler,
  hiddenTextPresent,
  type Poppler,
} from './index.ts';

const run = promisify(execFile);
const battery = loadBattery();
const job = battery.jobs[0];
if (!job) throw new Error('no jobs in battery/jobs');
const profile = generateProfiles(job, battery.common, battery.names)[0];
if (!profile) throw new Error('generator returned no profiles');

/**
 * Measured behaviour (pdf.js 6.5, poppler 26.09; see `pnpm ctt survival`). If an
 * extractor upgrade changes this, the test fails and the change must be reviewed:
 * it changes what the model sees.
 */
const EXPECTED_SURVIVAL: Record<HidingMethod, { pdfjs: boolean; poppler: boolean }> = {
  WHITE: { pdfjs: true, poppler: true },
  TINY: { pdfjs: true, poppler: true },
  OFFPAGE: { pdfjs: false, poppler: false },
  RENDER3: { pdfjs: true, poppler: true },
  OCG_OFF: { pdfjs: true, poppler: false },
};
/** TINY text is <= 1 pt: practically invisible, but it does leave a few pixels. */
const PIXEL_IDENTICAL_TO_CLEAN: Record<HidingMethod, boolean> = {
  WHITE: true,
  TINY: false,
  OFFPAGE: true,
  RENDER3: true,
  OCG_OFF: true,
};

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim();

let poppler: Poppler;
let dir: string;

async function renderPng(pdf: Uint8Array, name: string): Promise<string> {
  const pdfPath = join(dir, `${name}.pdf`);
  await writeFile(pdfPath, pdf);
  const pdftoppm = join(
    dirname(poppler.path),
    `pdftoppm${process.platform === 'win32' ? '.exe' : ''}`,
  );
  await run(pdftoppm, ['-r', '72', '-png', '-singlefile', pdfPath, join(dir, name)]);
  return sha256(await readFile(join(dir, `${name}.png`)));
}

beforeAll(async () => {
  poppler = await findPoppler();
  dir = await mkdtemp(join(tmpdir(), 'ctt-hiding-'));
  return () => rm(dir, { recursive: true, force: true });
});

describe.each(HIDING_METHODS)('hiding method %s', (method) => {
  const variant = { condition: 'DATA', hiding: method } as const;
  const hidden = injectedText(job, variant, battery) ?? '';

  it('opens, and the visible text is exactly the CLEAN text', async () => {
    const clean = await extractWithPdfjs(
      await renderCv(profile, job, { condition: 'CLEAN' }, battery),
    );
    const text = await extractWithPdfjs(await renderCv(profile, job, variant, battery));
    const withoutHidden = normalise(text).replace(normalise(hidden), '');
    expect(normalise(withoutHidden)).toBe(normalise(clean));
  });

  it('hidden text reaches each extractor as recorded', async () => {
    const pdf = await renderCv(profile, job, variant, battery);
    expect({
      pdfjs: hiddenTextPresent(await extractWithPdfjs(pdf), hidden),
      poppler: hiddenTextPresent(await extractWithPoppler(pdf, poppler), hidden),
    }).toEqual(EXPECTED_SURVIVAL[method]);
  });

  it('is invisible on the rendered page (pixel comparison with CLEAN)', async () => {
    const clean = await renderPng(
      await renderCv(profile, job, { condition: 'CLEAN' }, battery),
      'clean',
    );
    const injected = await renderPng(await renderCv(profile, job, variant, battery), method);
    expect(injected === clean).toBe(PIXEL_IDENTICAL_TO_CLEAN[method]);
  });
});

describe('visible conditions', () => {
  it('VIS_DATA is visible on the page', async () => {
    const clean = await renderPng(
      await renderCv(profile, job, { condition: 'CLEAN' }, battery),
      'c2',
    );
    const visible = await renderPng(
      await renderCv(profile, job, { condition: 'VIS_DATA' }, battery),
      'v',
    );
    expect(visible).not.toBe(clean);
  });
});

describe('poppler detection', () => {
  it('rejects a binary that is not poppler', async () => {
    const previous = process.env.PDFTOTEXT_PATH;
    process.env.PDFTOTEXT_PATH = process.execPath; // node itself: runs, but is not poppler
    try {
      await expect(findPoppler()).rejects.toThrow(/not poppler|Cannot/);
    } finally {
      if (previous === undefined) delete process.env.PDFTOTEXT_PATH;
      else process.env.PDFTOTEXT_PATH = previous;
    }
  });
});
