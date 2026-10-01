import { describe, expect, it } from 'vitest';
import {
  computeSessionMetrics,
  countWebsiteSwitches,
  dedupeBlockedAttempts,
  domainBreakdown,
  resolveOverlaps,
  type MetricsInput,
  type MetricsSegment,
} from '../src/metrics.js';
import { computeDailyStats } from '../src/daily.js';
import type { FinalLabel } from '../src/classification.js';

const T = (hhmmss: string) => new Date(`2026-10-02T${hhmmss}Z`);
function seg(host: string, start: string, end: string, label: FinalLabel | null): MetricsSegment {
  const reg = host.split('.').slice(-2).join('.');
  return { host, registrableDomain: reg, startedAt: T(start), endedAt: T(end), label };
}

/**
 * Golden fixture reproducing the spec's summary exactly:
 * planned 120 min → planned productive 95, unplanned relevant 10, distraction 15,
 * blocked attempts 4, website switches 12, task completion 80%.
 */
const specExample: MetricsInput = {
  session: {
    status: 'COMPLETED',
    startsAt: T('15:00:00'),
    endsAt: T('17:00:00'),
    startedAt: T('15:00:00'),
    endedAt: T('17:00:00'),
  },
  now: T('18:00:00'),
  blocks: [{ kind: 'work', startsAt: T('15:00:00'), endsAt: T('17:00:00') }],
  segments: [
    seg('leetcode.com', '15:00:00', '15:30:00', 'PLANNED'),
    seg('geeksforgeeks.org', '15:30:00', '15:35:00', 'UNPLANNED_RELEVANT'),
    seg('leetcode.com', '15:35:00', '15:55:00', 'PLANNED'),
    seg('youtube.com', '15:55:00', '16:05:00', 'DISTRACTION'),
    seg('github.com', '16:05:00', '16:15:00', 'PLANNED'),
    seg('stackoverflow.com', '16:15:00', '16:20:00', 'UNPLANNED_RELEVANT'),
    seg('github.com', '16:20:00', '16:25:00', 'PLANNED'),
    seg('leetcode.com', '16:25:00', '16:35:00', 'PLANNED'),
    seg('ndtv.com', '16:35:00', '16:40:00', 'DISTRACTION'),
    seg('leetcode.com', '16:40:00', '16:50:00', 'PLANNED'),
    seg('claude.ai', '16:50:00', '16:55:00', 'PLANNED'),
    seg('leetcode.com', '16:55:00', '16:58:00', 'PLANNED'),
    seg('github.com', '16:58:00', '17:00:00', 'PLANNED'),
  ],
  blockedAttempts: [
    { host: 'instagram.com', at: T('15:20:00') },
    { host: 'instagram.com', at: T('15:20:05') }, // reload loop
    { host: 'instagram.com', at: T('15:20:12') }, // still the same loop (sliding window)
    { host: 'reddit.com', at: T('15:40:00') },
    { host: 'netflix.com', at: T('16:10:00') },
    { host: 'instagram.com', at: T('16:30:00') },
  ],
  tasks: [
    { completedAt: T('15:30:00') },
    { completedAt: T('16:00:00') },
    { completedAt: T('16:30:00') },
    { completedAt: T('16:59:00') },
    { completedAt: null },
  ],
};

describe('computeSessionMetrics — spec 120-minute example (golden)', () => {
  const m = computeSessionMetrics(specExample);

  it('matches every summary number from the spec', () => {
    expect(m.plannedFocusSec).toBe(120 * 60);
    expect(m.plannedSec).toBe(95 * 60);
    expect(m.relevantSec).toBe(10 * 60);
    expect(m.distractionSec).toBe(15 * 60);
    expect(m.blockedAttempts).toBe(4);
    expect(m.websiteSwitches).toBe(12);
    expect(m.taskCompletion).toBe(0.8);
  });

  it('derives the remaining metrics', () => {
    expect(m).toMatchObject({
      actualFocusSec: 7200,
      trackedBrowserSec: 7200,
      outsideBrowserSec: 0,
      uncertainSec: 0,
      productiveSec: 105 * 60,
      unplannedBrowsingSec: 25 * 60,
      switchesPerHour: 6,
      focusQuality: 0.875,
      tasksCompleted: 4,
      tasksTotal: 5,
      timeToFirstDistractionSec: 1200, // first blocked attempt at 15:20
      sessionCompleted: true,
      extensionOfflineSec: 0,
    });
  });

  it('builds the per-domain breakdown sorted by time', () => {
    const rows = domainBreakdown(specExample.segments);
    expect(rows[0]).toEqual({
      domain: 'leetcode.com',
      seconds: 73 * 60,
      label: 'PLANNED',
      visits: 5,
    });
    expect(rows.find((r) => r.domain === 'youtube.com')).toMatchObject({
      seconds: 600,
      label: 'DISTRACTION',
    });
    expect(rows.reduce((s, r) => s + r.seconds, 0)).toBe(7200);
  });
});

