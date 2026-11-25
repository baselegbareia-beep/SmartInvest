import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { COLOR } from '../src/art/palette.ts';
import type { InputScript, SaveData } from '../src/core/types.ts';
import { STRIP_H } from '../src/shell/hudModel.ts';

/**
 * Menus that guard a choice a player makes by accident (docs/ART-AND-SOUND.md section 9, docs/ARCHITECTURE.md 11.5):
 * - the end screens take no pick until their buttons light (Space is also JUMP: a jump pressed as the last life
 *   went picked TRY AGAIN before GAME OVER was drawn, and PLAY AGAIN wiped the victory screen);
 * - NEW GAME over a run in progress asks again before it throws the run away;
 * - on the last life, RESTART LEVEL says that it ends the game;
 * - M pressed with the pause menu open turns the drawn SOUND switch with the sound;
 * - in keyboard play the pause menu names the keys (X fires and Z thrusts are named nowhere else).
 * Driven with real keys, clicks and taps; `window.__E2E__` reads the scenes, the menu and the session.
 */

const PROGRESS_KEY = 'moon-foundry:progress';
const KEYS_LINE = 'SPACE JUMP  X FIRE  Z THRUST';

/** The debug room, walked into its spikes three times: a game over. */
const DIE_THRICE: InputScript = { runs: [[0, 15], [2, 100], [0, 90], [2, 100], [0, 90], [2, 100], [0, 200]] };

interface RoomScript extends InputScript {
  readonly trophyTick: number;
  readonly winTick: number;
}
const readScript = (id: string): RoomScript =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as RoomScript;

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

async function open(page: Page, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.goto(`./?e2e=1${query}`);
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

/** Opens the title with `stored` as the saved progress, as a visit after an earlier one. */
async function openWith(page: Page, stored: SaveData, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.goto(`./?e2e=1${query}`);
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: PROGRESS_KEY, value: JSON.stringify(stored) });
  await page.reload();
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const save = (fields: Partial<SaveData>): SaveData => ({ v: 1, unlocked: 0, bestScore: 0, finished: false, resume: null, ...fields });
const stored = async (page: Page): Promise<SaveData | null> => {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PROGRESS_KEY);
  return raw === null ? null : (JSON.parse(raw) as SaveData);
};
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const state = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const menu = (page: Page) => page.evaluate(() => window.__E2E__?.menu() ?? []);
const labels = async (page: Page): Promise<string[]> => (await menu(page)).map((i) => i.label);
const texts = (page: Page) => page.evaluate(() => window.__E2E__?.menuText() ?? []);
const label = (page: Page): Promise<string> => page.locator('#game canvas').evaluate((c) => c.getAttribute('aria-label') ?? '');

/** How many pixels of a PNG have any of `colours` (give or take 3 a channel), in its rows `fromRow` to `toRow` (all of them if left out). */
async function colourCount(page: Page, png: Buffer, colours: readonly number[], fromRow = 0, toRow = Number.MAX_SAFE_INTEGER): Promise<number> {
  return page.evaluate(
    async ({ b64, wanted, from, to }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return -1;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const row = Math.floor(i / 4 / img.width);
        if (row < from || row > to) continue;
        const near = (w: number): boolean =>
          Math.abs((d[i] ?? 0) - ((w >> 16) & 255)) <= 3 && Math.abs((d[i + 1] ?? 0) - ((w >> 8) & 255)) <= 3 && Math.abs((d[i + 2] ?? 0) - (w & 255)) <= 3;
        if (wanted.some(near)) n += 1;
      }
      return n;
    },
    { b64: png.toString('base64'), wanted: [...colours], from: fromRow, to: toRow },
  );
}

/**
 * The pause panel's frame in a PNG of the canvas, `scale` image px per art px: the plate's top row is a run of
 * `earthlight` and the glow under it a run of `amber` (src/art/sprites/ui.ts). Counts the pixels of `white` (headings,
 * labels) and `lightSteel` (the key line) inside the frame's 3 px at the top and its 4 px at the bottom, between its
 * sides. A count of -1 means no panel was found.
 */
