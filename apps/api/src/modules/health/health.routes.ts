import { Router } from 'express';
import { HealthResponse, ReadyResponse } from '@focusguard/contracts';
import { registry } from '@focusguard/contracts/openapi';
import type { Clock } from '@focusguard/domain';
import { pingDb, type Db } from '../../infra/db.js';

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Process is alive',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/ready',
  summary: 'Readiness probe (checks dependencies)',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: ReadyResponse } } },
    503: {
      description: 'A dependency is down',
      content: { 'application/json': { schema: ReadyResponse } },
    },
  },
});

export function healthRouter(deps: { db: Db; clock: Clock; version: string }): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'focusguard-api',
      version: deps.version,
      time: deps.clock.now().toISOString(),
    });
  });

  router.get('/ready', async (_req, res) => {
    const dbOk = await pingDb(deps.db);
    const checks = { database: dbOk ? 'ok' : 'fail' } as const;
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ready' : 'not_ready', checks });
  });

  return router;
}
