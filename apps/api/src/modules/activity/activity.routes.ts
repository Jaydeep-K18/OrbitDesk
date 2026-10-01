import { Router } from 'express';
import { ActivityBatchRequest, DeleteActivityQuery, RelabelRequest } from '@focusguard/contracts';
import { dominantCategory } from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse, uuidParam } from '../../http/validate.js';
import { toSegment } from '../../http/mappers.js';
import { deviceOf, requireDevice, requireUser, userOf } from '../../auth/middleware.js';
import { audit } from '../../infra/audit.js';
import type { ActivityService } from './activity.service.js';
import type { ReportsService } from '../reports/reports.service.js';

const LABEL_TEXT: Record<string, string> = {
  PLANNED: 'planned work',
  UNPLANNED_RELEVANT: 'relevant to your task',
  DISTRACTION: 'a distraction',
  UNCERTAIN: 'uncertain',
};

export function activityRouter(
  ctx: AppContext,
  activity: ActivityService,
  reports: ReportsService,
): Router {
  const router = Router();
  const user = requireUser(ctx);

  router.post('/activity/batch', requireDevice(ctx, 'activity:write'), async (req, res) => {
    const { events } = parse(ActivityBatchRequest, req.body);
    res.status(202).json(await activity.ingest(deviceOf(req), events));
  });

  router.get('/sessions/:id/activity', user, async (req, res) => {
    const { userId } = userOf(req);
    const sessionId = uuidParam(req.params.id);
    const session = await ctx.db.focusSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw AppError.notFound();
    const segments = await ctx.db.activitySegment.findMany({
      where: { sessionId, userId },
      orderBy: { startedAt: 'asc' },
    });
    res.json({ items: segments.map(toSegment) });
  });

  router.patch('/activity/segments/:id/label', user, async (req, res) => {
    const body = parse(RelabelRequest, req.body);
    const { userId } = userOf(req);
    const segment = await ctx.db.activitySegment.findFirst({
      where: { id: uuidParam(req.params.id), userId },
      include: { session: { include: { tasks: true } } },
    });
    if (!segment) throw AppError.notFound();

    const updated = await ctx.db.$transaction(async (tx) => {
      await tx.segmentFeedback.create({
        data: {
          segmentId: segment.id,
          userId,
          oldLabel: segment.label,
          newLabel: body.label,
          applyToFuture: body.applyToFuture,
        },
      });
      return tx.activitySegment.update({
        where: { id: segment.id },
        data: {
          label: body.label,
          confidence: 1,
          labelSource: 'user_feedback',
          reasonCode: 'user_feedback',
          explanation: `You marked this as ${LABEL_TEXT[body.label]}.`,
        },
      });
    });

    if (body.applyToFuture && body.label !== 'UNCERTAIN') {
      const blockCats = segment.session.tasks
        .filter((t) => t.blockId === segment.blockId)
        .map((t) => t.taskCategory);
      const category = dominantCategory(
        blockCats.length ? blockCats : segment.session.tasks.map((t) => t.taskCategory),
      );
      const list = body.label === 'DISTRACTION' ? 'always_distraction' : 'relevant';
      // PLANNED means "always relevant"; the other labels apply to this kind of task only.
      const scope = body.label === 'PLANNED' ? '*' : category;
      await ctx.db.domainRule.upsert({
        where: { userId_host_list_scope: { userId, host: segment.registrableDomain, list, scope } },
        create: { userId, host: segment.registrableDomain, list, scope },
        update: {},
      });
    }
    await reports.refreshIfFinal(segment.sessionId);
    res.json(toSegment(updated));
  });

  async function afterDeletion(userId: string, sessionIds: string[]) {
    for (const id of sessionIds) await reports.refreshIfFinal(id);
  }

  router.delete('/activity', user, async (req, res) => {
    const q = parse(DeleteActivityQuery, req.query);
    const { userId } = userOf(req);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const affected = await ctx.db.activitySegment.findMany({
      where: { userId, startedAt: { gte: from, lt: to } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    const [segs, attempts] = await ctx.db.$transaction([
      ctx.db.activitySegment.deleteMany({ where: { userId, startedAt: { gte: from, lt: to } } }),
      ctx.db.blockedAttempt.deleteMany({ where: { userId, attemptedAt: { gte: from, lt: to } } }),
    ]);
    await audit(ctx.db, 'activity_deleted', { userId, req, metadata: { from: q.from, to: q.to } });
    await afterDeletion(
      userId,
      affected.map((a) => a.sessionId),
    );
    res.json({ deletedSegments: segs.count, deletedBlockedAttempts: attempts.count });
  });

  router.delete('/sessions/:id/activity', user, async (req, res) => {
    const { userId } = userOf(req);
    const sessionId = uuidParam(req.params.id);
    const session = await ctx.db.focusSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });
    if (!session) throw AppError.notFound();
    const [segs, attempts] = await ctx.db.$transaction([
      ctx.db.activitySegment.deleteMany({ where: { sessionId, userId } }),
      ctx.db.blockedAttempt.deleteMany({ where: { sessionId, userId } }),
    ]);
    await audit(ctx.db, 'activity_deleted', { userId, req, metadata: { sessionId } });
    await afterDeletion(userId, [sessionId]);
    res.json({ deletedSegments: segs.count, deletedBlockedAttempts: attempts.count });
  });

  return router;
}
