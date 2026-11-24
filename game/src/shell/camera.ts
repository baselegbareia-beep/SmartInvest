/**
 * The camera (ruling R12; docs/ARCHITECTURE.md 11.4, docs/PHASER4-NOTES.md section 7).
 *
 * Pure functions in art pixels, with every number from the `camera` group of src/tuning.ts:
 *
 * - Horizontal: the hero sits `camLookAheadPx` behind the view centre, on the side opposite to where
 *   he faces, so more of the level shows ahead. After a turn the look-ahead slides to the other side
 *   at `camLookShiftSpeed` px per tick, and only while the hero moves (turning on the spot does not
 *   swing the view). Around that anchor is a dead zone of `camDeadzoneHalfW` px each way; beyond it
 *   the camera moves by exactly the overshoot, with no smoothing.
 * - Frozen world: outside the phase 'playing' (the ready gate, the death animation, the level exit)
 *   the hero does not move, so the view does not either. The core leaves `vx` at its last value in
 *   those phases; `cameraTarget` reports the hero as neither moving nor standing then, so neither the
 *   look-ahead nor the vertical ease can go on sliding the frozen picture.
 * - Vertical: while the hero stands, his feet line eases toward `camAnchorY` of the view height by
 *   `camVerticalEase` of the remaining distance per tick. In the air the camera holds still unless the
 *   feet leave the band from `camAirBandTop` to `camAirBandBottom` of the view height; then it follows
 *   rigidly. (The band is also kept while standing, which only matters right after the view changed
 *   size: the hero is then never left outside the picture while the ease catches up.)
 * - Bounds: the view never shows anything outside the level. A level narrower or lower than the view
 *   is centred on that axis instead.
 *
 * The state keeps its exact (fractional) position, and the whole-pixel scroll to draw with: give
 * Phaser `cam.setScroll(scrollX, scrollY)` (through `lerpPx` when interpolating), never the fractional
 * `x`, `y`. The target is the hero's DRAWN position in whole pixels (`cameraTarget`), so while the
 * camera follows him, sprite and scroll move by the same whole number and the hero cannot shimmer.
 *
 * Use: `snapCamera` on `levelStarted` and `respawned` (and when the view size changes, if a jump is
 * preferred to a short glide); `stepCamera` once per simulation tick, after `step`. Pure: no Phaser,
 * no DOM.
 */
import { SUB_SHIFT, TILE_PX } from '../core/types';
import type { CameraTuning, Facing, GameState } from '../core/types';

/** A width and a height in art pixels. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/** What the camera follows, in whole art pixels. Build it with `cameraTarget`. */
export interface CameraTarget {
  /** The middle of the hero's box, horizontally. Moves exactly with the drawn sprite. */
  readonly x: number;
  /** The hero's feet line: the bottom edge of his box. Moves exactly with the drawn sprite. */
  readonly feetY: number;
  readonly facing: Facing;
  /** True while the hero moves sideways in a running world (phase 'playing', `vx !== 0`): only then does the look-ahead swing round. */
  readonly moving: boolean;
  /** True while the hero stands on the ground in a running world: only then does the view ease vertically. */
  readonly onGround: boolean;
}

