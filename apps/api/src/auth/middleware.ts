import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { DeviceScope } from '@focusguard/contracts';
import type { AppContext } from '../context.js';
import { AppError } from '../http/errors.js';

export interface AuthUser {
  userId: string;
  sid: string;
}

export interface AuthDevice {
  userId: string;
  deviceId: string;
  deviceType: 'extension' | 'collector';
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      device?: AuthDevice;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Requires a web-audience access token (the dashboard). */
export function requireUser(ctx: AppContext): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(AppError.unauthenticated());
    try {
      const claims = await ctx.tokens.verify(token, ['web']);
      req.user = { userId: claims.sub, sid: claims.sid };
      next();
    } catch {
      next(AppError.unauthenticated('Access token invalid or expired'));
    }
  };
}

/**
 * Requires a device token (extension/collector) carrying `scope`. The device must still exist
 * and not be revoked, so revocation takes effect immediately rather than at token expiry.
 */
export function requireDevice(ctx: AppContext, scope: DeviceScope): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(AppError.unauthenticated());
    let claims;
    try {
      claims = await ctx.tokens.verify(token, ['extension', 'collector']);
    } catch {
      return next(AppError.unauthenticated('Access token invalid or expired'));
    }
    if (!claims.scope.includes(scope)) {
      return next(new AppError(403, 'FORBIDDEN', undefined, `Token lacks scope ${scope}`));
    }
    const device = await ctx.db.device.findUnique({ where: { id: claims.sid } });
    if (!device || device.revokedAt || device.userId !== claims.sub) {
      return next(AppError.unauthenticated('Device revoked'));
    }
    req.device = {
      userId: device.userId,
      deviceId: device.id,
      deviceType: device.type,
      scopes: device.scopes,
    };
    const now = ctx.clock.now();
    if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > 60_000) {
      await ctx.db.device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    }
    next();
  };
}

/** Narrowing helpers for handlers behind the middleware. */
export function userOf(req: Request): AuthUser {
  if (!req.user) throw AppError.unauthenticated();
  return req.user;
}

export function deviceOf(req: Request): AuthDevice {
  if (!req.device) throw AppError.unauthenticated();
  return req.device;
}
