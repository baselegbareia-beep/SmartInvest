import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { InputScript } from '../src/core/types.ts';
import { STRIP_H, TOAST_BAND_BOTTOM } from '../src/shell/hudModel.ts';

/**
 * The top bar's messages (docs/ART-AND-SOUND.md section 8):
 * - at a desk, taking the blaster or the pack names the keys that use it (the touch pad shows FIRE and THRUST
 *   buttons, a keyboard showed nothing: X and Z were named nowhere in the game);
 * - the toast never hides the hero: while he is drawn under its band (level 10's cog is taken in flight, high in the
 *   view) the band and its words are see-through.
 * Played through the test hook's replays of the levels' proofs (e2e/scripts), which press nothing on the page.
 */

interface LevelScript extends InputScript {
  readonly trophyTick: number;
  readonly winTick: number;
}
const readScript = (id: string): LevelScript => JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as LevelScript;

const FIRE_HINT = 'X FIRES THE BLASTER';
const THRUST_HINT = 'HOLD Z OR SHIFT TO THRUST';

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

type Seen = { tick: number; toast: string | null };

/** Replays `id`'s proof (`ticksPerFrame` a frame) and returns every toast shown, read on every frame inside the page. */
async function toastsOf(page: Page, id: string, ticksPerFrame: number): Promise<string[]> {
  const script = readScript(id);
  await page.evaluate(() => {
    const w = window as Window & { __seen?: Seen[]; __watch?: boolean };
    w.__seen = [];
    w.__watch = true;
    const loop = (): void => {
      const hook = w.__E2E__;
      w.__seen?.push({ tick: hook?.state()?.tick ?? -1, toast: hook?.hud()?.toast ?? null });
      if (w.__watch) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.evaluate(([i, r, n]) => window.__E2E__?.replay(i, { runs: r }, n), [id, script.runs, ticksPerFrame] as const);
  const seen = await page.evaluate(() => {
    const w = window as Window & { __seen?: Seen[]; __watch?: boolean };
    w.__watch = false;
    return w.__seen ?? [];
  });
  return [...new Set(seen.flatMap((s) => (s.toast === null ? [] : [s.toast])))];
}

test.describe('at a desk', () => {
  test('taking the blaster says which key fires it (level 5)', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page);
    expect(await toastsOf(page, 'level-05', 4)).toContain(FIRE_HINT);
    expect(problems).toEqual([]);
  });

  test('taking the pack says which keys thrust (level 7)', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page);
    expect(await toastsOf(page, 'level-07', 4)).toContain(THRUST_HINT);
    expect(problems).toEqual([]);
  });
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('taking the blaster names no key (FIRE appears on the pad)', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page, '&touch=1');
    const toasts = await toastsOf(page, 'level-05', 4);
    expect(toasts, 'the cog toast still shows').toContain('COG FOUND! AIRLOCK OPEN');
    expect(toasts).not.toContain(FIRE_HINT);
    expect(problems).toEqual([]);
  });
});

test.describe('the smallest phone, 568 x 320 at 2', () => {
  test.use({ viewport: { width: 568, height: 320 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("level 10: while the hero is drawn under the cog toast's band, the band and its words are see-through (they hid him)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page, '&touch=1');
    const script = readScript('level-10');
    type Frame = {
      toast: string | null;
      hero: { x: number; y: number; w: number; h: number } | null;
      band: { x: number; y: number; w: number; h: number; alpha: number } | null;
      words: number | null;
    };
    await page.evaluate(() => {
      const w = window as Window & { __frames?: Frame[]; __watch?: boolean };
      w.__frames = [];
      w.__watch = true;
      const loop = (): void => {
        const hook = w.__E2E__;
        const hud = hook?.hud() ?? null;
        const toast = hud?.toast ?? null;
        if (toast !== null) {
          const drawn = (hud?.drawn ?? []) as { kind: string; x: number; y: number; w: number; h: number; alpha?: number }[];
          // The band: the dark rectangle that hangs from the strip (the strip itself spans the view's width).
          const band = drawn.find((d) => d.kind === 'Rectangle' && d.y >= 13 && d.y <= 15 && d.h >= 10 && d.h <= 13) ?? null;
          const words = drawn.find((d) => d.kind === 'BitmapText' && d.y >= 15 && d.y <= 17 && band !== null && d.x >= band.x && d.x + d.w <= band.x + band.w + 2) ?? null;
          w.__frames?.push({
            toast,
            hero: hook?.look()?.heroBox ?? null,
            band: band ? { x: band.x, y: band.y, w: band.w, h: band.h, alpha: band.alpha ?? 1 } : null,
            words: words ? (words.alpha ?? 1) : null,
          });
        }
        if (w.__watch) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.evaluate(([r, t]) => window.__E2E__?.replay('level-10', { runs: r }, 1, { stopAtTick: t }), [script.runs, script.trophyTick + 140] as const);
    const frames = await page.evaluate(() => {
      const w = window as Window & { __frames?: Frame[]; __watch?: boolean };
      w.__watch = false;
      return w.__frames ?? [];
    });
    const cog = frames.filter((f) => f.toast === 'COG FOUND! AIRLOCK OPEN' && f.band !== null);
    expect(cog.length, 'frames with the cog toast').toBeGreaterThan(40);
    for (const f of cog) {
      expect(f.band?.y).toBe(STRIP_H);
      expect((f.band?.y ?? 0) + (f.band?.h ?? 0)).toBe(TOAST_BAND_BOTTOM);
    }
    const meets = (f: Frame): boolean => {
      const h = f.hero;
      const b = f.band;
      return h !== null && b !== null && h.x < b.x + b.w && b.x < h.x + h.w && h.y < b.y + b.h && b.y < h.y + h.h;
    };
    const under = cog.filter(meets);
    const clear = cog.filter((f) => !meets(f));
    expect(under.length, 'frames with the hero under the band (the case of the finding)').toBeGreaterThan(10);
    expect(under.filter((f) => (f.band?.alpha ?? 1) > 0.3 || (f.words ?? 1) > 0.4), 'frames that hide him').toEqual([]);
    // Away from him it is the toast as before: solid.
    expect(clear.some((f) => (f.band?.alpha ?? 0) >= 0.99 && (f.words ?? 0) >= 0.99), 'a solid toast while he is clear').toBe(true);
    expect(problems).toEqual([]);
  });
});
