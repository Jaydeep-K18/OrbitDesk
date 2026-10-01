/**
 * Time-zone helpers built on Intl (no I/O). Correct for half-hour offsets (e.g. Asia/Kolkata)
 * and DST transitions: instants are UTC; "local" values are derived per IANA zone.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localParts(instant: Date | number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function toLocalDate(instant: Date | number, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset of the zone from UTC at an instant, in minutes (IST → +330). */
export function zoneOffsetMinutes(instant: Date | number, timeZone: string): number {
  const ms = new Date(instant).getTime();
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** UTC instant at which a local date-time occurs (DST gaps resolve forward). */
export function zonedTimeToUtc(localDate: string, timeZone: string, hour = 0, minute = 0): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  let guess = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  // Second pass corrects when the offset differs between the naive guess and the result.
  guess = naive - zoneOffsetMinutes(guess, timeZone) * 60_000;
  return new Date(guess);
}

/** [start, end) UTC instants covering a local calendar day. */
export function localDayRange(localDate: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(localDate, timeZone),
    end: zonedTimeToUtc(addDays(localDate, 1), timeZone),
  };
}

/** Adds days to a YYYY-MM-DD date string (calendar arithmetic, zone-independent). */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive list of dates between two YYYY-MM-DD strings. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday (ISO week start) of the week containing a date. */
export function weekStart(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(localDate, -((dow + 6) % 7));
}

export interface HourSlice {
  localDate: string;
  hour: number;
  weekday: number;
  seconds: number;
}

/**
 * Splits [start, end) into slices that each fall within one local clock hour.
 * Used to attribute focus time to days and hours for daily stats and heatmaps.
 */
export function splitByLocalHour(
  start: Date | number,
  end: Date | number,
  timeZone: string,
): HourSlice[] {
  const slices: HourSlice[] = [];
  let cursor = new Date(start).getTime();
  const stop = new Date(end).getTime();
  let guard = 0;
  while (cursor < stop && guard++ < 10_000) {
    const p = localParts(cursor, timeZone);
    const msIntoHour = (p.minute * 60 + p.second) * 1000 + (cursor % 1000);
    const next = Math.min(stop, cursor + 3_600_000 - msIntoHour);
    const seconds = (next - cursor) / 1000;
    const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const last = slices[slices.length - 1];
    if (last && last.localDate === date && last.hour === p.hour) last.seconds += seconds;
    else slices.push({ localDate: date, hour: p.hour, weekday: p.weekday, seconds });
    cursor = next;
  }
  return slices;
}

/** Seconds of overlap between two [start, end) intervals (ms epoch). */
export function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 1000;
}
