import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Frame } from '../src/art/grid.ts';
import { mirrorFrame } from '../src/art/grid.ts';
import { codeToRgb } from '../src/art/palette.ts';
import { SPRITES } from '../src/art/sprites/index.ts';
import type { InputScript } from '../src/core/types.ts';
import { TUNING } from '../src/tuning.ts';

/**
 * How play looks, judged from screenshots of the real build (docs/ARCHITECTURE.md 11.1 and 11.2,
 * docs/PHASER4-NOTES.md sections 6 and 7): the debug room's script is replayed one tick per frame and
 * stopped at moments where the hero is in the air; the picture is frozen and photographed.
 *
 * For every picture:
 * - the canvas is not blank (many palette colours, mostly not the backdrop);
 * - it is pixel-exact: every art pixel is a uniform block of whole device pixels on the page;
 * - the hero is drawn at the whole-pixel position the core gives, `(x >> 8) - 3, (y >> 8) - 2`, on the
 *   same pixel grid as the level: his sprite is found exactly there relative to the spike tile at
 *   column 7, row 11, and nowhere one or two pixels off.
 * The pictures are saved beside this test's other output (test-results), never in the project.
 */

const SCRIPT = JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', 'debug.json'), 'utf8')) as InputScript & { levelId: string };
/** Run ticks of the debug script at which the hero is in the air left of the first crystals, nothing over him. */
const MOMENTS = [18, 26, 34];
/** The spike tile of levels/debug.txt (row 11: `#.P.GG.S...`). */
const SPIKES_AT = { col: 7, row: 11 };
const TILE = 16;

// ---------------------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------------------

/** An image in art pixels: one 0xRRGGBB per pixel. */
interface ArtImage {
  readonly w: number;
  readonly h: number;
  readonly px: Int32Array;
}

