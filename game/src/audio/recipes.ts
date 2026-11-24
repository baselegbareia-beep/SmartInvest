/**
 * Every sound of the game, as data (docs/ART-AND-SOUND.md, section 12).
 *
 * This file holds no Web Audio code and reads no feel number. It is the
 * guide's table turned into values, plus the pure rules that say which effect
 * a GameEvent plays and what the thruster's sound follows. `synth.ts` turns
 * one recipe into Web Audio nodes, `Sfx.ts` decides when, and `offline.ts`
 * renders a recipe to numbers for the tests.
 *
 * Units: seconds, hertz, and gains between 0 and 1.
 *
 * HOW A GAIN IS READ. The guide gives one gain per effect and calls it a peak
 * value. Here that number is `gain`, the loudest the whole effect gets before
 * the master gain. Each voice has a `level`, its share of that gain, and the
 * levels of voices that sound together add up to at most 1. Filtered noise is
 * far quieter than its gain says (most of white noise is filtered away), so a
 * noise voice also carries a `makeup` factor that brings its peak back to
 * 1 before the level is applied. The makeup factors are measured, not chosen:
 * each is 1 divided by the peak of that voice's stretch of noise through its
 * filter, rendered in Chromium with a flat envelope. `renderEffect` in
 * `offline.ts` reports the peak that comes out of every recipe, and
 * `e2e/audio.spec.ts` checks that it is the recipe's gain or a little under
 * it (measured: 77 % for the thrust loop up to 99 % for single tones).
 */
import { SUB, TICK_HZ } from '../core/types';
import type { GameEvent, GameEventType, RunPhase, SessionStatus } from '../core/types';

// ---------------------------------------------------------------------------
// The mixer
// ---------------------------------------------------------------------------

/** Every voice goes through one master gain of this size. */
export const MASTER_GAIN = 0.6;

/**
 * The compressor after the master gain: a safety net for the moments when
 * several loud effects overlap. One effect alone stays under the threshold.
 *
 * A browser's compressor also adds make-up gain of its own, which cannot be
 * switched off: measured in Chromium with these settings, 1.63 times for
 * everything under the threshold. So one effect alone leaves the chain at
 * about its recipe's gain (0.6 x 1.63 = 0.98), and the louder the mix the
 * less it is raised: a mix five times louder than the loudest effect still
 * comes out below 0.75. `renderEffect` measures the real output.
 */
export const COMPRESSOR = {
  /** Decibels. Louder than this is squeezed. */
  threshold: -12,
  /** Decibels over which the squeeze sets in gradually. */
  knee: 6,
  ratio: 4,
  /** Seconds. */
  attack: 0.003,
  release: 0.12,
} as const;

/** At most this many voices sound at once; the oldest is dropped to make room. The thrust loop's voices count but are never dropped. */
export const MAX_VOICES = 6;

/** A voice dropped to make room, or silenced by a pause, fades out this fast, so that it does not click. */
export const DROP_FADE = 0.012;

/** The sound switch slides the master gain to its new value in this time. */
export const MUTE_RAMP = 0.03;

/** Unless a voice says otherwise it reaches its level in this time. */
export const ATTACK = 0.005;

/** The one buffer of white noise every noise voice reads: its length, its sample rate and the seed of its generator. */
export const NOISE = { seconds: 1, rate: 44100, seed: 0x51f00d } as const;

// ---------------------------------------------------------------------------
// Recipe types
// ---------------------------------------------------------------------------

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** The Q of a low-pass or high-pass filter without resonance, decibels (see Filter.q). */
export const FLAT = -3;

export interface Filter {
  readonly type: 'lowpass' | 'highpass' | 'bandpass';
  /** Cut-off or centre frequency. */
  readonly freq: number;
  /** When given, the frequency slides to this value over the voice's length (exponentially). */
  readonly to?: number;
  /**
   * The Web Audio filter's Q. For a band-pass: centre frequency divided by
   * bandwidth. For a low-pass or high-pass it is in decibels: FLAT (-3) gives
   * the flattest response with no bump at the cut-off, higher values add a
   * resonant bump there.
   */
  readonly q: number;
}

