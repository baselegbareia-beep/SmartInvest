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
import { SUB_SHIFT, TILE_PX, Tile } from '../core/types';
import type { CameraTuning, Facing, GameState, LevelData } from '../core/types';

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
  /**
   * The standing framing in use (`frameShift`), art px: how far below the feet anchor his feet rest on screen (more
   * of the level above shows); negative: above it (more below shows). 0 without a scene.
   */
  readonly shift: number;
}

/** A camera before the first snap. */
export const NO_CAMERA: CameraState = Object.freeze({ x: 0, y: 0, look: 0, scrollX: 0, scrollY: 0, passLeft: 0, passRight: 0, passBottom: 0, rise: 0, shift: 0 });

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
export function snapCamera(
  target: CameraTarget,
  view: Size,
  level: Size,
  t: CameraTuning,
  pad: Readonly<PadReach> = NO_PAD,
  scene: FrameScene | null = null,
): CameraState {
  const look = target.facing * t.camLookAheadPx;
  const x = target.x - anchorX(view, look);
  // The framing weighs the view as it will be drawn: across, inside the side walls and their pass.
  const shift = scene ? frameShift(scene, target, clampX(x, view, level, target.x, pad.left, pad.right), view, level, t, pad, pad.bottom ?? 0) : 0;
  const y = target.feetY - (feetAnchor(view, t, pad) + shift);
  return settle(x, y, look, view, level, target.x, pad.left, pad.right, pad.bottom ?? 0, 0, shift);
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

// ---------------------------------------------------------------------------------------
// Framing: where the standing view rests (docs/ARCHITECTURE.md 11.4)
// ---------------------------------------------------------------------------------------

/** A rectangle in art px of the view. */
export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The touch pad's buttons as drawn over the view, art px of the view. FIRE and THRUST count only while their item is held. */
export interface PadButtonsOnView {
  readonly left: ViewRect;
  readonly right: ViewRect;
  readonly jump: ViewRect;
  readonly fire: ViewRect;
  readonly thrust: ViewRect;
  readonly pause: ViewRect;
}

/** What the standing view frames: the game (the hero, and what is in the level) and the pad's drawn buttons (null: keys). */
export interface FrameScene {
  readonly game: GameState;
  readonly buttons: PadButtonsOnView | null;
}

/**
 * How the framing weighs what it brings into the clear (art numbers of the rule, not feel: the range it may move
 * in is `camFrameDownPx` and `camFrameUpPx`). A thing is hidden under the strip when at least half of it lies there,
 * and under a button when they overlap at all. A crystal counts half as much as anything else; under a button, a
 * thing ahead of the hero counts far more (within 4 tiles more still): he is walking into it.
 */
const FRAME = {
  stripCrystal: 1,
  strip: 2,
  buttonCrystal: 0.5,
  button: 1.5,
  buttonAhead: 12,
  buttonNear: 24,
  /** Ahead: from half a tile behind his middle to 4 tiles ahead (near), to 7 tiles ahead (ahead). */
  nearPx: 4 * TILE_PX + TILE_PX / 2,
  aheadPx: 7 * TILE_PX,
  /** Hazard tiles count within this many tiles of him, across and up or down. */
  hazardTiles: 6,
  /** A framing never brings a thing within this far of him across (either side, on screen or about to be) into the bottom buttons' rows. */
  bandPx: 4 * TILE_PX,
  /** Px of a thing allowed into those rows before it counts. */
  bandSlackPx: 4,
  /** Per px of space shown below the level's bottom row; per px away from the anchor (ties go to less space, then to the anchor). */
  voidPx: 0.01,
  shiftPx: 0.001,
  /**
   * Per px his feet are raised above the anchor: he then sees that much less above him, and a jump from there comes that
   * much nearer the strip. A raise of two tiles costs less than one thing, so it is still taken to show one.
   */
  raisePx: 0.1,
  /** The framing moves off the anchor only for a gain of at least this: one thing, or two crystals. */
  minGain: 2,
  /**
   * An up-and-down Arc Moth is newly hidden under the strip by a framing if it would be there anywhere on the way it
   * flies in this many ticks (half a second: the view has eased most of the way by then, and the framing is weighed
   * again every tick he stands).
   */
  mothSoonTicks: 30,
} as const;

const KIND_CRYSTAL = 0;
const KIND_HAZARD = 1;
const KIND_OTHER = 2;
/** Ways a framing may not newly hide a thing (bits of `harm`): under the strip; out of the picture; under (or into the rows of) the buttons. */
const HARM_STRIP = 1;
const HARM_BUTTONS = 4;
/** Not a harm: a thing cut off at the top at the anchor, which no framing may push further up (`frameShift`). */
const CUT_TOP = 8;
/** The most things weighed at once that fit the reused arrays before they grow; and the buttons (LEFT, RIGHT, JUMP, FIRE, THRUST). */
const MAX_BUTTONS = 5;

/** The level's hazard cells and each up-and-down Arc Moth's whole flight, found once per level. */
interface LevelFrameData {
  /** Hazard cells, packed: col, row, col, row... */
  readonly hazards: Int32Array;
  /** Per enemy: the top and bottom (art px) of an up-and-down moth's flight; -1 for any other enemy. */
  readonly mothTop: Int32Array;
  readonly mothBottom: Int32Array;
}

const levelFrames = new WeakMap<LevelData, LevelFrameData>();

function levelFrameData(level: LevelData): LevelFrameData {
  const known = levelFrames.get(level);
  if (known) return known;
  const cells: number[] = [];
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const k = level.tiles[row * level.width + col];
      if (k === Tile.Fire || k === Tile.Coolant || k === Tile.Spikes) cells.push(col, row);
    }
  }
  const open = (col: number, row: number): boolean => row >= 0 && row < level.height && level.tiles[row * level.width + col] === Tile.Empty;
  const mothTop = new Int32Array(level.enemies.length).fill(-1);
  const mothBottom = new Int32Array(level.enemies.length).fill(-1);
  level.enemies.forEach((e, i) => {
    if (e.kind !== 'moth' || e.axis !== 'v') return;
    let top = e.row;
    while (open(e.col, top - 1)) top--;
    let bottom = e.row;
    while (open(e.col, bottom + 1)) bottom++;
    mothTop[i] = top * TILE_PX;
    mothBottom[i] = (bottom + 1) * TILE_PX;
  });
  const data = { hazards: Int32Array.from(cells), mothTop, mothBottom };
  levelFrames.set(level, data);
  return data;
}

