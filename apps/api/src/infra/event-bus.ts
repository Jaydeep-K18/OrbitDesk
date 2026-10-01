import type { DomainEvent, EventBus, EventHandler } from '@focusguard/domain';
import type { Logger } from 'pino';

/**
 * In-process EventBus (ROADMAP Phase 1, ADR-012). Handlers run asynchronously after the
 * publisher's transaction, like a real broker would. Swapped for Kafka in Phase 4.
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly logger: Logger) {}

  async publish(event: DomainEvent): Promise<void> {
    const handlers = [
      ...(this.handlers.get(event.eventType) ?? []),
      ...(this.handlers.get('*') ?? []),
    ];
    for (const handler of handlers) {
      const run = (async () => {
        await Promise.resolve(); // decouple from the publisher's call stack
        try {
          await handler(event);
        } catch (err) {
          this.logger.error(
            { err, eventType: event.eventType, eventId: event.eventId },
            'event handler failed',
          );
        }
      })();
      this.pending.add(run);
      void run.finally(() => this.pending.delete(run));
    }
  }

  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    const set = this.handlers.get(eventType) ?? new Set();
    set.add(handler as EventHandler);
    this.handlers.set(eventType, set);
    return () => set.delete(handler as EventHandler);
  }

  /** Resolves when every in-flight handler (including ones they trigger) has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

/** Event types published in Phase 1. */
export const Events = {
  SessionCreated: 'session.created',
  SessionStarted: 'session.started',
  SessionUpdated: 'session.updated',
  SessionExtended: 'session.extended',
  SessionEnded: 'session.ended',
  TaskCompleted: 'task.completed',
  ActivityIngested: 'activity.ingested',
  ReportReady: 'report.ready',
} as const;
