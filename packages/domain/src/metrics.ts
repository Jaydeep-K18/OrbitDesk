/**
 * Session metrics: the single implementation of ROADMAP §7.5. Pure; inputs are plain data.
 */
import type { BlockLike, SessionStatusValue } from './sessions.js';
import { effectiveStatus } from './sessions.js';
import type { FinalLabel } from './classification.js';

export const BLOCKED_DEDUPE_WINDOW_MS = 10_000;
/** Consecutive segments separated by more than this are a transition via "outside browser". */
export const SWITCH_GAP_MS = 2_000;
export const DISTRACTION_MIN_SEC = 30;

export interface MetricsSegment {
  host: string;
  registrableDomain: string;
  startedAt: Date;
  endedAt: Date;
  label: FinalLabel | null;
}

export interface MetricsBlockedAttempt {
  host: string;
  at: Date;
}

export interface MetricsInput {
  session: {
    status: SessionStatusValue;
    startsAt: Date;
    endsAt: Date;
    startedAt: Date | null;
    endedAt: Date | null;
  };
  now: Date;
  blocks: BlockLike[];
  segments: MetricsSegment[];
  blockedAttempts: MetricsBlockedAttempt[];
  tasks: { completedAt: Date | null }[];
  extensionOfflineSec?: number;
}

