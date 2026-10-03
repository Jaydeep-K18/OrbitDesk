/**
 * MV3 service worker. All listeners are registered synchronously at startup (MV3 requirement);
 * all state lives in chrome.storage, so restarts are harmless (ROADMAP 1.4/1.5).
 */
import {
  ALARMS,
  feedActiveTab,
  flush,
  handleUnpaired,
  reconcile,
  recordBlockedAttempt,
  syncNow,
  tick,
  track,
} from '../lib/controller';
import { isPaired, pairWithCode, setUnpairedHandler } from '../lib/api';
import { DASHBOARD_ORIGINS } from '../lib/config';
import { getLocal, setLocal } from '../lib/storage';

type ExternalMessage =
  { type: 'PING' } | { type: 'PAIR'; code: string } | { type: 'SESSION_CHANGED' };
type InternalMessage =
  | { type: 'BLOCKED_ATTEMPT'; domain: string; sessionId: string }
  | { type: 'PAIR_CODE'; code: string }
  | { type: 'UNPAIR' }
  | { type: 'SYNC_NOW' }
  | { type: 'STATUS' };

function originOf(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}

export default defineBackground(() => {
  setUnpairedHandler(handleUnpaired);

  browser.runtime.onInstalled.addListener(() => void syncNow());
  browser.runtime.onStartup.addListener(() => void syncNow());
  browser.idle.setDetectionInterval(60);

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARMS.sync) void syncNow().then(() => flush());
    else if (alarm.name === ALARMS.transition) void reconcile().then(() => syncNow());
    else if (alarm.name === ALARMS.tick) void tick().then(() => flush());
    else if (alarm.name === ALARMS.flush) void flush();
  });
  void browser.alarms.create(ALARMS.flush, { periodInMinutes: 1 });

  // Messages from the FocusGuard dashboard (externally_connectable). The manifest already
  // restricts origins; we check again so a misconfigured manifest can't widen trust.
  browser.runtime.onMessageExternal.addListener((raw, sender, sendResponse) => {
    const origin = originOf(sender);
    if (!origin || !DASHBOARD_ORIGINS.includes(origin)) {
      sendResponse({ ok: false, error: 'origin not allowed' });
      return false;
    }
    const msg = raw as ExternalMessage;
    (async () => {
      switch (msg?.type) {
        case 'PING':
          return {
            ok: true,
            paired: await isPaired(),
            version: browser.runtime.getManifest().version,
          };
        case 'PAIR':
          await pairWithCode(String(msg.code));
          await syncNow();
          return { ok: true };
        case 'SESSION_CHANGED':
          await syncNow();
          return { ok: true };
        default:
          return { ok: false, error: 'unknown message' };
      }
    })()
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  });

  // Messages from our own pages (blocked page, options page, content script).
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const msg = raw as InternalMessage;
    (async () => {
      switch (msg?.type) {
        case 'BLOCKED_ATTEMPT':
          await recordBlockedAttempt(String(msg.domain), String(msg.sessionId));
          return { ok: true };
        case 'PAIR_CODE':
          await pairWithCode(String(msg.code));
          await syncNow();
          return { ok: true };
        case 'UNPAIR':
          await setLocal('fg:auth', null);
          await handleUnpaired();
          return { ok: true };
        case 'SYNC_NOW':
          await syncNow();
          return { ok: true };
        case 'STATUS': {
          const queue = await getLocal('fg:queue');
          return {
            ok: true,
            paired: await isPaired(),
            queued: queue.events.length,
            dropped: queue.dropped,
          };
        }
        default:
          return { ok: false };
      }
    })()
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  });

  // Toolbar click toggles the widget on the current tab (no popup by design).
  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined)
      void browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' }).catch(() => undefined);
  });

  // --- Activity tracking inputs (ROADMAP 1.5) ---
  browser.tabs.onActivated.addListener(() => void feedActiveTab());
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (tab.active && (change.url || change.title || change.status === 'complete')) {
      void track({ type: 'focus', at: Date.now(), tabId: tab.id!, url: tab.url, title: tab.title });
    }
  });
  browser.tabs.onRemoved.addListener(() => void feedActiveTab());
  browser.webNavigation.onHistoryStateUpdated.addListener((d) => {
    if (d.frameId === 0) void feedActiveTab();
  });
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) void track({ type: 'blur', at: Date.now() });
    else void feedActiveTab();
  });
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'active') void feedActiveTab();
    else void track({ type: 'blur', at: Date.now() });
  });

  // A freshly started worker reconciles from cached state immediately (rules never get stuck).
  void reconcile().then(() => syncNow());
});
