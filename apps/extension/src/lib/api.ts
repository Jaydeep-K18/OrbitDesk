import type { DeviceTokens } from '@focusguard/contracts';
import { API_BASE } from './config';
import { getLocal, getSession, setLocal, setSession } from './storage';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

export class NotPairedError extends Error {}

const version = () => browser.runtime.getManifest().version;

async function storeTokens(t: DeviceTokens) {
  await setLocal('fg:auth', { deviceId: t.deviceId, refreshToken: t.refreshToken });
  await setSession('fg:access', {
    token: t.accessToken,
    expiresAt: Date.now() + (t.expiresIn - 30) * 1000,
  });
}

/** Called when the device was revoked or tokens are unusable. Callers must remove rules. */
export let onUnpaired: () => Promise<void> = async () => {};
export function setUnpairedHandler(fn: () => Promise<void>) {
  onUnpaired = fn;
}

let refreshing: Promise<string> | null = null;
async function refreshAccess(): Promise<string> {
  refreshing ??= (async () => {
    const auth = await getLocal('fg:auth');
    if (!auth) throw new NotPairedError();
    const res = await fetch(`${API_BASE}/devices/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FG-Client': `extension/${version()}` },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (res.status === 401) {
      await setLocal('fg:auth', null);
      await setSession('fg:access', null);
      await onUnpaired();
      throw new NotPairedError();
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
    const tokens = (await res.json()) as DeviceTokens;
    await storeTokens(tokens);
    return tokens.accessToken;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function accessToken(): Promise<string> {
  const access = await getSession('fg:access');
  if (access && access.expiresAt > Date.now()) return access.token;
  return refreshAccess();
}

export interface ApiResponse<T> {
  status: number;
  data: T | null;
  etag: string | null;
}

/** Authenticated request with one transparent token refresh on 401. */
export async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; ifNoneMatch?: string | null } = {},
): Promise<ApiResponse<T>> {
  const send = async (token: string) =>
    fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-FG-Client': `extension/${version()}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.ifNoneMatch ? { 'If-None-Match': opts.ifNoneMatch } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await send(await accessToken());
  if (res.status === 401) res = await send(await refreshAccess());
  if (res.status === 304) return { status: 304, data: null, etag: opts.ifNoneMatch ?? null };
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ''));
  return { status: res.status, data: (await res.json()) as T, etag: res.headers.get('ETag') };
}

/** Exchanges a one-time pairing code for device tokens (ROADMAP 1.4 pairing flow). */
export async function pairWithCode(code: string): Promise<void> {
  const name = `Chrome on ${navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Mac') ? 'macOS' : 'Linux'}`;
  const res = await fetch(`${API_BASE}/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FG-Client': `extension/${version()}` },
    body: JSON.stringify({ code, type: 'extension', name, version: version() }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new Error(body.detail ?? body.title ?? `Pairing failed (${res.status})`);
  }
  await storeTokens((await res.json()) as DeviceTokens);
}

export async function isPaired(): Promise<boolean> {
  return (await getLocal('fg:auth')) !== null;
}
