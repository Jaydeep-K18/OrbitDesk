import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadApiEnv } from './config/env.js';
import { createLogger } from './infra/logger.js';
import { createDb } from './infra/db.js';
import { createApp } from './app.js';

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
  const app = createApp({ db, logger, version: env.APP_VERSION });
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'FocusGuard API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    const force = setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(async () => {
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
