import { describe, expect, it } from 'vitest';

import { TICK_HZ } from '../core/types';
import { TUNING } from '../tuning';

import { DEFAULT_SNAP_MS, FixedStepper } from './FixedStepper';

const STEP_MS = 1000 / TICK_HZ;
/** The value the game ships with; the tests of the rule use it whatever src/tuning.ts says today. */
const MAX_STEPS = 5;

const make = (): FixedStepper => new FixedStepper(STEP_MS, MAX_STEPS);

/** A small seeded generator (mulberry32), so that "random" frame times are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Run {
  ticks: number;
  elapsedMs: number;
  /** How many frames ran 0, 1, 2 ... ticks. */
  histogram: number[];
  /** Ticks simulated by the end of each whole second. */
  perSecond: number[];
}

/** Feeds a list of frame lengths to a fresh stepper. */
function run(deltas: Iterable<number>, stepper = make()): Run {
  const out: Run = { ticks: 0, elapsedMs: 0, histogram: [], perSecond: [] };
  for (const delta of deltas) {
    const n = stepper.advance(delta);
    out.ticks += n;
    out.elapsedMs += delta;
    out.histogram[n] = (out.histogram[n] ?? 0) + 1;
    while (out.elapsedMs >= (out.perSecond.length + 1) * 1000 - 1e-6) out.perSecond.push(out.ticks);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(MAX_STEPS);
    expect(Number.isInteger(n)).toBe(true);
    expect(stepper.alpha).toBeGreaterThanOrEqual(0);
    expect(stepper.alpha).toBeLessThanOrEqual(1);
  }
  return out;
}

/** `seconds` of a display that shows a frame exactly every 1 / hz seconds. */
function steady(hz: number, seconds: number): number[] {
  return Array.from({ length: Math.round(hz * seconds) }, () => 1000 / hz);
}

/**
 * Frame times of a real display: frames are shown every 1 / hz seconds on average, but each
 * timestamp is up to `jitterMs` early or late. A frame that comes late makes the next one short, so
 * the lengths vary although the display's rate does not. The frames on whole seconds are left on
 * time, so that every display can be compared at the same instants.
 */
function jitteryTimes(hz: number, seconds: number, jitterMs: number, seed: number): number[] {
  const random = seeded(seed);
  return Array.from({ length: Math.round(hz * seconds) }, (_, i) => {
    const frame = i + 1;
    const exact = (frame * 1000) / hz;
    return frame % hz === 0 ? exact : exact + (random() * 2 - 1) * jitterMs;
  });
}

/** Frame lengths from frame timestamps (the first frame starts at time 0). */
function lengths(times: readonly number[]): number[] {
  return times.map((at, i) => at - (i === 0 ? 0 : (times[i - 1] ?? 0)));
}

/**
 * What the stepper is really fed: the `delta` argument of a scene's update(), which Phaser 4.2.1
 * smooths (TimeStep.smoothDelta) as the average of the last 10 raw frame lengths, a raw length over
 * 200 ms (minFps 5) being replaced by the oldest remembered one. The history starts full of 1000 / 60
 * and the game config sets `fps: { panicMax: 0 }`, so there is no cool-down. A scratch script fed
 * 120,000 random frames to Phaser's own TimeStep and to this model: they agreed exactly.
 */
function phaserSmoothed(raw: readonly number[]): number[] {
  const history = Array.from({ length: 10 }, () => 1000 / 60);
  let index = 0;
  return raw.map((delta) => {
    const sane = delta > 200 ? Math.min(history[index] ?? 0, 200) : delta;
    history[index] = sane;
    index = (index + 1) % history.length;
    return history.reduce((sum, d) => sum + d, 0) / history.length;
  });
}

/** Ticks simulated by the frame that ends each whole second, for frames given as timestamps. */
function ticksAtEachSecond(times: readonly number[], deltas: readonly number[]): number[] {
  const stepper = make();
  const out: number[] = [];
  let ticks = 0;
  deltas.forEach((delta, i) => {
    ticks += stepper.advance(delta);
    const at = times[i] ?? 0;
    if (Math.abs(at / 1000 - Math.round(at / 1000)) < 1e-9) out.push(ticks);
  });
  return out;
}

