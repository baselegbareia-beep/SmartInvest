import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A lost WebGL context while the page is visible (a GPU reset, a driver update, memory pressure; docs/PHASER4-NOTES.md
 * section 16): the canvas is blank until the browser restores it, so the game pauses at once instead of running on
 * unseen (a life was lost on a blank canvas). The Canvas renderer, with no WebGL at all, is e2e/canvas.spec.ts.
 */

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

async function open(page: Page, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.goto(`./?e2e=1${query}`);
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const state = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const labels = async (page: Page): Promise<string[]> => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((i) => i.label);

async function playRoom(page: Page, id: string): Promise<void> {
  await page.evaluate((room) => {
    window.__E2E__?.startLevel(room);
  }, id);
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
}

test.describe('a lost WebGL context', () => {
  test('pauses the game at once: nothing moves on a blank canvas, and the pause menu waits when the picture is back', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'debug');
    const lost = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      ext?.loseContext();
      (window as Window & { __ext?: WEBGL_lose_context | null }).__ext = ext ?? null;
      return gl?.isContextLost() ?? false;
    });
    expect(lost).toBe(true);
    const before = await state(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1000);
    await page.keyboard.up('ArrowRight');
    const during = await state(page);
    expect(during?.mode, 'paused while the picture is gone').toBe('paused');
    expect(during?.lives).toBe(before?.lives);
    expect(during?.player.x).toBe(before?.player.x);
    expect(await scenes(page)).toContain('Pause');

    await page.evaluate(() => {
      (window as Window & { __ext?: WEBGL_lose_context | null }).__ext?.restoreContext();
    });
    await page.waitForTimeout(300);
    expect((await state(page))?.mode, 'still paused once restored').toBe('paused');
    expect(await labels(page)).toContain('RESUME');
    // Phaser warns of the loss and of the restore; nothing else is said.
    expect(problems).toEqual([]);
  });
});
