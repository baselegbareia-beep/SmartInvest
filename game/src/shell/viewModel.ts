/**
 * Where things are drawn, in whole art pixels (docs/ARCHITECTURE.md 11.1 and 11.2, docs/ART-AND-SOUND.md
 * sections 3, 4, 8 and 13). Pure: no Phaser, no DOM. WorldView and Effects ask; nothing here allocates
 * once warm (overlay offsets are cached per hero frame, results go into objects the caller keeps).
 *
 * - `Track`: the previous and current whole-pixel draw positions of one moving thing, blended by
 *   `lerpPx` (render interpolation, PHASER4-NOTES section 12), with every snap rule of 11.1.
 * - `heroDrawX/Y`, `boltDrawX/Y`: the core's sub-pixels to the top-left corner of the sprite.
 * - `overlayAt`: where an overlay sits on the hero this frame (overlayOffsetOn, mirrored when he faces
 *   left), or null on frames that carry no gear.
 * - `fuelBarWidth`: the lit part of the mini fuel bar.
 * - `airlockPointer`: where the lime chevron goes at the screen edge while the airlock is off screen.
 */
import { TILE_SIZE, overlayOffsetOn, spriteSpec } from '../art/manifest';
import type { OverlayName } from '../art/manifest';
import { SUB_SHIFT } from '../core/types';
import type { BoltState, Phys, PlayerState } from '../core/types';

import { lerpPx } from './interpolation';

// ---------------------------------------------------------------------------------------
// Interpolated draw positions
// ---------------------------------------------------------------------------------------

/**
 * Previous and current whole-pixel draw positions of one moving thing (ARCHITECTURE 11.1).
 *
 * `set` after every simulated tick: the old current becomes the previous. Something that was not drawn
 * on the previous tick (a bolt just fired, an enemy back to life, anything new) has no previous
 * position: it starts with previous = current, so it never slides in from where it used to be.
 * `snap` makes previous = current (level start, respawn, a frame held by the hit stop). `x(alpha)` and
 * `y(alpha)` blend with `lerpPx`, which also refuses to blend a jump of more than a tile (a teleport).
 */
export class Track {
  prevX = 0;
  prevY = 0;
  curX = 0;
  curY = 0;
  /** Whether the thing was drawn after the last `set`. False until the first `set` with `visible`. */
  shown = false;

  /** This tick's whole-pixel position; `visible`: whether the thing exists (is drawn) this tick. */
  set(x: number, y: number, visible: boolean): void {
    if (this.shown) {
      this.prevX = this.curX;
      this.prevY = this.curY;
    } else {
      this.prevX = x;
      this.prevY = y;
    }
    this.curX = x;
    this.curY = y;
    this.shown = visible;
  }

  /** previous = current: nothing is blended until the next `set`. */
  snap(): void {
    this.prevX = this.curX;
    this.prevY = this.curY;
  }

  /** Forget the previous position entirely (a new level): the next `set` starts fresh. */
  forget(): void {
    this.shown = false;
  }

  x(alpha: number): number {
    return lerpPx(this.prevX, this.curX, alpha);
  }

  y(alpha: number): number {
    return lerpPx(this.prevY, this.curY, alpha);
  }
}

// ---------------------------------------------------------------------------------------
// The core's sub-pixels to sprite corners
// ---------------------------------------------------------------------------------------

/** The hero's 16 px sprite is centred on his box, feet flush (ART-AND-SOUND section 3): left edge. */
export function heroDrawX(player: PlayerState, phys: Phys): number {
  return (player.x >> SUB_SHIFT) - ((TILE_SIZE - (phys.heroW >> SUB_SHIFT)) >> 1);
}

/** Top edge of the hero's sprite: the box's bottom is the sprite's bottom. */
export function heroDrawY(player: PlayerState, phys: Phys): number {
  return (player.y >> SUB_SHIFT) - (TILE_SIZE - (phys.heroH >> SUB_SHIFT));
}

const BOLT = spriteSpec('bolt');

/** The bolt sprite is centred on the bolt's box. */
export function boltDrawX(bolt: BoltState, phys: Phys): number {
  return ((bolt.x + (phys.boltW >> 1)) >> SUB_SHIFT) - (BOLT.width >> 1);
}

