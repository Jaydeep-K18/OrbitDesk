import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  as,
  buildTestApp,
  createSession,
  pairDevice,
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
  t = await buildTestApp();
  u = await registerUser(t.app);
});

describe('device pairing', () => {
  it('pairs with a single-use code and issues scoped tokens', async () => {
    const code = await as(t.app, u.accessToken).post('/api/v1/devices/pairing-codes').expect(201);
    expect(code.body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(code.body.expiresAt).toBe('2026-10-05T09:02:00.000Z');

    // Codes are case/format-insensitive (users may type "abcd-efgh").
    const typed = `${code.body.code.slice(0, 4).toLowerCase()}-${code.body.code.slice(4)}`;
    const paired = await request(t.app)
      .post('/api/v1/devices/pair')
      .send({ code: typed, type: 'extension', name: 'Chrome on Windows', version: '0.1.0' })
      .expect(201);
    expect(paired.body).toMatchObject({ expiresIn: 900 });
    const again = await request(t.app)
      .post('/api/v1/devices/pair')
      .send({ code: code.body.code, type: 'extension', name: 'x' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('PAIRING_CODE_INVALID');

    const devices = await as(t.app, u.accessToken).get('/api/v1/devices').expect(200);
    expect(devices.body.items).toEqual([
      expect.objectContaining({
        id: paired.body.deviceId,
        type: 'extension',
        name: 'Chrome on Windows',
        scopes: ['session:read', 'activity:write'],
        revokedAt: null,
      }),
    ]);
  });

  it('expires codes after 2 minutes', async () => {
    const code = await as(t.app, u.accessToken).post('/api/v1/devices/pairing-codes').expect(201);
    t.clock.advance(121_000);
    await request(t.app)
      .post('/api/v1/devices/pair')
      .send({ code: code.body.code, type: 'extension', name: 'x' })
      .expect(400);
  });

  it('only one of two concurrent pairings with the same code succeeds', async () => {
    const code = await as(t.app, u.accessToken).post('/api/v1/devices/pairing-codes').expect(201);
    const results = await Promise.all(
      [1, 2].map(() =>
        request(t.app)
          .post('/api/v1/devices/pair')
          .send({ code: code.body.code, type: 'extension', name: 'race' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it('rotates device refresh tokens with reuse detection', async () => {
    const d = await pairDevice(t.app, u);
    const r1 = await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: d.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(d.refreshToken);
    await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: d.refreshToken })
      .expect(401);
    await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('a web refresh cookie cannot be used as a device token and vice versa', async () => {
    const d = await pairDevice(t.app, u);
    const res = await request(t.app)
      .post('/api/v1/auth/refresh')
      .set('X-FG-CSRF', '1')
      .set('Cookie', `fg_rt=${d.refreshToken}`);
    expect(res.status).toBe(401);
    // ...and the stray call did not consume the device's token.
    await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: d.refreshToken })
      .expect(200);
    const web = await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: u.refreshCookie.split('=')[1] });
    expect(web.status).toBe(401);
  });

  it('revocation takes effect immediately for state, ingestion and refresh', async () => {
    const d = await pairDevice(t.app, u);
    await as(t.app, d.accessToken).get('/api/v1/extension/state').expect(200);
    await as(t.app, u.accessToken).delete(`/api/v1/devices/${d.deviceId}`).expect(204);
    await as(t.app, d.accessToken).get('/api/v1/extension/state').expect(401);
    await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: d.refreshToken })
      .expect(401);
    const listed = await as(t.app, u.accessToken).get('/api/v1/devices').expect(200);
    expect(listed.body.items[0].revokedAt).not.toBeNull();
  });

  it('enforces scopes: a collector token cannot write browser activity', async () => {
    const c = await pairDevice(t.app, u, 'collector');
    const s = await createSession(t.app, u);
    await as(t.app, c.accessToken).get('/api/v1/extension/state').expect(200); // session:read
    const res = await as(t.app, c.accessToken)
      .post('/api/v1/activity/batch')
      .send({
        events: [
          {
            type: 'heartbeat',
            clientEventId: '0199a000-0000-7000-8000-0000000000c1',
            sessionId: s.id,
            at: '2026-10-05T09:00:00.000Z',
          },
        ],
      });
    expect(res.status).toBe(403);
  });
});

describe('GET /extension/state', () => {
  it('returns serverNow, the session with lists and blocks, and privacy settings', async () => {
    const d = await pairDevice(t.app, u);
    const api = as(t.app, d.accessToken);
    let res = await api.get('/api/v1/extension/state').expect(200);
    expect(res.body).toMatchObject({
      serverNow: '2026-10-05T09:00:00.000Z',
      session: null,
      minSupportedVersion: '0.1.0',
    });
    expect(res.body.settings).toMatchObject({
      trackingEnabled: true,
      titleCollectionEnabled: false,
      widgetEnabled: true,
      neverTrack: [],
    });
    expect(res.body.settings.sensitiveDomains).toContain('mail.google.com');

    await as(t.app, u.accessToken)
      .post('/api/v1/domain-rules')
      .send({ domain: 'mybank.com', list: 'never_track' })
      .expect(201);
    const s = await createSession(t.app, u, {
      blockedDomains: ['instagram.com'],
      relevantDomains: ['leetcode.com'],
    });
    res = await api.get('/api/v1/extension/state').expect(200);
    expect(res.body.session).toMatchObject({
      id: s.id,
      status: 'ACTIVE',
      blockedDomains: ['instagram.com'],
      relevantDomains: ['leetcode.com'],
      blocks: [expect.objectContaining({ kind: 'work' })],
    });
    expect(res.body.settings.neverTrack).toEqual(['mybank.com']);
  });

  it('answers 304 when nothing changed, and a new body when the session changes', async () => {
    const d = await pairDevice(t.app, u);
    const api = as(t.app, d.accessToken);
    await createSession(t.app, u, { blockedDomains: ['instagram.com'] });
    const first = await api.get('/api/v1/extension/state').expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    t.clock.advance(30_000); // serverNow changes but isn't part of the ETag
    await api.get('/api/v1/extension/state').set('If-None-Match', etag).expect(304);
    const sessionId = first.body.session.id;
    await as(t.app, u.accessToken)
      .post(`/api/v1/sessions/${sessionId}/domains`)
      .send({ domain: 'reddit.com', kind: 'blocked' })
      .expect(201);
    const changed = await api.get('/api/v1/extension/state').set('If-None-Match', etag).expect(200);
    expect(changed.body.session.blockedDomains).toEqual(['instagram.com', 'reddit.com']);
  });

  it('updates lastSeenAt for the device', async () => {
    const d = await pairDevice(t.app, u);
    t.clock.advance(120_000);
    await as(t.app, d.accessToken).get('/api/v1/extension/state').expect(200);
    const row = await testDb().device.findUniqueOrThrow({ where: { id: d.deviceId } });
    expect(row.lastSeenAt?.toISOString()).toBe('2026-10-05T09:02:00.000Z');
  });
});
