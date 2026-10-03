import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FocusSession } from '@focusguard/contracts';
import { buildRules, rulesHash, urlIsBlocked, RULE_ID_MIN, RULE_ID_MAX } from '../src/core/rules';
import {
  badgeText,
  inBreak,
  shouldBlock,
  syncPeriodMinutes,
  transitionTimes,
  isTracking,
} from '../src/core/state';
import { Tracker, trackableHost, HEARTBEAT_GRACE_MS, type TrackerInput } from '../src/core/tracker';
import {
  ack,
  backoffMs,
  emptyQueue,
  enqueue,
  failed,
  shouldFlushNow,
  takeBatch,
} from '../src/core/queue';
import { clampY, widgetView } from '../src/core/widget-model';

const T0 = Date.parse('2026-10-05T09:00:00.000Z');
const min = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: '0199a000-0000-7000-8000-000000000001',
    status: 'ACTIVE',
    startsAt: iso(T0),
    endsAt: iso(T0 + min(60)),
    startedAt: iso(T0),
    endedAt: null,
    endReason: null,
    plannedDurationMin: 60,
    blockDuringBreaks: false,
    version: 1,
    blocks: [
      { id: 'b0', idx: 0, kind: 'work', startsAt: iso(T0), endsAt: iso(T0 + min(60)), title: null },
    ],
    tasks: [],
    blockedDomains: ['instagram.com', 'reddit.com'],
    relevantDomains: ['leetcode.com'],
    planId: null,
    createdAt: iso(T0),
    ...over,
  };
}

describe('DNR rule builder', () => {
  it('redirects main frames of blocked domains (and their subdomains) to blocked.html', () => {
    const rules = buildRules(['reddit.com', 'instagram.com'], [], 'sess-1');
    const main = rules.filter((r) => r.action.type === 'redirect');
    expect(main.map((r) => r.condition.requestDomains[0])).toEqual(['instagram.com', 'reddit.com']);
    expect(main[0]).toEqual({
      id: RULE_ID_MIN,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: '/blocked.html?d=instagram.com&s=sess-1' },
      },
      condition: { requestDomains: ['instagram.com'], resourceTypes: ['main_frame'] },
    });
    const sub = rules.find((r) => r.action.type === 'block')!;
    expect(sub.condition).toEqual({
      requestDomains: ['instagram.com', 'reddit.com'],
      resourceTypes: ['sub_frame'],
    });
    expect(rules.every((r) => r.id >= RULE_ID_MIN && r.id <= RULE_ID_MAX)).toBe(true);
  });

  it('adds a higher-priority allow rule for a relevant subdomain of a blocked domain', () => {
    const rules = buildRules(['google.com'], ['docs.google.com', 'leetcode.com'], 's');
    const allow = rules.filter((r) => r.action.type === 'allow');
    expect(allow).toHaveLength(1);
    expect(allow[0]).toMatchObject({
      priority: 2,
      condition: { requestDomains: ['docs.google.com'] },
    });
  });

  it('builds nothing without blocked domains, dedupes, and hashes stably', () => {
    expect(buildRules([], ['a.com'], 's')).toEqual([]);
    const a = buildRules(['b.com', 'a.com', 'a.com'], [], 's');
    const b = buildRules(['a.com', 'b.com'], [], 's');
    expect(rulesHash(a)).toBe(rulesHash(b));
    expect(rulesHash(a)).not.toBe(rulesHash(buildRules(['a.com'], [], 's')));
  });

  it('decides which already-open tabs to redirect', () => {
    expect(urlIsBlocked('https://m.instagram.com/reel/1', ['instagram.com'], [])).toBe(
      'instagram.com',
    );
    expect(urlIsBlocked('https://www.reddit.com/', ['reddit.com'], [])).toBe('reddit.com');
    expect(urlIsBlocked('https://notinstagram.com/', ['instagram.com'], [])).toBeNull();
    expect(
      urlIsBlocked('https://docs.google.com/x', ['google.com'], ['docs.google.com']),
    ).toBeNull();
    expect(urlIsBlocked('chrome://extensions', ['instagram.com'], [])).toBeNull();
    expect(urlIsBlocked(undefined, ['instagram.com'], [])).toBeNull();
  });
});

