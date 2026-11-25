/**
 * The timing of the visual feedback (docs/ART-AND-SOUND.md sections 4 "Effects" and 13), as small pure
 * state machines that Effects.ts drives. Pure: no Phaser, no DOM, no clock; randomness is passed in.
 *
 * Strengths and lengths the owner may tune come from TUNING.effects (the caller passes them). The
 * numbers written here are the ones docs/ART-AND-SOUND.md gives as art: the pop-up's 12 px over 30
 * frames, the cog's 20 % flash for 4 frames, the enemy's 2-frame white flash, the airlock pointer's
 * 180 ticks, an ember every 20 ticks.
 */
import { FONT_CELL_H, FONT_LINE_HEIGHT } from '../art/font';
import { Tile } from '../core/types';
import type { LevelData } from '../core/types';

import { POPUP_TOP, POPUP_TOP_UNDER_TOAST } from './hudModel';

/** Score pop-ups rise this far over this many 60 Hz frames, then vanish. */
export const POPUP_RISE_PX = 12;
export const POPUP_FRAMES = 30;
/** The gold screen flash on the cog: 20 % for 4 frames. */
export const COG_FLASH_ALPHA = 0.2;
export const COG_FLASH_FRAMES = 4;
/** A destroyed enemy is drawn filled white this many frames before it bursts (fx_poof). */
export const ENEMY_FLASH_FRAMES = 2;
/** The airlock pointer stays this many ticks after the airlock opens (while the airlock is off screen). */
export const POINTER_TICKS = 180;
/** One ember rises from each fire tile on screen every this many ticks. */
export const EMBER_EVERY_TICKS = 20;

/**
 * Where a score pop-up's top may be drawn at most: never higher than `minTop` px from the view's top edge
 * (under the top bar's strip, or under the toast's band while it shows). `worldY` is where it would be drawn
 * (world px), `camY` the scroll; the answer is the world y to draw it at.
 */
export function popupClampY(worldY: number, camY: number, minTop: number): number {
  return Math.max(worldY, camY + minTop);
}

/**
 * Where a pop-up for something scored at (`x`, `y`) appears: centred `lift` px above it, or, when the hero is
 * rising through it (`rising`), beside it at its height, on the side away from where he travels (`side`: +1
 * when he moves or faces right), so that he does not fly up into his own `+10`. `textW` is the text's width.
 * Answers the centre x and the top y, whole px, into `out`.
 */
export function popupAnchor(x: number, y: number, lift: number, rising: boolean, side: 1 | -1, textW: number, out: { x: number; y: number }): { x: number; y: number } {
  if (!rising) {
    out.x = Math.round(x);
    out.y = Math.round(y - lift);
    return out;
  }
  out.x = Math.round(x - side * (8 + 2 + textW / 2));
  out.y = Math.round(y - 4);
  return out;
}

/** How far a pop-up has risen `age` frames after it appeared: whole px, 0 to POPUP_RISE_PX. */
export function popupRise(age: number): number {
  return Math.round((POPUP_RISE_PX * Math.min(Math.max(age, 0), POPUP_FRAMES)) / POPUP_FRAMES);
}

/** A pop-up's height as drawn: a 7 px glyph row and its 1 px drop shadow (the font's cell). */
export const POPUP_H = FONT_CELL_H;
/** At most this many score pop-ups at once (the oldest is reused). */
export const POPUP_POOL = 6;

/** A rectangle in world art px. */
export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One score pop-up on the board: where it appeared (world px, its top-left corner), its width, its age, where it is drawn now. */
export interface PopupSlot {
  x: number;
  y: number;
  w: number;
  /** Frames since it appeared; POPUP_FRAMES or more: gone (the slot is free). */
  age: number;
  /** Spawn order: older pop-ups are placed first and keep their place. */
  seq: number;
  /** Where to draw it this frame (world px), set by `place`. */
  drawX: number;
  drawY: number;
  /** Where it was first drawn (world px, its top); NaN until placed. Under reduced motion it stays there. */
  firstY: number;
}

