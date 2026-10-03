/**
 * Extension controller: state sync, DNR rules, alarms, badge, tracking and uploads.
 * Every entry point re-reads state from storage, so a freshly woken service worker
 * behaves exactly like one that never slept (ROADMAP 1.4/1.5).
 */
import type { ActivityBatchResponse, ExtensionStateResponse } from '@focusguard/contracts';
import { uuidv7 } from '@focusguard/domain/ids';
import {
  buildRules,
  rulesHash,
  urlIsBlocked,
  type DnrRule,
  RULE_ID_MIN,
  RULE_ID_MAX,
} from '../core/rules';
import {
  badgeText,
  inBreak,
  isTracking,
  liveStatus,
  serverNowMs,
  shouldBlock,
  syncPeriodMinutes,
  transitionTimes,
  type StoredState,
} from '../core/state';
import { Tracker, type TrackerInput, type SegmentEvent } from '../core/tracker';
import { ack, enqueue, failed, shouldFlushNow, takeBatch, type QueuedEvent } from '../core/queue';
import { ApiError, NotPairedError, isPaired, request } from './api';
import { getLocal, getSession, setLocal, setSession, withLock } from './storage';

export const ALARMS = {
  sync: 'fg-sync',
  transition: 'fg-transition',
  tick: 'fg-tick',
  flush: 'fg-flush',
} as const;

const BLOCKED_DEDUPE_MS = 10_000;

// --- Sync --------------------------------------------------------------------

/** Fetches /extension/state (ETag-aware) and reconciles. Safe to call any time. */
export async function syncNow(): Promise<void> {
  if (!(await isPaired())) {
    await reconcile();
    return;
  }
  try {
    const prev = await getLocal('fg:state');
    const res = await request<ExtensionStateResponse>('/extension/state', {
      ifNoneMatch: prev.etag,
    });
    if (res.status === 200 && res.data) {
      const next: StoredState = {
        state: res.data,
        offsetMs: Date.parse(res.data.serverNow) - Date.now(),
        etag: res.etag,
        syncedAt: Date.now(),
      };
      await setLocal('fg:state', next);
    } else {
      await setLocal('fg:state', { ...prev, syncedAt: Date.now() });
    }
  } catch (err) {
    if (!(err instanceof NotPairedError))
      console.warn('[FocusGuard] sync failed, using cached state', err);
  }
  await reconcile();
}

/** Device revoked or account deleted: never leave the user stuck blocked. */
export async function handleUnpaired(): Promise<void> {
  await setLocal('fg:state', { state: null, offsetMs: 0, etag: null, syncedAt: Date.now() });
  await reconcile();
}

// --- Reconcile -----------------------------------------------------------------

/** Brings rules, alarms, badge and tracker in line with cached state and the corrected clock. */
export async function reconcile(): Promise<void> {
  const needsFeed = await withLock(async () => {
    const stored = await getLocal('fg:state');
    const now = serverNowMs(stored.offsetMs);
    const session = stored.state?.session ?? null;

    // 1. Blocking rules (computed locally, so they flip on time even offline).
    const blocking = shouldBlock(session, now);
    const rules: DnrRule[] =
      blocking && session
        ? buildRules(session.blockedDomains, session.relevantDomains, session.id)
        : [];
    const hash = rulesHash(rules);
    const prevHash = await getLocal('fg:rulesHash');
    if (hash !== prevHash) {
      await applyRules(rules);
      await setLocal('fg:rulesHash', hash);
      if (rules.length > 0 && session)
        await redirectOpenTabs(session.blockedDomains, session.relevantDomains);
    }

    // 2. Alarms: next transition (local clock = server time − offset), sync cadence, ticks.
    await browser.alarms.clear(ALARMS.transition);
    const next = session ? transitionTimes(session, now)[0] : undefined;
    if (next !== undefined)
      await browser.alarms.create(ALARMS.transition, { when: next - stored.offsetMs + 500 });
    const period = syncPeriodMinutes(session, now);
    const existing = await browser.alarms.get(ALARMS.sync);
    if (!existing || existing.periodInMinutes !== period) {
      await browser.alarms.create(ALARMS.sync, { periodInMinutes: period, delayInMinutes: period });
    }
    const active = session && liveStatus(session, now) === 'ACTIVE';
    if (active && !(await browser.alarms.get(ALARMS.tick))) {
      await browser.alarms.create(ALARMS.tick, { periodInMinutes: 0.5 });
    } else if (!active) {
      await browser.alarms.clear(ALARMS.tick);
    }

    // 3. Badge fallback for pages where the widget can't render.
    await browser.action.setBadgeText({ text: badgeText(session, now) });
    await browser.action.setBadgeBackgroundColor({
      color: session && inBreak(session, now) ? '#0ea5e9' : '#4f46e5',
    });

    // 4. Tracker lifecycle.
    return reconcileTracker(stored, now);
  });
  // Outside the lock: feeding the tracker takes the lock itself.
  if (needsFeed) await feedActiveTab();
}

