import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { SaveData } from '../src/core/types.ts';

/**
 * Saving, played end to end in the built game (docs/ARCHITECTURE.md section 10, docs/SPEC.md "What is
 * saved on the device"): CONTINUE and NEW GAME on the title, continuing after the page was closed,
 * quitting, restarting, the game over, and the best score on the end screen and the title.
 *
 * Only the campaign is saved (the development rooms never are), so these tests need at least one
 * `levels/level-NN.txt` in the build; the two that need a second level say so. Without a campaign they
 * are skipped with that reason. Saves are put in place through `localStorage` before the page loads,
 * the way a player's earlier visit would have left them, and read back the same way.
 *
 * The words a screen shows are read from the canvas's accessible name, which each screen sets to them.
 */

const PROGRESS_KEY = 'moon-foundry:progress';

function save(fields: Partial<SaveData>): SaveData {
  return { v: 1, unlocked: 0, bestScore: 0, finished: false, resume: null, ...fields };
}

/** Collects page errors and console errors. */
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

/** Opens the title with `stored` as the saved progress (null: none), as a visit after an earlier one. */
async function openWith(page: Page, stored: SaveData | null): Promise<void> {
  await page.goto('./?e2e=1');
  await page.evaluate(
    ({ key, value }) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    { key: PROGRESS_KEY, value: stored === null ? null : JSON.stringify(stored) },
  );
  await reopen(page);
}

/** Closes the page and opens it again (a reload: the game reads its save afresh). */
async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
}

const stored = async (page: Page): Promise<SaveData | null> => {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PROGRESS_KEY);
  return raw === null ? null : (JSON.parse(raw) as SaveData);
};
const label = (page: Page): Promise<string> => page.locator('#game canvas').evaluate((c) => c.getAttribute('aria-label') ?? '');
const buttons = async (page: Page): Promise<string[]> => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((i) => i.label);
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const state = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);

async function pick(page: Page, words: string): Promise<void> {
  const items = await page.evaluate(() => window.__E2E__?.menu() ?? []);
  const item = items.find((i) => i.label === words);
  if (!item) throw new Error(`no menu item "${words}" in ${JSON.stringify(items.map((i) => i.label))}`);
  await page.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
}

/** Picks a title button and waits until the level's intro card is gone (the core is running). */
async function play(page: Page, words: string): Promise<void> {
  await pick(page, words);
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
}

/** Opens the pause menu and picks `words`. */
async function pauseAndPick(page: Page, words: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(() => scenes(page)).toContain('Pause');
  await pick(page, words);
}

/**
 * How many campaign levels the build has, found the way a player would see it: a saved run on a level
 * beyond the end is moved to the last level (parseSave), and with no campaign at all it is dropped.
 */
async function campaignSize(page: Page): Promise<number> {
  await openWith(page, save({ resume: { levelIndex: 99, score: 0, lives: 3 } }));
  const offered = (await buttons(page)).map((b) => /^CONTINUE - LEVEL (\d+)$/.exec(b)?.[1]).find((d) => d !== undefined);
  return offered === undefined ? 0 : Number(offered);
}

let levels = -1;
test.beforeEach(async ({ page }) => {
  if (levels < 0) levels = await campaignSize(page);
  test.skip(levels === 0, 'this build has no campaign level (levels/level-NN.txt): nothing is saved');
});

test('the title offers CONTINUE - LEVEL n by the save rules, else the start prompt', async ({ page }) => {
  const problems = watch(page);
  // A run in progress: its own level.
  await openWith(page, save({ resume: { levelIndex: 0, score: 120, lives: 2 } }));
  expect(await buttons(page)).toEqual(['CONTINUE - LEVEL 1', 'NEW GAME']);
  // Rows a finger can hit: at least 44 CSS px tall (menuLayout).
  for (const item of await page.evaluate(() => window.__E2E__?.menu() ?? [])) expect(item.h, item.label).toBeGreaterThanOrEqual(44 - 0.01);
  // Nothing at all: the prompt, and no best line before there is a best score.
  await openWith(page, null);
  expect(await buttons(page)).toEqual([]);
  expect(await label(page)).toMatch(/START/);
  expect(await label(page)).not.toContain('BEST');
  // A best score is shown on the title.
  await openWith(page, save({ bestScore: 4250 }));
  expect(await label(page)).toContain('BEST 04250');
  if (levels >= 2) {
    // No run, but a level beyond the first unlocked (after a game over): that level.
    await openWith(page, save({ unlocked: 1 }));
    expect(await buttons(page)).toEqual(['CONTINUE - LEVEL 2', 'NEW GAME']);
  }
  expect(problems).toEqual([]);
});

test('continuing after the page was closed restarts the level as a fresh visit, with the lives as they are now', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, null);
  // A new game: tap to start.
  await page.mouse.click(10, Math.round((page.viewportSize()?.height ?? 300) / 2));
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
  expect(await stored(page)).toMatchObject({ resume: { levelIndex: 0, score: 0, lives: 3 } });

  // Play a little (a crystal may be picked up on the way), then lose a life with RESTART LEVEL.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  // RESTART LEVEL acts in the ready gate or in play, not while dying: wait out a death the walk may have cost.
  await expect.poll(async () => (await state(page))?.phase, { timeout: 5000 }).toMatch(/^(ready|playing)$/);
  const lives = (await state(page))?.lives ?? 0;
  await pauseAndPick(page, 'RESTART LEVEL -1 LIFE');
  await expect.poll(async () => (await state(page))?.lives).toBe(lives - 1);
  const before = await state(page);
  expect(await stored(page)).toMatchObject({ resume: { levelIndex: 0, score: 0, lives: lives - 1 } });

  // The page is closed and opened again.
  await reopen(page);
  expect(await buttons(page)).toEqual(['CONTINUE - LEVEL 1', 'NEW GAME']);
  await play(page, 'CONTINUE - LEVEL 1');
  const after = await state(page);
  expect(after).toMatchObject({ levelIndex: 0, score: 0, lives: lives - 1, hasTrophy: false, phase: 'ready' });
  // A fresh visit: the level's own clock starts again (a restart keeps counting it), whatever was gathered is back.
  expect(after?.tick ?? Infinity).toBeLessThan(before?.tick ?? 0);
  expect(problems).toEqual([]);
});

