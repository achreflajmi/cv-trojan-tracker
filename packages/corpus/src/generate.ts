import { Rng } from './rng.ts';
import type { Common, FitBand, Job, Names, Profile } from './types.ts';

export const PROFILES_PER_BAND = 12;
/** Profiles describe careers up to this year, so output never depends on today's date. */
export const REFERENCE_YEAR = 2026;
const BANDS: readonly FitBand[] = ['strong', 'medium', 'weak'];

/**
 * Fit is decided by rules, never by a model (SPEC 3.1):
 * - strong: 7-9 of the 10 key requirements, relevant titles, required_years + 1..3
 * - medium: 3-5 key requirements, adjacent titles, about required_years - 1
 * - weak:   0-1 key requirements, unrelated titles and degree
 */
const RULES = {
  strong: { keySkills: [7, 9], titles: 'relevant_titles', degrees: 'relevant_degrees' },
  medium: { keySkills: [3, 5], titles: 'adjacent_titles', degrees: 'adjacent_degrees' },
  weak: { keySkills: [0, 1], titles: 'unrelated_titles', degrees: 'unrelated_degrees' },
} as const;

export function generateProfiles(job: Job, common: Common, names: Names): Profile[] {
  const profiles: Profile[] = [];
  const usedNames = new Set<string>();
  for (const band of BANDS) {
    for (let i = 0; i < PROFILES_PER_BAND; i++) {
      const id = `${job.slug}-${band}-${String(i + 1).padStart(2, '0')}`;
      const seed = `${job.slug}@${job.version}|common@${common.version}|${id}`;
      profiles.push(generateProfile(job, common, names, band, id, seed, usedNames));
    }
  }
  return profiles;
}

function years(job: Job, band: FitBand, rng: Rng): number {
  switch (band) {
    case 'strong':
      return job.required_years + rng.int(1, 3);
    case 'medium':
      return Math.max(1, job.required_years - 1) + rng.int(0, 1);
    case 'weak':
      return rng.int(1, 4);
  }
}

function generateProfile(
  job: Job,
  common: Common,
  names: Names,
  band: FitBand,
  id: string,
  seed: string,
  usedNames: Set<string>,
): Profile {
  const rng = new Rng(seed);
  const rule = RULES[band];

  // Names are unique within a job, so no two candidates in a pool share one.
  let name: string;
  do {
    name = `${rng.pick(names.first_names)} ${rng.pick(names.last_names)}`;
  } while (usedNames.has(name));
  usedNames.add(name);

  const keySkills = rng.sample(job.key_requirements, rng.int(rule.keySkills[0], rule.keySkills[1]));
  const otherSkills =
    band === 'weak'
      ? rng.sample(job.vocab.unrelated_skills, 3)
      : rng.sample(job.vocab.adjacent_skills, band === 'strong' ? 2 : 3);
  const totalYears = years(job, band, rng);

  // One role, or two roles when there are at least 3 years to split.
  const roleYears =
    totalYears >= 3 ? [Math.ceil(totalYears / 2), Math.floor(totalYears / 2)] : [totalYears];
  const orgs = rng.sample(common.orgs, roleYears.length);
  const titles = job.vocab[rule.titles];
  const experience: Profile['experience'] = [];
  let end = REFERENCE_YEAR;
  roleYears.forEach((y, i) => {
    const start = end - y;
    const bulletSkills = band === 'weak' ? [] : rng.sample([...keySkills, ...otherSkills], 2);
    const bullets =
      bulletSkills.length > 0
        ? bulletSkills.map((s) => rng.pick(common.skill_bullets).replace('{skill}', s))
        : rng.sample(common.generic_bullets, 2);
    experience.push({
      title: rng.pick(titles),
      org: orgs[i] ?? rng.pick(common.orgs),
      start: String(start),
      end: i === 0 ? 'present' : String(end),
      bullets,
    });
    end = start;
  });

  const degree = rng.pick(job.vocab[rule.degrees]);
  const latestTitle = experience[0]?.title ?? titles[0];
  const summary = {
    strong: `${latestTitle} with ${totalYears} years of experience, including ${keySkills.slice(0, 3).join(', ')}.`,
    medium: `${degree} graduate with ${totalYears} year${totalYears === 1 ? '' : 's'} of experience as ${latestTitle}. Interested in moving into a ${job.title} role.`,
    weak: `${latestTitle} with ${totalYears} year${totalYears === 1 ? '' : 's'} of experience. Looking for a new challenge.`,
  }[band];

  const [first, last] = name.split(' ');
  return {
    id,
    seed,
    fit_band: band,
    name,
    email: `${first}.${last}@example.com`.toLowerCase(),
    location: rng.pick(common.cities),
    summary,
    experience,
    education: [{ degree, institution: rng.pick(common.institutions), year: end - rng.int(0, 1) }],
    skills: [...keySkills, ...otherSkills],
  };
}
