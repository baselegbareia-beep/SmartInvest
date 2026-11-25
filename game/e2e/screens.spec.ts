import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { COLOR } from '../src/art/palette.ts';
import { STRIP_H } from '../src/shell/hudModel.ts';
import type { InputScript } from '../src/core/types.ts';
import { GAME_TITLE } from '../src/meta.ts';

/**
 * Every screen and menu of the built game (docs/ART-AND-SOUND.md sections 8 and 9, docs/SPEC.md
 * "Screens"), driven as a player drives them: taps, clicks and keys, plus `window.__E2E__` to read the
 * session and to start the development rooms (docs/ARCHITECTURE.md 11.6).
 *
 * The words a screen shows are drawn in the pixel font, so they are read from the canvas's accessible
 * name (`aria-label`, which each screen sets to its words); colours and the top bar are read from the
 * pixels of a screenshot. Everything that needs saved progress (CONTINUE, the best score, the save
 * rules) is in e2e/save.spec.ts.
 */

interface RoomScript extends InputScript {
  readonly trophyTick: number;
  readonly winTick: number;
}
const readScript = (id: string): RoomScript =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as RoomScript;

/** The debug room, walked into its spikes three times: a game over (each death waits, then a fresh press). */
const DIE_THRICE: InputScript = { runs: [[0, 15], [2, 100], [0, 90], [2, 100], [0, 90], [2, 100], [0, 200]] };

const SETTINGS_KEY = 'moon-foundry:settings';

/** Collects page errors and console errors (warnings are allowed: headless WebGL warns about ReadPixels). */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('touchcancel')) problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  return problems;
}

/** Opens the game with the test hook and waits for the title to be drawn. */
async function open(page: Page, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.goto(`./?e2e=1${query}`);
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const hook = {
  scenes: (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []),
  state: (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null),
  mode: async (page: Page): Promise<string | null> => (await page.evaluate(() => window.__E2E__?.state() ?? null))?.mode ?? null,
  menu: (page: Page) => page.evaluate(() => window.__E2E__?.menu() ?? []),
  sound: (page: Page) => page.evaluate(() => window.__E2E__?.sound() ?? null),
  held: (page: Page) => page.evaluate(() => window.__E2E__?.held() ?? null),
  freeze: (page: Page, on: boolean) =>
    page.evaluate((f) => {
      window.__E2E__?.freeze(f);
    }, on),
};

/** The words on the canvas now (each screen names the canvas with what it shows). */
const label = (page: Page): Promise<string> => page.locator('#game canvas').evaluate((c) => c.getAttribute('aria-label') ?? '');

/** Starts a development room through the hook and waits until its intro card is gone. */
async function playRoom(page: Page, id: string): Promise<void> {
  await page.evaluate((room) => {
    window.__E2E__?.startLevel(room);
  }, id);
  await expect.poll(() => hook.mode(page), { timeout: 5000 }).toBe('running');
}

/**
 * Taps (clicks) the menu item with these words, once the menu shows it: the Pause scene is listed a frame before its
 * menu is built, and on a busy machine the test could ask in between (an empty menu, 25 November 2026). An end
 * screen takes no pick until its buttons light (menu.ts `armed`): that is waited for too, as a player would.
 */
async function pick(page: Page, words: string): Promise<void> {
  await expect.poll(async () => (await hook.menu(page)).map((i) => i.label), { timeout: 5000 }).toContain(words);
  await expect.poll(async () => (await hook.menu(page)).some((i) => i.label === words && i.armed), { timeout: 5000 }).toBe(true);
  const items = await hook.menu(page);
  const item = items.find((i) => i.label === words);
  if (!item) throw new Error(`no menu item "${words}" in ${JSON.stringify(items.map((i) => i.label))}`);
  await page.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
}

// ---------------------------------------------------------------------------------------
// Pixels: what a screenshot shows in a rectangle of the view (art px)
// ---------------------------------------------------------------------------------------

interface ArtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many screen pixels in `rect` (art px of the view) have each of `colours` (palette hex numbers), give or take 3. */
async function colourCounts(page: Page, rect: ArtRect, colours: readonly number[]): Promise<number[]> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const viewW = await page.locator('#game canvas').evaluate((c) => (c as HTMLCanvasElement).width);
  const k = box.width / viewW;
  await hook.freeze(page, true);
  const png = await page.screenshot({
    clip: { x: box.x + rect.x * k, y: box.y + rect.y * k, width: Math.max(1, rect.w * k), height: Math.max(1, rect.h * k) },
  });
  await hook.freeze(page, false);
  return page.evaluate(
    async ({ b64, wanted }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return wanted.map(() => -1);
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const counts = wanted.map(() => 0);
      for (let i = 0; i < data.length; i += 4) {
        wanted.forEach((c, n) => {
          const near = (shift: number, v: number | undefined): boolean => Math.abs(((c >> shift) & 255) - (v ?? -99)) <= 3;
          if (near(16, data[i]) && near(8, data[i + 1]) && near(0, data[i + 2])) counts[n] = (counts[n] ?? 0) + 1;
        });
      }
      return counts;
    },
    { b64: png.toString('base64'), wanted: [...colours] },
  );
}