const rectsMeet = (a: PxRect, b: PxRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the score pop-ups are drawn (docs/ART-AND-SOUND.md section 13), as numbers: Effects draws one text per
 * slot at (`drawX`, `drawY`). Each pop-up rises POPUP_RISE_PX over POPUP_FRAMES from where it appeared, and is
 * then placed, every frame, oldest first, by three rules:
 * - never into the top bar: its top stays at POPUP_TOP or lower in the view, and at POPUP_TOP_UNDER_TOAST while the
 *   cog's toast shows (the score and the toast's words are never covered);
 * - never over another pop-up already placed;
 * - never over the hero's sprite (and the fuel bar over it).
 * Where its own place breaks a rule, it takes the nearest free place that keeps them: pushed down under the
 * pop-ups above it, or beside, above or below the hero. Under reduced motion a pop-up is placed so once, when it
 * appears, and then stays (moved down only if the view scrolls it into the bar). Before, a pop-up held under the toast's band was simply
 * moved down to that row: the cog's `+100` and a crystal's `+10` were drawn in one row, across the hero (the route
 * watch's re-check, levels 1 and 2 at the cog).
 */
export class PopupBoard {
  readonly slots: PopupSlot[];
  private seq = 0;
  private readonly placed: PxRect[] = [];

  constructor(
    private readonly reducedMotion: boolean,
    size = POPUP_POOL,
  ) {
    this.slots = Array.from({ length: size }, () => ({ x: 0, y: 0, w: 0, age: POPUP_FRAMES, seq: 0, drawX: 0, drawY: 0, firstY: Number.NaN }));
  }

  /** Every pop-up gone. */
  clear(): void {
    for (const s of this.slots) s.age = POPUP_FRAMES;
  }

  /** How far a pop-up has risen at `age`: not at all under reduced motion. */
  rise(age: number): number {
    return this.reducedMotion ? 0 : popupRise(age);
  }

  /**
   * A new pop-up `w` px wide, centred on `x`, its top at `y` (world px), placed at once for the scroll `camY` (and
   * the toast, `toastUp`). Two crystals side by side would print `+10+10` on one line: a pop-up that would overlap
   * one still rising starts a line above it. Answers the slot used (a free one, else the oldest).
   */
  spawn(w: number, x: number, y: number, camY: number, toastUp: boolean): PopupSlot {
    let free = this.slots[0] as PopupSlot;
    for (const s of this.slots) if (s.age > free.age) free = s;
    free.w = w;
    free.x = Math.round(x - w / 2);
    free.y = Math.round(y);
    free.age = 0;
    free.seq = ++this.seq;
    free.firstY = Number.NaN;
    for (let tries = 0; tries < this.slots.length; tries++) {
      let moved = false;
      for (const p of this.slots) {
        if (p === free || p.age >= POPUP_FRAMES) continue;
        const py = p.y - this.rise(p.age);
        if (p.x < free.x + w && free.x < p.x + p.w && Math.abs(py - free.y) < FONT_LINE_HEIGHT) {
          free.y = py - FONT_LINE_HEIGHT;
          moved = true;
        }
      }
      if (!moved) break;
    }
    free.drawX = free.x;
    free.drawY = popupClampY(free.y - this.rise(0), camY, toastUp ? POPUP_TOP_UNDER_TOAST : POPUP_TOP);
    return free;
  }

  /** `frames` 60 Hz frames went by: every pop-up ages; at POPUP_FRAMES it is gone. */
  advance(frames: number): void {
    if (frames <= 0) return;
    for (const s of this.slots) if (s.age < POPUP_FRAMES) s.age += frames;
  }

  /** The pop-ups shown now, oldest first. */
  shown(): PopupSlot[] {
    return this.slots.filter((s) => s.age < POPUP_FRAMES).sort((a, b) => a.seq - b.seq);
  }

  /**
   * Places every pop-up for this frame (`drawX`, `drawY`): risen by its age, then by the rules above, for the
   * view's scroll `camY`, the toast (`toastUp`) and the hero's sprite `hero` (world px; null: not drawn).
   */
  place(camY: number, toastUp: boolean, hero: PxRect | null): void {
    const minTop = camY + (toastUp ? POPUP_TOP_UNDER_TOAST : POPUP_TOP);
    const placed = this.placed;
    placed.length = 0;
    for (const s of this.shown()) {
      // Under reduced motion a pop-up stays where it was first drawn (ART-AND-SOUND section 13), moved only down,
      // and only as far as the bar's rule asks.
      const still = this.reducedMotion && !Number.isNaN(s.firstY);
      const want = still ? { x: s.drawX, y: Math.max(s.firstY, minTop), w: s.w, h: POPUP_H } : { x: s.x, y: Math.max(s.y - this.rise(s.age), minTop), w: s.w, h: POPUP_H };
      const at = still ? want : this.free(want, minTop, hero);
      s.drawX = at.x;
      s.drawY = at.y;
      if (Number.isNaN(s.firstY)) s.firstY = at.y;
      placed.push(at);
    }
  }

  /** The free place nearest `want` (no higher than `minTop`, clear of the hero and of the pop-ups placed so far). */
  private free(want: PxRect, minTop: number, hero: PxRect | null): PxRect {
    const blocked = (r: PxRect): boolean => (hero !== null && rectsMeet(r, hero)) || this.placed.some((q) => rectsMeet(r, q));
    if (!blocked(want)) return want;
    const starts: PxRect[] = [want];
    if (hero) {
      starts.push(
        { ...want, x: hero.x - want.w - 1 },
        { ...want, x: hero.x + hero.w + 1 },
        { ...want, y: Math.max(minTop, hero.y - want.h - 1) },
        { ...want, y: hero.y + hero.h + 1 },
      );
    }
    let best: PxRect | null = null;
    let bestCost = Infinity;
    for (const start of starts) {
      const r = this.pushDown(start, hero);
      if (blocked(r)) continue;
      const cost = Math.abs(r.x - want.x) + Math.abs(r.y - want.y);
      if (cost < bestCost) {
        best = r;
        bestCost = cost;
      }
    }
    return best ?? this.pushDown(want, hero);
  }

  /** `r` moved straight down until it is clear of every pop-up placed so far and of the hero. */
  private pushDown(r: PxRect, hero: PxRect | null): PxRect {
    let y = r.y;
    for (let guard = 0; guard <= this.placed.length + 1; guard++) {
      const at = { ...r, y };
      const hit = [...this.placed, ...(hero ? [hero] : [])].find((q) => rectsMeet(at, q));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    return { ...r, y };
  }
}

/**
 * Whether the fire tile in column `col` throws an ember on this tick. Each column has its own moment
 * in the 20-tick cycle, so a row of fire does not puff in unison.
 */
export function emberDue(tick: number, col: number): boolean {
  return (((tick + col * 7) % EMBER_EVERY_TICKS) + EMBER_EVERY_TICKS) % EMBER_EVERY_TICKS === 0;
}

/** Every fire cell of a level, in reading order, as [col, row] pairs packed in one array: c0, r0, c1, r1, ... */
export function fireCells(level: LevelData): Int32Array {
  let n = 0;
  for (const kind of level.tiles) if (kind === Tile.Fire) n += 1;
  const out = new Int32Array(n * 2);
  let i = 0;
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      if (level.tiles[row * level.width + col] === Tile.Fire) {
        out[i++] = col;
        out[i++] = row;
      }
    }
  }
  return out;
}

