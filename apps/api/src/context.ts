import type { Logger } from 'pino';
import type { Clock } from '@focusguard/domain';
import type { Db } from './infra/db.js';
import type { Mailer } from './infra/mailer.js';
import type { InProcessEventBus } from './infra/event-bus.js';
import type { TokenService } from './auth/tokens.js';

export interface AppConfig {
  appOrigin: string;
  appVersion: string;
  cookieSecure: boolean;
  refreshTtlDays: number;
  deviceRefreshTtlDays: number;
  finalizeGraceSec: number;
  minExtensionVersion: string;
  extensionOrigins: string[];
  /** Rate limits can be relaxed in tests; production uses the defaults. */
  rateLimits: { enabled: boolean };
}

/** Everything a request handler or job needs. Built once at startup (or per test). */
export interface AppContext {
  db: Db;
  logger: Logger;
  clock: Clock;
  mailer: Mailer;
  bus: InProcessEventBus;
  tokens: TokenService;
  config: AppConfig;
}

export const defaultConfig: AppConfig = {
  appOrigin: 'http://localhost:5173',
  appVersion: '0.1.0',
  cookieSecure: true,
  refreshTtlDays: 30,
  deviceRefreshTtlDays: 90,
  finalizeGraceSec: 120,
  minExtensionVersion: '0.1.0',
  extensionOrigins: [],
  rateLimits: { enabled: true },
};
