import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { systemClock, uuidv7, type Clock } from '@focusguard/domain';
import { defaultConfig, type AppConfig, type AppContext } from './context.js';
import type { Db } from './infra/db.js';
import { InProcessEventBus, Events } from './infra/event-bus.js';
import { ConsoleMailer, type Mailer } from './infra/mailer.js';
import { TokenService } from './auth/tokens.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { meRouter } from './modules/me/me.routes.js';
import { devicesRouter } from './modules/devices/devices.routes.js';
import { tasksRouter } from './modules/tasks/tasks.routes.js';
import { domainsRouter } from './modules/domains/domains.routes.js';
import { SessionsService } from './modules/sessions/sessions.service.js';
import { sessionsRouter } from './modules/sessions/sessions.routes.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { ClassifierService } from './modules/activity/classifier.service.js';
import { ActivityService } from './modules/activity/activity.service.js';
import { activityRouter } from './modules/activity/activity.routes.js';
import { extensionRouter } from './modules/extension/extension.routes.js';
import { AnalyticsService } from './modules/analytics/analytics.service.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { LifecycleSweeper } from './jobs/lifecycle.js';

export interface ContextOptions {
  db: Db;
  logger: Logger;
  clock?: Clock;
  mailer?: Mailer;
  config?: Partial<AppConfig>;
  privateJwk?: string;
  jwtKid?: string;
  accessTtlSec?: number;
}

export async function createContext(opts: ContextOptions): Promise<AppContext> {
  const clock = opts.clock ?? systemClock;
  return {
    db: opts.db,
    logger: opts.logger,
    clock,
    mailer: opts.mailer ?? new ConsoleMailer(opts.logger),
    bus: new InProcessEventBus(opts.logger),
    tokens: await TokenService.create({
      privateJwk: opts.privateJwk,
      kid: opts.jwtKid ?? 'dev-1',
      ttlSec: opts.accessTtlSec ?? 900,
      clock,
    }),
    config: { ...defaultConfig, ...opts.config },
  };
}

export interface AppServices {
  sessions: SessionsService;
  reports: ReportsService;
  classifier: ClassifierService;
  activity: ActivityService;
  analytics: AnalyticsService;
  sweeper: LifecycleSweeper;
}

/** Allows the extension origin to call bearer-token endpoints (no cookies, no credentials). */
function extensionCors(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, If-None-Match, X-FG-Client',
      );
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
      res.set('Access-Control-Expose-Headers', 'ETag');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/** App factory: wires services, event subscriptions and routes without listening. */
export function createApp(ctx: AppContext): { app: Express; services: AppServices } {
  const sessions = new SessionsService(ctx);
  const reports = new ReportsService(ctx);
  const classifier = new ClassifierService(ctx);
  const activity = new ActivityService(ctx, reports);
  const analytics = new AnalyticsService(ctx, sessions);
  const sweeper = new LifecycleSweeper(ctx, reports);

  // Event subscriptions (in-process now; Kafka consumers in Phase 4).
  ctx.bus.subscribe(Events.ActivityIngested, async (e) => {
    if (e.sessionId) await classifier.classifySession(e.sessionId);
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : uuidv7();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use('/api', extensionCors(ctx.config.extensionOrigins));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const v1 = express.Router();
  v1.use(healthRouter({ db: ctx.db, clock: ctx.clock, version: ctx.config.appVersion }));
  v1.use(authRouter(ctx));
  v1.use(meRouter(ctx));
  v1.use(devicesRouter(ctx));
  v1.use(tasksRouter(ctx));
  v1.use(domainsRouter(ctx));
  v1.use(sessionsRouter(ctx, sessions));
  v1.use(activityRouter(ctx, activity, reports));
  v1.use(extensionRouter(ctx, sessions));
  v1.use(analyticsRouter(ctx, analytics, reports));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, services: { sessions, reports, classifier, activity, analytics, sweeper } };
}
