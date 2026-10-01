import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { ExtensionStateResponse } from '@focusguard/contracts';
import { SENSITIVE_CATEGORIES, hostsInCategories } from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { toSession } from '../../http/mappers.js';
import { deviceOf, requireDevice } from '../../auth/middleware.js';
import type { SessionsService } from '../sessions/sessions.service.js';

const SENSITIVE_HOSTS = hostsInCategories(SENSITIVE_CATEGORIES).sort();

/**
 * Extension sync endpoint (ROADMAP 1.4). Cheap to poll: an ETag over everything except
 * `serverNow` lets unchanged state answer 304 with no body.
 */
export function extensionRouter(ctx: AppContext, sessions: SessionsService): Router {
  const router = Router();

  router.get('/extension/state', requireDevice(ctx, 'session:read'), async (req, res) => {
    const { userId } = deviceOf(req);
    const now = ctx.clock.now();
    const [row, settings, neverTrack] = await Promise.all([
      sessions.activeRow(userId),
      ctx.db.userSettings.findUnique({ where: { userId } }),
      ctx.db.domainRule.findMany({
        where: { userId, list: 'never_track' },
        orderBy: { host: 'asc' },
      }),
    ]);
    const state: Omit<ExtensionStateResponse, 'serverNow'> = {
      session: row ? toSession(row, now) : null,
      settings: {
        trackingEnabled: settings?.trackingEnabled ?? true,
        titleCollectionEnabled: settings?.titleCollectionEnabled ?? false,
        widgetEnabled: settings?.widgetEnabled ?? true,
        neverTrack: neverTrack.map((r) => r.host),
        sensitiveDomains: SENSITIVE_HOSTS,
      },
      minSupportedVersion: ctx.config.minExtensionVersion,
    };
    const etag = `"${createHash('sha1').update(JSON.stringify(state)).digest('base64url')}"`;
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', etag);
    if (req.get('if-none-match') === etag) {
      res.status(304).end();
      return;
    }
    res.json({ serverNow: now.toISOString(), ...state } satisfies ExtensionStateResponse);
  });

  return router;
}
