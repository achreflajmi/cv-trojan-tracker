// Child process for the kill/resume test: runs all pending trials of a run with a
// slow fake adapter. The test kills it with SIGKILL part-way through, then starts it again.
// Usage: node kill-worker.ts <schema> <runId> <msPerCall>
import { createPool } from '@ctt/db';
import { runPending } from '../execute.ts';
import { buildFakeRequest, slowFake, TEST_PRICES } from './fixture.ts';

const [schema, runId, ms] = process.argv.slice(2);
if (!schema || !runId || !ms) throw new Error('usage: kill-worker.ts <schema> <runId> <msPerCall>');

const db = createPool(undefined, schema);
const counts = await runPending({
  db,
  runId: Number(runId),
  adapter: slowFake(Number(ms)),
  prices: TEST_PRICES,
  buildRequest: buildFakeRequest,
});
console.log(JSON.stringify(counts));
await db.end();
