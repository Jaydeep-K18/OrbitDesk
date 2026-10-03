import { defineConfig } from '@playwright/test';
import { E2E } from './env.mjs';

/**
 * Full-stack E2E (ROADMAP 1.4 / Phase 9): real API + web + the unpacked extension in Chromium.
 * Runs on its own ports and database so it never touches the dev stack.
 */
const serverEnv = {
  PORT: String(E2E.apiPort),
  DATABASE_URL: E2E.databaseUrl,
  APP_ORIGIN: E2E.webOrigin,
  LOG_LEVEL: 'warn',
  NODE_ENV: 'development',
  LIFECYCLE_INTERVAL_MS: '2000',
  FINALIZE_GRACE_SEC: '3',
  EXTENSION_ORIGINS: `chrome-extension://${E2E.extensionId}`,
};

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: E2E.webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @focusguard/api exec tsx src/server.ts',
      url: `${E2E.apiOrigin}/api/v1/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @focusguard/web exec vite',
      url: E2E.webOrigin,
      env: { FG_WEB_PORT: String(E2E.webPort), FG_API_PROXY: E2E.apiOrigin },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
