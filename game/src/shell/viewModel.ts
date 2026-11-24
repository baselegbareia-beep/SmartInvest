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
 * - `exitDrawPos`, `fellDrawY`, `deathFill`: where and how the hero is drawn when the world stops for him
 *   (in the airlock, at a fall out of the level, in a death's flash).
 * - `airlockPointer`: where the lime chevron goes at the screen edge while the airlock is off screen.
 */
import { TILE_SIZE, overlayOffsetOn, spriteSpec } from '../art/manifest';
import type { OverlayName } from '../art/manifest';
import { SUB_SHIFT } from '../core/types';
import type { BoltState, DeathCause, Phys, PlayerState } from '../core/types';

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
// The hero when the world stops for him (ART-AND-SOUND sections 9 and 13)
// ---------------------------------------------------------------------------------------

/** Ticks over which the hero settles into the airlock at a level clear. */
export const EXIT_SETTLE_TICKS = 6;

/**
 * Where the hero's sprite is drawn while he stands in the airlock (run.phase 'exiting'), written into `out`.
 * The core ends the level as soon as his box touches the airlock and freezes him there, mostly in mid-fall on
 * its lintel or half outside the frame; the picture instead eases him, over EXIT_SETTLE_TICKS from where he
 * was frozen (`fromX`, `fromY`: the sprite's corner then), into the cell: centred on it, feet on its floor.
 * `ticksIn` is run.phaseTicks (0 on the tick of the win). Whole pixels.
 */
export function exitDrawPos(fromX: number, fromY: number, doorCol: number, doorRow: number, ticksIn: number, out: Point): Point {
  const t = Math.min(1, Math.max(0, ticksIn) / EXIT_SETTLE_TICKS);
  const k = 1 - (1 - t) * (1 - t); // eases out: quick at first, settling gently
  out.x = Math.round(fromX + (doorCol * TILE_SIZE - fromX) * k);
  out.y = Math.round(fromY + (doorRow * TILE_SIZE - fromY) * k);
  return out;
}

/**
 * The sprite's top while the hero dies of a fall out of the level: the core kills him once he is wholly below
 * its bottom row, by then under the view's bottom edge, so his flash and break-apart would play out of sight.
 * They are drawn at the view's bottom edge instead, the whole sprite showing.
 */
export function fellDrawY(drawY: number, camY: number, viewH: number): number {
  return Math.min(drawY, camY + viewH - TILE_SIZE);
}

/** Ticks of a death's flash that are white whatever the cause, so the silhouette stands out from amber flames and ice. */
export const DEATH_WHITE_TICKS = 3;

/** The colour the hero is filled with `ticksIn` ticks (run.phaseTicks) into a death's flash: white first, then the cause's own. */
export function deathFill(cause: DeathCause | null, ticksIn: number): 'white' | 'amber' | 'ice' {
  if (ticksIn < DEATH_WHITE_TICKS) return 'white';
  if (cause === 'fire') return 'amber';
  if (cause === 'coolant') return 'ice';
  return 'white';
}

// ---------------------------------------------------------------------------------------
// The Earth behind the level (ART-AND-SOUND section 6)
// ---------------------------------------------------------------------------------------

/**
 * How much of the Earth's disc (`size` px across, its box's top-left at screen `x`, `y`) lies over cells through
 * which space shows (`open(col, row)`, level cells), with the view scrolled to `camX`, `camY`: 0 to 1, sampled every
 * 4 px. Seen through a small gap in the far-wall panels the crescent was a loose light-steel fragment beside an
 * Arc Moth (a third wing) or under a chain hook (a dish): the view hides it below a share (WorldView).
 */
export function openShare(x: number, y: number, size: number, camX: number, camY: number, open: (col: number, row: number) => boolean): number {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  let inDisc = 0;
  let seen = 0;
  for (let sy = 2; sy < size; sy += 4) {
    for (let sx = 2; sx < size; sx += 4) {
      const dx = x + sx - cx;
      const dy = y + sy - cy;
      if (dx * dx + dy * dy > r * r) continue;
      inDisc += 1;
      if (open(Math.floor((x + sx + camX) / TILE_SIZE), Math.floor((y + sy + camY) / TILE_SIZE))) seen += 1;
    }
  }
  return inDisc === 0 ? 0 : seen / inDisc;
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
 * "On screen" is a real overlap: a cell flush with an edge (its top exactly at the view's height) shows
 * nothing and counts as off screen. `visibleTop` is where the picture starts to count from the top: the
 * top bar's strip (STRIP_H), under which a cell is only seen dimmed behind the bar.
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
  visibleTop = 0,
): PointerPlace | null {
  const left = doorCol * TILE_SIZE - camX;
  const top = doorRow * TILE_SIZE - camY;
  const right = left + TILE_SIZE;
  const bottom = top + TILE_SIZE;
  // Visible only where the cell overlaps the picture on both axes.
  if (right > 0 && left < viewW && bottom > visibleTop && top < viewH) return null;
  // How far outside the picture the cell lies on each axis (0 where it overlaps on that axis), counting a cell
  // flush with an edge as one pixel out.
  const outX = right <= 0 ? 1 - right : left >= viewW ? 1 + left - viewW : 0;
  const outY = bottom <= visibleTop ? 1 + visibleTop - bottom : top >= viewH ? 1 + top - viewH : 0;

  const cx = left + (TILE_SIZE >> 1);
  const cy = top + (TILE_SIZE >> 1);
  out.x = clamp(cx, inset.left, viewW - inset.right);
  out.y = clamp(cy, inset.top, viewH - inset.bottom);
  out.dir = outX >= outY ? (cx < 0 ? 'left' : 'right') : cy < visibleTop ? 'up' : 'down';
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? Math.round((lo + hi) / 2) : Math.min(hi, Math.max(lo, v));
}
