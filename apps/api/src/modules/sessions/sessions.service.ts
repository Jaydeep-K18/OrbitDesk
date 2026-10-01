import type { Prisma } from '@prisma/client';
import type { CreateSessionRequest, FocusSession } from '@focusguard/contracts';
import {
  canPerform,
  effectiveStatus,
  extendBlocks,
  findListConflicts,
  shiftBlocks,
  uuidv7,
  type SessionAction,
} from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { sessionInclude, toSession, type SessionWithRelations } from '../../http/mappers.js';
import { normalizeOrThrow } from '../domains/domains.routes.js';
import { Events } from '../../infra/event-bus.js';
import { audit } from '../../infra/audit.js';

const MAX_SCHEDULE_AHEAD_MS = 30 * 86_400_000;
const PAST_TOLERANCE_MS = 60_000;

function isOverlapViolation(err: unknown): boolean {
  const text = `${(err as { message?: string })?.message ?? ''} ${JSON.stringify((err as { meta?: unknown })?.meta ?? '')}`;
  return text.includes('focus_sessions_no_overlap') || text.includes('23P01');
}

/** Session use-cases. Every query is scoped by userId (IDOR-safe). */
export class SessionsService {
  constructor(private readonly ctx: AppContext) {}

  private now(): Date {
    // Second precision keeps stored times tidy and comparisons stable.
    return new Date(Math.floor(this.ctx.clock.now().getTime() / 1000) * 1000);
  }

  async publish(eventType: string, userId: string, sessionId: string, payload: unknown = {}) {
    await this.ctx.bus.publish({
      eventId: uuidv7(),
      eventType,
      occurredAt: this.ctx.clock.now().toISOString(),
      userId,
      sessionId,
      payload,
    });
  }

  async getRow(userId: string, id: string): Promise<SessionWithRelations> {
    const s = await this.ctx.db.focusSession.findFirst({
      where: { id, userId },
      include: sessionInclude,
    });
    if (!s) throw AppError.notFound('Session not found');
    return s;
  }

  async get(userId: string, id: string): Promise<FocusSession> {
    return toSession(await this.getRow(userId, id), this.ctx.clock.now());
  }

