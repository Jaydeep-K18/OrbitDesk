/**
 * Daily rollups (ROADMAP 1.6): attribute session time to the user's *local* dates and hours,
 * so a session spanning midnight is split across both days. Pure.
 */
import type { MetricsInput } from './metrics.js';
import { SWITCH_GAP_MS, dedupeBlockedAttempts, resolveOverlaps } from './metrics.js';
import { effectiveStatus } from './sessions.js';
import { splitByLocalHour, toLocalDate } from './time.js';

export interface DailyStats {
  localDate: string;
  focusSec: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  plannedSec: number;
  relevantSec: number;
  distractionSec: number;
  uncertainSec: number;
  outsideBrowserSec: number;
  blockedAttempts: number;
  switches: number;
  tasksCompleted: number;
  tasksPlanned: number;
  hourlyFocusSec: number[];
  hourlyProductiveSec: number[];
  hourlyDistractionSec: number[];
}

export function emptyDailyStats(localDate: string): DailyStats {
  return {
    localDate,
    focusSec: 0,
    sessionsStarted: 0,
    sessionsCompleted: 0,
    plannedSec: 0,
    relevantSec: 0,
    distractionSec: 0,
    uncertainSec: 0,
    outsideBrowserSec: 0,
    blockedAttempts: 0,
    switches: 0,
    tasksCompleted: 0,
    tasksPlanned: 0,
    hourlyFocusSec: Array<number>(24).fill(0),
    hourlyProductiveSec: Array<number>(24).fill(0),
    hourlyDistractionSec: Array<number>(24).fill(0),
  };
}

export function computeDailyStats(
  sessions: MetricsInput[],
  timeZone: string,
): Map<string, DailyStats> {
  const days = new Map<string, DailyStats>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = emptyDailyStats(date);
      days.set(date, d);
    }
    return d;
  };
  const tracked = new Map<string, number>();

  for (const input of sessions) {
    const { session, now } = input;
    const status = effectiveStatus(session, now);
    if (status === 'CANCELLED' || status === 'SCHEDULED') continue;

    const windowStart = (session.startedAt ?? session.startsAt).getTime();
    const windowEnd = Math.min((session.endedAt ?? session.endsAt).getTime(), now.getTime());
    const startDate = toLocalDate(windowStart, timeZone);

    const startDay = day(startDate);
    startDay.sessionsStarted += 1;
    startDay.tasksPlanned += input.tasks.length;
    startDay.tasksCompleted += input.tasks.filter((t) => t.completedAt).length;
    if (status === 'COMPLETED') day(toLocalDate(windowEnd, timeZone)).sessionsCompleted += 1;

    for (const block of input.blocks) {
      if (block.kind !== 'work') continue;
      const s = Math.max(block.startsAt.getTime(), windowStart);
      const e = Math.min(block.endsAt.getTime(), windowEnd);
      if (e <= s) continue;
      for (const slice of splitByLocalHour(s, e, timeZone)) {
        const d = day(slice.localDate);
        d.focusSec += slice.seconds;
        d.hourlyFocusSec[slice.hour]! += slice.seconds;
      }
    }

    const segments = resolveOverlaps(input.segments);
    for (const seg of segments) {
      const label = seg.label === 'BLOCKED' ? 'DISTRACTION' : (seg.label ?? 'UNCERTAIN');
      for (const slice of splitByLocalHour(seg.startedAt, seg.endedAt, timeZone)) {
        const d = day(slice.localDate);
        tracked.set(slice.localDate, (tracked.get(slice.localDate) ?? 0) + slice.seconds);
        if (label === 'PLANNED') d.plannedSec += slice.seconds;
        else if (label === 'UNPLANNED_RELEVANT') d.relevantSec += slice.seconds;
        else if (label === 'DISTRACTION') d.distractionSec += slice.seconds;
        else d.uncertainSec += slice.seconds;
        if (label === 'PLANNED' || label === 'UNPLANNED_RELEVANT')
          d.hourlyProductiveSec[slice.hour]! += slice.seconds;
        if (label === 'DISTRACTION') d.hourlyDistractionSec[slice.hour]! += slice.seconds;
      }
    }
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]!;
      const cur = segments[i]!;
      if (
        cur.startedAt.getTime() - prev.endedAt.getTime() <= SWITCH_GAP_MS &&
        cur.registrableDomain !== prev.registrableDomain
      ) {
        day(toLocalDate(cur.startedAt, timeZone)).switches += 1;
      }
    }

    for (const a of dedupeBlockedAttempts(input.blockedAttempts)) {
      day(toLocalDate(a.at, timeZone)).blockedAttempts += 1;
    }
  }

  for (const d of days.values()) {
    const round = (n: number) => Math.round(n);
    d.focusSec = round(d.focusSec);
    d.plannedSec = round(d.plannedSec);
    d.relevantSec = round(d.relevantSec);
    d.distractionSec = round(d.distractionSec);
    d.uncertainSec = round(d.uncertainSec);
    d.outsideBrowserSec = Math.max(0, d.focusSec - round(tracked.get(d.localDate) ?? 0));
    d.hourlyFocusSec = d.hourlyFocusSec.map(round);
    d.hourlyProductiveSec = d.hourlyProductiveSec.map(round);
    d.hourlyDistractionSec = d.hourlyDistractionSec.map(round);
  }
  return days;
}
