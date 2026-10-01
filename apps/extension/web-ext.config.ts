import { defineWebExtConfig } from 'wxt';

// Don't auto-launch a browser on `pnpm dev`; load .output/chrome-mv3-dev as an unpacked
// extension from chrome://extensions instead (see README).
export default defineWebExtConfig({ disabled: true });
