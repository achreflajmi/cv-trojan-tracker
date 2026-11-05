import { describe, expect, it } from 'vitest';
import { neutralText, loadBattery } from './battery.ts';
import { generateProfiles, PROFILES_PER_BAND } from './generate.ts';
import { renderCv } from './render.ts';
import { Rng } from './rng.ts';
import { allVariants } from './types.ts';

const battery = loadBattery();

describe('Rng', () => {
  it('gives the same sequence for the same seed and a different one otherwise', () => {
    const a = new Rng('seed');
    const b = new Rng('seed');
    const c = new Rng('other');
    const seq = (r: Rng) => Array.from({ length: 5 }, () => r.next());
    const sa = seq(a);
    expect(seq(b)).toEqual(sa);
    expect(seq(c)).not.toEqual(sa);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe.each(battery.jobs.map((j) => [j.slug, j] as const))('generator for %s', (_, job) => {
  const profiles = generateProfiles(job, battery.common, battery.names);

  it('is deterministic: same seed, same profile', () => {
    expect(generateProfiles(job, battery.common, battery.names)).toEqual(profiles);
  });

  it('makes 12 strong, 12 medium and 12 weak profiles with unique names', () => {
    for (const band of ['strong', 'medium', 'weak']) {
      expect(profiles.filter((p) => p.fit_band === band)).toHaveLength(PROFILES_PER_BAND);
    }
    expect(new Set(profiles.map((p) => p.name)).size).toBe(profiles.length);
  });

  it('sets fit by rule: key requirements on the CV per band', () => {
    const keyCount = (skills: string[]) =>
      skills.filter((s) => job.key_requirements.includes(s)).length;
    for (const p of profiles) {
      const n = keyCount(p.skills);
      if (p.fit_band === 'strong') expect(n).toBeGreaterThanOrEqual(7);
      if (p.fit_band === 'medium') expect(n).toBeGreaterThanOrEqual(3);
      if (p.fit_band === 'medium') expect(n).toBeLessThanOrEqual(5);
      if (p.fit_band === 'weak') expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('fits every variant of the longest CV on one page', async () => {
    const longest = [...profiles].sort(
      (a, b) => JSON.stringify(b).length - JSON.stringify(a).length,
    )[0];
    if (!longest) throw new Error('no profiles');
    for (const v of allVariants())
      await expect(renderCv(longest, job, v, battery)).resolves.toBeTruthy();
  });

  it('makes HIDDEN_NEUTRAL text about as long as DATA text, never longer', () => {
    const dataLength = job.key_requirements.join(', ').length;
    const neutral = neutralText(battery.common, dataLength);
    expect(neutral.length).toBeLessThanOrEqual(dataLength);
    expect(neutral.length).toBeGreaterThan(dataLength - 20);
  });
});