/** One stretch of pitch in a tone voice. Notes follow each other without a gap. */
export interface Note {
  readonly freq: number;
  /** When given, the pitch slides to this frequency over the note (exponentially). */
  readonly to?: number;
  readonly dur: number;
  /** Multiplies the voice's level for this note. 1 when absent. */
  readonly level?: number;
}

interface VoiceShape {
  /** Seconds after the effect starts. */
  readonly at: number;
  /** Share of the effect's gain, 0 to 1. */
  readonly level: number;
  /** Seconds to reach the level. ATTACK when absent. */
  readonly attack?: number;
  /**
   * Seconds of fade at the end. When absent the fade starts right after the
   * attack, so the sound dies away over its whole length.
   */
  readonly release?: number;
}

/** An oscillator playing a run of notes. */
export interface ToneVoice extends VoiceShape {
  readonly kind: 'tone';
  readonly wave: Wave;
  readonly notes: readonly Note[];
  /** True: one attack and one fade over all the notes (a slide). Absent: every note is struck anew. */
  readonly tied?: boolean;
  readonly filter?: Filter;
}

/** A stretch of the white-noise buffer through a filter. */
export interface NoiseVoice extends VoiceShape {
  readonly kind: 'noise';
  readonly dur: number;
  readonly filter: Filter;
  /** Brings the filtered noise back to a peak of about 1 before `level` is applied (measured, see the file header). */
  readonly makeup: number;
  /** Where in the noise buffer the voice starts reading, seconds. Different voices read different stretches. */
  readonly offset: number;
}

export type Voice = ToneVoice | NoiseVoice;

/** An effect with a beginning and an end. */
export interface ShotRecipe {
  readonly kind: 'shot';
  /** Peak of the whole effect before the master gain: the guide's "gain". */
  readonly gain: number;
  /** One to three voices. */
  readonly voices: readonly Voice[];
  /** The effect is not started again sooner than this many ticks after its last start. 1 when absent. */
  readonly minGapTicks?: number;
  /** True: played at most once in the life of the page. */
  readonly once?: boolean;
}

export type LoopVoice =
  | { readonly kind: 'tone'; readonly wave: Wave; readonly freq: number; readonly level: number }
  | {
      readonly kind: 'noise';
      readonly filter: Filter;
      readonly level: number;
      readonly makeup: number;
      readonly offset: number;
    };

/** An effect that sounds for as long as something is true. It is started and stopped, never "played". */
export interface LoopRecipe {
  readonly kind: 'loop';
  readonly gain: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly voices: readonly LoopVoice[];
}

export type Recipe = ShotRecipe | LoopRecipe;

// ---------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------

/** The guide's effect ids, in the guide's order. */
export const EFFECT_NAMES = [
  'jump',
  'land',
  'gem',
  'item',
  'cog',
  'airlock',
  'clear',
  'bolt',
  'boltHit',
  'enemyDown',
  'thrust',
  'fuelLow',
  'fuelEmpty',
  'death',
  'gameOver',
  'win',
  'uiMove',
  'uiOk',
  'start',
] as const;

export type EffectName = (typeof EFFECT_NAMES)[number];

/**
 * The notes the guide uses, in hertz, rounded as the guide rounds them.
 * Everything pitched is built on D (D major for the fanfares, D minor
 * pentatonic for the crystal ladder), so effects that overlap stay in tune.
 */
export const NOTE = {
  D3: 147,
  G3: 196,
  A3: 220,
  C4: 262,
  D4: 294,
  F4: 349,
  G4: 392,
  A4: 440,
  B4: 494,
  C5: 523,
  D5: 587,
  E5: 659,
  F5: 698,
  FS5: 740,
  G5: 784,
  A5: 880,
  C6: 1047,
  D6: 1175,
} as const;

/** The crystal ladder: D minor pentatonic from D5 to D6. */
export const GEM_LADDER: readonly number[] = [NOTE.D5, NOTE.F5, NOTE.G5, NOTE.A5, NOTE.C6, NOTE.D6];

