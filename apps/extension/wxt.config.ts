import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

// Stable dev key → stable extension ID (see scripts/gen-dev-key.mjs).
const devKey = readFileSync(new URL('./keys/dev-key.pub', import.meta.url), 'utf8').trim();
const dashboardOrigins = (process.env.WXT_DASHBOARD_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.FG_OUT_DIR ?? '.output',
  manifestVersion: 3,
  manifest: ({ mode }) => ({
    name: 'FocusGuard',
    description:
      'Blocks distractions during your FocusGuard sessions and shows your remaining focus time.',
    // The Chrome Web Store assigns its own key; only dev/unpacked builds pin one.
    ...(mode === 'development' || process.env.FG_PIN_KEY === '1' ? { key: devKey } : {}),
    minimum_chrome_version: '120',
    // Least privilege with justification (ROADMAP 1.4 manifest table).
    permissions: ['declarativeNetRequest', 'storage', 'alarms', 'tabs', 'idle', 'webNavigation'],
    host_permissions: ['<all_urls>'],
    externally_connectable: { matches: dashboardOrigins.map((o) => `${o}/*`) },
    web_accessible_resources: [{ resources: ['blocked.html'], matches: ['<all_urls>'] }],
    action: { default_title: 'FocusGuard: click to show remaining time' },
  }),
});