async function lettersOnFrame(page: Page, png: Buffer, scale: number): Promise<{ top: number; bottom: number }> {
  return page.evaluate(
    async ({ b64, k, earth, amber, white, steel }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return { top: -1, bottom: -1 };
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const is = (x: number, y: number, w: number): boolean => {
        const i = (y * img.width + x) * 4;
        return Math.abs((d[i] ?? 0) - ((w >> 16) & 255)) <= 3 && Math.abs((d[i + 1] ?? 0) - ((w >> 8) & 255)) <= 3 && Math.abs((d[i + 2] ?? 0) - (w & 255)) <= 3;
      };
      /** The longest run of `colour` in row y: [start, end) in image px. */
      const run = (y: number, colour: number): [number, number] => {
        let best: [number, number] = [0, 0];
        let start = -1;
        for (let x = 0; x <= img.width; x++) {
          const on = x < img.width && is(x, y, colour);
          if (on && start < 0) start = x;
          if (!on && start >= 0) {
            if (x - start > best[1] - best[0]) best = [start, x];
            start = -1;
          }
        }
        return best;
      };
      const long = 60 * k;
      let top = -1;
      for (let y = 0; y < img.height && top < 0; y++) if (run(y, earth)[1] - run(y, earth)[0] >= long) top = y;
      let glow = -1;
      for (let y = img.height - 1; y >= 0 && glow < 0; y--) if (run(y, amber)[1] - run(y, amber)[0] >= long) glow = y;
      if (top < 0 || glow < 0) return { top: -1, bottom: -1 };
      // The top row is cut by 1 px at each end; the sides are 3 px of frame.
      const [x0, x1] = run(top, earth);
      const left = x0 - k + 3 * k;
      const right = x1 + k - 3 * k;
      const count = (fromY: number, toY: number, colours: readonly number[]): number => {
        let n = 0;
        for (let y = fromY; y <= toY; y++) for (let x = left; x < right; x++) if (colours.some((w) => is(x, y, w))) n += 1;
        return n;
      };
      return { top: count(top, top + 3 * k - 1, [white]), bottom: count(glow - 4 * k + 1, glow, [white, steel]) };
    },
    { b64: png.toString('base64'), k: scale, earth: COLOR.earthlight, amber: COLOR.amber, white: COLOR.white, steel: COLOR.lightSteel },
  );
}

/** Clicks the menu item with these words where the hook says it is (whether or not the menu takes picks yet). */
async function click(page: Page, words: string): Promise<void> {
  await expect.poll(() => labels(page), { timeout: 5000 }).toContain(words);
  const item = (await menu(page)).find((i) => i.label === words);
  if (!item) throw new Error(`no menu item "${words}"`);
  await page.mouse.click(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
}

/** Waits until the scenes are exactly `keys`, checked on every frame inside the page (no poll interval in between). */
async function sceneIs(page: Page, keys: readonly string[]): Promise<void> {
  await page.waitForFunction((k) => JSON.stringify(window.__E2E__?.scenes() ?? []) === JSON.stringify(k), keys, { polling: 'raf', timeout: 30_000 });
}

/** Waits until the menu on screen takes picks (its buttons are lit). */
async function armed(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__E2E__?.menu() ?? []).some((i) => i.armed), null, { polling: 'raf', timeout: 10_000 });
}

/** Starts a development room through the hook and waits until its intro card is gone. */
async function playRoom(page: Page, id: string): Promise<void> {
  await page.evaluate((room) => {
    window.__E2E__?.startLevel(room);
  }, id);
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
}

/** In the debug room: walks right into the spikes until a life is lost, then waits for the hero back at the ready gate. */
async function dieOnce(page: Page): Promise<void> {
  const before = (await state(page))?.lives ?? 0;
  await page.waitForTimeout(400); // the ready gate opens on a press made after its shortest wait (readyMinTicks)
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await state(page))?.lives, { timeout: 10_000 }).toBe(before - 1);
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => (await state(page))?.phase, { timeout: 10_000 }).toBe('ready');
}

// ---------------------------------------------------------------------------------------
// End screens
// ---------------------------------------------------------------------------------------

