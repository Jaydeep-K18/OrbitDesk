import { beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  buildTestApp,
  createSession,
  minutes,
  registerUser,
  resetDb,
  testDb,
  type TestApp,
  type TestUser,
} from './helpers.js';

let t: TestApp;
let u: TestUser;
beforeEach(async () => {
  await resetDb();
  // These tests travel in time; keep access tokens valid for the whole day.
  t = await buildTestApp({ accessTtlSec: 86_400 });
  u = await registerUser(t.app);
});

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-10-05T09:00:00.000Z');

describe('create', () => {
  it('starts now with snapshots of tasks and normalized domain lists', async () => {
    const api = as(t.app, u.accessToken);
    const task = await api
      .post('/api/v1/tasks')
      .send({ title: 'Binary search', category: 'coding_practice' })
      .expect(201);
    const s = await createSession(t.app, u, {
      durationMin: 120,
      taskIds: [task.body.id],
      blockedDomains: ['WWW.Instagram.com', 'reddit.com', 'reddit.com'],
      relevantDomains: ['https://leetcode.com/problems/'],
    });
    expect(s).toMatchObject({
      status: 'ACTIVE',
      startsAt: '2026-10-05T09:00:00.000Z',
      endsAt: '2026-10-05T11:00:00.000Z',
      startedAt: '2026-10-05T09:00:00.000Z',
      plannedDurationMin: 120,
      version: 1,
      blockedDomains: ['instagram.com', 'reddit.com'],
      relevantDomains: ['leetcode.com'],
    });
    expect(s.blocks).toEqual([
      expect.objectContaining({
        idx: 0,
        kind: 'work',
        startsAt: '2026-10-05T09:00:00.000Z',
        endsAt: '2026-10-05T11:00:00.000Z',
      }),
    ]);
    expect(s.tasks).toEqual([
      expect.objectContaining({
        title: 'Binary search',
        category: 'coding_practice',
        completedAt: null,
      }),
    ]);
    // The underlying task moves to in_progress.
    expect((await api.get(`/api/v1/tasks/${task.body.id}`).expect(200)).body.status).toBe(
      'in_progress',
    );

    // Editing the task later doesn't rewrite the session snapshot.
    await api.patch(`/api/v1/tasks/${task.body.id}`).send({ title: 'Renamed' }).expect(200);
    expect((await api.get(`/api/v1/sessions/${s.id}`).expect(200)).body.tasks[0].title).toBe(
      'Binary search',
    );
  });

  it('schedules a future session', async () => {
    const s = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(30)),
      durationMin: 45,
    });
    expect(s).toMatchObject({
      status: 'SCHEDULED',
      startedAt: null,
      endsAt: iso(T0 + minutes(75)),
    });
  });

  it.each([
    [{ startMode: 'at' }, 'startsAt'],
    [{ startMode: 'at', startsAt: iso(T0 - minutes(10)) }, 'startsAt'],
    [{ startMode: 'at', startsAt: iso(T0 + 31 * 86_400_000) }, 'startsAt'],
    [{ durationMin: 4 }, 'durationMin'],
    [{ durationMin: 481 }, 'durationMin'],
    [{ blockedDomains: ['not a domain'] }, 'blockedDomains.0'],
    [{ taskIds: ['0199a000-0000-7000-8000-00000000dead'] }, 'taskIds'],
  ])('rejects invalid input %j', async (body, path) => {
    const res = await as(t.app, u.accessToken)
      .post('/api/v1/sessions')
      .send({ startMode: 'now', durationMin: 60, ...body });
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(path);
  });

  it('rejects a domain in both lists', async () => {
    const res = await as(t.app, u.accessToken)
      .post('/api/v1/sessions')
      .send({
        startMode: 'now',
        durationMin: 30,
        blockedDomains: ['youtube.com'],
        relevantDomains: ['www.youtube.com'],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DOMAIN_LIST_CONFLICT');
  });

  it('prevents overlapping sessions with the database exclusion constraint', async () => {
    await createSession(t.app, u, { durationMin: 60 });
    const overlap = await as(t.app, u.accessToken)
      .post('/api/v1/sessions')
      .send({ startMode: 'at', startsAt: iso(T0 + minutes(30)), durationMin: 60 });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('SESSION_OVERLAP');
    // Back-to-back is fine (ranges are half-open).
    await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(60)),
      durationMin: 30,
    });
    // Other users are unaffected.
    const other = await registerUser(t.app);
    await createSession(t.app, other, { durationMin: 60 });
  });

  it('keeps exact durations across a DST change (UTC storage)', async () => {
    // US DST ends 2026-11-01 06:00 UTC (02:00 EDT → 01:00 EST). A 2h session spanning it is 7200 s.
    const dst = await buildTestApp({ now: '2026-11-01T05:00:00.000Z' });
    const user = await registerUser(dst.app, { timezone: 'America/New_York' });
    const s = await createSession(dst.app, user, { durationMin: 120 });
    expect(Date.parse(s.endsAt as string) - Date.parse(s.startsAt as string)).toBe(7_200_000);
  });
});

