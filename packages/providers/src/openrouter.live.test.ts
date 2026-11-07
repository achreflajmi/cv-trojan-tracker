import { describe, it } from 'vitest';
import { oneLiveTrial, skipLive } from './test-live.ts';

// Costs money (one call). Runs only with RUN_LIVE=1 and the key in .env, after the owner
// has confirmed a budget. LIVE_OPENROUTER_MODEL=<key in config/models.yaml> picks the model.
describe.skipIf(skipLive('openrouter'))('OpenRouter adapter (live)', () => {
  it('one trial returns a schema-valid score', async () => {
    await oneLiveTrial('openrouter');
  });
});