describe('FixedStepper: the same game speed on every display', () => {
  it.each([30, 60, 90, 120, 144])('%i Hz for 10 s gives 600 ticks, within one', (hz) => {
    const { ticks } = run(steady(hz, 10));
    expect(Math.abs(ticks - 10 * TICK_HZ)).toBeLessThanOrEqual(1);
  });

  it('30, 60, 90, 120 and 144 Hz agree within one tick at the end of every second of a minute', () => {
    const displays = [30, 60, 90, 120, 144].map((hz) => run(steady(hz, 60)).perSecond);
    for (let second = 0; second < 60; second++) {
      const counts = displays.map((perSecond) => perSecond[second] ?? Number.NaN);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(Math.abs((counts[1] ?? Number.NaN) - (second + 1) * TICK_HZ)).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    [30, 0],
    [60, 0],
    [90, 0],
    [120, 0],
    [144, 0],
    [30, 3],
    [60, 0.2],
    [60, 2],
    [90, 1.5],
    [120, 1.5],
    [144, 1],
  ])(
    'through Phaser\'s smoothed delta, a %i Hz display with frames up to %f ms early or late runs 60 ticks a second, within one tick at every second of a minute',
    (hz, jitterMs) => {
      for (let seed = 1; seed <= 10; seed++) {
        const times = jitteryTimes(hz, 60, jitterMs, seed);
        const atSecond = ticksAtEachSecond(times, phaserSmoothed(lengths(times)));
        expect(atSecond).toHaveLength(60);
        // Counted from the end of the first second: the smoothing needs 10 frames to learn the rate.
        const first = atSecond[0] ?? Number.NaN;
        atSecond.forEach((ticks, i) => {
          expect(Math.abs(ticks - first - i * TICK_HZ)).toBeLessThanOrEqual(1);
        });
      }
    },
  );

  it('a 60 Hz display with frames up to 2 ms early or late keeps exact time for 10 minutes', () => {
    const times = jitteryTimes(60, 600, 2, 99);
    const atSecond = ticksAtEachSecond(times, phaserSmoothed(lengths(times)));
    const first = atSecond[0] ?? Number.NaN;
    expect(Math.abs((atSecond[599] ?? Number.NaN) - first - 599 * TICK_HZ)).toBeLessThanOrEqual(1);
  });

  it.each([
    [60, 0.2],
    [90, 1.5],
    [120, 1.5],
    [144, 1],
    [30, 3],
  ])('fed the raw frame lengths of a jittery %i Hz display (up to %f ms early or late), the tick count stays within one of real time', (hz, jitterMs) => {
    for (let seed = 1; seed <= 25; seed++) {
      const times = jitteryTimes(hz, 10, jitterMs, seed);
      const { ticks, elapsedMs } = run(lengths(times));
      expect(Math.abs(ticks - elapsedMs / STEP_MS)).toBeLessThanOrEqual(1);
      expect(Math.abs(ticks - 10 * TICK_HZ)).toBeLessThanOrEqual(1);
    }
  });

  it('a display with no fixed rate at all (frames of 7 to 30 ms at random) stays on real time, give or take what the snap adds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seeded(seed);
      const stepper = make();
      let ticks = 0;
      let elapsedMs = 0;
      let snapped = 0;
      for (let i = 0; i < 1500; i++) {
        const delta = 7 + random() * 23;
        if (Math.abs(delta - STEP_MS) < DEFAULT_SNAP_MS) snapped++;
        ticks += stepper.advance(delta);
        elapsedMs += delta;
        // The accumulator holds less than one tick; a snapped frame counts at most snapMs more or less than it lasted.
        const slack = snapped * DEFAULT_SNAP_MS;
        expect(ticks * STEP_MS).toBeLessThanOrEqual(elapsedMs + slack + 1e-6);
        expect(ticks * STEP_MS).toBeGreaterThan(elapsedMs - slack - STEP_MS - 1e-6);
      }
    }
  });

  it('stays at full speed down to 12 frames per second: 83.3 ms frames run 5 ticks each', () => {
    const { ticks, histogram } = run(steady(12, 10));
    expect(ticks).toBe(600);
    expect(histogram[5]).toBe(120);
  });
});

