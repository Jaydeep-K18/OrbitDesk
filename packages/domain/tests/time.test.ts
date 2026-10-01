import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  localDayRange,
  localParts,
  overlapSeconds,
  splitByLocalHour,
  toLocalDate,
  weekStart,
  zoneOffsetMinutes,
  zonedTimeToUtc,
} from '../src/time.js';

describe('time zone helpers', () => {
  it('derives local parts with half-hour offsets (IST)', () => {
    const p = localParts(Date.parse('2026-10-02T18:45:30Z'), 'Asia/Kolkata');
    expect(p).toMatchObject({
      year: 2026,
      month: 10,
      day: 3,
      hour: 0,
      minute: 15,
      second: 30,
      weekday: 6,
    });
    expect(zoneOffsetMinutes(Date.parse('2026-10-02T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('computes local dates near midnight', () => {
    expect(toLocalDate(Date.parse('2026-10-02T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-02');
    expect(toLocalDate(Date.parse('2026-10-02T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-03');
    expect(toLocalDate(Date.parse('2026-10-02T03:00:00Z'), 'America/New_York')).toBe('2026-10-01');
  });

  it('converts local midnight to UTC, including across DST', () => {
    expect(zonedTimeToUtc('2026-10-03', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-02T18:30:00.000Z',
    );
    // US DST starts 2026-03-08 at 02:00 local.
    expect(zonedTimeToUtc('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it('gives a 23-hour local day on DST start', () => {
    const { start, end } = localDayRange('2026-03-08', 'America/New_York');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('does calendar arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dateRange('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday → previous Monday
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
  });

  it('splits intervals at local hour boundaries (IST half-hour offset)', () => {
    // 09:00Z–10:00Z is 14:30–15:30 IST → two half-hour slices.
    const slices = splitByLocalHour(
      Date.parse('2026-10-02T09:00:00Z'),
      Date.parse('2026-10-02T10:00:00Z'),
      'Asia/Kolkata',
    );
    expect(slices).toEqual([
      { localDate: '2026-10-02', hour: 14, weekday: 5, seconds: 1800 },
      { localDate: '2026-10-02', hour: 15, weekday: 5, seconds: 1800 },
    ]);
  });

  it('splits a session spanning local midnight across two dates', () => {
    const slices = splitByLocalHour(
      Date.parse('2026-10-02T18:00:00Z'),
      Date.parse('2026-10-02T19:00:00Z'),
      'Asia/Kolkata',
    );
    expect(slices.map((s) => [s.localDate, s.hour, s.seconds])).toEqual([
      ['2026-10-02', 23, 1800],
      ['2026-10-03', 0, 1800],
    ]);
  });

  it('computes interval overlap', () => {
    expect(overlapSeconds(0, 10_000, 5_000, 20_000)).toBe(5);
    expect(overlapSeconds(0, 1000, 2000, 3000)).toBe(0);
  });
});
