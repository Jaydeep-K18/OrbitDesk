// Builds the extension for E2E: points it at the E2E API/dashboard and pins the dev key
// so its ID matches the dashboard's EXTENSION_ID.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E } from '../env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
execSync('pnpm exec wxt build', {
  cwd: path.join(root, 'apps/extension'),
  stdio: 'inherit',
  env: {
    ...process.env,
    WXT_API_BASE: `${E2E.apiOrigin}/api/v1`,
    WXT_DASHBOARD_ORIGINS: E2E.webOrigin,
    FG_PIN_KEY: '1',
    FG_OUT_DIR: '.output-e2e',
  },
});