export interface CameraState {
  /** Top-left corner of the view in the level, art px, exact (fractional). Inside the bounds. */
  readonly x: number;
  readonly y: number;
  /** The look-ahead now, px: `+camLookAheadPx` shows more to the right, `-camLookAheadPx` more to the left. */
  readonly look: number;
  /** The scroll to draw with: whole art pixels, inside the level (or centring a small level). */
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * The hero's drawn position as a camera target: whole pixels from the core's sub-pixels. While the
 * world is frozen (any phase but 'playing') the hero counts as neither moving nor standing, so the
 * camera holds still: `vx` keeps its last value through a death or a level exit.
 */
export function cameraTarget(game: GameState): CameraTarget {
  const p = game.run.player;
  const running = game.run.phase === 'playing';
  return {
    // Whole pixels first, then whole offsets, so the target moves exactly as `x >> 8` and `y >> 8` do.
    x: (p.x >> SUB_SHIFT) + (game.phys.heroW >> (SUB_SHIFT + 1)),
    feetY: (p.y >> SUB_SHIFT) + (game.phys.heroH >> SUB_SHIFT),
    facing: p.facing,
    moving: running && p.vx !== 0,
    onGround: running && p.onGround,
  };
}

/** A level's size in art pixels (`LevelData.width` and `height` are in tiles). */
export function levelSize(level: { readonly width: number; readonly height: number }): Size {
  return { w: level.width * TILE_PX, h: level.height * TILE_PX };
}

/** The resting position: hero on the anchor both ways, look-ahead fully to the side he faces. */
export function snapCamera(target: CameraTarget, view: Size, level: Size, t: CameraTuning): CameraState {
  const look = target.facing * t.camLookAheadPx;
  const x = target.x - anchorX(view, look);
  const y = target.feetY - t.camAnchorY * view.h;
  return settle(x, y, look, view, level);
}

/** One simulation tick of camera movement. Returns a new state; `prev` is not changed. */
export function stepCamera(prev: CameraState, target: CameraTarget, view: Size, level: Size, t: CameraTuning): CameraState {
  // The look-ahead swings toward the facing side, only while the hero moves.
  let look = prev.look;
  if (target.moving) look = approach(look, target.facing * t.camLookAheadPx, t.camLookShiftSpeed);

  // Horizontal dead zone around the anchor: beyond it, move by exactly the overshoot.
  let x = prev.x;
  const anchor = anchorX(view, look);
  const screenX = target.x - x;
  if (screenX > anchor + t.camDeadzoneHalfW) x = target.x - (anchor + t.camDeadzoneHalfW);
  else if (screenX < anchor - t.camDeadzoneHalfW) x = target.x - (anchor - t.camDeadzoneHalfW);

  // Vertical: ease toward the anchor while standing; in the air hold inside the band.
  let y = prev.y;
  if (target.onGround) {
    const rest = target.feetY - t.camAnchorY * view.h;
    y += (rest - y) * t.camVerticalEase;
  }
  const bandTop = t.camAirBandTop * view.h;
  const bandBottom = t.camAirBandBottom * view.h;
  const feetOnScreen = target.feetY - y;
  if (feetOnScreen < bandTop) y = target.feetY - bandTop;
  else if (feetOnScreen > bandBottom) y = target.feetY - bandBottom;

  return settle(x, y, look, view, level);
}

/** Where the hero's middle sits on screen, from the view's left edge, for a given look-ahead. */
function anchorX(view: Size, look: number): number {
  return view.w / 2 - look;
}

/** `from` moved toward `to` by at most `by`. */
function approach(from: number, to: number, by: number): number {
  if (from < to) return Math.min(to, from + by);
  if (from > to) return Math.max(to, from - by);
  return from;
}

function settle(x: number, y: number, look: number, view: Size, level: Size): CameraState {
  const cx = bound(x, view.w, level.w);
  const cy = bound(y, view.h, level.h);
  return { x: cx, y: cy, look, scrollX: whole(cx), scrollY: whole(cy) };
}

/** Keeps the view inside the level on one axis, or centres a level smaller than the view. */
function bound(pos: number, viewLen: number, levelLen: number): number {
  // Centred on a whole pixel, so it is already whole. The scroll is negative here and floor rounds it
  // away from zero, so the odd pixel of an odd leftover goes to the NEAR side: the left or top border
  // is one pixel wider than the right or bottom one.
  if (levelLen <= viewLen) return Math.floor((levelLen - viewLen) / 2);
  return Math.min(Math.max(pos, 0), levelLen - viewLen);
}

/** Rounded to a whole pixel, without a negative zero. */
function whole(v: number): number {
  return Math.round(v) + 0;
}
