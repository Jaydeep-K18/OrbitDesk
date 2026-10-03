/**
 * declarativeNetRequest rule builder (ROADMAP 1.4). Pure: no chrome.* calls.
 *  - main_frame on a blocked domain (incl. every subdomain/subpage) → redirect to blocked.html
 *  - sub_frame embeds of blocked domains → block
 *  - a relevant subdomain of a blocked domain (block google.com, allow docs.google.com) → allow
 */
import { hostMatches } from '@focusguard/domain/domains';

export const RULE_ID_MIN = 1000;
export const RULE_ID_MAX = 1999;
const ALLOW_ID_BASE = 1500;
const SUBFRAME_RULE_ID = 1999;

export interface DnrRule {
  id: number;
  priority: number;
  action:
    | { type: 'redirect'; redirect: { extensionPath: string } }
    | { type: 'block' }
    | { type: 'allow' };
  condition: { requestDomains: string[]; resourceTypes: ('main_frame' | 'sub_frame')[] };
}

export function buildRules(
  blockedHosts: string[],
  relevantHosts: string[],
  sessionId: string,
): DnrRule[] {
  const blocked = [...new Set(blockedHosts)].sort();
  if (blocked.length === 0) return [];
  if (blocked.length > ALLOW_ID_BASE - RULE_ID_MIN) throw new Error('Too many blocked domains');

  const rules: DnrRule[] = blocked.map((host, i) => ({
    id: RULE_ID_MIN + i,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        extensionPath: `/blocked.html?d=${encodeURIComponent(host)}&s=${encodeURIComponent(sessionId)}`,
      },
    },
    condition: { requestDomains: [host], resourceTypes: ['main_frame'] },
  }));

  rules.push({
    id: SUBFRAME_RULE_ID,
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains: blocked, resourceTypes: ['sub_frame'] },
  });

  // Relevant hosts that live *under* a blocked domain get a higher-priority allow rule.
  const allows = [...new Set(relevantHosts)]
    .filter((r) => blocked.some((b) => r !== b && hostMatches(r, b)))
    .sort();
  allows.forEach((host, i) => {
    rules.push({
      id: ALLOW_ID_BASE + i,
      priority: 2,
      action: { type: 'allow' },
      condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] },
    });
  });
  return rules;
}

/** Stable fingerprint so unchanged rule sets are not re-applied. */
export function rulesHash(rules: DnrRule[]): string {
  const s = JSON.stringify(rules);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${rules.length}:${(h >>> 0).toString(16)}`;
}

/** Whether a tab URL should be redirected to the blocked page (for tabs already open). */
export function urlIsBlocked(
  url: string | undefined,
  blockedHosts: string[],
  relevantHosts: string[],
): string | null {
  if (!url || !/^https?:/i.test(url)) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (
    relevantHosts.some(
      (r) => hostMatches(host, r) && blockedHosts.some((b) => r !== b && hostMatches(r, b)),
    )
  ) {
    return null;
  }
  return blockedHosts.find((b) => hostMatches(host, b)) ?? null;
}