/** The view's size in art px. */
const viewSize = (page: Page): Promise<{ w: number; h: number }> =>
  page.locator('#game canvas').evaluate((c) => ({ w: (c as HTMLCanvasElement).width, h: (c as HTMLCanvasElement).height }));

// ---------------------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------------------

test.describe('title', () => {
  test('names the game from src/meta.ts and starts with Space', async ({ page }) => {
    const problems = await open(page);
    const [first, ...rest] = GAME_TITLE.toUpperCase().split(' ');
    const words = await label(page);
    expect(words).toContain(`${first}. ${rest.join(' ')}`);
    // No touch was seen: the prompt names the key.
    expect(words).toContain('PRESS SPACE TO START');
    expect(await hook.scenes(page)).toEqual(['Title']);

    await page.keyboard.press('Space');
    await expect.poll(() => hook.scenes(page)).toContain('Play');
    await expect.poll(() => hook.mode(page)).toBe('intro');
    expect(problems).toEqual([]);
  });

  test('the sound switch in the top-right corner mutes, is saved, and does not start the game', async ({ page }) => {
    const problems = await open(page);
    const box = await page.locator('#game canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    // The switch's hit square is at least 44 CSS px, in the canvas's top-right corner.
    const corner = { x: Math.round(box.x + box.width - 20), y: Math.round(box.y + 20) };

    await page.mouse.click(corner.x, corner.y);
    await expect.poll(async () => (await hook.sound(page))?.muted).toBe(true);
    expect(await hook.scenes(page)).toEqual(['Title']);
    expect(await label(page)).toContain('SOUND OFF');
    expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? '{}')).toMatchObject({ sound: false });

    await page.reload();
    await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
    expect((await hook.sound(page))?.muted).toBe(true);

    await page.mouse.click(corner.x, corner.y);
    await expect.poll(async () => (await hook.sound(page))?.muted).toBe(false);
    expect(await hook.scenes(page)).toEqual(['Title']);
    // M does the same on the title, also without starting.
    await page.keyboard.press('m');
    await expect.poll(async () => (await hook.sound(page))?.muted).toBe(true);
    expect(await hook.scenes(page)).toEqual(['Title']);
    expect(problems).toEqual([]);
  });

  test.describe('on a touch device', () => {
    test.use({ hasTouch: true, isMobile: true });

    /** Counts calls of requestFullscreen in every frame of the page, before the game's scripts run. */
    async function spyFullscreen(page: Page): Promise<void> {
      await page.addInitScript(() => {
        const w = window as unknown as { __fullscreenAsks?: number };
        w.__fullscreenAsks = 0;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- kept to be called with .call(this) below
        const real = Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen = function (this: Element, options?: FullscreenOptions): Promise<void> {
          w.__fullscreenAsks = (w.__fullscreenAsks ?? 0) + 1;
          return real.call(this, options).catch(() => undefined);
        };
      });
    }

    test('the first tap unlocks the audio, asks for fullscreen and starts the game', async ({ page }) => {
      await spyFullscreen(page);
      const problems = watch(page);
      await page.goto('./?e2e=1&touch=1');
      // No page.evaluate before the tap: it would count as a user gesture (docs/PHASER4-NOTES.md section 20).
      await page.waitForTimeout(1500);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('no viewport');
      await page.touchscreen.tap(Math.round(viewport.width / 2), Math.round(viewport.height / 2));

      await expect.poll(async () => (await hook.sound(page))?.state).toBe('running');
      await expect.poll(() => page.evaluate(() => (window as unknown as { __fullscreenAsks?: number }).__fullscreenAsks)).toBe(1);
      await expect.poll(() => hook.scenes(page)).toContain('Play');
      expect(await label(page)).not.toContain('PRESS SPACE');
      expect(problems).toEqual([]);
    });

    test('inside a frame the first tap does not ask for fullscreen', async ({ page, baseURL }) => {
      await spyFullscreen(page);
      await page.setContent(`<iframe src="${baseURL ?? ''}?e2e=1&touch=1" style="border:0;width:100vw;height:100vh"></iframe>`);
      const frame = page.frames()[1];
      if (!frame) throw new Error('no frame');
      await frame.waitForLoadState('load');
      await page.waitForTimeout(1500);
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('no viewport');
      await page.touchscreen.tap(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
      await expect.poll(() => frame.evaluate(() => window.__E2E__?.scenes() ?? [])).toContain('Play');
      expect(await frame.evaluate(() => (window as unknown as { __fullscreenAsks?: number }).__fullscreenAsks)).toBe(0);
      // The prompt said TAP on this touch device.
      expect(await frame.locator('#game canvas').evaluate((c) => c.getAttribute('aria-label') ?? '')).not.toContain('PRESS SPACE');
    });
  });
});