/**
 * The things the framing weighs this tick, reused (no allocation per tick): world art px. `top` to `bottom` is where
 * the thing can be (a tile; for an up-and-down moth its whole flight), `soonTop` to `soonBottom` where it can be within
 * FRAME.mothSoonTicks (the same tile for anything else).
 */
const things = {
  n: 0,
  x: new Float64Array(64),
  top: new Float64Array(64),
  bottom: new Float64Array(64),
  soonTop: new Float64Array(64),
  soonBottom: new Float64Array(64),
  kind: new Uint8Array(64),
};
/** Per thing, for the view's left edge of this tick: across the view (art px), across from his middle, whether it is on the view across. */
let thingVx = new Float64Array(64);
let thingAcross = new Float64Array(64);
let thingOnView = new Uint8Array(64);
/** Per thing and drawn button (`MAX_BUTTONS` a thing): how far they overlap across, art px (0 or less: not at all). */
let thingButtonW = new Float64Array(64 * MAX_BUTTONS);
/** Per thing: overlaps PAUSE across. */
let thingUnderPauseX = new Uint8Array(64);
/** Per thing: hidden in a way no framing may add (see `frameShift`), at the anchor and at a candidate. */
let harmAtAnchor = new Uint8Array(64);
let harmHere = new Uint8Array(64);

/** Room for `n` things in every per-thing array (grown, never shrunk). */
function roomFor(n: number): void {
  if (things.x.length >= n) return;
  const grow = <T extends Float64Array | Uint8Array>(a: T, size: number): T => {
    const b = new (a.constructor as new (len: number) => T)(size);
    b.set(a);
    return b;
  };
  const size = n * 2;
  things.x = grow(things.x, size);
  things.top = grow(things.top, size);
  things.bottom = grow(things.bottom, size);
  things.soonTop = grow(things.soonTop, size);
  things.soonBottom = grow(things.soonBottom, size);
  things.kind = grow(things.kind, size);
  thingVx = new Float64Array(size);
  thingAcross = new Float64Array(size);
  thingOnView = new Uint8Array(size);
  thingButtonW = new Float64Array(size * MAX_BUTTONS);
  thingUnderPauseX = new Uint8Array(size);
  harmAtAnchor = new Uint8Array(size);
  harmHere = new Uint8Array(size);
}

