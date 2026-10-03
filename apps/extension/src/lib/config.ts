/** Build-time configuration (WXT exposes WXT_* env vars). Production builds override these. */
export const API_BASE: string = import.meta.env.WXT_API_BASE ?? 'http://localhost:4000/api/v1';

/** Only these origins may message the extension (mirrors manifest externally_connectable). */
export const DASHBOARD_ORIGINS: string[] = (
  import.meta.env.WXT_DASHBOARD_ORIGINS ?? 'http://localhost:5173'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

export const DASHBOARD_URL: string = DASHBOARD_ORIGINS[0] ?? 'http://localhost:5173';
