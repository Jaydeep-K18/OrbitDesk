import request from 'supertest';
import type { Express } from 'express';
import { FakeClock, uuidv7 } from '@focusguard/domain';
import { createApp, createContext, type AppServices } from '../src/app.js';
import type { AppConfig, AppContext } from '../src/context.js';
import { createDb, type Db } from '../src/infra/db.js';
import { createLogger } from '../src/infra/logger.js';
import { MemoryMailer } from '../src/infra/mailer.js';

let sharedDb: Db | null = null;
export function testDb(): Db {
  sharedDb ??= createDb(process.env.DATABASE_URL!);
  return sharedDb;
}

/** Monday 2026-10-05 09:00 UTC (14:30 IST). */
export const T0 = '2026-10-05T09:00:00.000Z';

export interface TestApp {
  app: Express;
  ctx: AppContext;
  services: AppServices;
  mailer: MemoryMailer;
  clock: FakeClock;
}

export async function buildTestApp(
  opts: { now?: string; config?: Partial<AppConfig>; accessTtlSec?: number } = {},
): Promise<TestApp> {
  const clock = new FakeClock(opts.now ?? T0);
  const mailer = new MemoryMailer();
  const ctx = await createContext({
    db: testDb(),
    logger: createLogger('silent'),
    clock,
    mailer,
    accessTtlSec: opts.accessTtlSec,
    config: {
      appOrigin: 'http://localhost:5173',
      cookieSecure: false,
      rateLimits: { enabled: false },
      extensionOrigins: ['chrome-extension://dmfegmfpjfegcdhojmpbbghakajhgpec'],
      ...opts.config,
    },
  });
  const { app, services } = createApp(ctx);
  return { app, ctx, services, mailer, clock };
}

const TABLES = [
  'segment_feedback',
  'activity_segments',
  'blocked_attempts',
  'session_presence',
  'session_reports',
  'session_domains',
  'session_tasks',
  'focus_session_blocks',
  'focus_sessions',
  'user_daily_stats',
  'domain_rules',
  'tasks',
  'pairing_codes',
  'refresh_tokens',
  'devices',
  'email_tokens',
  'audit_log',
  'user_settings',
  'users',
];

export async function resetDb(db: Db = testDb()): Promise<void> {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
}

let counter = 0;
export async function registerUser(
  app: Express,
  overrides: Partial<{
    email: string;
    password: string;
    displayName: string;
    timezone: string;
  }> = {},
): Promise<TestUser> {
  counter += 1;
  const body = {
    email: overrides.email ?? `user${counter}-${uuidv7().slice(0, 8)}@example.com`,
    password: overrides.password ?? 'correct-horse-battery',
    displayName: overrides.displayName ?? `User ${counter}`,
    timezone: overrides.timezone ?? 'Asia/Kolkata',
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.user.id,
    email: body.email,
    password: body.password,
    accessToken: res.body.accessToken,
    refreshCookie: refreshCookieFrom(res.headers['set-cookie']),
  };
}

export function refreshCookieFrom(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((x) => x.startsWith('fg_rt='));
  return c ? c.split(';')[0]! : '';
}

/** Supertest helpers that attach a bearer token. */
export function as(app: Express, token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string) => request(app).post(url).set(auth),
    patch: (url: string) => request(app).patch(url).set(auth),
    delete: (url: string) => request(app).delete(url).set(auth),
  };
}

export interface TestDevice {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
}

export async function pairDevice(
  app: Express,
  user: TestUser,
  type: 'extension' | 'collector' = 'extension',
): Promise<TestDevice> {
  const code = await as(app, user.accessToken).post('/api/v1/devices/pairing-codes').expect(201);
  const res = await request(app)
    .post('/api/v1/devices/pair')
    .send({ code: code.body.code, type, name: `Test ${type}`, version: '0.1.0' })
    .expect(201);
  return res.body;
}

export async function createSession(
  app: Express,
  user: TestUser,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { id: string; version: number; status: string }> {
  const res = await as(app, user.accessToken)
    .post('/api/v1/sessions')
    .send({ startMode: 'now', durationMin: 60, ...body });
  if (res.status !== 201)
    throw new Error(`create session failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export const minutes = (n: number) => n * 60_000;