describe('state machine', () => {
  it('ends early with confirmation and reason, then rejects further actions', async () => {
    const s = await createSession(t.app, u);
    const api = as(t.app, u.accessToken);
    await api.post(`/api/v1/sessions/${s.id}/end`).send({ expectedVersion: 1 }).expect(422); // confirm required
    t.clock.advance(minutes(20));
    const ended = await api
      .post(`/api/v1/sessions/${s.id}/end`)
      .send({ expectedVersion: 1, confirm: true, reason: 'Done early' })
      .expect(200);
    expect(ended.body).toMatchObject({
      status: 'ENDED_EARLY',
      endedAt: iso(T0 + minutes(20)),
      endReason: 'Done early',
      version: 2,
    });
    const again = await api
      .post(`/api/v1/sessions/${s.id}/extend`)
      .send({ expectedVersion: 2, minutes: 10 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SESSION_STATE_INVALID');
    // A new session can start right away.
    await createSession(t.app, u, { durationMin: 30 });
  });

  it('extends an active session (last block grows) but not into the next session', async () => {
    const s = await createSession(t.app, u, { durationMin: 60 });
    await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(90)),
      durationMin: 30,
    });
    const api = as(t.app, u.accessToken);
    const ext = await api
      .post(`/api/v1/sessions/${s.id}/extend`)
      .send({ expectedVersion: 1, minutes: 15 })
      .expect(200);
    expect(ext.body.endsAt).toBe(iso(T0 + minutes(75)));
    expect(ext.body.blocks[0].endsAt).toBe(iso(T0 + minutes(75)));
    const tooFar = await api
      .post(`/api/v1/sessions/${s.id}/extend`)
      .send({ expectedVersion: 2, minutes: 30 });
    expect(tooFar.status).toBe(409);
    expect(tooFar.body.code).toBe('SESSION_OVERLAP');
    expect((await api.get(`/api/v1/sessions/${s.id}`)).body.endsAt).toBe(iso(T0 + minutes(75)));
  });

  it('concurrent end + extend: exactly one wins, the other gets 409', async () => {
    const s = await createSession(t.app, u);
    const api = as(t.app, u.accessToken);
    const [a, b] = await Promise.all([
      api.post(`/api/v1/sessions/${s.id}/end`).send({ expectedVersion: 1, confirm: true }),
      api.post(`/api/v1/sessions/${s.id}/extend`).send({ expectedVersion: 1, minutes: 10 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('stale versions are rejected', async () => {
    const s = await createSession(t.app, u);
    const api = as(t.app, u.accessToken);
    await api
      .post(`/api/v1/sessions/${s.id}/extend`)
      .send({ expectedVersion: 1, minutes: 5 })
      .expect(200);
    const stale = await api
      .post(`/api/v1/sessions/${s.id}/extend`)
      .send({ expectedVersion: 1, minutes: 5 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('starts a scheduled session early, shifting its blocks', async () => {
    const s = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(60)),
      durationMin: 45,
    });
    t.clock.advance(minutes(10));
    const started = await as(t.app, u.accessToken)
      .post(`/api/v1/sessions/${s.id}/start`)
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(started.body).toMatchObject({
      status: 'ACTIVE',
      startsAt: iso(T0 + minutes(10)),
      endsAt: iso(T0 + minutes(55)),
      startedAt: iso(T0 + minutes(10)),
    });
    expect(started.body.blocks[0].startsAt).toBe(iso(T0 + minutes(10)));
  });

  it('cancels scheduled sessions only', async () => {
    const api = as(t.app, u.accessToken);
    const scheduled = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(120)),
      durationMin: 30,
    });
    const c = await api
      .post(`/api/v1/sessions/${scheduled.id}/cancel`)
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(c.body.status).toBe('CANCELLED');
    const active = await createSession(t.app, u);
    await api.post(`/api/v1/sessions/${active.id}/cancel`).send({ expectedVersion: 1 }).expect(409);
  });

  it('derives status from time on read, and the sweeper persists transitions', async () => {
    const s = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(5)),
      durationMin: 10,
    });
    const api = as(t.app, u.accessToken);
    t.clock.advance(minutes(6));
    expect((await api.get(`/api/v1/sessions/${s.id}`)).body.status).toBe('ACTIVE'); // before any sweep
    let r = await t.services.sweeper.tick();
    expect(r.started).toBe(1);
    t.clock.advance(minutes(10));
    expect((await api.get(`/api/v1/sessions/${s.id}`)).body.status).toBe('COMPLETED');
    r = await t.services.sweeper.tick();
    expect(r).toMatchObject({ started: 0, completed: 1, finalized: 0 }); // still inside the grace window
    t.clock.advance(minutes(3));
    r = await t.services.sweeper.tick();
    expect(r.finalized).toBe(1);
    const row = await testDb().focusSession.findUniqueOrThrow({
      where: { id: s.id },
      include: { report: true },
    });
    expect(row).toMatchObject({ status: 'COMPLETED', endedAt: new Date(iso(T0 + minutes(15))) });
    expect(row.finalizedAt).not.toBeNull();
    expect(row.report?.version).toBe(1);
  });

  it('a session whose whole window passed while offline is completed in one sweep', async () => {
    const s = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(5)),
      durationMin: 10,
    });
    t.clock.advance(minutes(60));
    const r = await t.services.sweeper.tick();
    expect(r).toMatchObject({ started: 1, completed: 1 });
    expect((await testDb().focusSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      'COMPLETED',
    );
  });
});

