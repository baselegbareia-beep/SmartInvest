/**
 * How big the picture is (docs/ARCHITECTURE.md 11.5, docs/PHASER4-NOTES.md section 6, ruling R11).
 *
 * The canvas holds the game at one canvas pixel per art pixel and is enlarged by a CSS transform
 * of exactly `zoom / devicePixelRatio`, so one art pixel covers `zoom` whole device pixels. This
 * file picks that whole number, the size of the view in art pixels, and where the canvas goes:
 *
 * - the zoom is the largest that still shows `viewMinCols` x `viewMinRows` tiles;
 * - the view never shows more than `viewMaxCols` x `viewMaxRows` tiles: a larger window gets
 *   borders (the page background) instead;
 * - the canvas is centred in the window's height and in the width left between the notches, on
 *   whole device pixels, so every art pixel lands on the device's pixel grid. (A notch is rarely a
 *   whole number of device pixels wide: its edge is rounded to the nearest one, so the canvas can
 *   reach at most half a device pixel under it.)
 *
 * Every number comes from the `view` group of src/tuning.ts. Pure: no Phaser, no DOM.
 */
import { TILE_PX } from '../core/types';
import type { ViewTuning } from '../core/types';

/** Safe-area insets in CSS pixels (the notch and the home bar). Only left and right move the picture. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface View {
  /** Whole device pixels per art pixel. At least 1. */
  zoom: number;
  /** Canvas size, which is also the camera size, in art pixels. Whole numbers, at least 1. */
  viewW: number;
  viewH: number;
  /** Top-left corner of the canvas in CSS pixels from the window's top-left. Always a whole number of device pixels. */
  cssLeft: number;
  cssTop: number;
}

/** A missing or nonsensical measurement (a window with no size yet, a ratio of 0) counts as this. */
function positive(value: number, otherwise: number): number {
  return Number.isFinite(value) && value > 0 ? value : otherwise;
}

/**
 * @param cssW window width in CSS px (`window.innerWidth`)
 * @param cssH window height in CSS px (`window.innerHeight`)
 * @param dpr  device pixels per CSS px (`window.devicePixelRatio`)
 * @param safe the notch and home-bar margins in CSS px
 * @param t    `TUNING.view`
 */
export function chooseView(cssW: number, cssH: number, dpr: number, safe: Insets, t: ViewTuning): View {
  const ratio = positive(dpr, 1);
  const safeLeft = positive(safe.left, 0);
  const safeRight = positive(safe.right, 0);

  // Device pixels the game may use: the full height, and the width between the notches.
  const dw = Math.max(1, Math.floor((positive(cssW, 0) - safeLeft - safeRight) * ratio));
  const dh = Math.max(1, Math.floor(positive(cssH, 0) * ratio));

  // The largest whole zoom that still shows the minimum number of tiles both ways.
  const zoom = Math.max(
    1,
    Math.min(Math.floor(dw / (t.viewMinCols * TILE_PX)), Math.floor(dh / (t.viewMinRows * TILE_PX))),
  );

  // floor: the canvas is never larger than the space it has. The cap gives large windows borders.
  const viewW = Math.min(Math.floor(dw / zoom), t.viewMaxCols * TILE_PX);
  const viewH = Math.min(Math.floor(dh / zoom), t.viewMaxRows * TILE_PX);

  // Centre what is left over. Offsets are whole device pixels, so no art pixel straddles two of them.
  const offX = Math.round(safeLeft * ratio) + Math.floor((dw - viewW * zoom) / 2);
  const offY = Math.floor((dh - viewH * zoom) / 2);

  return { zoom, viewW, viewH, cssLeft: offX / ratio, cssTop: offY / ratio };
}

/** CSS pixels per art pixel: how large one art pixel is on the glass. `menuLayout` sizes the menus with it. */
export function cssPerArtPx(view: View, dpr: number): number {
  return view.zoom / positive(dpr, 1);
}