test.describe('end screens take no pick until their buttons light', () => {
  test('game over: Space pressed as the screen comes up (a jump) leaves GAME OVER up; a fresh Space once lit picks TRY AGAIN', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(async (runs) => window.__E2E__?.replay('debug', { runs }, 4, { until: 'sessionEnd' }), DIE_THRICE.runs);
    await sceneIs(page, ['End']);
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    expect(await scenes(page), 'one jump press does not skip GAME OVER').toEqual(['End']);
    expect(await label(page)).toMatch(/^GAME OVER\./);
    // The focus may move before the buttons light (Up wraps to TITLE, Down comes back).
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await menu(page)).map((i) => i.focused)).toEqual([false, true]);
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await menu(page)).map((i) => i.focused)).toEqual([true, false]);

    await armed(page);
    await page.keyboard.press('Space');
    await sceneIs(page, ['Play', 'Hud']);
    expect(await state(page)).toMatchObject({ levelId: 'debug', lives: 3, score: 0 });
    expect(problems).toEqual([]);
  });

  test('the intro card after TRY AGAIN: neither the Space that picked it nor a press begun in its first frames skips it', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(async (runs) => window.__E2E__?.replay('debug', { runs }, 4, { until: 'sessionEnd' }), DIE_THRICE.runs);
    await sceneIs(page, ['End']);
    await armed(page);
    // Space picks TRY AGAIN and stays down: the new level's card comes up and stays (its press began before the card).
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'intro', null, { polling: 'raf' });
    await page.waitForTimeout(600); // past introSkipAfterFrames (20 frames), with Space held all along
    expect((await state(page))?.mode).toBe('intro');
    await page.keyboard.up('Space');
    // A press begun after the card's first 20 frames skips it, into the ready gate.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page))?.mode).toBe('running');
    expect((await state(page))?.phase).toBe('ready');
    expect(problems).toEqual([]);
  });

  test('game over: a tap on TRY AGAIN as the screen comes up does nothing; a tap once lit plays', async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(async (runs) => window.__E2E__?.replay('debug', { runs }, 4, { until: 'sessionEnd' }), DIE_THRICE.runs);
    await sceneIs(page, ['End']);
    await page.waitForTimeout(100);
    await click(page, 'TRY AGAIN - LEVEL 1');
    await page.waitForTimeout(400);
    expect(await scenes(page)).toEqual(['End']);
    await armed(page);
    await click(page, 'TRY AGAIN - LEVEL 1');
    await sceneIs(page, ['Play', 'Hud']);
    expect(problems).toEqual([]);
  });

  test('win: Space pressed as the screen comes up leaves it up; the buttons light only once every score line is shown', async ({ page }) => {
    const problems = await open(page);
    const room = readScript('test');
    await page.evaluate(async (runs) => window.__E2E__?.replay('test', { runs }, 8, { until: 'sessionEnd' }), [...room.runs, [0, 120] as const]);
    await sceneIs(page, ['End']);
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    expect(await scenes(page), 'one jump press does not wipe the victory screen').toEqual(['End']);
    await armed(page);
    expect((await texts(page)).filter((t) => t.text.trim() !== '' && !t.shown), 'lines still hidden when the buttons light').toEqual([]);
    await page.keyboard.press('Space');
    await sceneIs(page, ['Play', 'Hud']);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// NEW GAME over a run in progress
// ---------------------------------------------------------------------------------------

test.describe('NEW GAME with a run in progress asks again', () => {
  const RUN = save({ unlocked: 4, bestScore: 1234, resume: { levelIndex: 4, score: 1200, lives: 2 } });

  test('one click keeps the run and asks again; a second click starts level 1; waiting puts the button back', async ({ page }) => {
    const problems = await openWith(page, RUN);
    expect(await labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME']);
    await click(page, 'NEW GAME');
    await page.waitForTimeout(300);
    expect(await scenes(page), 'one click does not start a new game').toEqual(['Title']);
    expect(await stored(page)).toEqual(RUN);
    expect(await labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME? PRESS AGAIN']);
    expect(await label(page)).toContain('NEW GAME? PRESS AGAIN');

    // Left alone, it goes back to NEW GAME (and a click then asks again).
    await expect.poll(() => labels(page), { timeout: 6000 }).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME']);
    await click(page, 'NEW GAME');
    await click(page, 'NEW GAME? PRESS AGAIN');
    await expect.poll(async () => (await state(page))?.levelIndex, { timeout: 5000 }).toBe(0);
    expect(await state(page)).toMatchObject({ levelIndex: 0, score: 0, lives: 3 });
    await expect.poll(() => stored(page)).toMatchObject({ unlocked: 4, bestScore: 1234, resume: { levelIndex: 0, score: 0, lives: 3 } });
    expect(problems).toEqual([]);
  });

  test('with keys: Space on NEW GAME asks; moving the focus takes the question back; Space twice starts', async ({ page }) => {
    const problems = await openWith(page, RUN);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME? PRESS AGAIN']);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME']);
    expect(await scenes(page)).toEqual(['Title']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME? PRESS AGAIN']);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state(page))?.levelIndex, { timeout: 5000 }).toBe(0);
    expect(problems).toEqual([]);
  });

  test('with nothing to lose (CONTINUE - LEVEL 1 with no score), one click starts at once', async ({ page }) => {
    const problems = await openWith(page, save({ resume: { levelIndex: 0, score: 0, lives: 3 } }));
    expect(await labels(page)).toEqual(['CONTINUE - LEVEL 1', 'NEW GAME']);
    await click(page, 'NEW GAME');
    await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
    expect(problems).toEqual([]);
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('the question says TAP AGAIN', async ({ page }) => {
      const problems = await openWith(page, RUN, '&touch=1');
      const item = (await menu(page)).find((i) => i.label === 'NEW GAME');
      if (!item) throw new Error('no NEW GAME');
      await page.touchscreen.tap(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2));
      await expect.poll(() => labels(page)).toEqual(['CONTINUE - LEVEL 5', 'NEW GAME? TAP AGAIN']);
      expect(await stored(page)).toEqual(RUN);
      expect(problems).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------
// The pause menu
// ---------------------------------------------------------------------------------------

test.describe('pause menu', () => {
  test('on the last life RESTART LEVEL says it ends the game; with more lives it says it costs one', async ({ page }) => {
    test.setTimeout(60_000);
    const problems = await open(page);
    await playRoom(page, 'debug');
    await dieOnce(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => labels(page)).toEqual(['RESUME', 'RESTART LEVEL -1 LIFE', 'QUIT TO TITLE', 'SOUND ON', 'BUZZ ON']);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page))?.mode).toBe('running');

    await dieOnce(page);
    expect((await state(page))?.lives).toBe(1);
    await page.keyboard.press('Escape');
    await expect.poll(() => labels(page)).toEqual(['RESUME', 'GIVE UP - GAME OVER', 'QUIT TO TITLE', 'SOUND ON', 'BUZZ ON']);
    expect(await label(page)).toContain('GIVE UP - GAME OVER');
    await click(page, 'GIVE UP - GAME OVER');
    await expect.poll(() => scenes(page)).toEqual(['End']);
    expect(problems).toEqual([]);
  });

  test('M pressed with the menu open turns the drawn SOUND switch and the canvas name with the sound', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'test');
    await page.keyboard.press('Escape');
    await expect.poll(() => labels(page)).toContain('SOUND ON');
    // The focus on the SOUND switch first (RESUME, RESTART, QUIT, SOUND), so that only the switch's state changes below.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await menu(page)).find((i) => i.focused)?.label).toBe('SOUND ON');
    const row = (await menu(page)).find((i) => i.label === 'SOUND ON');
    if (!row) throw new Error('no SOUND switch');
    const clip = { x: row.x, y: row.y, width: row.w, height: row.h };
    const shot = async (): Promise<Buffer> => {
      // Two frames first: a change made by a key is drawn on the next frame.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          }),
      );
      await page.evaluate(() => window.__E2E__?.freeze(true));
      const png = await page.screenshot({ clip });
      await page.evaluate(() => window.__E2E__?.freeze(false));
      return png;
    };
    const before = await shot();

    await page.keyboard.press('m');
    await expect.poll(async () => (await page.evaluate(() => window.__E2E__?.sound() ?? null))?.muted).toBe(true);
    await expect.poll(() => label(page)).toContain('SOUND OFF');
    expect(await labels(page)).toContain('SOUND OFF');
    expect((await shot()).equals(before), 'the switch is drawn OFF').toBe(false);

    // Enter on the switch (which now reads SOUND OFF) turns the sound on, and it says so.
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await page.evaluate(() => window.__E2E__?.sound() ?? null))?.muted).toBe(false);
    await expect.poll(() => label(page)).toContain('SOUND ON');
    expect((await shot()).equals(before), 'drawn ON again, as before').toBe(true);
    expect(problems).toEqual([]);
  });

  test('in keyboard play it names the keys (X and Z are named nowhere else); the canvas name says them too', async ({ page }) => {
    const problems = await open(page);
    await playRoom(page, 'test');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await texts(page)).map((t) => t.text)).toContain(KEYS_LINE);
    expect(await label(page)).toContain(KEYS_LINE);
    expect(problems).toEqual([]);
  });

  /** Opens the pause menu over the test room with keys, freezes a drawn frame, and returns the canvas as a PNG and the view's height. */
  async function pausedShot(page: Page): Promise<{ png: Buffer; viewH: number }> {
    await playRoom(page, 'test');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await texts(page)).map((t) => t.text)).toContain(KEYS_LINE);
    const canvas = page.locator('#game canvas');
    const viewH = await canvas.evaluate((c) => (c as HTMLCanvasElement).height);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.__E2E__?.freeze(true);
              resolve();
            });
          });
        }),
    );
    const png = await canvas.screenshot();
    await page.evaluate(() => window.__E2E__?.freeze(false));
    return { png, viewH };
  }
  /** Image px per art px of a PNG of the canvas (its height is in the PNG header). */
  const scaleOf = (png: Buffer, viewH: number): number => png.readUInt32BE(20) / viewH;

  // The key line makes the panel 141 px tall: centred in a view 160 or 167 px tall, its top edge cut across the dimmed
  // top bar (LEVEL 1 and the score). In a phone's browser tab the room under the bar is shorter still: at 673 x 310
  // (162 px, rows of 24) the panel's top row lay on the bar's last, and at 740 x 280 (2x text, 192 px) its frame cut
  // across the bar's words at y = 4. There its gaps, and at 740 x 280 its padding, give way so that it begins under
  // the bar. The panel's frame is earthlight and light steel; nothing under the 60 % dim is.
  for (const [w, h, dpr] of [[568, 320, 2], [844, 390, 3], [673, 310, 2.625], [740, 280, 2.75]] as const) {
    test.describe(`at ${w} x ${h} (ratio ${dpr})`, () => {
      test.use({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });

      test('in keyboard play the panel, key line and all, keeps off the top bar', async ({ page }) => {
        const problems = await open(page);
        const { png, viewH } = await pausedShot(page);
        const k = scaleOf(png, viewH);
        const frame = [COLOR.earthlight, COLOR.lightSteel];
        expect(await colourCount(page, png, frame), 'the panel\'s frame is drawn').toBeGreaterThan(100);
        expect(await colourCount(page, png, frame, 0, Math.round(STRIP_H * k) - 1), 'pixels of the panel\'s frame over the top bar').toBe(0);
        expect(problems).toEqual([]);
      });
    });
  }

  // A short window at 1 CSS px per art px (224 px): 2x text fit there only with the panel padded by 1 px, so the 3x
  // PAUSED and the 2x key line were drawn across the plate's frame. The padding now stops at the frame, and the menu
  // is drawn at 1x inside it.
  for (const [w, h, dpr] of [[540, 360, 1], [568, 232, 2]] as const) {
    test.describe(`at ${w} x ${h} (ratio ${dpr})`, () => {
      test.use({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });

      test('in keyboard play no letter of the pause menu is drawn on the panel\'s frame', async ({ page }) => {
        const problems = await open(page);
        const { png, viewH } = await pausedShot(page);
        const k = scaleOf(png, viewH);
        expect(k, 'whole image px per art px').toBe(Math.round(k));
        const on = await lettersOnFrame(page, png, k);
        expect(on.top, 'the panel is found').toBeGreaterThanOrEqual(0);
        expect(on, 'letter pixels on the frame (top: white; bottom: white and light steel)').toEqual({ top: 0, bottom: 0 });
        expect(problems).toEqual([]);
      });
    });
  }

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('it does not name keys (the pad shows its own buttons)', async ({ page }) => {
      const problems = await open(page, '&touch=1');
      await playRoom(page, 'test');
      const pause = await page.locator('[data-btn="pause"]').boundingBox();
      if (!pause) throw new Error('no PAUSE button');
      await page.touchscreen.tap(Math.round(pause.x + pause.width / 2), Math.round(pause.y + pause.height / 2));
      await expect.poll(() => labels(page)).toContain('RESUME');
      expect((await texts(page)).map((t) => t.text)).not.toContain(KEYS_LINE);
      expect(await label(page)).not.toContain(KEYS_LINE);
      expect(problems).toEqual([]);
    });
  });
});