function addThing(x: number, top: number, bottom: number, kind: number, soonTop = top, soonBottom = bottom): void {
  roomFor(things.n + 1);
  const i = things.n++;
  things.x[i] = x;
  things.top[i] = top;
  things.bottom[i] = bottom;
  things.soonTop[i] = soonTop;
  things.soonBottom[i] = soonBottom;
  things.kind[i] = kind;
}

/**
 * Fills `things`: live enemies, what can be taken, the cog, the airlock, hazards near him. An up-and-down moth is its
 * whole flight for what the framing gains (so the framing does not follow it up and down), and the way it flies in the
 * next FRAME.mothSoonTicks for what a framing may not newly hide. It was once judged as one tall thing, under the strip
 * only when half of a flight of several tiles was: the framing then pushed level 9's pool moths into the top bar's row
 * on the 844 x 390 phone (the route watch's second re-check).
 */
function gatherThings(game: GameState): void {
  const level = game.level;
  const run = game.run;
  const data = levelFrameData(level);
  things.n = 0;
  if (!run.hasTrophy) addThing(level.trophy.col * TILE_PX, level.trophy.row * TILE_PX, (level.trophy.row + 1) * TILE_PX, KIND_OTHER);
  addThing(level.door.col * TILE_PX, level.door.row * TILE_PX, (level.door.row + 1) * TILE_PX, KIND_OTHER);
  for (let i = 0; i < level.pickups.length; i++) {
    const p = level.pickups[i];
    if (p && run.taken[i] !== true) addThing(p.col * TILE_PX, p.row * TILE_PX, (p.row + 1) * TILE_PX, p.kind === 'crystal' ? KIND_CRYSTAL : KIND_OTHER);
  }
  const sub = 1 << SUB_SHIFT;
  const soonPx = (FRAME.mothSoonTicks * game.phys.mothSpeed) / sub;
  for (let i = 0; i < run.enemies.length; i++) {
    const e = run.enemies[i];
    if (!e?.alive) continue;
    const top = data.mothTop[i] ?? -1;
    if (top < 0) {
      addThing(e.x >> SUB_SHIFT, e.y >> SUB_SHIFT, (e.y >> SUB_SHIFT) + TILE_PX, KIND_OTHER);
      continue;
    }
    // Where its tile's top goes in the next mothSoonTicks: on its way, turning round at either end of its flight.
    const bottom = data.mothBottom[i] ?? top + TILE_PX;
    const lowest = bottom - TILE_PX;
    const y = e.y / sub;
    let lo: number;
    let hi: number;
    if (e.dir < 0) {
      const up = Math.min(soonPx, y - top);
      lo = y - up;
      hi = Math.max(y, Math.min(lowest, top + (soonPx - up)));
    } else {
      const down = Math.min(soonPx, lowest - y);
      hi = y + down;
      lo = Math.min(y, Math.max(top, lowest - (soonPx - down)));
    }
    addThing(e.x >> SUB_SHIFT, top, bottom, KIND_OTHER, Math.floor(lo), Math.floor(hi) + TILE_PX);
  }
  const p = run.player;
  const midX = (p.x + (game.phys.heroW >> 1)) >> SUB_SHIFT;
  const midY = (p.y + (game.phys.heroH >> 1)) >> SUB_SHIFT;
  const reach = FRAME.hazardTiles * TILE_PX;
  const h = data.hazards;
  for (let i = 0; i + 1 < h.length; i += 2) {
    const col = h[i] ?? 0;
    const row = h[i + 1] ?? 0;
    const cx = col * TILE_PX + TILE_PX / 2;
    const cy = row * TILE_PX + TILE_PX / 2;
    if (Math.abs(cx - midX) <= reach && Math.abs(cy - midY) <= reach) addThing(col * TILE_PX, row * TILE_PX, (row + 1) * TILE_PX, KIND_HAZARD);
  }
}

/** The bottom row's buttons drawn now: LEFT, RIGHT, JUMP, FIRE and THRUST while their item is held; and PAUSE (null: keys). */
const drawnButtons: ViewRect[] = [];
let pauseButton: ViewRect | null = null;
let bandTop = Infinity;