// ---------------------------------------------------------------------------------------
// Level intro card and the top bar
// ---------------------------------------------------------------------------------------

test.describe('level intro card', () => {
  test('names the level and holds the world still; a press skips it into the ready gate', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.__E2E__?.startLevel('debug');
    });
    await expect.poll(() => hook.mode(page)).toBe('intro');
    await expect.poll(() => label(page)).toBe('LEVEL 1. DEBUG ROOM. EVERY TILE, ITEM AND ENEMY IN ONE ROOM.');
    // The core is not stepped under the card.
    expect((await hook.state(page))?.tick).toBe(0);
    await page.waitForTimeout(500);
    expect((await hook.state(page))?.tick).toBe(0);
    expect(await hook.mode(page)).toBe('intro');

    // A press after introSkipAfterFrames skips the card; it is used up, so the ready gate still waits.
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => hook.mode(page)).toBe('running');
    const state = await hook.state(page);
    expect(state?.phase).toBe('ready');
    const x = state?.player.x;
    await page.waitForTimeout(300);
    expect((await hook.state(page))?.player.x).toBe(x);
    expect((await hook.state(page))?.phase).toBe('ready');

    // A fresh press opens the gate and the hero runs.
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await hook.state(page))?.player.x ?? 0).toBeGreaterThan(x ?? 0);
    await page.keyboard.up('ArrowRight');
    expect(problems).toEqual([]);
  });

  test('ends by itself after its time, into the ready gate', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.__E2E__?.startLevel('test');
    });
    await expect.poll(() => hook.mode(page)).toBe('intro');
    await expect.poll(() => hook.mode(page), { timeout: 4000 }).toBe('running');
    expect((await hook.state(page))?.phase).toBe('ready');
  });
});

