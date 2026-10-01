// MV3 service worker (Phase 0 skeleton). Phase 1.4 adds pairing, state sync,
// declarativeNetRequest rules, alarms and the tracker.
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    console.warn(`[FocusGuard] installed (${reason}), extension id ${browser.runtime.id}`);
  });
});
