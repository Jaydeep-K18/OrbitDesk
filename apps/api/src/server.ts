import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadApiEnv } from './config/env.js';
import { createLogger } from './infra/logger.js';
import { createDb } from './infra/db.js';
import { ConsoleMailer, SmtpMailer } from './infra/mailer.js';
import { createApp, createContext } from './app.js';

/** Loads the repo-root .env in local development; containers inject real env vars instead. */
function loadLocalEnvFile() {
  // src/server.ts and dist/server.js are both three levels below the repo root.
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

async function main() {
  loadLocalEnvFile();
  const env = loadApiEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const db = createDb(env.DATABASE_URL);
  const ctx = await createContext({
    db,
    logger,
    mailer: env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) : new ConsoleMailer(logger),
    privateJwk: env.JWT_PRIVATE_JWK,
    jwtKid: env.JWT_KID,
    accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
    config: {
      appOrigin: env.APP_ORIGIN,
      appVersion: env.APP_VERSION,
      cookieSecure: env.COOKIE_SECURE,
      refreshTtlDays: env.REFRESH_TTL_DAYS,
      deviceRefreshTtlDays: env.DEVICE_REFRESH_TTL_DAYS,
      finalizeGraceSec: env.FINALIZE_GRACE_SEC,
      minExtensionVersion: env.MIN_EXTENSION_VERSION,
      extensionOrigins: env.EXTENSION_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  });
  if (!env.JWT_PRIVATE_JWK)
    logger.warn('JWT_PRIVATE_JWK not set: using an ephemeral signing key (development only)');

  const { app, services } = createApp(ctx);
  const server = createServer(app);
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'FocusGuard API listening');
  });
  services.sweeper.start(env.LIFECYCLE_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    services.sweeper.stop();
    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(async () => {
      await ctx.bus.idle();
      await db.$disconnect();
      logger.info('shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