export interface SessionMetricsResult {
  plannedFocusSec: number;
  actualFocusSec: number;
  trackedBrowserSec: number;
  outsideBrowserSec: number;
  plannedSec: number;
  relevantSec: number;
  distractionSec: number;
  uncertainSec: number;
  productiveSec: number;
  unplannedBrowsingSec: number;
  blockedAttempts: number;
  websiteSwitches: number;
  switchesPerHour: number;
  taskCompletion: number | null;
  tasksCompleted: number;
  tasksTotal: number;
  focusQuality: number | null;
  timeToFirstDistractionSec: number | null;
  sessionCompleted: boolean;
  extensionOfflineSec: number;
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const sec = (ms: number) => Math.max(0, Math.round(ms / 1000));

/** Deduplicate blocked attempts: the same host within 10 s counts once (reload loops). */
export function dedupeBlockedAttempts<T extends MetricsBlockedAttempt>(attempts: T[]): T[] {
  const lastByHost = new Map<string, number>();
  const kept: T[] = [];
  for (const a of [...attempts].sort((x, y) => x.at.getTime() - y.at.getTime())) {
    const t = a.at.getTime();
    const last = lastByHost.get(a.host);
    if (last === undefined || t - last > BLOCKED_DEDUPE_WINDOW_MS) kept.push(a);
    // The window slides from the last *seen* attempt so a continuous reload loop stays one.
    lastByHost.set(a.host, t);
  }
  return kept;
}

/**
 * Merges timelines from several devices: when spans overlap, the later focus change wins and
 * the earlier span is truncated (ROADMAP §21, multi-device). Zero-length leftovers are dropped.
 */
export function resolveOverlaps<T extends MetricsSegment>(segments: T[]): T[] {
  const sorted = [...segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const out: T[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.endedAt.getTime() > s.startedAt.getTime()) {
      const tail = prev.endedAt.getTime() > s.endedAt.getTime() ? prev.endedAt : null;
      prev.endedAt = s.startedAt;
      if (prev.endedAt.getTime() <= prev.startedAt.getTime()) out.pop();
      out.push({ ...s });
      // A span that fully contained the newer one resumes after it.
      if (tail) out.push({ ...prev, startedAt: s.endedAt, endedAt: tail });
    } else {
      out.push({ ...s });
    }
  }
  return out.filter((s) => s.endedAt.getTime() > s.startedAt.getTime());
}

/** Number of consecutive segment pairs on different registrable domains (no gap between them). */
export function countWebsiteSwitches(segments: MetricsSegment[]): number {
  const sorted = [...segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let switches = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const gap = cur.startedAt.getTime() - prev.endedAt.getTime();
    if (gap <= SWITCH_GAP_MS && cur.registrableDomain !== prev.registrableDomain) switches++;
  }
  return switches;
}

export function computeSessionMetrics(input: MetricsInput): SessionMetricsResult {
  const { session, now } = input;
  const status = effectiveStatus(session, now);
  const workBlocks = input.blocks.filter((b) => b.kind === 'work');

  const plannedFocusSec = workBlocks.reduce(
    (s, b) => s + sec(b.endsAt.getTime() - b.startsAt.getTime()),
    0,
  );

  const windowStart = (session.startedAt ?? session.startsAt).getTime();
  const windowEndRaw =
    status === 'CANCELLED' ? windowStart : (session.endedAt ?? session.endsAt).getTime();
  const windowEnd = Math.min(windowEndRaw, now.getTime());

  const actualFocusSec = workBlocks.reduce((s, b) => {
    const start = Math.max(b.startsAt.getTime(), windowStart);
    const end = Math.min(b.endsAt.getTime(), windowEnd);
    return s + (end > start ? sec(end - start) : 0);
  }, 0);

  const segments = resolveOverlaps(input.segments);
  const sums = { PLANNED: 0, UNPLANNED_RELEVANT: 0, DISTRACTION: 0, UNCERTAIN: 0 };
  let trackedBrowserSec = 0;
  let firstDistractionAt: number | null = null;
  for (const s of segments) {
    const d = sec(s.endedAt.getTime() - s.startedAt.getTime());
    trackedBrowserSec += d;
    const label = s.label === 'BLOCKED' ? 'DISTRACTION' : (s.label ?? 'UNCERTAIN');
    sums[label] += d;
    if (label === 'DISTRACTION' && d >= DISTRACTION_MIN_SEC) {
      const t = s.startedAt.getTime();
      if (firstDistractionAt === null || t < firstDistractionAt) firstDistractionAt = t;
    }
  }
  const kept = dedupeBlockedAttempts(input.blockedAttempts);
  for (const a of kept) {
    const t = a.at.getTime();
    if (firstDistractionAt === null || t < firstDistractionAt) firstDistractionAt = t;
  }

  const websiteSwitches = countWebsiteSwitches(segments);
  const tasksTotal = input.tasks.length;
  const tasksCompleted = input.tasks.filter((t) => t.completedAt !== null).length;
  const productiveSec = sums.PLANNED + sums.UNPLANNED_RELEVANT;
  const focusDenominator = productiveSec + sums.DISTRACTION;

  return {
    plannedFocusSec,
    actualFocusSec,
    trackedBrowserSec,
    outsideBrowserSec: Math.max(0, actualFocusSec - trackedBrowserSec),
    plannedSec: sums.PLANNED,
    relevantSec: sums.UNPLANNED_RELEVANT,
    distractionSec: sums.DISTRACTION,
    uncertainSec: sums.UNCERTAIN,
    productiveSec,
    unplannedBrowsingSec: sums.UNPLANNED_RELEVANT + sums.DISTRACTION + sums.UNCERTAIN,
    blockedAttempts: kept.length,
    websiteSwitches,
    switchesPerHour:
      trackedBrowserSec > 0 ? round(websiteSwitches / (trackedBrowserSec / 3600), 1) : 0,
    taskCompletion: tasksTotal > 0 ? round(tasksCompleted / tasksTotal, 3) : null,
    tasksCompleted,
    tasksTotal,
    focusQuality: focusDenominator > 0 ? round(productiveSec / focusDenominator, 3) : null,
    timeToFirstDistractionSec:
      firstDistractionAt === null ? null : sec(firstDistractionAt - windowStart),
    sessionCompleted: status === 'COMPLETED',
    extensionOfflineSec: input.extensionOfflineSec ?? 0,
  };
}

export interface DomainBreakdown {
  domain: string;
  seconds: number;
  label: FinalLabel;
  visits: number;
}

/** Per-registrable-domain time with the dominant (most time) label. */
export function domainBreakdown(segments: MetricsSegment[]): DomainBreakdown[] {
  const byDomain = new Map<
    string,
    { seconds: number; visits: number; labels: Map<FinalLabel, number> }
  >();
  for (const s of resolveOverlaps(segments)) {
    const d = sec(s.endedAt.getTime() - s.startedAt.getTime());
    const label = s.label ?? 'UNCERTAIN';
    const entry = byDomain.get(s.registrableDomain) ?? { seconds: 0, visits: 0, labels: new Map() };
    entry.seconds += d;
    entry.visits += 1;
    entry.labels.set(label, (entry.labels.get(label) ?? 0) + d);
    byDomain.set(s.registrableDomain, entry);
  }
  return [...byDomain.entries()]
    .map(([domain, e]) => ({
      domain,
      seconds: e.seconds,
      visits: e.visits,
      label: [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0]![0],
    }))
    .sort((a, b) => b.seconds - a.seconds || a.domain.localeCompare(b.domain));
}
