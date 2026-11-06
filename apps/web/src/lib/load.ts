import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Results } from './results.ts';

/**
 * Build time only: the file prepare-data.mjs picked (real results or the sample).
 * Sections an older results file may lack default to empty instead of breaking the build.
 */
export function loadResults(): Results {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'generated', 'results.json'), 'utf8'),
  ) as Partial<Results>;
  if (!raw.settings || !raw.meta)
    throw new Error('generated/results.json is not a ctt-analyze results file');
  return {
    settings: raw.settings,
    meta: raw.meta,
    cells: raw.cells ?? [],
    aa: raw.aa ?? [],
    rank_cells: raw.rank_cells ?? [],
    survival: raw.survival ?? [],
  };
}
