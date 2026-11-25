import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Level 1 started from the title the way a player does (docs/ARCHITECTURE.md section 2, "Tests and levels"):
 * Space on the title, the level's intro card, then the ready gate, where the world waits for a press. The
 * picture of that moment is kept as e2e/screenshots/level-01.png, for the owner to look at after `npm run e2e`.
 *
 * The test hook is only read here (`?e2e=1`): the game is started and played by the keyboard. A build made
 * while levels/level-01.txt does not exist yet has no campaign, and the test is skipped.
 */

const SCREENSHOT = path.join(import.meta.dirname, 'screenshots', 'level-01.png');

const now = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const canvasLabel = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('#game canvas')?.getAttribute('aria-label') ?? '');

test('level 1 starts from the title the way a player does, and waits at the ready gate', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });

  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__GAME_READY__ === true && window.__E2E__ !== undefined);
  test.skip((await canvasLabel(page)).includes('NO LEVELS YET'), 'this build has no campaign level (levels/level-01.txt)');

  // A fresh browser has no save: the title offers the start prompt, and Space starts a new game at level 1.
  await page.keyboard.press('Space');
  await expect.poll(async () => (await now(page))?.mode).toBe('intro');
  expect(await now(page)).toMatchObject({ levelId: 'level-01', levelIndex: 0, phase: 'ready', tick: 0, score: 0 });
  expect(await canvasLabel(page)).toMatch(/^LEVEL 1\. /);

  // The card goes by itself; then the core runs the ready gate, which holds the world until a press.
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
  const gate = await now(page);
  await page.waitForTimeout(400);
  const later = await now(page);
  expect(later?.phase).toBe('ready');
  expect(later?.tick ?? 0).toBeGreaterThan(gate?.tick ?? 0);
  expect(later?.player).toEqual(gate?.player);

  // The picture: on a tick where the waiting hero is on the shown half of his blink ((tick >> 3) & 1 is 0), the next
  // multiple of 16. It is worked out from the tick inside the page and armed in the same call, at one tick a frame
  // (pace(1)): a tick read by one round trip and a stop armed by a second can be passed on a busy machine.
  const shownTick = await page.evaluate(() => {
    const hook = window.__E2E__;
    hook?.pace(1);
    return hook?.freezeAtTick(((hook.state()?.tick ?? 0) + 16) & ~15);
  });
  expect(((shownTick ?? 8) >> 3) & 1, `frozen on tick ${shownTick}, on the shown half of the blink`).toBe(0);
  await page.screenshot({ path: SCREENSHOT });
  await page.evaluate(() => {
    window.__E2E__?.pace(null);
    window.__E2E__?.freeze(false);
  });

  // A press starts the world.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await now(page))?.phase).toBe('playing');
  await page.keyboard.up('ArrowRight');
  expect(problems).toEqual([]);
});
