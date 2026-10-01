import { z } from 'zod';
import { Id, Timestamp } from './common.js';
import { DomainListType, TaskCategory, TaskStatus } from './enums.js';

export const Task = z.object({
  id: Id,
  title: z.string(),
  notes: z.string().nullable(),
  category: TaskCategory,
  status: TaskStatus,
  estimateMin: z.number().int().nullable(),
  dueDate: z.string().nullable(),
  tags: z.array(z.string()),
  completedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Task = z.infer<typeof Task>;

export const CreateTaskRequest = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).nullish(),
  category: TaskCategory.default('other'),
  estimateMin: z.number().int().min(1).max(1440).nullish(),
  dueDate: z.iso.date().nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = z
  .object({
    title: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(2000).nullable(),
    category: TaskCategory,
    status: TaskStatus,
    estimateMin: z.number().int().min(1).max(1440).nullable(),
    dueDate: z.iso.date().nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const ListTasksQuery = z.object({
  status: TaskStatus.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** A domain as typed by the user; normalized server-side. */
export const DomainInput = z.string().trim().min(1).max(260);

export const DomainRule = z.object({
  id: Id,
  host: z.string(),
  list: DomainListType,
  scope: z.string(),
  createdAt: Timestamp,
});
export type DomainRule = z.infer<typeof DomainRule>;

export const CreateDomainRuleRequest = z.object({
  domain: DomainInput,
  list: DomainListType,
  /** '*' (all tasks) or a task category, used by "apply to future" relabel overrides. */
  scope: z.union([z.literal('*'), TaskCategory]).default('*'),
});

export const DomainPresetId = z.enum(['social', 'streaming', 'news', 'shopping', 'gaming']);
export type DomainPresetId = z.infer<typeof DomainPresetId>;

export const DomainCategoryLookup = z.object({
  host: z.string(),
  registrableDomain: z.string(),
  category: z.string().nullable(),
});