  private async overlapDetail(
    userId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<string> {
    const other = await this.ctx.db.focusSession.findFirst({
      where: {
        userId,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        startsAt: { lt: end },
        endsAt: { gt: start },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    return other
      ? `Another session is planned ${other.startsAt.toISOString()}–${other.endsAt.toISOString()}.`
      : 'Another session overlaps this time.';
  }

  async create(userId: string, req: CreateSessionRequest): Promise<FocusSession> {
    const now = this.now();
    let start: Date;
    if (req.startMode === 'now') {
      start = now;
    } else {
      start = new Date(req.startsAt!);
      if (start.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
        throw AppError.validation([{ path: 'startsAt', message: 'Start time is in the past' }]);
      }
      if (start.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
        throw AppError.validation([
          { path: 'startsAt', message: 'Sessions can be scheduled up to 30 days ahead' },
        ]);
      }
      if (start.getTime() < now.getTime()) start = now;
    }
    const end = new Date(start.getTime() + req.durationMin * 60_000);

    const blocked = [
      ...new Set(req.blockedDomains.map((d, i) => normalizeOrThrow(d, `blockedDomains.${i}`))),
    ];
    const relevant = [
      ...new Set(req.relevantDomains.map((d, i) => normalizeOrThrow(d, `relevantDomains.${i}`))),
    ];
    const conflicts = findListConflicts(blocked, relevant);
    if (conflicts.length > 0) {
      throw new AppError(
        422,
        'DOMAIN_LIST_CONFLICT',
        'Domain list conflict',
        `${conflicts.join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} in both the blocked and relevant lists.`,
      );
    }

    const taskIds = [...new Set(req.taskIds)];
    const tasks = taskIds.length
      ? await this.ctx.db.task.findMany({ where: { id: { in: taskIds }, userId } })
      : [];
    if (tasks.length !== taskIds.length) {
      throw AppError.validation([{ path: 'taskIds', message: 'One or more tasks were not found' }]);
    }

    const settings = await this.ctx.db.userSettings.findUnique({ where: { userId } });
    const blockDuringBreaks = req.blockDuringBreaks ?? settings?.blockDuringBreaks ?? false;
    const isNow = start.getTime() <= now.getTime();
    const sessionId = uuidv7();
    const blockId = uuidv7();

    try {
      await this.ctx.db.$transaction([
        this.ctx.db.focusSession.create({
          data: {
            id: sessionId,
            userId,
            status: isNow ? 'ACTIVE' : 'SCHEDULED',
            startsAt: start,
            endsAt: end,
            startedAt: isNow ? start : null,
            blockDuringBreaks,
            blocks: {
              create: [{ id: blockId, idx: 0, kind: 'work', startsAt: start, endsAt: end }],
            },
            tasks: {
              create: tasks.map((t) => ({
                taskId: t.id,
                taskTitle: t.title,
                taskCategory: t.category,
                blockId,
              })),
            },
            domains: {
              create: [
                ...blocked.map((host) => ({ host, kind: 'blocked' as const })),
                ...relevant.map((host) => ({ host, kind: 'relevant' as const })),
              ],
            },
          },
        }),
        ...(isNow
          ? [
              this.ctx.db.task.updateMany({
                where: { id: { in: taskIds }, userId, status: 'todo' },
                data: { status: 'in_progress' },
              }),
            ]
          : []),
      ]);
    } catch (err) {
      if (isOverlapViolation(err)) {
        throw AppError.conflict(
          'SESSION_OVERLAP',
          'Session overlaps another session',
          await this.overlapDetail(userId, start, end),
        );
      }
      throw err;
    }

    await this.publish(Events.SessionCreated, userId, sessionId);
    if (isNow) await this.publish(Events.SessionStarted, userId, sessionId);
    return this.get(userId, sessionId);
  }

  async list(
    userId: string,
    q: { status?: string; from?: string; to?: string; cursor?: string; limit: number },
  ) {
    const where: Prisma.FocusSessionWhereInput = {
      userId,
      ...(q.from || q.to
        ? {
            startsAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.cursor ? { id: { lt: q.cursor } } : {}),
    };
    const rows = await this.ctx.db.focusSession.findMany({
      where,
      include: sessionInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const now = this.ctx.clock.now();
    let items = rows.slice(0, q.limit).map((r) => toSession(r, now));
    if (q.status) items = items.filter((s) => s.status === q.status);
    return { items, nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null };
  }

  /** The running session, else the next scheduled one. */
  async activeRow(userId: string): Promise<SessionWithRelations | null> {
    const now = this.ctx.clock.now();
    return this.ctx.db.focusSession.findFirst({
      where: { userId, status: { in: ['SCHEDULED', 'ACTIVE'] }, endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
      include: sessionInclude,
    });
  }

  private assertAction(row: SessionWithRelations, action: SessionAction) {
    const status = effectiveStatus(row, this.ctx.clock.now());
    if (!canPerform(action, status)) {
      throw AppError.conflict(
        'SESSION_STATE_INVALID',
        'Action not allowed',
        `Cannot ${action} a session that is ${status}.`,
      );
    }
  }

  private versionConflict(): AppError {
    return AppError.conflict(
      'VERSION_CONFLICT',
      'Session changed',
      'The session was changed elsewhere. Refresh and try again.',
    );
  }

  async startEarly(userId: string, id: string, expectedVersion: number): Promise<FocusSession> {
    const row = await this.getRow(userId, id);
    this.assertAction(row, 'start');
    const now = this.now();
    const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
    const newEnd = new Date(now.getTime() + durationMs);
    const shifted = shiftBlocks(row.blocks, now);
    try {
      await this.ctx.db.$transaction(async (tx) => {
        const updated = await tx.focusSession.updateMany({
          where: { id, userId, version: expectedVersion },
          data: {
            status: 'ACTIVE',
            startsAt: now,
            endsAt: newEnd,
            startedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw this.versionConflict();
        for (const b of shifted) {
          await tx.focusSessionBlock.update({
            where: { id: b.id },
            data: { startsAt: b.startsAt, endsAt: b.endsAt },
          });
        }
      });
    } catch (err) {
      if (isOverlapViolation(err)) {
        throw AppError.conflict(
          'SESSION_OVERLAP',
          'Session overlaps another session',
          await this.overlapDetail(userId, now, newEnd, id),
        );
      }
      throw err;
    }
    await this.publish(Events.SessionStarted, userId, id);
    return this.get(userId, id);
  }

  async end(
    userId: string,
    id: string,
    body: { expectedVersion: number; reason?: string },
  ): Promise<FocusSession> {
    const row = await this.getRow(userId, id);
    this.assertAction(row, 'end');
    const now = this.now();
    const updated = await this.ctx.db.focusSession.updateMany({
      where: { id, userId, version: body.expectedVersion },
      data: {
        status: 'ENDED_EARLY',
        endedAt: now,
        endReason: body.reason ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw this.versionConflict();
    await this.publish(Events.SessionEnded, userId, id, { status: 'ENDED_EARLY' });
    return this.get(userId, id);
  }

  async extend(
    userId: string,
    id: string,
    body: { expectedVersion: number; minutes: number },
  ): Promise<FocusSession> {
    const row = await this.getRow(userId, id);
    this.assertAction(row, 'extend');
    const newEnd = new Date(row.endsAt.getTime() + body.minutes * 60_000);
    const extended = extendBlocks(row.blocks, body.minutes);
    const last = extended[extended.length - 1]!;
    try {
      await this.ctx.db.$transaction(async (tx) => {
        const updated = await tx.focusSession.updateMany({
          where: { id, userId, version: body.expectedVersion },
          data: { endsAt: newEnd, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw this.versionConflict();
        await tx.focusSessionBlock.update({
          where: { id: last.id },
          data: { endsAt: last.endsAt },
        });
      });
    } catch (err) {
      if (isOverlapViolation(err)) {
        throw AppError.conflict(
          'SESSION_OVERLAP',
          'Extension overlaps the next session',
          await this.overlapDetail(userId, row.endsAt, newEnd, id),
        );
      }
      throw err;
    }
    await this.publish(Events.SessionExtended, userId, id, { minutes: body.minutes });
    return this.get(userId, id);
  }

  async cancel(userId: string, id: string, expectedVersion: number): Promise<FocusSession> {
    const row = await this.getRow(userId, id);
    this.assertAction(row, 'cancel');
    const updated = await this.ctx.db.focusSession.updateMany({
      where: { id, userId, version: expectedVersion },
      data: { status: 'CANCELLED', endedAt: this.now(), version: { increment: 1 } },
    });
    if (updated.count !== 1) throw this.versionConflict();
    await this.publish(Events.SessionUpdated, userId, id, { status: 'CANCELLED' });
    return this.get(userId, id);
  }

  async setTaskCompleted(
    userId: string,
    sessionId: string,
    sessionTaskId: string,
    completed: boolean,
  ) {
    const row = await this.getRow(userId, sessionId);
    const st = row.tasks.find((t) => t.id === sessionTaskId || t.taskId === sessionTaskId);
    if (!st) throw AppError.notFound('Task not in this session');
    const now = this.now();
    await this.ctx.db.$transaction([
      this.ctx.db.sessionTask.update({
        where: { id: st.id },
        data: { completedAt: completed ? now : null },
      }),
      ...(st.taskId
        ? [
            this.ctx.db.task.updateMany({
              where: { id: st.taskId, userId },
              data: completed
                ? { status: 'done', completedAt: now }
                : { status: 'in_progress', completedAt: null },
            }),
          ]
        : []),
    ]);
    if (completed)
      await this.publish(Events.TaskCompleted, userId, sessionId, { sessionTaskId: st.id });
    await this.publish(Events.SessionUpdated, userId, sessionId, { tasks: true });
    return this.get(userId, sessionId);
  }

  async addDomain(userId: string, sessionId: string, domain: string, kind: 'blocked' | 'relevant') {
    const row = await this.getRow(userId, sessionId);
    const status = effectiveStatus(row, this.ctx.clock.now());
    if (status !== 'SCHEDULED' && status !== 'ACTIVE') {
      throw AppError.conflict(
        'SESSION_STATE_INVALID',
        'Action not allowed',
        `Cannot change lists of a ${status} session.`,
      );
    }
    const host = normalizeOrThrow(domain, 'domain');
    const opposite = kind === 'blocked' ? 'relevant' : 'blocked';
    if (row.domains.some((d) => d.host === host && d.kind === opposite && d.removedAt === null)) {
      throw new AppError(
        422,
        'DOMAIN_LIST_CONFLICT',
        'Domain list conflict',
        `${host} is already ${opposite} in this session.`,
      );
    }
    await this.ctx.db.sessionDomain.upsert({
      where: { sessionId_host_kind: { sessionId, host, kind } },
      create: { sessionId, host, kind, addedMidSession: status === 'ACTIVE' },
      update: { removedAt: null },
    });
    await this.publish(Events.SessionUpdated, userId, sessionId, { domains: true });
    return this.get(userId, sessionId);
  }

  async removeDomain(
    userId: string,
    sessionId: string,
    host: string,
    kind: 'blocked' | 'relevant',
    confirm: boolean,
  ) {
    const row = await this.getRow(userId, sessionId);
    const status = effectiveStatus(row, this.ctx.clock.now());
    const existing = row.domains.find(
      (d) => d.host === host && d.kind === kind && d.removedAt === null,
    );
    if (!existing) throw AppError.notFound('Domain not in this session');
    // Loosening a running session requires explicit confirmation (friction is a feature).
    if (kind === 'blocked' && status === 'ACTIVE' && !confirm) {
      throw AppError.validation([
        { path: 'confirm', message: 'Removing a blocked site during a session must be confirmed' },
      ]);
    }
    await this.ctx.db.sessionDomain.update({
      where: { sessionId_host_kind: { sessionId, host, kind } },
      data: { removedAt: this.now() },
    });
    if (kind === 'blocked' && status === 'ACTIVE') {
      await audit(this.ctx.db, 'session_blocked_domain_removed', {
        userId,
        metadata: { sessionId, host },
      });
    }
    await this.publish(Events.SessionUpdated, userId, sessionId, { domains: true });
    return this.get(userId, sessionId);
  }
}
