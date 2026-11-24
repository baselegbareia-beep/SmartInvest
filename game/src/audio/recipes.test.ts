import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SUB, TICK_HZ } from '../core/types';
import type { GameEvent, GameEventType, GameState } from '../core/types';

import {
  AIRLOCK_DELAY,
  ATTACK,
  EFFECT_NAMES,
  EVENT_SOUND,
  FLAT,
  FUEL_LOW_BEEP_TICKS,
  FUEL_LOW_PERCENT,
  GEM_LADDER,
  GEM_RECIPES,
  LAND_MIN_SPEED,
  MASTER_GAIN,
  MAX_VOICES,
  MUTE_RAMP,
  NOISE,
  RECIPES,
  THRUST_LOOP,
  climbGemLadder,
  cuesForEvent,
  effectLength,
  envelopeOf,
  levelAt,
  nominalPeak,
  thrustState,
  ticksToSeconds,
  voiceLength,
} from './recipes';
import type { Cue, EffectName, Filter, Recipe, ThrustSound, ThrustView } from './recipes';

/**
 * docs/ART-AND-SOUND.md, section 12, copied by hand: gain, length in
 * milliseconds and every frequency the guide names for the effect's tones.
 * The tests compare the recipes with the guide, not with themselves.
 */
const GUIDE: Readonly<Record<EffectName, { gain: number; ms: number | 'loop'; hz: readonly number[] }>> = {
  jump: { gain: 0.16, ms: 110, hz: [196, 392] },
  land: { gain: 0.1, ms: 50, hz: [] },
  gem: { gain: 0.12, ms: 90, hz: [587] },
  item: { gain: 0.14, ms: 240, hz: [220, 880] },
  cog: { gain: 0.18, ms: 560, hz: [587, 740, 880, 1175] },
  airlock: { gain: 0.12, ms: 450, hz: [110, 73] },
  clear: { gain: 0.16, ms: 580, hz: [587, 659, 740, 880, 1175] },
  bolt: { gain: 0.12, ms: 110, hz: [1320, 330] },
  boltHit: { gain: 0.08, ms: 35, hz: [] },
  enemyDown: { gain: 0.2, ms: 200, hz: [147, 55] },
  thrust: { gain: 0.1, ms: 'loop', hz: [55] },
  fuelLow: { gain: 0.08, ms: 35, hz: [880] },
  fuelEmpty: { gain: 0.14, ms: 220, hz: [440, 110] },
  death: { gain: 0.22, ms: 420, hz: [440, 55] },
  gameOver: { gain: 0.18, ms: 1040, hz: [294, 262, 220, 147] },
  win: { gain: 0.18, ms: 1300, hz: [294, 440, 587, 740, 880, 1175] },
  uiMove: { gain: 0.08, ms: 25, hz: [660] },
  uiOk: { gain: 0.08, ms: 60, hz: [660, 990] },
  start: { gain: 0.14, ms: 2000, hz: [294, 440, 349, 523, 494, 392, 587, 147, 196] },
};

/** The guide's noise filters: type, frequency (and where it slides to), Q where the guide gives one. */
const GUIDE_NOISE: Readonly<Partial<Record<EffectName, Partial<Filter>>>> = {
  land: { type: 'lowpass', freq: 500 },
  airlock: { type: 'highpass', freq: 1800 },
  boltHit: { type: 'bandpass', freq: 3000, q: 2 },
  enemyDown: { type: 'lowpass', freq: 2000, to: 200 },
  thrust: { type: 'bandpass', freq: 320, q: 0.7 },
  death: { type: 'lowpass', freq: 800 },
};

const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);

/** Every frequency a recipe's tone voices play or slide to. */
function toneFrequencies(recipe: Recipe): number[] {
  const all: number[] = [];
  for (const voice of recipe.voices) {
    if (voice.kind !== 'tone') continue;
    if ('freq' in voice) {
      all.push(voice.freq);
      continue;
    }
    for (const each of voice.notes) {
      all.push(each.freq);
      if (each.to !== undefined) all.push(each.to);
    }
  }
  return sorted(all);
}