const note = (freq: number, dur: number, level?: number): Note =>
  level === undefined ? { freq, dur } : { freq, dur, level };
const slide = (freq: number, to: number, dur: number): Note => ({ freq, to, dur });

/** A crystal: one note of the ladder. */
const gemRecipe = (freq: number): ShotRecipe => ({
  kind: 'shot',
  gain: 0.12,
  voices: [{ kind: 'tone', wave: 'square', at: 0, level: 1, notes: [note(freq, 0.09)] }],
});

/** One recipe per step of the crystal ladder; step 0 is also `RECIPES.gem`. */
export const GEM_RECIPES: readonly ShotRecipe[] = GEM_LADDER.map(gemRecipe);

/**
 * How often the low-fuel beep repeats while the thruster burns the last FUEL_LOW_PERCENT of its tank,
 * ticks (docs/ART-AND-SOUND.md section 12). The beep is a warning that REPEATS (section 12). With the
 * shipped tank of 80 ticks the low part lasts 16 ticks: at the first 20 ticks it sounded once, 0.27 s
 * before the tank ran dry; at 8 it sounds twice (16 and 8 ticks before), a quickening "beep beep" that
 * reads as an alarm, still starting at the same moment. A larger tank gives more beeps (Sfx.test.ts
 * counts them by formula). The beep (35 ms) stays shorter than the gap (133 ms).
 */
export const FUEL_LOW_BEEP_TICKS = 8;

const COG_NOTES: readonly Note[] = [note(NOTE.D5, 0.08), note(NOTE.FS5, 0.08), note(NOTE.A5, 0.08), note(NOTE.D6, 0.32)];

const WIN_RUN: readonly Note[] = [NOTE.D4, NOTE.A4, NOTE.D5, NOTE.FS5, NOTE.A5, NOTE.D6].map((freq) => note(freq, 0.1));

const START_LEAD: readonly Note[] = [
  ...[NOTE.D4, NOTE.A4, NOTE.F4, NOTE.C5, NOTE.B4, NOTE.G4, NOTE.A4].map((freq) => note(freq, 0.2)),
  note(NOTE.D5, 0.6),
];

/** The thruster: a low roar with a hum under it, for as long as it burns. Started and stopped by `Sfx`, following the state. */
export const THRUST_LOOP: LoopRecipe = {
  kind: 'loop',
  gain: 0.1,
  fadeIn: 0.03,
  fadeOut: 0.08,
  voices: [
    { kind: 'noise', filter: { type: 'bandpass', freq: 320, q: 0.7 }, level: 0.5, makeup: 2.5, offset: 0 },
    { kind: 'tone', wave: 'sawtooth', freq: 55, level: 0.5 },
  ],
};