export function boltDrawY(bolt: BoltState, phys: Phys): number {
  return ((bolt.y + (phys.boltH >> 1)) >> SUB_SHIFT) - (BOLT.height >> 1);
}

// ---------------------------------------------------------------------------------------
// Gear on the hero
// ---------------------------------------------------------------------------------------

/** overlayOffsetOn answers the same for the same frame: asked once per frame name, then remembered. */
const OFFSETS = new Map<OverlayName, Map<string, { readonly x: number; readonly y: number } | null>>();

function offsetOn(name: OverlayName, heroFrame: string): { readonly x: number; readonly y: number } | null {
  let byFrame = OFFSETS.get(name);
  if (!byFrame) {
    byFrame = new Map();
    OFFSETS.set(name, byFrame);
  }
  let at = byFrame.get(heroFrame);
  if (at === undefined) {
    at = overlayOffsetOn(name, heroFrame);
    byFrame.set(heroFrame, at);
  }
  return at;
}

/** A top-left corner in whole art pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Where an overlay's top-left corner goes on a hero drawn at (hx, hy) with `heroFrame`, written into
 * `out`; null (and `out` untouched) on a frame without gear (the broken hero: overlayOffsetOn's null).
 * Facing left the overlay is mirrored, and so is its x offset: `16 - x - width` (manifest, OVERLAY_OFFSET).
 */
export function overlayAt(name: OverlayName, heroFrame: string, flip: boolean, hx: number, hy: number, out: Point): Point | null {
  const at = offsetOn(name, heroFrame);
  if (!at) return null;
  const w = spriteSpec(name).width;
  out.x = hx + (flip ? TILE_SIZE - at.x - w : at.x);
  out.y = hy + at.y;
  return out;
}

/** The lit width of a fuel bar `barW` px long: the tank's share, rounded up so a drop of fuel still shows. */
export function fuelBarWidth(fuel: number, fuelTicks: number, barW: number): number {
  if (fuel <= 0) return 0;
  return Math.min(barW, Math.ceil((barW * fuel) / Math.max(1, fuelTicks)));
}

// ---------------------------------------------------------------------------------------
// The airlock pointer (ART-AND-SOUND section 13)
// ---------------------------------------------------------------------------------------

export type PointerDir = 'left' | 'right' | 'up' | 'down';

export interface PointerPlace {
  /** Centre of the chevron on screen, whole art px. */
  x: number;
  y: number;
  /** Which way it points: toward the airlock. */
  dir: PointerDir;
}

/** How far from each screen edge the chevron's centre stays (art px): clear of the top bar and its toast. */
export interface EdgeInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where to draw the chevron that points at an airlock which is entirely off screen, written into `out`;
 * null while any part of the airlock's cell is on screen. The chevron slides along the screen edge
 * nearest the airlock (its centre clamped into the view minus `inset`) and points along the axis on
 * which the airlock is further out of view.
 *
 * @param doorCol, doorRow   the airlock's cell
 * @param camX, camY         the scroll the view is drawn with (whole art px)
 * @param viewW, viewH       the view, art px
 */
export function airlockPointer(
  doorCol: number,
  doorRow: number,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  inset: EdgeInsets,
  out: PointerPlace,
): PointerPlace | null {
  const left = doorCol * TILE_SIZE - camX;
  const top = doorRow * TILE_SIZE - camY;
  const right = left + TILE_SIZE;
  const bottom = top + TILE_SIZE;
  // How far outside the view the cell lies on each axis (0 when it overlaps on that axis).
  const outX = right <= 0 ? -right : left >= viewW ? left - viewW : 0;
  const outY = bottom <= 0 ? -bottom : top >= viewH ? top - viewH : 0;
  // Off screen means outside on at least one axis: overlapping on both is visible.
  if (outX === 0 && outY === 0) return null;

  const cx = left + (TILE_SIZE >> 1);
  const cy = top + (TILE_SIZE >> 1);
  out.x = clamp(cx, inset.left, viewW - inset.right);
  out.y = clamp(cy, inset.top, viewH - inset.bottom);
  out.dir = outX >= outY ? (cx < 0 ? 'left' : 'right') : cy < 0 ? 'up' : 'down';
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? Math.round((lo + hi) / 2) : Math.min(hi, Math.max(lo, v));
}
