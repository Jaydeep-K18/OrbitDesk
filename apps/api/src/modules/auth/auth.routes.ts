import { Router, type Request, type Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  TokenRequest,
  type AuthResponse,
} from '@focusguard/contracts';
import type { User as UserRow } from '@prisma/client';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { toUser } from '../../http/mappers.js';
import {
  clearRefreshCookie,
  limiter,
  readRefreshCookie,
  requireCsrf,
  setRefreshCookie,
} from '../../http/security.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../auth/passwords.js';
import {
  familyOf,
  issueRefreshToken,
  revokeAllWebSessions,
  revokeFamily,
  rotateRefreshToken,
} from '../../auth/refresh.js';
import { requireUser, userOf } from '../../auth/middleware.js';
import { hashToken, randomToken } from '../../auth/tokens.js';
import { audit } from '../../infra/audit.js';

const HOUR = 3_600_000;
const VERIFY_TTL_MS = 24 * HOUR;
const RESET_TTL_MS = 30 * 60_000;

async function issueWebSession(
  ctx: AppContext,
  req: Request,
  res: Response,
  user: UserRow,
): Promise<AuthResponse> {
  const refresh = await issueRefreshToken(ctx, {
    userId: user.id,
    userAgent: req.get('user-agent'),
  });
  setRefreshCookie(ctx, res, refresh.token, refresh.expiresAt);
  const accessToken = await ctx.tokens.sign({
    sub: user.id,
    aud: 'web',
    sid: refresh.familyId,
    scope: [],
  });
  return { accessToken, expiresIn: ctx.tokens.accessTtlSec, user: toUser(user) };
}

async function createEmailToken(
  ctx: AppContext,
  userId: string,
  purpose: 'verify' | 'reset',
): Promise<string> {
  const token = randomToken();
  await ctx.db.emailToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(
        ctx.clock.now().getTime() + (purpose === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS),
      ),
    },
  });
  return token;
}

async function consumeEmailToken(ctx: AppContext, token: string, purpose: 'verify' | 'reset') {
  const now = ctx.clock.now();
  const row = await ctx.db.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= now) {
    throw new AppError(400, 'TOKEN_INVALID', 'Link invalid or expired');
  }
  const updated = await ctx.db.emailToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (updated.count !== 1) throw new AppError(400, 'TOKEN_INVALID', 'Link invalid or expired');
  return row;
}