export const RECIPES: Readonly<Record<EffectName, Recipe>> = {
  // A rising chirp: the slide takes 90 ms and the sound is gone at 110 ms.
  jump: {
    kind: 'shot',
    gain: 0.16,
    voices: [
      { kind: 'tone', wave: 'square', at: 0, level: 1, tied: true, notes: [slide(196, 392, 0.09), note(392, 0.02)] },
    ],
  },

  // A soft thud.
  land: {
    kind: 'shot',
    gain: 0.1,
    voices: [
      {
        kind: 'noise',
        at: 0,
        level: 1,
        dur: 0.05,
        filter: { type: 'lowpass', freq: 500, q: FLAT },
        makeup: 4.35,
        offset: 0,
      },
    ],
  },

  // The first step of the crystal ladder. Sfx picks the step (GEM_RECIPES) from how recently the last crystal was taken.
  gem: gemRecipe(NOTE.D5),

  // A blaster or a thruster pack: a sweep up two octaves, then a bright ping on the note it arrived at.
  item: {
    kind: 'shot',
    gain: 0.14,
    voices: [
      {
        kind: 'tone',
        wave: 'sawtooth',
        at: 0,
        level: 1,
        release: 0.03,
        notes: [slide(220, 880, 0.18)],
        filter: { type: 'lowpass', freq: 2000, q: FLAT },
      },
      { kind: 'tone', wave: 'square', at: 0.18, level: 0.7, notes: [note(NOTE.A5, 0.06)] },
    ],
  },

  // The golden cog: a D major arpeggio up to the octave, triangle and square together.
  cog: {
    kind: 'shot',
    gain: 0.18,
    voices: [
      { kind: 'tone', wave: 'square', at: 0, level: 0.4, notes: COG_NOTES },
      { kind: 'tone', wave: 'triangle', at: 0, level: 0.6, notes: COG_NOTES },
    ],
  },

  // The airlock opening: a hiss of escaping air over a falling rumble.
  airlock: {
    kind: 'shot',
    gain: 0.12,
    voices: [
      {
        kind: 'noise',
        at: 0,
        level: 0.65,
        dur: 0.45,
        filter: { type: 'highpass', freq: 1800, q: FLAT },
        makeup: 0.64,
        offset: 0.3,
      },
      { kind: 'tone', wave: 'sine', at: 0, level: 0.35, notes: [slide(110, 73, 0.25)] },
    ],
  },

  // Level clear: a quick run up, then A5 and D6 held together.
  clear: {
    kind: 'shot',
    gain: 0.16,
    voices: [
      {
        kind: 'tone',
        wave: 'square',
        at: 0,
        level: 1,
        notes: [
          note(NOTE.D5, 0.07),
          note(NOTE.E5, 0.07),
          note(NOTE.FS5, 0.07),
          note(NOTE.A5, 0.07),
          note(NOTE.A5, 0.3, 0.5),
        ],
      },
      { kind: 'tone', wave: 'square', at: 0.28, level: 0.5, notes: [note(NOTE.D6, 0.3)] },
    ],
  },

  // The blaster: a zap falling two octaves.
  bolt: {
    kind: 'shot',
    gain: 0.12,
    voices: [{ kind: 'tone', wave: 'square', at: 0, level: 1, notes: [slide(1320, 330, 0.11)] }],
  },

  // A bolt hitting a wall: a short tick.
  boltHit: {
    kind: 'shot',
    gain: 0.08,
    voices: [
      {
        kind: 'noise',
        at: 0,
        level: 1,
        dur: 0.035,
        filter: { type: 'bandpass', freq: 3000, q: 2 },
        makeup: 1.65,
        offset: 0.1,
      },
    ],
  },

  // An enemy destroyed: a crunch that closes down, over a falling buzz.
  enemyDown: {
    kind: 'shot',
    gain: 0.2,
    voices: [
      {
        kind: 'noise',
        at: 0,
        level: 0.6,
        dur: 0.2,
        filter: { type: 'lowpass', freq: 2000, to: 200, q: FLAT },
        makeup: 1.95,
        offset: 0.2,
      },
      { kind: 'tone', wave: 'square', at: 0, level: 0.4, notes: [slide(147, 55, 0.16)] },
    ],
  },

  thrust: THRUST_LOOP,

  // The tank is nearly empty: a short high beep, every FUEL_LOW_BEEP_TICKS while the last FUEL_LOW_PERCENT burns.
  fuelLow: {
    kind: 'shot',
    gain: 0.08,
    minGapTicks: FUEL_LOW_BEEP_TICKS,
    voices: [{ kind: 'tone', wave: 'square', at: 0, level: 1, notes: [note(NOTE.A5, 0.035)] }],
  },

  // The tank ran dry: a sputter falling two octaves.
  fuelEmpty: {
    kind: 'shot',
    gain: 0.14,
    voices: [{ kind: 'tone', wave: 'triangle', at: 0, level: 1, release: 0.1, notes: [slide(440, 110, 0.22)] }],
  },

  // The hero is destroyed: a long fall of three octaves through a burst of rubble.
  death: {
    kind: 'shot',
    gain: 0.22,
    voices: [
      { kind: 'tone', wave: 'sawtooth', at: 0, level: 0.6, release: 0.15, notes: [slide(440, 55, 0.42)] },
      {
        kind: 'noise',
        at: 0,
        level: 0.4,
        dur: 0.3,
        filter: { type: 'lowpass', freq: 800, q: FLAT },
        makeup: 2.1,
        offset: 0.5,
      },
    ],
  },

  // Game over: three steps down and a long low D.
  gameOver: {
    kind: 'shot',
    gain: 0.18,
    voices: [
      {
        kind: 'tone',
        wave: 'triangle',
        at: 0,
        level: 1,
        notes: [note(NOTE.D4, 0.18), note(NOTE.C4, 0.18), note(NOTE.A3, 0.18), note(NOTE.D3, 0.5)],
      },
    ],
  },

  // The game is won: two octaves of D major, then the full chord. Three voices: the third joins for the chord.
  win: {
    kind: 'shot',
    gain: 0.18,
    voices: [
      { kind: 'tone', wave: 'square', at: 0, level: 0.45, notes: [...WIN_RUN, note(NOTE.D5, 0.7, 0.75)] },
      { kind: 'tone', wave: 'triangle', at: 0, level: 0.55, notes: [...WIN_RUN, note(NOTE.FS5, 0.7, 0.6)] },
      { kind: 'tone', wave: 'triangle', at: 0.6, level: 0.33, notes: [note(NOTE.A5, 0.7)] },
    ],
  },

  // A menu's focus moves.
  uiMove: {
    kind: 'shot',
    gain: 0.08,
    voices: [{ kind: 'tone', wave: 'square', at: 0, level: 1, notes: [note(660, 0.025)] }],
  },

  // A menu item is confirmed.
  uiOk: {
    kind: 'shot',
    gain: 0.08,
    voices: [{ kind: 'tone', wave: 'square', at: 0, level: 1, notes: [slide(660, 990, 0.06)] }],
  },

  // The two-second jingle of the first tap on the title: a lead over two long bass notes.
  start: {
    kind: 'shot',
    gain: 0.14,
    once: true,
    voices: [
      { kind: 'tone', wave: 'square', at: 0, level: 0.6, notes: START_LEAD },
      { kind: 'tone', wave: 'triangle', at: 0, level: 0.4, notes: [note(NOTE.D3, 0.8), note(NOTE.G3, 1.2)] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Pure helpers over recipes
// ---------------------------------------------------------------------------

/** One corner of a voice's loudness curve: `t` seconds after the effect starts, at `v` (0 to 1, the voice's level included). */
export interface EnvelopePoint {
  readonly t: number;
  readonly v: number;
}

/** Seconds a voice lasts from its own start. */
export function voiceLength(voice: Voice): number {
  if (voice.kind === 'noise') return voice.dur;
  return voice.notes.reduce((sum, each) => sum + each.dur, 0);
}

/** Seconds from the effect's start until its last voice is silent. */
export function effectLength(recipe: ShotRecipe): number {
  return recipe.voices.reduce((longest, voice) => Math.max(longest, voice.at + voiceLength(voice)), 0);
}

/**
 * A voice's loudness over time as straight lines between the returned
 * corners. It starts and ends at 0. `synth.ts` schedules exactly these
 * corners, and the tests add them up, so there is one definition of how loud
 * a recipe is.
 */
export function envelopeOf(voice: Voice): EnvelopePoint[] {
  const points: EnvelopePoint[] = [];
  const add = (t: number, v: number): void => {
    const last = points[points.length - 1];
    if (last?.t === t && last.v === v) return;
    points.push({ t, v });
  };
  const strike = (from: number, to: number, peak: number): void => {
    const span = to - from;
    const attack = Math.min(voice.attack ?? ATTACK, span / 2);
    add(from, 0);
    add(from + attack, peak);
    if (voice.release !== undefined && voice.release < span - attack) add(to - voice.release, peak);
    add(to, 0);
  };

  if (voice.kind === 'noise' || voice.tied === true) {
    strike(voice.at, voice.at + voiceLength(voice), voice.level);
  } else {
    let t = voice.at;
    for (const each of voice.notes) {
      strike(t, t + each.dur, voice.level * (each.level ?? 1));
      t += each.dur;
    }
  }
  return points;
}

/** The value of a curve of straight lines at time `t`; 0 before its first corner and after its last. */
export function levelAt(points: readonly EnvelopePoint[], t: number): number {
  let before: EnvelopePoint | undefined;
  for (const point of points) {
    if (point.t > t) {
      if (!before) return 0;
      return before.v + ((point.v - before.v) * (t - before.t)) / (point.t - before.t);
    }
    before = point;
  }
  return before?.t === t ? before.v : 0;
}

/**
 * The loudest moment of a recipe as its envelopes describe it: the largest
 * sum of the voices' levels, times the gain. The real peak of the rendered
 * sound is measured in the browser (`offline.ts`).
 */
export function nominalPeak(recipe: Recipe): number {
  if (recipe.kind === 'loop') return recipe.gain * recipe.voices.reduce((sum, voice) => sum + voice.level, 0);
  const curves = recipe.voices.map(envelopeOf);
  let loudest = 0;
  for (const curve of curves) {
    for (const corner of curve) {
      const sum = curves.reduce((total, other) => total + levelAt(other, corner.t), 0);
      loudest = Math.max(loudest, sum);
    }
  }
  return recipe.gain * loudest;
}

// ---------------------------------------------------------------------------
// Which event plays what
// ---------------------------------------------------------------------------

/** One effect to start, `delay` seconds from now. */
export interface Cue {
  readonly effect: EffectName;
  readonly delay: number;
}

/** A landing is heard from this downward speed on: 3 px per tick, in the core's sub-pixels per tick. */
export const LAND_MIN_SPEED = 3 * SUB;

/** The airlock opens this long after the cog was taken, so that its hiss follows the cog's fanfare. */
export const AIRLOCK_DELAY = 0.32;

/**
 * Every GameEvent type, decided: 'sound' when `cuesForEvent` can answer with
 * an effect, 'silent' when the event has no sound of its own. A new event
 * type does not compile until it is added here, and `recipes.test.ts` fails
 * until this table and `cuesForEvent` agree.
 *
 * The silent ones, and why: `levelStarted`, `readyEnded`, `bonked` and
 * `respawned` have no sound; `thrustStarted` and `thrustStopped` because the
 * thrust loop follows the state (`thrustState`), so it can never be left
 * running; `pickupRestored` because it comes with `fuelEmptied`.
 */
export const EVENT_SOUND: Readonly<Record<GameEventType, 'sound' | 'silent'>> = {
  levelStarted: 'silent',
  readyEnded: 'silent',
  jumped: 'sound',
  landed: 'sound',
  bonked: 'silent',
  thrustStarted: 'silent',
  thrustStopped: 'silent',
  fuelEmptied: 'sound',
  pickup: 'sound',
  pickupRestored: 'silent',
  trophyCollected: 'sound',
  doorOpened: 'sound',
  boltFired: 'sound',
  boltEnded: 'sound',
  enemyKilled: 'sound',
  playerDied: 'sound',
  respawned: 'silent',
  levelCompleted: 'sound',
  gameOver: 'sound',
  gameWon: 'sound',
};

const cue = (effect: EffectName, delay = 0): readonly Cue[] => [{ effect, delay }];

const NO_CUE: readonly Cue[] = [];
const CUE = {
  jump: cue('jump'),
  land: cue('land'),
  gem: cue('gem'),
  item: cue('item'),
  cog: cue('cog'),
  airlock: cue('airlock', AIRLOCK_DELAY),
  clear: cue('clear'),
  bolt: cue('bolt'),
  boltHit: cue('boltHit'),
  enemyDown: cue('enemyDown'),
  fuelEmpty: cue('fuelEmpty'),
  death: cue('death'),
  gameOver: cue('gameOver'),
  win: cue('win'),
} as const;

/**
 * The effects one event starts: none, or one. Pure, and it allocates nothing.
 * The crystal's `gem` is the ladder's first step here; which step is really
 * played is `climbGemLadder`'s business.
 */
export function cuesForEvent(event: GameEvent): readonly Cue[] {
  switch (event.type) {
    case 'jumped':
      return CUE.jump;
    case 'landed':
      return event.speed >= LAND_MIN_SPEED ? CUE.land : NO_CUE;
    case 'pickup':
      return event.kind === 'crystal' ? CUE.gem : CUE.item;
    case 'trophyCollected':
      return CUE.cog;
    case 'doorOpened':
      return CUE.airlock;
    case 'levelCompleted':
      return CUE.clear;
    case 'boltFired':
      return CUE.bolt;
    case 'boltEnded':
      // 'enemy' is covered by enemyDown; a bolt that runs out of range just vanishes.
      return event.hit === 'wall' ? CUE.boltHit : NO_CUE;
    case 'enemyKilled':
      return CUE.enemyDown;
    case 'fuelEmptied':
      return CUE.fuelEmpty;
    case 'playerDied':
      return CUE.death;
    case 'gameOver':
      return CUE.gameOver;
    case 'gameWon':
      return CUE.win;
    case 'levelStarted':
    case 'readyEnded':
    case 'bonked':
    case 'thrustStarted':
    case 'thrustStopped':
    case 'pickupRestored':
    case 'respawned':
      return NO_CUE;
    default:
      // A new event type lands here and does not compile: decide its sound above.
      return undecided(event, NO_CUE);
  }
}

/**
 * Its first parameter accepts nothing, so the call above compiles only while
 * the switch handles every event type. In a build that skipped the type check
 * an unknown event is silent instead of an error.
 */
function undecided(_event: never, cues: readonly Cue[]): readonly Cue[] {
  return cues;
}

// ---------------------------------------------------------------------------
// The crystal ladder
// ---------------------------------------------------------------------------

/** The last crystal that was heard: its step on the ladder and when it started (seconds, any clock). */
export interface GemStep {
  readonly step: number;
  readonly time: number;
}

/**
 * The step of the next crystal: one up when the last crystal was less than
 * `windowSeconds` ago (staying on the top step), otherwise the bottom again.
 */
export function climbGemLadder(last: GemStep | null, now: number, windowSeconds: number): GemStep {
  const climbing = last !== null && now - last.time < windowSeconds;
  return { step: climbing ? Math.min(last.step + 1, GEM_LADDER.length - 1) : 0, time: now };
}

// ---------------------------------------------------------------------------
// The thruster's sound follows the state
// ---------------------------------------------------------------------------

/** The low-fuel beep sounds while the tank holds this share of a full tank or less, in percent. */
export const FUEL_LOW_PERCENT = 20;

/** The few fields of a GameState that the thruster's sound reads. A GameState fits. */
export interface ThrustView {
  readonly phys: { readonly fuelTicks: number };
  readonly session: { readonly status: SessionStatus };
  readonly run: {
    readonly phase: RunPhase;
    readonly player: { readonly thrusting: boolean; readonly fuel: number };
  };
}

export interface ThrustSound {
  /** The thrust loop should be sounding. */
  readonly thrust: boolean;
  /** The low-fuel beep should be repeating. */
  readonly fuelLow: boolean;
}

const THRUST_OFF: ThrustSound = { thrust: false, fuelLow: false };
const THRUST_ON: ThrustSound = { thrust: true, fuelLow: false };
const THRUST_LOW: ThrustSound = { thrust: true, fuelLow: true };

/**
 * What the thruster should sound like right now. The loop plays only while
 * the world runs and the thruster burns, so a death, a level end, a game over
 * or the ready gate silence it without any event.
 */
export function thrustState(game: ThrustView): ThrustSound {
  const { player } = game.run;
  if (game.session.status !== 'playing' || game.run.phase !== 'playing' || !player.thrusting) return THRUST_OFF;
  return player.fuel * 100 <= game.phys.fuelTicks * FUEL_LOW_PERCENT ? THRUST_LOW : THRUST_ON;
}

/** Seconds in a number of ticks. */
export function ticksToSeconds(ticks: number): number {
  return ticks / TICK_HZ;
}
