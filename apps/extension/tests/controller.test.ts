import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { ExtensionStateResponse, FocusSession } from '@focusguard/contracts';
import {
  flush,
  reconcile,
  recordBlockedAttempt,
  syncNow,
  handleUnpaired,
} from '../src/lib/controller';
import { setUnpairedHandler } from '../src/lib/api';
import { getLocal, getSession, setLocal, setSession } from '../src/lib/storage';

const T0 = Date.parse('2026-10-05T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: '0199a000-0000-7000-8000-000000000001',
    status: 'ACTIVE',
    startsAt: iso(T0),
    endsAt: iso(T0 + 3_600_000),
    startedAt: iso(T0),
    endedAt: null,
    endReason: null,
    plannedDurationMin: 60,
    blockDuringBreaks: false,
    version: 1,
    blocks: [
      {
        id: 'b0',
        idx: 0,
        kind: 'work',
        startsAt: iso(T0),
        endsAt: iso(T0 + 3_600_000),
        title: null,
      },
    ],
    tasks: [],
    blockedDomains: ['instagram.com'],
    relevantDomains: ['leetcode.com'],
    planId: null,
    createdAt: iso(T0),
    ...over,
  };
}

function stateResponse(s: FocusSession | null): ExtensionStateResponse {
  return {
    serverNow: iso(Date.now()),
    session: s,
    settings: {
      trackingEnabled: true,
      titleCollectionEnabled: false,
      widgetEnabled: true,
      neverTrack: [],
      sensitiveDomains: [],
    },
    minSupportedVersion: '0.1.0',
  };
}

let dynamicRules: { id: number }[] = [];
const updateDynamicRules = vi.fn(
  async ({ removeRuleIds, addRules }: { removeRuleIds: number[]; addRules: { id: number }[] }) => {
    dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
  },
);
const fetchMock = vi.fn();

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + 60_000);
  dynamicRules = [];
  updateDynamicRules.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(fakeBrowser.declarativeNetRequest, {
    getDynamicRules: vi.fn(async () => dynamicRules),
    updateDynamicRules,
  });
  Object.assign(fakeBrowser.runtime, {
    getManifest: () => ({ version: '0.1.0', manifest_version: 3, name: 'FocusGuard' }),
  });
  Object.assign(fakeBrowser.action, {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
  });
  setUnpairedHandler(handleUnpaired);
  await setLocal('fg:auth', { deviceId: 'dev-1', refreshToken: 'refresh-token-abcdef' });
  await setSession('fg:access', { token: 'access-token', expiresAt: Date.now() + 600_000 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('sync and blocking', () => {
  it('installs redirect rules for an active session and redirects already-open blocked tabs', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://www.instagram.com/explore' });
    const other = await fakeBrowser.tabs.create({ url: 'https://leetcode.com/' });
    fetchMock.mockResolvedValueOnce(json(200, stateResponse(session()), { ETag: '"v1"' }));
    await syncNow();
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    expect(dynamicRules.map((r) => r.id)).toEqual([1000, 1999]);
    expect((await fakeBrowser.tabs.get(tab.id!)).url).toMatch(/blocked\.html\?d=instagram\.com/);
    expect((await fakeBrowser.tabs.get(other.id!)).url).toBe('https://leetcode.com/');
    expect((await getLocal('fg:state')).etag).toBe('"v1"');
  });

  it('a 304 keeps cached state and does not re-apply identical rules', async () => {
    fetchMock.mockResolvedValueOnce(json(200, stateResponse(session()), { ETag: '"v1"' }));
    await syncNow();
    fetchMock.mockResolvedValueOnce(json(304, null));
    await syncNow();
    expect(fetchMock.mock.calls[1]![1].headers['If-None-Match']).toBe('"v1"');
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
  });

  it('removes rules at session end even while offline (local clock + cached state)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, stateResponse(session()), { ETag: '"v1"' }));
    await syncNow();
    expect(dynamicRules.length).toBeGreaterThan(0);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch')); // network down
    vi.setSystemTime(T0 + 3_600_000 + 1000);
    await syncNow();
    expect(dynamicRules).toEqual([]);
  });

  it('removes rules when the device is revoked (refresh returns 401)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, stateResponse(session()), { ETag: '"v1"' }));
    await syncNow();
    await setSession('fg:access', null); // access expired → refresh
    fetchMock.mockResolvedValueOnce(json(401, { code: 'TOKEN_INVALID' }));
    await syncNow();
    expect(await getLocal('fg:auth')).toBeNull();
    expect(dynamicRules).toEqual([]);
  });

  it('reconcile alone (fresh service worker) restores rules from cached state', async () => {
    await setLocal('fg:state', {
      state: stateResponse(session()),
      offsetMs: 0,
      etag: '"v1"',
      syncedAt: Date.now(),
    });
    await reconcile();
    expect(dynamicRules.map((r) => r.id)).toEqual([1000, 1999]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('blocked attempts and uploads', () => {
  beforeEach(async () => {
    await setLocal('fg:state', {
      state: stateResponse(session()),
      offsetMs: 0,
      etag: null,
      syncedAt: Date.now(),
    });
  });

  it('records a blocked attempt once per 10 s reload loop and uploads it immediately', async () => {
    fetchMock.mockResolvedValue(json(202, { accepted: 1, duplicates: 0, rejected: [] }));
    await recordBlockedAttempt('instagram.com', session().id);
    vi.setSystemTime(T0 + 63_000);
    await recordBlockedAttempt('instagram.com', session().id); // reload within 10 s
    const posts = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/activity/batch'));
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0]![1].body as string);
    expect(body.events[0]).toMatchObject({
      type: 'blocked_attempt',
      domain: 'instagram.com',
      sessionId: session().id,
    });
    expect((await getLocal('fg:queue')).events).toEqual([]);
  });

  it('backs off on network failure and keeps events for later', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await recordBlockedAttempt('instagram.com', session().id);
    const q = await getLocal('fg:queue');
    expect(q.events).toHaveLength(1);
    expect(q.failures).toBe(1);
    expect(q.nextAttemptAt).toBeGreaterThan(Date.now());
    fetchMock.mockReset();
    await flush(true); // still inside the backoff window: no request
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes the open span and sends a final flush once when the session ends', async () => {
    await setSession('fg:tracker', {
      sessionId: session().id,
      open: { domain: 'github.com', title: null, startedAt: T0 + 10_000, tabId: 1 },
      lastSeenAt: Date.now(),
    });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    vi.setSystemTime(T0 + 3_600_000 + 5_000);
    await reconcile();
    await reconcile(); // idempotent: no second final flush
    const q = await getLocal('fg:queue');
    const types = q.events.map((e) => e.type);
    expect(types).toEqual(['segment', 'final_flush']);
    expect(q.events[0]).toMatchObject({ domain: 'github.com', endedAt: iso(T0 + 3_600_000) });
    expect((await getSession('fg:tracker')).sessionId).toBeNull();
  });
});