test.describe('top bar', () => {
  test('shows the score in gold at the top, the cog, the items and the fuel, the cog toast and the clear banner', async ({ page }) => {
    const problems = await open(page);
    const view = await viewSize(page);
    const bar = { x: 0, y: 3, w: view.w, h: 9 };
    const centre = { x: Math.floor(view.w / 2) - 16, y: 3, w: 32, h: 8 };
    const right = { x: Math.floor(view.w / 2) + 30, y: 3, w: Math.ceil(view.w / 2) - 30, h: 9 };
    const toastRow = { x: 0, y: 16, w: view.w, h: 8 };

    await playRoom(page, 'debug');
    // The score's five digits, gold, centred; three lit life icons (cream) at the left.
    let [gold = 0] = await colourCounts(page, centre, [COLOR.gold]);
    expect(gold, 'gold score digits in the middle of the top bar').toBeGreaterThan(20);
    const [cream = 0] = await colourCounts(page, { x: 0, y: 3, w: 32, h: 8 }, [COLOR.cream]);
    expect(cream, 'lit life icons at the left of the top bar').toBeGreaterThan(3);
    // Nothing gold and no lime pip on the right yet: the cog is an outline, no pack.
    let [rightGold = 0, lime = 0] = await colourCounts(page, right, [COLOR.gold, COLOR.lime]);
    expect(lime, 'no fuel pips without the pack').toBe(0);
    expect(rightGold, 'the cog is an outline until found').toBe(0);
    // The bar is at the top...
    const [barWhite = 0] = await colourCounts(page, bar, [COLOR.white]);
    expect(barWhite, 'LEVEL 1 in white in the bar').toBeGreaterThan(10);
    // ...and nothing along the bottom of the screen but the level (docs/LEVELS.md rule 11): no status bar, no
    // "go to the door" line, in any colour, drawn by any kind of object: the HUD scene changes no pixel of the bottom
    // 14 rows, and every object of it that has bounds ends above them.
    await expectNothingAtTheBottom(page, view, 'at the ready gate');
    // The HUD's words and numbers are white or gold; at this ready gate the room's bottom rows hold neither (checked
    // once by eye: floor tiles and the starry backdrop), so any drawn there would be the HUD's.
    const [bottomWhite = 0, bottomGold = 0] = await colourCounts(page, { x: 0, y: view.h - 14, w: view.w, h: 14 }, [COLOR.white, COLOR.gold]);
    expect(bottomWhite + bottomGold, 'white or gold along the bottom of the screen').toBe(0);

    // The cog taken (with the pack worn): the toast in gold under the bar, the cog gold, the pips lime.
    const debug = readScript('debug');
    await page.evaluate(
      async ({ runs, at }) => window.__E2E__?.replay('debug', { runs }, 4, { stopAtTick: at }),
      { runs: debug.runs, at: debug.trophyTick + 2 },
    );
    [gold = 0] = await colourCounts(page, toastRow, [COLOR.gold]);
    expect(gold, 'COG FOUND! AIRLOCK OPEN under the bar').toBeGreaterThan(60);
    [rightGold = 0, lime = 0] = await colourCounts(page, right, [COLOR.gold, COLOR.lime]);
    expect(rightGold, 'the cog icon turns gold').toBeGreaterThan(8);
    expect(lime, 'fuel pips while the pack is worn').toBeGreaterThan(4);
    await expectNothingAtTheBottom(page, view, 'with the toast up and the pack worn');

    // The airlock: LEVEL CLEAR +200 on a plate under the bar, with the score tallied in gold.
    const room = readScript('test');
    await page.evaluate(async ({ runs }) => window.__E2E__?.replay('test', { runs }, 6), { runs: room.runs });
    const [white = 0, bannerGold = 0] = await colourCounts(page, { x: 0, y: 26, w: view.w, h: 50 }, [COLOR.white, COLOR.gold]);
    expect(white, 'LEVEL CLEAR +200 at 2x').toBeGreaterThan(200);
    expect(bannerGold, 'the score tally').toBeGreaterThan(30);
    await expectNothingAtTheBottom(page, view, 'with the clear banner up');
    expect(problems).toEqual([]);
  });
});

test.describe('top bar over the level', () => {
  test('is a band over the world: a dark strip behind it dims the level in its rows, so no crystal or wall top reads as part of it', async ({ page }) => {
    const problems = await open(page);
    const view = await viewSize(page);
    // Level 1's ready gate: its first crystals and the cog stand in the rows the bar covers (at 844 x 390 and at
    // 568 x 320 alike: the camera puts the hero's feet at 60 % of the view's height).
    await playRoom(page, 'level-01');
    const drawn = (await page.evaluate(() => window.__E2E__?.hud()?.drawn ?? null)) ?? [];
    const strip = drawn.find((d) => d.kind === 'Rectangle' && d.x <= 0 && d.y <= 0 && d.x + d.w >= view.w);
    expect.soft(strip, 'a strip behind the bar across the whole view').toBeDefined();
    expect.soft(strip?.h ?? 0, 'from the top down past the bar and its shadow').toBeGreaterThanOrEqual(12);
    // Everything in the bar's rows that is not the bar's own text or icons is dark: the level shows through dimmed.
    const own = drawn.filter((d) => d !== strip);
    const bright = await brightOutside(page, { x: 0, y: 0, w: view.w, h: 12 }, own);
    expect(bright, 'bright level pixels in the bar\'s rows, outside its text and icons').toBe(0);
    expect(problems).toEqual([]);
  });

  test('never dims the hero: risen to the top of the view, he is drawn below the strip (568 x 320, the 284 x 160 view)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 568, height: 320 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const problems = await open(page);
    // Tick 119 of the test room's route: he has climbed to the top of the camera's air band, the highest he is drawn
    // on this route (the review's picture: the strip darkened his hat and antenna there, his sprite's top at row 8).
    const room = readScript('test');
    await page.evaluate(async ({ runs }) => window.__E2E__?.replay('test', { runs }, 1, { stopAtTick: 119 }), { runs: room.runs });
    const hero = await page.evaluate(() => window.__E2E__?.heroOnPage() ?? null);
    const box = await page.locator('#game canvas').boundingBox();
    const viewW = await page.locator('#game canvas').evaluate((c) => (c as HTMLCanvasElement).width);
    if (!hero || !box) throw new Error('no hero or no canvas');
    const k = box.width / viewW;
    expect(viewW).toBe(284);
    const spriteTop = (hero.y - box.y) / k;
    expect(spriteTop, 'the top of his sprite, art px from the top of the view').toBeGreaterThanOrEqual(STRIP_H);
    expect(spriteTop, 'he is up at the top of the band, not resting lower').toBeLessThan(40);
    expect(problems).toEqual([]);
    await context.close();
  });
});

