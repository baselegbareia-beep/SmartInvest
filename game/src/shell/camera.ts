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
 *   size: the hero is then never left outside the picture while the ease catches up.) The band's top is
 *   measured from under the top bar's dark strip (`STRIP_H` rows, src/shell/hudModel.ts), not from the
 *   view's top edge: a hero rising to the top of the band, and the fuel bar over his head while he
 *   thrusts, are never drawn dimmed under the strip, and he sees as much undimmed level above him as the
 *   band showed before the strip was there. A full jump from rest still stays inside the band.
 * - Bounds: the view never shows anything outside the level. A level narrower or lower than the view
 *   is centred on that axis instead. One exception, on touch screens: the drawn buttons cover the
 *   view's corners (docs/ART-AND-SOUND.md section 8: "the lower corners belong to the thumbs"), so the
 *   view may pass each side wall by the whole width the buttons on that side reach into it
 *   (`PadReach`: LEFT and RIGHT on the left; JUMP, FIRE, THRUST and PAUSE on the right). Stopped at a
 *   wall, the level's edge is then drawn where the buttons end: the airlock beside an east wall, a
 *   crystal in the last column and the hero standing there are never held under a button. Space and
 *   stars show beyond the wall. The bound only lets the camera go there; the dead zone decides where
 *   it goes, so away from the walls nothing changes. Likewise the bottom row of buttons (`PadReach.bottom`):
 *   the view may pass the level's bottom edge by its reach, so a floor that is the level's bottom row is
 *   drawn above the buttons with the hero on his anchor (`passBottom`; a level no taller than the view may be
 *   drawn that much higher than centred). On a touch screen the feet anchor is also kept `camPadClearPx`
 *   above that row (`feetAnchor`), and the air band ends at it, so a falling hero is followed before his feet
 *   reach the buttons.
 * - While the hero thrusts, the air band's top line slides down to `camRiseBandTop` of the view under the
 *   strip at `camRiseLookSpeed` a tick (`rise`), and back after: a hero flying up a shaft sees what is above
 *   him. Ordinary jumps are untouched. The vertical ease never moves more than `camVerticalMaxStep` a tick.
 * - The pass changes without a jump (`passLeft`, `passRight` in the state). When the reach drops (a key
 *   press ends touch mode) the bound does not drop with it: it follows the camera back in as the hero
 *   walks away from the wall. When it grows (a touch turns touch mode back on) the bound widens by
 *   `camPassGlideSpeed` px per tick in a running world, whether the hero moves or stands, as the dead
 *   zone would otherwise pull the view past the wall in one tick: a view stopped at the wall glides out
 *   to make room for the buttons within reach / camPassGlideSpeed ticks (under half a second); until it
 *   has, the airlock by that wall can lie under a button. In a frozen world (the ready gate, a death,
 *   the exit) it waits. A snap (level start, respawn, resize) takes the reach at once.
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

import { STRIP_H } from './hudModel';

/** A width and a height in art pixels. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/**
 * How far the drawn touch buttons reach into the view, in art px: from its left edge (LEFT and RIGHT),
 * from its right edge (JUMP, FIRE, THRUST and PAUSE) and up from its bottom edge (the buttons of the
 * bottom row: LEFT, RIGHT, JUMP, FIRE and THRUST). Zero everywhere when there is no touch pad.
 */
export interface PadReach {
  left: number;
  right: number;
  /** Up from the bottom edge; left out (0) by callers that only know the sides. */
  bottom?: number;
}

/** No touch pad: the camera keeps strictly inside the level. */
export const NO_PAD: Readonly<PadReach> = Object.freeze({ left: 0, right: 0, bottom: 0 });

/** The hero's sprite is one tile wide, centred on `CameraTarget.x` (docs/ART-AND-SOUND.md section 3). */
const HERO_HALF_W = TILE_PX / 2;

