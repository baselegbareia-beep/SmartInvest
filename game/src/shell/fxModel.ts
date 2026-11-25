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

/**
 * A hero moving this many px a frame or more into a pop-up makes it step out of his way rather than be pushed along
 * (a push of this much a frame already reads as a jump; a walk is 1.5 px a frame and pushes it smoothly).
 */
export const POPUP_PUSH_PX = 3;
/** ...and is then put off the ground he covers in this many frames at his pace, where it can be. */
export const POPUP_LOOK_FRAMES = 8;
/** A step aside this long or longer is never followed by one as long back the other way on the next frame. */
export const POPUP_FLIP_PX = 10;
/**
 * Under reduced motion a pop-up shows for at least this many 60 Hz frames, a third of a second: time to look at it and
 * read three characters. One the hero came onto was taken down on the next frame: on the 568 x 320 phone 30 of 175
 * showed for one or two frames, a flicker (the route watch's second re-check).
 */
export const POPUP_MIN_FRAMES = 20;
/** ...so it appears clear of where he will be over that time, and this far above his head (a jump's first two frames). */
export const POPUP_HEAD_PX = 8;
/**
 * A pop-up's height as drawn: a 7 px glyph row and its 1 px drop shadow (the font's cell). Its width on the board is the
 * text's (`textWidth`, 17 px for `+10`): the shadow's extra column on the right (an 18th) is left out, so a pop-up just
 * left of a hero facing right can lay it on his first column, a dark pixel or two on his aerial's bulb in the run and
 * jump frames (11 to 27 frames over the twelve routes in the browser). Counting it moved more pop-ups (frames with a
 * step 450 to 471, more than 32 px from their place 10 to 30, docs/ART-AND-SOUND.md section 13), so it is left out.
 */
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
  /** Where it was first drawn (world px, its top); NaN until placed. Under reduced motion: where it stays, as last moved. */
  firstY: number;
  /** How far it is drawn from where its own rise would put it (world px), kept from frame to frame. */
  offX: number;
  offY: number;
  /** How far the rules last moved it off its course (world px): a step aside is never undone on the next frame. */
  stepX: number;
  stepY: number;
}

/** The view across, world px: its left edge and its width. */
export interface ViewSpan {
  readonly x: number;
  readonly w: number;
}

/** How the hero moves on this tick: px per 60 Hz frame, and whether he is in the air (then he falls on). */
export interface HeroMotion {
  readonly vx: number;
  readonly vy: number;
  readonly airborne: boolean;
}

/** The fall `heroSweep` assumes: the pull going up and coming down (px per frame, per frame) and the fastest fall (px per frame). */
export interface FallModel {
  readonly rise: number;
  readonly fall: number;
  readonly maxFall: number;
}

/**
 * Where the hero's sprite `hero` (world px) will be over the next `frames` 60 Hz frames if he goes on as he moves now: carried
 * across at his speed and, in the air, rising and falling under `fall` (the lighter pull while he rises, so the sweep
 * reaches at least as high as he can); and `head` px more above. One rectangle that holds every place, into `out`.
 */