/**
 * Screen pixels in `rect` (art px of the view) brighter than slate in any channel, outside `skip` (art px, each
 * grown by a pixel for the text's shadow). The frame is frozen while it is taken.
 */
async function brightOutside(page: Page, rect: ArtRect, skip: readonly ArtRect[]): Promise<number> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const viewW = await page.locator('#game canvas').evaluate((c) => (c as HTMLCanvasElement).width);
  const k = box.width / viewW;
  await hook.freeze(page, true);
  const png = await page.screenshot({ clip: { x: box.x + rect.x * k, y: box.y + rect.y * k, width: rect.w * k, height: rect.h * k } });
  await hook.freeze(page, false);
  return page.evaluate(
    async ({ b64, at, k, skip }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return -1;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const scale = img.width / (at.w * k); // screenshot px per CSS px
      let n = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const ax = at.x + x / scale / k;
          const ay = at.y + y / scale / k;
          if (skip.some((r) => ax >= r.x - 1 && ax < r.x + r.w + 1 && ay >= r.y - 1 && ay < r.y + r.h + 1)) continue;
          const i = (y * img.width + x) * 4;
          if (Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) > 120) n += 1;
        }
      }
      return n;
    },
    { b64: png.toString('base64'), at: rect, k, skip: [...skip] },
  );
}

/**
 * Nothing of the top bar's scene along the bottom of the screen (docs/LEVELS.md rule 11), whatever its colour and
 * whatever kind of object would draw it:
 * - the bottom edge of every object of the HUD scene that has bounds (any kind: an Image, a Sprite, a Text ...) is
 *   above the bottom 14 art rows;
 * - and the HUD scene changes no pixel of those rows: the frame drawn again as it stands, with the scene and without
 *   it, is the same there. This also sees a kind that has no bounds (a Graphics), and anything a future kind draws.
 * The same comparison over the bar's own rows must find the bar, so a measure that sees nothing cannot pass.
 */
async function expectNothingAtTheBottom(page: Page, view: { w: number; h: number }, when: string): Promise<void> {
  const drawn = (await page.evaluate(() => window.__E2E__?.hud()?.drawn ?? null)) ?? [];
  expect(drawn.length, `the HUD draws something ${when}`).toBeGreaterThan(3);
  const low = drawn.filter((d) => d.y + d.h > view.h - 14);
  expect(low, `HUD objects reaching into the bottom 14 rows ${when}`).toEqual([]);
  const hudPixels = (rect: ArtRect): Promise<number | null> => page.evaluate((r) => window.__E2E__?.hudPixels(r) ?? null, rect);
  expect(await hudPixels({ x: 0, y: 0, w: view.w, h: 14 }), `the HUD scene's pixels in the bar's rows ${when}`).toBeGreaterThan(100);
  expect(await hudPixels({ x: 0, y: view.h - 14, w: view.w, h: 14 }), `pixels the HUD scene draws in the bottom 14 rows ${when}`).toBe(0);
}

// ---------------------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------------------

