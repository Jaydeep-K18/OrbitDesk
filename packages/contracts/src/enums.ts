import { z } from 'zod';

export const TaskCategory = z.enum([
  'coding_practice',
  'study',
  'project_dev',
  'writing',
  'research',
  'other',
]);
export type TaskCategory = z.infer<typeof TaskCategory>;

export const TaskStatus = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const DomainListType = z.enum(['blocked', 'relevant', 'never_track', 'always_distraction']);
export type DomainListType = z.infer<typeof DomainListType>;

export const SessionStatus = z.enum([
  'SCHEDULED',
  'ACTIVE',
  'COMPLETED',
  'ENDED_EARLY',
  'CANCELLED',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const BlockKind = z.enum(['work', 'break']);
export type BlockKind = z.infer<typeof BlockKind>;

/** Final activity labels (ROADMAP §7.3). AMBIGUOUS is internal to the rule engine only. */
export const ActivityLabel = z.enum([
  'PLANNED',
  'UNPLANNED_RELEVANT',
  'DISTRACTION',
  'BLOCKED',
  'UNCERTAIN',
]);
export type ActivityLabel = z.infer<typeof ActivityLabel>;

export const LabelSource = z.enum([
  'session_list',
  'user_override',
  'rule',
  'llm',
  'ml',
  'user_feedback',
]);
export type LabelSource = z.infer<typeof LabelSource>;

export const DeviceType = z.enum(['extension', 'collector']);
export type DeviceType = z.infer<typeof DeviceType>;

export const DeviceScope = z.enum(['session:read', 'activity:write', 'network:write']);
export type DeviceScope = z.infer<typeof DeviceScope>;

export const TokenAudience = z.enum(['web', 'extension', 'collector']);
export type TokenAudience = z.infer<typeof TokenAudience>;