async function sendVerificationEmail(ctx: AppContext, user: UserRow) {
  const token = await createEmailToken(ctx, user.id, 'verify');
  await ctx.mailer.send({
    to: user.email,
    subject: 'Verify your FocusGuard email',
    text: `Hi ${user.displayName},\n\nConfirm your email: ${ctx.config.appOrigin}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const auth = requireUser(ctx);
  const csrf = requireCsrf(ctx);

  router.post('/auth/register', limiter(ctx, { windowMs: 60_000, limit: 3 }), async (req, res) => {
    const body = parse(RegisterRequest, req.body);
    const existing = await ctx.db.user.findUnique({ where: { email: body.email } });
    if (existing)
      throw AppError.conflict('EMAIL_TAKEN', 'Email already registered', 'Try logging in instead.');
    const user = await ctx.db.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        timezone: body.timezone,
        settings: { create: {} },
      },
    });
    await sendVerificationEmail(ctx, user);
    await audit(ctx.db, 'register', { userId: user.id, req });
    res.status(201).json(await issueWebSession(ctx, req, res, user));
  });

  router.post('/auth/verify-email', async (req, res) => {
    const { token } = parse(TokenRequest, req.body);
    const row = await consumeEmailToken(ctx, token, 'verify');
    await ctx.db.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: ctx.clock.now() },
    });
    await audit(ctx.db, 'email_verified', { userId: row.userId, req });
    res.json({ verified: true });
  });

  router.post(
    '/auth/resend-verification',
    auth,
    limiter(ctx, { windowMs: HOUR, limit: 3, keyGenerator: (req) => req.user?.userId ?? 'anon' }),
    async (req, res) => {
      const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userOf(req).userId } });
      if (!user.emailVerifiedAt) await sendVerificationEmail(ctx, user);
      res.status(202).json({ sent: !user.emailVerifiedAt });
    },
  );

  router.post(
    '/auth/login',
    limiter(ctx, {
      windowMs: 60_000,
      limit: 5,
      keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip ?? '')}:${String((req.body as { email?: unknown })?.email ?? '').toLowerCase()}`,
    }),
    async (req, res) => {
      const body = parse(LoginRequest, req.body);
      const user = await ctx.db.user.findUnique({ where: { email: body.email } });
      if (!user) {
        await burnPasswordCheck(body.password);
        await audit(ctx.db, 'login_failed', { req, metadata: { reason: 'unknown_email' } });
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) {
        await audit(ctx.db, 'login_failed', {
          userId: user.id,
          req,
          metadata: { reason: 'bad_password' },
        });
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      await audit(ctx.db, 'login', { userId: user.id, req });
      res.json(await issueWebSession(ctx, req, res, user));
    },
  );

  router.post('/auth/refresh', csrf, async (req, res) => {
    const presented = readRefreshCookie(ctx, req);
    if (!presented) throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
    let rotated;
    try {
      rotated = await rotateRefreshToken(ctx, presented, 'web', req);
    } catch (err) {
      clearRefreshCookie(ctx, res);
      throw err;
    }
    const user = await ctx.db.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw new AppError(401, 'TOKEN_INVALID', 'Session expired');
    setRefreshCookie(ctx, res, rotated.token, rotated.expiresAt);
    const accessToken = await ctx.tokens.sign({
      sub: user.id,
      aud: 'web',
      sid: rotated.familyId,
      scope: [],
    });
    res.json({
      accessToken,
      expiresIn: ctx.tokens.accessTtlSec,
      user: toUser(user),
    } satisfies AuthResponse);
  });

  router.post('/auth/logout', csrf, async (req, res) => {
    const presented = readRefreshCookie(ctx, req);
    if (presented) {
      const familyId = await familyOf(ctx, presented);
      if (familyId) await revokeFamily(ctx, familyId);
    }
    clearRefreshCookie(ctx, res);
    res.status(204).end();
  });

  router.post('/auth/logout-all', auth, async (req, res) => {
    const { userId } = userOf(req);
    await revokeAllWebSessions(ctx, userId);
    await audit(ctx.db, 'logout_all', { userId, req });
    clearRefreshCookie(ctx, res);
    res.status(204).end();
  });

  router.post(
    '/auth/forgot-password',
    limiter(ctx, {
      windowMs: HOUR,
      limit: 3,
      keyGenerator: (req) => {
        const email = (req.body as { email?: unknown })?.email;
        return typeof email === 'string' ? email.toLowerCase() : ipKeyGenerator(req.ip ?? '');
      },
    }),
    async (req, res) => {
      const { email } = parse(ForgotPasswordRequest, req.body);
      const user = await ctx.db.user.findUnique({ where: { email } });
      if (user) {
        const token = await createEmailToken(ctx, user.id, 'reset');
        await ctx.mailer.send({
          to: user.email,
          subject: 'Reset your FocusGuard password',
          text: `Reset your password: ${ctx.config.appOrigin}/reset-password?token=${token}\n\nThis link expires in 30 minutes. If you didn't ask for this, ignore this email.`,
        });
      }
      // Same response whether or not the account exists (no enumeration).
      res.status(202).json({ sent: true });
    },
  );

  router.post('/auth/reset-password', async (req, res) => {
    const body = parse(ResetPasswordRequest, req.body);
    const row = await consumeEmailToken(ctx, body.token, 'reset');
    await ctx.db.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(body.password) },
    });
    await revokeAllWebSessions(ctx, row.userId);
    await audit(ctx.db, 'password_reset', { userId: row.userId, req });
    res.status(204).end();
  });

  return router;
}
