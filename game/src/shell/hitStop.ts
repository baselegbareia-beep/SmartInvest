/**
 * The hit stop on a kill (docs/ARCHITECTURE.md 11.1, docs/ART-AND-SOUND.md section 13): after a tick
 * whose events hold `enemyKilled`, the Play scene steps nothing for `TUNING.effects.killHitStopFrames`
 * 60 Hz frames, but still draws. Never during a replay, so replays stay tick-exact. The freeze at a
 * death is not this: it is part of the core's dying phase.
 *
 * Pure: the Play scene asks `hold()` once for each 60 Hz frame it is about to spend on a tick.
 */
export class HitStop {
  private left = 0;

  /**
   * @param enabled false for a replay: requests are then ignored, so the script's ticks run unbroken
   */
  constructor(private readonly enabled = true) {}

  /** Hold the picture for `frames` frames from now (a longer hold already running is kept). */
  request(frames: number): void {
    if (!this.enabled || !(frames > 0)) return;
    this.left = Math.max(this.left, Math.floor(frames));
  }

  /** True when this frame is held (and is used up): step nothing. False: step the tick as usual. */
  hold(): boolean {
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }

  /** Frames still to hold. */
  get frames(): number {
    return this.left;
  }

  /** A new level, a pause: nothing is held. */
  reset(): void {
    this.left = 0;
  }
}
