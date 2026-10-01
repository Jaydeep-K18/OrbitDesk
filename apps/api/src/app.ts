import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { systemClock, uuidv7, type Clock } from '@focusguard/domain';
import type { Db } from './infra/db.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './modules/health/health.routes.js';

export interface AppDeps {
  db: Db;
  logger: Logger;
  clock?: Clock;
  version?: string;
}

/** App factory: builds a fully wired Express app without listening (testable with Supertest). */
export function createApp(deps: AppDeps): Express {
  const clock = deps.clock ?? systemClock;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : uuidv7();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  const v1 = express.Router();
  v1.use(healthRouter({ db: deps.db, clock, version: deps.version ?? '0.0.0' }));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
