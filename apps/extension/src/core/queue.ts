/** Offline event queue (ROADMAP 1.5): bounded, oldest-dropped, exponential backoff. Pure. */

export const QUEUE_CAP = 5000;
export const BATCH_MAX = 500;
export const FLUSH_THRESHOLD = 100;

export interface QueuedEvent {
  clientEventId: string;
  type: string;
  [key: string]: unknown;
}

export interface QueueState {
  events: QueuedEvent[];
  /** Events dropped because the queue was full (reported in the final flush). */
  dropped: number;
  failures: number;
  nextAttemptAt: number;
}

export const emptyQueue = (): QueueState => ({
  events: [],
  dropped: 0,
  failures: 0,
  nextAttemptAt: 0,
});

export function enqueue(q: QueueState, events: QueuedEvent[], cap = QUEUE_CAP): QueueState {
  const all = [...q.events, ...events];
  const overflow = Math.max(0, all.length - cap);
  return { ...q, events: all.slice(overflow), dropped: q.dropped + overflow };
}

export function takeBatch(q: QueueState, max = BATCH_MAX): QueuedEvent[] {
  return q.events.slice(0, max);
}

/** Remove events the server has processed (accepted, duplicate or permanently rejected). */
export function ack(q: QueueState, ids: Set<string>): QueueState {
  return {
    ...q,
    events: q.events.filter((e) => !ids.has(e.clientEventId)),
    failures: 0,
    nextAttemptAt: 0,
  };
}

export function backoffMs(failures: number, random = Math.random()): number {
  const base = Math.min(5 * 60_000, 2 ** Math.min(failures, 10) * 2000);
  return Math.round(base * (0.8 + random * 0.4));
}

export function failed(q: QueueState, now: number, random?: number): QueueState {
  const failures = q.failures + 1;
  return { ...q, failures, nextAttemptAt: now + backoffMs(failures, random) };
}

export function shouldFlushNow(q: QueueState, now: number, urgent = false): boolean {
  if (q.events.length === 0 || now < q.nextAttemptAt) return false;
  return urgent || q.events.length >= FLUSH_THRESHOLD;
}
