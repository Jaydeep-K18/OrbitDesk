import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  as,
  buildTestApp,
  createSession,
  pairDevice,
  refreshCookieFrom,
  registerUser,
  resetDb,
  testDb,
  type TestApp,
} from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  await resetDb();
  t = await buildTestApp();
});

const refresh = (cookie: string) =>
  request(t.app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-FG-CSRF', '1');

describe('register → verify → login → refresh → reuse detection → logout', () => {
  it('runs the full flow', async () => {
    const email = 'Flow.User@Example.com';
    const reg = await request(t.app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'correct-horse-battery',
        displayName: 'Flow',
        timezone: 'Asia/Kolkata',
      })
      .expect(201);
    expect(reg.body.user).toMatchObject({
      email: 'flow.user@example.com',
      emailVerified: false,
      timezone: 'Asia/Kolkata',
    });
    expect(reg.body.accessToken).toBeTruthy();
    const cookieHeader = reg.headers['set-cookie'] as unknown as string[];
    expect(cookieHeader.join(';')).toMatch(/HttpOnly/);
    expect(cookieHeader.join(';')).toMatch(/SameSite=Strict/);

    // Verification email with a single-use link.
    const mail = t.mailer.lastTo('flow.user@example.com')!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    await request(t.app).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    await request(t.app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
    const me = await as(t.app, reg.body.accessToken).get('/api/v1/me').expect(200);
    expect(me.body.emailVerified).toBe(true);

    // Login is case-insensitive on email.
    const login = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: 'FLOW.user@example.com', password: 'correct-horse-battery' })
      .expect(200);
    const c1 = refreshCookieFrom(login.headers['set-cookie']);

    // Rotation issues a new cookie; the old one becomes a reuse signal.
    const r1 = await refresh(c1).expect(200);
    const c2 = refreshCookieFrom(r1.headers['set-cookie']);
    expect(c2).not.toBe(c1);
    expect(r1.body.accessToken).toBeTruthy();

    // Reusing the stale token revokes the whole family — c2 dies too.
    await refresh(c1).expect(401);
    await refresh(c2).expect(401);
    const reuse = await testDb().auditLog.findFirst({ where: { event: 'refresh_token_reuse' } });
    expect(reuse).not.toBeNull();

    // Logout revokes the current family.
    const login2 = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct-horse-battery' })
      .expect(200);
    const c3 = refreshCookieFrom(login2.headers['set-cookie']);
    await request(t.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', c3)
      .set('X-FG-CSRF', '1')
      .expect(204);
    await refresh(c3).expect(401);
  });

  it('logout-all revokes every browser session', async () => {
    const u = await registerUser(t.app);
    const second = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password })
      .expect(200);
    const c2 = refreshCookieFrom(second.headers['set-cookie']);
    await as(t.app, u.accessToken).post('/api/v1/auth/logout-all').expect(204);
    await refresh(u.refreshCookie).expect(401);
    await refresh(c2).expect(401);
  });
});

