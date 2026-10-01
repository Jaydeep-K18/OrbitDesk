import { z } from 'zod';
import { Id, Timestamp } from './common.js';
import { BlockKind, SessionStatus, TaskCategory } from './enums.js';
import { DomainInput } from './tasks-domains.js';

export const SessionBlock = z.object({
  id: Id,
  idx: z.number().int(),
  kind: BlockKind,
  startsAt: Timestamp,
  endsAt: Timestamp,
  title: z.string().nullable(),
});
export type SessionBlock = z.infer<typeof SessionBlock>;

export const SessionTask = z.object({
  id: Id,
  taskId: Id.nullable(),
  title: z.string(),
  category: TaskCategory,
  blockId: Id.nullable(),
  completedAt: Timestamp.nullable(),
});
export type SessionTask = z.infer<typeof SessionTask>;

export const FocusSession = z.object({
  id: Id,
  status: SessionStatus,
  startsAt: Timestamp,
  endsAt: Timestamp,
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  endReason: z.string().nullable(),
  plannedDurationMin: z.number().int(),
  blockDuringBreaks: z.boolean(),
  version: z.number().int(),
  blocks: z.array(SessionBlock),
  tasks: z.array(SessionTask),
  blockedDomains: z.array(z.string()),
  relevantDomains: z.array(z.string()),
  planId: Id.nullable(),
  createdAt: Timestamp,
});
export type FocusSession = z.infer<typeof FocusSession>;

export const CreateSessionRequest = z
  .object({
    startMode: z.enum(['now', 'at']),
    startsAt: Timestamp.optional(),
    durationMin: z.number().int().min(5).max(480),
    taskIds: z.array(Id).max(20).default([]),
    blockedDomains: z.array(DomainInput).max(100).default([]),
    relevantDomains: z.array(DomainInput).max(100).default([]),
    blockDuringBreaks: z.boolean().optional(),
  })
  .refine((v) => v.startMode === 'now' || v.startsAt !== undefined, {
    message: 'startsAt is required when startMode is "at"',
    path: ['startsAt'],
  });
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/** Optimistic concurrency: mutations carry the version the client last saw. */
export const VersionedRequest = z.object({ expectedVersion: z.number().int().min(1) });

export const EndSessionRequest = VersionedRequest.extend({
  confirm: z.literal(true),
  reason: z.string().trim().max(200).optional(),
});

export const ExtendSessionRequest = VersionedRequest.extend({
  minutes: z.number().int().min(5).max(60),
});

export const UpdateSessionTaskRequest = z.object({ completed: z.boolean() });

export const AddSessionDomainRequest = z.object({
  domain: DomainInput,
  kind: z.enum(['blocked', 'relevant']),
});

export const ListSessionsQuery = z.object({
  status: SessionStatus.optional(),
  from: Timestamp.optional(),
  to: Timestamp.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ActiveSessionResponse = z.object({
  serverNow: Timestamp,
  session: FocusSession.nullable(),
});
export type ActiveSessionResponse = z.infer<typeof ActiveSessionResponse>;
