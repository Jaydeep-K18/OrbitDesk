import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DEFAULT_TEST_URL = 'postgresql://focusguard:focusguard@localhost:5432/focusguard_test';

/**
 * Creates a fresh test database and applies all migrations once per run.
 * Requires a reachable Postgres (docker compose, CI service container, or `pnpm db:dev`).
 */
export default async function globalSetup() {
  const testUrl = process.env.DATABASE_URL_TEST ?? DEFAULT_TEST_URL;
  process.env.DATABASE_URL_TEST = testUrl;
  const url = new URL(testUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset non-test database "${dbName}"`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