describe('computeSessionMetrics — edge cases', () => {
  const base: MetricsInput = {
    session: {
      status: 'ACTIVE',
      startsAt: T('10:00:00'),
      endsAt: T('11:00:00'),
      startedAt: T('10:00:00'),
      endedAt: null,
    },
    now: T('10:30:00'),
    blocks: [{ kind: 'work', startsAt: T('10:00:00'), endsAt: T('11:00:00') }],
    segments: [],
    blockedAttempts: [],
    tasks: [],
  };

  it('zero browser activity (IDE work) is outside-browser time, not distraction', () => {
    const m = computeSessionMetrics(base);
    expect(m).toMatchObject({
      actualFocusSec: 1800,
      trackedBrowserSec: 0,
      outsideBrowserSec: 1800,
      distractionSec: 0,
      focusQuality: null,
      taskCompletion: null,
      switchesPerHour: 0,
      timeToFirstDistractionSec: null,
      sessionCompleted: false,
    });
  });

  it('ended early uses the actual window', () => {
    const m = computeSessionMetrics({
      ...base,
      session: { ...base.session, status: 'ENDED_EARLY', endedAt: T('10:20:00') },
      now: T('12:00:00'),
    });
    expect(m.actualFocusSec).toBe(1200);
    expect(m.plannedFocusSec).toBe(3600);
    expect(m.sessionCompleted).toBe(false);
  });

  it('cancelled sessions have no focus time', () => {
    const m = computeSessionMetrics({ ...base, session: { ...base.session, status: 'CANCELLED' } });
    expect(m.actualFocusSec).toBe(0);
  });

  it('break time is not focus time', () => {
    const m = computeSessionMetrics({
      ...base,
      now: T('12:00:00'),
      session: { ...base.session, status: 'COMPLETED' },
      blocks: [
        { kind: 'work', startsAt: T('10:00:00'), endsAt: T('10:45:00') },
        { kind: 'break', startsAt: T('10:45:00'), endsAt: T('10:55:00') },
        { kind: 'work', startsAt: T('10:55:00'), endsAt: T('11:00:00') },
      ],
    });
    expect(m.plannedFocusSec).toBe(50 * 60);
    expect(m.actualFocusSec).toBe(50 * 60);
  });

  it('unlabelled and BLOCKED segments count as uncertain and distraction respectively', () => {
    const m = computeSessionMetrics({
      ...base,
      segments: [
        seg('a.com', '10:00:00', '10:01:00', null),
        seg('b.com', '10:01:00', '10:02:00', 'BLOCKED'),
      ],
    });
    expect(m.uncertainSec).toBe(60);
    expect(m.distractionSec).toBe(60);
    expect(m.timeToFirstDistractionSec).toBe(60);
  });

  it('short distractions (< 30s) do not set time-to-first-distraction', () => {
    const m = computeSessionMetrics({
      ...base,
      segments: [seg('x.com', '10:05:00', '10:05:20', 'DISTRACTION')],
    });
    expect(m.timeToFirstDistractionSec).toBeNull();
  });
});