describe('recipes: the guide table as data', () => {
  it('has exactly the guide’s nineteen effects', () => {
    expect([...EFFECT_NAMES].sort()).toEqual(Object.keys(GUIDE).sort());
    expect(Object.keys(RECIPES).sort()).toEqual(Object.keys(GUIDE).sort());
    expect(new Set(EFFECT_NAMES).size).toBe(EFFECT_NAMES.length);
  });

  it('gives every effect one to three voices', () => {
    for (const name of EFFECT_NAMES) {
      const count = RECIPES[name].voices.length;
      expect(count, name).toBeGreaterThanOrEqual(1);
      expect(count, name).toBeLessThanOrEqual(3);
    }
  });

  it('gives every effect the guide’s gain, and no moment of it is louder', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      expect(recipe.gain, name).toBe(GUIDE[name].gain);
      // The levels of voices that sound together add up to the whole gain at the loudest moment, never to more.
      expect(nominalPeak(recipe), name).toBeLessThanOrEqual(GUIDE[name].gain + 1e-9);
      expect(nominalPeak(recipe), name).toBeGreaterThanOrEqual(GUIDE[name].gain * 0.99);
    }
  });

  it('keeps every gain small enough that six voices cannot reach full scale', () => {
    const loudest = Math.max(...EFFECT_NAMES.map((name) => RECIPES[name].gain));
    expect(loudest).toBeLessThanOrEqual(0.22);
    expect(loudest * MAX_VOICES * MASTER_GAIN).toBeLessThan(1);
  });

  it('makes every effect as long as the guide says', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      const wanted = GUIDE[name].ms;
      if (recipe.kind === 'loop') {
        expect(wanted, name).toBe('loop');
        continue;
      }
      expect(wanted, name).not.toBe('loop');
      expect(effectLength(recipe) * 1000, name).toBeCloseTo(Number(wanted), 6);
    }
  });

  it('gives every voice and note a finite, positive length, level and frequency', () => {
    const positive = (value: number, what: string): void => {
      expect(Number.isFinite(value), what).toBe(true);
      expect(value, what).toBeGreaterThan(0);
    };
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      positive(recipe.gain, `${name} gain`);
      for (const voice of recipe.voices) {
        positive(voice.level, `${name} level`);
        expect(voice.level, `${name} level`).toBeLessThanOrEqual(1);
        if (voice.kind === 'noise') positive(voice.makeup, `${name} makeup`);
        if ('at' in voice) {
          expect(voice.at, `${name} at`).toBeGreaterThanOrEqual(0);
          positive(voiceLength(voice), `${name} voice length`);
          if (voice.kind === 'tone') {
            for (const each of voice.notes) {
              positive(each.dur, `${name} note length`);
              positive(each.freq, `${name} note frequency`);
              if (each.to !== undefined) positive(each.to, `${name} slide target`);
              if (each.level !== undefined) {
                positive(each.level, `${name} note level`);
                expect(each.level, `${name} note level`).toBeLessThanOrEqual(1);
              }
            }
          }
        }
      }
      if (recipe.kind === 'loop') {
        positive(recipe.fadeIn, `${name} fade in`);
        positive(recipe.fadeOut, `${name} fade out`);
      }
    }
  });

  it('plays the frequencies the guide names, and no others', () => {
    for (const name of EFFECT_NAMES) {
      expect(toneFrequencies(RECIPES[name]), name).toEqual(sorted(GUIDE[name].hz));
    }
  });

  it('filters every noise voice the way the guide says', () => {
    for (const name of EFFECT_NAMES) {
      const noise = RECIPES[name].voices.filter((voice) => voice.kind === 'noise');
      const wanted = GUIDE_NOISE[name];
      expect(noise.length, name).toBe(wanted ? 1 : 0);
      for (const voice of noise) {
        expect(voice.filter, name).toMatchObject(wanted ?? {});
        // Where the guide gives no Q the filter is flat.
        if (wanted?.q === undefined) expect(voice.filter.q, name).toBe(FLAT);
        expect(voice.offset, name).toBeGreaterThanOrEqual(0);
        expect(voice.offset, name).toBeLessThan(NOISE.seconds);
      }
    }
    // The item's sweep is the only filtered tone: a 2 kHz low-pass.
    const sweep = RECIPES.item.voices[0];
    expect(sweep?.kind === 'tone' && 'filter' in sweep ? sweep.filter : null).toMatchObject({ type: 'lowpass', freq: 2000 });
  });

  it('builds the thrust loop as the guide says: fades of 30 and 80 ms, the hum at 0.05', () => {
    expect(RECIPES.thrust).toBe(THRUST_LOOP);
    expect(THRUST_LOOP.fadeIn).toBe(0.03);
    expect(THRUST_LOOP.fadeOut).toBe(0.08);
    const hum = THRUST_LOOP.voices.find((voice) => voice.kind === 'tone');
    expect(hum).toMatchObject({ wave: 'sawtooth', freq: 55 });
    expect(THRUST_LOOP.gain * (hum?.level ?? 0)).toBeCloseTo(0.05, 9);
  });

  it('keeps the mixer constants of the guide', () => {
    expect(MASTER_GAIN).toBe(0.6);
    expect(MAX_VOICES).toBe(6);
    expect(MUTE_RAMP).toBe(0.03);
    expect(ATTACK).toBe(0.005);
    expect(NOISE.seconds).toBe(1);
  });
});

