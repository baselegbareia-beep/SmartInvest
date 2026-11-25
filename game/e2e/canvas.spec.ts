import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { InputScript } from '../src/core/types.ts';

/**
 * No WebGL at all (blocked by the browser, its settings or a blocklisted GPU): Phaser falls back to its Canvas renderer,
 * which ignores tints and draws no nine-slice (docs/PHASER4-NOTES.md section 3). What the game says by those must
 * still be drawn: the cog slot still empty, the keyboard focus in a menu, the plates under buttons and panels.
 * Chromium without WebGL: --disable-webgl, for the whole file (a launch option needs its own worker).
 */

interface RoomScript extends InputScript {
  readonly trophyTick: number;
}
const readScript = (id: string): RoomScript => JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as RoomScript;

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
const labels = async (page: Page): Promise<string[]> => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((i) => i.label);

async function playRoom(page: Page, id: string): Promise<void> {
  await page.evaluate((room) => {
    window.__E2E__?.startLevel(room);
  }, id);
  await expect.poll(async () => (await state(page))?.mode, { timeout: 5000 }).toBe('running');
}

/** A screenshot of the canvas (frozen while it is taken), as PNG bytes. */
async function canvasShot(page: Page, clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  await page.evaluate(() => window.__E2E__?.freeze(true));
  const png = clip ? await page.screenshot({ clip }) : await page.locator('#game canvas').screenshot();
  await page.evaluate(() => window.__E2E__?.freeze(false));
  return png;
}

const GOLD = 0xffd65c;
const RUST = 0x8a5a44;
const NIGHT = 0x151a36;
const INDIGO = 0x232a54;

/** How many pixels of a PNG have each of `colours` (give or take 3 a channel). */
async function colourCounts(page: Page, png: Buffer, colours: readonly number[]): Promise<number[]> {
  return page.evaluate(
    async ({ b64, wanted }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return wanted.map(() => -1);
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      return wanted.map((w) => {
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs((d[i] ?? 0) - ((w >> 16) & 255)) <= 3 && Math.abs((d[i + 1] ?? 0) - ((w >> 8) & 255)) <= 3 && Math.abs((d[i + 2] ?? 0) - (w & 255)) <= 3) n += 1;
        }
        return n;
      });
    },
    { b64: png.toString('base64'), wanted: [...colours] },
  );
}

/** How many pixels of two same-sized PNGs differ. */
async function differing(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const pixels = async (b64: string): Promise<Uint8ClampedArray> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) return new Uint8ClampedArray();
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [await pixels(x), await pixels(y)];
      let n = 0;
      for (let i = 0; i < Math.min(p.length, q.length); i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) n += 1;
      return n;
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

test.use({ launchOptions: { args: ['--disable-webgl'] } });

test('runs on Canvas', async ({ page }) => {
  const problems = await open(page);
  // The game's canvas has a 2D context: asking it for WebGL gives nothing.
  expect(await page.locator('#game canvas').evaluate((c) => (c as HTMLCanvasElement).getContext('webgl2') === null && (c as HTMLCanvasElement).getContext('webgl') === null)).toBe(true);
  expect(problems).toEqual([]);
});

test('the title\'s cog is the indigo plate behind the name, as in WebGL (it was the gold cog, through the white letters)', async ({ page }) => {
  const problems = await open(page);
  await page.waitForTimeout(300); // the shutter
  const [gold = 0, indigo = 0] = await colourCounts(page, await canvasShot(page), [GOLD, INDIGO]);
  // Nothing on the title is drawn gold without a tint (text is white on Canvas): no gold at all.
  expect(gold, 'gold pixels on the title').toBe(0);
  expect(indigo, 'indigo pixels of the plate').toBeGreaterThan(300);
  expect(problems).toEqual([]);
});

test('the top bar\'s cog slot is rust before the cog is taken and gold after (it was gold all through the level)', async ({ page }) => {
  const problems = await open(page);
  const room = readScript('level-01');
  // The slot is drawn by the HUD; compare it before the cog (tick 300) and after (the trophy tick + 40).
  const slotShot = async (tick: number): Promise<Buffer> => {
    await page.evaluate(
      ([r, t]) => {
        const hook = window.__E2E__;
        void hook?.replay('level-01', { runs: r }, 4, { until: 'sessionEnd' });
        return hook?.freezeAtTick(t);
      },
      [room.runs, tick] as const,
    );
    // The bar's 8 px icons sit on its row; level 1 has no items, so the right-most one is the cog's slot.
    const icons = await page.evaluate(() => (window.__E2E__?.hud()?.drawn ?? []).filter((d) => d.kind === 'Image' && d.y === 3 && d.w === 8 && d.h === 8));
    const slot = icons.reduce<(typeof icons)[number] | null>((best, d) => (best === null || d.x > best.x ? d : best), null);
    if (!slot) throw new Error('no cog slot');
    const box = await page.locator('#game canvas').boundingBox();
    const viewW = await page.locator('#game canvas').evaluate((c) => (c as HTMLCanvasElement).width);
    if (!box) throw new Error('no canvas');
    const k = box.width / viewW;
    const png = await page.screenshot({ clip: { x: box.x + slot.x * k, y: box.y + slot.y * k, width: slot.w * k, height: slot.h * k } });
    await page.evaluate(() => window.__E2E__?.freeze(false));
    return png;
  };
  const [emptyGold = 0, emptyRust = 0] = await colourCounts(page, await slotShot(300), [GOLD, RUST]);
  const [takenGold = 0] = await colourCounts(page, await slotShot(room.trophyTick + 40), [GOLD, RUST]);
  expect(emptyGold, 'gold pixels in the slot before the cog').toBe(0);
  expect(emptyRust, 'rust pixels in the slot before the cog').toBeGreaterThan(10);
  expect(takenGold, 'gold pixels in the slot after the cog').toBeGreaterThan(10);
  expect(problems).toEqual([]);
});

test('the pause menu draws its panel and plates, and the keyboard focus moves visibly', async ({ page }) => {
  const problems = await open(page);
  await playRoom(page, 'test');
  await page.keyboard.press('Escape');
  await expect.poll(() => labels(page)).toContain('RESUME');
  await page.waitForTimeout(200);
  const first = await canvasShot(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).findIndex((i) => i.focused)).toBe(1);
  const second = await canvasShot(page);
  expect(await differing(page, first, second), 'pixels changed by moving the focus').toBeGreaterThan(50);

  // The plate under RESUME: night inside the button, not the dimmed game.
  const resume = (await page.evaluate(() => window.__E2E__?.menu() ?? [])).find((i) => i.label === 'RESUME');
  if (!resume) throw new Error('no RESUME');
  const plate = await canvasShot(page, { x: Math.round(resume.x + resume.w * 0.15), y: Math.round(resume.y + resume.h / 2), width: 4, height: 2 });
  const [night = 0] = await colourCounts(page, plate, [NIGHT]);
  expect(night, 'night pixels of the plate beside the label').toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