describe('CSRF protection on cookie endpoints', () => {
  it('requires the X-FG-CSRF header and a matching Origin', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/refresh').set('Cookie', u.refreshCookie).expect(403);
    await request(t.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', u.refreshCookie)
      .set('X-FG-CSRF', '1')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(t.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', u.refreshCookie)
      .set('X-FG-CSRF', '1')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
  });
});

describe('login & registration validation', () => {
  it('rejects duplicate emails, weak passwords and bad time zones', async () => {
    const u = await registerUser(t.app);
    const dup = await request(t.app)
      .post('/api/v1/auth/register')
      .send({ email: u.email.toUpperCase(), password: 'another-long-pass', displayName: 'X' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');

    const weak = await request(t.app)
      .post('/api/v1/auth/register')
      .send({ email: 'w@example.com', password: 'short', displayName: 'W' });
    expect(weak.status).toBe(422);
    expect(weak.body.errors[0].path).toBe('password');

    const tz = await request(t.app).post('/api/v1/auth/register').send({
      email: 'tz@example.com',
      password: 'long-enough-pass',
      displayName: 'T',
      timezone: 'Mars/Base',
    });
    expect(tz.status).toBe(422);
  });

  it('gives the same error for unknown email and wrong password (no enumeration)', async () => {
    const u = await registerUser(t.app);
    const wrong = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'not-the-password' });
    const unknown = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever-pass' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.title).toBe(wrong.body.title);
  });

  it('rejects tampered, expired and wrong-audience access tokens', async () => {
    const u = await registerUser(t.app);
    const tampered = u.accessToken.slice(0, -4) + 'AAAA';
    await as(t.app, tampered).get('/api/v1/me').expect(401);
    await as(t.app, 'not.a.jwt').get('/api/v1/me').expect(401);
    await request(t.app).get('/api/v1/me').expect(401);

    const device = await pairDevice(t.app, u);
    await as(t.app, device.accessToken).get('/api/v1/me').expect(401); // extension token ≠ web audience

    t.clock.advance(16 * 60_000); // past the 15-minute access TTL
    await as(t.app, u.accessToken).get('/api/v1/me').expect(401);
    t.clock.advance(-16 * 60_000);
  });
});

describe('password reset', () => {
  it('resets via single-use emailed token and signs out other sessions', async () => {
    const u = await registerUser(t.app);
    const unknown = await request(t.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' });
    const known = await request(t.app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: u.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const token = /token=([\w-]+)/.exec(t.mailer.lastTo(u.email)!.text)![1]!;
    await request(t.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password' })
      .expect(204);
    await request(t.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'another-new-password' })
      .expect(400);
    await refresh(u.refreshCookie).expect(401);
    await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password })
      .expect(401);
    await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'brand-new-password' })
      .expect(200);
  });

  it('expires reset tokens after 30 minutes', async () => {
    const u = await registerUser(t.app);
    await request(t.app).post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(202);
    const token = /token=([\w-]+)/.exec(t.mailer.lastTo(u.email)!.text)![1]!;
    t.clock.advance(31 * 60_000);
    await request(t.app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password' })
      .expect(400);
    t.clock.advance(-31 * 60_000);
  });
});

describe('account management', () => {
  it('updates profile, changes password and manages settings', async () => {
    const u = await registerUser(t.app);
    const api = as(t.app, u.accessToken);
    const p = await api
      .patch('/api/v1/me')
      .send({ displayName: 'Renamed', timezone: 'Europe/London' })
      .expect(200);
    expect(p.body).toMatchObject({ displayName: 'Renamed', timezone: 'Europe/London' });

    await api
      .post('/api/v1/me/change-password')
      .send({ currentPassword: 'wrong-one-here', newPassword: 'whatever-new-1' })
      .expect(401);
    await api
      .post('/api/v1/me/change-password')
      .send({ currentPassword: u.password, newPassword: 'whatever-new-1' })
      .expect(204);
    await refresh(u.refreshCookie).expect(200); // current session survives

    const s = await api.get('/api/v1/me/settings').expect(200);
    expect(s.body).toEqual({
      trackingEnabled: true,
      titleCollectionEnabled: false,
      widgetEnabled: true,
      blockDuringBreaks: false,
      activityRetentionDays: 180,
    });
    const s2 = await api
      .patch('/api/v1/me/settings')
      .send({ titleCollectionEnabled: true })
      .expect(200);
    expect(s2.body.titleCollectionEnabled).toBe(true);
    await api.patch('/api/v1/me/settings').send({ activityRetentionDays: 5 }).expect(422);
  });

  it('deletes the account and cascades all data (requires password)', async () => {
    const u = await registerUser(t.app);
    const api = as(t.app, u.accessToken);
    await api.post('/api/v1/tasks').send({ title: 'Doomed task' }).expect(201);
    await createSession(t.app, u);
    const device = await pairDevice(t.app, u);

    await api.delete('/api/v1/me').send({ password: 'wrong-password!', confirm: true }).expect(401);
    await api.delete('/api/v1/me').send({ password: u.password }).expect(422); // missing confirm
    await api.delete('/api/v1/me').send({ password: u.password, confirm: true }).expect(204);

    const db = testDb();
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await db.task.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.focusSession.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.device.count({ where: { userId: u.id } })).toBe(0);
    // The paired extension loses access immediately.
    await as(t.app, device.accessToken).get('/api/v1/extension/state').expect(401);
    await request(t.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(401);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per IP+email to 5/min', async () => {
    const limited = await buildTestApp({ config: { rateLimits: { enabled: true } } });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(limited.app)
        .post('/api/v1/auth/login')
        .send({ email: 'rl@example.com', password: 'nope-nope-nope' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    const last = await request(limited.app)
      .post('/api/v1/auth/login')
      .send({ email: 'rl@example.com', password: 'x' });
    expect(last.body.code).toBe('RATE_LIMITED');
  });
});
