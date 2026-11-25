import { describe, expect, it } from 'vitest';

import {
  BAND_EDGES,
  HOP,
  LEAD,
  RENDER_RATE,
  SILENCE,
  analyse,
  centroidOf,
  compare,
  crossingJitter,
  crossingPitch,
  dominantOf,
  lastLoud,
  peakOf,
  pitchEnds,
  powerSpectrum,
  recipeNamed,
  renderEffect,
  rmsOf,
} from './offline';
import type { RenderName } from './offline';
import { EFFECT_NAMES, GEM_RECIPES, RECIPES } from './recipes';
import type { EffectName } from './recipes';
import { noiseSamples } from './synth';

/**
 * The measuring half of `offline.ts` on signals whose answers are known. The
 * rendering half needs a browser (`e2e/audio.spec.ts`).
 */

const RATE = RENDER_RATE;

/** `seconds` of a tone after `lead` seconds of silence, followed by `tail` seconds of silence. */
function tone(
  shape: (phase: number, t: number) => number,
  hz: (t: number) => number,
  seconds: number,
  { lead = LEAD, tail = 0.15, amplitude = 0.5, fade = true } = {},
): Float32Array {
  const samples = new Float32Array(Math.ceil((lead + seconds + tail) * RATE));
  const first = Math.round(lead * RATE);
  const count = Math.round(seconds * RATE);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    phase += hz(t) / RATE;
    samples[first + i] = amplitude * shape(phase, t) * (fade ? 1 - i / count : 1);
  }
  return samples;
}

const sine = (phase: number): number => Math.sin(2 * Math.PI * phase);
const square = (phase: number): number => (phase % 1 < 0.5 ? 1 : -1);
const steady =
  (hz: number) =>
  (): number =>
    hz;

describe('offline: simple measures', () => {
  it('finds the peak, the loudness and the last loud sample', () => {
    const samples = Float32Array.from([0, 0.5, -0.8, 0.2, 0, 0.0005, 0]);
    expect(peakOf(samples)).toBeCloseTo(0.8, 6);
    expect(peakOf(samples, 3)).toBeCloseTo(0.2, 6);
    expect(peakOf(samples, 0, 2)).toBeCloseTo(0.5, 6);
    expect(rmsOf(Float32Array.from([1, -1, 1, -1]))).toBe(1);
    expect(rmsOf(Float32Array.from([1, -1, 1, -1]), 0, 8)).toBeCloseTo(Math.sqrt(0.5), 9); // beyond the end counts as silence
    expect(rmsOf(samples, 4, 4)).toBe(0);
    expect(lastLoud(samples, SILENCE)).toBe(3);
    expect(lastLoud(new Float32Array(16), SILENCE)).toBe(-1);
  });
});

describe('offline: pitch and brightness', () => {
  it('finds the frequency of a sine from its spectrum, between the bins', () => {
    for (const hz of [147, 440, 587, 1175, 3000]) {
      const samples = tone(sine, steady(hz), 0.3, { fade: false });
      const power = powerSpectrum(samples, Math.round((LEAD + 0.15) * RATE));
      expect(Math.abs(dominantOf(power, RATE) - hz), String(hz)).toBeLessThan(2);
      expect(Math.abs(centroidOf(power, RATE) - hz), String(hz)).toBeLessThan(hz * 0.03 + 5);
    }
  });

  it('answers 0 for silence', () => {
    const power = powerSpectrum(new Float32Array(4096), 2048);
    expect(dominantOf(power, RATE)).toBe(0);
    expect(centroidOf(power, RATE)).toBe(0);
    expect(crossingPitch(new Float32Array(4096), RATE, 0, 4096)).toBe(0);
    expect(crossingJitter(new Float32Array(4096), 0, 4096)).toBe(0);
  });

  it('puts the strongest line of a square wave on its fundamental and its centroid above it', () => {
    const samples = tone(square, steady(587), 0.3, { fade: false });
    const power = powerSpectrum(samples, Math.round((LEAD + 0.15) * RATE));
    expect(Math.abs(dominantOf(power, RATE) - 587)).toBeLessThan(3);
    expect(centroidOf(power, RATE)).toBeGreaterThan(900);
  });

  it('counts zero crossings to within half a hertz for one clean tone', () => {
    for (const hz of [55, 196, 587, 880, 1320]) {
      const samples = tone(square, steady(hz), 0.3, { fade: false });
      const from = Math.round((LEAD + 0.1) * RATE);
      expect(crossingPitch(samples, RATE, from, from + Math.round(0.08 * RATE)), String(hz)).toBeCloseTo(hz, 0);
    }
    // One crossing is not a pitch.
    const one = tone(sine, steady(20), 0.05, { fade: false });
    expect(crossingPitch(one, RATE, 0, one.length)).toBe(0);
  });

  it('calls a steady tone regular, a slide nearly so, and noise irregular', () => {
    const from = Math.round((LEAD + 0.02) * RATE);
    const to = from + Math.round(0.04 * RATE);
    expect(crossingJitter(tone(sine, steady(587), 0.2, { fade: false }), from, to)).toBeLessThan(0.01);
    const rising = tone(square, (t) => 196 * Math.pow(2, t / 0.09), 0.09, { fade: false });
    expect(crossingJitter(rising, from, to)).toBeLessThan(0.15);
    expect(crossingJitter(noiseSamples(RATE, 7), 1000, 1000 + Math.round(0.04 * RATE))).toBeGreaterThan(0.3);
  });
});

