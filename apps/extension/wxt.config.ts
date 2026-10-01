import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

// Stable dev key → stable extension ID (see scripts/gen-dev-key.mjs).
const devKey = readFileSync(new URL('./keys/dev-key.pub', import.meta.url), 'utf8').trim();

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: ({ mode }) => ({
    name: 'FocusGuard',
    description:
      'Blocks distractions during your FocusGuard sessions and shows your remaining focus time.',
    // The Chrome Web Store assigns its own key; only dev/unpacked builds pin one.
    ...(mode === 'development' || process.env.FG_PIN_KEY === '1' ? { key: devKey } : {}),
    minimum_chrome_version: '120',
  }),
});
