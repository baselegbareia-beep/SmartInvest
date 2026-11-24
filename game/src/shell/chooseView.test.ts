import { describe, expect, it } from 'vitest';

import { TILE_PX } from '../core/types';
import type { ViewTuning } from '../core/types';
import { TUNING } from '../tuning';

import { chooseView, cssPerArtPx } from './chooseView';
import type { Insets } from './chooseView';

/**
 * Two kinds of check.
 * - The device table of docs/PHASER4-NOTES.md, section 6, on the numbers it was measured with
 *   (ruling R11: at least 17 x 10 tiles, at most 30 x 14). A change to src/tuning.ts cannot break it.
 * - Properties that must hold for any sensible numbers, checked on R11 and on the live `TUNING.view`.
 */
const R11: ViewTuning = { viewMinCols: 17, viewMinRows: 10, viewMaxCols: 30, viewMaxRows: 14 };

const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
const notch = (left: number, right: number): Insets => ({ left, right, top: 0, bottom: 0 });

interface DeviceRow {
  name: string;
  cssW: number;
  cssH: number;
  dpr: number;
  left: number;
  right: number;
  /** Expected zoom, view size in art px, and canvas offset in device px. */
  zoom: number;
  viewW: number;
  viewH: number;
  offX: number;
  offY: number;
}

const row = (
  cssW: number,
  cssH: number,
  dpr: number,
  left: number,
  right: number,
  zoom: number,
  viewW: number,
  viewH: number,
  offX: number,
  offY: number,
  note = '',
): DeviceRow => ({
  name: `${cssW} x ${cssH} @${dpr}${left + right > 0 ? `, notch ${left} + ${right}` : ''}${note ? ` (${note})` : ''}`,
  cssW,
  cssH,
  dpr,
  left,
  right,
  zoom,
  viewW,
  viewH,
  offX,
  offY,
});

/** Every row of the table in docs/PHASER4-NOTES.md, section 6, in its order. */
const DEVICE_TABLE: readonly DeviceRow[] = [
  row(568, 320, 2, 0, 0, 4, 284, 160, 0, 0),
  row(667, 375, 2, 0, 0, 4, 333, 187, 1, 1),
  row(667, 325, 2, 0, 0, 4, 333, 162, 1, 1),
  row(800, 360, 3, 0, 0, 6, 400, 180, 0, 0),
  row(844, 390, 3, 47, 47, 7, 321, 167, 142, 0),
  row(844, 390, 3, 0, 0, 7, 361, 167, 2, 0),
  row(915, 412, 2.625, 0, 0, 6, 400, 180, 0, 0),
  row(915, 412, 2.625, 30, 0, 6, 387, 180, 79, 0),
  row(932, 430, 3, 59, 59, 8, 305, 161, 178, 1),
  row(1080, 810, 2, 0, 0, 7, 308, 224, 2, 26, 'row cap'),
  row(1280, 720, 1, 0, 0, 4, 320, 180, 0, 0),
  row(1920, 1080, 1, 0, 0, 6, 320, 180, 0, 0),
  row(3440, 1300, 1, 0, 0, 8, 430, 162, 0, 2),
  row(3000, 800, 1, 0, 0, 5, 480, 160, 300, 0, 'column cap'),
  row(740, 360, 2.75, 0, 0, 6, 339, 165, 0, 0),
  row(851, 393, 3.5, 44, 0, 8, 353, 171, 154, 3),
  row(1366, 768, 1.25, 0, 0, 6, 284, 160, 1, 0),
  row(1536, 864, 1.5, 0, 0, 8, 288, 162, 0, 0),
  row(320, 568, 2, 0, 0, 2, 320, 224, 0, 344, 'a portrait window'),
  row(740, 304, 2.75, 0, 0, 5, 407, 167, 0, 0, 'a browser tab with a toolbar'),
  row(740, 280, 2.75, 0, 0, 4, 480, 192, 57, 1, 'toolbar and status bar, column cap'),
  row(568, 232, 2, 0, 0, 2, 480, 224, 88, 8, 'a small phone with a toolbar, both caps'),
];

