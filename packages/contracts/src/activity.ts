import { z } from 'zod';
import { Id, Timestamp } from './common.js';
import { ActivityLabel, LabelSource } from './enums.js';
import { FocusSession } from './sessions.js';

/** Max events and body size per batch (ROADMAP 1.5). */
export const MAX_BATCH_EVENTS = 500;

const EventBase = z.object({
  clientEventId: Id,
  sessionId: Id,
});

export const SegmentEvent = EventBase.extend({
  type: z.literal('segment'),
  domain: z.string().min(1).max(260),
  title: z.string().max(500).optional(),
  startedAt: Timestamp,
  endedAt: Timestamp,
}).refine((e) => Date.parse(e.endedAt) >= Date.parse(e.startedAt), {
  message: 'endedAt must not be before startedAt',
  path: ['endedAt'],
});

export const BlockedAttemptEvent = EventBase.extend({
  type: z.literal('blocked_attempt'),
  domain: z.string().min(1).max(260),
  at: Timestamp,
});

export const HeartbeatEvent = EventBase.extend({
  type: z.literal('heartbeat'),
  at: Timestamp,
});

export const TrackerStateEvent = EventBase.extend({
  type: z.literal('tracker_state'),
  state: z.enum(['paused', 'resumed']),
  reason: z.string().max(60),
  at: Timestamp,
});

/** Sent by the extension after its last flush for a session; lets the server finalize early. */
export const FinalFlushEvent = EventBase.extend({
  type: z.literal('final_flush'),
  at: Timestamp,
  droppedEvents: z.number().int().min(0).default(0),
});

export const ActivityEvent = z.discriminatedUnion('type', [
  SegmentEvent,
  BlockedAttemptEvent,
  HeartbeatEvent,
  TrackerStateEvent,
  FinalFlushEvent,
]);
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/** Events are validated one by one so a single bad event doesn't reject the batch. */
export const ActivityBatchRequest = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_BATCH_EVENTS),
});

export const ActivityBatchResponse = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ clientEventId: z.string().nullable(), reason: z.string() })),
});
export type ActivityBatchResponse = z.infer<typeof ActivityBatchResponse>;

export const ActivitySegment = z.object({
  id: Id,
  host: z.string(),
  registrableDomain: z.string(),
  title: z.string().nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  durationSec: z.number().int(),
  blockId: Id.nullable(),
  label: ActivityLabel.nullable(),
  confidence: z.number().nullable(),
  labelSource: LabelSource.nullable(),
  explanation: z.string().nullable(),
});
export type ActivitySegment = z.infer<typeof ActivitySegment>;

export const RelabelRequest = z.object({
  label: z.enum(['PLANNED', 'UNPLANNED_RELEVANT', 'DISTRACTION', 'UNCERTAIN']),
  applyToFuture: z.boolean().default(false),
});

export const DeleteActivityQuery = z
  .object({ from: Timestamp, to: Timestamp })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), {
    message: '"to" must be after "from"',
    path: ['to'],
  });

// --- Extension state sync ---

export const ExtensionSettings = z.object({
  trackingEnabled: z.boolean(),
  titleCollectionEnabled: z.boolean(),
  widgetEnabled: z.boolean(),
  neverTrack: z.array(z.string()),
  sensitiveDomains: z.array(z.string()),
});
export type ExtensionSettings = z.infer<typeof ExtensionSettings>;

export const ExtensionStateResponse = z.object({
  serverNow: Timestamp,
  session: FocusSession.nullable(),
  settings: ExtensionSettings,
  minSupportedVersion: z.string(),
});
export type ExtensionStateResponse = z.infer<typeof ExtensionStateResponse>;
