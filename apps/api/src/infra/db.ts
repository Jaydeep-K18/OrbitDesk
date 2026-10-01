import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

/** Cheap connectivity probe used by the readiness endpoint. */
export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
