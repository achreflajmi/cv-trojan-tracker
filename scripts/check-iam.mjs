// Fails if any IAM policy in infra/*.tf grants a wildcard ACTION (CLAUDE.md: least
// privilege, never wildcard IAM actions). Wildcard RESOURCES are reported for review,
// not failed: some actions (ecr:GetAuthorizationToken) cannot be resource-scoped.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'infra';
let failed = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tf'))) {
  const text = readFileSync(join(dir, file), 'utf8');
  // `actions = [ ... ]` (policy documents) and `Action = "..."` / `Action = [...]` (jsonencode)
  const blocks = [...text.matchAll(/\b(?:actions|Action)\s*=\s*(\[[^\]]*\]|"[^"]*")/g)];
  for (const [, value] of blocks) {
    for (const [, action] of value.matchAll(/"([^"]*)"/g)) {
      if (action.includes('*')) {
        console.error(`${file}: wildcard IAM action "${action}"`);
        failed = true;
      }
    }
  }
  const wildResources = [...text.matchAll(/resources\s*=\s*\["\*"\]/g)].length;
  if (wildResources > 0)
    console.log(`${file}: ${wildResources} statement(s) with Resource "*" (review)`);
}
if (failed) process.exit(1);
console.log('check-iam: no wildcard IAM actions');
