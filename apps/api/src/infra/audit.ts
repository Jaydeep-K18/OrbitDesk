import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import type { Db } from './db.js';

export type AuditEvent =
  | 'register'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'refresh_token_reuse'
  | 'password_changed'
  | 'password_reset'
  | 'email_verified'
  | 'account_deleted'
  | 'device_paired'
  | 'device_revoked'
  | 'session_blocked_domain_removed'
  | 'activity_deleted';

/** IPs are stored only as salted-free short hashes (enough to correlate, not to identify). */
function ipHash(ip: string | undefined): string | null {
  return ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : null;
}

export async function audit(
  db: Db,
  event: AuditEvent,
  opts: { userId?: string | null; req?: Request; metadata?: Prisma.InputJsonValue } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      event,
      userId: opts.userId ?? null,
      ipHash: ipHash(opts.req?.ip),
      userAgent: opts.req?.get('user-agent')?.slice(0, 200) ?? null,
      metadata: opts.metadata ?? undefined,
    },
  });
}
