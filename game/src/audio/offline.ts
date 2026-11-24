/**
 * Listening with numbers. `renderEffect` renders a recipe through an
 * OfflineAudioContext (the same `scheduleEffect` and the same master chain as
 * the game) and measures what came out: length, peak, loudness, pitch over
 * time and where the energy sits. Node has no Web Audio, so this runs in a
 * browser: the game's test hook exposes it as `window.__E2E__.renderEffect`,
 * and `e2e/audio.spec.ts` calls it for every effect.
 *
 * Everything below `renderRecipes` is plain arithmetic on sample arrays and is
 * unit-tested in Node.
 */
import { RECIPES, effectLength } from './recipes';
import type { EffectName, Recipe } from './recipes';
import { createMaster, createNoiseBuffer, scheduleEffect } from './synth';

/** Sample rate of every render, so that the numbers are the same on every machine. */
export const RENDER_RATE = 44100;
/**
 * Seconds of silence rendered before the effect starts. A compressor needs
 * about 0.1 s after its context has started before it passes sound at its
 * settled gain (measured: a blip 10 ms after the start came out at half the
 * level of the same blip 200 ms after it). The game's context has been
 * running since the first tap, so the render waits for the settled state too.
 */
export const LEAD = 0.25;
/** Seconds rendered after the recipe's end, to prove that the effect really ends. */
export const TAIL = 0.15;
/** A loop rendered alone is held this long before it is told to fade out. */
export const LOOP_HOLD = 0.5;
/** Seconds between two analysis frames. */
export const HOP = 0.01;
/** A sample quieter than this counts as silence (-60 dB of full scale). */
export const SILENCE = 0.001;
/** The ending is checked from this long after the recipe's end (filters ring for a few milliseconds). */
export const SETTLE = 0.02;

/** Samples per spectrum frame (46 ms at RENDER_RATE): long enough to tell notes a semitone apart. */
const FRAME = 2048;
/** Seconds of signal the zero-crossing pitch looks at: two periods of the lowest note (55 Hz). */
const PITCH_WINDOW = 0.04;
/** Upper edges, in hertz, of the bands of `EffectRender.bands`; the last band has no upper edge. */
export const BAND_EDGES: readonly number[] = [88, 177, 354, 707, 1414, 2828, 5657];
/** Points at which `compare` samples two effects. */
const COMPARE_POINTS = 16;
/** Two centroids this many octaves apart count as completely different. */
const COMPARE_OCTAVES = 3;

/** What one render sounded like, in numbers. Plain data: it survives JSON. */
export interface EffectRender {
  /** The effect's name; for several effects rendered together, the names joined with '+'. */
  readonly name: string;
  readonly sampleRate: number;
  /** Seconds the recipe says the effect lasts. For a loop: the time it was held plus its fade-out. */
  readonly recipeLength: number;
  /** Seconds from the effect's start to its last sample louder than SILENCE, measured before the master gain. */
  readonly length: number;
  /** Largest absolute sample at the output, after the master gain and the compressor. 1.0 is clipping. */
  readonly peak: number;
  /** Root mean square of the output over the recipe's length. */
  readonly rms: number;
  /** The same two before the master gain: what the recipe's own gain produced. */
  readonly dryPeak: number;
  readonly dryRms: number;
  /** Largest absolute sample (before the master gain) later than SETTLE after the recipe's end. Below SILENCE for a clean ending. */
  readonly tailPeak: number;
  /** Seconds between two entries of the four lists below; entry k describes the sound k * hop after the effect's start. */
  readonly hop: number;
  /** Loudness (root mean square) around each moment. */
  readonly level: readonly number[];
  /** Pitch in hertz by counting zero crossings: exact for one clean tone, meaningless for noise. 0 where there is none. */
  readonly pitch: readonly number[];
  /** The strongest frequency of the spectrum around each moment, hertz. 0 where the sound is silent. */
  readonly dominant: readonly number[];
  /** The spectrum's centre of gravity around each moment, hertz: "how bright". 0 where the sound is silent. */
  readonly centroid: readonly number[];
  /** Share of the effect's energy in each band of BAND_EDGES (one more entry than edges); the shares add up to 1. */
  readonly bands: readonly number[];
  /**
   * How irregular the waveform is: near 0 for one clean tone (a slide
   * included), 0.3 and more for noise, in between for chords. It is the
   * spread of the time between zero crossings, as a share of their average,
   * weighted by loudness.
   */
  readonly noisiness: number;
}

