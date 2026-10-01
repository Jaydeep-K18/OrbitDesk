import type { Prisma } from '@prisma/client';
import type { MetricsInput } from '@focusguard/domain';
import type { AppContext } from '../../context.js';

export const metricsInclude = {
  blocks: { orderBy: { idx: 'asc' } },
  tasks: true,
  segments: { orderBy: { startedAt: 'asc' } },
  blockedAttempt: { orderBy: { attemptedAt: 'asc' } },
  presence: true,
} satisfies Prisma.FocusSessionInclude;

export type SessionForMetrics = Prisma.FocusSessionGetPayload<{ include: typeof metricsInclude }>;

export function toMetricsInput(s: SessionForMetrics, now: Date): MetricsInput {
  return {
    session: {
      status: s.status,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    },
    now,
    blocks: s.blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    })),
    segments: s.segments.map((g) => ({
      host: g.host,
      registrableDomain: g.registrableDomain,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      label: g.label,
    })),
    blockedAttempts: s.blockedAttempt.map((a) => ({ host: a.host, at: a.attemptedAt })),
    tasks: s.tasks.map((t) => ({ completedAt: t.completedAt })),
    extensionOfflineSec: s.presence.reduce((max, p) => Math.max(max, p.offlineSec), 0),
  };
}

export async function loadSessionsForMetrics(
  ctx: AppContext,
  where: Prisma.FocusSessionWhereInput,
): Promise<SessionForMetrics[]> {
  return ctx.db.focusSession.findMany({
    where,
    include: metricsInclude,
    orderBy: { startsAt: 'asc' },
  });
}