describe('chooseView: the device table (docs/PHASER4-NOTES.md, section 6)', () => {
  it('holds all 22 rows', () => {
    expect(DEVICE_TABLE).toHaveLength(22);
  });

  it.each(DEVICE_TABLE)('$name', (d) => {
    const v = chooseView(d.cssW, d.cssH, d.dpr, notch(d.left, d.right), R11);
    expect({ zoom: v.zoom, viewW: v.viewW, viewH: v.viewH }).toEqual({ zoom: d.zoom, viewW: d.viewW, viewH: d.viewH });
    expect(v.cssLeft * d.dpr).toBeCloseTo(d.offX, 9);
    expect(v.cssTop * d.dpr).toBeCloseTo(d.offY, 9);
  });

  it('prints whether the live tuning still asks for the 17 x 10 to 30 x 14 tiles the table was measured with (never fails)', () => {
    // Not a rule, so an owner's edit of the `view` group cannot fail `npm run check` here (docs/ARCHITECTURE.md
    // section 12): the properties below are checked on the live numbers too. After an accepted change, refresh
    // the table above and the one in docs/PHASER4-NOTES.md (section 6) with the new numbers, then update R11.
    const changed = (Object.keys(R11) as (keyof ViewTuning)[]).filter((key) => TUNING.view[key] !== R11[key]);
    if (changed.length > 0) {
      console.log(`chooseView: TUNING.view differs from the device table's numbers in ${changed.map((key) => `${key} (${TUNING.view[key]}, table ${R11[key]})`).join(', ')}`);
    }
  });

  it('gives the sizes on the glass that docs/ARCHITECTURE.md (11.5) quotes', () => {
    const glass = (cssW: number, cssH: number, dpr: number): number =>
      Math.round(cssPerArtPx(chooseView(cssW, cssH, dpr, NO_INSETS, R11), dpr) * 100) / 100;
    expect(glass(568, 320, 2)).toBe(2);
    expect(glass(740, 360, 2.75)).toBe(2.18);
    expect(glass(740, 304, 2.75)).toBe(1.82);
    expect(glass(740, 280, 2.75)).toBe(1.45);
    expect(glass(568, 232, 2)).toBe(1);
  });
});

/** One window of the sweep, and everything that is wrong with the view chosen for it. */
function problems(cssW: number, cssH: number, dpr: number, safe: Insets, t: ViewTuning): string[] {
  const v = chooseView(cssW, cssH, dpr, safe, t);
  const out: string[] = [];
  const bad = (what: string): void => {
    out.push(`${cssW} x ${cssH} @${dpr}, notch ${safe.left} + ${safe.right}: ${what} (${JSON.stringify(v)})`);
  };

  const minW = t.viewMinCols * TILE_PX;
  const minH = t.viewMinRows * TILE_PX;
  const maxW = t.viewMaxCols * TILE_PX;
  const maxH = t.viewMaxRows * TILE_PX;
  // The space the game may use, in device pixels, as docs/ARCHITECTURE.md (11.5) defines it.
  const dw = Math.max(1, Math.floor((cssW - safe.left - safe.right) * dpr));
  const dh = Math.max(1, Math.floor(cssH * dpr));
  const safeLeftPx = Math.round(safe.left * dpr);

  // Whole numbers everywhere.
  if (!Number.isInteger(v.zoom) || v.zoom < 1) bad('the zoom is not a whole number of device pixels');
  if (!Number.isInteger(v.viewW) || !Number.isInteger(v.viewH) || v.viewW < 1 || v.viewH < 1) bad('the view is not whole art pixels');

  // No fractional device pixel: the canvas starts on the device grid, and each art pixel is `zoom` device pixels.
  const offX = v.cssLeft * dpr;
  const offY = v.cssTop * dpr;
  if (Math.abs(offX - Math.round(offX)) > 1e-6 || Math.abs(offY - Math.round(offY)) > 1e-6) bad('the canvas starts between two device pixels');
  const left = Math.round(offX);
  const top = Math.round(offY);
  const right = left + v.viewW * v.zoom;
  const bottom = top + v.viewH * v.zoom;

  // The picture always fits: inside the window's height, and inside the width between the notches.
  if (top < 0 || bottom > dh) bad('the picture is taller than the window');
  if (left < safeLeftPx || right > safeLeftPx + dw) bad('the picture leaves the safe area');
  if (left < 0 || right > Math.ceil(cssW * dpr)) bad('the picture is wider than the window');
  // In CSS px the same thing, to within half a device pixel (a notch is rarely a whole number of device pixels).
  const half = 0.5 / dpr + 1e-9;
  if (v.cssLeft < safe.left - half) bad('the picture reaches under the left notch');
  if (v.cssLeft + (v.viewW * v.zoom) / dpr > cssW - safe.right + half) bad('the picture reaches under the right notch');
  if (v.cssTop < 0 || v.cssTop + (v.viewH * v.zoom) / dpr > cssH + 1e-9) bad('the picture leaves the window vertically');

  // Never more than the cap.
  if (v.viewW > maxW || v.viewH > maxH) bad('the view shows more than the cap');

  if (dw >= minW && dh >= minH) {
    // At least the minimum, and the zoom is the largest that still shows it.
    if (v.viewW < minW || v.viewH < minH) bad('the view shows less than the minimum');
    const next = v.zoom + 1;
    if (Math.floor(dw / next) >= minW && Math.floor(dh / next) >= minH) bad('a larger zoom would still show the minimum');
  } else {
    // A window too small for the minimum even at zoom 1 shows what it can.
    if (v.zoom !== 1) bad('a tiny window must use zoom 1');
    if (v.viewW !== Math.min(dw, maxW) || v.viewH !== Math.min(dh, maxH)) bad('a tiny window must show all it has');
  }

  // Nothing is wasted: without the cap the borders are thinner than one art pixel; and they are centred.
  const spareX = dw - v.viewW * v.zoom;
  const spareY = dh - v.viewH * v.zoom;
  if (v.viewW < maxW && spareX >= v.zoom) bad('a whole art pixel column is left unused');
  if (v.viewH < maxH && spareY >= v.zoom) bad('a whole art pixel row is left unused');
  if (Math.abs(left - safeLeftPx - (spareX - (left - safeLeftPx))) > 1) bad('the picture is not centred horizontally');
  if (Math.abs(top - (spareY - top)) > 1) bad('the picture is not centred vertically');

  return out;
}