describe('offline: analyse', () => {
  const seconds = 0.2;
  const fading = tone(sine, steady(440), seconds, { amplitude: 0.5 });
  const half = Float32Array.from(fading, (value) => value * 0.5);
  const result = analyse('test', half, fading, RATE, LEAD, seconds);

  it('reports the output and the dry sound separately', () => {
    expect(result.name).toBe('test');
    expect(result.sampleRate).toBe(RATE);
    expect(result.recipeLength).toBe(seconds);
    expect(result.dryPeak).toBeGreaterThan(0.45);
    expect(result.dryPeak).toBeLessThanOrEqual(0.5);
    expect(result.peak).toBeCloseTo(result.dryPeak / 2, 6);
    expect(result.rms).toBeCloseTo(result.dryRms / 2, 6);
    // A sine fading in a straight line from 0.5 to 0: 0.5 / sqrt(2) / sqrt(3).
    expect(result.dryRms).toBeCloseTo(0.5 / Math.sqrt(6), 2);
  });

  it('measures the length from the effect’s start to its last audible sample', () => {
    // The straight fade drops under SILENCE 0.2 % before the end.
    expect(result.length).toBeGreaterThan(seconds - 0.002);
    expect(result.length).toBeLessThanOrEqual(seconds);
    expect(result.tailPeak).toBe(0);
  });

  it('sees a sound that goes on after the recipe’s end', () => {
    const late = Float32Array.from(fading);
    late[Math.round((LEAD + seconds + 0.05) * RATE)] = 0.3;
    const dirty = analyse('late', late, late, RATE, LEAD, seconds);
    expect(dirty.tailPeak).toBeCloseTo(0.3, 6);
    expect(dirty.length).toBeGreaterThan(seconds + 0.04);
  });

  it('gives one entry every 10 ms: loudness falling, pitch and strongest line at 440 Hz', () => {
    expect(result.hop).toBe(HOP);
    for (const list of [result.level, result.pitch, result.dominant, result.centroid]) {
      expect(list).toHaveLength(Math.round(seconds / HOP));
    }
    expect(result.level[2] ?? 0).toBeGreaterThan((result.level[10] ?? 0) * 1.5);
    expect(result.level[10] ?? 0).toBeGreaterThan((result.level[18] ?? 0) * 1.5);
    for (const index of [3, 8, 13, 17]) {
      expect(result.pitch[index], String(index)).toBeCloseTo(440, 0);
      expect(Math.abs((result.dominant[index] ?? 0) - 440), String(index)).toBeLessThan(4);
    }
  });

  it('puts the energy of a 440 Hz tone in the 354 to 707 Hz band and calls it a tone', () => {
    expect(result.bands).toHaveLength(BAND_EDGES.length + 1);
    expect(result.bands.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    expect(result.bands[3]).toBeGreaterThan(0.97);
    expect(result.noisiness).toBeLessThan(0.02);
  });

  it('calls noise noisy and spreads its energy', () => {
    const hiss = new Float32Array(Math.ceil((LEAD + 0.2 + 0.15) * RATE));
    hiss.set(
      noiseSamples(Math.round(0.2 * RATE), 3).map((value) => value * 0.3),
      Math.round(LEAD * RATE),
    );
    const noisy = analyse('hiss', hiss, hiss, RATE, LEAD, 0.2);
    expect(noisy.noisiness).toBeGreaterThan(0.4);
    expect(Math.max(...noisy.bands)).toBeLessThan(0.9);
    expect(noisy.bands[7]).toBeGreaterThan(0.5); // white noise: most of it above 5.6 kHz
  });

  it('reports silence as silence', () => {
    const nothing = new Float32Array(Math.ceil((LEAD + 0.3) * RATE));
    const silent = analyse('nothing', nothing, nothing, RATE, LEAD, 0.1);
    expect(silent.peak).toBe(0);
    expect(silent.rms).toBe(0);
    expect(silent.length).toBe(0);
    expect(silent.pitch.every((value) => value === 0)).toBe(true);
    expect(silent.dominant.every((value) => value === 0)).toBe(true);
    expect(silent.bands.every((value) => value === 0)).toBe(true);
    expect(silent.noisiness).toBe(0);
  });
});

describe('offline: telling effects apart', () => {
  const render = (samples: Float32Array, seconds: number): ReturnType<typeof analyse> =>
    analyse('x', samples, samples, RATE, LEAD, seconds);
  const low = render(tone(sine, steady(440), 0.2), 0.2);

  it('finds nothing between an effect and itself', () => {
    expect(compare(low, low)).toEqual({ length: 0, bands: 0, shape: 0, contour: 0, total: 0 });
  });

  it('tells a low tone from a high one by where the energy sits', () => {
    const high = render(tone(sine, steady(1760), 0.2), 0.2);
    const difference = compare(low, high);
    expect(difference.length).toBeLessThan(0.02);
    expect(difference.bands).toBeGreaterThan(0.95);
    expect(difference.contour).toBeGreaterThan(0.6);
    expect(difference.total).toBe(Math.max(difference.length, difference.bands, difference.shape, difference.contour));
  });

  it('tells a short effect from a long one by length and by shape', () => {
    const long = render(tone(sine, steady(440), 0.8), 0.8);
    const difference = compare(low, long);
    expect(difference.length).toBeCloseTo(0.75, 1);
    expect(difference.shape).toBeGreaterThan(0.2);
    expect(difference.bands).toBeLessThan(0.05);
  });

  it('tells a rising slide from a falling one', () => {
    const up = render(
      tone(sine, (t) => 220 * Math.pow(4, t / 0.4), 0.4, { fade: false }),
      0.4,
    );
    const down = render(
      tone(sine, (t) => 880 / Math.pow(4, t / 0.4), 0.4, { fade: false }),
      0.4,
    );
    const difference = compare(up, down);
    expect(difference.length).toBeLessThan(0.02);
    expect(difference.contour).toBeGreaterThan(0.25);
    expect(pitchEnds(up.pitch).last).toBeGreaterThan(pitchEnds(up.pitch).first * 2.5);
    expect(pitchEnds(down.pitch).first).toBeGreaterThan(pitchEnds(down.pitch).last * 2.5);
  });

  it('is symmetric', () => {
    const other = render(tone(square, steady(880), 0.35), 0.35);
    expect(compare(low, other)).toEqual(compare(other, low));
  });
});

describe('offline: pitchEnds', () => {
  it('reads the first and the last note of a run, skipping silent frames', () => {
    const list = [0, 0, 587, 587, 587, 590, 587, 587, 587, 587, 740, 740, 740, 880, 1175, 1175, 1175, 1174, 1175, 1175, 0];
    expect(pitchEnds(list)).toEqual({ first: 587, last: 1175 });
  });

  it('copes with short lists and empty ones', () => {
    expect(pitchEnds([])).toEqual({ first: 0, last: 0 });
    expect(pitchEnds([0, 0, 0])).toEqual({ first: 0, last: 0 });
    expect(pitchEnds([660])).toEqual({ first: 660, last: 660 });
    expect(pitchEnds([660, 700, 990])).toEqual({ first: 660, last: 990 });
  });
});

describe('offline: renderEffect', () => {
  it('rejects with a plain message where there is no OfflineAudioContext (Node)', async () => {
    await expect(renderEffect('jump')).rejects.toThrow(/needs a browser/);
  });

  it('rejects an unknown name and an empty list before it renders anything', async () => {
    await expect(renderEffect('nope' as EffectName)).rejects.toThrow(/no effect called "nope"/);
    // A name every object has must not pass for an effect.
    const inherited = 'toString' as EffectName;
    await expect(renderEffect(['jump', inherited])).rejects.toThrow(/no effect called "toString"/);
    await expect(renderEffect([])).rejects.toThrow(/no effect was named/);
  });

  it('takes every step of the crystal ladder by its place, gem:0 to gem:5', async () => {
    expect(GEM_RECIPES.length).toBe(6);
    for (const [step, recipe] of GEM_RECIPES.entries()) {
      // The name passes, so it gets as far as rendering, which Node cannot do.
      await expect(renderEffect(`gem:${step}`), `gem:${step}`).rejects.toThrow(/needs a browser/);
      expect(recipeNamed(`gem:${step}`), `gem:${step}`).toBe(recipe);
    }
    await expect(renderEffect(['cog', 'gem:5'])).rejects.toThrow(/needs a browser/);
    // The first step sounds as the game's `gem`; every effect of RECIPES still comes by its own name.
    expect(recipeNamed('gem:0')).toEqual(RECIPES.gem);
    for (const name of EFFECT_NAMES) expect(recipeNamed(name), name).toBe(RECIPES[name]);
  });

  it('refuses a ladder step that does not exist, or one written any other way', async () => {
    const wrong = ['gem:6', 'gem:-1', 'gem:01', 'gem:1.0', 'gem:1e0', 'gem: 1', 'gem:1 ', 'gem:', 'gem:x', 'GEM:1', 'gem1', 'gem:0x1'];
    for (const name of wrong) {
      expect(() => recipeNamed(name), name).toThrow(`no effect called "${name}"`);
      await expect(renderEffect(name as RenderName), name).rejects.toThrow(`no effect called "${name}"`);
    }
    // One wrong step in a list stops the whole render before anything is rendered.
    await expect(renderEffect(['gem:2', 'gem:9'])).rejects.toThrow(/no effect called "gem:9"/);
  });
});
