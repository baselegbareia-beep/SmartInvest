import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { SaveData, SettingsData } from '../src/core/types.ts';

/**
 * Two copies of the game open on one origin (two tabs, or the installed app beside a browser tab: they share
 * localStorage) never undo each other's progress or settings (docs/ARCHITECTURE.md 11.8, storage.ts and
 * singletons.ts). Each copy read the save once at boot and wrote its own copy back on its next change: a tab opened
 * before another one's progress wrote the old unlocked level and best score back on its next save.
 *
 * The other copy's writes are made here through its own localStorage, as its game makes them: the browser tells the
 * first tab of a write in another with the same 'storage' event either way.
 */

const PROGRESS_KEY = 'moon-foundry:progress';
const SETTINGS_KEY = 'moon-foundry:settings';

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  return problems;
}

async function open(page: Page): Promise<string[]> {
  const problems = watch(page);
  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const read = async <T>(page: Page, key: string): Promise<T | null> => {
  const raw = await page.evaluate((k) => localStorage.getItem(k), key);
  return raw === null ? null : (JSON.parse(raw) as T);
};
const write = (page: Page, key: string, value: unknown): Promise<void> =>
  page.evaluate(({ k, v }) => {
    localStorage.setItem(k, v);
  }, { k: key, v: JSON.stringify(value) });
const labels = async (page: Page): Promise<string[]> => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((i) => i.label);
const label = (page: Page): Promise<string> => page.locator('#game canvas').evaluate((c) => c.getAttribute('aria-label') ?? '');
const state = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);

test('a title left open learns of the other tab\'s progress, and starting a new game there keeps its unlocked level and best score', async ({ browser }) => {
  const context = await browser.newContext();
  const b = await context.newPage();
  const problemsB = await open(b);
  await b.evaluate((k) => {
    localStorage.removeItem(k);
  }, PROGRESS_KEY);
  await b.reload();
  await b.waitForFunction(() => window.__GAME_READY__ === true);
  expect(await label(b)).toContain('START');

  // The other tab clears level 1: its game saves this.
  const a = await context.newPage();
  await open(a);
  const cleared: SaveData = { v: 1, unlocked: 1, bestScore: 0, finished: false, resume: { levelIndex: 1, score: 410, lives: 3 } };
  await write(a, PROGRESS_KEY, cleared);

  // Tab B's title now offers that run, as a fresh visit would.
  await expect.poll(() => labels(b), { timeout: 5000 }).toEqual(['CONTINUE - LEVEL 2', 'NEW GAME']);
  // B starts a new game (it asks again: there is a run to lose). The unlocked level stays; only the run starts over.
  await b.keyboard.press('ArrowDown');
  await b.keyboard.press('Space');
  await b.keyboard.press('Space');
  await expect.poll(async () => (await state(b))?.levelIndex, { timeout: 5000 }).toBe(0);
  await expect.poll(() => read<SaveData>(a, PROGRESS_KEY)).toMatchObject({ unlocked: 1, resume: { levelIndex: 0, score: 0, lives: 3 } });
  expect(problemsB).toEqual([]);
  await context.close();
});

test('a tab in play keeps the unlocked level and best score another tab saved meanwhile, and its own run', async ({ browser }) => {
  const context = await browser.newContext();
  const b = await context.newPage();
  const problemsB = await open(b);
  await b.evaluate((k) => {
    localStorage.removeItem(k);
  }, PROGRESS_KEY);
  await b.reload();
  await b.waitForFunction(() => window.__GAME_READY__ === true);
  await b.keyboard.press('Space'); // a new game: level 1 is saved as B's run
  await expect.poll(() => read<SaveData>(b, PROGRESS_KEY)).toMatchObject({ resume: { levelIndex: 0 } });

  const a = await context.newPage();
  await open(a);
  await write(a, PROGRESS_KEY, { v: 1, unlocked: 5, bestScore: 3000, finished: false, resume: { levelIndex: 5, score: 2500, lives: 2 } });

  // B's next save (its hero's death) keeps A's unlocked level and best score, and writes B's own run.
  await expect.poll(async () => (await state(b))?.mode, { timeout: 5000 }).toBe('running');
  await b.keyboard.press('Escape');
  await expect.poll(() => labels(b)).toContain('RESTART LEVEL -1 LIFE');
  const item = (await b.evaluate(() => window.__E2E__?.menu() ?? [])).find((i) => i.label === 'RESTART LEVEL -1 LIFE');
  if (!item) throw new Error('no RESTART');
  await b.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
  await expect.poll(() => read<SaveData>(a, PROGRESS_KEY)).toMatchObject({ unlocked: 5, bestScore: 3000, resume: { levelIndex: 0, score: 0, lives: 2 } });
  expect(problemsB).toEqual([]);
  await context.close();
});

