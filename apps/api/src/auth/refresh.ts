import type { Request } from 'express';
import { uuidv7 } from '@focusguard/domain';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';
import { audit } from '../infra/audit.js';
import { hashToken, randomToken } from './tokens.js';

const DAY_MS = 86_400_000;

export interface IssuedRefresh {
  token: string;
  familyId: string;
  expiresAt: Date;
}

/** Issues a new refresh token, optionally continuing an existing family. */
export async function issueRefreshToken(
  ctx: AppContext,
  opts: { userId: string; deviceId?: string | null; familyId?: string; userAgent?: string | null },
): Promise<IssuedRefresh> {
  const token = randomToken();
  const familyId = opts.familyId ?? uuidv7();
  const ttlDays = opts.deviceId ? ctx.config.deviceRefreshTtlDays : ctx.config.refreshTtlDays;
  const expiresAt = new Date(ctx.clock.now().getTime() + ttlDays * DAY_MS);
  await ctx.db.refreshToken.create({
    data: {
      userId: opts.userId,
      deviceId: opts.deviceId ?? null,
      tokenHash: hashToken(token),
      familyId,
      expiresAt,
      userAgent: opts.userAgent?.slice(0, 200) ?? null,
    },
  });
  return { token, familyId, expiresAt };
}

export interface RotatedRefresh extends IssuedRefresh {
  userId: string;
  deviceId: string | null;
}

/**
 * Rotates a refresh token. Presenting an already-rotated or revoked token is treated as theft:
 * the whole family is revoked and an audit entry written (ROADMAP 1.1, reuse detection).
 */
export async function rotateRefreshToken(
  ctx: AppContext,
  presented: string,
  kind: 'web' | 'device',
  req?: Request,
): Promise<RotatedRefresh> {
  const now = ctx.clock.now();
  const existing = await ctx.db.refreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
  });
  if (!existing) throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
  // Wrong endpoint for this token kind: reject without rotating (or a stray call could log a device out).
  if ((kind === 'device') !== (existing.deviceId !== null)) {
    throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
  }

  if (existing.revokedAt || existing.replacedById) {
    await revokeFamily(ctx, existing.familyId);
    await audit(ctx.db, 'refresh_token_reuse', {
      userId: existing.userId,
      req,
      metadata: { familyId: existing.familyId, deviceId: existing.deviceId },
    });
    throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
  }
  if (existing.expiresAt <= now) throw new AppError(401, 'TOKEN_INVALID', 'Session expired');

  if (existing.deviceId) {
    const device = await ctx.db.device.findUnique({ where: { id: existing.deviceId } });
    if (!device || device.revokedAt) throw new AppError(401, 'TOKEN_INVALID', 'Device revoked');
  }

  const token = randomToken();
  const ttlDays = existing.deviceId ? ctx.config.deviceRefreshTtlDays : ctx.config.refreshTtlDays;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);

  // Atomic rotation: only one concurrent rotation of the same token can win.
  const created = await ctx.db.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        deviceId: existing.deviceId,
        tokenHash: hashToken(token),
        familyId: existing.familyId,
        expiresAt,
        userAgent: existing.userAgent,
      },
    });
    const updated = await tx.refreshToken.updateMany({
      where: { id: existing.id, replacedById: null, revokedAt: null },
      data: { replacedById: next.id },
    });
    if (updated.count !== 1) throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
    return next;
  });

  return {
    token,
    familyId: created.familyId,
    expiresAt,
    userId: existing.userId,
    deviceId: existing.deviceId,
  };
}

export async function revokeFamily(ctx: AppContext, familyId: string): Promise<void> {
  await ctx.db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: ctx.clock.now() },
  });
}

/** Looks up the family of a presented token (for logout). */
export async function familyOf(ctx: AppContext, presented: string): Promise<string | null> {
  const row = await ctx.db.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
  return row?.familyId ?? null;
}

/** Revokes every web (non-device) session of a user. */
export async function revokeAllWebSessions(ctx: AppContext, userId: string): Promise<void> {
  await ctx.db.refreshToken.updateMany({
    where: { userId, deviceId: null, revokedAt: null },
    data: { revokedAt: ctx.clock.now() },
  });
}
