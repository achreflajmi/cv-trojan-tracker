// Picks the results file the static site is built from, and copies the downloadable
// dataset into public/data. Real results win; otherwise the clearly marked sample.
//   RESULTS_DIR (default ../../data/results) must contain results.json from `ctt-analyze`
//   EXPORT_DIR  (default ../../data/export)  holds calls.csv, survival.csv, rank.csv, meta.json
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const resultsDir = process.env.RESULTS_DIR ?? '../../data/results';
const exportDir = process.env.EXPORT_DIR ?? '../../data/export';
const real = join(resultsDir, 'results.json');
const sample = 'fixtures/results.sample.json';

mkdirSync('generated', { recursive: true });
rmSync('public/data', { recursive: true, force: true });
mkdirSync('public/data', { recursive: true });

if (existsSync(real)) {
  copyFileSync(real, 'generated/results.json');
  copyFileSync(real, 'public/data/results.json');
  for (const f of ['calls.csv', 'survival.csv', 'rank.csv', 'meta.json']) {
    if (existsSync(join(exportDir, f))) copyFileSync(join(exportDir, f), join('public/data', f));
  }
  console.log(`web: building from real results (${real})`);
} else {
  copyFileSync(sample, 'generated/results.json');
  copyFileSync(sample, 'public/data/results.sample.json');
  console.log('web: no real results found, building from the SAMPLE fixture (banner shown)');
}
