import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@focusguard/domain';
import {
  as,
  buildTestApp,
  createSession,
  minutes,
  pairDevice,
  registerUser,
  resetDb,
  type TestApp,
  type TestDevice,
  type TestUser,
} from './helpers.js';

let t: TestApp;
let u: TestUser;
let d: TestDevice;
const T0 = Date.parse('2026-10-05T09:00:00.000Z'); // Monday 14:30 IST
const at = (min: number) => new Date(T0 + minutes(min)).toISOString();

beforeEach(async () => {
  await resetDb();
  t = await buildTestApp({ accessTtlSec: 7 * 86_400 });
  u = await registerUser(t.app); // Asia/Kolkata
  d = await pairDevice(t.app, u);
});

async function ingest(events: unknown[]) {
  await as(t.app, d.accessToken).post('/api/v1/activity/batch').send({ events }).expect(202);
  await t.ctx.bus.idle();
}
const seg = (sessionId: string, domain: string, from: number, to: number) => ({
  type: 'segment',
  clientEventId: uuidv7(),
  sessionId,
  domain,
  startedAt: at(from),
  endedAt: at(to),
});

/** One finished 60-minute session: 40 min planned (github), 10 min distraction (entertainment), 1 blocked attempt. */
async function finishedSession(startMin: number) {
  t.clock.set(at(startMin));
  const s = await createSession(t.app, u, {
    durationMin: 60,
    relevantDomains: ['github.com'],
    blockedDomains: ['instagram.com'],
  });
  t.clock.set(at(startMin + 61));
  await ingest([
    seg(s.id, 'github.com', startMin, startMin + 40),
    seg(s.id, 'buzzfeed.com', startMin + 40, startMin + 50),
    {
      type: 'blocked_attempt',
      clientEventId: uuidv7(),
      sessionId: s.id,
      domain: 'instagram.com',
      at: at(startMin + 45),
    },
    { type: 'final_flush', clientEventId: uuidv7(), sessionId: s.id, at: at(startMin + 61) },
  ]);
  return s;
}

describe('dashboard summary', () => {
  it('counts the running session live, with live counters and recent activity', async () => {
    const s = await createSession(t.app, u, {
      durationMin: 60,
      relevantDomains: ['github.com'],
      blockedDomains: ['instagram.com'],
    });
    t.clock.set(at(30));
    await ingest([
      seg(s.id, 'github.com', 0, 20),
      seg(s.id, 'buzzfeed.com', 20, 25),
      {
        type: 'blocked_attempt',
        clientEventId: uuidv7(),
        sessionId: s.id,
        domain: 'instagram.com',
        at: at(26),
      },
    ]);
    const res = await as(t.app, u.accessToken).get('/api/v1/dashboard/summary').expect(200);
    expect(res.body.localDate).toBe('2026-10-05');
    expect(res.body.today).toMatchObject({
      focusSec: 1800,
      sessionsCompleted: 0,
      blockedAttempts: 1,
      productiveSec: 1200,
      distractionSec: 300,
    });
    expect(res.body.activeSession).toMatchObject({ id: s.id, status: 'ACTIVE' });
    expect(res.body.liveCounters).toEqual({ blockedAttempts: 1, websiteSwitches: 1 });
    expect(res.body.last7Days).toHaveLength(7);
    expect(res.body.last7Days.at(-1)).toEqual({ date: '2026-10-05', focusSec: 1800 });
    expect(res.body.recentActivity[0]).toMatchObject({
      kind: 'blocked',
      host: 'instagram.com',
      label: 'BLOCKED',
    });
    expect(res.body.recentActivity.map((a: { host: string }) => a.host)).toContain('buzzfeed.com');
  });

  it('lists recent finished sessions with their report metrics', async () => {
    await finishedSession(0);
    const res = await as(t.app, u.accessToken).get('/api/v1/dashboard/summary').expect(200);
    expect(res.body.recentSessions).toEqual([
      expect.objectContaining({ status: 'COMPLETED', productiveSec: 2400, focusQuality: 0.8 }),
    ]);
    expect(res.body.activeSession).toBeNull();
    expect(res.body.today.sessionsCompleted).toBe(1);
  });
});

describe('analytics', () => {
  it('aggregates by day and week, and reports domains, heatmap and session stats', async () => {
    await finishedSession(0); // Mon 2026-10-05 14:30–15:30 IST
    await finishedSession(24 * 60); // Tue 2026-10-06
    t.clock.set(at(3 * 24 * 60)); // Thursday
    const api = as(t.app, u.accessToken);

    const daily = await api
      .get('/api/v1/analytics/overview?from=2026-10-05&to=2026-10-07&granularity=day')
      .expect(200);
    expect(
      daily.body.points.map((p: { bucket: string; focusSec: number }) => [p.bucket, p.focusSec]),
    ).toEqual([
      ['2026-10-05', 3600],
      ['2026-10-06', 3600],
      ['2026-10-07', 0],
    ]);
    expect(daily.body.totals).toMatchObject({
      focusSec: 7200,
      blockedAttempts: 2,
      unplannedBrowsingSec: 1200,
    });

    const weekly = await api
      .get('/api/v1/analytics/overview?from=2026-10-05&to=2026-10-11&granularity=week')
      .expect(200);
    expect(weekly.body.points).toEqual([
      expect.objectContaining({
        bucket: '2026-10-05',
        focusSec: 7200,
        plannedSec: 4800,
        distractionSec: 1200,
        sessionsCompleted: 2,
      }),
    ]);

    const domains = await api
      .get('/api/v1/analytics/domains?from=2026-10-05&to=2026-10-06')
      .expect(200);
    expect(domains.body.mostVisited[0]).toEqual({ domain: 'github.com', seconds: 4800, visits: 2 });
    expect(domains.body.mostDistracting).toEqual([
      { domain: 'buzzfeed.com', seconds: 1200, visits: 2 },
    ]);

    const heat = await api
      .get('/api/v1/analytics/heatmap?from=2026-10-05&to=2026-10-11')
      .expect(200);
    // Monday (index 0), 14:00 IST hour: 14:30–15:00 → 1800 s of focus.
    expect(heat.body.cells[0][14]).toMatchObject({ focusSec: 1800 });
    expect(heat.body.cells[0][15].focusSec).toBe(1800);
    expect(heat.body.cells[1][14].focusSec).toBe(1800); // Tuesday
    expect(heat.body.cells[2][14].quality).toBeNull();

    const stats = await api
      .get('/api/v1/analytics/sessions-stats?from=2026-10-05&to=2026-10-11')
      .expect(200);
    expect(stats.body).toEqual({
      sessionsStarted: 2,
      sessionsCompleted: 2,
      completionRate: 1,
      avgDurationMin: 60,
      taskCompletionRate: null,
    });
  });

  it('validates ranges', async () => {
    const api = as(t.app, u.accessToken);
    await api.get('/api/v1/analytics/overview?from=2026-10-07&to=2026-10-05').expect(422);
    await api.get('/api/v1/analytics/overview?from=2020-01-01&to=2026-10-05').expect(422);
    await api.get('/api/v1/analytics/heatmap?from=bad&to=2026-10-05').expect(422);
  });
});
