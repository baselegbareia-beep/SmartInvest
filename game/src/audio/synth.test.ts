import { beforeEach, describe, expect, it } from 'vitest';

import {
  COMPRESSOR,
  EFFECT_NAMES,
  MASTER_GAIN,
  NOISE,
  RECIPES,
  THRUST_LOOP,
  effectLength,
  envelopeOf,
  nominalPeak,
} from './recipes';
import type { ShotRecipe } from './recipes';
import { createMaster, createNoiseBuffer, noiseSamples, scheduleEffect } from './synth';
import { FakeAudioContext, FakeBufferSource, FakeOscillator } from './testkit';
import type { FakeGain, FakeNode } from './testkit';

/**
 * What `scheduleEffect` asks of a context, checked on a stand-in that records
 * it (Node has no Web Audio). What it sounds like is checked in a browser.
 */

const asContext = (fake: FakeAudioContext): BaseAudioContext => fake as unknown as BaseAudioContext;
const asNode = (fake: FakeNode): AudioNode => fake as unknown as AudioNode;

function shot(name: (typeof EFFECT_NAMES)[number]): ShotRecipe {
  const recipe = RECIPES[name];
  if (recipe.kind !== 'shot') throw new Error(`${name} is not a shot`);
  return recipe;
}

/** A fresh context with a bus wired to its output, and a noise buffer. */
function rig(): { fake: FakeAudioContext; bus: FakeGain; noise: AudioBuffer } {
  const fake = new FakeAudioContext();
  const bus = fake.createGain();
  bus.connect(fake.destination);
  return { fake, bus, noise: createNoiseBuffer(asContext(fake)) };
}

beforeEach(() => {
  FakeAudioContext.reset();
});

