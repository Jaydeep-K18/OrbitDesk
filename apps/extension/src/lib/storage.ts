/**
 * Typed wrappers over chrome.storage. The MV3 service worker is stateless across restarts,
 * so everything durable lives here (ROADMAP 1.4).
 *  - local:   survives browser restarts (auth, cached state, queue, widget prefs)
 *  - session: cleared when the browser closes (access token, open tracker span)
 */
import type { Span } from '../core/tracker';
import { emptyQueue, type QueueState } from '../core/queue';
import { emptyState, type StoredState } from '../core/state';

export interface AuthData {
  deviceId: string;
  refreshToken: string;
}
export interface AccessData {
  token: string;
  expiresAt: number;
}
export interface TrackerData {
  sessionId: string | null;
  open: Span | null;
  lastSeenAt: number | null;
}
export interface WidgetPrefs {
  expanded: boolean;
  y: number;
}

interface LocalSchema {
  'fg:auth': AuthData | null;
  'fg:state': StoredState;
  'fg:rulesHash': string;
  'fg:queue': QueueState;
  'fg:widget': WidgetPrefs;
  'fg:finalized': string[];
}
interface SessionSchema {
  'fg:access': AccessData | null;
  'fg:tracker': TrackerData;
  'fg:lastBlocked': Record<string, number>;
}

const localDefaults: LocalSchema = {
  'fg:auth': null,
  'fg:state': emptyState,
  'fg:rulesHash': '',
  'fg:queue': emptyQueue(),
  'fg:widget': { expanded: false, y: 0.4 },
  'fg:finalized': [],
};
const sessionDefaults: SessionSchema = {
  'fg:access': null,
  'fg:tracker': { sessionId: null, open: null, lastSeenAt: null },
  'fg:lastBlocked': {},
};

export async function getLocal<K extends keyof LocalSchema>(key: K): Promise<LocalSchema[K]> {
  const res = await browser.storage.local.get(key);
  return (res[key] as LocalSchema[K] | undefined) ?? localDefaults[key];
}
export async function setLocal<K extends keyof LocalSchema>(
  key: K,
  value: LocalSchema[K],
): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}
export async function getSession<K extends keyof SessionSchema>(key: K): Promise<SessionSchema[K]> {
  const res = await browser.storage.session.get(key);
  return (res[key] as SessionSchema[K] | undefined) ?? sessionDefaults[key];
}
export async function setSession<K extends keyof SessionSchema>(
  key: K,
  value: SessionSchema[K],
): Promise<void> {
  await browser.storage.session.set({ [key]: value });
}

let chain: Promise<unknown> = Promise.resolve();
/** Serializes read-modify-write sequences (service-worker events can interleave). */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
