import type { ActivityLabel } from '@focusguard/contracts';

/** "1h 35m", "42m", "0m" */
export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec === null || totalSec === undefined) return '—';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m === 0 && s > 0) return `${s}s`;
  return `${m}m`;
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function formatRange(startIso: string, endIso: string, timeZone?: string): string {
  return `${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`;
}

export function shortDate(localDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));
}

export const LABEL_META: Record<ActivityLabel, { text: string; className: string; color: string }> =
  {
    PLANNED: {
      text: 'Planned',
      className: 'bg-planned/15 text-planned',
      color: 'var(--label-planned)',
    },
    UNPLANNED_RELEVANT: {
      text: 'Relevant',
      className: 'bg-relevant/15 text-relevant',
      color: 'var(--label-relevant)',
    },
    DISTRACTION: {
      text: 'Distraction',
      className: 'bg-distraction/15 text-distraction',
      color: 'var(--label-distraction)',
    },
    BLOCKED: {
      text: 'Blocked',
      className: 'bg-blocked/15 text-blocked',
      color: 'var(--label-blocked)',
    },
    UNCERTAIN: {
      text: 'Uncertain',
      className: 'bg-uncertain/20 text-muted-foreground',
      color: 'var(--label-uncertain)',
    },
  };

export const STATUS_META: Record<string, { text: string; className: string }> = {
  SCHEDULED: { text: 'Scheduled', className: 'bg-accent text-accent-foreground' },
  ACTIVE: { text: 'Active', className: 'bg-planned/15 text-planned' },
  COMPLETED: { text: 'Completed', className: 'bg-muted text-foreground' },
  ENDED_EARLY: { text: 'Ended early', className: 'bg-distraction/10 text-distraction' },
  CANCELLED: { text: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

export const TASK_CATEGORIES = [
  { value: 'coding_practice', label: 'Coding practice' },
  { value: 'study', label: 'Study' },
  { value: 'project_dev', label: 'Project development' },
  { value: 'writing', label: 'Writing' },
  { value: 'research', label: 'Research' },
  { value: 'other', label: 'Other' },
] as const;

export function localDateString(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
