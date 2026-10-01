import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], passWithNoTests: false },
});