describe('active endpoint, tasks and mid-session domains', () => {
  it('returns serverNow and the running (or next) session', async () => {
    const api = as(t.app, u.accessToken);
    let res = await api.get('/api/v1/sessions/active').expect(200);
    expect(res.body).toEqual({ serverNow: '2026-10-05T09:00:00.000Z', session: null });
    const next = await createSession(t.app, u, {
      startMode: 'at',
      startsAt: iso(T0 + minutes(30)),
      durationMin: 30,
    });
    res = await api.get('/api/v1/sessions/active').expect(200);
    expect(res.body.session.id).toBe(next.id);
    expect(res.body.session.status).toBe('SCHEDULED');
  });

  it('ticks tasks during the session and syncs the task status', async () => {
    const api = as(t.app, u.accessToken);
    const task = await api.post('/api/v1/tasks').send({ title: 'Read chapter' }).expect(201);
    const s = await createSession(t.app, u, { taskIds: [task.body.id] });
    const st = (s.tasks as { id: string }[])[0]!;
    const done = await api
      .patch(`/api/v1/sessions/${s.id}/tasks/${st.id}`)
      .send({ completed: true })
      .expect(200);
    expect(done.body.tasks[0].completedAt).toBe('2026-10-05T09:00:00.000Z');
    expect((await api.get(`/api/v1/tasks/${task.body.id}`)).body.status).toBe('done');
    await api
      .patch(`/api/v1/sessions/${s.id}/tasks/${st.id}`)
      .send({ completed: false })
      .expect(200);
    expect((await api.get(`/api/v1/tasks/${task.body.id}`)).body.status).toBe('in_progress');
  });

  it('adding blocked sites is free; removing one mid-session needs confirmation and is audited', async () => {
    const api = as(t.app, u.accessToken);
    const s = await createSession(t.app, u, { blockedDomains: ['instagram.com'] });
    const added = await api
      .post(`/api/v1/sessions/${s.id}/domains`)
      .send({ domain: 'www.reddit.com', kind: 'blocked' })
      .expect(201);
    expect(added.body.blockedDomains).toEqual(['instagram.com', 'reddit.com']);
    await api.delete(`/api/v1/sessions/${s.id}/domains/instagram.com`).expect(422);
    const removed = await api
      .delete(`/api/v1/sessions/${s.id}/domains/instagram.com?confirm=true`)
      .expect(200);
    expect(removed.body.blockedDomains).toEqual(['reddit.com']);
    expect(
      await testDb().auditLog.count({
        where: { event: 'session_blocked_domain_removed', userId: u.id },
      }),
    ).toBe(1);
    const clash = await api
      .post(`/api/v1/sessions/${s.id}/domains`)
      .send({ domain: 'reddit.com', kind: 'relevant' });
    expect(clash.body.code).toBe('DOMAIN_LIST_CONFLICT');
  });

  it('paginates session history', async () => {
    const api = as(t.app, u.accessToken);
    for (let i = 0; i < 3; i++) {
      await createSession(t.app, u, {
        startMode: 'at',
        startsAt: iso(T0 + minutes(60 * (i + 1))),
        durationMin: 30,
      });
    }
    const p1 = await api.get('/api/v1/sessions?limit=2').expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await api.get(`/api/v1/sessions?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
  });
});
