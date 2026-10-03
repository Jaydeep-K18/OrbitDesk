import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { E2E } from '../env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = path.join(root, 'apps/extension/.output-e2e/chrome-mv3');
/**
 * Browser binary. Branded Chrome ignores --load-extension (137+), so we use Chrome for Testing
 * kept in .data/browsers (Windows dev box), or Playwright's Chromium (CI).
 */
const localCft = path.join(root, '.data/browsers/chrome-win64/chrome.exe');
const executablePath = process.env.E2E_CHROME_PATH ?? (existsSync(localCft) ? localCft : undefined);

/** Fake pages for third-party sites so tests never hit the real internet. */
const FAKE_SITES =
  /^https?:\/\/([a-z0-9-]+\.)*(instagram\.com|leetcode\.com|youtube\.com|example\.com|reddit\.com|hostile\.test)\//;

export function fakePage(title: string, extraHead = '') {
  return `<!doctype html><html><head><title>${title}</title>${extraHead}</head><body><h1>${title}</h1><p>fake page for tests</p></body></html>`;
}

export interface TestUser {
  email: string;
  password: string;
  accessToken: string;
}

let counter = 0;
export async function registerViaApi(): Promise<TestUser> {
  counter += 1;
  const email = `e2e-${Date.now()}-${counter}@focusguard.test`;
  const password = 'e2e-password-123';
  const res = await fetch(`${E2E.apiOrigin}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'E2E User', timezone: 'Asia/Kolkata' }),
  });
  if (res.status !== 201) throw new Error(`register failed ${res.status}`);
  const body = (await res.json()) as { accessToken: string };
  return { email, password, accessToken: body.accessToken };
}

export async function apiCall<T = unknown>(
  user: TestUser,
  pathname: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${E2E.apiOrigin}/api/v1${pathname}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function loginUI(page: Page, user: TestUser) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

/** Pairs through the real dashboard flow: Settings → Devices → Connect extension. */
export async function pairUI(page: Page) {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Devices' }).click();
  await page.getByRole('button', { name: 'Connect extension' }).click();
  await expect(page.getByText('Extension connected')).toBeVisible();
}

/** Reads a chrome.storage.local value from the extension's service worker. */
export async function swStorage<T>(sw: Worker, key: string): Promise<T> {
  return sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<T>;
}

export async function dynamicRuleIds(sw: Worker): Promise<number[]> {
  return sw.evaluate(async () =>
    (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id),
  );
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; sw: Worker }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      viewport: { width: 1280, height: 800 },
    });
    await context.route(FAKE_SITES, async (route) => {
      const url = new URL(route.request().url());
      const hostile = url.hostname.endsWith('hostile.test');
      const head = hostile
        ? '<style>* { display: none !important; all: unset !important; } html, body { display: block !important; }</style>'
        : '';
      await route.fulfill({
        contentType: 'text/html',
        body: fakePage(`${url.hostname}${url.pathname}`, head),
      });
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});

export { expect };