/** How unlike two effects are, each part from 0 (the same) to 1. */
export interface Comparison {
  /** Difference in length, as a share of the longer one. */
  readonly length: number;
  /** How differently the energy is spread over the bands. */
  readonly bands: number;
  /** How differently loudness rises and falls over time. */
  readonly shape: number;
  /** How differently brightness moves over the effect (up against down, high against low). */
  readonly contour: number;
  /** The largest of the four: one clear difference is enough to tell two effects apart. */
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Rendering (browser only)
// ---------------------------------------------------------------------------

function offlineContext(channels: number, frames: number, rate: number): OfflineAudioContext {
  const scope = globalThis as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Offline = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  if (!Offline) throw new Error('renderEffect needs a browser: there is no OfflineAudioContext here');
  return new Offline(channels, frames, rate);
}

/**
 * Renders the recipes together, all starting at the same moment, and measures
 * the result. A loop among them is held for as long as the longest shot beside
 * it (LOOP_HOLD when it is alone) and then faded out.
 *
 * The render has two channels: the output after the master gain and the
 * compressor, and the same sound before them.
 */
export async function renderRecipes(name: string, recipes: readonly Recipe[]): Promise<EffectRender> {
  let longestShot = 0;
  for (const recipe of recipes) {
    if (recipe.kind === 'shot') longestShot = Math.max(longestShot, effectLength(recipe));
  }
  const hold = longestShot > 0 ? longestShot : LOOP_HOLD;
  let recipeLength = longestShot;
  for (const recipe of recipes) {
    if (recipe.kind === 'loop') recipeLength = Math.max(recipeLength, hold + recipe.fadeOut);
  }

  const frames = Math.ceil((LEAD + recipeLength + TAIL) * RENDER_RATE);
  const ctx = offlineContext(2, frames, RENDER_RATE);
  const bus = ctx.createGain();
  const master = createMaster(ctx);
  const split = ctx.createChannelMerger(2);
  bus.connect(master.input);
  master.output.connect(split, 0, 0);
  bus.connect(split, 0, 1);
  split.connect(ctx.destination);

  const noise = createNoiseBuffer(ctx);
  for (const recipe of recipes) {
    const voices = scheduleEffect(ctx, bus, LEAD, recipe, noise);
    if (recipe.kind === 'loop') {
      for (const voice of voices) voice.stop(LEAD + hold, recipe.fadeOut);
    }
  }

  const rendered = await ctx.startRendering();
  return analyse(name, rendered.getChannelData(0), rendered.getChannelData(1), RENDER_RATE, LEAD, recipeLength);
}

/**
 * Renders one effect by name, or several together (for example
 * `['cog', 'thrust', 'land']`: the loudest moment the game can plausibly
 * produce), and returns what it sounded like in numbers. Rejects with a plain
 * Error for an unknown name or where there is no OfflineAudioContext.
 */
export async function renderEffect(what: EffectName | readonly EffectName[]): Promise<EffectRender> {
  const names: readonly string[] = typeof what === 'string' ? [what] : what;
  const recipes: Recipe[] = [];
  for (const name of names) {
    if (!Object.hasOwn(RECIPES, name)) throw new Error(`renderEffect: there is no effect called "${name}"`);
    recipes.push(RECIPES[name as EffectName]);
  }
  if (recipes.length === 0) throw new Error('renderEffect: no effect was named');
  return renderRecipes(names.join('+'), recipes);
}

// ---------------------------------------------------------------------------
// Measuring (pure)
// ---------------------------------------------------------------------------

/** Largest absolute sample in [from, to). */
export function peakOf(samples: Float32Array, from = 0, to = samples.length): number {
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
    const size = Math.abs(samples[i] ?? 0);
    if (size > peak) peak = size;
  }
  return peak;
}

/** Root mean square of [from, to); samples outside the array count as silence. */
export function rmsOf(samples: Float32Array, from = 0, to = samples.length): number {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / (to - from));
}

/** Index of the last sample louder than `threshold`, or -1. */
export function lastLoud(samples: Float32Array, threshold: number): number {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i] ?? 0) > threshold) return i;
  }
  return -1;
}

/** In-place fast Fourier transform; the length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i] ?? 0;
      const m = im[i] ?? 0;
      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = r;
      im[j] = m;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stepRe = Math.cos((2 * Math.PI) / size);
    const stepIm = -Math.sin((2 * Math.PI) / size);
    for (let start = 0; start < n; start += size) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const bRe = (re[b] ?? 0) * wRe - (im[b] ?? 0) * wIm;
        const bIm = (re[b] ?? 0) * wIm + (im[b] ?? 0) * wRe;
        re[b] = (re[a] ?? 0) - bRe;
        im[b] = (im[a] ?? 0) - bIm;
        re[a] = (re[a] ?? 0) + bRe;
        im[a] = (im[a] ?? 0) + bIm;
        const nextRe = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = nextRe;
      }
    }
  }
}

/**
 * Power spectrum of the FRAME samples centred on `centre` (a Hann window;
 * samples outside the array count as silence). Entry k is the power at
 * k * sampleRate / FRAME hertz.
 */