function gatherButtons(scene: FrameScene): void {
  drawnButtons.length = 0;
  pauseButton = null;
  bandTop = Infinity;
  const b = scene.buttons;
  if (!b) return;
  const p = scene.game.run.player;
  drawnButtons.push(b.left, b.right, b.jump);
  if (p.hasBlaster) drawnButtons.push(b.fire);
  if (p.hasThruster) drawnButtons.push(b.thrust);
  for (const r of drawnButtons) bandTop = Math.min(bandTop, r.y);
  pauseButton = b.pause;
}

/**
 * What the things are across, for the view's left edge `sx` this tick (the same for every height `frameCost` weighs):
 * where each lies across the view and from his middle, and how far it overlaps each drawn button and PAUSE across.
 */
function measureAcross(sx: number, view: Size, midX: number): void {
  const p = pauseButton;
  for (let i = 0; i < things.n; i++) {
    const x = things.x[i] ?? 0;
    const vx = x - sx;
    thingVx[i] = vx;
    thingAcross[i] = x + TILE_PX / 2 - midX;
    thingOnView[i] = vx + TILE_PX / 2 > 0 && vx + TILE_PX / 2 < view.w ? 1 : 0;
    for (let b = 0; b < drawnButtons.length; b++) {
      const r = drawnButtons[b];
      thingButtonW[i * MAX_BUTTONS + b] = r ? Math.min(vx + TILE_PX, r.x + r.w) - Math.max(vx, r.x) : 0;
    }
    thingUnderPauseX[i] = p !== null && vx < p.x + p.w && p.x < vx + TILE_PX ? 1 : 0;
  }
}

/** Whether a tile whose top lies anywhere from `first` to `last` (view px) is at some point at least half under the strip, or under PAUSE. */
function underBar(i: number, first: number, last: number): boolean {
  const p = pauseButton;
  return Math.max(first, -TILE_PX / 2) <= Math.min(last, STRIP_H - TILE_PX / 2) || (p !== null && thingUnderPauseX[i] === 1 && first < p.y + p.h && p.y < last + TILE_PX);
}

/**
 * What it costs to draw the view with its top edge at `y` (across as `measureAcross` last measured): the things hidden
 * under the strip and under the buttons, weighed by FRAME. Marks in `harm` the things hidden in a way no framing may
 * add: a thing (other than a crystal) at least half under the strip (a moth: anywhere on its way soon), a thing
 * overlapping a button, a thing within FRAME.bandPx of him across (on screen or not) reaching into the bottom buttons'
 * rows.
 *
 * A thing is a tile, or (an up-and-down moth) a tile anywhere from `top` to `bottom`: it is under the strip (or cut off
 * at the top, or under PAUSE) when it is so anywhere on its way, and under a button when it is so by more than a tile's
 * share of its flight.
 */
