import { beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  buildTestApp,
  createSession,
  pairDevice,
  registerUser,
  resetDb,
  type TestApp,
  type TestUser,
} from './helpers.js';

/**
 * IDOR harness (ROADMAP 1.1): user B must get 404 on every resource owned by user A,
 * for every verb. New endpoints get added to this matrix.
 */
let t: TestApp;
let a: TestUser;
let b: TestUser;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  t = await buildTestApp();
  a = await registerUser(t.app);
  b = await registerUser(t.app);
  const api = as(t.app, a.accessToken);
  ids.task = (await api.post('/api/v1/tasks').send({ title: 'A task' }).expect(201)).body.id;
  ids.rule = (
    await api
      .post('/api/v1/domain-rules')
      .send({ domain: 'reddit.com', list: 'blocked' })
      .expect(201)
  ).body.id;
  const session = await createSession(t.app, a, {
    taskIds: [ids.task],
    blockedDomains: ['instagram.com'],
  });
  ids.session = session.id;
  ids.sessionTask = (session.tasks as { id: string }[])[0]!.id;
  const device = await pairDevice(t.app, a);
  ids.device = device.deviceId;
  await as(t.app, device.accessToken)
    .post('/api/v1/activity/batch')
    .send({
      events: [
        {
          type: 'segment',
          clientEventId: '0199a000-0000-7000-8000-000000000001',
          sessionId: ids.session,
          domain: 'github.com',
          startedAt: '2026-10-05T09:00:00.000Z',
          endedAt: '2026-10-05T09:01:00.000Z',
        },
      ],
    })
    .expect(202);
  await t.ctx.bus.idle();
  const seg = await t.ctx.db.activitySegment.findFirstOrThrow({
    where: { sessionId: ids.session },
  });
  ids.segment = seg.id;
});

const cases: [string, string, () => string, Record<string, unknown>?][] = [
  ['GET', 'task', () => `/api/v1/tasks/${ids.task}`],
  ['PATCH', 'task', () => `/api/v1/tasks/${ids.task}`, { title: 'hijack' }],
  ['DELETE', 'task', () => `/api/v1/tasks/${ids.task}`],
  ['DELETE', 'domain rule', () => `/api/v1/domain-rules/${ids.rule}`],
  ['GET', 'session', () => `/api/v1/sessions/${ids.session}`],
  [
    'POST',
    'session end',
    () => `/api/v1/sessions/${ids.session}/end`,
    { expectedVersion: 1, confirm: true },
  ],
  [
    'POST',
    'session extend',
    () => `/api/v1/sessions/${ids.session}/extend`,
    { expectedVersion: 1, minutes: 10 },
  ],
  [
    'POST',
    'session cancel',
    () => `/api/v1/sessions/${ids.session}/cancel`,
    { expectedVersion: 1 },
  ],
  ['POST', 'session start', () => `/api/v1/sessions/${ids.session}/start`, { expectedVersion: 1 }],
  [
    'PATCH',
    'session task',
    () => `/api/v1/sessions/${ids.session}/tasks/${ids.sessionTask}`,
    { completed: true },
  ],
  [
    'POST',
    'session domain',
    () => `/api/v1/sessions/${ids.session}/domains`,
    { domain: 'x.com', kind: 'blocked' },
  ],
  [
    'DELETE',
    'session domain',
    () => `/api/v1/sessions/${ids.session}/domains/instagram.com?confirm=true`,
  ],
  ['GET', 'session activity', () => `/api/v1/sessions/${ids.session}/activity`],
  ['DELETE', 'session activity', () => `/api/v1/sessions/${ids.session}/activity`],
  ['GET', 'session report', () => `/api/v1/sessions/${ids.session}/report`],
  [
    'PATCH',
    'segment label',
    () => `/api/v1/activity/segments/${ids.segment}/label`,
    { label: 'DISTRACTION' },
  ],
  ['DELETE', 'device', () => `/api/v1/devices/${ids.device}`],
];

describe('IDOR matrix: user B cannot touch user A resources', () => {
  it.each(cases)('%s %s → 404', async (method, _name, url, body) => {
    const api = as(t.app, b.accessToken);
    const req =
      method === 'GET'
        ? api.get(url())
        : method === 'POST'
          ? api.post(url()).send(body ?? {})
          : method === 'PATCH'
            ? api.patch(url()).send(body ?? {})
            : api.delete(url());
    const res = await req;
    expect(res.status).toBe(404);
  });

  it("A's data is unchanged after B's attempts", async () => {
    const api = as(t.app, a.accessToken);
    expect((await api.get(`/api/v1/tasks/${ids.task}`).expect(200)).body.title).toBe('A task');
    const s = await api.get(`/api/v1/sessions/${ids.session}`).expect(200);
    expect(s.body.status).toBe('ACTIVE');
    expect(s.body.blockedDomains).toEqual(['instagram.com']);
    const seg = await t.ctx.db.activitySegment.findUniqueOrThrow({ where: { id: ids.segment } });
    expect(seg.labelSource).not.toBe('user_feedback');
    const device = await t.ctx.db.device.findUniqueOrThrow({ where: { id: ids.device } });
    expect(device.revokedAt).toBeNull();
  });

  it("B's lists never include A's resources", async () => {
    const api = as(t.app, b.accessToken);
    expect((await api.get('/api/v1/tasks').expect(200)).body.items).toEqual([]);
    expect((await api.get('/api/v1/sessions').expect(200)).body.items).toEqual([]);
    expect((await api.get('/api/v1/domain-rules').expect(200)).body.items).toEqual([]);
    expect((await api.get('/api/v1/devices').expect(200)).body.items).toEqual([]);
    expect((await api.get('/api/v1/sessions/active').expect(200)).body.session).toBeNull();
  });

  it("B's device cannot post activity into A's session", async () => {
    const bDevice = await pairDevice(t.app, b);
    const res = await as(t.app, bDevice.accessToken)
      .post('/api/v1/activity/batch')
      .send({
        events: [
          {
            type: 'blocked_attempt',
            clientEventId: '0199a000-0000-7000-8000-0000000000bb',
            sessionId: ids.session,
            domain: 'instagram.com',
            at: '2026-10-05T09:00:30.000Z',
          },
        ],
      })
      .expect(202);
    expect(res.body.rejected).toEqual([
      { clientEventId: '0199a000-0000-7000-8000-0000000000bb', reason: 'unknown_session' },
    ]);
  });

  it('non-UUID ids are 404, not 500', async () => {
    await as(t.app, a.accessToken).get('/api/v1/tasks/not-a-uuid').expect(404);
    await as(t.app, a.accessToken).get("/api/v1/sessions/1' OR '1'='1").expect(404);
  });
});