export function powerSpectrum(samples: Float32Array, centre: number): Float64Array {
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const first = centre - FRAME / 2;
  for (let i = 0; i < FRAME; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
    re[i] = (samples[first + i] ?? 0) * hann;
  }
  fft(re, im);
  const power = new Float64Array(FRAME / 2);
  for (let k = 0; k < FRAME / 2; k++) power[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
  return power;
}

/** The frequency of the strongest line of a power spectrum, refined between bins; 0 for an empty spectrum. */
export function dominantOf(power: Float64Array, sampleRate: number): number {
  let best = 0;
  for (let k = 1; k < power.length; k++) {
    if ((power[k] ?? 0) > (power[best] ?? 0)) best = k;
  }
  const top = power[best] ?? 0;
  if (best === 0 || top <= 0) return 0;
  // A parabola through the logarithms of the peak and its two neighbours finds the true peak between bins.
  const floor = top * 1e-12;
  const left = Math.log(Math.max(power[best - 1] ?? 0, floor));
  const mid = Math.log(top);
  const right = Math.log(Math.max(power[best + 1] ?? 0, floor));
  const bend = left - 2 * mid + right;
  const shift = bend < 0 ? (0.5 * (left - right)) / bend : 0;
  return ((best + Math.max(-0.5, Math.min(0.5, shift))) * sampleRate) / (2 * power.length);
}

/** The centre of gravity of a power spectrum, hertz; 0 for an empty spectrum. */
export function centroidOf(power: Float64Array, sampleRate: number): number {
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < power.length; k++) {
    weighted += k * (power[k] ?? 0);
    total += power[k] ?? 0;
  }
  return total > 0 ? (weighted / total) * (sampleRate / (2 * power.length)) : 0;
}

/** The moments (in samples, between samples where needed) at which [from, to) crosses zero upwards. */
function upwardCrossings(samples: Float32Array, from: number, to: number): number[] {
  const crossings: number[] = [];
  for (let i = Math.max(1, from); i < Math.min(samples.length, to); i++) {
    const before = samples[i - 1] ?? 0;
    const here = samples[i] ?? 0;
    if (before < 0 && here >= 0) crossings.push(i - 1 + before / (before - here));
  }
  return crossings;
}

/**
 * Pitch of [from, to) by its upward zero crossings: the number of whole
 * periods between the first and the last crossing, over the time between
 * them. 0 when there are fewer than two crossings.
 */
export function crossingPitch(samples: Float32Array, sampleRate: number, from: number, to: number): number {
  const crossings = upwardCrossings(samples, from, to);
  const first = crossings[0];
  const last = crossings[crossings.length - 1];
  if (first === undefined || last === undefined || last <= first) return 0;
  return ((crossings.length - 1) * sampleRate) / (last - first);
}

/**
 * How unevenly [from, to) crosses zero: the standard deviation of the time
 * between upward crossings over their mean, at most 1. A steady tone gives 0,
 * a slide a little more, noise 0.3 and above. 0 when there are fewer than
 * three crossings.
 */
export function crossingJitter(samples: Float32Array, from: number, to: number): number {
  const crossings = upwardCrossings(samples, from, to);
  const periods: number[] = [];
  for (let i = 1; i < crossings.length; i++) periods.push((crossings[i] ?? 0) - (crossings[i - 1] ?? 0));
  if (periods.length < 2) return 0;
  const mean = periods.reduce((sum, value) => sum + value, 0) / periods.length;
  const spread = Math.sqrt(periods.reduce((sum, value) => sum + (value - mean) ** 2, 0) / periods.length);
  return mean > 0 ? Math.min(1, spread / mean) : 0;
}

/**
 * Measures one render. `output` is the sound after the master chain, `dry`
 * the same sound before it; the effect starts `start` seconds into both and
 * its recipe says it lasts `recipeLength` seconds.
 */