/**
 * A screen flash fading out: `alpha` at the start, falling evenly to 0 over `frames`.
 */
export class FlashTimer {
  private left = 0;
  private total = 0;
  private peak = 0;

  start(alpha: number, frames: number): void {
    if (frames <= 0 || alpha <= 0) return;
    this.left = frames;
    this.total = frames;
    this.peak = alpha;
  }

  /** `frames` 60 Hz frames went by. */
  advance(frames: number): void {
    this.left = Math.max(0, this.left - Math.max(0, frames));
  }

  /** The alpha to draw with now (0 when over). The first frame shows the full alpha. */
  get alpha(): number {
    return this.left > 0 ? (this.peak * this.left) / this.total : 0;
  }

  stop(): void {
    this.left = 0;
  }
}

/**
 * The camera shake: up to `px` whole pixels each way for `frames` 60 Hz frames. A new shake during
 * another keeps the longer of the two lengths and the stronger of the two strengths.
 */
export class ShakeTimer {
  private left = 0;
  private px = 0;
  /** The offset to add to the camera scroll this frame: whole pixels. */
  x = 0;
  y = 0;

  start(px: number, frames: number): void {
    if (px <= 0 || frames <= 0) return;
    this.px = this.left > 0 ? Math.max(this.px, px) : px;
    this.left = Math.max(this.left, frames);
  }

  /**
   * `frames` 60 Hz frames went by (0 on a frame of a fast display that shows no new tick: the offset
   * then stays, so the shake runs at the game's pace on every display). `random` gives 0 <= r < 1.
   */
  advance(frames: number, random: () => number): void {
    if (frames <= 0) return;
    this.left = Math.max(0, this.left - frames);
    if (this.left === 0) {
      this.x = 0;
      this.y = 0;
      return;
    }
    this.x = Math.round((random() * 2 - 1) * this.px);
    this.y = Math.round((random() * 2 - 1) * this.px);
  }

  get active(): boolean {
    return this.left > 0;
  }

  stop(): void {
    this.left = 0;
    this.x = 0;
    this.y = 0;
  }
}

/**
 * The hard-landing shake needs the height of the fall: the shell remembers the hero's highest feet line
 * since he left the ground (ART-AND-SOUND section 13).
 */
export class FallTracker {
  /** The highest (smallest) feet line in art px since leaving the ground; null while grounded or frozen. */
  private top: number | null = null;

  /** Once per simulated tick, before the tick's events: where the feet are and whether the world runs. */
  observe(playing: boolean, onGround: boolean, feetY: number): void {
    if (!playing) {
      this.top = null;
      return;
    }
    if (onGround) return; // keep the top until the landing event reads it
    this.top = this.top === null ? feetY : Math.min(this.top, feetY);
  }

  /** The hero landed with his feet at `feetY`: how far he fell from his highest point (0 if unknown). */
  landed(feetY: number): number {
    const fall = this.top === null ? 0 : Math.max(0, feetY - this.top);
    this.top = null;
    return fall;
  }

  reset(): void {
    this.top = null;
  }
}
