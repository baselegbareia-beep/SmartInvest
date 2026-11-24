import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * The production build ships two lazy chunks that a player never needs (docs/ARCHITECTURE.md 11.6): the test
 * hook (`assets/e2eHook-*.js`, loaded by main.ts only with `?e2e=1` or in a dev build) and the offline sound
 * renderer (`assets/offline-*.js`, loaded only by the hook's `renderEffect`). A normal visit, the title and a
 * level played a little, must neither fetch nor run either. The page's own requests are counted; the offline
 * app's service worker (Phase 5) may put both files in its cache, which runs neither.
 */

const HOOK = /\/assets\/e2eHook-[^/]*\.js$/;
const OFFLINE = /\/assets\/offline-[^/]*\.js$/;

/** Every request the page itself makes (not a service worker's), by URL path. */
function pageRequests(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on('request', (request) => {
    if (request.serviceWorker() === null) seen.push(new URL(request.url()).pathname);
  });
  return seen;
}

/** The script files the page has loaded, from its own resource timing. */
const loadedScripts = (page: Page): Promise<string[]> =>
  page.evaluate(() => performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((p) => p.endsWith('.js')));

test('a normal visit loads neither the test hook nor the offline sound renderer', async ({ page, context }) => {
  const requests = pageRequests(context);
  await page.goto('./');
  await page.waitForFunction(() => window.__GAME_READY__ === true);
  // Play a little, the way a player does: start, run, jump (sounds play), pause.
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const scripts = await loadedScripts(page);
  expect(scripts.some((p) => /\/assets\/index-[^/]*\.js$/.test(p)), `the game's own bundle among ${scripts.join(', ')}`).toBe(true);
  expect(requests.filter((p) => HOOK.test(p) || OFFLINE.test(p)), 'requests for the hook or the offline renderer').toEqual([]);
  expect(scripts.filter((p) => HOOK.test(p) || OFFLINE.test(p)), 'scripts loaded').toEqual([]);
  expect(await page.evaluate(() => typeof window.__E2E__)).toBe('undefined');
});

test('?e2e=1 loads the hook, and the offline renderer only when renderEffect is asked for', async ({ page, context }) => {
  const requests = pageRequests(context);
  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__GAME_READY__ === true && window.__E2E__ !== undefined);
  expect(requests.filter((p) => HOOK.test(p))).toHaveLength(1);
  expect(requests.filter((p) => OFFLINE.test(p)), 'the offline renderer before renderEffect').toEqual([]);
  await page.evaluate(async () => {
    await window.__E2E__?.renderEffect('jump');
  });
  expect(requests.filter((p) => OFFLINE.test(p))).toHaveLength(1);
});
