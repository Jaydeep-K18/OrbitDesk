/** Categories whose page titles are never collected or sent to any model (ROADMAP 1.5). */
export const SENSITIVE_CATEGORIES = ['finance', 'health', 'email', 'messaging', 'adult'] as const;

export function isSensitiveCategory(category: string | null | undefined): boolean {
  return !!category && (SENSITIVE_CATEGORIES as readonly string[]).includes(category);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS_RE = /\d[\d\s-]{4,}\d/g;
const MAX_TITLE = 200;

/**
 * Scrubs a page title before storage: removes email addresses and digit runs of 6+
 * (phone, account, order numbers), collapses whitespace and truncates to 200 chars.
 */
export function scrubTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  let t = title.replace(EMAIL_RE, '[email]');
  t = t.replace(LONG_DIGITS_RE, (m) => (m.replace(/\D/g, '').length >= 6 ? '[number]' : m));
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
}
