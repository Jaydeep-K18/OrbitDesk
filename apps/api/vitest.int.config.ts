import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.int.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    setupFiles: ['tests/setup/env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
