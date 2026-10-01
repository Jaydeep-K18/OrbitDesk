import { uuidv7 } from '@focusguard/domain';
import type { AppContext } from '../context.js';
import { Events } from '../infra/event-bus.js';
import type { ReportsService } from '../modules/reports/reports.service.js';

const LOCK_KEY = 7_274_001; // arbitrary, stable advisory-lock id for the sweeper

/**
 * Session lifecycle sweeper (ROADMAP 1.2). Persists time-driven transitions and finalizes
 * reports after the grace window. Reads derive status from time, so a late tick is harmless.
 * A transaction-scoped advisory lock keeps multiple API instances from double-processing.
 * Replaced by BullMQ delayed jobs in Phase 3 (kept as a safety net).
 */
export class LifecycleSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly reports: ReportsService,
  ) {}

  start(intervalMs: number) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ started: number; completed: number; finalized: number }> {
    if (this.running) return { started: 0, completed: 0, finalized: 0 };
    this.running = true;
    try {
      const now = this.ctx.clock.now();
      const transitions = await this.ctx.db.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
        if (!lock[0]?.locked) return null;
        const started = await tx.$queryRaw<{ id: string; user_id: string }[]>`
          UPDATE focus_sessions SET status = 'ACTIVE', started_at = starts_at, version = version + 1, updated_at = ${now}
          WHERE status = 'SCHEDULED' AND starts_at <= ${now} RETURNING id, user_id`;
        const completed = await tx.$queryRaw<{ id: string; user_id: string }[]>`
          UPDATE focus_sessions SET status = 'COMPLETED', ended_at = ends_at, version = version + 1, updated_at = ${now}
          WHERE status = 'ACTIVE' AND ends_at <= ${now} RETURNING id, user_id`;
        return { started, completed };
      });
      if (!transitions) return { started: 0, completed: 0, finalized: 0 };

      const publish = (eventType: string, r: { id: string; user_id: string }) =>
        this.ctx.bus.publish({
          eventId: uuidv7(),
          eventType,
          occurredAt: now.toISOString(),
          userId: r.user_id,
          sessionId: r.id,
          payload: { automatic: true },
        });
      for (const r of transitions.started) await publish(Events.SessionStarted, r);
      for (const r of transitions.completed) await publish(Events.SessionEnded, r);

      const finalized = await this.reports.finalizeDue();
      return {
        started: transitions.started.length,
        completed: transitions.completed.length,
        finalized,
      };
    } catch (err) {
      this.ctx.logger.error({ err }, 'lifecycle tick failed');
      return { started: 0, completed: 0, finalized: 0 };
    } finally {
      this.running = false;
    }
  }
}