export function analyse(
  name: string,
  output: Float32Array,
  dry: Float32Array,
  sampleRate: number,
  start: number,
  recipeLength: number,
): EffectRender {
  const first = Math.round(start * sampleRate);
  const end = Math.round((start + recipeLength) * sampleRate);
  const dryPeak = peakOf(dry);

  const level: number[] = [];
  const pitch: number[] = [];
  const dominant: number[] = [];
  const centroid: number[] = [];
  const bandPower = new Array<number>(BAND_EDGES.length + 1).fill(0);
  let jitterSum = 0;
  let jitterWeight = 0;
  const binHz = sampleRate / FRAME;
  const hop = Math.round(HOP * sampleRate);
  const half = Math.round((PITCH_WINDOW * sampleRate) / 2);

  for (let centre = first; centre < end; centre += hop) {
    const loudness = rmsOf(dry, centre - hop, centre + hop);
    level.push(loudness);
    if (loudness <= SILENCE / 10) {
      pitch.push(0);
      dominant.push(0);
      centroid.push(0);
      continue;
    }
    const power = powerSpectrum(dry, centre);
    pitch.push(crossingPitch(dry, sampleRate, centre - half, centre + half));
    dominant.push(dominantOf(power, sampleRate));
    centroid.push(centroidOf(power, sampleRate));
    for (let k = 1; k < power.length; k++) {
      const hz = k * binHz;
      let band = 0;
      while (band < BAND_EDGES.length && hz >= (BAND_EDGES[band] ?? Infinity)) band += 1;
      bandPower[band] = (bandPower[band] ?? 0) + (power[k] ?? 0);
    }
    jitterSum += crossingJitter(dry, centre - half, centre + half) * loudness * loudness;
    jitterWeight += loudness * loudness;
  }

  const allPower = bandPower.reduce((sum, value) => sum + value, 0);
  return {
    name,
    sampleRate,
    recipeLength,
    length: Math.max(0, (lastLoud(dry, SILENCE) + 1) / sampleRate - start),
    peak: peakOf(output),
    rms: rmsOf(output, first, end),
    dryPeak,
    dryRms: rmsOf(dry, first, end),
    tailPeak: peakOf(dry, Math.round((start + recipeLength + SETTLE) * sampleRate)),
    hop: HOP,
    level,
    pitch,
    dominant,
    centroid,
    bands: bandPower.map((value) => (allPower > 0 ? value / allPower : 0)),
    noisiness: jitterWeight > 0 ? jitterSum / jitterWeight : 0,
  };
}

/** Entry of a per-frame list at `seconds`, interpolated; 0 outside the list. */
function sampleAt(list: readonly number[], hop: number, seconds: number): number {
  const position = seconds / hop;
  const index = Math.floor(position);
  if (index < 0 || index >= list.length) return 0;
  const here = list[index] ?? 0;
  const next = list[index + 1] ?? here;
  return here + (next - here) * (position - index);
}

/**
 * How unlike two renders are. Each part is 0 for identical effects and 1 for
 * effects with nothing in common; `total` is the largest part.
 */
export function compare(a: EffectRender, b: EffectRender): Comparison {
  const longer = Math.max(a.length, b.length);
  const length = longer > 0 ? Math.abs(a.length - b.length) / longer : 0;

  let spread = 0;
  for (let i = 0; i < Math.max(a.bands.length, b.bands.length); i++) {
    spread += Math.abs((a.bands[i] ?? 0) - (b.bands[i] ?? 0));
  }
  const bands = spread / 2;

  const loudestA = Math.max(...a.level, 1e-12);
  const loudestB = Math.max(...b.level, 1e-12);
  let shape = 0;
  let contour = 0;
  for (let i = 0; i < COMPARE_POINTS; i++) {
    const share = (i + 0.5) / COMPARE_POINTS;
    // Loudness is compared at the same moments after the start; brightness at the same share of each effect's own length.
    const moment = share * longer;
    shape += Math.abs(sampleAt(a.level, a.hop, moment) / loudestA - sampleAt(b.level, b.hop, moment) / loudestB);
    const brightA = sampleAt(a.centroid, a.hop, share * a.length);
    const brightB = sampleAt(b.centroid, b.hop, share * b.length);
    if (brightA > 0 && brightB > 0) contour += Math.min(1, Math.abs(Math.log2(brightA / brightB)) / COMPARE_OCTAVES);
    else if (brightA > 0 || brightB > 0) contour += 1;
  }
  shape /= COMPARE_POINTS;
  contour /= COMPARE_POINTS;

  return { length, bands, shape, contour, total: Math.max(length, bands, shape, contour) };
}

/** How many frames `pitchEnds` reads at each end: 50 ms, shorter than the shortest note of any fanfare. */
const END_FRAMES = 5;

/**
 * The pitch an effect starts on and the pitch it ends on, hertz, read from
 * one of the per-frame lists (`pitch`, `dominant` or `centroid`): the median
 * of the first and of the last few frames in which there was a value (at most
 * END_FRAMES, and never more than half of them). Both 0 when the list holds
 * none.
 */
export function pitchEnds(list: readonly number[]): { first: number; last: number } {
  const heard = list.filter((value) => value > 0);
  if (heard.length === 0) return { first: 0, last: 0 };
  const count = Math.min(END_FRAMES, Math.max(1, Math.floor(heard.length / 2)));
  const median = (values: number[]): number => {
    const sorted = [...values].sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return { first: median(heard.slice(0, count)), last: median(heard.slice(heard.length - count)) };
}
