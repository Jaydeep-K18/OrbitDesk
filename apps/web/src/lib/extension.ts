/**
 * Bridge to the FocusGuard extension via `externally_connectable` (ROADMAP 1.4).
 * The extension only accepts messages from the dashboard origin.
 */
export const EXTENSION_ID: string =
  (import.meta.env.VITE_EXTENSION_ID as string | undefined) ?? 'dmfegmfpjfegcdhojmpbbghakajhgpec';

interface ChromeRuntime {
  sendMessage: (id: string, message: unknown, callback: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

function runtime(): ChromeRuntime | null {
  const chromeGlobal = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return chromeGlobal?.runtime?.sendMessage ? chromeGlobal.runtime : null;
}

export function sendToExtension<T = unknown>(
  message: unknown,
  timeoutMs = 1500,
): Promise<T | null> {
  const rt = runtime();
  if (!rt) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      rt.sendMessage(EXTENSION_ID, message, (response) => {
        clearTimeout(timer);
        resolve(rt.lastError ? null : ((response as T) ?? null));
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export type ExtensionStatus = 'not_installed' | 'not_paired' | 'connected';

export async function pingExtension(): Promise<ExtensionStatus> {
  const res = await sendToExtension<{ ok: boolean; paired: boolean }>({ type: 'PING' });
  if (!res?.ok) return 'not_installed';
  return res.paired ? 'connected' : 'not_paired';
}

export function pairExtension(code: string) {
  return sendToExtension<{ ok: boolean; error?: string }>({ type: 'PAIR', code }, 10_000);
}

/** Tells the extension to re-sync immediately after a session change (sub-second, no WebSocket). */
export function nudgeExtension() {
  void sendToExtension({ type: 'SESSION_CHANGED' }, 500);
}
