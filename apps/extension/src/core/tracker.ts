/**
 * Focus-span tracker (ROADMAP 1.5). A pure state machine: browser events in, closed
 * segments out. At most one open span; any change of domain, title (if collected),
 * window focus or idle state closes it. The chrome.* wiring lives in lib/tracking.ts.
 */
import { hostMatches, normalizeDomain } from '@focusguard/domain/domains';
import { uuidv7 } from '@focusguard/domain/ids';

export interface Span {
  domain: string;
  title: string | null;
  startedAt: number;
  tabId: number | null;
}

export interface TrackerConfig {
  sessionId: string;
  collectTitles: boolean;
  sensitiveDomains: string[];
  neverTrack: string[];
}

// A type alias (not an interface) so it is assignable to the queue's indexable event type.
export type SegmentEvent = {
  type: 'segment';
  clientEventId: string;
  sessionId: string;
  domain: string;
  title?: string;
  startedAt: string;
  endedAt: string;
};

export type TrackerInput =
  | { type: 'focus'; at: number; tabId: number; url?: string; title?: string }
  | { type: 'blur'; at: number }
  | { type: 'stop'; at: number };

/** Title changes faster than this on the same domain are SPA flicker, not a new span. */
export const TITLE_DEBOUNCE_MS = 2000;
/** If the service worker was dead longer than this, close the span at the last heartbeat. */
export const HEARTBEAT_GRACE_MS = 90_000;
const MIN_SPAN_MS = 1000;

/** Host for a URL we may track, or null (chrome://, extension pages, new tab, file:…). */
export function trackableHost(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return normalizeDomain(url)?.host ?? null;
}

export class Tracker {
  constructor(
    private cfg: TrackerConfig,
    public open: Span | null = null,
  ) {}

  configure(cfg: TrackerConfig) {
    this.cfg = cfg;
  }

  private titleFor(domain: string, title: string | undefined): string | null {
    if (!this.cfg.collectTitles || !title) return null;
    if (this.cfg.sensitiveDomains.some((s) => hostMatches(domain, s))) return null;
    return title.slice(0, 200);
  }

  private close(at: number): SegmentEvent[] {
    const span = this.open;
    this.open = null;
    if (!span || at - span.startedAt < MIN_SPAN_MS) return [];
    return [
      {
        type: 'segment',
        clientEventId: uuidv7(span.startedAt),
        sessionId: this.cfg.sessionId,
        domain: span.domain,
        ...(span.title ? { title: span.title } : {}),
        startedAt: new Date(span.startedAt).toISOString(),
        endedAt: new Date(at).toISOString(),
      },
    ];
  }

  handle(input: TrackerInput): SegmentEvent[] {
    if (input.type === 'blur' || input.type === 'stop') return this.close(input.at);

    const domain = trackableHost(input.url);
    if (!domain || this.cfg.neverTrack.some((n) => hostMatches(domain, n))) {
      return this.close(input.at);
    }
    const title = this.titleFor(domain, input.title);
    const cur = this.open;
    if (cur && cur.domain === domain && cur.tabId === input.tabId) {
      if (title === cur.title || title === null) return [];
      if (input.at - cur.startedAt < TITLE_DEBOUNCE_MS) {
        cur.title = title; // SPA title flicker: keep one span
        return [];
      }
    }
    const closed = this.close(input.at);
    this.open = { domain, title, startedAt: input.at, tabId: input.tabId };
    return closed;
  }

  /**
   * After a service-worker restart or laptop sleep: an open span older than the last heartbeat
   * plus grace is closed *at the last heartbeat*, so time is never inflated.
   */
  recover(lastSeenAt: number | null, now: number): SegmentEvent[] {
    if (!this.open || lastSeenAt === null) return [];
    if (now - lastSeenAt > HEARTBEAT_GRACE_MS)
      return this.close(Math.max(lastSeenAt, this.open.startedAt));
    return [];
  }
}
