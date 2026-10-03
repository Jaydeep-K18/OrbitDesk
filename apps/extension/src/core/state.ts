/** Extension state model and pure decisions derived from server state + clock offset. */
import type { ExtensionStateResponse, FocusSession } from '@focusguard/contracts';
import { currentBlock, effectiveStatus, isBlockingActive } from '@focusguard/domain/sessions';

export interface StoredState {
  state: ExtensionStateResponse | null;
  /** serverNow − Date.now() at the time of the last 200 response. */
  offsetMs: number;
  etag: string | null;
  syncedAt: number;
}

export const emptyState: StoredState = { state: null, offsetMs: 0, etag: null, syncedAt: 0 };

/** Server-corrected "now" in ms. */
export const serverNowMs = (offsetMs: number, localNowMs = Date.now()) => localNowMs + offsetMs;

function sessionTimes(s: FocusSession) {
  return {
    status: s.status,
    startsAt: new Date(s.startsAt),
    endsAt: new Date(s.endsAt),
    endedAt: s.endedAt ? new Date(s.endedAt) : null,
    blockDuringBreaks: s.blockDuringBreaks,
  };
}

function blocksOf(s: FocusSession) {
  return s.blocks.map((b) => ({
    id: b.id,
    kind: b.kind,
    startsAt: new Date(b.startsAt),
    endsAt: new Date(b.endsAt),
  }));
}

export function liveStatus(s: FocusSession, nowMs: number) {
  return effectiveStatus(sessionTimes(s), new Date(nowMs));
}

/** Should DNR rules be installed right now? Works offline from cached state. */
export function shouldBlock(s: FocusSession | null | undefined, nowMs: number): boolean {
  if (!s) return false;
  return isBlockingActive(sessionTimes(s), blocksOf(s), new Date(nowMs));
}

export function isTracking(st: ExtensionStateResponse | null, nowMs: number): boolean {
  if (!st?.session || !st.settings.trackingEnabled) return false;
  return liveStatus(st.session, nowMs) === 'ACTIVE';
}

export function inBreak(s: FocusSession, nowMs: number): boolean {
  return currentBlock(blocksOf(s), new Date(nowMs))?.kind === 'break';
}

/** Future instants (server time) at which blocking state may change: start, block edges, end. */
export function transitionTimes(s: FocusSession, nowMs: number): number[] {
  const times = new Set<number>([Date.parse(s.startsAt), Date.parse(s.endsAt)]);
  for (const b of s.blocks) {
    times.add(Date.parse(b.startsAt));
    times.add(Date.parse(b.endsAt));
  }
  return [...times].filter((t) => t > nowMs).sort((a, b) => a - b);
}

/** Badge text while a session runs: minutes left ("42m"), or "" when idle. */
export function badgeText(s: FocusSession | null | undefined, nowMs: number): string {
  if (!s || liveStatus(s, nowMs) !== 'ACTIVE') return '';
  const mins = Math.ceil((Date.parse(s.endsAt) - nowMs) / 60_000);
  return mins >= 100 ? `${Math.floor(mins / 60)}h` : `${Math.max(0, mins)}m`;
}

/** Poll faster when a session is active or about to start (chrome.alarms minimum is 30 s). */
export function syncPeriodMinutes(s: FocusSession | null | undefined, nowMs: number): number {
  if (!s) return 5;
  const status = liveStatus(s, nowMs);
  if (status === 'ACTIVE') return 0.5;
  if (status === 'SCHEDULED' && Date.parse(s.startsAt) - nowMs < 10 * 60_000) return 0.5;
  return 5;
}
