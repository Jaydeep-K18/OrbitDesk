import { describe, expect, it } from 'vitest';
import { PageQuery, Problem, TimeZone, Timestamp } from './common.js';

describe('common contracts', () => {
  it('accepts valid IANA time zones and rejects garbage', () => {
    expect(TimeZone.safeParse('Asia/Kolkata').success).toBe(true);
    expect(TimeZone.safeParse('UTC').success).toBe(true);
    expect(TimeZone.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('accepts ISO timestamps with offsets', () => {
    expect(Timestamp.safeParse('2026-10-02T15:00:00.000Z').success).toBe(true);
    expect(Timestamp.safeParse('2026-10-02T15:00:00+05:30').success).toBe(true);
    expect(Timestamp.safeParse('yesterday').success).toBe(false);
  });

  it('applies pagination defaults and bounds', () => {
    expect(PageQuery.parse({})).toEqual({ limit: 20 });
    expect(PageQuery.parse({ limit: '50' }).limit).toBe(50);
    expect(PageQuery.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('validates problem documents', () => {
    const p = Problem.parse({
      type: 'https://focusguard.app/problems/session-overlap',
      title: 'Session overlaps another session',
      status: 409,
      code: 'SESSION_OVERLAP',
    });
    expect(p.code).toBe('SESSION_OVERLAP');
  });
});