export function heroSweep(hero: PxRect, m: HeroMotion, fall: FallModel, frames: number, head: number, out: { x: number; y: number; w: number; h: number }): PxRect {
  const across = Math.round(m.vx * frames);
  let top = hero.y;
  let bottom = hero.y;
  if (m.airborne) {
    let y = hero.y;
    let vy = m.vy;
    for (let f = 0; f < frames; f++) {
      vy = Math.min(vy + (vy < 0 ? fall.rise : fall.fall), fall.maxFall);
      y += vy;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  out.x = hero.x + Math.min(0, across);
  out.y = Math.floor(top) - head;
  out.w = hero.w + Math.abs(across);
  out.h = Math.ceil(bottom) + hero.h - out.y;
  return out;
}

const rectsMeet = (a: PxRect, b: PxRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the score pop-ups are drawn (docs/ART-AND-SOUND.md section 13), as numbers: Effects draws one text per
 * slot at (`drawX`, `drawY`). Each pop-up rises POPUP_RISE_PX over POPUP_FRAMES from where it appeared, and is
 * placed, every frame, oldest first, by four rules:
 * - never into the top bar: its top stays at POPUP_TOP or lower in the view, and at POPUP_TOP_UNDER_TOAST while the
 *   cog's toast shows (the score and the toast's words are never covered);
 * - never past the view's left or right edge (one stepping aside from a hero by a side wall was drawn 3 px past the
 *   edge at 120 Hz: the route watch's second re-check);
 * - never over another pop-up already placed;
 * - never over the hero's sprite (and the fuel bar over it) as drawn on that frame.
 * Where its own place breaks a rule when it appears, it takes the nearest free place that keeps them: pushed down
 * under the pop-ups above it, or beside, above or below the hero. After that it goes on rising from where it was
 * drawn, and moves off that course only as far as a rule asks, to the nearest free place from where it was: a hero
 * walking into it pushes it along at his own pace. (Before, every pop-up was placed afresh each frame from where it
 * would have been: one beside a moving hero hopped round him from frame to frame, '+50' left and right of him on
 * alternate frames, 36 px each time; the route watch's second re-check.)
 * Under reduced motion a pop-up is placed so once, when it appears, and then stays (moved only as far as the bar's
 * rule and the view's edges ask as it scrolls). It appears clear of where the hero will be over its first POPUP_MIN_FRAMES frames if he
 * goes on as he moves (`heroSweep`), where it can. If he still comes onto it in that time (he turned, or jumped), it
 * moves at once to the nearest free place, so that it can be read; after that time it is taken down instead.
 */
export class PopupBoard {
  readonly slots: PopupSlot[];
  private seq = 0;
  private readonly placed: PxRect[] = [];
  /** Where the hero was drawn on the frame before (`heroKnown`: he was drawn): his pace. */
  private heroX = 0;
  private heroY = 0;
  private heroKnown = false;
  /** Where he will be on the next frame at that pace, while it is POPUP_PUSH_PX or more (null: slower, or unknown). */
  private heroNext: PxRect | null = null;
  /** And the ground he covers over the next POPUP_LOOK_FRAMES frames at that pace (null with `heroNext`). */
  private heroPath: PxRect | null = null;
  /** The view across on this frame (null: no side edges). */
  private view: ViewSpan | null = null;

  constructor(
    private readonly reducedMotion: boolean,
    size = POPUP_POOL,
  ) {
    this.slots = Array.from({ length: size }, () => ({ x: 0, y: 0, w: 0, age: POPUP_FRAMES, seq: 0, drawX: 0, drawY: 0, firstY: Number.NaN, offX: 0, offY: 0, stepX: 0, stepY: 0 }));
  }

  /** Every pop-up gone. */
  clear(): void {
    for (const s of this.slots) s.age = POPUP_FRAMES;
    this.heroKnown = false;
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
    free.offX = 0;
    free.offY = 0;
    free.stepX = 0;
    free.stepY = 0;
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
   * view's scroll `camY`, the toast (`toastUp`), the hero's sprite `hero` as drawn on this frame (world px; null:
   * not drawn) and the view across, `view` (null: no side edges). `ahead` (under reduced motion): where the hero's
   * sprite will be over the next POPUP_MIN_FRAMES frames (`heroSweep`); a pop-up appears clear of it where it can.
   * Under reduced motion a pop-up the hero comes onto moves if it has shown fewer than POPUP_MIN_FRAMES frames, and is
   * taken down (its slot freed) after that.
   */
  place(camY: number, toastUp: boolean, hero: PxRect | null, ahead: PxRect | null = null, view: ViewSpan | null = null): void {
    const minTop = camY + (toastUp ? POPUP_TOP_UNDER_TOAST : POPUP_TOP);
    const placed = this.placed;
    placed.length = 0;
    this.view = view;
    this.pace(hero);
    const sweep = this.reducedMotion ? ahead : null;
    for (const s of this.shown()) {
      const risen = s.y - this.rise(s.age);
      let at: PxRect;
      if (Number.isNaN(s.firstY)) {
        // Appearing: its own place, or the nearest free one (under reduced motion, off his way too, where it can).
        at = this.free(this.inView({ x: s.x, y: Math.max(risen, minTop), w: s.w, h: POPUP_H }), minTop, hero, 0, 0, sweep);
      } else if (this.reducedMotion) {
        // Under reduced motion it stays where it is (ART-AND-SOUND section 13): moved only down and across, only as far
        // as the bar's rule, the view's edges and an older one held under the bar ask, and then it stays there. (Two held
        // under the bar as the view followed a fall were drawn on each other; one held under the toast's band went back
        // up 9 px on screen when the toast ended, level 4.)
        at = this.inView({ x: s.drawX, y: Math.max(s.firstY, minTop), w: s.w, h: POPUP_H });
        if (placed.some((q) => rectsMeet(at, q))) at = this.pushDown(at, null);
        if (hero !== null && rectsMeet(at, hero)) {
          if (s.age >= POPUP_MIN_FRAMES) {
            // Read by now: taken down rather than moved.
            s.age = POPUP_FRAMES;
            continue;
          }
          // Not shown long enough to be read: it moves at once to the nearest free place, clear of the younger pop-ups too
          // (they stay where they are); again if he comes onto it again in that time (on the proofs none moves twice).
          const older = placed.length;
          for (const o of this.shown()) if (o.seq > s.seq && !Number.isNaN(o.firstY)) placed.push({ x: o.drawX, y: o.drawY, w: o.w, h: POPUP_H });
          at = this.free(at, minTop, hero, 0, 0, sweep);
          placed.length = older;
        }
        s.firstY = at.y;
      } else {
        // Where it was drawn, risen on; kept while it breaks no rule, else the nearest free place from there.
        const keep = this.inView({ x: s.x + s.offX, y: Math.max(risen + s.offY, minTop), w: s.w, h: POPUP_H });
        at = this.free(keep, minTop, hero, s.stepX, s.stepY);
        s.stepX = at.x - keep.x;
        s.stepY = at.y - keep.y;
      }
      s.drawX = at.x;
      s.drawY = at.y;
      s.offX = at.x - s.x;
      s.offY = at.y - risen;
      if (Number.isNaN(s.firstY)) s.firstY = at.y;
      placed.push(at);
    }
  }

  /** The hero's pace since the frame before: sets `heroNext` and `heroPath` while it is POPUP_PUSH_PX a frame or more. */
  private pace(hero: PxRect | null): void {
    const known = this.heroKnown;
    this.heroKnown = hero !== null;
    this.heroNext = null;
    this.heroPath = null;
    if (!hero) return;
    const dx = known ? hero.x - this.heroX : 0;
    const dy = known ? hero.y - this.heroY : 0;
    this.heroX = hero.x;
    this.heroY = hero.y;
    if (Math.abs(dx) + Math.abs(dy) < POPUP_PUSH_PX) return;
    this.heroNext = { x: hero.x + dx, y: hero.y + dy, w: hero.w, h: hero.h };
    const k = POPUP_LOOK_FRAMES;
    // Up and down both ways: a jump comes back down, a fall lands and hops again.
    this.heroPath = { x: Math.min(hero.x, hero.x + k * dx), y: hero.y - k * Math.abs(dy), w: hero.w + k * Math.abs(dx), h: hero.h + 2 * k * Math.abs(dy) };
  }

  /** `r` moved across into the view, if the view is known and `r` reaches past one of its edges. */
  private inView(r: PxRect): PxRect {
    const v = this.view;
    if (v === null) return r;
    const x = Math.max(v.x, Math.min(r.x, v.x + v.w - r.w));
    return x === r.x ? r : { ...r, x };
  }

  /**
   * The free place nearest `want` (no higher than `minTop`, inside the view across, clear of the hero and of the pop-ups
   * placed so far); and clear of `sweep` (where the hero is going) too where that costs less than going on top of it.
   */
  private free(want: PxRect, minTop: number, hero: PxRect | null, stepX: number, stepY: number, sweep: PxRect | null = null): PxRect {
    const blocked = (r: PxRect): boolean => (hero !== null && rectsMeet(r, hero)) || this.placed.some((q) => rectsMeet(r, q));
    if (!blocked(want) && (sweep === null || !rectsMeet(want, sweep))) return want;
    const starts: PxRect[] = [want];
    for (const by of hero && sweep ? [hero, sweep] : hero ? [hero] : sweep ? [sweep] : []) {
      starts.push(
        { ...want, x: by.x - want.w },
        { ...want, x: by.x + by.w },
        { ...want, y: Math.max(minTop, by.y - want.h) },
        { ...want, y: by.y + by.h },
      );
    }
    let best: PxRect | null = null;
    let bestCost = Infinity;
    const next = this.heroNext;
    const path = this.heroPath;
    for (const start of starts) {
      const r = this.pushDown(this.inView(start), hero);
      if (blocked(r)) continue;
      // A hero moving fast (POPUP_PUSH_PX a frame or more) would push a pop-up left in his way on every frame, a jump
      // each time: it steps out of his way once instead, off the ground he is about to cover where it can.
      const mx = r.x - want.x;
      const my = r.y - want.y;
      const move = Math.abs(mx) + Math.abs(my);
      // A step aside of POPUP_FLIP_PX or more is not followed by another as large on the next frame that does not carry
      // on the same way: it would flip round him.
      const back = move >= POPUP_FLIP_PX && Math.abs(stepX) + Math.abs(stepY) >= POPUP_FLIP_PX && mx * stepX + my * stepY <= 0;
      const cost =
        move +
        (back ? 2000 : 0) +
        (next !== null && rectsMeet(r, next) ? 1000 : 0) +
        (path !== null && rectsMeet(r, path) ? 500 : 0) +
        (sweep !== null && rectsMeet(r, sweep) ? 1000 : 0);
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
