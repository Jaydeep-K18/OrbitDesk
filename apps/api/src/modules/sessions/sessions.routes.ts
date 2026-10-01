import { Router } from 'express';
import { z } from 'zod';
import {
  AddSessionDomainRequest,
  CreateSessionRequest,
  EndSessionRequest,
  ExtendSessionRequest,
  ListSessionsQuery,
  UpdateSessionTaskRequest,
  VersionedRequest,
} from '@focusguard/contracts';
import { normalizeDomain } from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse, uuidParam } from '../../http/validate.js';
import { toSession } from '../../http/mappers.js';
import { requireUser, userOf } from '../../auth/middleware.js';
import type { SessionsService } from './sessions.service.js';

export function sessionsRouter(ctx: AppContext, sessions: SessionsService): Router {
  const router = Router();
  router.use('/sessions', requireUser(ctx));

  router.post('/sessions', async (req, res) => {
    const body = parse(CreateSessionRequest, req.body);
    res.status(201).json(await sessions.create(userOf(req).userId, body));
  });

  router.get('/sessions', async (req, res) => {
    const q = parse(ListSessionsQuery, req.query);
    res.json(await sessions.list(userOf(req).userId, q));
  });

  router.get('/sessions/active', async (req, res) => {
    const row = await sessions.activeRow(userOf(req).userId);
    const now = ctx.clock.now();
    res.json({ serverNow: now.toISOString(), session: row ? toSession(row, now) : null });
  });

  router.get('/sessions/:id', async (req, res) => {
    res.json(await sessions.get(userOf(req).userId, uuidParam(req.params.id)));
  });

  router.post('/sessions/:id/start', async (req, res) => {
    const { expectedVersion } = parse(VersionedRequest, req.body);
    res.json(
      await sessions.startEarly(userOf(req).userId, uuidParam(req.params.id), expectedVersion),
    );
  });

  router.post('/sessions/:id/end', async (req, res) => {
    const body = parse(EndSessionRequest, req.body);
    res.json(await sessions.end(userOf(req).userId, uuidParam(req.params.id), body));
  });

  router.post('/sessions/:id/extend', async (req, res) => {
    const body = parse(ExtendSessionRequest, req.body);
    res.json(await sessions.extend(userOf(req).userId, uuidParam(req.params.id), body));
  });

  router.post('/sessions/:id/cancel', async (req, res) => {
    const { expectedVersion } = parse(VersionedRequest, req.body);
    res.json(await sessions.cancel(userOf(req).userId, uuidParam(req.params.id), expectedVersion));
  });

  router.patch('/sessions/:id/tasks/:taskId', async (req, res) => {
    const { completed } = parse(UpdateSessionTaskRequest, req.body);
    res.json(
      await sessions.setTaskCompleted(
        userOf(req).userId,
        uuidParam(req.params.id),
        uuidParam(req.params.taskId),
        completed,
      ),
    );
  });

  router.post('/sessions/:id/domains', async (req, res) => {
    const body = parse(AddSessionDomainRequest, req.body);
    res
      .status(201)
      .json(
        await sessions.addDomain(
          userOf(req).userId,
          uuidParam(req.params.id),
          body.domain,
          body.kind,
        ),
      );
  });

  router.delete('/sessions/:id/domains/:host', async (req, res) => {
    const q = parse(
      z.object({
        kind: z.enum(['blocked', 'relevant']).default('blocked'),
        confirm: z.enum(['true', 'false']).optional(),
      }),
      req.query,
    );
    const host = normalizeDomain(String(req.params.host))?.host;
    if (!host) throw AppError.notFound('Domain not in this session');
    res.json(
      await sessions.removeDomain(
        userOf(req).userId,
        uuidParam(req.params.id),
        host,
        q.kind,
        q.confirm === 'true',
      ),
    );
  });

  return router;
}
