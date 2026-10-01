import { z } from 'zod';
import { Id, Timestamp } from './common.js';
import { ActivityLabel } from './enums.js';
import { ActivitySegment } from './activity.js';
import { FocusSession } from './sessions.js';

/** Metric definitions: ROADMAP §7.5 (single implementation in @focusguard/domain metrics). */
export const SessionMetrics = z.object({
  plannedFocusSec: z.number().int(),
  actualFocusSec: z.number().int(),
  trackedBrowserSec: z.number().int(),
  outsideBrowserSec: z.number().int(),
  plannedSec: z.number().int(),
  relevantSec: z.number().int(),
  distractionSec: z.number().int(),
  uncertainSec: z.number().int(),
  productiveSec: z.number().int(),
  unplannedBrowsingSec: z.number().int(),
  blockedAttempts: z.number().int(),
  websiteSwitches: z.number().int(),
  switchesPerHour: z.number(),
  taskCompletion: z.number().nullable(),
  tasksCompleted: z.number().int(),
  tasksTotal: z.number().int(),
  focusQuality: z.number().nullable(),
  timeToFirstDistractionSec: z.number().int().nullable(),
  sessionCompleted: z.boolean(),
  extensionOfflineSec: z.number().int(),
});
export type SessionMetrics = z.infer<typeof SessionMetrics>;

export const DomainBreakdownRow = z.object({
  domain: z.string(),
  seconds: z.number().int(),
  label: ActivityLabel,
  visits: z.number().int(),
});
export type DomainBreakdownRow = z.infer<typeof DomainBreakdownRow>;

export const BlockedAttemptMarker = z.object({
  id: Id,
  host: z.string(),
  at: Timestamp,
});

export const SessionReport = z.object({
  session: FocusSession,
  version: z.number().int(),
  generatedAt: Timestamp.nullable(),
  final: z.boolean(),
  metrics: SessionMetrics,
  domains: z.array(DomainBreakdownRow),
  segments: z.array(ActivitySegment),
  blockedAttempts: z.array(BlockedAttemptMarker),
});
export type SessionReport = z.infer<typeof SessionReport>;

// --- Dashboard & analytics ---

export const DashboardSummary = z.object({
  serverNow: Timestamp,
  localDate: z.string(),
  today: z.object({
    focusSec: z.number().int(),
    sessionsCompleted: z.number().int(),
    blockedAttempts: z.number().int(),
    tasksCompleted: z.number().int(),
    tasksPlanned: z.number().int(),
    productiveSec: z.number().int(),
    distractionSec: z.number().int(),
  }),
  last7Days: z.array(z.object({ date: z.string(), focusSec: z.number().int() })),
  activeSession: FocusSession.nullable(),
  liveCounters: z
    .object({ blockedAttempts: z.number().int(), websiteSwitches: z.number().int() })
    .nullable(),
  recentSessions: z.array(
    z.object({
      id: Id,
      status: z.string(),
      startsAt: Timestamp,
      endsAt: Timestamp,
      focusQuality: z.number().nullable(),
      productiveSec: z.number().int().nullable(),
    }),
  ),
  recentActivity: z.array(
    z.object({
      kind: z.enum(['segment', 'blocked']),
      host: z.string(),
      at: Timestamp,
      label: ActivityLabel.nullable(),
      durationSec: z.number().int().nullable(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export const AnalyticsRangeQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    granularity: z.enum(['day', 'week']).default('day'),
  })
  .refine((q) => q.to >= q.from, { message: '"to" must not be before "from"', path: ['to'] });

export const AnalyticsOverview = z.object({
  granularity: z.enum(['day', 'week']),
  points: z.array(
    z.object({
      bucket: z.string(),
      focusSec: z.number().int(),
      plannedSec: z.number().int(),
      relevantSec: z.number().int(),
      distractionSec: z.number().int(),
      uncertainSec: z.number().int(),
      blockedAttempts: z.number().int(),
      switches: z.number().int(),
      sessionsStarted: z.number().int(),
      sessionsCompleted: z.number().int(),
    }),
  ),
  totals: z.object({
    focusSec: z.number().int(),
    unplannedBrowsingSec: z.number().int(),
    blockedAttempts: z.number().int(),
    switchesPerHour: z.number(),
  }),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>;

export const DomainsAnalytics = z.object({
  mostVisited: z.array(
    z.object({ domain: z.string(), seconds: z.number().int(), visits: z.number().int() }),
  ),
  mostDistracting: z.array(
    z.object({ domain: z.string(), seconds: z.number().int(), visits: z.number().int() }),
  ),
});
export type DomainsAnalytics = z.infer<typeof DomainsAnalytics>;

export const HeatmapAnalytics = z.object({
  /** cells[weekday 0=Mon..6=Sun][hour 0..23] */
  cells: z.array(
    z.array(
      z.object({
        focusSec: z.number().int(),
        productiveSec: z.number().int(),
        distractionSec: z.number().int(),
        quality: z.number().nullable(),
      }),
    ),
  ),
});
export type HeatmapAnalytics = z.infer<typeof HeatmapAnalytics>;

export const SessionsStats = z.object({
  sessionsStarted: z.number().int(),
  sessionsCompleted: z.number().int(),
  completionRate: z.number().nullable(),
  avgDurationMin: z.number().nullable(),
  taskCompletionRate: z.number().nullable(),
});
export type SessionsStats = z.infer<typeof SessionsStats>;
