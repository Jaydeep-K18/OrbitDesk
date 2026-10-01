import type {
  AnalyticsOverview,
  DashboardSummary,
  DomainsAnalytics,
  HeatmapAnalytics,
  SessionsStats,
} from '@focusguard/contracts';
import {
  addDays,
  computeDailyStats,
  computeSessionMetrics,
  dateRange,
  effectiveStatus,
  emptyDailyStats,
  localDayRange,
  localParts,
  toLocalDate,
  weekStart,
  zonedTimeToUtc,
  type DailyStats,
} from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { toSession } from '../../http/mappers.js';
import { loadSessionsForMetrics, toMetricsInput } from '../reports/loader.js';
import type { SessionsService } from '../sessions/sessions.service.js';

const MAX_RANGE_DAYS = 366;

export class AnalyticsService {
  constructor(
    private readonly ctx: AppContext,
    private readonly sessions: SessionsService,
  ) {}

  private async timezone(userId: string): Promise<string> {
    const user = await this.ctx.db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!user) throw AppError.unauthenticated();
    return user.timezone;
  }

  /** Live stats for one local date, straight from source data (used for "today"). */
  private async liveDay(userId: string, tz: string, date: string): Promise<DailyStats> {
    const { start, end } = localDayRange(date, tz);
    const now = this.ctx.clock.now();
    const sessions = await loadSessionsForMetrics(this.ctx, {
      userId,
      status: { not: 'CANCELLED' },
      startsAt: { lt: end },
      endsAt: { gt: start },
    });
    return (
      computeDailyStats(
        sessions.map((s) => toMetricsInput(s, now)),
        tz,
      ).get(date) ?? emptyDailyStats(date)
    );
  }

  /** Stored rollups for [from, to], with today computed live so a running session counts. */
  async dailyRows(userId: string, tz: string, from: string, to: string): Promise<DailyStats[]> {
    const rows = await this.ctx.db.userDailyStats.findMany({
      where: {
        userId,
        localDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
    });
    const byDate = new Map<string, DailyStats>(
      rows.map((r) => {
        const date = r.localDate.toISOString().slice(0, 10);
        const { userId: _u, localDate: _l, updatedAt: _up, ...rest } = r;
        return [date, { ...rest, localDate: date }];
      }),
    );
    const today = toLocalDate(this.ctx.clock.now(), tz);
    if (today >= from && today <= to) byDate.set(today, await this.liveDay(userId, tz, today));
    return dateRange(from, to).map((d) => byDate.get(d) ?? emptyDailyStats(d));
  }

  private checkRange(from: string, to: string) {
    if (dateRange(from, to).length > MAX_RANGE_DAYS) {
      throw AppError.validation([
        { path: 'from', message: `Range is limited to ${MAX_RANGE_DAYS} days` },
      ]);
    }
  }

  async summary(userId: string): Promise<DashboardSummary> {
    const tz = await this.timezone(userId);
    const now = this.ctx.clock.now();
    const today = toLocalDate(now, tz);
    const days = await this.dailyRows(userId, tz, addDays(today, -6), today);
    const t = days.at(-1)!;

    const activeRow = await this.sessions.activeRow(userId);
    let liveCounters: DashboardSummary['liveCounters'] = null;
    if (activeRow && effectiveStatus(activeRow, now) === 'ACTIVE') {
      const [full] = await loadSessionsForMetrics(this.ctx, { id: activeRow.id });
      const m = computeSessionMetrics(toMetricsInput(full!, now));
      liveCounters = { blockedAttempts: m.blockedAttempts, websiteSwitches: m.websiteSwitches };
    }

    const recent = await this.ctx.db.focusSession.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ['COMPLETED', 'ENDED_EARLY'] } },
          { endsAt: { lte: now }, status: 'ACTIVE' },
        ],
      },
      include: { report: true },
      orderBy: { startsAt: 'desc' },
      take: 5,
    });

    const [segments, attempts] = await Promise.all([
      this.ctx.db.activitySegment.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),
      this.ctx.db.blockedAttempt.findMany({
        where: { userId, deduped: false },
        orderBy: { attemptedAt: 'desc' },
        take: 10,
      }),
    ]);
    const recentActivity = [
      ...segments.map((s) => ({
        kind: 'segment' as const,
        host: s.host,
        at: s.startedAt.toISOString(),
        label: s.label,
        durationSec: s.durationSec,
      })),
      ...attempts.map((a) => ({
        kind: 'blocked' as const,
        host: a.host,
        at: a.attemptedAt.toISOString(),
        label: 'BLOCKED' as const,
        durationSec: null,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);

    return {
      serverNow: now.toISOString(),
      localDate: today,
      today: {
        focusSec: t.focusSec,
        sessionsCompleted: t.sessionsCompleted,
        blockedAttempts: t.blockedAttempts,
        tasksCompleted: t.tasksCompleted,
        tasksPlanned: t.tasksPlanned,
        productiveSec: t.plannedSec + t.relevantSec,
        distractionSec: t.distractionSec,
      },
      last7Days: days.map((d) => ({ date: d.localDate, focusSec: d.focusSec })),
      activeSession: activeRow ? toSession(activeRow, now) : null,
      liveCounters,
      recentSessions: recent.map((s) => {
        const metrics = s.report?.metrics as
          { focusQuality?: number | null; productiveSec?: number } | undefined;
        return {
          id: s.id,
          status: effectiveStatus(s, now),
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          focusQuality: metrics?.focusQuality ?? null,
          productiveSec: metrics?.productiveSec ?? null,
        };
      }),
      recentActivity,
    };
  }

  async overview(
    userId: string,
    q: { from: string; to: string; granularity: 'day' | 'week' },
  ): Promise<AnalyticsOverview> {
    this.checkRange(q.from, q.to);
    const tz = await this.timezone(userId);
    const days = await this.dailyRows(userId, tz, q.from, q.to);
    const buckets = new Map<string, AnalyticsOverview['points'][number]>();
    for (const d of days) {
      const bucket = q.granularity === 'week' ? weekStart(d.localDate) : d.localDate;
      const p = buckets.get(bucket) ?? {
        bucket,
        focusSec: 0,
        plannedSec: 0,
        relevantSec: 0,
        distractionSec: 0,
        uncertainSec: 0,
        blockedAttempts: 0,
        switches: 0,
        sessionsStarted: 0,
        sessionsCompleted: 0,
      };
      p.focusSec += d.focusSec;
      p.plannedSec += d.plannedSec;
      p.relevantSec += d.relevantSec;
      p.distractionSec += d.distractionSec;
      p.uncertainSec += d.uncertainSec;
      p.blockedAttempts += d.blockedAttempts;
      p.switches += d.switches;
      p.sessionsStarted += d.sessionsStarted;
      p.sessionsCompleted += d.sessionsCompleted;
      buckets.set(bucket, p);
    }
    const points = [...buckets.values()];
    const tracked = days.reduce(
      (s, d) => s + d.plannedSec + d.relevantSec + d.distractionSec + d.uncertainSec,
      0,
    );
    const switches = days.reduce((s, d) => s + d.switches, 0);
    return {
      granularity: q.granularity,
      points,
      totals: {
        focusSec: days.reduce((s, d) => s + d.focusSec, 0),
        unplannedBrowsingSec: days.reduce(
          (s, d) => s + d.relevantSec + d.distractionSec + d.uncertainSec,
          0,
        ),
        blockedAttempts: days.reduce((s, d) => s + d.blockedAttempts, 0),
        switchesPerHour: tracked > 0 ? Math.round((switches / (tracked / 3600)) * 10) / 10 : 0,
      },
    };
  }

  async domains(
    userId: string,
    q: { from: string; to: string; limit: number },
  ): Promise<DomainsAnalytics> {
    this.checkRange(q.from, q.to);
    const tz = await this.timezone(userId);
    const start = zonedTimeToUtc(q.from, tz);
    const end = zonedTimeToUtc(addDays(q.to, 1), tz);
    const [visited, distracting] = await Promise.all([
      this.ctx.db.$queryRaw<{ domain: string; seconds: bigint; visits: bigint }[]>`
        SELECT registrable_domain AS domain, SUM(duration_sec)::bigint AS seconds, COUNT(*)::bigint AS visits
        FROM activity_segments
        WHERE user_id = ${userId}::uuid AND started_at >= ${start} AND started_at < ${end}
        GROUP BY registrable_domain ORDER BY seconds DESC, domain ASC LIMIT ${q.limit}`,
      this.ctx.db.$queryRaw<{ domain: string; seconds: bigint; visits: bigint }[]>`
        SELECT registrable_domain AS domain, SUM(duration_sec)::bigint AS seconds, COUNT(*)::bigint AS visits
        FROM activity_segments
        WHERE user_id = ${userId}::uuid AND started_at >= ${start} AND started_at < ${end} AND label = 'DISTRACTION'
        GROUP BY registrable_domain ORDER BY seconds DESC, domain ASC LIMIT ${q.limit}`,
    ]);
    const toRow = (r: { domain: string; seconds: bigint; visits: bigint }) => ({
      domain: r.domain,
      seconds: Number(r.seconds),
      visits: Number(r.visits),
    });
    return { mostVisited: visited.map(toRow), mostDistracting: distracting.map(toRow) };
  }

  async heatmap(userId: string, q: { from: string; to: string }): Promise<HeatmapAnalytics> {
    this.checkRange(q.from, q.to);
    const tz = await this.timezone(userId);
    const days = await this.dailyRows(userId, tz, q.from, q.to);
    const cells = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({
        focusSec: 0,
        productiveSec: 0,
        distractionSec: 0,
        quality: null as number | null,
      })),
    );
    for (const d of days) {
      // Weekday of a calendar date is zone-independent; noon UTC avoids edge effects.
      const weekday = localParts(Date.parse(`${d.localDate}T12:00:00Z`), 'UTC').weekday - 1;
      for (let h = 0; h < 24; h++) {
        const c = cells[weekday]![h]!;
        c.focusSec += d.hourlyFocusSec[h] ?? 0;
        c.productiveSec += d.hourlyProductiveSec[h] ?? 0;
        c.distractionSec += d.hourlyDistractionSec[h] ?? 0;
      }
    }
    for (const row of cells) {
      for (const c of row) {
        const denom = c.productiveSec + c.distractionSec;
        c.quality = denom > 0 ? Math.round((c.productiveSec / denom) * 1000) / 1000 : null;
      }
    }
    return { cells };
  }

  async sessionsStats(userId: string, q: { from: string; to: string }): Promise<SessionsStats> {
    this.checkRange(q.from, q.to);
    const tz = await this.timezone(userId);
    const now = this.ctx.clock.now();
    const rows = await this.ctx.db.focusSession.findMany({
      where: {
        userId,
        status: { not: 'CANCELLED' },
        startsAt: { gte: zonedTimeToUtc(q.from, tz), lt: zonedTimeToUtc(addDays(q.to, 1), tz) },
      },
      include: { tasks: true },
    });
    const started = rows.filter((s) => effectiveStatus(s, now) !== 'SCHEDULED');
    const finished = started.filter((s) =>
      ['COMPLETED', 'ENDED_EARLY'].includes(effectiveStatus(s, now)),
    );
    const completed = finished.filter((s) => effectiveStatus(s, now) === 'COMPLETED');
    const durations = finished.map(
      (s) => ((s.endedAt ?? s.endsAt).getTime() - (s.startedAt ?? s.startsAt).getTime()) / 60_000,
    );
    const tasksTotal = started.reduce((n, s) => n + s.tasks.length, 0);
    const tasksDone = started.reduce((n, s) => n + s.tasks.filter((t) => t.completedAt).length, 0);
    return {
      sessionsStarted: started.length,
      sessionsCompleted: completed.length,
      completionRate: finished.length
        ? Math.round((completed.length / finished.length) * 1000) / 1000
        : null,
      avgDurationMin: durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null,
      taskCompletionRate: tasksTotal ? Math.round((tasksDone / tasksTotal) * 1000) / 1000 : null,
    };
  }
}
