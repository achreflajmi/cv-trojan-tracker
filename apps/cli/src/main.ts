import { parseArgs } from 'node:util';
import { z } from 'zod';
import { extract, generate, survival } from './corpus.ts';
import { runStage1 } from './stage1.ts';

const USAGE = `Usage: pnpm ctt <command> [options]

Commands:
  generate   Build profiles and PDFs for all jobs, conditions and hiding methods
  extract    Run both extractors on every PDF and record hidden-text survival
  survival   Print the method x extractor survival table
  stage1 --model <key> [--confirm-budget <EUR>] [--out <dir>]
             Render CLEAN and DATA/WHITE CVs, extract with pdf.js, score each once`;

const Eur = z.coerce.number().positive();

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      model: { type: 'string' },
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
    case 'stage1': {
      if (!values.model) throw new Error('--model is required');
      const budget = values['confirm-budget'];
      await runStage1({
        modelKey: values.model,
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
