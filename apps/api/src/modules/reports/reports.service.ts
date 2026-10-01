import type { Prisma } from '@prisma/client';
import type { SessionReport } from '@focusguard/contracts';
import {
  addDays,
  computeDailyStats,
  computeSessionMetrics,
  domainBreakdown,
  effectiveStatus,
  isTerminal,
  localDayRange,
  toLocalDate,
  uuidv7,
} from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { sessionInclude, toSegment, toSession } from '../../http/mappers.js';
import { Events } from '../../infra/event-bus.js';
import { loadSessionsForMetrics, metricsInclude, toMetricsInput } from './loader.js';

/** Session reports and daily rollups (ROADMAP 1.6). */
export class ReportsService {
  constructor(private readonly ctx: AppContext) {}

  /** Live report computed from current data (works for active and finished sessions). */
  async getReport(userId: string, sessionId: string): Promise<SessionReport> {
    const now = this.ctx.clock.now();
    const s = await this.ctx.db.focusSession.findFirst({
      where: { id: sessionId, userId },
      include: { ...metricsInclude, ...sessionInclude, report: true },
    });
    if (!s) throw AppError.notFound('Session not found');
    const input = toMetricsInput(s, now);
    return {
      session: toSession(s, now),
      version: s.report?.version ?? 0,
      generatedAt: s.report?.generatedAt.toISOString() ?? null,
      final: s.finalizedAt !== null,
      metrics: computeSessionMetrics(input),
      domains: domainBreakdown(input.segments),
      segments: s.segments.map(toSegment),
      blockedAttempts: s.blockedAttempt.map((a) => ({
        id: a.id,
        host: a.host,
        at: a.attemptedAt.toISOString(),
      })),
    };
  }

  /**
   * Computes and stores the final report, then refreshes daily stats for every local date the
   * session touched. Idempotent: re-finalizing (late events, relabels) bumps the version.
   */
  async finalize(sessionId: string): Promise<void> {
    const now = this.ctx.clock.now();
    const s = await this.ctx.db.focusSession.findUnique({
      where: { id: sessionId },
      include: { ...metricsInclude, user: true },
    });
    if (!s) return;
    const status = effectiveStatus(s, now);
    if (!isTerminal(status)) return;

    const input = toMetricsInput(s, now);
    const metrics = computeSessionMetrics(input);
    const domainsJson = domainBreakdown(input.segments) as unknown as Prisma.InputJsonArray;
    const metricsJson = metrics as unknown as Prisma.InputJsonObject;
    await this.ctx.db.$transaction([
      this.ctx.db.sessionReport.upsert({
        where: { sessionId },
        create: {
          sessionId,
          version: 1,
          metrics: metricsJson,
          domains: domainsJson,
          generatedAt: now,
        },
        update: {
          version: { increment: 1 },
          metrics: metricsJson,
          domains: domainsJson,
          generatedAt: now,
        },
      }),
      this.ctx.db.focusSession.update({ where: { id: sessionId }, data: { finalizedAt: now } }),
    ]);
    await this.recomputeDailyForSession(
      s.userId,
      s.user.timezone,
      s.startedAt ?? s.startsAt,
      s.endedAt ?? s.endsAt,
    );
    await this.ctx.bus.publish({
      eventId: uuidv7(),
      eventType: Events.ReportReady,
      occurredAt: now.toISOString(),
      userId: s.userId,
      sessionId,
      payload: { metrics },
    });
  }

  /** Re-finalize only if the session already has a final report (relabels, late events, deletions). */
  async refreshIfFinal(sessionId: string): Promise<void> {
    const s = await this.ctx.db.focusSession.findUnique({
      where: { id: sessionId },
      select: { finalizedAt: true },
    });
    if (s?.finalizedAt) await this.finalize(sessionId);
  }

  async recomputeDailyForSession(
    userId: string,
    timeZone: string,
    start: Date,
    end: Date,
  ): Promise<void> {
    const dates: string[] = [];
    for (let d = toLocalDate(start, timeZone); d <= toLocalDate(end, timeZone); d = addDays(d, 1))
      dates.push(d);
    await this.recomputeDaily(userId, timeZone, dates);
  }

  /** Rebuilds `user_daily_stats` rows for the given local dates from source data. */
  async recomputeDaily(userId: string, timeZone: string, dates: string[]): Promise<void> {
    if (dates.length === 0) return;
    const sorted = [...new Set(dates)].sort();
    const rangeStart = localDayRange(sorted[0]!, timeZone).start;
    const rangeEnd = localDayRange(sorted.at(-1)!, timeZone).end;
    const now = this.ctx.clock.now();
    const sessions = await loadSessionsForMetrics(this.ctx, {
      userId,
      status: { not: 'CANCELLED' },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    });
    const stats = computeDailyStats(
      sessions.map((s) => toMetricsInput(s, now)),
      timeZone,
    );
    for (const date of sorted) {
      const d = stats.get(date);
      const localDate = new Date(`${date}T00:00:00.000Z`);
      if (!d) {
        await this.ctx.db.userDailyStats.deleteMany({ where: { userId, localDate } });
        continue;
      }
      const { localDate: _ld, ...values } = d;
      await this.ctx.db.userDailyStats.upsert({
        where: { userId_localDate: { userId, localDate } },
        create: { userId, localDate, ...values },
        update: values,
      });
    }
  }

  /** Finalize every terminal session whose grace window has passed (called by the sweeper). */
  async finalizeDue(): Promise<number> {
    const cutoff = new Date(
      this.ctx.clock.now().getTime() - this.ctx.config.finalizeGraceSec * 1000,
    );
    const due = await this.ctx.db.focusSession.findMany({
      where: {
        status: { in: ['COMPLETED', 'ENDED_EARLY'] },
        finalizedAt: null,
        endedAt: { lte: cutoff },
      },
      select: { id: true },
      take: 100,
    });
    for (const { id } of due) {
      try {
        await this.finalize(id);
      } catch (err) {
        this.ctx.logger.error({ err, sessionId: id }, 'finalize failed');
      }
    }
    return due.length;
  }
}
