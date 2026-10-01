import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, testDb } from './helpers.js';
import { createApp, createContext } from '../src/app.js';
import { createDb } from '../src/infra/db.js';
import { createLogger } from '../src/infra/logger.js';

describe('health & readiness', async () => {
  const { app } = await buildTestApp({
    now: '2026-10-02T10:00:00.000Z',
    config: { appVersion: '9.9.9' },
  });

  it('GET /api/v1/health returns liveness info', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'focusguard-api',
      version: '9.9.9',
      time: '2026-10-02T10:00:00.000Z',
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/v1/ready checks the database', async () => {
    const res = await request(app).get('/api/v1/ready').expect(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });

  it('required extensions are installed by migrations', async () => {
    const rows = await testDb().$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname IN ('btree_gist', 'citext') ORDER BY extname`;
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext']);
  });

  it('returns 503 when the database is unreachable', async () => {
    const deadDb = createDb('postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=1');
    const ctx = await createContext({ db: deadDb, logger: createLogger('silent') });
    const res = await request(createApp(ctx).app).get('/api/v1/ready').expect(503);
    expect(res.body.checks.database).toBe('fail');
    await deadDb.$disconnect();
  });

  it('unknown routes return problem+json 404 with request id', async () => {
    const res = await request(app).get('/api/v1/nope').set('x-request-id', 'test-123').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'test-123' });
  });

  it('malformed JSON bodies return a 400 problem', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('allows the extension origin via CORS but not others', async () => {
    const ok = await request(app)
      .options('/api/v1/extension/state')
      .set('Origin', 'chrome-extension://dmfegmfpjfegcdhojmpbbghakajhgpec');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(
      'chrome-extension://dmfegmfpjfegcdhojmpbbghakajhgpec',
    );
    const bad = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