/** A rectangle in CSS px (the pad's buttons, the canvas on the page). */
export interface CssRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * How far the drawn buttons reach into the canvas, in whole art px (rounded up), written into `out`.
 * `moveButtons` are LEFT and RIGHT, `actionButtons` the buttons of the right edge (JUMP, FIRE, THRUST and
 * PAUSE), all in CSS px of the same page as `canvas` (window coordinates). FIRE and THRUST count whether
 * or not their item is held, so picking one up never moves the view. `bottom` is how far up from the
 * canvas's bottom edge reach the buttons whose middle lies in its lower half (the thumbs' row; PAUSE at the
 * top is left out). Allocates nothing: the Play scene asks once per frame.
 */
export function padReach(
  moveButtons: readonly CssRect[],
  actionButtons: readonly CssRect[],
  canvas: CssRect,
  cssPerArt: number,
  out: PadReach,
): PadReach {
  const k = cssPerArt > 0 && Number.isFinite(cssPerArt) ? cssPerArt : 1;
  let left = 0;
  for (const b of moveButtons) left = Math.max(left, b.x + b.w - canvas.x);
  let right = 0;
  const canvasRight = canvas.x + canvas.w;
  for (const b of actionButtons) right = Math.max(right, canvasRight - b.x);
  const canvasBottom = canvas.y + canvas.h;
  const middle = canvas.y + canvas.h / 2;
  let bottom = 0;
  for (const b of moveButtons) if (b.y + b.h / 2 > middle) bottom = Math.max(bottom, canvasBottom - b.y);
  for (const b of actionButtons) if (b.y + b.h / 2 > middle) bottom = Math.max(bottom, canvasBottom - b.y);
  // A button wider than the canvas is reach enough: never more than the view.
  const viewW = canvas.w / k;
  const viewH = canvas.h / k;
  // Math.max(0, ...): no negative zero from a button that reaches nothing.
  out.left = Math.max(0, Math.min(Math.ceil(left / k - 1e-9), Math.ceil(viewW)));
  out.right = Math.max(0, Math.min(Math.ceil(right / k - 1e-9), Math.ceil(viewW)));
  out.bottom = Math.max(0, Math.min(Math.ceil(bottom / k - 1e-9), Math.floor(viewH / 2)));
  return out;
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
  /** True in a running world (phase 'playing'): only then does the pass beyond a wall widen. */
  readonly running: boolean;
  /** True while the hero thrusts in a running world: the air band's top line then slides down (more shows above him). */
  readonly thrusting?: boolean;
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
  /**
   * How far the view may pass the level's left and right walls now, art px: the pad's reach on a touch
   * screen, 0 without a pad. After the reach drops it shrinks only as the camera comes back in.
   */
  readonly passLeft: number;
  readonly passRight: number;
  /** How far the view may pass the level's bottom edge now, art px: the reach of the pad's bottom row, as the side passes. */
  readonly passBottom: number;
  /** How far the air band's top line has slid down for a thrusting hero, art px (0 to riseLookMax). */
  readonly rise: number;
}

/** A camera before the first snap. */
export const NO_CAMERA: CameraState = Object.freeze({ x: 0, y: 0, look: 0, scrollX: 0, scrollY: 0, passLeft: 0, passRight: 0, passBottom: 0, rise: 0 });

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
    running,
    thrusting: running && p.thrusting,
  };
}

/** A level's size in art pixels (`LevelData.width` and `height` are in tiles). */
export function levelSize(level: { readonly width: number; readonly height: number }): Size {
  return { w: level.width * TILE_PX, h: level.height * TILE_PX };
}

/**
 * The resting position: hero on the anchor both ways, look-ahead fully to the side he faces.
 * `pad`: how far the touch buttons reach into the view (NO_PAD without them).
 */
export function snapCamera(target: CameraTarget, view: Size, level: Size, t: CameraTuning, pad: Readonly<PadReach> = NO_PAD): CameraState {
  const look = target.facing * t.camLookAheadPx;
  const x = target.x - anchorX(view, look);
  const y = target.feetY - feetAnchor(view, t, pad);
  return settle(x, y, look, view, level, target.x, pad.left, pad.right, pad.bottom ?? 0, 0);
}

