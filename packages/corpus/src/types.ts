import { z } from 'zod';

export const Job = z.strictObject({
  slug: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  text: z.string().min(1),
  /** The job's key requirements; the DATA condition hides a copy of these. */
  key_requirements: z.array(z.string().min(1)).min(1),
});
export type Job = z.infer<typeof Job>;

export const Profile = z.strictObject({
  id: z.string().min(1),
  fit_band: z.enum(['strong', 'medium', 'weak']),
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

export type Condition = 'CLEAN' | 'DATA' | 'INSTR' | 'VIS_DATA' | 'HIDDEN_NEUTRAL' | 'VIS_INSTR';
export type HidingMethod = 'WHITE' | 'TINY' | 'OFFPAGE' | 'RENDER3' | 'OCG_OFF';

export interface CvVariant {
  condition: Condition;
  /** Required for hidden conditions, absent for CLEAN and visible conditions. */
  hiding?: HidingMethod;
}