describe('FixedStepper: frame lock on 60 Hz displays', () => {
  it('runs exactly one tick every frame at a steady 60 Hz', () => {
    const { histogram } = run(steady(60, 60));
    expect(histogram).toEqual([undefined, 3600]);
  });

  it('timing noise inside the snap window still gives exactly one tick every frame', () => {
    const stepper = make();
    for (let i = 0; i < 2000; i++) {
      const noise = ((i * 7919) % 9) / 10 - 0.4; // -0.4 .. +0.4 ms
      expect(stepper.advance(STEP_MS + noise)).toBe(1);
      expect(stepper.alpha).toBe(0);
    }
  });

  it('a frame outside the snap window is counted at its real length', () => {
    const early = make();
    expect(early.advance(STEP_MS - DEFAULT_SNAP_MS - 0.1)).toBe(0);
    expect(early.alpha).toBeCloseTo((STEP_MS - DEFAULT_SNAP_MS - 0.1) / STEP_MS, 9);

    const late = make();
    expect(late.advance(STEP_MS + DEFAULT_SNAP_MS + 0.1)).toBe(1);
    expect(late.alpha).toBeCloseTo((DEFAULT_SNAP_MS + 0.1) / STEP_MS, 9);
  });

  it('without the snap, the same noise would produce frames with no tick and frames with two', () => {
    const { histogram } = run(
      Array.from({ length: 2000 }, (_, i) => STEP_MS + ((i * 7919) % 9) / 10 - 0.4),
      new FixedStepper(STEP_MS, MAX_STEPS, 0),
    );
    expect((histogram[0] ?? 0) + (histogram[2] ?? 0)).toBeGreaterThan(0);
  });
});

describe('FixedStepper: stalls', () => {
  it.each([100, 200, 600, 5000, 60000])('a stall of %i ms runs at most 5 ticks and leaves nothing behind', (stallMs) => {
    const stepper = make();
    for (let i = 0; i < 30; i++) expect(stepper.advance(STEP_MS)).toBe(1);
    const during = stepper.advance(stallMs);
    expect(during).toBe(MAX_STEPS);
    expect(stepper.alpha).toBe(0); // the backlog is gone
    // No burst afterwards: the display is back at 60 Hz and so is the game.
    for (let i = 0; i < 30; i++) expect(stepper.advance(STEP_MS)).toBe(1);
  });

  it('through Phaser\'s smoothed delta a long stall never produces a burst: every frame of a 60 Hz display still runs one tick', () => {
    for (const stallMs of [250, 600, 3000, 60000]) {
      const raw = [...steady(60, 2), stallMs, ...steady(60, 2)];
      const { histogram } = run(phaserSmoothed(raw));
      expect(histogram, `stall of ${stallMs} ms`).toEqual([undefined, raw.length]);
    }
  });

  it('a hitch shorter than the cap is caught up exactly, not dropped', () => {
    const stepper = make();
    expect(stepper.advance(3 * STEP_MS + 5)).toBe(3);
    expect(stepper.alpha).toBeCloseTo(5 / STEP_MS, 9);
    expect(stepper.advance(STEP_MS - 5)).toBe(1);
  });

  it('a phone that cannot keep up (10 frames per second) slows the game down instead of spiralling', () => {
    const { ticks, histogram } = run(steady(10, 10));
    expect(histogram[MAX_STEPS]).toBe(100);
    expect(ticks).toBe(100 * MAX_STEPS); // 50 ticks per second: slow motion, never a growing backlog
  });

  it('never runs ahead of real time, whatever the frame times are', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seeded(seed);
      const stepper = make();
      let ticks = 0;
      let elapsedMs = 0;
      let snapped = 0;
      for (let i = 0; i < 2000; i++) {
        // Mostly ordinary frames, now and then a stall of up to 3 s.
        const delta = random() < 0.02 ? random() * 3000 : 4 + random() * 40;
        if (Math.abs(delta - STEP_MS) < DEFAULT_SNAP_MS) snapped++;
        const n = stepper.advance(delta);
        expect(n).toBeLessThanOrEqual(MAX_STEPS);
        ticks += n;
        elapsedMs += delta;
        // The only time ever added is the snap's: at most half a millisecond per snapped frame.
        expect(ticks * STEP_MS).toBeLessThanOrEqual(elapsedMs + snapped * DEFAULT_SNAP_MS + 1e-6);
      }
    }
  });

  it('reset() forgets time that was not simulated', () => {
    const stepper = make();
    expect(stepper.advance(10)).toBe(0);
    expect(stepper.alpha).toBeCloseTo(10 / STEP_MS, 9);
    stepper.reset();
    expect(stepper.alpha).toBe(0);
    expect(stepper.advance(10)).toBe(0); // without the reset this frame would have run a tick
    expect(stepper.advance(10)).toBe(1);
  });
});