/** A PNG as Playwright writes it (8-bit RGB or RGBA, not interlaced) to RGBA bytes. */
function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('decodePng: only 8-bit, non-interlaced PNGs');
      colorType = data[9] ?? -1;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`decodePng: colour type ${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const x = line[i] ?? 0;
      const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let i = 0; i < width; i++) {
      const o = (y * width + i) * 4;
      rgba[o] = cur[i * bpp] ?? 0;
      rgba[o + 1] = cur[i * bpp + 1] ?? 0;
      rgba[o + 2] = cur[i * bpp + 2] ?? 0;
      rgba[o + 3] = bpp === 4 ? (cur[i * bpp + 3] ?? 0) : 255;
    }
    prev = cur;
  }
  return { width, height, rgba };
}

interface Shot {
  readonly art: ArtImage;
  /** Art pixels whose device-pixel block is not one colour. */
  readonly blurred: number;
  /** CSS px per art px, and whether the canvas sits on whole device pixels. */
  readonly scale: number;
  readonly onWholePixels: boolean;
}

/** Photographs the canvas (device scale factor 1) and reads it back in art pixels. */
async function shoot(page: Page, file: string): Promise<Shot> {
  const box = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
    const r = canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, artW: canvas.width, artH: canvas.height };
  });
  const png = await page.screenshot({ path: file });
  const { width, rgba } = decodePng(png);
  const scale = box.width / box.artW;
  const k = Math.round(scale);
  const onWholePixels = Number.isInteger(box.left) && Number.isInteger(box.top) && Math.abs(scale - k) < 1e-6 && Math.abs(box.height / box.artH - k) < 1e-6;
  const px = new Int32Array(box.artW * box.artH);
  let blurred = 0;
  const at = (x: number, y: number): number => {
    const o = (y * width + x) * 4;
    return ((rgba[o] ?? 0) << 16) | ((rgba[o + 1] ?? 0) << 8) | (rgba[o + 2] ?? 0);
  };
  for (let j = 0; j < box.artH; j++) {
    for (let i = 0; i < box.artW; i++) {
      const x0 = Math.round(box.left) + i * k;
      const y0 = Math.round(box.top) + j * k;
      const c = at(x0, y0);
      px[j * box.artW + i] = c;
      let uniform = true;
      for (let dy = 0; dy < k && uniform; dy++) for (let dx = 0; dx < k; dx++) if (at(x0 + dx, y0 + dy) !== c) uniform = false;
      if (!uniform) blurred += 1;
    }
  }
  return { art: { w: box.artW, h: box.artH, px }, blurred, scale, onWholePixels };
}

/** Share of the frame's opaque pixels that the picture shows in exactly their palette colour at (x, y). */
function score(art: ArtImage, frame: Frame, x: number, y: number): number {
  let opaque = 0;
  let same = 0;
  frame.forEach((row, fy) => {
    for (let fx = 0; fx < row.length; fx++) {
      const ch = row.charAt(fx);
      if (ch === '.') continue;
      opaque += 1;
      const ax = x + fx;
      const ay = y + fy;
      if (ax < 0 || ay < 0 || ax >= art.w || ay >= art.h) continue;
      if (art.px[ay * art.w + ax] === codeToRgb(ch)) same += 1;
    }
  });
  return opaque === 0 ? 0 : same / opaque;
}

/** Where a frame is drawn exactly (every opaque pixel in its colour), searching the whole picture. */
function findExact(art: ArtImage, frame: Frame): { x: number; y: number } | null {
  const fw = frame[0]?.length ?? 0;
  for (let y = 0; y + frame.length <= art.h; y++) {
    for (let x = 0; x + fw <= art.w; x++) if (score(art, frame, x, y) === 1) return { x, y };
  }
  return null;
}

/** Every pose the hero can show while playing, both ways round. */
const HERO_POSES: readonly Frame[] = (['hero_idle', 'hero_run', 'hero_jump', 'hero_fall', 'hero_thrust'] as const).flatMap((name) =>
  SPRITES[name].flatMap((frame) => [frame, mirrorFrame(frame)]),
);

const bestPose = (art: ArtImage, x: number, y: number): number => Math.max(...HERO_POSES.map((f) => score(art, f, x, y)));

// ---------------------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------------------

for (const [w, h] of [
  [844, 390],
  [568, 320],
] as const) {
  test(`play at ${w}x${h} is drawn pixel-exact, with the hero on the whole pixel the core gives`, async ({ page }, testInfo) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
    });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('./?e2e=1');
    await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);

    for (const tick of MOMENTS) {
      await page.evaluate(
        async ({ s, t }) => {
          const hook = window.__E2E__;
          if (!hook) throw new Error('window.__E2E__ is missing');
          await hook.replay(s.levelId, { runs: s.runs }, 1, { stopAtTick: t });
          hook.freeze(true);
        },
        { s: SCRIPT, t: tick },
      );
      const state = await page.evaluate(() => window.__E2E__?.state() ?? null);
      expect(state?.tick, 'the replay stopped where asked').toBe(tick);
      expect(state?.phase).toBe('playing');
      const shot = await shoot(page, testInfo.outputPath(`play-${w}x${h}-tick${tick}.png`));
      await page.evaluate(() => {
        window.__E2E__?.freeze(false);
      });

      // Not blank: the level, the backdrop and the top bar make many colours; the backdrop is not all.
      const colours = new Set(shot.art.px);
      expect(colours.size, 'distinct colours on the canvas').toBeGreaterThan(12);
      const voidShare = shot.art.px.filter((c) => c === codeToRgb('0')).length / shot.art.px.length;
      expect(voidShare, 'share of the canvas that is plain backdrop').toBeLessThan(0.9);

      // Pixel-exact: whole CSS px per art px at device scale 1, on whole pixels, every block one colour.
      expect(shot.onWholePixels, `canvas placement (scale ${shot.scale})`).toBe(true);
      expect(shot.blurred, 'art pixels that are not one uniform block').toBe(0);

      // The level grid on screen, from the spike tile; then where the core says the hero is drawn.
      const spikes = findExact(shot.art, SPRITES.spikes[0] ?? []);
      expect(spikes, 'the spike tile is on screen, drawn exactly').not.toBeNull();
      if (!spikes || !state) return;
      const camX = SPIKES_AT.col * TILE - spikes.x;
      const camY = SPIKES_AT.row * TILE - spikes.y;
      const heroX = (state.player.x >> 8) - ((TILE - TUNING.hero.heroHitboxW) >> 1) - camX;
      const heroY = (state.player.y >> 8) - (TILE - TUNING.hero.heroHitboxH) - camY;
      const here = bestPose(shot.art, heroX, heroY);
      expect(here, `the hero's sprite at (${heroX}, ${heroY}) on screen`).toBeGreaterThanOrEqual(0.9);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          expect(bestPose(shot.art, heroX + dx, heroY + dy), `a hero ${dx}, ${dy} px off`).toBeLessThan(here);
        }
      }
    }
    expect(problems).toEqual([]);
  });
}