describe('session state decisions (offline-capable)', () => {
  const multi = session({
    endsAt: iso(T0 + min(60)),
    blocks: [
      { id: 'w1', idx: 0, kind: 'work', startsAt: iso(T0), endsAt: iso(T0 + min(25)), title: null },
      {
        id: 'br',
        idx: 1,
        kind: 'break',
        startsAt: iso(T0 + min(25)),
        endsAt: iso(T0 + min(35)),
        title: null,
      },
      {
        id: 'w2',
        idx: 2,
        kind: 'work',
        startsAt: iso(T0 + min(35)),
        endsAt: iso(T0 + min(60)),
        title: null,
      },
    ],
  });

  it('blocks only during work blocks of an active session', () => {
    expect(shouldBlock(multi, T0 + min(10))).toBe(true);
    expect(shouldBlock(multi, T0 + min(30))).toBe(false);
    expect(shouldBlock({ ...multi, blockDuringBreaks: true }, T0 + min(30))).toBe(true);
    expect(shouldBlock(multi, T0 + min(61))).toBe(false); // ended by the clock even if never synced
    expect(
      shouldBlock(session({ status: 'ENDED_EARLY', endedAt: iso(T0 + min(5)) }), T0 + min(10)),
    ).toBe(false);
    expect(shouldBlock(null, T0)).toBe(false);
    expect(inBreak(multi, T0 + min(30))).toBe(true);
  });

  it('lists the future transition instants for alarms', () => {
    expect(transitionTimes(multi, T0 + min(1))).toEqual([T0 + min(25), T0 + min(35), T0 + min(60)]);
    expect(transitionTimes(multi, T0 + min(61))).toEqual([]);
  });

  it('formats badge text and picks sync cadence', () => {
    expect(badgeText(session(), T0 + min(18))).toBe('42m');
    expect(badgeText(session({ endsAt: iso(T0 + min(150)) }), T0)).toBe('2h');
    expect(badgeText(session(), T0 + min(61))).toBe('');
    expect(syncPeriodMinutes(session(), T0)).toBe(0.5);
    expect(
      syncPeriodMinutes(
        session({ status: 'SCHEDULED', startsAt: iso(T0 + min(5)), startedAt: null }),
        T0,
      ),
    ).toBe(0.5);
    expect(
      syncPeriodMinutes(
        session({ status: 'SCHEDULED', startsAt: iso(T0 + min(60)), startedAt: null }),
        T0,
      ),
    ).toBe(5);
    expect(syncPeriodMinutes(null, T0)).toBe(5);
  });

  it('tracks only active sessions with tracking enabled', () => {
    const settings = {
      trackingEnabled: true,
      titleCollectionEnabled: false,
      widgetEnabled: true,
      neverTrack: [],
      sensitiveDomains: [],
    };
    const st = { serverNow: iso(T0), session: session(), settings, minSupportedVersion: '0.1.0' };
    expect(isTracking(st, T0 + min(1))).toBe(true);
    expect(
      isTracking({ ...st, settings: { ...settings, trackingEnabled: false } }, T0 + min(1)),
    ).toBe(false);
    expect(isTracking(st, T0 + min(70))).toBe(false);
  });
});

