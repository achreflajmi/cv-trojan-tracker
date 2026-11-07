import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { loadYaml } from '@ctt/shared';

const run = promisify(execFile);

const ExtractorsConfig = z.strictObject({
  poppler: z.strictObject({
    pdftotext: z.record(z.string(), z.string()),
    args: z.array(z.string()),
  }),
});

export interface Poppler {
  path: string;
  version: string;
  args: string[];
}

/**
 * Locate pdftotext and prove it is poppler. xpdf's pdftotext prints
 * "Copyright ... Glyph & Cog", poppler's prints "The Poppler Developers".
 */
export async function findPoppler(configPath = 'config/extractors.yaml'): Promise<Poppler> {
  const config = loadYaml(configPath, ExtractorsConfig).poppler;
  const path = process.env.PDFTOTEXT_PATH ?? config.pdftotext[process.platform];
  if (!path) throw new Error(`No pdftotext path for platform ${process.platform}`);
  let banner: string;
  try {
    const { stdout, stderr } = await run(path, ['-v']);
    banner = stdout + stderr;
  } catch (error) {
    throw new Error(`Cannot run ${path}: ${(error as Error).message}`, { cause: error });
  }
  if (!/poppler/i.test(banner)) {
    throw new Error(`${path} is not poppler's pdftotext (xpdf?). Banner: ${banner.trim()}`);
  }
  const version = /pdftotext version ([\d.]+)/.exec(banner)?.[1];
  if (!version) throw new Error(`Cannot read the pdftotext version from: ${banner.trim()}`);
  return { path, version, args: config.args };
}

export async function extractWithPoppler(pdf: Uint8Array, poppler: Poppler): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ctt-poppler-'));
  try {
    const file = join(dir, 'cv.pdf');
    await writeFile(file, pdf);
    const { stdout } = await run(poppler.path, [...poppler.args, file, '-'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    // pdftotext ends each page with a form feed; it carries no content.
    return stdout.replaceAll('\f', '').trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
