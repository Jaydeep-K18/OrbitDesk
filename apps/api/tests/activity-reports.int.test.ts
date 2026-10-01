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
  testDb,
  type TestApp,
  type TestDevice,
  type TestUser,
} from './helpers.js';

let t: TestApp;
let u: TestUser;
let d: TestDevice;
const T0 = Date.parse('2026-10-05T09:00:00.000Z');
const at = (min: number, sec = 0) => new Date(T0 + minutes(min) + sec * 1000).toISOString();

beforeEach(async () => {
  await resetDb();
  t = await buildTestApp({ accessTtlSec: 86_400 });
  u = await registerUser(t.app);
  d = await pairDevice(t.app, u);
});

const seg = (
  sessionId: string,
  domain: string,
  fromMin: number,
  toMin: number,
  title?: string,
) => ({
  type: 'segment' as const,
  clientEventId: uuidv7(),
  sessionId,
  domain,
  startedAt: at(fromMin),
  endedAt: at(toMin),
  ...(title ? { title } : {}),
});

async function ingest(events: unknown[]) {
  const res = await as(t.app, d.accessToken).post('/api/v1/activity/batch').send({ events });
  await t.ctx.bus.idle();
  return res;
}

describe('spec golden example through the API (120-minute LeetCode session)', () => {
  it('ingests, classifies, relabels, finalizes and reproduces the spec summary', async () => {
    const api = as(t.app, u.accessToken);
    const taskIds: string[] = [];
    for (const title of ['LeetCode 1', 'LeetCode 2', 'LeetCode 3', 'ML topic', 'Project work']) {
      taskIds.push(
        (await api.post('/api/v1/tasks').send({ title, category: 'coding_practice' }).expect(201))
          .body.id,
      );
    }
    const s = await createSession(t.app, u, {
      durationMin: 120,
      taskIds,
      relevantDomains: ['leetcode.com', 'github.com', 'claude.ai'],
      blockedDomains: ['instagram.com', 'reddit.com', 'netflix.com'],
    });
    const sid = s.id;

    t.clock.set(at(121)); // the extension flushes after the session
    const events = [
      seg(sid, 'leetcode.com', 0, 30),
      seg(sid, 'www.geeksforgeeks.org', 30, 35),
      seg(sid, 'leetcode.com', 35, 55),
      seg(sid, 'www.youtube.com', 55, 65),
      seg(sid, 'github.com', 65, 75),
      seg(sid, 'stackoverflow.com', 75, 80),
      seg(sid, 'github.com', 80, 85),
      seg(sid, 'leetcode.com', 85, 95),
      seg(sid, 'ndtv.com', 95, 100),
      seg(sid, 'leetcode.com', 100, 110),
      seg(sid, 'claude.ai', 110, 115),
      seg(sid, 'leetcode.com', 115, 118),
      seg(sid, 'github.com', 118, 120),
      ...[
        ['instagram.com', at(20)],
        ['instagram.com', at(20, 5)],
        ['instagram.com', at(20, 12)],
        ['reddit.com', at(40)],
        ['netflix.com', at(70)],
        ['instagram.com', at(90)],
      ].map(([domain, when]) => ({
        type: 'blocked_attempt',
        clientEventId: uuidv7(),
        sessionId: sid,
        domain,
        at: when,
      })),
    ];
    const res = await ingest(events);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 19, duplicates: 0, rejected: [] });

    // Rule classifier v1 labels (§7.4 worked example).
    const segs = await api.get(`/api/v1/sessions/${sid}/activity`).expect(200);
    const labelOf = (host: string) =>
      segs.body.items.find((x: { host: string }) => x.host === host)?.label;
    expect(labelOf('leetcode.com')).toBe('PLANNED');
    expect(labelOf('geeksforgeeks.org')).toBe('UNPLANNED_RELEVANT');
    expect(labelOf('youtube.com')).toBe('UNCERTAIN');
    expect(labelOf('stackoverflow.com')).toBe('UNPLANNED_RELEVANT');
    expect(labelOf('ndtv.com')).toBe('DISTRACTION');

    // The user says that YouTube visit was a distraction.
    const yt = segs.body.items.find((x: { host: string }) => x.host === 'youtube.com');
    const relabeled = await api
      .patch(`/api/v1/activity/segments/${yt.id}/label`)
      .send({ label: 'DISTRACTION' })
      .expect(200);
    expect(relabeled.body).toMatchObject({
      label: 'DISTRACTION',
      labelSource: 'user_feedback',
      confidence: 1,
    });

    // Tick 4 of 5 tasks.
    for (const st of (s.tasks as { id: string }[]).slice(0, 4)) {
      await api
        .patch(`/api/v1/sessions/${sid}/tasks/${st.id}`)
        .send({ completed: true })
        .expect(200);
    }

    // Final flush finalizes immediately (no 2-minute wait).
    await ingest([{ type: 'final_flush', clientEventId: uuidv7(), sessionId: sid, at: at(121) }]);
    const report = await api.get(`/api/v1/sessions/${sid}/report`).expect(200);
    expect(report.body.final).toBe(true);
    expect(report.body.version).toBe(1);
    expect(report.body.metrics).toMatchObject({
      plannedFocusSec: 7200,
      plannedSec: 95 * 60,
      relevantSec: 10 * 60,
      distractionSec: 15 * 60,
      blockedAttempts: 4,
      websiteSwitches: 12,
      taskCompletion: 0.8,
      focusQuality: 0.875,
      sessionCompleted: true,
      outsideBrowserSec: 0,
    });
    expect(report.body.domains[0]).toMatchObject({
      domain: 'leetcode.com',
      seconds: 73 * 60,
      label: 'PLANNED',
    });
    expect(report.body.blockedAttempts).toHaveLength(6);

    // Daily stats for the IST date (09:00Z = 14:30 IST).
    const daily = await testDb().userDailyStats.findUniqueOrThrow({
      where: {
        userId_localDate: { userId: u.id, localDate: new Date('2026-10-05T00:00:00.000Z') },
      },
    });
    expect(daily).toMatchObject({
      focusSec: 7200,
      plannedSec: 5700,
      relevantSec: 600,
      distractionSec: 900,
      blockedAttempts: 4,
      switches: 12,
      sessionsStarted: 1,
      sessionsCompleted: 1,
      tasksPlanned: 5,
      tasksCompleted: 4,
    });
    expect(daily.hourlyFocusSec[14]).toBe(1800);
    expect(daily.hourlyFocusSec[15]).toBe(3600);
    expect(daily.hourlyFocusSec[16]).toBe(1800);

    // A late event re-finalizes (version bump) instead of being lost.
    await ingest([
      {
        type: 'blocked_attempt',
        clientEventId: uuidv7(),
        sessionId: sid,
        domain: 'netflix.com',
        at: at(119),
      },
    ]);
    const after = await api.get(`/api/v1/sessions/${sid}/report`).expect(200);
    expect(after.body.version).toBe(2);
    expect(after.body.metrics.blockedAttempts).toBe(5);
  });
});