test.describe('pause menu', () => {
  test('menu text casts its void drop shadow, seen where it shows: PAUSED over the panel', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'test');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await hook.menu(page)).length).toBe(5);
    await page.waitForTimeout(100);
    const view = await viewSize(page);
    const box = await page.locator('#game canvas').boundingBox();
    const resume = (await hook.menu(page))[0];
    if (!box || !resume) throw new Error('no canvas or no RESUME');
    const k = box.width / view.w;
    // The heading's band: as wide as the buttons, just above RESUME, all inside the panel (night, not void).
    const heading = { x: Math.round((resume.x - box.x) / k), y: Math.round((resume.y - box.y) / k) - 20, w: Math.round(resume.w / k), h: 18 };
    const [white = 0, shadow = 0] = await colourCounts(page, heading, [COLOR.white, COLOR.void]);
    expect(white, 'PAUSED at 2x').toBeGreaterThan(300);
    expect(shadow, 'its void shadow, one pixel down and right of every letter').toBeGreaterThan(white / 4);
    expect(problems).toEqual([]);
  });

  /** Pauses by `how`, checks the world stands still, and closes with RESUME into the ready gate. */
  async function pauseAndResume(page: Page, how: () => Promise<void>, what: string): Promise<void> {
    await how();
    await expect.poll(() => hook.scenes(page), { message: what }).toContain('Pause');
    expect(await hook.mode(page), what).toBe('paused');
    expect(await label(page), what).toContain('PAUSED. RESUME. RESTART LEVEL -1 LIFE. QUIT TO TITLE');
    const tick = (await hook.state(page))?.tick;
    await page.waitForTimeout(250);
    expect((await hook.state(page))?.tick, `${what}: nothing is stepped while paused`).toBe(tick);
    await pick(page, 'RESUME');
    await expect.poll(() => hook.mode(page), { message: what }).toBe('running');
    // The scene stops on the next frame (Phaser queues scene operations).
    await expect.poll(() => hook.scenes(page), { message: what }).toEqual(['Play', 'Hud']);
    // The resume path: back behind the ready gate (holdReady), every control let go.
    expect((await hook.state(page))?.phase, what).toBe('ready');
    expect(await hook.held(page), what).toEqual({ left: false, right: false, jump: false, fire: false, thrust: false });
  }

  test('opens by Esc, by P, on blur and when the page is hidden; RESUME goes back behind the ready gate', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'test');
    // Get the world going first, so the resume visibly shuts the gate again.
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await hook.state(page))?.phase).toBe('playing');

    await pauseAndResume(page, () => page.keyboard.press('Escape'), 'Esc');
    await page.keyboard.up('ArrowRight');
    await pauseAndResume(page, () => page.keyboard.press('p'), 'P');
    await pauseAndResume(
      page,
      () =>
        page.evaluate(() => {
          window.dispatchEvent(new Event('blur'));
        }),
      'blur',
    );
    await pauseAndResume(
      page,
      () =>
        page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
          document.dispatchEvent(new Event('visibilitychange'));
        }),
      'hidden',
    );
    // Esc closes it too.
    await page.keyboard.press('Escape');
    await expect.poll(() => hook.scenes(page)).toContain('Pause');
    await page.keyboard.press('Escape');
    await expect.poll(() => hook.mode(page)).toBe('running');
    expect(problems).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('opens when the phone is turned upright, and stays open when it is turned back', async ({ page }) => {
      const problems = await open(page, '&touch=1');
      await playRoom(page, 'test');
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('no viewport');
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await expect(page.locator('#rotate')).toBeVisible();
      await page.setViewportSize(viewport);
      await expect(page.locator('#rotate')).toBeHidden();
      await expect.poll(() => hook.scenes(page)).toContain('Pause');
      expect(await hook.mode(page)).toBe('paused');
      await pick(page, 'RESUME');
      await expect.poll(() => hook.mode(page)).toBe('running');
      expect(problems).toEqual([]);
    });

    test('the ROTATE message fits a narrow portrait window, and is redrawn for a narrower one', async ({ page }) => {
      const problems = await open(page, '&touch=1');
      const inside = async (): Promise<{ left: number; right: number; width: number; window: number }> => {
        await expect(page.locator('#rotate [data-part="words"]')).toBeVisible();
        // Words and phone measured in one go inside the page: a resize redraws (replaces) both.
        const at = await page.evaluate(() => {
          const box = (selector: string): { x: number; y: number; width: number; height: number } | null => {
            const r = document.querySelector(selector)?.getBoundingClientRect();
            return r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
          };
          return { words: box('#rotate [data-part="words"]'), phone: box('#rotate .rotate__phone'), window: window.innerWidth };
        });
        const { words: box, phone } = at;
        if (!box) throw new Error('no rotate message');
        // The phone outline above the words, inside the window too.
        if (!phone) throw new Error('no phone outline');
        expect(phone.y + phone.height, 'the phone is above the words').toBeLessThanOrEqual(box.y);
        expect(phone.x).toBeGreaterThanOrEqual(box.x);
        expect(phone.x + phone.width).toBeLessThanOrEqual(box.x + box.width);
        return { left: box.x, right: box.x + box.width, width: box.width, window: at.window };
      };
      // A wide portrait phone: the message at its full 3 CSS px per art px (101 art px: 303 CSS px).
      await page.setViewportSize({ width: 390, height: 844 });
      const wide = await inside();
      expect(wide.width).toBeCloseTo(303, 0);
      // 300 CSS px: the message gets smaller instead of being cut off at both ends.
      await page.setViewportSize({ width: 300, height: 640 });
      await expect.poll(async () => (await inside()).width).toBeLessThan(wide.width);
      const narrow = await inside();
      expect(narrow.left).toBeGreaterThanOrEqual(8);
      expect(narrow.right).toBeLessThanOrEqual(narrow.window - 8);
      expect(problems).toEqual([]);
    });

    test('the ROTATE message shows a phone outline turning: upright, then sideways, in turn', async ({ page }) => {
      const problems = await open(page, '&touch=1');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#rotate .rotate__phone')).toBeVisible();
      // Two frames of 16 x 16 art px on top of each other, drawn at twice the words' size (6 CSS px per art px here).
      const frames = page.locator('#rotate .rotate__phone canvas');
      await expect(frames).toHaveCount(2);
      const size = await frames.first().boundingBox();
      expect(size?.width).toBeCloseTo(96, 0);
      // Shown in turn: sample which frame is opaque over two turns; both are seen, never both at once.
      const seen = new Set<string>();
      for (let i = 0; i < 16; i++) {
        const shown = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('#rotate .rotate__phone canvas')].filter((c) => getComputedStyle(c).opacity === '1').map((c) => c.className),
        );
        expect(shown.length, `one frame at a time: ${shown.join(', ')}`).toBe(1);
        seen.add(shown[0] ?? '');
        await page.waitForTimeout(200);
      }
      expect([...seen].sort()).toEqual(['rotate__sideways', 'rotate__upright']);
      expect(problems).toEqual([]);
    });
  });

  test('RESTART LEVEL costs a life and keeps the score; QUIT TO TITLE goes back to the title', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'debug');
    // Two crystals lie right of the start: walk into them (+20), stop before the spikes.
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await hook.state(page))?.score ?? 0).toBeGreaterThanOrEqual(10);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(100);
    const before = await hook.state(page);
    if (!before) throw new Error('no session');

    await page.keyboard.press('Escape');
    await expect.poll(() => hook.scenes(page)).toContain('Pause');
    await pick(page, 'RESTART LEVEL -1 LIFE');
    await expect.poll(() => hook.mode(page)).toBe('running');
    const after = await hook.state(page);
    expect(after?.lives).toBe(before.lives - 1);
    expect(after?.score).toBe(before.score);
    expect(after?.phase).toBe('ready');
    expect(after?.levelId).toBe('debug');

    await page.keyboard.press('Escape');
    await expect.poll(() => hook.scenes(page)).toContain('Pause');
    await pick(page, 'QUIT TO TITLE');
    await expect.poll(() => hook.scenes(page)).toEqual(['Title']);
    expect(await label(page)).toContain('START');
    expect(problems).toEqual([]);
  });

  test('the SOUND and BUZZ switches are saved', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'test');
    await page.keyboard.press('Escape');
    await expect.poll(() => hook.scenes(page)).toContain('Pause');
    await pick(page, 'SOUND ON');
    await pick(page, 'BUZZ ON');
    await expect.poll(async () => (await hook.menu(page)).map((i) => i.label)).toContain('SOUND OFF');
    expect((await hook.menu(page)).map((i) => i.label)).toContain('BUZZ OFF');
    expect((await hook.sound(page))?.muted).toBe(true);
    expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? '{}')).toMatchObject({ sound: false, vibration: false });
    expect(await label(page)).toContain('SOUND OFF. BUZZ OFF');
    expect(problems).toEqual([]);
  });
});

