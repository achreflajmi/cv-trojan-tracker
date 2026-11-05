import { z } from 'zod';

const words = z.array(z.string().min(1)).min(1);

export const Job = z.strictObject({
  slug: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  /** Years of experience the job asks for; the generator sets fit bands around it. */
  required_years: z.number().int().nonnegative(),
  text: z.string().min(1),
  /** The job's key requirements; the DATA condition hides a copy of these. */
  key_requirements: z.array(z.string().min(1)).length(10),
  vocab: z.strictObject({
    relevant_titles: words,
    adjacent_titles: words,
    unrelated_titles: words,
    relevant_degrees: words,
    adjacent_degrees: words,
    unrelated_degrees: words,
    adjacent_skills: words,
    unrelated_skills: words,
  }),
});
export type Job = z.infer<typeof Job>;

export const Common = z.strictObject({
  version: z.number().int().positive(),
  orgs: words,
  institutions: words,
  cities: words,
  skill_bullets: words,
  generic_bullets: words,
  neutral_sentences: words,
});
export type Common = z.infer<typeof Common>;

export const Names = z.strictObject({ first_names: words, last_names: words });
export type Names = z.infer<typeof Names>;

export const Injections = z.strictObject({
  version: z.number().int().positive(),
  instruction: z.string().min(1),
});
export type Injections = z.infer<typeof Injections>;

export const FitBand = z.enum(['strong', 'medium', 'weak']);
export type FitBand = z.infer<typeof FitBand>;

export const Profile = z.strictObject({
  id: z.string().min(1),
  seed: z.string().min(1),
  fit_band: FitBand,
  name: z.string().min(1),
  email: z.string().min(1),
  location: z.string().min(1),
  summary: z.string().min(1),
  experience: z.array(
    z.strictObject({
      title: z.string(),
      org: z.string(),
      start: z.string(),
      end: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.strictObject({ degree: z.string(), institution: z.string(), year: z.number().int() }),
  ),
  skills: z.array(z.string()),
});
export type Profile = z.infer<typeof Profile>;

export const CONDITIONS = [
  'CLEAN',
  'DATA',
  'INSTR',
  'VIS_DATA',
  'HIDDEN_NEUTRAL',
  'VIS_INSTR',
] as const;
export type Condition = (typeof CONDITIONS)[number];
export const HIDING_METHODS = ['WHITE', 'TINY', 'OFFPAGE', 'RENDER3', 'OCG_OFF'] as const;
export type HidingMethod = (typeof HIDING_METHODS)[number];

/** Conditions whose injected text is hidden (need a hiding method). */
export const HIDDEN_CONDITIONS: readonly Condition[] = ['DATA', 'INSTR', 'HIDDEN_NEUTRAL'];

export interface CvVariant {
  condition: Condition;
  /** Required for hidden conditions, absent for CLEAN and visible conditions. */
  hiding?: HidingMethod;
}

/** Every variant generated per profile: CLEAN, 2 visible, 3 hidden x 5 methods = 18. */
export function allVariants(): CvVariant[] {
  const variants: CvVariant[] = [
    { condition: 'CLEAN' },
    { condition: 'VIS_DATA' },
    { condition: 'VIS_INSTR' },
  ];
  for (const condition of HIDDEN_CONDITIONS) {
    for (const hiding of HIDING_METHODS) variants.push({ condition, hiding });
  }
  return variants;
}

export function variantLabel(v: CvVariant): string {
  return v.hiding ? `${v.condition}-${v.hiding}` : v.condition;
}