describe('ingestion rules', () => {
  it('is idempotent: re-sending a batch only counts duplicates', async () => {
    const s = await createSession(t.app, u);
    t.clock.set(at(10));
    const batch = [seg(s.id, 'github.com', 0, 5), seg(s.id, 'leetcode.com', 5, 10)];
    expect((await ingest(batch)).body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
    expect((await ingest(batch)).body).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(await testDb().activitySegment.count({ where: { sessionId: s.id } })).toBe(2);
  });

  it('rejects events per item: malformed, invalid domain, outside the window, unknown session', async () => {
    const s = await createSession(t.app, u, { durationMin: 30 });
    t.clock.set(at(10));
    const res = await ingest([
      { type: 'segment', clientEventId: 'nope' },
      { ...seg(s.id, 'not a domain', 0, 1) },
      seg(s.id, 'github.com', -30, -20),
      seg(s.id, 'github.com', 1, 2),
      { ...seg(s.id, 'github.com', 2, 3), sessionId: '0199a000-0000-7000-8000-00000000beef' },
      {
        type: 'segment',
        clientEventId: uuidv7(),
        sessionId: s.id,
        domain: 'x.com',
        startedAt: at(5),
        endedAt: at(4),
      },
    ]);
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected.map((r: { reason: string }) => r.reason.split(':')[0]).sort()).toEqual(
      ['invalid', 'invalid', 'invalid_domain', 'outside_session_window', 'unknown_session'],
    );
  });

  it('limits batch size', async () => {
    const s = await createSession(t.app, u);
    const events = Array.from({ length: 501 }, () => ({
      type: 'heartbeat',
      clientEventId: uuidv7(),
      sessionId: s.id,
      at: at(0),
    }));
    const res = await as(t.app, d.accessToken).post('/api/v1/activity/batch').send({ events });
    expect(res.status).toBe(422);
  });

  it('accepts small clock skew but clips segments to the session window', async () => {
    const s = await createSession(t.app, u, { durationMin: 30 });
    t.clock.set(at(40));
    await ingest([seg(s.id, 'github.com', -2, 3), seg(s.id, 'leetcode.com', 28, 33)]);
    const rows = await testDb().activitySegment.findMany({
      where: { sessionId: s.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(
      rows.map((r) => [r.startedAt.toISOString(), r.endedAt.toISOString(), r.durationSec]),
    ).toEqual([
      [at(0), at(3), 180],
      [at(28), at(30), 120],
    ]);
  });

  it('splits segments at work-block boundaries and drops break time', async () => {
    const s = await createSession(t.app, u, { durationMin: 60 });
    // Simulate a Phase 2 multi-block plan: work 0–25, break 25–35, work 35–60.
    const db = testDb();
    await db.focusSessionBlock.deleteMany({ where: { sessionId: s.id } });
    await db.focusSessionBlock.createMany({
      data: [
        {
          id: uuidv7(),
          sessionId: s.id,
          idx: 0,
          kind: 'work',
          startsAt: new Date(at(0)),
          endsAt: new Date(at(25)),
        },
        {
          id: uuidv7(),
          sessionId: s.id,
          idx: 1,
          kind: 'break',
          startsAt: new Date(at(25)),
          endsAt: new Date(at(35)),
        },
        {
          id: uuidv7(),
          sessionId: s.id,
          idx: 2,
          kind: 'work',
          startsAt: new Date(at(35)),
          endsAt: new Date(at(60)),
        },
      ],
    });
    t.clock.set(at(50));
    const ev = seg(s.id, 'github.com', 20, 40);
    await ingest([ev]);
    const rows = await db.activitySegment.findMany({
      where: { clientEventId: ev.clientEventId },
      orderBy: { part: 'asc' },
    });
    expect(rows.map((r) => [r.part, r.durationSec])).toEqual([
      [0, 300],
      [1, 300],
    ]);
  });

  it('flags reload loops on blocked attempts (same host within 10 s)', async () => {
    const s = await createSession(t.app, u, { blockedDomains: ['instagram.com'] });
    t.clock.set(at(5));
    const mk = (sec: number, domain = 'instagram.com') => ({
      type: 'blocked_attempt',
      clientEventId: uuidv7(),
      sessionId: s.id,
      domain,
      at: at(1, sec),
    });
    await ingest([mk(0), mk(4)]);
    await ingest([mk(9), mk(30), mk(31, 'reddit.com')]);
    const rows = await testDb().blockedAttempt.findMany({
      where: { sessionId: s.id },
      orderBy: { attemptedAt: 'asc' },
    });
    expect(rows.map((r) => r.deduped)).toEqual([false, true, true, false, false]);
  });

  it('records heartbeat gaps as extension-offline time', async () => {
    const s = await createSession(t.app, u);
    t.clock.set(at(30));
    const hb = (min: number) => ({
      type: 'heartbeat',
      clientEventId: uuidv7(),
      sessionId: s.id,
      at: at(min),
    });
    await ingest([hb(0), hb(0.5), hb(1)]);
    await ingest([hb(11), hb(11.5)]); // 10-minute gap
    const p = await testDb().sessionPresence.findUniqueOrThrow({
      where: { sessionId_deviceId: { sessionId: s.id, deviceId: d.deviceId } },
    });
    expect(p.offlineSec).toBe(600);
    const report = await as(t.app, u.accessToken)
      .get(`/api/v1/sessions/${s.id}/report`)
      .expect(200);
    expect(report.body.metrics.extensionOfflineSec).toBe(600);
  });
});

describe('privacy in ingestion', () => {
  it('drops titles unless the user opted in; never stores titles of sensitive sites; scrubs the rest', async () => {
    const s = await createSession(t.app, u);
    t.clock.set(at(20));
    await ingest([seg(s.id, 'youtube.com', 0, 1, 'Binary Search explained - jay@example.com')]);
    let row = await testDb().activitySegment.findFirstOrThrow({
      where: { sessionId: s.id, host: 'youtube.com' },
    });
    expect(row.title).toBeNull();

    await as(t.app, u.accessToken)
      .patch('/api/v1/me/settings')
      .send({ titleCollectionEnabled: true })
      .expect(200);
    await ingest([
      seg(s.id, 'youtube.com', 1, 2, 'Binary Search explained - jay@example.com'),
      seg(s.id, 'mail.google.com', 2, 3, 'Inbox (4) - private stuff'),
    ]);
    row = await testDb().activitySegment.findFirstOrThrow({
      where: { sessionId: s.id, host: 'youtube.com', title: { not: null } },
    });
    expect(row.title).toBe('Binary Search explained - [email]');
    const mail = await testDb().activitySegment.findFirstOrThrow({
      where: { sessionId: s.id, host: 'mail.google.com' },
    });
    expect(mail.title).toBeNull();
  });

  it('never stores segments for never-track domains', async () => {
    await as(t.app, u.accessToken)
      .post('/api/v1/domain-rules')
      .send({ domain: 'mybank.com', list: 'never_track' })
      .expect(201);
    const s = await createSession(t.app, u);
    t.clock.set(at(10));
    const res = await ingest([seg(s.id, 'netbanking.mybank.com', 0, 5)]);
    expect(res.body.accepted).toBe(1);
    expect(await testDb().activitySegment.count({ where: { sessionId: s.id } })).toBe(0);
  });
});

describe('relabel overrides and deletion', () => {
  it('"apply to future" creates a task-scoped override that classifies later visits', async () => {
    const api = as(t.app, u.accessToken);
    const task = await api
      .post('/api/v1/tasks')
      .send({ title: 'DSA', category: 'coding_practice' })
      .expect(201);
    const s1 = await createSession(t.app, u, { durationMin: 30, taskIds: [task.body.id] });
    t.clock.set(at(10));
    await ingest([seg(s1.id, 'youtube.com', 0, 5)]);
    const yt = await testDb().activitySegment.findFirstOrThrow({ where: { sessionId: s1.id } });
    expect(yt.label).toBe('UNCERTAIN');
    await api
      .patch(`/api/v1/activity/segments/${yt.id}/label`)
      .send({ label: 'UNPLANNED_RELEVANT', applyToFuture: true })
      .expect(200);
    const rules = await api.get('/api/v1/domain-rules?list=relevant').expect(200);
    expect(rules.body.items).toEqual([
      expect.objectContaining({ host: 'youtube.com', scope: 'coding_practice' }),
    ]);

    await api
      .post(`/api/v1/sessions/${s1.id}/end`)
      .send({ expectedVersion: 1, confirm: true })
      .expect(200);
    const s2 = await createSession(t.app, u, { durationMin: 30, taskIds: [task.body.id] });
    t.clock.set(at(20));
    await ingest([seg(s2.id, 'm.youtube.com', 11, 15)]);
    const later = await testDb().activitySegment.findFirstOrThrow({ where: { sessionId: s2.id } });
    expect(later).toMatchObject({ label: 'UNPLANNED_RELEVANT', labelSource: 'user_override' });
    expect(await testDb().segmentFeedback.count({ where: { userId: u.id } })).toBe(1);
  });

  it('deleting session activity recomputes the final report', async () => {
    const api = as(t.app, u.accessToken);
    const s = await createSession(t.app, u, { durationMin: 30, relevantDomains: ['github.com'] });
    t.clock.set(at(31));
    await ingest([
      seg(s.id, 'github.com', 0, 20),
      { type: 'final_flush', clientEventId: uuidv7(), sessionId: s.id, at: at(31) },
    ]);
    expect((await api.get(`/api/v1/sessions/${s.id}/report`)).body.metrics.plannedSec).toBe(1200);
    const del = await api.delete(`/api/v1/sessions/${s.id}/activity`).expect(200);
    expect(del.body).toEqual({ deletedSegments: 1, deletedBlockedAttempts: 0 });
    const report = await api.get(`/api/v1/sessions/${s.id}/report`).expect(200);
    expect(report.body.metrics).toMatchObject({
      plannedSec: 0,
      trackedBrowserSec: 0,
      outsideBrowserSec: 1800,
    });
    expect(report.body.version).toBe(2);
    const daily = await testDb().userDailyStats.findFirstOrThrow({ where: { userId: u.id } });
    expect(daily.plannedSec).toBe(0);
  });

  it('deletes activity by time range', async () => {
    const api = as(t.app, u.accessToken);
    const s = await createSession(t.app, u);
    t.clock.set(at(30));
    await ingest([
      seg(s.id, 'github.com', 0, 5),
      seg(s.id, 'github.com', 10, 15),
      seg(s.id, 'github.com', 20, 25),
    ]);
    const res = await api
      .delete(`/api/v1/activity?from=${encodeURIComponent(at(8))}&to=${encodeURIComponent(at(18))}`)
      .expect(200);
    expect(res.body.deletedSegments).toBe(1);
    expect(await testDb().activitySegment.count({ where: { sessionId: s.id } })).toBe(2);
    await api
      .delete(`/api/v1/activity?from=${encodeURIComponent(at(18))}&to=${encodeURIComponent(at(8))}`)
      .expect(422);
  });
});