describe('noise', () => {
  it('is the same for the same seed and different for another', () => {
    const a = noiseSamples(4096, NOISE.seed);
    expect([...noiseSamples(4096, NOISE.seed)]).toEqual([...a]);
    expect([...noiseSamples(4096, NOISE.seed + 1)]).not.toEqual([...a]);
  });

  it('is white: between -1 and 1, centred on 0, with the loudness of evenly spread values', () => {
    const samples = noiseSamples(NOISE.rate * NOISE.seconds, NOISE.seed);
    let sum = 0;
    let squares = 0;
    let low = Infinity;
    let high = -Infinity;
    for (const value of samples) {
      sum += value;
      squares += value * value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeGreaterThanOrEqual(-1);
    expect(high).toBeLessThan(1);
    expect(low).toBeLessThan(-0.99);
    expect(high).toBeGreaterThan(0.99);
    expect(Math.abs(sum / samples.length)).toBeLessThan(0.01);
    expect(Math.sqrt(squares / samples.length)).toBeCloseTo(1 / Math.sqrt(3), 2);
  });

  it('fills one buffer of one second at the fixed noise rate, whatever the context’s rate', () => {
    const fake = new FakeAudioContext();
    fake.sampleRate = 48000;
    const buffer = createNoiseBuffer(asContext(fake));
    expect(buffer.length).toBe(44100);
    expect(buffer.sampleRate).toBe(44100);
    expect([...buffer.getChannelData(0).slice(0, 64)]).toEqual([...noiseSamples(64, NOISE.seed)]);
  });
});

describe('the master chain', () => {
  it('is a gain of 0.6 into a compressor with the recipe’s settings', () => {
    const fake = new FakeAudioContext();
    const master = createMaster(asContext(fake));
    expect(master.input.gain.value).toBe(MASTER_GAIN);
    const squeeze = fake.compressors[0];
    expect(squeeze).toBeDefined();
    expect(master.output).toBe(squeeze);
    expect((master.input as unknown as FakeNode).outputs).toEqual([squeeze]);
    expect(squeeze?.threshold.value).toBe(COMPRESSOR.threshold);
    expect(squeeze?.knee.value).toBe(COMPRESSOR.knee);
    expect(squeeze?.ratio.value).toBe(COMPRESSOR.ratio);
    expect(squeeze?.attack.value).toBe(COMPRESSOR.attack);
    expect(squeeze?.release.value).toBe(COMPRESSOR.release);
  });

  it('falls back to the bare gain where the browser has no compressor', () => {
    const fake = new FakeAudioContext();
    fake.createDynamicsCompressor = () => {
      throw new Error('not supported');
    };
    const master = createMaster(asContext(fake));
    expect(master.output).toBe(master.input);
    expect(master.input.gain.value).toBe(MASTER_GAIN);
  });
});

describe('scheduleEffect: shots', () => {
  it('creates one source per voice, wired through to the destination, for every effect', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      const { fake, bus, noise } = rig();
      const voices = scheduleEffect(asContext(fake), asNode(bus), 1, recipe, noise);
      expect(voices.length, name).toBe(recipe.voices.length);
      expect(fake.sources.length, name).toBe(recipe.voices.length);
      recipe.voices.forEach((voice, i) => {
        expect(fake.sources[i] instanceof (voice.kind === 'tone' ? FakeOscillator : FakeBufferSource), name).toBe(true);
      });
    }
  });

  it('starts and stops every voice when its recipe says, and is silent at the end', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      if (recipe.kind !== 'shot') continue;
      const { fake, bus, noise } = rig();
      const at = 2;
      const voices = scheduleEffect(asContext(fake), asNode(bus), at, recipe, noise);
      const length = effectLength(recipe);
      expect(Math.min(...voices.map((voice) => voice.start)), name).toBeCloseTo(at, 9);
      expect(Math.max(...voices.map((voice) => voice.end)), name).toBeCloseTo(at + length, 9);
      // Nothing before the start; something in the middle; nothing at the end or after it.
      expect(fake.audibleAt(at - 0.001).length, name).toBe(0);
      expect(fake.audibleAt(at + 0.004).length, name).toBeGreaterThan(0);
      expect(fake.audibleAt(at + length).length, name).toBe(0);
      expect(fake.audibleAt(at + length + 0.5).length, name).toBe(0);
      // Every source is told to stop, a little after its envelope has reached silence.
      for (const source of fake.sources) {
        expect(source.stopTime, name).not.toBeNull();
        expect(source.stopTime ?? 0, name).toBeGreaterThan(source.startTime ?? 0);
        expect(source.stopTime ?? 0, name).toBeLessThanOrEqual(at + length + 0.05);
      }
    }
  });

  it('schedules exactly the envelope of the recipe, scaled by the gain (and the noise makeup)', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      if (recipe.kind !== 'shot') continue;
      const { fake, bus, noise } = rig();
      const at = 0.5;
      scheduleEffect(asContext(fake), asNode(bus), at, recipe, noise);
      recipe.voices.forEach((voice, i) => {
        const envelope = fake.sources[i]?.outputs.at(-1) === undefined ? undefined : envelopeGain(fake, i);
        expect(envelope, name).toBeDefined();
        const scale = recipe.gain * (voice.kind === 'noise' ? voice.makeup : 1);
        for (const corner of envelopeOf(voice)) {
          expect(envelope?.gain.valueAt(at + corner.t), `${name} at ${corner.t}`).toBeCloseTo(scale * corner.v, 9);
        }
        expect(envelope?.gain.peak, name).toBeLessThanOrEqual(scale * voice.level + 1e-12);
      });
    }
  });

  it('never asks for more than the recipe’s gain in total (noise makeup aside)', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      if (recipe.kind !== 'shot') continue;
      const { fake, bus, noise } = rig();
      scheduleEffect(asContext(fake), asNode(bus), 0, recipe, noise);
      const length = effectLength(recipe);
      let loudest = 0;
      for (let t = 0; t <= length; t += 0.0005) {
        let sum = 0;
        recipe.voices.forEach((voice, i) => {
          sum += (envelopeGain(fake, i)?.gain.valueAt(t) ?? 0) / (voice.kind === 'noise' ? voice.makeup : 1);
        });
        loudest = Math.max(loudest, sum);
      }
      expect(loudest, name).toBeLessThanOrEqual(recipe.gain + 1e-9);
      expect(loudest, name).toBeGreaterThan(nominalPeak(recipe) * 0.9);
    }
  });

  it('plays the notes of a run at their times and slides where the recipe slides', () => {
    const { fake, bus } = rig();
    scheduleEffect(asContext(fake), asNode(bus), 1, shot('cog'));
    const square = fake.sources[0];
    if (!(square instanceof FakeOscillator)) throw new Error('no oscillator');
    expect(square.type).toBe('square');
    expect((fake.sources[1] as FakeOscillator).type).toBe('triangle');
    // D5, F#5 and A5 for 80 ms each, then D6: read just after and just before every change.
    expect(square.frequency.valueAt(1)).toBe(587);
    expect(square.frequency.valueAt(1.079)).toBe(587);
    expect(square.frequency.valueAt(1.081)).toBe(740);
    expect(square.frequency.valueAt(1.159)).toBe(740);
    expect(square.frequency.valueAt(1.161)).toBe(880);
    expect(square.frequency.valueAt(1.239)).toBe(880);
    expect(square.frequency.valueAt(1.241)).toBe(1175);
    expect(square.frequency.valueAt(1.55)).toBe(1175);

    const zap = rig();
    scheduleEffect(asContext(zap.fake), asNode(zap.bus), 0, shot('bolt'));
    const falling = zap.fake.sources[0] as FakeOscillator;
    expect(falling.frequency.valueAt(0)).toBe(1320);
    expect(falling.frequency.valueAt(0.055)).toBeCloseTo(660, 6); // half-way through an exponential slide of two octaves
    expect(falling.frequency.valueAt(0.11)).toBeCloseTo(330, 9);

    const hop = rig();
    scheduleEffect(asContext(hop.fake), asNode(hop.bus), 0, shot('jump'));
    const rising = hop.fake.sources[0] as FakeOscillator;
    expect(rising.frequency.valueAt(0)).toBe(196);
    expect(rising.frequency.valueAt(0.09)).toBeCloseTo(392, 9);
    expect(rising.frequency.valueAt(0.105)).toBe(392);
  });

  it('reads the shared noise buffer, looped, from the voice’s own offset, through the recipe’s filter', () => {
    const { fake, bus, noise } = rig();
    scheduleEffect(asContext(fake), asNode(bus), 3, shot('enemyDown'), noise);
    const crunch = fake.sources[0];
    if (!(crunch instanceof FakeBufferSource)) throw new Error('no buffer source');
    expect(crunch.buffer).toBe(noise);
    expect(crunch.loop).toBe(true);
    expect(crunch.offset).toBe(0.2);
    expect(crunch.startTime).toBe(3);
    const filter = fake.filters[0];
    expect(filter?.type).toBe('lowpass');
    expect(filter?.frequency.valueAt(3)).toBe(2000);
    expect(filter?.frequency.valueAt(3.2)).toBeCloseTo(200, 9);
    expect(crunch.outputs).toEqual([filter]);
  });

  it('builds its own noise buffer when none is handed in, and none at all for a recipe without noise', () => {
    const tone = rig();
    const before = tone.fake.buffers.length;
    scheduleEffect(asContext(tone.fake), asNode(tone.bus), 0, shot('gem'));
    expect(tone.fake.buffers.length).toBe(before);
    scheduleEffect(asContext(tone.fake), asNode(tone.bus), 0, shot('land'));
    expect(tone.fake.buffers.length).toBe(before + 1);
  });

  it('keeps no state between calls or contexts', () => {
    const a = rig();
    const b = rig();
    scheduleEffect(asContext(a.fake), asNode(a.bus), 0, shot('death'), a.noise);
    expect(b.fake.sources.length).toBe(0);
    scheduleEffect(asContext(b.fake), asNode(b.bus), 0, shot('death'), b.noise);
    scheduleEffect(asContext(b.fake), asNode(b.bus), 0, shot('death'), b.noise);
    expect(a.fake.sources.length).toBe(2);
    expect(b.fake.sources.length).toBe(4);
    expect((b.fake.sources[1] as FakeBufferSource).buffer).toBe(b.noise);
    expect((a.fake.sources[1] as FakeBufferSource).buffer).toBe(a.noise);
  });

  it('frees its nodes when the source has ended', () => {
    const { fake, bus } = rig();
    scheduleEffect(asContext(fake), asNode(bus), 0, shot('gem'));
    const source = fake.sources[0];
    expect(source?.outputs.length).toBe(1);
    fake.advance(1);
    expect(source?.ended).toBe(true);
    expect(source?.outputs.length).toBe(0);
    expect(fake.audibleAt(0.01).length).toBe(0); // unplugged: nothing of it can reach the output any more
  });
});

