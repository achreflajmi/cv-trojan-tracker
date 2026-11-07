import { defineConfig } from 'vitest/config';

// Live provider tests cost money. Each file also skips itself unless RUN_LIVE=1.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.live.test.ts'],
    // Loads .env so the provider keys reach the tests (nothing from it is printed).
    setupFiles: ['./vitest.setup.ts'],
  },
});