/** Opens the pause menu in the movement room on a page of this size and returns the menu's items. */
async function pauseMenuAt(browser: Browser, width: number, height: number, scale: number) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  await open(page);
  await playRoom(page, 'test');
  await page.keyboard.press('Escape');
  await expect.poll(() => hook.scenes(page)).toContain('Pause');
  const items = await hook.menu(page);
  await context.close();
  return items;
}

test('menu rows and switches are at least 44 CSS px tall on phones and in short browser tabs', async ({ browser }) => {
  for (const [w, h, scale] of [
    [844, 390, 1],
    [568, 320, 1],
    [740, 360, 2.75],
    [740, 280, 1],
    [1280, 720, 1],
  ] as const) {
    const items = await pauseMenuAt(browser, w, h, scale);
    expect(items.map((i) => i.label), `${w}x${h}@${scale}`).toEqual(['RESUME', 'RESTART LEVEL -1 LIFE', 'QUIT TO TITLE', 'SOUND ON', 'BUZZ ON']);
    for (const item of items) {
      expect(item.h, `${item.label} at ${w}x${h}@${scale}`).toBeGreaterThanOrEqual(44 - 0.01);
      expect(item.w, `${item.label} at ${w}x${h}@${scale}`).toBeGreaterThanOrEqual(44 - 0.01);
      expect(item.y, `${item.label} inside the window`).toBeGreaterThanOrEqual(0);
      expect(item.y + item.h, `${item.label} inside the window`).toBeLessThanOrEqual(h + 0.01);
    }
  }
});