describe('scheduleEffect: stopping a voice early', () => {
  it('fades it out over the given time and stops its source', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gameOver'));
    if (!voice) throw new Error('no voice');
    expect(voice.end).toBeCloseTo(1.04, 9);
    voice.stop(0.2, 0.012);
    expect(voice.end).toBeCloseTo(0.212, 9);
    expect(fake.audibleAt(0.19).length).toBe(1);
    expect(fake.audibleAt(0.206).length).toBe(1); // half-way down the fade
    expect(fake.audibleAt(0.212).length).toBe(0);
    expect(fake.audibleAt(0.5).length).toBe(0);
    expect(fake.sources[0]?.stopTime).toBeLessThan(0.3);
    expect(fake.sources[0]?.stopCalls).toBe(2);
  });

  it('cuts at once with a fade of 0', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gameOver'));
    voice?.stop(0.2, 0);
    expect(fake.audibleAt(0.1999).length).toBe(1);
    expect(fake.audibleAt(0.2).length).toBe(0);
    expect(voice?.end).toBeCloseTo(0.2, 9);
  });

  it('ignores a stop after the voice has ended, and a stop later than one already set', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gem'));
    voice?.stop(1, 0.01); // long after its 90 ms
    expect(voice?.end).toBeCloseTo(0.09, 9);
    expect(fake.sources[0]?.stopCalls).toBe(1);
    voice?.stop(0.03, 0.01);
    voice?.stop(0.035, 0.01); // already fading by then
    voice?.stop(0.05, 0);
    expect(voice?.end).toBeCloseTo(0.04, 9);
    expect(fake.sources[0]?.stopCalls).toBe(2);
  });

  it('lets an earlier stop replace a later one: a voice set to stop in a moment can be cut now', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gameOver'));
    voice?.stop(0.6, 0.012); // the mixer makes room for a voice due at 0.6 s
    expect(voice?.end).toBeCloseTo(0.612, 9);
    expect(fake.audibleAt(0.59).length).toBe(1);
    voice?.stop(0.2, 0); // then the game pauses at 0.2 s
    expect(voice?.end).toBeCloseTo(0.2, 9);
    expect(fake.audibleAt(0.1999).length).toBe(1);
    // Silent from 0.2 s on: the later fade (which would set the gain back to 1 at 0.6 s) is gone.
    for (const t of [0.2, 0.3, 0.6, 0.605, 0.7]) expect(fake.audibleAt(t).length, `${t} s`).toBe(0);
    expect(fake.sources[0]?.stopTime).toBeLessThan(0.3);
    // A stop with a long fade that would end after the old one still ends when its own fade does.
    const [other] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gameOver'));
    other?.stop(0.5, 0.012);
    other?.stop(0.49, 0.03);
    expect(other?.end).toBeCloseTo(0.52, 9);
    expect(fake.audibleAt(0.51).length).toBe(1);
    expect(fake.audibleAt(0.52).length).toBe(0);
  });

  it('silences a voice that has not started yet', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0.32, shot('airlock'));
    voice?.stop(0.1, 0.012);
    expect(fake.audibleAt(0.33).length).toBe(1); // the second voice of the effect is untouched
    for (const other of scheduleEffect(asContext(fake), asNode(bus), 5, shot('airlock'))) other.stop(4, 0);
    expect(fake.audibleAt(5.01).length).toBe(0);
  });

  it('survives a browser that allows stop() only once', () => {
    const { fake, bus } = rig();
    const [voice] = scheduleEffect(asContext(fake), asNode(bus), 0, shot('gameOver'));
    const source = fake.sources[0];
    if (!source) throw new Error('no source');
    source.stop = () => {
      throw new Error('InvalidStateError');
    };
    expect(() => voice?.stop(0.2, 0.012)).not.toThrow();
    expect(fake.audibleAt(0.3).length).toBe(0); // the cut gain silenced it all the same
  });
});

