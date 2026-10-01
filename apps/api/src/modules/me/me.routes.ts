import { Router } from 'express';
import {
  ChangePasswordRequest,
  DeleteAccountRequest,
  UpdateProfileRequest,
  UpdateSettingsRequest,
} from '@focusguard/contracts';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { toSettings, toUser } from '../../http/mappers.js';
import { clearRefreshCookie } from '../../http/security.js';
import { requireUser, userOf } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/passwords.js';
import { revokeAllWebSessions } from '../../auth/refresh.js';
import { audit } from '../../infra/audit.js';

export function meRouter(ctx: AppContext): Router {
  const router = Router();
  router.use('/me', requireUser(ctx));

  router.get('/me', async (req, res) => {
    const user = await ctx.db.user.findUnique({ where: { id: userOf(req).userId } });
    if (!user) throw AppError.unauthenticated();
    res.json(toUser(user));
  });

  router.patch('/me', async (req, res) => {
    const body = parse(UpdateProfileRequest, req.body);
    const user = await ctx.db.user.update({ where: { id: userOf(req).userId }, data: body });
    res.json(toUser(user));
  });

  router.post('/me/change-password', async (req, res) => {
    const body = parse(ChangePasswordRequest, req.body);
    const { userId, sid } = userOf(req);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    await ctx.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    // Sign out every other browser session; keep the current one.
    await ctx.db.refreshToken.updateMany({
      where: { userId, deviceId: null, revokedAt: null, NOT: { familyId: sid } },
      data: { revokedAt: ctx.clock.now() },
    });
    await audit(ctx.db, 'password_changed', { userId, req });
    res.status(204).end();
  });

  router.delete('/me', async (req, res) => {
    const body = parse(DeleteAccountRequest, req.body);
    const { userId } = userOf(req);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Password is incorrect');
    }
    await revokeAllWebSessions(ctx, userId);
    // Cascades to settings, tokens, devices, tasks, sessions, activity, reports and stats.
    await ctx.db.user.delete({ where: { id: userId } });
    await audit(ctx.db, 'account_deleted', { req, metadata: { userId } });
    clearRefreshCookie(ctx, res);
    res.status(204).end();
  });

  router.get('/me/settings', async (req, res) => {
    const settings = await ctx.db.userSettings.upsert({
      where: { userId: userOf(req).userId },
      create: { userId: userOf(req).userId },
      update: {},
    });
    res.json(toSettings(settings));
  });

  router.patch('/me/settings', async (req, res) => {
    const body = parse(UpdateSettingsRequest, req.body);
    const userId = userOf(req).userId;
    const settings = await ctx.db.userSettings.upsert({
      where: { userId },
      create: { userId, ...body },
      update: body,
    });
    res.json(toSettings(settings));
  });

  return router;
}