// ---------------------------------------------------------------------------------------
// Game over and win
// ---------------------------------------------------------------------------------------

test.describe('end screens', () => {
  test('game over: GAME OVER in amber (not crimson), the score, TRY AGAIN and TITLE', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(async (runs) => window.__E2E__?.replay('debug', { runs }, 4, { until: 'sessionEnd' }), DIE_THRICE.runs);
    await expect.poll(() => hook.scenes(page)).toEqual(['End']);
    // A test room is never saved: no best line.
    await expect.poll(() => label(page)).toMatch(/^GAME OVER\. SCORE \d{5}\. TRY AGAIN - LEVEL 1\. TITLE$/);
    expect((await hook.menu(page)).map((i) => i.label)).toEqual(['TRY AGAIN - LEVEL 1', 'TITLE']);
    for (const item of await hook.menu(page)) expect(item.h, `${item.label}: a row a finger can hit`).toBeGreaterThanOrEqual(44 - 0.01);

    // The heading: amber (not crimson, which cannot be read on void). Its void drop shadow cannot be seen on the void
    // sky; the shadow of menu text is checked where it shows, over the pause panel ('pause menu' below).
    await page.waitForTimeout(300); // the shutter
    const view = await viewSize(page);
    const items = await hook.menu(page);
    const box = await page.locator('#game canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    const k = box.width / view.w;
    const top = Math.floor(((items[0]?.y ?? 0) - box.y) / k);
    const [amber = 0, crimson = 0] = await colourCounts(page, { x: 0, y: 0, w: view.w, h: top }, [COLOR.amber, COLOR.crimson]);
    expect(amber, 'GAME OVER in amber').toBeGreaterThan(100);
    expect(crimson).toBe(0);

    await pick(page, 'TRY AGAIN - LEVEL 1');
    await expect.poll(() => hook.scenes(page)).toEqual(['Play', 'Hud']);
    const state = await hook.state(page);
    expect(state?.levelId).toBe('debug');
    expect(state?.lives).toBe(3);
    expect(state?.score).toBe(0);
    expect(problems).toEqual([]);
  });

  test('win: THE FOUNDRY IS LIT!, then the score, the lives bonus and the total, line by line; back to the title', async ({ page }) => {
    const problems = await open(page);
    const room = readScript('test');
    await page.evaluate(async (runs) => window.__E2E__?.replay('test', { runs }, 8, { until: 'sessionEnd' }), [...room.runs, [0, 120] as const]);
    await expect.poll(() => hook.scenes(page)).toEqual(['End']);
    expect(await label(page)).toBe('THE FOUNDRY IS LIT!. SCORE 00300. LIVES LEFT 3 X 500. TOTAL 01800. PLAY AGAIN. TITLE');

    // The lines come one after another, 30 frames apart: early on only the heading is drawn.
    const view = await viewSize(page);
    const lines = { x: 0, y: 0, w: view.w, h: Math.floor(view.h / 2) + 10 };
    const [goldEarly = 0] = await colourCounts(page, lines, [COLOR.gold]);
    await page.waitForTimeout(2200);
    const [goldLate = 0] = await colourCounts(page, lines, [COLOR.gold]);
    expect(goldLate, 'SCORE and TOTAL appeared under the heading').toBeGreaterThan(goldEarly);
    // The backdrop glows amber at the bottom.
    const [plain = 0] = await colourCounts(page, { x: 0, y: view.h - 30, w: view.w, h: 4 }, [COLOR.void]);
    expect(plain, 'the sky near the ridge is no longer plain void').toBeLessThan(view.w);

    await pick(page, 'TITLE');
    await expect.poll(() => hook.scenes(page)).toEqual(['Title']);
    expect(problems).toEqual([]);
  });
});
