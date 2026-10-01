import type { Prisma } from '@prisma/client';
import { ActivityEvent, type ActivityBatchResponse } from '@focusguard/contracts';
import {
  BLOCKED_DEDUPE_WINDOW_MS,
  clipToWorkBlocks,
  hostMatches,
  isSensitiveCategory,
  isTerminal,
  effectiveStatus,
  lookupDomainCategory,
  normalizeDomain,
  scrubTitle,
  uuidv7,
} from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import type { AuthDevice } from '../../auth/middleware.js';
import { Events } from '../../infra/event-bus.js';
import type { ReportsService } from '../reports/reports.service.js';

/** Clock-skew tolerance around the session window (ROADMAP 1.5). */
const SKEW_MS = 5 * 60_000;
/** A heartbeat gap longer than this counts as "extension offline". */
const PRESENCE_GAP_MS = 90_000;

type Rejected = ActivityBatchResponse['rejected'][number];

export class ActivityService {
  constructor(
    private readonly ctx: AppContext,
    private readonly reports: ReportsService,
  ) {}

  async ingest(device: AuthDevice, rawEvents: unknown[]): Promise<ActivityBatchResponse> {
    const rejected: Rejected[] = [];
    const events: ActivityEvent[] = [];
    for (const raw of rawEvents) {
      const parsed = ActivityEvent.safeParse(raw);
      if (parsed.success) events.push(parsed.data);
      else {
        const id = (raw as { clientEventId?: unknown })?.clientEventId;
        rejected.push({
          clientEventId: typeof id === 'string' ? id : null,
          reason:
            `invalid: ${parsed.error.issues[0]?.path.join('.') || 'event'} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
        });
      }
    }

    const userId = device.userId;
    const sessionIds = [...new Set(events.map((e) => e.sessionId))];
    const sessions = await this.ctx.db.focusSession.findMany({
      where: { id: { in: sessionIds }, userId },
      include: { blocks: true },
    });
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const [settings, neverTrack] = await Promise.all([
      this.ctx.db.userSettings.findUnique({ where: { userId } }),
      this.ctx.db.domainRule.findMany({ where: { userId, list: 'never_track' } }),
    ]);
    const neverTrackHosts = neverTrack.map((r) => r.host);

    // Idempotency: drop events we've already stored.
    const segIds = events.filter((e) => e.type === 'segment').map((e) => e.clientEventId);
    const attemptIds = events
      .filter((e) => e.type === 'blocked_attempt')
      .map((e) => e.clientEventId);
    const [existingSegs, existingAttempts] = await Promise.all([
      segIds.length
        ? this.ctx.db.activitySegment.findMany({
            where: { clientEventId: { in: segIds } },
            select: { clientEventId: true },
          })
        : [],
      attemptIds.length
        ? this.ctx.db.blockedAttempt.findMany({
            where: { id: { in: attemptIds } },
            select: { id: true },
          })
        : [],
    ]);
    const seen = new Set([
      ...existingSegs.map((s) => s.clientEventId),
      ...existingAttempts.map((a) => a.id),
    ]);

    const now = this.ctx.clock.now();
    const segmentRows: Prisma.ActivitySegmentCreateManyInput[] = [];
    const attemptRows: Prisma.BlockedAttemptCreateManyInput[] = [];
    const heartbeats = new Map<string, Date[]>();
    const finalFlush = new Set<string>();
    const touched = new Set<string>();
    let accepted = 0;
    let duplicates = 0;

    for (const e of events) {
      const s = byId.get(e.sessionId);
      if (!s) {
        rejected.push({ clientEventId: e.clientEventId, reason: 'unknown_session' });
        continue;
      }
      if (seen.has(e.clientEventId)) {
        duplicates++;
        continue;
      }
      seen.add(e.clientEventId);

      const windowStart = (s.startedAt ?? s.startsAt).getTime();
      const windowEnd = Math.min((s.endedAt ?? s.endsAt).getTime(), now.getTime() + SKEW_MS);
      const inWindow = (t: number) => t >= windowStart - SKEW_MS && t <= windowEnd + SKEW_MS;

      switch (e.type) {
        case 'segment': {
          const start = Date.parse(e.startedAt);
          const end = Date.parse(e.endedAt);
          if (!inWindow(start) || !inWindow(end)) {
            rejected.push({ clientEventId: e.clientEventId, reason: 'outside_session_window' });
            continue;
          }
          const n = normalizeDomain(e.domain);
          if (!n) {
            rejected.push({ clientEventId: e.clientEventId, reason: 'invalid_domain' });
            continue;
          }
          accepted++;
          if (neverTrackHosts.some((h) => hostMatches(n.host, h))) continue; // honoured server-side too
          const category = lookupDomainCategory(n.host);
          const title =
            settings?.titleCollectionEnabled && !isSensitiveCategory(category)
              ? scrubTitle(e.title)
              : null;
          const parts = clipToWorkBlocks(new Date(start), new Date(end), s.blocks, {
            start: new Date(windowStart),
            end: new Date(windowEnd),
          });
          parts.forEach((p, part) => {
            segmentRows.push({
              id: uuidv7(p.start.getTime()),
              clientEventId: e.clientEventId,
              part,
              userId,
              sessionId: s.id,
              deviceId: device.deviceId,
              blockId: p.block.id ?? null,
              host: n.host,
              registrableDomain: n.registrableDomain,
              title,
              startedAt: p.start,
              endedAt: p.end,
              durationSec: Math.round((p.end.getTime() - p.start.getTime()) / 1000),
            });
          });
          if (parts.length > 0) touched.add(s.id);
          break;
        }
        case 'blocked_attempt': {
          const at = Date.parse(e.at);
          if (!inWindow(at)) {
            rejected.push({ clientEventId: e.clientEventId, reason: 'outside_session_window' });
            continue;
          }
          const n = normalizeDomain(e.domain);
          if (!n) {
            rejected.push({ clientEventId: e.clientEventId, reason: 'invalid_domain' });
            continue;
          }
          accepted++;
          attemptRows.push({
            id: e.clientEventId,
            userId,
            sessionId: s.id,
            deviceId: device.deviceId,
            host: n.host,
            attemptedAt: new Date(at),
          });
          touched.add(s.id);
          break;
        }
        case 'heartbeat': {
          accepted++;
          const list = heartbeats.get(s.id) ?? [];
          list.push(new Date(Date.parse(e.at)));
          heartbeats.set(s.id, list);
          break;
        }
        case 'tracker_state':
          accepted++;
          break;
        case 'final_flush':
          accepted++;
          finalFlush.add(s.id);
          break;
      }
    }

    if (attemptRows.length) await this.markDuplicateAttempts(attemptRows);
    if (segmentRows.length)
      await this.ctx.db.activitySegment.createMany({ data: segmentRows, skipDuplicates: true });
    if (attemptRows.length)
      await this.ctx.db.blockedAttempt.createMany({ data: attemptRows, skipDuplicates: true });
    for (const [sessionId, beats] of heartbeats)
      await this.recordPresence(sessionId, device.deviceId, beats);

    for (const sessionId of touched) {
      await this.ctx.bus.publish({
        eventId: uuidv7(),
        eventType: Events.ActivityIngested,
        occurredAt: now.toISOString(),
        userId,
        sessionId,
        deviceId: device.deviceId,
        payload: {
          segments: segmentRows.filter((r) => r.sessionId === sessionId).length,
          blockedAttempts: attemptRows.filter((r) => r.sessionId === sessionId).length,
        },
      });
    }

    // Late events re-finalize; a final flush finalizes a finished session immediately.
    for (const sessionId of new Set([...touched, ...finalFlush])) {
      const s = byId.get(sessionId)!;
      const terminal = isTerminal(effectiveStatus(s, now));
      if (s.finalizedAt || (finalFlush.has(sessionId) && terminal)) {
        // Classification runs on ActivityIngested; let it finish before computing metrics.
        await this.ctx.bus.idle();
        await this.reports.finalize(sessionId);
      }
    }

    return { accepted, duplicates, rejected };
  }

  /** Flags reload-loop repeats: same host in the same session within 10 s of the previous attempt. */
  private async markDuplicateAttempts(rows: Prisma.BlockedAttemptCreateManyInput[]) {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.attemptedAt).getTime() - new Date(b.attemptedAt).getTime(),
    );
    const earliest = new Date(
      new Date(sorted[0]!.attemptedAt).getTime() - BLOCKED_DEDUPE_WINDOW_MS,
    );
    const prior = await this.ctx.db.blockedAttempt.findMany({
      where: {
        sessionId: { in: [...new Set(rows.map((r) => r.sessionId))] },
        attemptedAt: { gte: earliest },
      },
      select: { sessionId: true, host: true, attemptedAt: true },
    });
    const last = new Map<string, number>();
    for (const p of prior) {
      const k = `${p.sessionId}|${p.host}`;
      last.set(k, Math.max(last.get(k) ?? 0, p.attemptedAt.getTime()));
    }
    for (const r of sorted) {
      const k = `${r.sessionId}|${r.host}`;
      const t = new Date(r.attemptedAt).getTime();
      const prev = last.get(k);
      r.deduped = prev !== undefined && t - prev <= BLOCKED_DEDUPE_WINDOW_MS && t >= prev;
      last.set(k, t);
    }
  }

  private async recordPresence(sessionId: string, deviceId: string, beats: Date[]) {
    const sorted = beats.sort((a, b) => a.getTime() - b.getTime());
    const existing = await this.ctx.db.sessionPresence.findUnique({
      where: { sessionId_deviceId: { sessionId, deviceId } },
    });
    let last = existing?.lastSeenAt.getTime();
    let offline = existing?.offlineSec ?? 0;
    for (const b of sorted) {
      const t = b.getTime();
      if (last !== undefined && t - last > PRESENCE_GAP_MS)
        offline += Math.round((t - last) / 1000);
      last = Math.max(last ?? t, t);
    }
    await this.ctx.db.sessionPresence.upsert({
      where: { sessionId_deviceId: { sessionId, deviceId } },
      create: {
        sessionId,
        deviceId,
        firstSeenAt: sorted[0]!,
        lastSeenAt: new Date(last!),
        offlineSec: offline,
      },
      update: { lastSeenAt: new Date(last!), offlineSec: offline },
    });
  }
}
