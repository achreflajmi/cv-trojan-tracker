import { z } from 'zod';
import { loadYaml } from '@ctt/shared';

export const Experiment = z
  .strictObject({
    name: z.string().regex(/^[a-z0-9-]+$/),
    prompt: z.string().min(1),
    prompt_version: z.string().min(1),
    task: z.literal('score'), // the rank task (SPEC 3.5) is planned before Stage 9
    jobs: z.array(z.string().min(1)).min(1),
    fit_bands: z.array(z.enum(['strong', 'medium', 'weak'])).min(1),
    conditions: z
      .array(z.enum(['CLEAN', 'DATA', 'INSTR', 'VIS_DATA', 'HIDDEN_NEUTRAL', 'VIS_INSTR']))
      .min(1),
    hiding_methods: z.array(z.enum(['WHITE', 'TINY', 'OFFPAGE', 'RENDER3', 'OCG_OFF'])),
    extractors: z.array(z.enum(['pdfjs', 'poppler'])).min(1),
    include_aa: z.boolean(),
    stopping: z.strictObject({
      min_repeats: z.number().int().min(2), // a t-interval needs 2+ points per profile mean
      max_repeats: z.number().int().positive(),
      target_half_width: z.number().positive(),
    }),
  })
  .refine((e) => e.conditions.includes('CLEAN'), {
    message: 'CLEAN is the reference for every lift and must be included',
  })
  .refine((e) => e.stopping.min_repeats <= e.stopping.max_repeats, {
    message: 'min_repeats must be <= max_repeats',
  });
export type Experiment = z.infer<typeof Experiment>;

export function loadExperiment(name: string): Experiment {
  const experiment = loadYaml(`config/experiments/${name}.yaml`, Experiment);
  if (experiment.name !== name)
    throw new Error(`config/experiments/${name}.yaml has name ${experiment.name}`);
  return experiment;
}

export const BudgetConfig = z.strictObject({
  per_run_cap_eur: z.number().positive(),
  monthly_cap_eur: z.number().positive(),
});
export type BudgetConfig = z.infer<typeof BudgetConfig>;
