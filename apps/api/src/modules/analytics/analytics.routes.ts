import { Router } from 'express';
import { z } from 'zod';
import { AnalyticsRangeQuery } from '@focusguard/contracts';
import type { AppContext } from '../../context.js';
import { parse, uuidParam } from '../../http/validate.js';
import { requireUser, userOf } from '../../auth/middleware.js';
import type { AnalyticsService } from './analytics.service.js';
import type { ReportsService } from '../reports/reports.service.js';

const RangeOnly = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.to >= q.from, { message: '"to" must not be before "from"', path: ['to'] });

export function analyticsRouter(
  ctx: AppContext,
  analytics: AnalyticsService,
  reports: ReportsService,
): Router {
  const router = Router();
  const user = requireUser(ctx);

  router.get('/sessions/:id/report', user, async (req, res) => {
    res.json(await reports.getReport(userOf(req).userId, uuidParam(req.params.id)));
  });

  router.get('/dashboard/summary', user, async (req, res) => {
    res.json(await analytics.summary(userOf(req).userId));
  });

  router.get('/analytics/overview', user, async (req, res) => {
    res.json(await analytics.overview(userOf(req).userId, parse(AnalyticsRangeQuery, req.query)));
  });

  router.get('/analytics/domains', user, async (req, res) => {
    const q = parse(
      RangeOnly.and(z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) })),
      req.query,
    );
    res.json(await analytics.domains(userOf(req).userId, q));
  });

  router.get('/analytics/heatmap', user, async (req, res) => {
    res.json(await analytics.heatmap(userOf(req).userId, parse(RangeOnly, req.query)));
  });

  router.get('/analytics/sessions-stats', user, async (req, res) => {
    res.json(await analytics.sessionsStats(userOf(req).userId, parse(RangeOnly, req.query)));
  });

  return router;
}
