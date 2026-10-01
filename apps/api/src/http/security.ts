import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import type { AppContext } from '../context.js';
import { AppError } from './errors.js';

/** `__Host-` cookies require Secure; local HTTP tests use a plain name. */
export function refreshCookieName(ctx: AppContext): string {
  return ctx.config.cookieSecure ? '__Host-fg_rt' : 'fg_rt';
}

function cookieOptions(ctx: AppContext, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}

export function setRefreshCookie(ctx: AppContext, res: Response, token: string, expiresAt: Date) {
  res.cookie(
    refreshCookieName(ctx),
    token,
    cookieOptions(ctx, expiresAt.getTime() - ctx.clock.now().getTime()),
  );
}

export function clearRefreshCookie(ctx: AppContext, res: Response) {
  res.clearCookie(refreshCookieName(ctx), cookieOptions(ctx));
}

export function readRefreshCookie(ctx: AppContext, req: Request): string | null {
  const value = (req.cookies as Record<string, string> | undefined)?.[refreshCookieName(ctx)];
  return typeof value === 'string' && value.length >= 16 ? value : null;
}

/**
 * CSRF defence for cookie-authenticated endpoints (refresh, logout): require a custom header
 * (cannot be sent cross-site without CORS preflight) and, when present, a matching Origin.
 */
export function requireCsrf(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    if (req.get('x-fg-csrf') !== '1') {
      return next(new AppError(403, 'FORBIDDEN', 'CSRF check failed', 'Missing X-FG-CSRF header'));
    }
    const origin = req.get('origin');
    if (origin && origin !== ctx.config.appOrigin) {
      return next(new AppError(403, 'FORBIDDEN', 'CSRF check failed', 'Origin not allowed'));
    }
    next();
  };
}

/** Rate limiter that answers with a 429 problem document. No-op when disabled (tests). */
export function limiter(
  ctx: AppContext,
  opts: Partial<Options> & { windowMs: number; limit: number },
): RequestHandler {
  if (!ctx.config.rateLimits.enabled) return (_req, _res, next) => next();
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...opts,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', undefined, 'Too many requests, slow down')),
  });
}