function frameCost(y: number, facing: number, harm: Uint8Array): number {
  let cost = 0;
  const touch = drawnButtons.length > 0;
  for (let i = 0; i < things.n; i++) {
    harm[i] = 0;
    // Where its tile's top can be in the view: from `first` (a tile, or the top of a moth's flight) to `last`.
    const first = (things.top[i] ?? 0) - y;
    const last = (things.bottom[i] ?? 0) - y - TILE_PX;
    const kind = things.kind[i] ?? KIND_OTHER;
    const across = thingAcross[i] ?? 0;
    if (touch && Math.abs(across) <= FRAME.bandPx && last + TILE_PX - bandTop > FRAME.bandSlackPx) harm[i] = HARM_BUTTONS;
    if (thingOnView[i] !== 1) continue; // off the view across
    // No framing brings a thing (but a crystal) in under the strip, where it reads as part of the top bar: a moth not
    // where it will fly in the next half second. A thing (but a crystal) cut off at the top (less than half of it clear
    // below the strip, partly in the picture) is marked: see `frameShift`.
    if (kind !== KIND_CRYSTAL && underBar(i, (things.soonTop[i] ?? 0) - y, (things.soonBottom[i] ?? 0) - y - TILE_PX)) harm[i] = (harm[i] ?? 0) | HARM_STRIP;
    if (kind !== KIND_CRYSTAL && last < STRIP_H - TILE_PX / 2 && last > -TILE_PX) harm[i] = (harm[i] ?? 0) | CUT_TOP;
    if (underBar(i, first, last)) {
      cost += kind === KIND_CRYSTAL ? FRAME.stripCrystal : FRAME.strip;
      continue;
    }
    if (!touch) continue;
    let hit = false;
    const h = last + TILE_PX - first;
    for (let b = 0; b < drawnButtons.length; b++) {
      const r = drawnButtons[b];
      if (!r) continue;
      const w = thingButtonW[i * MAX_BUTTONS + b] ?? 0;
      const hh = Math.min(last + TILE_PX, r.y + r.h) - Math.max(first, r.y);
      // Any overlap for a tile; for a moth's long flight, more than its share of a tile.
      if (w > 0 && hh > 0 && w * hh > (TILE_PX * h) / 4 - 8 * TILE_PX) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    harm[i] = (harm[i] ?? 0) | HARM_BUTTONS;
    const ahead = across * facing;
    if (ahead >= -TILE_PX / 2 && ahead <= FRAME.nearPx) cost += FRAME.buttonNear;
    else if (ahead >= 0 && ahead <= FRAME.aheadPx) cost += FRAME.buttonAhead;
    else cost += kind === KIND_CRYSTAL ? FRAME.buttonCrystal : FRAME.button;
  }
  return cost;
}

/**
 * The standing framing (ARCHITECTURE 11.4): how far below the feet anchor (px; negative: above it) the feet of a
 * standing hero rest on screen this tick, so that what is near him lies clear of the top bar's strip and the drawn
 * buttons. The candidates run from `camFrameUpPx` above the anchor to `camFrameDownPx` below it, never with his
 * feet on the buttons (on a touch screen) or below the air band (with keys), nor with his head closer than a tile
 * to the strip's band line. A candidate that hides anything the anchor leaves clear (a thing other than a crystal
 * under the strip or PAUSE, a moth where it will fly within half a second included; anything under a button or
 * reaching into the bottom buttons' rows within FRAME.bandPx of him) is not taken, and while a thing (other than a
 * crystal) is cut off at the top at the anchor, no candidate moves the view down (that would push it out of the
 * picture rather than show it); of the rest, the one that hides least (FRAME's weights, then a little for every px his
 * feet are raised, then the least space below the level, then the nearest the anchor) wins, if it gains at least
 * FRAME.minGain over the anchor. Otherwise 0: the anchor.
 *
 * `x` is the view's left edge this tick as it will be drawn (inside the side walls and their pass: `clampX`), `passBottom`
 * the pass below the level in use. Allocates nothing.
 */
export function frameShift(scene: FrameScene, target: CameraTarget, x: number, view: Size, level: Size, t: CameraTuning, pad: Readonly<PadReach>, passBottom: number): number {
  if (t.camFrameDownPx <= 0 && t.camFrameUpPx <= 0) return 0;
  const game = scene.game;
  gatherThings(game);
  gatherButtons(scene);
  const reach = pad.bottom ?? 0;
  const anchor = feetAnchor(view, t, pad);
  const maxFeet = reach > 0 ? view.h - reach : t.camAirBandBottom * view.h;
  const minFeet = STRIP_H + t.camAirBandTop * view.h + TILE_PX;
  const sHi = Math.min(t.camFrameDownPx, Math.floor(maxFeet - anchor));
  const sLo = -Math.min(t.camFrameUpPx, Math.floor(anchor - minFeet));
  const inner = level.h <= view.h ? Math.floor((level.h - view.h) / 2) : level.h - view.h;
  const lo = level.h <= view.h ? inner : 0;
  const hi = inner + Math.max(0, passBottom);
  const p = game.run.player;
  const midX = (p.x + (game.phys.heroW >> 1)) >> SUB_SHIFT;
  measureAcross(Math.round(x), view, midX);
  frameCost(Math.round(Math.min(Math.max(target.feetY - anchor, lo), hi)), p.facing, harmAtAnchor);
  // Something cut off at the top at the anchor: no framing pushes it further up and out of the picture to get it out
  // of the strip; only down, into the clear.
  let up = sLo;
  for (let i = 0; i < things.n; i++) if (((harmAtAnchor[i] ?? 0) & CUT_TOP) !== 0) up = 0;
  let best = 0;
  let bestCost = Infinity;
  let atAnchor = Infinity;
  // Heights the level's edge holds the view at come out the same: weighed once (the view at the level's bottom).
  let lastY = Number.NaN;
  let lastCost = 0;
  let lastWorse = false;
  for (let s = Math.max(sLo, up); s <= sHi; s++) {
    const y = Math.min(Math.max(target.feetY - (anchor + s), lo), hi);
    if (target.feetY - y > maxFeet + 1e-9) continue; // his feet on the buttons
    const drawnY = Math.round(y);
    if (drawnY !== lastY) {
      lastY = drawnY;
      lastCost = frameCost(drawnY, p.facing, harmHere);
      lastWorse = false;
      for (let i = 0; i < things.n && !lastWorse; i++) lastWorse = ((harmHere[i] ?? 0) & ~(harmAtAnchor[i] ?? 0) & (HARM_STRIP | HARM_BUTTONS)) !== 0;
    }
    if (lastWorse) continue;
    let cost = lastCost;
    cost += FRAME.voidPx * Math.max(0, y - inner) + FRAME.shiftPx * Math.abs(s);
    if (s < 0) cost += FRAME.raisePx * -s;
    if (s === 0) atAnchor = cost;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = s;
    }
  }
  return bestCost > atAnchor - FRAME.minGain ? 0 : best;
}

