import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { E2E } from './env.mjs';

/** Fresh E2E database with all migrations, every run. */
export default async function globalSetup() {
  const url = new URL(E2E.databaseUrl);
  const name = url.pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to reset non-E2E database ${name}`);
  const admin = new URL(E2E.databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, DATABASE_URL: E2E.databaseUrl },
    stdio: 'pipe',
  });
}