async function applyRules(rules: DnrRule[]) {
  const current = await browser.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = current
    .map((r) => r.id)
    .filter((id) => id >= RULE_ID_MIN && id <= RULE_ID_MAX);
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules as unknown as Parameters<
      typeof browser.declarativeNetRequest.updateDynamicRules
    >[0]['addRules'],
  });
}

/** Tabs already open on a blocked site are redirected when blocking starts. */
async function redirectOpenTabs(blocked: string[], relevant: string[]) {
  const tabs = await browser.tabs.query({});
  const state = await getLocal('fg:state');
  const sessionId = state.state?.session?.id ?? '';
  for (const tab of tabs) {
    const domain = urlIsBlocked(tab.url, blocked, relevant);
    if (domain && tab.id !== undefined) {
      const url = browser.runtime.getURL(
        `/blocked.html?d=${encodeURIComponent(domain)}&s=${encodeURIComponent(sessionId)}`,
      );
      try {
        await browser.tabs.update(tab.id, { url });
      } catch {
        /* tab closed meanwhile */
      }
    }
  }
}

// --- Tracking --------------------------------------------------------------------

function trackerConfig(stored: StoredState) {
  const st = stored.state!;
  return {
    sessionId: st.session!.id,
    collectTitles: st.settings.titleCollectionEnabled,
    sensitiveDomains: st.settings.sensitiveDomains,
    neverTrack: st.settings.neverTrack,
  };
}

/** Returns true when a new session started being tracked and the active tab should be fed. */
async function reconcileTracker(stored: StoredState, now: number): Promise<boolean> {
  const data = await getSession('fg:tracker');
  const tracking = isTracking(stored.state, now);
  const session = stored.state?.session ?? null;

  // Session over (or tracking switched off): close the span and send the final flush once.
  if (data.sessionId && (!tracking || data.sessionId !== session?.id)) {
    const endAt =
      session && session.id === data.sessionId
        ? Math.min(now, Date.parse(session.endedAt ?? session.endsAt))
        : now;
    const tracker = new Tracker(
      { sessionId: data.sessionId, collectTitles: false, sensitiveDomains: [], neverTrack: [] },
      data.open,
    );
    const closed = tracker.handle({ type: 'stop', at: endAt });
    const finalized = await getLocal('fg:finalized');
    const ended =
      !session || session.id !== data.sessionId || liveStatus(session, now) !== 'ACTIVE';
    const events: QueuedEvent[] = [...closed];
    if (ended && !finalized.includes(data.sessionId)) {
      const q = await getLocal('fg:queue');
      events.push({
        type: 'final_flush',
        clientEventId: uuidv7(),
        sessionId: data.sessionId,
        at: new Date(endAt).toISOString(),
        droppedEvents: q.dropped,
      });
      await setLocal('fg:finalized', [...finalized.slice(-20), data.sessionId]);
    }
    await pushEvents(events);
    await setSession('fg:tracker', { sessionId: null, open: null, lastSeenAt: null });
    void flush(true);
  }

  if (tracking && session) {
    const cur = await getSession('fg:tracker');
    if (cur.sessionId !== session.id) {
      await setSession('fg:tracker', { sessionId: session.id, open: null, lastSeenAt: Date.now() });
      return true;
    }
  }
  return false;
}

async function pushEvents(events: QueuedEvent[] | SegmentEvent[]) {
  if (events.length === 0) return;
  const q = await getLocal('fg:queue');
  await setLocal('fg:queue', enqueue(q, events as QueuedEvent[]));
}

