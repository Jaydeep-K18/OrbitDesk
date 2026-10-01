import { Router } from 'express';
import { z } from 'zod';
import { CreateDomainRuleRequest, DomainListType, DomainPresetId } from '@focusguard/contracts';
import { lookupDomainCategory, normalizeDomain } from '@focusguard/domain';
import type { AppContext } from '../../context.js';
import { AppError } from '../../http/errors.js';
import { parse, uuidParam } from '../../http/validate.js';
import { toDomainRule } from '../../http/mappers.js';
import { requireUser, userOf } from '../../auth/middleware.js';

/** One-click block-list packs (ROADMAP 1.2). */
export const DOMAIN_PRESETS: Record<z.infer<typeof DomainPresetId>, string[]> = {
  social: [
    'instagram.com',
    'facebook.com',
    'x.com',
    'twitter.com',
    'tiktok.com',
    'reddit.com',
    'snapchat.com',
    'pinterest.com',
    'threads.net',
  ],
  streaming: [
    'netflix.com',
    'primevideo.com',
    'hotstar.com',
    'jiocinema.com',
    'disneyplus.com',
    'hulu.com',
    'twitch.tv',
    'crunchyroll.com',
  ],
  news: [
    'news.google.com',
    'cnn.com',
    'bbc.com',
    'nytimes.com',
    'theguardian.com',
    'ndtv.com',
    'indiatimes.com',
    'hindustantimes.com',
  ],
  shopping: [
    'amazon.com',
    'amazon.in',
    'flipkart.com',
    'myntra.com',
    'ajio.com',
    'meesho.com',
    'ebay.com',
    'aliexpress.com',
  ],
  gaming: [
    'store.steampowered.com',
    'epicgames.com',
    'roblox.com',
    'chess.com',
    'poki.com',
    'crazygames.com',
    'miniclip.com',
  ],
};

/** Normalizes a user-typed domain or throws a 422 pointing at `path`. */
export function normalizeOrThrow(input: string, path: string): string {
  const n = normalizeDomain(input);
  if (!n)
    throw AppError.validation([{ path, message: `"${input}" is not a valid website domain` }]);
  return n.host;
}

export function domainsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(['/domain-rules', '/domain-categories'], requireUser(ctx));

  router.get('/domain-rules', async (req, res) => {
    const { list } = parse(z.object({ list: DomainListType.optional() }), req.query);
    const rules = await ctx.db.domainRule.findMany({
      where: { userId: userOf(req).userId, ...(list ? { list } : {}) },
      orderBy: [{ list: 'asc' }, { host: 'asc' }],
    });
    res.json({ items: rules.map(toDomainRule) });
  });

  router.post('/domain-rules', async (req, res) => {
    const body = parse(CreateDomainRuleRequest, req.body);
    const host = normalizeOrThrow(body.domain, 'domain');
    const { userId } = userOf(req);
    if (body.scope === '*' && (body.list === 'blocked' || body.list === 'relevant')) {
      const opposite = body.list === 'blocked' ? 'relevant' : 'blocked';
      const clash = await ctx.db.domainRule.findFirst({
        where: { userId, host, list: opposite, scope: '*' },
      });
      if (clash) {
        throw new AppError(
          422,
          'DOMAIN_LIST_CONFLICT',
          'Domain list conflict',
          `${host} is already in your ${opposite} list.`,
        );
      }
    }
    const rule = await ctx.db.domainRule.upsert({
      where: { userId_host_list_scope: { userId, host, list: body.list, scope: body.scope } },
      create: { userId, host, list: body.list, scope: body.scope },
      update: {},
    });
    res.status(201).json(toDomainRule(rule));
  });

  router.delete('/domain-rules/:id', async (req, res) => {
    const deleted = await ctx.db.domainRule.deleteMany({
      where: { id: uuidParam(req.params.id), userId: userOf(req).userId },
    });
    if (deleted.count === 0) throw AppError.notFound();
    res.status(204).end();
  });

  router.post('/domain-rules/presets/:presetId', async (req, res) => {
    const presetId = parse(DomainPresetId, req.params.presetId);
    const { userId } = userOf(req);
    const relevant = new Set(
      (await ctx.db.domainRule.findMany({ where: { userId, list: 'relevant', scope: '*' } })).map(
        (r) => r.host,
      ),
    );
    const hosts = DOMAIN_PRESETS[presetId].filter((h) => !relevant.has(h));
    await ctx.db.domainRule.createMany({
      data: hosts.map((host) => ({ userId, host, list: 'blocked' as const, scope: '*' })),
      skipDuplicates: true,
    });
    const rules = await ctx.db.domainRule.findMany({
      where: { userId, list: 'blocked' },
      orderBy: { host: 'asc' },
    });
    res.status(201).json({
      items: rules.map(toDomainRule),
      added: hosts.length,
      skipped: DOMAIN_PRESETS[presetId].length - hosts.length,
    });
  });

  router.get('/domain-categories', async (req, res) => {
    const { host: input } = parse(z.object({ host: z.string().min(1).max(260) }), req.query);
    const n = normalizeDomain(input);
    if (!n) throw AppError.validation([{ path: 'host', message: 'Not a valid domain' }]);
    const dbHit = await ctx.db.domainCategory.findUnique({ where: { host: n.host } });
    res.json({
      host: n.host,
      registrableDomain: n.registrableDomain,
      category: dbHit?.category ?? lookupDomainCategory(n.host),
    });
  });

  return router;
}
