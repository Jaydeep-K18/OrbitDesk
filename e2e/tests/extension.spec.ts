import { E2E } from '../env.mjs';
import {
  apiCall,
  dynamicRuleIds,
  expect,
  loginUI,
  pairUI,
  registerViaApi,
  swStorage,
  test,
} from './fixtures';

interface Session {
  id: string;
  version: number;
  status: string;
}

const BLOCKED_URL = /^chrome-extension:\/\/[a-p]{32}\/blocked\.html\?d=instagram\.com/;

/** Ask the extension to sync right now (what the dashboard does after every session change). */
async function nudge(page: import('@playwright/test').Page) {
  await page.evaluate(
    (id) =>
      new Promise((resolve) =>
        (
          globalThis as unknown as {
            chrome: {
              runtime: { sendMessage: (i: string, m: unknown, cb: (r: unknown) => void) => void };
            };
          }
        ).chrome.runtime.sendMessage(id, { type: 'SESSION_CHANGED' }, resolve),
      ),
    E2E.extensionId,
  );
}

test('the unpacked extension has the pinned ID the dashboard expects', async ({ extensionId }) => {
  expect(extensionId).toBe(E2E.extensionId);
});

test('pair → block (incl. subdomains and open tabs) → blocked attempt is recorded → end unblocks', async ({
  context,
  page,
  sw,
}) => {
  const user = await registerViaApi();
  await loginUI(page, user);
  await pairUI(page);
  expect(await swStorage(sw, 'fg:auth')).toMatchObject({ deviceId: expect.any(String) });

  // A tab already open on a blocked site before the session starts.
  const early = await context.newPage();
  await early.goto('https://www.instagram.com/explore/');
  await expect(early.locator('h1')).toHaveText('www.instagram.com/explore/');

  // Start a session from the dashboard UI.
  await page.goto('/sessions/new');
  await page.getByLabel('Blocked sites').fill('instagram.com');
  await page.getByLabel('Blocked sites').press('Enter');
  await page.getByLabel('Relevant sites').fill('leetcode.com');
  await page.getByLabel('Relevant sites').press('Enter');
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page).toHaveURL(/\/session$/);

  // Rules installed and the already-open tab redirected.
  await expect.poll(() => dynamicRuleIds(sw)).toEqual([1000, 1999]);
  await expect(early).toHaveURL(BLOCKED_URL);
  await expect(early.getByRole('heading', { level: 1 })).toContainText('instagram.com is blocked');

  // New navigations to the domain and its subdomains are blocked too.
  const tab = await context.newPage();
  await tab.goto('https://m.instagram.com/reel/123').catch(() => undefined);
  await expect(tab).toHaveURL(/blocked\.html\?d=instagram\.com/);
  await expect(tab.getByRole('button', { name: 'Back to work' })).toBeVisible();

  // Relevant sites still load.
  await tab.goto('https://leetcode.com/problems/binary-search/');
  await expect(tab.locator('h1')).toHaveText('leetcode.com/problems/binary-search/');

  // The blocked attempt reaches the API immediately (live dashboard counter).
  await expect
    .poll(
      async () =>
        (
          await apiCall<{ liveCounters: { blockedAttempts: number } | null }>(
            user,
            '/dashboard/summary',
          )
        ).liveCounters?.blockedAttempts ?? 0,
    )
    .toBeGreaterThanOrEqual(1);

  // End early from the dashboard → rules removed → the site loads again.
  await page.bringToFront();
  await page.getByRole('button', { name: 'End early' }).click();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => dynamicRuleIds(sw)).toEqual([]);
  await tab.goto('https://www.instagram.com/');
  await expect(tab.locator('h1')).toHaveText('www.instagram.com/');
});

test('rules are removed at the planned end even while offline', async ({ context, page, sw }) => {
  const user = await registerViaApi();
  await loginUI(page, user);
  await pairUI(page);
  const session = await apiCall<Session>(user, '/sessions', {
    method: 'POST',
    body: { startMode: 'now', durationMin: 5, blockedDomains: ['instagram.com'] },
  });
  await nudge(page);
  await expect.poll(() => dynamicRuleIds(sw)).toEqual([1000, 1999]);

  // Test-only shortcut: pull the end time 8 s in instead of waiting 5 minutes.
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  await db.query(`UPDATE focus_sessions SET ends_at = now() + interval '8 seconds' WHERE id = $1`, [
    session.id,
  ]);
  await db.query(
    `UPDATE focus_session_blocks SET ends_at = now() + interval '8 seconds' WHERE session_id = $1`,
    [session.id],
  );
  await db.end();
  await nudge(page);
  await expect
    .poll(async () => {
      const st = await swStorage<{ state: { session: { endsAt: string } | null } }>(sw, 'fg:state');
      return Date.parse(st.state.session?.endsAt ?? '0') - Date.now();
    })
    .toBeLessThan(10_000);

  // Network gone: the extension's local alarm must still lift the rules on time.
  await context.setOffline(true);
  await expect.poll(() => dynamicRuleIds(sw), { timeout: 30_000 }).toEqual([]);
  await context.setOffline(false);
});

test('floating widget is injected, survives hostile page CSS, and toggles from the toolbar', async ({
  context,
  page,
  sw,
}) => {
  const user = await registerViaApi();
  await loginUI(page, user);
  await pairUI(page);
  await apiCall(user, '/sessions', { method: 'POST', body: { startMode: 'now', durationMin: 45 } });
  await nudge(page);
  await expect
    .poll(async () =>
      Boolean(
        (await swStorage<{ state: { session: unknown } | null }>(sw, 'fg:state'))?.state?.session,
      ),
    )
    .toBe(true);

  const site = await context.newPage();
  await site.goto('https://example.com/article');
  await expect(site.locator('focusguard-widget')).toBeAttached();

  // Hostile page CSS (`* { display: none !important }`) can't hide the widget host.
  const hostile = await context.newPage();
  await hostile.goto('https://hostile.test/');
  await expect
    .poll(() =>
      hostile.evaluate(() => {
        const host = document.querySelector('focusguard-widget') as HTMLElement | null;
        return host ? getComputedStyle(host).display : 'missing';
      }),
    )
    .toBe('block');

  // Toolbar click path: the service worker sends TOGGLE_WIDGET; the state is shared across tabs.
  await site.bringToFront();
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://example.com/*' });
    await chrome.tabs.sendMessage(tab!.id!, { type: 'TOGGLE_WIDGET' });
  });
  await expect
    .poll(async () => (await swStorage<{ expanded: boolean }>(sw, 'fg:widget')).expanded)
    .toBe(true);
  await site.screenshot({ path: 'test-results/widget-expanded.png' });
});