test('quitting to the title costs no life', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, save({ bestScore: 900, resume: { levelIndex: 0, score: 300, lives: 2 } }));
  await play(page, 'CONTINUE - LEVEL 1');
  expect(await state(page)).toMatchObject({ score: 300, lives: 2 });
  await pauseAndPick(page, 'QUIT TO TITLE');
  await expect.poll(() => scenes(page)).toEqual(['Title']);
  expect(await stored(page)).toMatchObject({ bestScore: 900, resume: { levelIndex: 0, score: 300, lives: 2 } });
  expect(await buttons(page)).toEqual(['CONTINUE - LEVEL 1', 'NEW GAME']);
  await play(page, 'CONTINUE - LEVEL 1');
  expect(await state(page)).toMatchObject({ score: 300, lives: 2 });
  expect(problems).toEqual([]);
});

test('a game over clears the run and keeps the best score; the end screen says BEST when it was not beaten', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, save({ bestScore: 5000, resume: { levelIndex: 0, score: 1234, lives: 1 } }));
  await play(page, 'CONTINUE - LEVEL 1');
  // The last life, spent by RESTART LEVEL: the game is over.
  await pauseAndPick(page, 'RESTART LEVEL -1 LIFE');
  await expect.poll(() => scenes(page)).toEqual(['End']);
  expect(await label(page)).toBe('GAME OVER. SCORE 01234. BEST 05000. TRY AGAIN - LEVEL 1. TITLE');
  expect(await stored(page)).toMatchObject({ bestScore: 5000, resume: null });

  await pick(page, 'TITLE');
  await expect.poll(() => scenes(page)).toEqual(['Title']);
  await reopen(page);
  // No run to continue (no level beyond the first was reached): the prompt, and the best score kept.
  expect(await buttons(page)).toEqual([]);
  expect(await label(page)).toContain('BEST 05000');
  expect(problems).toEqual([]);
});

test('NEW BEST! only when the score beats the best score the run began with, and the title then shows it', async ({ page }) => {
  const problems = watch(page);
  await openWith(page, save({ bestScore: 1000, resume: { levelIndex: 0, score: 1234, lives: 1 } }));
  await play(page, 'CONTINUE - LEVEL 1');
  await pauseAndPick(page, 'RESTART LEVEL -1 LIFE');
  await expect.poll(() => scenes(page)).toEqual(['End']);
  // The save was raised already (at the last death); the screen compares with the best the run began with.
  expect(await stored(page)).toMatchObject({ bestScore: 1234, resume: null });
  expect(await label(page)).toBe('GAME OVER. SCORE 01234. NEW BEST!. TRY AGAIN - LEVEL 1. TITLE');
  await pick(page, 'TITLE');
  await expect.poll(() => scenes(page)).toEqual(['Title']);
  expect(await label(page)).toContain('BEST 01234');
  expect(problems).toEqual([]);
});

test('after a game over, TRY AGAIN starts at the highest level reached with full lives and no score', async ({ page }) => {
  test.skip(levels < 2, 'needs a second campaign level');
  const problems = watch(page);
  await openWith(page, save({ unlocked: 1, bestScore: 100, resume: { levelIndex: 1, score: 800, lives: 1 } }));
  expect(await buttons(page)).toEqual(['CONTINUE - LEVEL 2', 'NEW GAME']);
  await play(page, 'CONTINUE - LEVEL 2');
  expect(await state(page)).toMatchObject({ levelIndex: 1, score: 800, lives: 1 });
  await pauseAndPick(page, 'RESTART LEVEL -1 LIFE');
  await expect.poll(() => scenes(page)).toEqual(['End']);
  expect(await buttons(page)).toEqual(['TRY AGAIN - LEVEL 2', 'TITLE']);
  await pick(page, 'TRY AGAIN - LEVEL 2');
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
  expect(await state(page)).toMatchObject({ levelIndex: 1, score: 0, lives: 3 });
  expect(await stored(page)).toMatchObject({ unlocked: 1, bestScore: 800, resume: { levelIndex: 1, score: 0, lives: 3 } });
  expect(problems).toEqual([]);
});

test('NEW GAME starts at level 1 and keeps the best score and the unlocked levels', async ({ page }) => {
  const problems = watch(page);
  const unlocked = Math.min(1, levels - 1);
  await openWith(page, save({ unlocked, bestScore: 2500, resume: { levelIndex: unlocked, score: 700, lives: 2 } }));
  await play(page, 'NEW GAME');
  expect(await state(page)).toMatchObject({ levelIndex: 0, score: 0, lives: 3 });
  expect(await stored(page)).toMatchObject({ unlocked, bestScore: 2500, resume: { levelIndex: 0, score: 0, lives: 3 } });
  expect(problems).toEqual([]);
});
