#!/usr/bin/env node
// Docker-free fallback: runs a real PostgreSQL 17 from portable binaries (embedded-postgres)
// with the same credentials as infra/docker-compose.yml. Data lives in .data/postgres.
//   pnpm db:dev          # start (Ctrl+C to stop)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databaseDir = path.join(root, '.data', 'postgres');
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'focusguard',
  password: 'focusguard',
  port,
  persistent: true,
  onLog: () => {},
});

const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
for (const name of ['focusguard']) {
  try {
    await pg.createDatabase(name);
  } catch {
    /* already exists */
  }
}
console.log(`PostgreSQL 17 running on localhost:${port} (user/pass: focusguard/focusguard)`);
console.log(`DATABASE_URL=postgresql://focusguard:focusguard@localhost:${port}/focusguard`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