const RATIOS = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 2.75, 3, 3.5, 4];
const NOTCHES: readonly Insets[] = [NO_INSETS, notch(44, 0), notch(0, 34), notch(47, 47), notch(59, 59), notch(30.4, 0)];

function sweep(t: ViewTuning): { cases: number; found: string[] } {
  const found: string[] = [];
  let cases = 0;
  for (const dpr of RATIOS) {
    for (let cssW = 200; cssW <= 3900; cssW += 37) {
      for (let cssH = 120; cssH <= 2200; cssH += 41) {
        for (const safe of NOTCHES) {
          cases++;
          if (found.length < 5) found.push(...problems(cssW, cssH, dpr, safe, t));
        }
      }
    }
  }
  return { cases, found };
}

describe('chooseView: properties over a sweep of window sizes, pixel ratios and notches', () => {
  it('the picture always fits, the zoom is the largest that fits, and nothing lands between device pixels (R11 numbers)', () => {
    const { cases, found } = sweep(R11);
    expect(cases).toBeGreaterThan(300000);
    expect(found).toEqual([]);
  });

  it('the same on the live numbers of src/tuning.ts', () => {
    expect(sweep(TUNING.view).found).toEqual([]);
  });

  it('the same for other sensible numbers, so no size is built into the code', () => {
    expect(sweep({ viewMinCols: 12, viewMinRows: 7, viewMaxCols: 40, viewMaxRows: 9 }).found).toEqual([]);
    expect(sweep({ viewMinCols: 20, viewMinRows: 12, viewMaxCols: 20, viewMaxRows: 12 }).found).toEqual([]);
  });

  it('every phone-sized window (every CSS size from 480 x 220 to 960 x 450 in steps of 1 x 7) at ratios 2 to 3.5', () => {
    const found: string[] = [];
    for (const dpr of [2, 2.625, 2.75, 3, 3.5]) {
      for (let cssW = 480; cssW <= 960; cssW++) {
        for (let cssH = 220; cssH <= 450; cssH += 7) {
          if (found.length < 5) found.push(...problems(cssW, cssH, dpr, NO_INSETS, R11));
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe('chooseView: odd input', () => {
  it('a window smaller than the minimum shows what it has at zoom 1', () => {
    expect(chooseView(200, 100, 1, NO_INSETS, R11)).toEqual({ zoom: 1, viewW: 200, viewH: 100, cssLeft: 0, cssTop: 0 });
  });

  it('a window with no size yet, or a pixel ratio of 0 or NaN, still gives a usable view', () => {
    for (const [w, h, dpr] of [
      [0, 0, 2],
      [-5, 300, 2],
      [Number.NaN, Number.NaN, Number.NaN],
      [800, 360, 0],
      [800, 360, Number.POSITIVE_INFINITY],
    ] as const) {
      const v = chooseView(w, h, dpr, NO_INSETS, R11);
      for (const n of [v.zoom, v.viewW, v.viewH]) expect(Number.isInteger(n) && n >= 1).toBe(true);
      expect(Number.isFinite(v.cssLeft) && Number.isFinite(v.cssTop)).toBe(true);
    }
    // A ratio that cannot be used counts as 1.
    expect(chooseView(800, 360, 0, NO_INSETS, R11)).toEqual(chooseView(800, 360, 1, NO_INSETS, R11));
  });

  it('notches wider than the window, or negative ones, do not break it', () => {
    const squeezed = chooseView(300, 200, 2, notch(200, 200), R11);
    expect(squeezed.viewW).toBe(1);
    expect(squeezed.zoom).toBe(1);
    expect(chooseView(800, 360, 3, notch(-20, -20), R11)).toEqual(chooseView(800, 360, 3, NO_INSETS, R11));
  });

  it('top and bottom insets do not move the picture: the game uses the full height', () => {
    expect(chooseView(844, 390, 3, { left: 47, right: 47, top: 10, bottom: 21 }, R11)).toEqual(
      chooseView(844, 390, 3, notch(47, 47), R11),
    );
  });
});
