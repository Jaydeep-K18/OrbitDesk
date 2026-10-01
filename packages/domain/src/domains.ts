import { parse } from 'tldts';
import { toUnicode } from './punycode.js';

export type HostKind = 'domain' | 'ip' | 'localhost';

export interface NormalizedDomain {
  /** Lowercase ASCII (punycode) host without `www.`, port or trailing dot, e.g. `m.instagram.com`. */
  host: string;
  /** eTLD+1 per the public suffix list, e.g. `instagram.com` or `foo.co.uk`. Equals `host` for IPs and localhost. */
  registrableDomain: string;
  kind: HostKind;
}

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function extractHostname(raw: string): string | null {
  const candidate = raw.includes('://') ? raw : `http://${raw}`;
  try {
    // WHATWG URL lowercases, converts IDN to punycode, strips ports and credentials.
    return new URL(candidate).hostname;
  } catch {
    return null;
  }
}

/**
 * Normalizes user input (a host, domain or pasted URL) into a canonical host.
 * Returns `null` when the input cannot be a blockable web host.
 */
export function normalizeDomain(input: string): NormalizedDomain | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let hostname = extractHostname(trimmed);
  if (!hostname) return null;

  hostname = hostname.replace(/\.+$/, '');
  if (!hostname) return null;

  // IPv6 hosts come back bracketed from URL parsing.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return { host: hostname, registrableDomain: hostname, kind: 'ip' };
  }
  if (IPV4_RE.test(hostname)) {
    return { host: hostname, registrableDomain: hostname, kind: 'ip' };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { host: 'localhost', registrableDomain: 'localhost', kind: 'localhost' };
  }

  if (hostname.startsWith('www.')) hostname = hostname.slice(4);
  if (hostname.length > 253) return null;

  const labels = hostname.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;

  const info = parse(hostname, { allowPrivateDomains: false });
  if (!info.domain || !info.publicSuffix || info.domain === info.publicSuffix) return null;
  // Reject unknown TLDs (e.g. "foo.notatld") so typos don't become silent rules.
  if (!info.isIcann) return null;

  return { host: hostname, registrableDomain: info.domain, kind: 'domain' };
}

/** True when `host` equals `ruleHost` or is a subdomain of it (`m.instagram.com` ⊂ `instagram.com`). */
export function hostMatches(host: string, ruleHost: string): boolean {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

/** Converts a punycode host to Unicode for display (`xn--bcher-kva.de` → `bücher.de`). */
export function displayHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.startsWith('xn--') ? toUnicode(label) : label))
    .join('.');
}

/** Two rule sets conflict when the same host is both blocked and relevant. */
export function findListConflicts(blocked: string[], relevant: string[]): string[] {
  const relevantSet = new Set(relevant);
  return [...new Set(blocked.filter((host) => relevantSet.has(host)))];
}
