/**
 * Recipes to Web Audio nodes. No Phaser, no page, no state of its own: every
 * function works on whatever BaseAudioContext it is handed, so the same code
 * plays in the game's AudioContext and renders in an OfflineAudioContext for
 * the tests (`offline.ts`).
 *
 * One voice is: source (oscillator or noise) -> optional filter -> envelope
 * gain -> cut gain -> destination. The envelope follows the recipe; the cut
 * gain stays at 1 and exists only so that a voice can be faded out early
 * (the voice cap, a pause, the sound switch) without touching its envelope.
 */
import { COMPRESSOR, MASTER_GAIN, NOISE, envelopeOf, voiceLength } from './recipes';
import type { Filter, LoopRecipe, LoopVoice, Recipe, Voice } from './recipes';

/** A source keeps running this long after its envelope has reached silence, so that the last samples are not cut. */
const STOP_PAD = 0.02;

/** One sounding (or scheduled) voice, as the mixer in `Sfx.ts` sees it. Times are the context's `currentTime`. */
export interface ScheduledVoice {
  /** When the voice starts to sound. */
  readonly start: number;
  /** When it is silent again. Infinity for a loop voice that has not been stopped. */
  readonly end: number;
  /**
   * Fades the voice out, from `at`, over `fade` seconds (0 cuts at once), and
   * stops its source. `at` may lie in the future (the mixer makes room for a
   * voice that is due later). Does nothing if the voice is over by `at`, or is
   * already stopping by then; an earlier stop replaces a later one, so a voice
   * set to stop in a moment can still be cut now (a pause, the page hidden).
   */
  stop(at: number, fade: number): void;
}

/**
 * White noise between -1 and 1 from a seeded generator (mulberry32): the same
 * seed always gives the same samples, so every render of a recipe is the same.
 */
export function noiseSamples(length: number, seed: number): Float32Array {
  const samples = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    samples[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return samples;
}

/**
 * The one buffer of white noise that every noise voice reads. Build it once
 * per context and hand it to `scheduleEffect`. Its sample rate is fixed
 * (NOISE.rate) whatever the context's is, so a noise voice has the same
 * waveform, and the same peak, on every device.
 */
export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, NOISE.rate * NOISE.seconds, NOISE.rate);
  buffer.getChannelData(0).set(noiseSamples(buffer.length, NOISE.seed));
  return buffer;
}

/**
 * The end of the chain: master gain, then the compressor. Voices connect to
 * `input`; the caller connects `output` to the context's destination. Where
 * the browser has no compressor the master gain is the output.
 */
export function createMaster(ctx: BaseAudioContext): { input: GainNode; output: AudioNode } {
  const input = ctx.createGain();
  input.gain.value = MASTER_GAIN;
  try {
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = COMPRESSOR.threshold;
    squeeze.knee.value = COMPRESSOR.knee;
    squeeze.ratio.value = COMPRESSOR.ratio;
    squeeze.attack.value = COMPRESSOR.attack;
    squeeze.release.value = COMPRESSOR.release;
    input.connect(squeeze);
    return { input, output: squeeze };
  } catch {
    return { input, output: input };
  }
}

function buildFilter(ctx: BaseAudioContext, spec: Filter, start: number, end: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q;
  filter.frequency.setValueAtTime(spec.freq, start);
  if (spec.to !== undefined && Number.isFinite(end)) filter.frequency.exponentialRampToValueAtTime(spec.to, end);
  return filter;
}

/** Wires source -> filter? -> envelope -> cut -> destination and returns the handle the mixer keeps. */
function wire(
  ctx: BaseAudioContext,
  destination: AudioNode,
  source: AudioScheduledSourceNode,
  filter: BiquadFilterNode | null,
  envelope: GainNode,
  start: number,
  naturalEnd: number,
): ScheduledVoice {
  const cut = ctx.createGain();
  if (filter) {
    source.connect(filter);
    filter.connect(envelope);
  } else {
    source.connect(envelope);
  }
  envelope.connect(cut);
  cut.connect(destination);

  // Free the nodes when the source has finished, whichever way it ended.
  source.onended = (): void => {
    source.disconnect();
    filter?.disconnect();
    envelope.disconnect();
    cut.disconnect();
  };
  if (Number.isFinite(naturalEnd)) source.stop(naturalEnd + STOP_PAD);

  let end = naturalEnd;
  /** When the fade of the last stop begins; Infinity while the voice has not been stopped. */
  let stopAt = Infinity;
  return {
    start,
    get end(): number {
      return end;
    },
    stop(at: number, fade: number): void {
      if (at >= end || at >= stopAt) return;
      stopAt = at;
      const span = Math.max(0, fade);
      cut.gain.cancelScheduledValues(at); // a later stop's fade, if any: this one comes first
      if (span > 0) {
        cut.gain.setValueAtTime(1, at);
        cut.gain.linearRampToValueAtTime(0, at + span);
      } else {
        cut.gain.setValueAtTime(0, at);
      }
      end = Math.min(naturalEnd, at + span);
      try {
        source.stop(end + STOP_PAD); // a second stop() replaces the first; where a browser refuses it, the cut above has silenced the voice
      } catch {
        // nothing to do
      }
    },
  };
}

function shotVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  gain: number,
  voice: Voice,
  noise: AudioBuffer | null,
): ScheduledVoice {
  const start = at + voice.at;
  const end = start + voiceLength(voice);

  let source: AudioScheduledSourceNode;
  let amplitude = gain;
  if (voice.kind === 'tone') {
    const oscillator = ctx.createOscillator();
    oscillator.type = voice.wave;
    let t = start;
    for (const each of voice.notes) {
      oscillator.frequency.setValueAtTime(each.freq, t);
      if (each.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(each.to, t + each.dur);
      t += each.dur;
    }
    oscillator.start(start);
    source = oscillator;
  } else {
    const player = ctx.createBufferSource();
    player.buffer = noise;
    player.loop = true; // so that a voice may start anywhere in the buffer and run past its end
    player.start(start, voice.offset);
    source = player;
    amplitude *= voice.makeup;
  }

  const envelope = ctx.createGain();
  envelope.gain.value = 0;
  let first = true;
  for (const corner of envelopeOf(voice)) {
    if (first) envelope.gain.setValueAtTime(amplitude * corner.v, at + corner.t);
    else envelope.gain.linearRampToValueAtTime(amplitude * corner.v, at + corner.t);
    first = false;
  }

  const filter = voice.filter ? buildFilter(ctx, voice.filter, start, end) : null;
  return wire(ctx, destination, source, filter, envelope, start, end);
}

function loopVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  recipe: LoopRecipe,
  voice: LoopVoice,
  noise: AudioBuffer | null,
): ScheduledVoice {
  let source: AudioScheduledSourceNode;
  let filter: BiquadFilterNode | null = null;
  let amplitude = recipe.gain * voice.level;
  if (voice.kind === 'tone') {
    const oscillator = ctx.createOscillator();
    oscillator.type = voice.wave;
    oscillator.frequency.value = voice.freq;
    oscillator.start(at);
    source = oscillator;
  } else {
    const player = ctx.createBufferSource();
    player.buffer = noise;
    player.loop = true;
    player.start(at, voice.offset);
    source = player;
    filter = buildFilter(ctx, voice.filter, at, Infinity);
    amplitude *= voice.makeup;
  }

  const envelope = ctx.createGain();
  envelope.gain.value = 0;
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(amplitude, at + recipe.fadeIn);
  return wire(ctx, destination, source, filter, envelope, at, Infinity);
}

/**
 * Schedules one effect on `ctx`, into `destination`, starting at context time
 * `at`. Returns one handle per voice.
 *
 * A shot recipe plays to its end by itself. A loop recipe fades in and then
 * sounds until each returned voice is stopped with `stop(time, recipe.fadeOut)`.
 *
 * `noise` is the buffer from `createNoiseBuffer(ctx)`. Without it a recipe
 * that has a noise voice builds its own buffer for this one call, which is
 * correct but wasteful: the game builds one at start-up and passes it in.
 */
export function scheduleEffect(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
  recipe: Recipe,
  noise?: AudioBuffer,
): ScheduledVoice[] {
  const hasNoise = recipe.voices.some((voice) => voice.kind === 'noise');
  const buffer = hasNoise ? (noise ?? createNoiseBuffer(ctx)) : null;
  if (recipe.kind === 'loop') {
    return recipe.voices.map((voice) => loopVoice(ctx, destination, at, recipe, voice, buffer));
  }
  return recipe.voices.map((voice) => shotVoice(ctx, destination, at, recipe.gain, voice, buffer));
}
