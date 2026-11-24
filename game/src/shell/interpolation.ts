/**
 * Render interpolation, mode 'auto' (ruling R13; docs/ARCHITECTURE.md 11.1, docs/PHASER4-NOTES.md section 12).
 *
 * The simulation runs whole 60 Hz ticks. On a 60 Hz screen every frame shows exactly one new tick and
 * the picture is drawn from the current state. On a faster screen (90, 120 Hz) some frames fall
 * between two ticks; there the picture is drawn part of the way from the previous tick's position to
 * the current one, so motion stays smooth. Two pieces:
 *
 * - `InterpolationGate` decides whether to do it at all: it switches on when the display's frame
 *   interval (the median of the last 31 raw frame intervals) is under `TUNING.pacing.interpolateBelowMs`,
 *   and off again only when it rises above that by GATE_HYSTERESIS_MS, so a display near the line
 *   (71 or 72 Hz) does not flip it back and forth.
 * - `lerpPx` blends WHOLE-PIXEL draw positions. After every tick the view stores each sprite's and the
 *   camera's whole-pixel draw position (what it would draw with interpolation off); each frame it
 *   draws `lerpPx(prev, cur, gate.alpha(stepper))`, sprites and camera alike. Never blend sub-pixels
 *   and floor afterwards: with the camera locked to the hero that wobbles the hero across three screen
 *   pixels at 144 Hz; blending the whole pixels keeps it on one.
 *
 * Use in `PlayScene.update`:
 *
 *   gate.sample(this.game.loop.rawDelta);                 // every frame, the UNSMOOTHED interval
 *   const n = stepper.advance(deltaMs);                    // the smoothed delta
 *   for (...) { ...; view.capture(...) }                   // prev = cur; cur = whole-pixel positions
 *   view.render(gate.alpha(stepper));                      // 1 while the gate is off
 *
 * `gate.reset()` together with `stepper.reset()` on every pause, resume, scene start and level start.
 * A draw position also snaps (`prev = cur`) on `levelStarted` and `respawned`, and for anything that
 * was not drawn on the previous tick (a bolt that became active, an enemy back to life, a pickup that
 * reappeared). Pure: no Phaser, no DOM.
 */
import { TILE_PX } from '../core/types';

/**
 * How many recent frames the gate looks at. An odd number, so the median is one real interval; 31
 * frames is a quarter of a second at 120 Hz. A hitch or two cannot flip the decision, a real change of
 * display rate flips it within 16 frames. Measured in docs/PHASER4-NOTES.md, section 12: a property of
 * display timing, not a feel number.
 */
export const GATE_WINDOW_FRAMES = 31;

/**
 * Once on, the gate switches off only when the median interval rises above `interpolateBelowMs` by
 * this many ms (it switches on below `interpolateBelowMs` itself). Without the margin a display whose
 * interval lies near the line (72 Hz: 13.89 ms, 71 Hz: 14.08 ms) flipped the gate hundreds of times a
 * minute with ordinary timestamp jitter of +-0.5 to +-1 ms, and every flip moved each drawn position
 * by up to one tick of motion: the stutter interpolation is there to remove. Measured over 20 seeds,
 * 68 to 74 Hz displays: with a margin of 1 ms, +-1.5 ms of jitter still gave up to 6 flips a minute;
 * with 1.5 ms, at most 1 flip up to +-1.5 ms (3 at +-2 ms). Such a display keeps whichever state it
 * reached first. A 60 Hz display (16.7 ms) is still above the off line, so a phone that drops from
 * 120 to 60 Hz switches interpolation off. A property of display timing, like GATE_WINDOW_FRAMES,
 * not a feel number.
 */
export const GATE_HYSTERESIS_MS = 1.5;

/**
 * A draw position that moved more than this in one tick (art px) has teleported (respawn, level
 * start) and is shown at its new place at once instead of sliding there. One tile: nothing in the game
 * moves that fast (speeds are below half a tile per tick, `src/tuning.test.ts`).
 */
export const TELEPORT_PX = TILE_PX;

/** What the gate needs from the stepper: how far the display is between the last tick and the next. */
export interface HasAlpha {
  readonly alpha: number;
}

/** The 'auto' on/off decision, from measured frame intervals. */
export class InterpolationGate {
  private readonly belowMs: number;
  private readonly windowFrames: number;
  private readonly hysteresisMs: number;
  private readonly recent: number[] = [];
  private on = false;

  /**
   * @param belowMs      `TUNING.pacing.interpolateBelowMs`: switches on when the median interval is under this
   * @param windowFrames leave at its default
   * @param hysteresisMs leave at its default: switches off only above `belowMs + hysteresisMs`
   */
  constructor(belowMs: number, windowFrames = GATE_WINDOW_FRAMES, hysteresisMs = GATE_HYSTERESIS_MS) {
    if (!Number.isInteger(windowFrames) || windowFrames < 1) {
      throw new RangeError(`InterpolationGate: windowFrames must be a whole number of at least 1, got ${windowFrames}`);
    }
    if (!(hysteresisMs >= 0 && Number.isFinite(hysteresisMs))) {
      throw new RangeError(`InterpolationGate: hysteresisMs must be 0 or more, got ${hysteresisMs}`);
    }
    this.belowMs = belowMs;
    this.windowFrames = windowFrames;
    this.hysteresisMs = hysteresisMs;
  }

  /**
   * Feed the RAW interval of every rendered frame (`game.loop.rawDelta`, ms). Returns whether
   * interpolation is on. Stays off until a full window has been measured; a length of 0, a negative
   * one or NaN is ignored.
   */
  sample(frameMs: number): boolean {
    if (!(frameMs > 0)) return this.on; // also rejects NaN
    this.recent.push(frameMs);
    if (this.recent.length > this.windowFrames) this.recent.shift();
    if (this.recent.length === this.windowFrames) {
      const sorted = [...this.recent].sort((a, b) => a - b);
      const median = sorted[(this.windowFrames - 1) >> 1] ?? frameMs;
      this.on = this.on ? median <= this.belowMs + this.hysteresisMs : median < this.belowMs;
    }
    return this.on;
  }

  get isOn(): boolean {
    return this.on;
  }

  /** The blend factor to draw with: the stepper's alpha while on, 1 (the current tick) while off. */
  alpha(stepper: HasAlpha): number {
    return this.on ? stepper.alpha : 1;
  }

  /** Call on every pause, resume, scene start and level start: measure again before trusting the old answer. */
  reset(): void {
    this.recent.length = 0;
    this.on = false;
  }
}

/**
 * The whole-pixel position to draw at, `alpha` of the way from the previous tick's draw position to
 * the current one. Both positions are whole art pixels and so is the result. A move of more than
 * `snapPx` in one tick is a teleport and is not blended: the current position is returned.
 *
 * @param prevPx draw position captured after the previous tick
 * @param curPx  draw position captured after the latest tick
 * @param alpha  0 (previous) to 1 (current): `gate.alpha(stepper)`
 */
export function lerpPx(prevPx: number, curPx: number, alpha: number, snapPx = TELEPORT_PX): number {
  const d = curPx - prevPx;
  if (d > snapPx || d < -snapPx) return curPx;
  return prevPx + Math.round(d * alpha);
}