test("a sound switched off in one tab is not switched back on by the other's next change of settings", async ({ browser }) => {
  const context = await browser.newContext();
  const b = await context.newPage();
  const problemsB = await open(b);
  const a = await context.newPage();
  await open(a);
  await write(a, SETTINGS_KEY, { v: 1, sound: false, vibration: true } satisfies SettingsData);
  await expect.poll(async () => (await b.evaluate(() => window.__E2E__?.sound() ?? null))?.muted, { timeout: 5000 }).toBe(true);
  // B's title says so too.
  await expect.poll(() => label(b)).toContain('SOUND OFF');

  // B turns BUZZ off in its pause menu: the sound stays off in the store.
  await b.evaluate(() => {
    window.__E2E__?.startLevel('test');
  });
  await expect.poll(async () => (await state(b))?.mode, { timeout: 5000 }).toBe('running');
  await b.keyboard.press('Escape');
  await expect.poll(() => labels(b)).toContain('BUZZ ON');
  expect(await labels(b)).toContain('SOUND OFF');
  const item = (await b.evaluate(() => window.__E2E__?.menu() ?? [])).find((i) => i.label === 'BUZZ ON');
  if (!item) throw new Error('no BUZZ');
  await b.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
  await expect.poll(() => read<SettingsData>(a, SETTINGS_KEY)).toEqual({ v: 1, sound: false, vibration: false });
  expect(problemsB).toEqual([]);
  await context.close();
});

test('with a store that can be read but not written (a full quota), turning SOUND off after BUZZ leaves BUZZ off', async ({ page }) => {
  // Saved by an earlier visit: both on. Then every write is refused, as by a full store (one origin shared by many pages).
  const problems = await open(page);
  await write(page, SETTINGS_KEY, { v: 1, sound: true, vibration: true } satisfies SettingsData);
  await page.reload();
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await page.evaluate(() => {
    window.__E2E__?.startLevel('test');
  });
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
  await page.keyboard.press('Escape');
  const flip = async (words: string): Promise<void> => {
    await expect.poll(() => labels(page)).toContain(words);
    const item = (await page.evaluate(() => window.__E2E__?.menu() ?? [])).find((i) => i.label === words);
    if (!item) throw new Error(`no ${words}`);
    await page.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
  };
  await flip('BUZZ ON');
  await expect.poll(() => label(page)).toContain('BUZZ OFF');
  await flip('SOUND ON');
  await expect.poll(() => label(page)).toContain('SOUND OFF');
  // The store still holds the earlier visit's settings: it took none of this. BUZZ stays as the player left it.
  expect(await read<SettingsData>(page, SETTINGS_KEY)).toEqual({ v: 1, sound: true, vibration: true });
  expect(await label(page)).toContain('BUZZ OFF');
  // The menu opened again is drawn from the settings as they are now.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await page.evaluate(() => window.__E2E__?.scenes() ?? [])).includes('Pause')).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(() => labels(page)).toContain('RESUME');
  expect((await labels(page)).slice(-2)).toEqual(['SOUND OFF', 'BUZZ OFF']);
  expect(problems).toEqual([]);
});
