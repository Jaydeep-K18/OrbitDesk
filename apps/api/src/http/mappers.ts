import type {
  ActivitySegment as SegmentRow,
  Device as DeviceRow,
  DomainRule as DomainRuleRow,
  FocusSession as SessionRow,
  FocusSessionBlock,
  SessionDomain,
  SessionTask as SessionTaskRow,
  Task as TaskRow,
  User as UserRow,
  UserSettings as SettingsRow,
} from '@prisma/client';
import type {
  ActivitySegment,
  Device,
  DeviceScope,
  DomainRule,
  FocusSession,
  Task,
  User,
  UserSettings,
} from '@focusguard/contracts';
import { effectiveStatus } from '@focusguard/domain';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    timezone: u.timezone,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: iso(u.createdAt),
  };
}

export function toSettings(s: SettingsRow): UserSettings {
  return {
    trackingEnabled: s.trackingEnabled,
    titleCollectionEnabled: s.titleCollectionEnabled,
    widgetEnabled: s.widgetEnabled,
    blockDuringBreaks: s.blockDuringBreaks,
    activityRetentionDays: s.activityRetentionDays,
  };
}

export function toDevice(d: DeviceRow): Device {
  return {
    id: d.id,
    type: d.type,
    name: d.name,
    version: d.version,
    scopes: d.scopes as DeviceScope[],
    lastSeenAt: isoOrNull(d.lastSeenAt),
    createdAt: iso(d.createdAt),
    revokedAt: isoOrNull(d.revokedAt),
  };
}

export function toTask(t: TaskRow): Task {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    category: t.category,
    status: t.status,
    estimateMin: t.estimateMin,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    tags: t.tags,
    completedAt: isoOrNull(t.completedAt),
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
}

export function toDomainRule(r: DomainRuleRow): DomainRule {
  return { id: r.id, host: r.host, list: r.list, scope: r.scope, createdAt: iso(r.createdAt) };
}

export type SessionWithRelations = SessionRow & {
  blocks: FocusSessionBlock[];
  tasks: SessionTaskRow[];
  domains: SessionDomain[];
};

export const sessionInclude = {
  blocks: { orderBy: { idx: 'asc' } },
  tasks: { orderBy: { taskTitle: 'asc' } },
  domains: true,
} as const;

export function toSession(s: SessionWithRelations, now: Date): FocusSession {
  const activeDomains = s.domains.filter((d) => d.removedAt === null);
  const plannedMs = s.blocks
    .filter((b) => b.kind === 'work')
    .reduce((sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()), 0);
  return {
    id: s.id,
    status: effectiveStatus(s, now),
    startsAt: iso(s.startsAt),
    endsAt: iso(s.endsAt),
    startedAt: isoOrNull(s.startedAt),
    endedAt: isoOrNull(s.endedAt),
    endReason: s.endReason,
    plannedDurationMin: Math.round(plannedMs / 60_000),
    blockDuringBreaks: s.blockDuringBreaks,
    version: s.version,
    blocks: s.blocks.map((b) => ({
      id: b.id,
      idx: b.idx,
      kind: b.kind,
      startsAt: iso(b.startsAt),
      endsAt: iso(b.endsAt),
      title: b.title,
    })),
    tasks: s.tasks.map((t) => ({
      id: t.id,
      taskId: t.taskId,
      title: t.taskTitle,
      category: t.taskCategory,
      blockId: t.blockId,
      completedAt: isoOrNull(t.completedAt),
    })),
    blockedDomains: activeDomains
      .filter((d) => d.kind === 'blocked')
      .map((d) => d.host)
      .sort(),
    relevantDomains: activeDomains
      .filter((d) => d.kind === 'relevant')
      .map((d) => d.host)
      .sort(),
    planId: s.planId,
    createdAt: iso(s.createdAt),
  };
}

export function toSegment(s: SegmentRow): ActivitySegment {
  return {
    id: s.id,
    host: s.host,
    registrableDomain: s.registrableDomain,
    title: s.title,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    durationSec: s.durationSec,
    blockId: s.blockId,
    label: s.label,
    confidence: s.confidence,
    labelSource: s.labelSource,
    explanation: s.explanation,
  };
}