/**
 * Where the feet line rests on screen while the hero stands, px from the view's top edge: `camAnchorY` of
 * the view, raised on a touch screen so that it lies at least `camPadClearPx` above the top of the bottom
 * row of buttons (the thumbs cover the lower corners: what lies in a pit ahead, or walks on the floor just
 * below him, is then above them). Never above the air band's top.
 */
export function feetAnchor(view: Size, t: CameraTuning, pad: Readonly<PadReach> = NO_PAD): number {
  const anchor = t.camAnchorY * view.h;
  const reach = pad.bottom ?? 0;
  if (reach <= 0) return anchor;
  return Math.max(STRIP_H + t.camAirBandTop * view.h, Math.min(anchor, view.h - reach - t.camPadClearPx));
}

/**
 * How far the air band's top line may slide down while the hero thrusts: to `camRiseBandTop` of the view
 * under the top bar's strip, never below the feet anchor.
 */
export function riseLookMax(view: Size, t: CameraTuning, pad: Readonly<PadReach> = NO_PAD): number {
  const top = STRIP_H + t.camAirBandTop * view.h;
  const low = Math.min(STRIP_H + t.camRiseBandTop * (view.h - STRIP_H), feetAnchor(view, t, pad));
  return Math.max(0, low - top);
}

/** One simulation tick of camera movement. Returns a new state; `prev` is not changed. */
export function stepCamera(
  prev: CameraState,
  target: CameraTarget,
  view: Size,
  level: Size,
  t: CameraTuning,
  pad: Readonly<PadReach> = NO_PAD,
): CameraState {
  // The look-ahead swings toward the facing side, only while the hero moves.
  let look = prev.look;
  if (target.moving) look = approach(look, target.facing * t.camLookAheadPx, t.camLookShiftSpeed);

  // Horizontal dead zone around the anchor: beyond it, move by exactly the overshoot.
  let x = prev.x;
  const anchor = anchorX(view, look);
  const screenX = target.x - x;
  if (screenX > anchor + t.camDeadzoneHalfW) x = target.x - (anchor + t.camDeadzoneHalfW);
  else if (screenX < anchor - t.camDeadzoneHalfW) x = target.x - (anchor - t.camDeadzoneHalfW);

  // Vertical: ease toward the anchor while standing, never faster than camVerticalMaxStep; in the air hold
  // inside the band.
  let y = prev.y;
  if (target.onGround) {
    const rest = target.feetY - feetAnchor(view, t, pad);
    const by = (rest - y) * t.camVerticalEase;
    y += Math.max(-t.camVerticalMaxStep, Math.min(t.camVerticalMaxStep, by));
  }
  // While he thrusts, the band's top line slides down (more shows above a hero flying up a shaft), and back after.
  const rise = approach(prev.rise, target.thrusting === true ? riseLookMax(view, t, pad) : 0, t.camRiseLookSpeed);
  // The band's top is measured from under the top bar's dark strip, not from the view's top edge: see the header.
  const bandTop = STRIP_H + t.camAirBandTop * view.h + rise;
  // On a touch screen a falling hero is followed before his feet reach the bottom row of buttons.
  const bandBottom = Math.max(bandTop, Math.min(t.camAirBandBottom * view.h, view.h - (pad.bottom ?? 0)));
  const feetOnScreen = target.feetY - y;
  if (feetOnScreen < bandTop) y = target.feetY - bandTop;
  else if (feetOnScreen > bandBottom) y = target.feetY - bandBottom;

  // How far each side wall (and the bottom edge) may be passed on this tick: a wider reach (touch mode back on) is
  // grown into by camPassGlideSpeed a tick in a running world; a narrower one (touch mode off) is given back in settle.
  const grow = target.running ? t.camPassGlideSpeed : 0;
  return settle(
    x,
    y,
    look,
    view,
    level,
    target.x,
    passNow(prev.passLeft, pad.left, grow),
    passNow(prev.passRight, pad.right, grow),
    passNow(prev.passBottom, pad.bottom ?? 0, grow),
    rise,
    pad,
  );
}