/** Feed a browser event into the tracker (no-op unless a session is being tracked). */
export async function track(input: TrackerInput): Promise<void> {
  await withLock(async () => {
    const stored = await getLocal('fg:state');
    const data = await getSession('fg:tracker');
    if (!data.sessionId || !isTracking(stored.state, serverNowMs(stored.offsetMs))) return;
    const tracker = new Tracker(trackerConfig(stored), data.open);
    const closed = tracker.handle(input);
    await pushEvents(closed);
    await setSession('fg:tracker', { ...data, open: tracker.open, lastSeenAt: Date.now() });
  });
}

/** Re-reads the focused window's active tab (after focus changes, idle → active, wake). */
export async function feedActiveTab(): Promise<void> {
  let win: { focused?: boolean; id?: number } | null = null;
  try {
    win = await browser.windows.getLastFocused();
  } catch {
    win = null;
  }
  if (!win || !win.focused) {
    await track({ type: 'blur', at: Date.now() });
    return;
  }
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  if (tab?.id !== undefined)
    await track({ type: 'focus', at: Date.now(), tabId: tab.id, url: tab.url, title: tab.title });
}

/** 30-second tick: heartbeat, sleep recovery, badge refresh. */
export async function tick(): Promise<void> {
  await withLock(async () => {
    const stored = await getLocal('fg:state');
    const data = await getSession('fg:tracker');
    const now = Date.now();
    if (data.sessionId && isTracking(stored.state, serverNowMs(stored.offsetMs))) {
      const tracker = new Tracker(trackerConfig(stored), data.open);
      // Laptop slept / worker died: close the span at the last heartbeat instead of inflating it.
      const recovered = tracker.recover(data.lastSeenAt, now);
      await pushEvents([
        ...recovered,
        {
          type: 'heartbeat',
          clientEventId: uuidv7(),
          sessionId: data.sessionId,
          at: new Date(now).toISOString(),
        },
      ]);
      await setSession('fg:tracker', { ...data, open: tracker.open, lastSeenAt: now });
    }
  });
  if ((await getSession('fg:tracker')).open === null) await feedActiveTab();
  await reconcile();
}

// --- Blocked attempts -------------------------------------------------------------

export async function recordBlockedAttempt(domain: string, sessionId: string): Promise<void> {
  await withLock(async () => {
    const last = await getSession('fg:lastBlocked');
    const now = Date.now();
    const key = `${sessionId}|${domain}`;
    const prev = last[key];
    await setSession('fg:lastBlocked', { ...last, [key]: now });
    if (prev !== undefined && now - prev < BLOCKED_DEDUPE_MS) return; // reload loop
    const stored = await getLocal('fg:state');
    await pushEvents([
      {
        type: 'blocked_attempt',
        clientEventId: uuidv7(),
        sessionId,
        domain,
        at: new Date(serverNowMs(stored.offsetMs, now)).toISOString(),
      },
    ]);
  });
  await flush(true); // blocked attempts go out immediately (live dashboard counter)
}

// --- Upload -------------------------------------------------------------------------

let flushing = false;
/** Sends queued events in batches; failures back off exponentially (offline-safe). */
export async function flush(urgent = false): Promise<void> {
  if (flushing || !(await isPaired())) return;
  flushing = true;
  try {
    for (let i = 0; i < 20; i++) {
      const q = await getLocal('fg:queue');
      if (!shouldFlushNow(q, Date.now(), urgent || i > 0)) return;
      const batch = takeBatch(q);
      try {
        const res = await request<ActivityBatchResponse>('/activity/batch', {
          method: 'POST',
          body: { events: batch },
        });
        if (res.data && res.data.rejected.length)
          console.warn('[FocusGuard] events rejected', res.data.rejected);
        await withLock(async () => {
          const cur = await getLocal('fg:queue');
          await setLocal('fg:queue', ack(cur, new Set(batch.map((e) => e.clientEventId))));
        });
      } catch (err) {
        // 4xx other than auth means the batch itself is bad: drop it rather than retry forever.
        const permanent =
          err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
        await withLock(async () => {
          const cur = await getLocal('fg:queue');
          await setLocal(
            'fg:queue',
            permanent
              ? {
                  ...ack(cur, new Set(batch.map((e) => e.clientEventId))),
                  dropped: cur.dropped + batch.length,
                }
              : failed(cur, Date.now()),
          );
        });
        return;
      }
    }
  } finally {
    flushing = false;
  }
}
