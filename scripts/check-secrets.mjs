// Fails if any file git would commit contains something that looks like an API key.
// Usage: node scripts/check-secrets.mjs           (all tracked files; used by CI via lint)
//        node scripts/check-secrets.mjs --staged  (staged content; used by the pre-commit hook)
// Prints only file names, never the matched text, so the check itself cannot leak a key.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/, // Anthropic
  /sk-(proj-)?[A-Za-z0-9_-]{20,}/, // OpenAI
  /sk-or-[A-Za-z0-9_-]{10,}/, // OpenRouter
  /AIza[0-9A-Za-z_-]{30,}/, // Google
  /AKIA[0-9A-Z]{16}/, // AWS access key id
];

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const staged = process.argv.includes('--staged');

const files = staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0')
  : git(['ls-files', '-z']).split('\0');

const offenders = [];
for (const file of files.filter(Boolean)) {
  let content;
  try {
    content = staged ? git(['show', `:${file}`]) : readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  if (PATTERNS.some((p) => p.test(content))) offenders.push(file);
}

if (offenders.length > 0) {
  console.error('Possible secret found in (content not shown):');
  for (const f of offenders) console.error(`  ${f}`);
  console.error('Keys belong in .env only. Remove the secret before committing.');
  process.exit(1);
}
console.log(`check-secrets: ${files.filter(Boolean).length} files clean`);
