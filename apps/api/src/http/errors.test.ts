import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError, errorHandler, notFoundHandler } from './errors.js';
import { loadApiEnv } from '../config/env.js';

function appThrowing(err: unknown) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => res.json(req.body));
  app.get('/boom', () => {
    throw err;
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler (RFC 9457 problems)', () => {
  it('maps AppError to its status and code', async () => {
    const res = await request(
      appThrowing(AppError.conflict('SESSION_OVERLAP', 'Overlap', 'Busy 15:00–17:00')),
    ).get('/boom');
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'https://focusguard.app/problems/session-overlap',
      title: 'Overlap',
      status: 409,
      code: 'SESSION_OVERLAP',
      detail: 'Busy 15:00–17:00',
    });
  });

  it('maps ZodError to a 422 with field errors', async () => {
    const parsed = z.object({ durationMin: z.number().min(5) }).safeParse({ durationMin: 1 });
    const res = await request(appThrowing(parsed.error)).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].path).toBe('durationMin');
  });

  it('hides internals of unexpected errors', async () => {
    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('returns 413 for oversized bodies', async () => {
    const res = await request(appThrowing(null))
      .post('/echo')
      .send({ big: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 404 problems for unknown routes', async () => {
    const res = await request(appThrowing(null)).get('/missing');
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('No route for GET /missing');
  });
});

describe('loadApiEnv', () => {
  it('applies defaults', () => {
    const env = loadApiEnv({ DATABASE_URL: 'postgresql://localhost/db' });
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('fails fast without DATABASE_URL', () => {
    expect(() => loadApiEnv({})).toThrow(/DATABASE_URL/);
  });
});
