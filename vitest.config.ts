import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    // Live provider tests cost money; they live in *.live.test.ts and run only via test:live.
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
  },
});