/** The pass one side may use on this tick: toward a wider reach by at most `grow` px; a narrower reach is not taken yet. */
function passNow(prev: number, reach: number, grow: number): number {
  return reach > prev ? Math.min(reach, prev + grow) : prev;
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

/**
 * The bounds, then the state. `passLeft` and `passRight` are how far the view may pass the side walls on
 * this tick. With `pad` (a step), a pass wider than the pad's reach (touch mode has ended) is kept only as
 * far as the camera still uses it, never below the reach: it follows the camera back in, so the bound
 * never pushes the view. Without `pad` (a snap) the pass is the reach given.
 */
function settle(
  x: number,
  y: number,
  look: number,
  view: Size,
  level: Size,
  heroX: number,
  passLeft: number,
  passRight: number,
  passBottom: number,
  rise: number,
  pad?: Readonly<PadReach>,
): CameraState {
  const walls = sideWalls(view.w, level.w, heroX);
  const lo = passLeft > 0 ? walls.lo - passLeft : walls.lo0;
  const hi = passRight > 0 ? walls.hi + passRight : walls.hi0;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = bound(y, view.h, level.h, passBottom);
  const keptLeft = pad && passLeft > pad.left ? Math.max(pad.left, Math.min(passLeft, walls.lo - cx)) : passLeft;
  const keptRight = pad && passRight > pad.right ? Math.max(pad.right, Math.min(passRight, cx - walls.hi)) : passRight;
  const reachBottom = pad?.bottom ?? 0;
  const keptBottom = pad && passBottom > reachBottom ? Math.max(reachBottom, Math.min(passBottom, cy - (level.h - view.h))) : passBottom;
  return { x: cx, y: cy, look, scrollX: whole(cx), scrollY: whole(cy), passLeft: keptLeft, passRight: keptRight, passBottom: keptBottom, rise };
}

/**
 * Where the view may go sideways without passing a wall. `lo0`, `hi0`: inside the level (a level narrower
 * than the view: centred). `lo`, `hi`: the same, widened to the hero's sprite should it stand beyond the
 * level's edge (an open first or last column), which a pass is measured from, so the hero is clear of the
 * buttons too. Whole numbers in, whole bounds out: the hero cannot shimmer.
 */
function sideWalls(viewW: number, levelW: number, heroX: number): { lo0: number; hi0: number; lo: number; hi: number } {
  const small = levelW <= viewW;
  const lo0 = small ? Math.floor((levelW - viewW) / 2) : 0;
  const hi0 = small ? lo0 : levelW - viewW;
  return { lo0, hi0, lo: Math.min(lo0, heroX - HERO_HALF_W), hi: Math.max(hi0, heroX + HERO_HALF_W - viewW) };
}

/**
 * Keeps the view inside the level on one axis, or centres a level smaller than the view. `passEnd`: how
 * far the view may pass the far edge (the bottom: the pad's bottom row on a touch screen).
 */
function bound(pos: number, viewLen: number, levelLen: number, passEnd = 0): number {
  const lowest = levelLen - viewLen + Math.max(0, passEnd);
  if (levelLen <= viewLen) {
    // Centred on a whole pixel, so it is already whole. The scroll is negative here and floor rounds it
    // away from zero, so the odd pixel of an odd leftover goes to the NEAR side: the left or top border
    // is one pixel wider than the right or bottom one.
    const centre = Math.floor((levelLen - viewLen) / 2);
    // With a pass (the pad's bottom row on a touch screen) the level may also be drawn higher than centred, as far
    // as the pass reaches, where the hero's anchor asks: a level as tall as the view on a short browser tab, whose
    // floor would otherwise lie under the buttons.
    return lowest > centre ? Math.min(Math.max(pos, centre), lowest) : centre;
  }
  return Math.min(Math.max(pos, 0), lowest);
}

/** Rounded to a whole pixel, without a negative zero. */
function whole(v: number): number {
  return Math.round(v) + 0;
}
