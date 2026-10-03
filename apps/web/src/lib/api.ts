import type { AuthResponse, Problem } from '@focusguard/contracts';

/** Error thrown for non-2xx responses, carrying the RFC 9457 problem document. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Partial<Problem>,
  ) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
  get code() {
    return this.problem.code;
  }
  /** Field errors keyed by path, for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

type Listener = (token: string | null) => void;

/**
 * Access token lives in memory only (ADR-004). The refresh token is an HttpOnly cookie the
 * browser sends to /api/v1/auth/refresh; parallel 401s share a single refresh call.
 */
class TokenStore {
  private token: string | null = null;
  private listeners = new Set<Listener>();
  get(): string | null {
    return this.token;
  }
  set(token: string | null) {
    this.token = token;
    for (const l of this.listeners) l(token);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const tokens = new TokenStore();
const BASE = '/api/v1';
let refreshing: Promise<AuthResponse | null> | null = null;

/** Single-flight refresh. Returns null when the session is gone. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-FG-CSRF': '1' },
      });
      if (!res.ok) {
        tokens.set(null);
        return null;
      }
      const body = (await res.json()) as AuthResponse;
      tokens.set(body.accessToken);
      return body;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Cookie-authenticated endpoints (logout) need the CSRF header. */
  csrf?: boolean;
  signal?: AbortSignal;
}

async function raw(path: string, opts: RequestOptions, retry: boolean): Promise<Response> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = tokens.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.csrf) headers['X-FG-CSRF'] = '1';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (res.status === 401 && retry && token) {
    const refreshed = await refreshSession();
    if (refreshed) return raw(path, opts, false);
  }
  return res;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await raw(path, opts, true);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data ?? {}) as Partial<Problem>);
  return data as T;
}
