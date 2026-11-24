/**
 * The fixed-timestep accumulator (docs/ARCHITECTURE.md 11.1, docs/PHASER4-NOTES.md section 12).
 *
 * The simulation always advances in whole ticks of 1/60 s, whatever the display does. Each rendered
 * frame the scene hands this class the frame's length and gets back how many ticks to run now:
 *
 *   const n = stepper.advance(delta);   // Phaser's smoothed `delta` argument of update()
 *   for (let i = 0; i < n; i++) step(game, controls.consume(), events);
 *
 * - 60 Hz screens run exactly one tick per frame: a frame within `snapMs` of one tick counts as one
 *   tick, so timing noise cannot produce a frame with no tick followed by a frame with two.
 * - Faster screens run a tick on some frames and none on others; `alpha` says how far the picture
 *   is between two ticks, for render interpolation (src/shell/interpolation.ts).
 * - Slow frames run several ticks, at most `maxStepsPerFrame`. A longer backlog is thrown away: the
 *   game slows down instead of running a burst of ticks after a stall.
 *
 * Construct it as `new FixedStepper(1000 / TICK_HZ, TUNING.pacing.maxStepsPerFrame)` and call
 * `reset()` on every pause, resume, scene start and level start.
 *
 * Pure: no Phaser, no DOM, no clock.
 */

/**
 * How close to one tick (ms) a frame must be to count as exactly one tick. A 60 Hz display reports
 * frames of 16.6 to 16.7 ms and Phaser's smoothing keeps them inside this window; the next common
 * refresh rates (50 and 75 Hz: 20 and 13.3 ms) are far outside it. Measured in
 * docs/PHASER4-NOTES.md, section 12: a property of display timing, not a feel number.
 */
export const DEFAULT_SNAP_MS = 0.5;

/** Guards the division against rounding dust, so that six frames of 1/120 s give exactly three ticks. */
const EPSILON_STEPS = 1e-9;

export class FixedStepper {
  private readonly stepMs: number;
  private readonly maxStepsPerFrame: number;
  private readonly snapMs: number;
  /** Time not yet simulated, ms. Always from 0 up to (not including) one tick after `advance`. */
  private acc = 0;

  /**
   * @param stepMs           length of one simulation tick in ms: `1000 / TICK_HZ`
   * @param maxStepsPerFrame most ticks returned by one `advance`: `TUNING.pacing.maxStepsPerFrame`
   * @param snapMs           leave at its default
   */
  constructor(stepMs: number, maxStepsPerFrame: number, snapMs = DEFAULT_SNAP_MS) {
    if (!(stepMs > 0) || !Number.isFinite(stepMs)) throw new RangeError(`FixedStepper: stepMs must be a positive number, got ${stepMs}`);
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new RangeError(`FixedStepper: maxStepsPerFrame must be a whole number of at least 1, got ${maxStepsPerFrame}`);
    }
    this.stepMs = stepMs;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.snapMs = snapMs;
  }

  /**
   * Feed one rendered frame's length in ms; returns how many ticks to simulate now, from 0 to
   * `maxStepsPerFrame`. A length of 0, a negative one or NaN is ignored.
   */
  advance(deltaMs: number): number {
    if (!(deltaMs > 0)) return 0; // also rejects NaN
    // Frame lock on 60 Hz displays: see DEFAULT_SNAP_MS.
    this.acc += Math.abs(deltaMs - this.stepMs) < this.snapMs ? this.stepMs : deltaMs;
    let n = Math.floor(this.acc / this.stepMs + EPSILON_STEPS);
    if (n > this.maxStepsPerFrame) {
      n = this.maxStepsPerFrame;
      this.acc = 0; // drop the backlog: slow down instead of spiralling
    } else {
      this.acc = Math.max(0, this.acc - n * this.stepMs);
    }
    return n;
  }

  /**
   * How far the display is between the last simulated tick (0) and the next one (1). Read it after
   * `advance`; used only by render interpolation.
   */
  get alpha(): number {
    return Math.min(1, this.acc / this.stepMs);
  }

  /** Forgets time that was not simulated. Call on every pause, resume, scene start and level start. */
  reset(): void {
    this.acc = 0;
  }
}
