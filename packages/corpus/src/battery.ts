import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadYaml } from '@ctt/shared';
import { Common, Injections, Job, Names, type CvVariant } from './types.ts';

export interface Battery {
  jobs: Job[];
  common: Common;
  names: Names;
  injections: Injections;
}

export function loadBattery(dir = 'battery'): Battery {
  const jobsDir = join(dir, 'jobs');
  const jobs = readdirSync(jobsDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => loadYaml(join(jobsDir, f), Job));
  return {
    jobs,
    common: loadYaml(join(dir, 'common.yaml'), Common),
    names: loadYaml(join(dir, 'names.yaml'), Names),
    injections: loadYaml(join(dir, 'injections.yaml'), Injections),
  };
}

/**
 * Neutral filler of about the same length as the DATA text (never longer), cut at a
 * word boundary, so HIDDEN_NEUTRAL differs from DATA only in content.
 */
export function neutralText(common: Common, targetLength: number): string {
  let text = '';
  for (let i = 0; text.length < targetLength; i++) {
    const sentence = common.neutral_sentences[i % common.neutral_sentences.length] ?? '';
    text = text ? `${text} ${sentence}` : sentence;
  }
  const cut = text.slice(0, targetLength);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[ ,]+$/, '');
}

/** The exact text added to a CV for a variant (hidden or visible), or null for CLEAN. */
export function injectedText(
  job: Job,
  variant: CvVariant,
  battery: Pick<Battery, 'common' | 'injections'>,
): string | null {
  const keywords = job.key_requirements.join(', ');
  switch (variant.condition) {
    case 'CLEAN':
      return null;
    case 'DATA':
    case 'VIS_DATA':
      return keywords;
    case 'INSTR':
    case 'VIS_INSTR':
      return battery.injections.instruction;
    case 'HIDDEN_NEUTRAL':
      return neutralText(battery.common, keywords.length);
  }
}