describe('Tracker (focus spans)', () => {
  const cfg = {
    sessionId: 'sess',
    collectTitles: false,
    sensitiveDomains: ['mail.google.com'],
    neverTrack: ['mybank.com'],
  };
  const focus = (at: number, url: string, tabId = 1, title?: string): TrackerInput => ({
    type: 'focus',
    at,
    url,
    tabId,
    title,
  });

  it('emits a segment when the domain changes or the browser loses focus', () => {
    const t = new Tracker(cfg);
    expect(t.handle(focus(T0, 'https://leetcode.com/problems/x'))).toEqual([]);
    const out = t.handle(focus(T0 + 60_000, 'https://www.youtube.com/watch?v=1'));
    expect(out).toEqual([
      expect.objectContaining({
        type: 'segment',
        sessionId: 'sess',
        domain: 'leetcode.com',
        startedAt: iso(T0),
        endedAt: iso(T0 + 60_000),
      }),
    ]);
    expect(out[0]).not.toHaveProperty('title');
    const blurred = t.handle({ type: 'blur', at: T0 + 90_000 });
    expect(blurred[0]).toMatchObject({ domain: 'youtube.com' });
    expect(t.open).toBeNull();
  });

  it('ignores same-domain navigation, chrome:// pages and never-track sites', () => {
    const t = new Tracker(cfg);
    t.handle(focus(T0, 'https://github.com/a'));
    expect(t.handle(focus(T0 + 5000, 'https://github.com/b'))).toEqual([]);
    expect(t.handle(focus(T0 + 10_000, 'chrome://newtab'))).toHaveLength(1); // closes github
    expect(t.open).toBeNull();
    t.handle(focus(T0 + 20_000, 'https://netbanking.mybank.com/'));
    expect(t.open).toBeNull();
    expect(trackableHost('file:///C:/x.pdf')).toBeNull();
    expect(trackableHost('http://localhost:5173/')).toBe('localhost');
  });

  it('collects titles only when enabled and never for sensitive sites; debounces SPA flicker', () => {
    const t = new Tracker({ ...cfg, collectTitles: true });
    t.handle(focus(T0, 'https://www.youtube.com/watch?v=1', 1, 'Binary Search - LeetCode 704'));
    // Title flickers within 2 s: same span, title updated.
    expect(
      t.handle(
        focus(T0 + 500, 'https://www.youtube.com/watch?v=1', 1, '(1) Binary Search - LeetCode 704'),
      ),
    ).toEqual([]);
    // A real title change later splits the span (new video).
    const split = t.handle(
      focus(T0 + 30_000, 'https://www.youtube.com/watch?v=2', 1, 'Funny cats'),
    );
    expect(split[0]).toMatchObject({
      domain: 'youtube.com',
      title: '(1) Binary Search - LeetCode 704',
    });
    t.handle(
      focus(T0 + 60_000, 'https://mail.google.com/mail/u/0', 1, 'Inbox (3) - me@example.com'),
    );
    const mail = t.handle({ type: 'blur', at: T0 + 90_000 });
    expect(mail[0]).toMatchObject({ domain: 'mail.google.com' });
    expect(mail[0]).not.toHaveProperty('title');
  });

  it('switching tabs on the same domain starts a new span (different tab)', () => {
    const t = new Tracker(cfg);
    t.handle(focus(T0, 'https://github.com/a', 1));
    expect(t.handle(focus(T0 + 10_000, 'https://github.com/b', 2))).toHaveLength(1);
  });

  it('drops sub-second spans', () => {
    const t = new Tracker(cfg);
    t.handle(focus(T0, 'https://a.com/'));
    expect(t.handle(focus(T0 + 300, 'https://b.com/'))).toEqual([]);
  });

  it('recovers after sleep by closing the span at the last heartbeat', () => {
    const t = new Tracker(cfg, { domain: 'github.com', title: null, startedAt: T0, tabId: 1 });
    expect(t.recover(T0 + 60_000, T0 + 60_000 + HEARTBEAT_GRACE_MS - 1)).toEqual([]);
    const out = t.recover(T0 + 60_000, T0 + min(45)); // laptop slept 44 minutes
    expect(out[0]).toMatchObject({ domain: 'github.com', endedAt: iso(T0 + 60_000) });
    expect(t.open).toBeNull();
  });

  it('property: emitted segments never overlap and never exceed elapsed time', () => {
    const hosts = [
      'https://a.com/',
      'https://b.com/x',
      'https://c.org/',
      'chrome://newtab',
      'https://mybank.com/',
    ];
    const input = fc.array(
      fc.record({
        dt: fc.integer({ min: 0, max: 120_000 }),
        kind: fc.constantFrom('focus', 'blur'),
        url: fc.constantFrom(...hosts),
        tab: fc.integer({ min: 1, max: 3 }),
      }),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(input, (steps) => {
        const t = new Tracker(cfg);
        let now = T0;
        const segs = [];
        for (const s of steps) {
          now += s.dt;
          segs.push(
            ...t.handle(s.kind === 'focus' ? focus(now, s.url, s.tab) : { type: 'blur', at: now }),
          );
        }
        segs.push(...t.handle({ type: 'stop', at: now }));
        let total = 0;
        for (let i = 0; i < segs.length; i++) {
          const a = Date.parse(segs[i]!.startedAt);
          const b = Date.parse(segs[i]!.endedAt);
          expect(b).toBeGreaterThan(a);
          if (i > 0) expect(a).toBeGreaterThanOrEqual(Date.parse(segs[i - 1]!.endedAt));
          total += b - a;
        }
        expect(total).toBeLessThanOrEqual(now - T0);
      }),
    );
  });
});