describe('recipes: envelopes', () => {
  it('start and end every voice in silence and never go negative or back in time', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      if (recipe.kind !== 'shot') continue;
      for (const voice of recipe.voices) {
        const points = envelopeOf(voice);
        expect(points[0], name).toEqual({ t: voice.at, v: 0 });
        const last = points[points.length - 1];
        expect(last?.v, name).toBe(0);
        expect(last?.t, name).toBeCloseTo(voice.at + voiceLength(voice), 9);
        for (let i = 1; i < points.length; i++) {
          expect(points[i]?.t ?? 0, name).toBeGreaterThanOrEqual(points[i - 1]?.t ?? 0);
          expect(points[i]?.v ?? 0, name).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('reach the level after the 5 ms attack unless the voice says otherwise', () => {
    const jump = RECIPES.jump.kind === 'shot' ? RECIPES.jump.voices[0] : undefined;
    if (!jump) throw new Error('no jump voice');
    const points = envelopeOf(jump);
    expect(points[1]).toEqual({ t: 0.005, v: 1 });
    expect(levelAt(points, 0.0025)).toBeCloseTo(0.5, 9);
    // The jump is one slide: it fades over its whole length and is silent at 110 ms.
    expect(points).toHaveLength(3);
    expect(levelAt(points, 0.11)).toBe(0);
    expect(levelAt(points, 0.2)).toBe(0);
    expect(levelAt(points, -1)).toBe(0);
  });

  it('strike every note of a run anew', () => {
    const lead = RECIPES.gameOver.kind === 'shot' ? RECIPES.gameOver.voices[0] : undefined;
    if (!lead) throw new Error('no game over voice');
    const points = envelopeOf(lead);
    // Four notes: silence at each boundary, full level 5 ms after it.
    for (const boundary of [0, 0.18, 0.36, 0.54]) {
      expect(levelAt(points, boundary), String(boundary)).toBeCloseTo(0, 9);
      expect(levelAt(points, boundary + 0.005), String(boundary)).toBeCloseTo(1, 9);
    }
  });

  it('hold the level until the release where a voice has one', () => {
    const fall = RECIPES.death.kind === 'shot' ? RECIPES.death.voices[0] : undefined;
    if (!fall || fall.release === undefined) throw new Error('the death sweep has no release');
    const points = envelopeOf(fall);
    const end = voiceLength(fall);
    expect(levelAt(points, end - fall.release)).toBeCloseTo(fall.level, 9);
    expect(levelAt(points, end - fall.release / 2)).toBeCloseTo(fall.level / 2, 9);
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const play = (effect: EffectName, delay = 0): Cue[] => [{ effect, delay }];

/** At least one event of every type, with the effect the guide says it plays. */
const SAMPLES: readonly { readonly event: GameEvent; readonly plays: readonly Cue[] }[] = [
  { event: { type: 'levelStarted', levelIndex: 0, score: 0, lives: 3 }, plays: [] },
  { event: { type: 'readyEnded' }, plays: [] },
  { event: { type: 'jumped', x: 0, y: 0 }, plays: play('jump') },
  { event: { type: 'landed', x: 0, y: 0, speed: 3 * SUB }, plays: play('land') },
  { event: { type: 'landed', x: 0, y: 0, speed: 4 * SUB }, plays: play('land') },
  { event: { type: 'landed', x: 0, y: 0, speed: 3 * SUB - 1 }, plays: [] },
  { event: { type: 'landed', x: 0, y: 0, speed: 0 }, plays: [] },
  { event: { type: 'bonked', x: 0, y: 0 }, plays: [] },
  { event: { type: 'thrustStarted' }, plays: [] },
  { event: { type: 'thrustStopped' }, plays: [] },
  { event: { type: 'fuelEmptied', x: 0, y: 0 }, plays: play('fuelEmpty') },
  { event: { type: 'pickup', kind: 'crystal', index: 0, x: 0, y: 0, score: 10 }, plays: play('gem') },
  { event: { type: 'pickup', kind: 'blaster', index: 1, x: 0, y: 0, score: 0 }, plays: play('item') },
  { event: { type: 'pickup', kind: 'thruster', index: 2, x: 0, y: 0, score: 0 }, plays: play('item') },
  { event: { type: 'pickupRestored', kind: 'thruster', index: 2, x: 0, y: 0 }, plays: [] },
  { event: { type: 'trophyCollected', x: 0, y: 0, score: 100 }, plays: play('cog') },
  { event: { type: 'doorOpened', x: 0, y: 0 }, plays: play('airlock', 0.32) },
  { event: { type: 'boltFired', x: 0, y: 0, dir: 1 }, plays: play('bolt') },
  { event: { type: 'boltEnded', x: 0, y: 0, hit: 'wall' }, plays: play('boltHit') },
  { event: { type: 'boltEnded', x: 0, y: 0, hit: 'enemy' }, plays: [] },
  { event: { type: 'boltEnded', x: 0, y: 0, hit: 'range' }, plays: [] },
  { event: { type: 'enemyKilled', index: 0, kind: 'cinderpeg', x: 0, y: 0, score: 50 }, plays: play('enemyDown') },
  { event: { type: 'enemyKilled', index: 1, kind: 'moth', x: 0, y: 0, score: 0 }, plays: play('enemyDown') },
  { event: { type: 'playerDied', cause: 'spikes', x: 0, y: 0, livesAfter: 2, score: 0 }, plays: play('death') },
  { event: { type: 'playerDied', cause: 'fell', x: 0, y: 0, livesAfter: 0, score: 0 }, plays: play('death') },
  { event: { type: 'respawned', lives: 2, reason: 'death' }, plays: [] },
  { event: { type: 'respawned', lives: 2, reason: 'restart' }, plays: [] },
  {
    event: { type: 'levelCompleted', levelIndex: 0, last: false, bonus: 200, score: 200, lives: 3, highestUnlocked: 1 },
    plays: play('clear'),
  },
  {
    event: { type: 'levelCompleted', levelIndex: 9, last: true, bonus: 200, score: 200, lives: 3, highestUnlocked: 9 },
    plays: play('clear'),
  },
  { event: { type: 'gameOver', score: 0 }, plays: play('gameOver') },
  { event: { type: 'gameWon', score: 0, lives: 3, lifeBonus: 1500 }, plays: play('win') },
];

/** The `type` strings of the GameEvent union, read from the contract's source text. */
function eventTypesInContract(): string[] {
  const source = readFileSync(new URL('../core/types.ts', import.meta.url), 'utf8');
  const from = source.indexOf('export type GameEvent =');
  const to = source.indexOf('export type GameEventType');
  expect(from, 'GameEvent not found in src/core/types.ts').toBeGreaterThan(0);
  expect(to, 'GameEventType not found in src/core/types.ts').toBeGreaterThan(from);
  return [...source.slice(from, to).matchAll(/readonly type: '(\w+)'/g)].map((match) => match[1] ?? '');
}

describe('recipes: which event plays what', () => {
  it('has decided every GameEvent type of the contract: a new one fails here until it is added', () => {
    const inContract = eventTypesInContract();
    expect(inContract.length).toBeGreaterThanOrEqual(20);
    expect(new Set(inContract).size).toBe(inContract.length);
    expect(Object.keys(EVENT_SOUND).sort()).toEqual([...inContract].sort());
  });

  it('keeps silent exactly the events the guide lists as silent', () => {
    const silent = Object.entries(EVENT_SOUND)
      .filter(([, decided]) => decided === 'silent')
      .map(([type]) => type)
      .sort();
    expect(silent).toEqual(
      ['levelStarted', 'readyEnded', 'bonked', 'thrustStarted', 'thrustStopped', 'pickupRestored', 'respawned'].sort(),
    );
  });

  it('plays what the guide says for a sample of every event type', () => {
    for (const { event, plays } of SAMPLES) {
      expect(cuesForEvent(event), JSON.stringify(event)).toEqual(plays);
    }
  });

  it('agrees with the table: a silent type never plays, a sounding type plays for at least one event', () => {
    const types = Object.keys(EVENT_SOUND) as GameEventType[];
    for (const type of types) {
      const samples = SAMPLES.filter(({ event }) => event.type === type);
      expect(samples.length, `no sample event of type ${type}`).toBeGreaterThan(0);
      const sounding = samples.some(({ event }) => cuesForEvent(event).length > 0);
      expect(sounding ? 'sound' : 'silent', type).toBe(EVENT_SOUND[type]);
    }
  });

  it('names only effects that exist and are not the loop', () => {
    for (const { event } of SAMPLES) {
      for (const cue of cuesForEvent(event)) {
        expect(RECIPES[cue.effect].kind, cue.effect).toBe('shot');
        expect(cue.delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('hears a landing from 3 px per tick (768 sub-pixels) on', () => {
    expect(LAND_MIN_SPEED).toBe(768);
    expect(cuesForEvent({ type: 'landed', x: 0, y: 0, speed: 767 })).toEqual([]);
    expect(cuesForEvent({ type: 'landed', x: 0, y: 0, speed: 768 })).toEqual(play('land'));
  });

  it('opens the airlock 320 ms after the cog, while the cog’s fanfare is still playing', () => {
    expect(AIRLOCK_DELAY).toBe(0.32);
    const cog = RECIPES.cog;
    expect(cog.kind === 'shot' && effectLength(cog) > AIRLOCK_DELAY).toBe(true);
  });

  it('stays silent, and does not throw, for an event type it has never heard of', () => {
    const fromTheFuture = { type: 'teleported', x: 0, y: 0 } as unknown as GameEvent;
    expect(cuesForEvent(fromTheFuture)).toEqual([]);
  });

  it('allocates nothing: the same event gives the same list', () => {
    const event: GameEvent = { type: 'jumped', x: 0, y: 0 };
    expect(cuesForEvent(event)).toBe(cuesForEvent(event));
  });
});

describe('recipes: rate limits', () => {
  it('repeats the low-fuel beep every 8 ticks and plays the start jingle once', () => {
    expect(FUEL_LOW_BEEP_TICKS).toBe(8);
    expect(RECIPES.fuelLow).toMatchObject({ minGapTicks: 8 });
    expect(RECIPES.start).toMatchObject({ once: true });
    // The beep is shorter than its gap, so beeps never overlap.
    const beep = RECIPES.fuelLow;
    expect(beep.kind === 'shot' && effectLength(beep) < ticksToSeconds(FUEL_LOW_BEEP_TICKS)).toBe(true);
  });

  it('leaves every other effect at the default of one start per tick', () => {
    for (const name of EFFECT_NAMES) {
      const recipe = RECIPES[name];
      if (recipe.kind !== 'shot' || name === 'fuelLow') continue;
      expect(recipe.minGapTicks, name).toBeUndefined();
      if (name !== 'start') expect(recipe.once, name).toBeUndefined();
    }
  });

  it('counts seconds in ticks of 1/60 s', () => {
    expect(ticksToSeconds(TICK_HZ)).toBe(1);
    expect(ticksToSeconds(20)).toBeCloseTo(1 / 3, 12);
  });
});

describe('recipes: the crystal ladder', () => {
  it('is D minor pentatonic from D5 to D6, one recipe per step', () => {
    expect(GEM_LADDER).toEqual([587, 698, 784, 880, 1047, 1175]);
    expect(GEM_RECIPES.map(toneFrequencies)).toEqual(GEM_LADDER.map((freq) => [freq]));
    expect(RECIPES.gem).toEqual(GEM_RECIPES[0]);
    for (const recipe of GEM_RECIPES) {
      expect(recipe.gain).toBe(GUIDE.gem.gain);
      expect(effectLength(recipe) * 1000).toBeCloseTo(Number(GUIDE.gem.ms), 6);
    }
  });

  it('climbs one step for a crystal taken inside the window and starts again after it', () => {
    const window = 0.75;
    const first = climbGemLadder(null, 10, window);
    expect(first).toEqual({ step: 0, time: 10 });
    const second = climbGemLadder(first, 10.5, window);
    expect(second).toEqual({ step: 1, time: 10.5 });
    // The window is measured from the last crystal, not from the first.
    const third = climbGemLadder(second, 11.2, window);
    expect(third.step).toBe(2);
    // Exactly the window is too late: "less than" the window climbs.
    expect(climbGemLadder(third, 11.2 + window, window).step).toBe(0);
    expect(climbGemLadder(third, 11.2 + window - 0.001, window).step).toBe(3);
  });

  it('stays on the top step however many crystals follow', () => {
    let step = climbGemLadder(null, 0, 1);
    for (let i = 1; i <= 12; i++) step = climbGemLadder(step, i * 0.1, 1);
    expect(step.step).toBe(GEM_LADDER.length - 1);
  });
});

describe('recipes: the thruster follows the state', () => {
  const view = (over: {
    status?: ThrustView['session']['status'];
    phase?: ThrustView['run']['phase'];
    thrusting?: boolean;
    fuel?: number;
    fuelTicks?: number;
  }): ThrustView => ({
    phys: { fuelTicks: over.fuelTicks ?? 80 },
    session: { status: over.status ?? 'playing' },
    run: { phase: over.phase ?? 'playing', player: { thrusting: over.thrusting ?? true, fuel: over.fuel ?? 60 } },
  });

  it('sounds only while the world runs and the thruster burns', () => {
    expect(thrustState(view({}))).toEqual({ thrust: true, fuelLow: false });
    expect(thrustState(view({ thrusting: false }))).toEqual({ thrust: false, fuelLow: false });
    for (const phase of ['ready', 'dying', 'exiting'] as const) {
      expect(thrustState(view({ phase })), phase).toEqual({ thrust: false, fuelLow: false });
    }
    for (const status of ['gameOver', 'won'] as const) {
      expect(thrustState(view({ status })), status).toEqual({ thrust: false, fuelLow: false });
    }
  });

  it('reads a whole GameState', () => {
    const fromGame: (game: GameState) => ThrustSound = thrustState;
    expect(fromGame).toBe(thrustState);
  });

  it('beeps at 20 % of a full tank or less, and only while thrusting', () => {
    expect(FUEL_LOW_PERCENT).toBe(20);
    expect(thrustState(view({ fuel: 17 })).fuelLow).toBe(false);
    expect(thrustState(view({ fuel: 16 })).fuelLow).toBe(true);
    expect(thrustState(view({ fuel: 1 })).fuelLow).toBe(true);
    expect(thrustState(view({ fuel: 16, thrusting: false })).fuelLow).toBe(false);
    expect(thrustState(view({ fuel: 16, phase: 'dying' })).fuelLow).toBe(false);
    // The share is of the tank's size, whatever that is.
    expect(thrustState(view({ fuelTicks: 72, fuel: 14 })).fuelLow).toBe(true);
    expect(thrustState(view({ fuelTicks: 72, fuel: 15 })).fuelLow).toBe(false);
  });
});
