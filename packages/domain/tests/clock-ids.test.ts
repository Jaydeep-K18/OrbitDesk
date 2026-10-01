import { describe, expect, it } from 'vitest';
import {
  FakeClock,
  computeClockOffset,
  formatCountdown,
  remainingMs,
  systemClock,
} from '../src/clock.js';
import { uuidv7, uuidv7Timestamp } from '../src/ids.js';

describe('FakeClock', () => {
  it('only moves when told to', () => {
    const clock = new FakeClock('2026-10-02T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-10-02T10:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-10-02T10:01:30.000Z');
    clock.set('2026-12-31T23:59:59.000Z');
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('systemClock returns the current time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe('server-authoritative countdown math', () => {
  it('corrects a client clock that runs 2 minutes slow', () => {
    const clientNow = Date.parse('2026-10-02T09:58:00.000Z');
    const offset = computeClockOffset('2026-10-02T10:00:00.000Z', clientNow);
    expect(offset).toBe(120_000);
    expect(remainingMs('2026-10-02T10:45:00.000Z', clientNow, offset)).toBe(45 * 60_000);
  });

  it('never returns negative remaining time', () => {
    expect(remainingMs('2026-10-02T10:00:00.000Z', Date.parse('2026-10-02T11:00:00Z'), 0)).toBe(0);
  });

  it.each([
    [0, '00:00'],
    [999, '00:01'],
    [61_000, '01:01'],
    [42 * 60_000 + 17_000, '42:17'],
    [2 * 3_600_000 + 5_000, '2:00:05'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 identifiers', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('embeds the timestamp and sorts by time', () => {
    const t = Date.parse('2026-10-02T10:00:00.000Z');
    const a = uuidv7(t);
    const b = uuidv7(t + 1);
    expect(uuidv7Timestamp(a)).toBe(t);
    expect(a < b).toBe(true);
  });

  it('is unique across many generations', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(ids.size).toBe(5000);
  });
});
