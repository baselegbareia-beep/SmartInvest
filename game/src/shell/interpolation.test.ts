import { describe, expect, it } from 'vitest';

import { TICK_HZ, TILE_PX } from '../core/types';
import type { CameraTuning } from '../core/types';
import { TUNING } from '../tuning';

import { snapCamera, stepCamera } from './camera';
import type { CameraTarget, Size } from './camera';
import { FixedStepper } from './FixedStepper';
import { GATE_HYSTERESIS_MS, GATE_WINDOW_FRAMES, InterpolationGate, TELEPORT_PX, lerpPx } from './interpolation';

/** The threshold the game shipped with (ruling R13); the rule tests use it whatever src/tuning.ts says today. */
const BELOW_MS = 14;

const feed = (gate: InterpolationGate, frameMs: number, frames: number): boolean => {
  let on = gate.isOn;
  for (let i = 0; i < frames; i++) on = gate.sample(frameMs);
  return on;
};

describe('InterpolationGate: the auto decision', () => {
  it('is off on a 60 Hz screen and on at 75, 90, 120 and 144 Hz', () => {
    expect(feed(new InterpolationGate(BELOW_MS), 1000 / 60, 200)).toBe(false);
    for (const hz of [75, 90, 120, 144]) expect(feed(new InterpolationGate(BELOW_MS), 1000 / hz, 200), `${hz} Hz`).toBe(true);
  });

  it(`decides on the median of the last ${GATE_WINDOW_FRAMES} frames: off until a full window has been measured`, () => {
    const gate = new InterpolationGate(BELOW_MS);
    expect(feed(gate, 1000 / 120, GATE_WINDOW_FRAMES - 1)).toBe(false);
    expect(feed(gate, 1000 / 120, 1)).toBe(true);
  });

  it('hitches do not flip it; a real change of rate does, once it is most of the window', () => {
    const gate = new InterpolationGate(BELOW_MS);
    feed(gate, 1000 / 120, GATE_WINDOW_FRAMES);
    for (let i = 0; i < 300; i++) expect(gate.sample(i % 10 === 0 ? 50 : 1000 / 120)).toBe(true); // a hitch every ten frames
    feed(gate, 1000 / 120, GATE_WINDOW_FRAMES);
    const half = (GATE_WINDOW_FRAMES - 1) / 2;
    expect(feed(gate, 1000 / 60, half)).toBe(true); // not yet the majority
    expect(feed(gate, 1000 / 60, 1)).toBe(false); // now the median is a 60 Hz frame
    expect(feed(gate, 1000 / 120, half)).toBe(false);
    expect(feed(gate, 1000 / 120, 1)).toBe(true);
  });

  it('a slow phone on a 60 Hz screen (frames of 16.7 to 33 ms) never switches it on', () => {
    const gate = new InterpolationGate(BELOW_MS);
    for (let i = 0; i < 500; i++) expect(gate.sample(16.7 + (i % 3) * 8)).toBe(false);
  });

  it('a 60 Hz screen whose timestamps wobble by up to 2 ms never switches it on', () => {
    const gate = new InterpolationGate(BELOW_MS);
    let last = 0;
    for (let i = 1; i <= 2000; i++) {
      const at = (i * 1000) / 60 + (((i * 7919) % 41) / 10 - 2);
      expect(gate.sample(at - last)).toBe(false);
      last = at;
    }
  });

  it('reset on pause and on resume: off again until a full window is measured after it', () => {
    const gate = new InterpolationGate(BELOW_MS);
    feed(gate, 1000 / 120, 100);
    expect(gate.isOn).toBe(true);
    gate.reset(); // pause
    expect(gate.isOn).toBe(false);
    gate.reset(); // resume
    expect(feed(gate, 1000 / 120, GATE_WINDOW_FRAMES - 1)).toBe(false);
    expect(feed(gate, 1000 / 120, 1)).toBe(true);
    // The frames before the reset are forgotten: a 60 Hz window after it is judged on its own.
    gate.reset();
    expect(feed(gate, 1000 / 60, GATE_WINDOW_FRAMES)).toBe(false);
  });

  it('ignores a frame interval of 0, a negative one and NaN', () => {
    const gate = new InterpolationGate(BELOW_MS);
    feed(gate, 1000 / 120, GATE_WINDOW_FRAMES - 1);
    for (const bad of [0, -8, Number.NaN]) expect(gate.sample(bad)).toBe(false);
    expect(gate.sample(1000 / 120)).toBe(true);
  });

  it('alpha() is the stepper\'s while on and 1 (draw the current tick) while off', () => {
    const gate = new InterpolationGate(BELOW_MS);
    const stepper = { alpha: 0.25 };
    expect(gate.alpha(stepper)).toBe(1);
    feed(gate, 1000 / 120, GATE_WINDOW_FRAMES);
    expect(gate.alpha(stepper)).toBe(0.25);
  });

  it('refuses a window or a margin that cannot work, naming the value', () => {
    expect(() => new InterpolationGate(BELOW_MS, 0)).toThrow(/windowFrames/);
    expect(() => new InterpolationGate(BELOW_MS, 2.5)).toThrow(/windowFrames/);
    expect(() => new InterpolationGate(BELOW_MS, GATE_WINDOW_FRAMES, -1)).toThrow(/hysteresisMs/);
    expect(() => new InterpolationGate(BELOW_MS, GATE_WINDOW_FRAMES, Number.NaN)).toThrow(/hysteresisMs/);
  });

  it(`switches on below the threshold and off only above it by GATE_HYSTERESIS_MS (${GATE_HYSTERESIS_MS} ms)`, () => {
    const gate = new InterpolationGate(BELOW_MS);
    expect(feed(gate, BELOW_MS, GATE_WINDOW_FRAMES)).toBe(false); // exactly on the line: not under it
    expect(feed(gate, BELOW_MS - 0.01, GATE_WINDOW_FRAMES)).toBe(true);
    expect(feed(gate, BELOW_MS + GATE_HYSTERESIS_MS, GATE_WINDOW_FRAMES)).toBe(true); // inside the margin: stays on
    expect(feed(gate, BELOW_MS + GATE_HYSTERESIS_MS + 0.01, GATE_WINDOW_FRAMES)).toBe(false);
    expect(feed(gate, BELOW_MS + 0.5, GATE_WINDOW_FRAMES)).toBe(false); // inside the margin: stays off
  });

  /** Flips per minute of a display at `hz` whose frame timestamps wobble by up to +-`jitterMs`, uniformly. */
  function flipsPerMinute(hz: number, jitterMs: number, seed: number): { flips: number; onShare: number } {
    let a = seed >>> 0;
    const random = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gate = new InterpolationGate(BELOW_MS);
    const frames = hz * 60;
    let last = 0;
    let flips = 0;
    let on = 0;
    let was = gate.isOn;
    for (let i = 1; i <= frames + GATE_WINDOW_FRAMES; i++) {
      const at = (i * 1000) / hz + (random() * 2 - 1) * jitterMs;
      const now = gate.sample(at - last);
      last = at;
      if (i <= GATE_WINDOW_FRAMES) {
        was = now; // the first full window decides; only what follows is a flip
        continue;
      }
      if (now !== was) flips++;
      if (now) on++;
      was = now;
    }
    return { flips, onShare: on / frames };
  }

  it('a display near the threshold (70 to 73 Hz) with jittery timestamps keeps one state: at most one flip a minute', () => {
    const found: string[] = [];
    for (const hz of [70, 71, 72, 73]) {
      for (const jitter of [0.25, 0.5, 1, 1.5]) {
        for (const seed of [1, 2, 3]) {
          const { flips } = flipsPerMinute(hz, jitter, seed);
          if (flips > 1) found.push(`${hz} Hz, +-${jitter} ms, seed ${seed}: ${flips} flips in a minute`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('jitter never switches a 60 Hz display on, nor a 75, 90, 120 or 144 Hz display off', () => {
    for (const jitter of [0.5, 1, 1.5]) {
      expect(flipsPerMinute(60, jitter, 7), `60 Hz +-${jitter}`).toEqual({ flips: 0, onShare: 0 });
      for (const hz of [75, 90, 120, 144]) expect(flipsPerMinute(hz, jitter, 7), `${hz} Hz +-${jitter}`).toEqual({ flips: 0, onShare: 1 });
    }
  });
});

describe('lerpPx', () => {
  it('gives the previous position at alpha 0 and the current one at alpha 1', () => {
    expect(lerpPx(100, 110, 0)).toBe(100);
    expect(lerpPx(100, 110, 1)).toBe(110);
    expect(lerpPx(110, 100, 0)).toBe(110);
    expect(lerpPx(110, 100, 1)).toBe(100);
  });

  it('always returns a whole pixel between the two, moving steadily with alpha', () => {
    for (let prev = -20; prev <= 20; prev++) {
      for (let cur = prev - TELEPORT_PX; cur <= prev + TELEPORT_PX; cur++) {
        let last = prev;
        for (let i = 0; i <= 64; i++) {
          const px = lerpPx(prev, cur, i / 64);
          expect(Number.isInteger(px)).toBe(true);
          expect(px).toBeGreaterThanOrEqual(Math.min(prev, cur));
          expect(px).toBeLessThanOrEqual(Math.max(prev, cur));
          expect(Math.sign(px - last) * Math.sign(cur - prev)).toBeGreaterThanOrEqual(0);
          last = px;
        }
      }
    }
  });

  it(`snaps to the current position when it moved more than ${TELEPORT_PX} px (one tile) in one tick: a teleport`, () => {
    expect(TELEPORT_PX).toBe(TILE_PX);
    expect(lerpPx(100, 100 + TELEPORT_PX, 0.5)).toBe(100 + TELEPORT_PX / 2);
    expect(lerpPx(100, 100 + TELEPORT_PX + 1, 0)).toBe(100 + TELEPORT_PX + 1);
    expect(lerpPx(100, 100 - TELEPORT_PX - 1, 0.3)).toBe(100 - TELEPORT_PX - 1);
    expect(lerpPx(40, 900, 0.5)).toBe(900);
  });
});

/** The frozen camera numbers of camera.test.ts. */
const CAM: CameraTuning = Object.freeze({
  camLookAheadPx: 32,
  camLookShiftSpeed: 0.75,
  camDeadzoneHalfW: 12,
  camAnchorY: 0.6,
  camVerticalEase: 0.12,
  camAirBandTop: 0.15,
  camAirBandBottom: 0.78,
  camPassGlideSpeed: 3,
  camPadClearPx: 16,
  camRiseBandTop: 0.45,
  camRiseLookSpeed: 1.5,
  camVerticalMaxStep: 4,
  camFrameDownPx: 32,
  camFrameUpPx: 16,
});

describe('the whole loop: stepper, gate, camera and lerpPx together keep the hero still on screen', () => {
  const VIEW: Size = { w: 320, h: 180 };
  const LEVEL: Size = { w: 400 * TILE_PX, h: 40 * TILE_PX };

  it.each([60, 90, 120, 144])('a %i Hz display, hero running at 1.5 px per tick with the camera locked to him', (hz) => {
    const stepper = new FixedStepper(1000 / TICK_HZ, 5);
    const gate = new InterpolationGate(BELOW_MS);
    let sub = 1000 * 256; // the hero's x in sub-pixels
    const heroAt = (): CameraTarget => ({ x: sub >> 8, feetY: 400, facing: 1, moving: true, onGround: true, running: true });
    let cam = snapCamera(heroAt(), VIEW, LEVEL, CAM);
    // What PlayScene's view captures after every tick: whole-pixel draw positions of the sprite and the camera.
    let cur = { hero: heroAt().x, cam: cam.scrollX };
    let prev = cur;
    const onScreen = new Set<number>();
    let lastDrawn = cur.hero;
    let biggestFrameMove = 0;
    for (let frame = 0; frame < 3000; frame++) {
      gate.sample(1000 / hz);
      const n = stepper.advance(1000 / hz);
      for (let i = 0; i < n; i++) {
        prev = cur;
        sub += 384;
        cam = stepCamera(cam, heroAt(), VIEW, LEVEL, CAM);
        cur = { hero: heroAt().x, cam: cam.scrollX };
      }
      const alpha = gate.alpha(stepper);
      const hero = lerpPx(prev.hero, cur.hero, alpha);
      const scroll = lerpPx(prev.cam, cur.cam, alpha);
      if (frame > 200) {
        onScreen.add(hero - scroll);
        biggestFrameMove = Math.max(biggestFrameMove, Math.abs(hero - lastDrawn));
      }
      lastDrawn = hero;
    }
    expect(gate.isOn).toBe(hz > 60);
    expect([...onScreen]).toHaveLength(1); // zero shimmer
    // Interpolated, the hero moves at most one pixel per frame; at 60 Hz he moves 1 or 2 per frame, one tick each.
    expect(biggestFrameMove).toBe(hz > 60 ? 1 : 2);
  });
});

describe('the live threshold of src/tuning.ts', () => {
  it('pacing.interpolateBelowMs switches interpolation off at 60 Hz and on at 90 and 120 Hz', () => {
    const below = TUNING.pacing.interpolateBelowMs;
    expect(feed(new InterpolationGate(below), 1000 / 60, 100), 'pacing.interpolateBelowMs must be below 16.6 (one 60 Hz frame)').toBe(false);
    // Coming down from a faster rate (a phone that drops to 60 Hz to save power), it must switch off again.
    const gate = new InterpolationGate(below);
    feed(gate, 1000 / 120, 100);
    expect(
      feed(gate, 1000 / 60, 100),
      `pacing.interpolateBelowMs must be below ${(1000 / 60 - GATE_HYSTERESIS_MS).toFixed(1)} (one 60 Hz frame less the gate's ${GATE_HYSTERESIS_MS} ms margin)`,
    ).toBe(false);
    for (const hz of [90, 120]) {
      expect(feed(new InterpolationGate(below), 1000 / hz, 100), `pacing.interpolateBelowMs must be above ${(1000 / hz).toFixed(1)} (one ${hz} Hz frame)`).toBe(true);
    }
  });
});
