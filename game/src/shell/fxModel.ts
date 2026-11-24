/**
 * The timing of the visual feedback (docs/ART-AND-SOUND.md sections 4 "Effects" and 13), as small pure
 * state machines that Effects.ts drives. Pure: no Phaser, no DOM, no clock; randomness is passed in.
 *
 * Strengths and lengths the owner may tune come from TUNING.effects (the caller passes them). The
 * numbers written here are the ones docs/ART-AND-SOUND.md gives as art: the pop-up's 12 px over 30
 * frames, the cog's 20 % flash for 4 frames, the enemy's 2-frame white flash, the airlock pointer's
 * 180 ticks, an ember every 20 ticks.
 */
import { Tile } from '../core/types';
import type { LevelData } from '../core/types';

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

/** How far a pop-up has risen `age` frames after it appeared: whole px, 0 to POPUP_RISE_PX. */
export function popupRise(age: number): number {
  return Math.round((POPUP_RISE_PX * Math.min(Math.max(age, 0), POPUP_FRAMES)) / POPUP_FRAMES);
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
