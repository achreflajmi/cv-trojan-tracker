import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createPool, migrate } from '@ctt/db';
import { extract, generate, survival } from './corpus.ts';
import { ingest, plan, run, status } from './engine.ts';
import { exportExperiment } from './export.ts';
import { runStage1 } from './stage1.ts';

const USAGE = `Usage: pnpm ctt <command> [options]

Commands:
  generate   Build profiles and PDFs for all jobs, conditions and hiding methods
  extract    Run both extractors on every PDF and record hidden-text survival
  survival   Print the method x extractor survival table
  migrate    Apply pending database migrations (DATABASE_URL)
  ingest     Load the generated corpus into the database
  plan   --experiment <name> --model <key>
             Number of calls and estimated cost (upper bound and typical)
  run    --experiment <name> --model <key> --confirm-budget <EUR>
             Run (or resume) an experiment for one model; needs REDIS_URL
  status --run <id>
             Progress and spend of a run
  export --experiment <name> [--out <dir>]
             CSV + JSON for analysis/ and apps/web (default data/export)
  stage1 --model <key> [--confirm-budget <EUR>] [--out <dir>]
             Render CLEAN and DATA/WHITE CVs, extract with pdf.js, score each once`;

const Eur = z.coerce.number().positive();
const Id = z.coerce.number().int().positive();

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`--${flag} is required`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      model: { type: 'string' },
      experiment: { type: 'string' },
      run: { type: 'string' },
      'confirm-budget': { type: 'string' },
      out: { type: 'string', default: 'data/stage1' },
    },
  });

  switch (command) {
    case 'generate':
      return generate();
    case 'extract':
      return extract();
    case 'survival':
      return survival();
    case 'migrate': {
      const pool = createPool();
      const client = await pool.connect();
      try {
        const ran = await migrate(client);
        console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
      } finally {
        client.release();
        await pool.end();
      }
      return;
    }
    case 'ingest':
      return ingest();
    case 'plan':
      return plan(required(values.experiment, 'experiment'), required(values.model, 'model'));
    case 'run':
      return run(
        required(values.experiment, 'experiment'),
        required(values.model, 'model'),
        Eur.parse(required(values['confirm-budget'], 'confirm-budget')),
      );
    case 'status':
      return status(Id.parse(required(values.run, 'run')));
    case 'export':
      return exportExperiment(
        required(values.experiment, 'experiment'),
        values.out === 'data/stage1' ? 'data/export' : values.out,
      );
    case 'stage1': {
      const budget = values['confirm-budget'];
      await runStage1({
        modelKey: required(values.model, 'model'),
        outDir: values.out,
        ...(budget === undefined ? {} : { confirmBudgetEur: Eur.parse(budget) }),
      });
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