describe('offline queue', () => {
  const ev = (i: number) => ({ clientEventId: `id-${i}`, type: 'heartbeat' });

  it('caps the queue, dropping the oldest and counting drops', () => {
    let q = emptyQueue();
    q = enqueue(
      q,
      Array.from({ length: 8 }, (_, i) => ev(i)),
      5,
    );
    expect(q.events.map((e) => e.clientEventId)).toEqual(['id-3', 'id-4', 'id-5', 'id-6', 'id-7']);
    expect(q.dropped).toBe(3);
  });

  it('batches, acks and backs off exponentially with jitter bounds', () => {
    let q = enqueue(
      emptyQueue(),
      Array.from({ length: 7 }, (_, i) => ev(i)),
    );
    expect(takeBatch(q, 3).map((e) => e.clientEventId)).toEqual(['id-0', 'id-1', 'id-2']);
    q = ack(q, new Set(['id-0', 'id-1']));
    expect(q.events).toHaveLength(5);
    q = failed(q, 1000, 0.5);
    expect(q.failures).toBe(1);
    expect(q.nextAttemptAt).toBe(1000 + 4000);
    expect(shouldFlushNow(q, 2000, true)).toBe(false); // still backing off
    expect(shouldFlushNow(q, 6000, true)).toBe(true);
    expect(shouldFlushNow(q, 6000, false)).toBe(false); // below the 100-event threshold
    expect(backoffMs(20, 0.5)).toBe(300_000); // capped at 5 minutes
  });
});

describe('widget view model', () => {
  const settings = {
    trackingEnabled: true,
    titleCollectionEnabled: false,
    widgetEnabled: true,
    neverTrack: [],
    sensitiveDomains: [],
  };
  const stored = (s: FocusSession | null, enabled = true) => ({
    state: {
      serverNow: iso(T0),
      session: s,
      settings: { ...settings, widgetEnabled: enabled },
      minSupportedVersion: '0.1.0',
    },
    offsetMs: 0,
    etag: null,
    syncedAt: T0,
  });

  it('shows only the remaining time when expanded; hidden otherwise', () => {
    const at = T0 + min(17) + 43_000;
    const v = widgetView(
      stored(session()),
      { expanded: true },
      { localNowMs: at, fullscreen: false, completedAt: null },
    );
    expect(v).toMatchObject({
      mode: 'expanded',
      remainingLabel: '42:17',
      inBreak: false,
      ariaLabel: 'FocusGuard: 43 minutes remaining',
    });
    expect(
      widgetView(
        stored(session()),
        { expanded: false },
        { localNowMs: at, fullscreen: false, completedAt: null },
      ).mode,
    ).toBe('collapsed');
    expect(
      widgetView(
        stored(null),
        { expanded: true },
        { localNowMs: at, fullscreen: false, completedAt: null },
      ).mode,
    ).toBe('hidden');
    expect(
      widgetView(
        stored(session(), false),
        { expanded: true },
        { localNowMs: at, fullscreen: false, completedAt: null },
      ).mode,
    ).toBe('hidden');
    expect(
      widgetView(
        stored(session()),
        { expanded: true },
        { localNowMs: at, fullscreen: true, completedAt: null },
      ).mode,
    ).toBe('hidden');
  });

  it('uses the server clock offset, and shows "complete" for 5 s after the session ends', () => {
    const s = { ...stored(session()), offsetMs: min(10) }; // client clock is 10 minutes slow
    expect(
      widgetView(s, { expanded: true }, { localNowMs: T0, fullscreen: false, completedAt: null })
        .remainingLabel,
    ).toBe('50:00');
    const ended = stored(session());
    expect(
      widgetView(
        ended,
        { expanded: true },
        { localNowMs: T0 + min(61), fullscreen: false, completedAt: T0 + min(61) - 2000 },
      ).mode,
    ).toBe('complete');
    expect(
      widgetView(
        ended,
        { expanded: true },
        { localNowMs: T0 + min(61), fullscreen: false, completedAt: T0 + min(61) - 6000 },
      ).mode,
    ).toBe('hidden');
  });

  it('clamps the drag position', () => {
    expect(clampY(-1)).toBe(0.04);
    expect(clampY(2)).toBe(0.92);
    expect(clampY(Number.NaN)).toBe(0.4);
  });
});
