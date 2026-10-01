import { Router } from 'express';
import {
  DeviceRefreshRequest,
  PairRequest,
  type DeviceScope,
  type DeviceTokens,
} from '@focusguard/contracts';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse, uuidParam } from '../../http/validate.js';
import { toDevice } from '../../http/mappers.js';
import { limiter } from '../../http/security.js';
import { requireUser, userOf } from '../../auth/middleware.js';
import { issueRefreshToken, rotateRefreshToken } from '../../auth/refresh.js';
import { hashToken, pairingCode } from '../../auth/tokens.js';
import { audit } from '../../infra/audit.js';

const PAIRING_TTL_MS = 2 * 60_000;

/** Least-privilege scopes per device type (ADR-005). */
export const DEVICE_SCOPES: Record<'extension' | 'collector', DeviceScope[]> = {
  extension: ['session:read', 'activity:write'],
  collector: ['session:read', 'network:write'],
};

export function devicesRouter(ctx: AppContext): Router {
  const router = Router();
  const auth = requireUser(ctx);

  router.post(
    '/devices/pairing-codes',
    auth,
    limiter(ctx, {
      windowMs: 3_600_000,
      limit: 20,
      keyGenerator: (req) => req.user?.userId ?? 'anon',
    }),
    async (req, res) => {
      const code = pairingCode();
      const expiresAt = new Date(ctx.clock.now().getTime() + PAIRING_TTL_MS);
      await ctx.db.pairingCode.create({
        data: { userId: userOf(req).userId, codeHash: hashToken(code), expiresAt },
      });
      res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
    },
  );

  router.post('/devices/pair', limiter(ctx, { windowMs: 60_000, limit: 10 }), async (req, res) => {
    const body = parse(PairRequest, req.body);
    const now = ctx.clock.now();
    // Atomic single-use consumption: concurrent attempts with the same code can't both win.
    const consumed = await ctx.db.$queryRaw<{ user_id: string }[]>`
      UPDATE pairing_codes SET used_at = ${now}
      WHERE code_hash = ${hashToken(body.code)} AND used_at IS NULL AND expires_at > ${now}
      RETURNING user_id`;
    const userId = consumed[0]?.user_id;
    if (!userId) throw new AppError(400, 'PAIRING_CODE_INVALID', 'Pairing code invalid or expired');

    const scopes = DEVICE_SCOPES[body.type];
    const device = await ctx.db.device.create({
      data: {
        userId,
        type: body.type,
        name: body.name,
        version: body.version ?? null,
        scopes,
        lastSeenAt: now,
      },
    });
    const refresh = await issueRefreshToken(ctx, {
      userId,
      deviceId: device.id,
      userAgent: req.get('user-agent'),
    });
    const accessToken = await ctx.tokens.sign({
      sub: userId,
      aud: body.type,
      sid: device.id,
      scope: scopes,
    });
    await audit(ctx.db, 'device_paired', {
      userId,
      req,
      metadata: { deviceId: device.id, type: body.type },
    });
    res.status(201).json({
      deviceId: device.id,
      accessToken,
      refreshToken: refresh.token,
      expiresIn: ctx.tokens.accessTtlSec,
    } satisfies DeviceTokens);
  });

  router.post(
    '/devices/token/refresh',
    limiter(ctx, { windowMs: 60_000, limit: 30 }),
    async (req, res) => {
      const { refreshToken } = parse(DeviceRefreshRequest, req.body);
      const rotated = await rotateRefreshToken(ctx, refreshToken, 'device', req);
      const device = await ctx.db.device.findUniqueOrThrow({ where: { id: rotated.deviceId! } });
      const accessToken = await ctx.tokens.sign({
        sub: device.userId,
        aud: device.type,
        sid: device.id,
        scope: device.scopes,
      });
      res.json({
        deviceId: device.id,
        accessToken,
        refreshToken: rotated.token,
        expiresIn: ctx.tokens.accessTtlSec,
      } satisfies DeviceTokens);
    },
  );

  router.get('/devices', auth, async (req, res) => {
    const devices = await ctx.db.device.findMany({
      where: { userId: userOf(req).userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items: devices.map(toDevice) });
  });

  router.delete('/devices/:id', auth, async (req, res) => {
    const { userId } = userOf(req);
    const id = uuidParam(req.params.id);
    const now = ctx.clock.now();
    const updated = await ctx.db.device.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (updated.count === 0) {
      const exists = await ctx.db.device.findFirst({ where: { id, userId } });
      if (!exists) throw AppError.notFound();
    }
    await ctx.db.refreshToken.updateMany({
      where: { deviceId: id, revokedAt: null },
      data: { revokedAt: now },
    });
    await audit(ctx.db, 'device_revoked', { userId, req, metadata: { deviceId: id } });
    res.status(204).end();
  });

  return router;
}