/** One simulation tick of camera movement. Returns a new state; `prev` is not changed. */
export function stepCamera(
  prev: CameraState,
  target: CameraTarget,
  view: Size,
  level: Size,
  t: CameraTuning,
  pad: Readonly<PadReach> = NO_PAD,
  scene: FrameScene | null = null,
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

  // How far each side wall (and the bottom edge) may be passed on this tick: a wider reach (touch mode back on) is
  // grown into by camPassGlideSpeed a tick in a running world; a narrower one (touch mode off) is given back in settle.
  const grow = target.running ? t.camPassGlideSpeed : 0;
  const passLeft = passNow(prev.passLeft, pad.left, grow);
  const passRight = passNow(prev.passRight, pad.right, grow);
  const passBottom = passNow(prev.passBottom, pad.bottom ?? 0, grow);

  // Vertical: ease toward the anchor (moved by the framing, with a scene) while standing, never faster than
  // camVerticalMaxStep; in the air hold inside the band.
  let y = prev.y;
  let shift = prev.shift;
  if (target.onGround) {
    // Weighed on the view as it will be drawn: across, inside the side walls and their pass (as `settle` puts it).
    shift = scene ? frameShift(scene, target, clampX(x, view, level, target.x, passLeft, passRight), view, level, t, pad, passBottom) : 0;
    const rest = target.feetY - (feetAnchor(view, t, pad) + shift);
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

  return settle(x, y, look, view, level, target.x, passLeft, passRight, passBottom, rise, shift, pad);
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
  shift: number,
  pad?: Readonly<PadReach>,
): CameraState {
  const walls = sideWalls(view.w, level.w, heroX);
  const cx = clampX(x, view, level, heroX, passLeft, passRight);
  const cy = bound(y, view.h, level.h, passBottom);
  const keptLeft = pad && passLeft > pad.left ? Math.max(pad.left, Math.min(passLeft, walls.lo - cx)) : passLeft;
  const keptRight = pad && passRight > pad.right ? Math.max(pad.right, Math.min(passRight, cx - walls.hi)) : passRight;
  const reachBottom = pad?.bottom ?? 0;
  const keptBottom = pad && passBottom > reachBottom ? Math.max(reachBottom, Math.min(passBottom, cy - (level.h - view.h))) : passBottom;
  return { x: cx, y: cy, look, scrollX: whole(cx), scrollY: whole(cy), passLeft: keptLeft, passRight: keptRight, passBottom: keptBottom, rise, shift };
}

/**
 * The view's left edge `x` kept inside the side walls, passed by `passLeft` and `passRight` (0: no pass on that side).
 * Before this the framing weighed the view's left edge before the walls held it: up to 228 art px off by a wall (the
 * route watch's second re-check).
 */
function clampX(x: number, view: Size, level: Size, heroX: number, passLeft: number, passRight: number): number {
  const walls = sideWalls(view.w, level.w, heroX);
  const lo = passLeft > 0 ? walls.lo - passLeft : walls.lo0;
  const hi = passRight > 0 ? walls.hi + passRight : walls.hi0;
  return Math.min(Math.max(x, lo), hi);
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