describe('FixedStepper: alpha for render interpolation', () => {
  it('120 Hz alternates between no tick at alpha 0.5 and one tick at alpha 0', () => {
    const stepper = make();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) seen.push(`${stepper.advance(1000 / 120)}:${stepper.alpha.toFixed(2)}`);
    expect(seen).toEqual(['0:0.50', '1:0.00', '0:0.50', '1:0.00', '0:0.50', '1:0.00']);
  });

  it('90 Hz runs two ticks every three frames', () => {
    const stepper = make();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) seen.push(`${stepper.advance(1000 / 90)}:${stepper.alpha.toFixed(2)}`);
    expect(seen).toEqual(['0:0.67', '1:0.33', '1:0.00', '0:0.67', '1:0.33', '1:0.00']);
  });

  it('is 0 before the first frame and stays below 1 after every frame', () => {
    const stepper = make();
    expect(stepper.alpha).toBe(0);
    const random = seeded(7);
    for (let i = 0; i < 5000; i++) {
      stepper.advance(1 + random() * 60);
      expect(stepper.alpha).toBeLessThan(1);
    }
  });
});

describe('FixedStepper: bad input', () => {
  it('ignores a frame length of 0, a negative one and NaN', () => {
    const stepper = make();
    expect(stepper.advance(0)).toBe(0);
    expect(stepper.advance(-5)).toBe(0);
    expect(stepper.advance(Number.NaN)).toBe(0);
    expect(stepper.alpha).toBe(0);
    expect(stepper.advance(STEP_MS)).toBe(1);
  });

  it('treats an endless frame as a stall', () => {
    const stepper = make();
    expect(stepper.advance(Number.POSITIVE_INFINITY)).toBe(MAX_STEPS);
    expect(stepper.alpha).toBe(0);
    expect(stepper.advance(STEP_MS)).toBe(1);
  });

  it('refuses a tick length or a cap that cannot work, naming the value', () => {
    expect(() => new FixedStepper(0, MAX_STEPS)).toThrow(/stepMs/);
    expect(() => new FixedStepper(Number.NaN, MAX_STEPS)).toThrow(/stepMs/);
    expect(() => new FixedStepper(STEP_MS, 0)).toThrow(/maxStepsPerFrame/);
    expect(() => new FixedStepper(STEP_MS, 2.5)).toThrow(/maxStepsPerFrame/);
  });
});

describe('FixedStepper on the live numbers of src/tuning.ts', () => {
  it('pacing.maxStepsPerFrame is a whole number of at least 1, so the game can be built', () => {
    const { maxStepsPerFrame } = TUNING.pacing;
    expect(Number.isInteger(maxStepsPerFrame), 'pacing.maxStepsPerFrame must be a whole number').toBe(true);
    expect(maxStepsPerFrame, 'pacing.maxStepsPerFrame must be at least 1').toBeGreaterThanOrEqual(1);
    const stepper = new FixedStepper(1000 / TICK_HZ, maxStepsPerFrame);
    expect(stepper.advance(60000)).toBe(maxStepsPerFrame);
  });

  it('pacing.maxStepsPerFrame keeps a 30 Hz display at full speed (it needs 2 ticks per frame)', () => {
    expect(TUNING.pacing.maxStepsPerFrame, 'pacing.maxStepsPerFrame below 2 puts every 30 Hz screen in slow motion').toBeGreaterThanOrEqual(2);
  });
});