describe('switches, dedupe and multi-device overlaps', () => {
  it('does not count transitions across an outside-browser gap', () => {
    expect(
      countWebsiteSwitches([
        seg('a.com', '10:00:00', '10:01:00', null),
        seg('b.com', '10:01:01', '10:02:00', null), // 1s gap: still a switch
        seg('c.com', '10:05:00', '10:06:00', null), // 3 min gap via IDE: not a switch
        seg('c.com', '10:06:00', '10:07:00', null), // same domain: not a switch
      ]),
    ).toBe(1);
  });

  it('dedupes per host independently', () => {
    const kept = dedupeBlockedAttempts([
      { host: 'a.com', at: T('10:00:00') },
      { host: 'b.com', at: T('10:00:01') },
      { host: 'a.com', at: T('10:00:20') },
    ]);
    expect(kept).toHaveLength(3);
  });

  it('resolves overlapping spans from two devices: latest focus change wins', () => {
    const out = resolveOverlaps([
      seg('a.com', '10:00:00', '10:10:00', 'PLANNED'),
      seg('b.com', '10:05:00', '10:08:00', 'DISTRACTION'),
    ]);
    expect(
      out.map((s) => [
        s.host,
        s.startedAt.toISOString().slice(11, 19),
        s.endedAt.toISOString().slice(11, 19),
      ]),
    ).toEqual([
      ['a.com', '10:00:00', '10:05:00'],
      ['b.com', '10:05:00', '10:08:00'],
      ['a.com', '10:08:00', '10:10:00'],
    ]);
  });

  it('drops a span fully replaced at the same start', () => {
    const out = resolveOverlaps([
      seg('a.com', '10:00:00', '10:01:00', null),
      seg('b.com', '10:00:00', '10:02:00', null),
    ]);
    expect(out.map((s) => s.host)).toEqual(['b.com']);
  });
});

describe('computeDailyStats', () => {
  it('attributes the spec example to the right IST date and hours', () => {
    const days = computeDailyStats([specExample], 'Asia/Kolkata');
    // 15:00–17:00Z = 20:30–22:30 IST on 2026-10-02.
    const d = days.get('2026-10-02')!;
    expect(d).toMatchObject({
      focusSec: 7200,
      sessionsStarted: 1,
      sessionsCompleted: 1,
      plannedSec: 95 * 60,
      relevantSec: 600,
      distractionSec: 900,
      blockedAttempts: 4,
      switches: 12,
      tasksPlanned: 5,
      tasksCompleted: 4,
      outsideBrowserSec: 0,
    });
    expect(d.hourlyFocusSec[20]).toBe(1800);
    expect(d.hourlyFocusSec[21]).toBe(3600);
    expect(d.hourlyFocusSec[22]).toBe(1800);
    expect(d.hourlyFocusSec.reduce((a, b) => a + b, 0)).toBe(7200);
  });

  it('splits a session spanning local midnight across both days', () => {
    // 18:00Z–19:00Z = 23:30–00:30 IST.
    const days = computeDailyStats(
      [
        {
          session: {
            status: 'COMPLETED',
            startsAt: T('18:00:00'),
            endsAt: T('19:00:00'),
            startedAt: T('18:00:00'),
            endedAt: T('19:00:00'),
          },
          now: T('20:00:00'),
          blocks: [{ kind: 'work', startsAt: T('18:00:00'), endsAt: T('19:00:00') }],
          segments: [seg('github.com', '18:20:00', '18:40:00', 'PLANNED')],
          blockedAttempts: [{ host: 'instagram.com', at: T('18:50:00') }],
          tasks: [],
        },
      ],
      'Asia/Kolkata',
    );
    expect(days.get('2026-10-02')).toMatchObject({
      focusSec: 1800,
      plannedSec: 600,
      sessionsStarted: 1,
      sessionsCompleted: 0,
    });
    expect(days.get('2026-10-03')).toMatchObject({
      focusSec: 1800,
      plannedSec: 600,
      sessionsCompleted: 1,
      blockedAttempts: 1,
    });
    expect(days.get('2026-10-02')!.hourlyFocusSec[23]).toBe(1800);
    expect(days.get('2026-10-03')!.hourlyFocusSec[0]).toBe(1800);
  });

  it('skips scheduled and cancelled sessions', () => {
    const days = computeDailyStats(
      [
        { ...specExample, session: { ...specExample.session, status: 'CANCELLED' } },
        {
          ...specExample,
          now: T('14:00:00'),
          session: { ...specExample.session, status: 'SCHEDULED', startedAt: null, endedAt: null },
        },
      ],
      'UTC',
    );
    expect(days.size).toBe(0);
  });
});