describe('scheduleEffect: the loop', () => {
  it('fades in over 30 ms, then sounds until it is stopped, then fades out over 80 ms', () => {
    const { fake, bus, noise } = rig();
    const voices = scheduleEffect(asContext(fake), asNode(bus), 1, THRUST_LOOP, noise);
    expect(voices).toHaveLength(2);
    expect(voices.every((voice) => voice.end === Infinity)).toBe(true);
    expect(fake.sources.every((source) => source.stopTime === null)).toBe(true);
    expect(fake.audibleAt(0.99).length).toBe(0);
    expect(fake.audibleAt(1.01).length).toBe(2);
    expect(fake.audibleAt(100).length).toBe(2);

    // The hum reaches 0.05 after the fade-in and holds it.
    const hum = envelopeGain(fake, 1);
    expect(hum?.gain.valueAt(1.015)).toBeCloseTo(0.025, 9);
    expect(hum?.gain.valueAt(1.03)).toBeCloseTo(0.05, 9);
    expect(hum?.gain.valueAt(50)).toBeCloseTo(0.05, 9);

    for (const voice of voices) voice.stop(7, THRUST_LOOP.fadeOut);
    expect(voices.every((voice) => Math.abs(voice.end - 7.08) < 1e-9)).toBe(true);
    expect(fake.audibleAt(7.04).length).toBe(2);
    expect(fake.audibleAt(7.08).length).toBe(0);
    expect(fake.sources.every((source) => source.stopTime !== null && source.stopTime < 7.2)).toBe(true);
  });

  it('is band-passed noise from the shared buffer plus a 55 Hz sawtooth', () => {
    const { fake, bus, noise } = rig();
    scheduleEffect(asContext(fake), asNode(bus), 0, THRUST_LOOP, noise);
    const roar = fake.sources[0];
    const hum = fake.sources[1];
    if (!(roar instanceof FakeBufferSource) || !(hum instanceof FakeOscillator)) throw new Error('wrong sources');
    expect(roar.buffer).toBe(noise);
    expect(roar.loop).toBe(true);
    expect(fake.filters[0]?.type).toBe('bandpass');
    expect(fake.filters[0]?.frequency.valueAt(0)).toBe(320);
    expect(fake.filters[0]?.Q.value).toBe(0.7);
    expect(hum.type).toBe('sawtooth');
    expect(hum.frequency.value).toBe(55);
  });
});

/** The envelope gain of the i-th source: the last gain but one on its way out (the last one is the cut). */
function envelopeGain(fake: FakeAudioContext, index: number): FakeGain | undefined {
  let node: FakeNode | undefined = fake.sources[index];
  const chain: FakeNode[] = [];
  while (node && node.outputs.length > 0) {
    node = node.outputs[0];
    if (node) chain.push(node);
  }
  // chain: [filter?, envelope, cut, bus, destination]
  const envelope = chain[chain.length - 4];
  return envelope && 'gain' in envelope ? (envelope as FakeGain) : undefined;
}
