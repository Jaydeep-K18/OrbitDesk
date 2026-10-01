/** Injectable time source. Every time-dependent code path takes a Clock so tests are deterministic. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test clock that only moves when told to. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(time: Date | string | number): void {
    this.current = new Date(time).getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

/** Offset between server and client clocks; clients add it to Date.now() for authoritative time. */
export function computeClockOffset(serverNowIso: string, clientNowMs: number): number {
  return new Date(serverNowIso).getTime() - clientNowMs;
}

/** Remaining milliseconds until `endsAt`, using a server clock offset. Never negative. */
export function remainingMs(endsAtIso: string, clientNowMs: number, offsetMs: number): number {
  return Math.max(0, new Date(endsAtIso).getTime() - (clientNowMs + offsetMs));
}

/** Formats milliseconds as `H:MM:SS` or `MM:SS`. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
