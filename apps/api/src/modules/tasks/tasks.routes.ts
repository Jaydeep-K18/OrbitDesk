import { Router } from 'express';
import { CreateTaskRequest, ListTasksQuery, UpdateTaskRequest } from '@focusguard/contracts';
import type { Prisma } from '@prisma/client';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse, uuidParam } from '../../http/validate.js';
import { toTask } from '../../http/mappers.js';
import { requireUser, userOf } from '../../auth/middleware.js';

const toDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00.000Z`) : d === null ? null : undefined;

export function tasksRouter(ctx: AppContext): Router {
  const router = Router();
  router.use('/tasks', requireUser(ctx));

  router.get('/tasks', async (req, res) => {
    const q = parse(ListTasksQuery, req.query);
    const { userId } = userOf(req);
    // UUIDv7 ids sort by creation time, so the id doubles as a stable cursor.
    const rows = await ctx.db.task.findMany({
      where: {
        userId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit);
    res.json({
      items: items.map(toTask),
      nextCursor: rows.length > q.limit ? items.at(-1)!.id : null,
    });
  });

  router.post('/tasks', async (req, res) => {
    const body = parse(CreateTaskRequest, req.body);
    const task = await ctx.db.task.create({
      data: {
        userId: userOf(req).userId,
        title: body.title,
        notes: body.notes ?? null,
        category: body.category,
        estimateMin: body.estimateMin ?? null,
        dueDate: toDate(body.dueDate) ?? null,
        tags: body.tags,
      },
    });
    res.status(201).json(toTask(task));
  });

  router.get('/tasks/:id', async (req, res) => {
    const task = await ctx.db.task.findFirst({
      where: { id: uuidParam(req.params.id), userId: userOf(req).userId },
    });
    if (!task) throw AppError.notFound();
    res.json(toTask(task));
  });

  router.patch('/tasks/:id', async (req, res) => {
    const body = parse(UpdateTaskRequest, req.body);
    const id = uuidParam(req.params.id);
    const { userId } = userOf(req);
    const existing = await ctx.db.task.findFirst({ where: { id, userId } });
    if (!existing) throw AppError.notFound();
    const data: Prisma.TaskUpdateInput = { ...body, dueDate: toDate(body.dueDate) };
    if (body.status === 'done' && existing.status !== 'done') data.completedAt = ctx.clock.now();
    if (body.status && body.status !== 'done') data.completedAt = null;
    const task = await ctx.db.task.update({ where: { id }, data });
    res.json(toTask(task));
  });

  router.delete('/tasks/:id', async (req, res) => {
    const deleted = await ctx.db.task.deleteMany({
      where: { id: uuidParam(req.params.id), userId: userOf(req).userId },
    });
    if (deleted.count === 0) throw AppError.notFound();
    res.status(204).end();
  });

  return router;
}
