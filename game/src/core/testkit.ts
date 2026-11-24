/**
 * TEST SUPPORT ONLY. No game code may import this file (purity.test.ts checks).
 *
 * 1. The reference numbers. Every golden number in docs/ARCHITECTURE.md
 *    ("apex 13472 on tick 21", "52 + 22 ticks") was measured with
 *    REFERENCE_TUNING, a frozen copy of the feel numbers as first shipped.
 *    Rule tests run on REFERENCE_PHYS, so an owner's change to src/tuning.ts
 *    cannot break them (section 12). It is refreshed on purpose, together
 *    with those golden numbers, once a tuning change has been accepted.
 *
 * 2. Small builders, so that a rule test reads as the rule it proves:
 *
 *      const level = levelFromRows(['....', '.P.T', '###D', '####']);
 *      const game = playingGame(level);            // gate open, hero standing on P
 *      stepTicks(stepPlayer, game, 'R', 6);        // hold RIGHT for six ticks
 *      expect(game.run.player.vx).toBe(REFERENCE_PHYS.runMax);
 *
 *    Summary (each is documented where it is defined):
 *      levelFromRows(rows, { id, frame })   grid rows to LevelData, through the real parseLevel
 *      playingGame(level, phys?)            one-level GameState, phase 'playing', hero at P
 *      IN('RJ'), NONE                       an Input from letters: L R J F T
 *      stepTicks(stepFn, game, input, n, events?)   n ticks of one input through any step function
 *      sub(px)                              art pixels to sub-pixels, exact or it throws
 *      referencePhysWith({ group: { field } })      REFERENCE_PHYS with a few tuning numbers changed
 *      DISTINCT_PHYS                        every Phys field different, to tell which field the code reads
 */
import { TUNING } from '../tuning';

import { compileTuning } from './compileTuning';
import { parseLevel } from './level';
import { createRun } from './run';
import { inputFromBits } from './script';
import { InputBit, SUB } from './types';
import type { GameEvent, GameState, Input, LevelData, Phys, Tuning } from './types';

// ---------------------------------------------------------------------------
// The reference numbers
// ---------------------------------------------------------------------------

/**
 * The eleven core groups (hero to score) as literals: this copy must not
 * follow src/tuning.ts. The five shell-only groups are taken from TUNING,
 * because compileTuning never looks at them and the type wants them present.
 */
export const REFERENCE_TUNING: Tuning = Object.freeze({
  hero: Object.freeze({
    heroHitboxW: 10,
    heroHitboxH: 14,
  }),
  run: Object.freeze({
    runMaxSpeed: 1.5,
    groundAccel: 0.25,
    groundDecel: 0.375,
    groundTurnAccel: 0.5,
    airAccel: 0.1875,
    airDecel: 0.1875,
    airTurnAccel: 0.3125,
  }),
  jump: Object.freeze({
    jumpVelocity: 5.0,
    jumpCutVelocity: 1.5,
  }),
  gravity: Object.freeze({
    gravityRise: 0.25,
    gravityFall: 0.4375,
    apexHangSpeed: 0.5,
    apexHangScale: 0.5,
    maxFallSpeed: 4.0,
  }),
  forgiveness: Object.freeze({
    coyoteFrames: 6,
    jumpBufferFrames: 7,
    cornerNudgePx: 4,
    ledgeCatchPx: 3,
    hurtInsetSidePx: 2,
    hurtInsetTopPx: 2,
    hurtInsetBottomPx: 1,
    spikeInsetSidePx: 3,
    spikeInsetTopPx: 8,
    fireInsetSidePx: 3,
    fireInsetTopPx: 4,
    coolantInsetTopPx: 6,
    enemyTouchInsetPx: 3,
    pickupOutsetPx: 2,
    doorInsetSidePx: 4,
  }),
  thruster: Object.freeze({
    jetAccel: 0.375,
    jetMaxRiseSpeed: 1.75,
    jetCutSpeed: 0.5,
    jetFuelFrames: 80,
  }),
  blaster: Object.freeze({
    boltSpeed: 4,
    boltRangePx: 160,
    boltHitboxW: 8,
    boltHitboxH: 6,
    fireBufferFrames: 6,
  }),
  enemies: Object.freeze({
    cinderpegSpeed: 0.5,
    mothSpeed: 0.75,
  }),
  timing: Object.freeze({
    hitStopFrames: 6,
    deathAnimFrames: 36,
    fadeFrames: 10,
    readyMinFrames: 12,
    exitFrames: 60,
  }),
  lives: Object.freeze({
    startLives: 3,
    maxLives: 3,
    livesPerLevelClear: 1,
  }),
  score: Object.freeze({
    crystal: 10,
    cog: 100,
    cinderpeg: 50,
    arcMoth: 100,
    levelClear: 200,
    lifeLeft: 500,
  }),
  camera: TUNING.camera,
  view: TUNING.view,
  touch: TUNING.touch,
  effects: TUNING.effects,
  pacing: TUNING.pacing,
});

/** REFERENCE_TUNING compiled: the Phys every rule test runs on. Frozen; to vary it use referencePhysWith. */
export const REFERENCE_PHYS: Phys = Object.freeze(compileTuning(REFERENCE_TUNING));

/** For referencePhysWith: any fields of any tuning groups. */
export type TuningChanges = { readonly [G in keyof Tuning]?: Partial<Tuning[G]> };

/**
 * REFERENCE_PHYS with some tuning numbers changed, in the owner's units,
 * for example `referencePhysWith({ forgiveness: { coyoteFrames: 0, jumpBufferFrames: 0 } })`.
 * It goes through compileTuning, so derived fields follow and unsafe values are refused.
 */
export function referencePhysWith(changes: TuningChanges): Phys {
  return Object.freeze(
    compileTuning({
      ...REFERENCE_TUNING,
      hero: { ...REFERENCE_TUNING.hero, ...changes.hero },
      run: { ...REFERENCE_TUNING.run, ...changes.run },
      jump: { ...REFERENCE_TUNING.jump, ...changes.jump },
      gravity: { ...REFERENCE_TUNING.gravity, ...changes.gravity },
      forgiveness: { ...REFERENCE_TUNING.forgiveness, ...changes.forgiveness },
      thruster: { ...REFERENCE_TUNING.thruster, ...changes.thruster },
      blaster: { ...REFERENCE_TUNING.blaster, ...changes.blaster },
      enemies: { ...REFERENCE_TUNING.enemies, ...changes.enemies },
      timing: { ...REFERENCE_TUNING.timing, ...changes.timing },
      lives: { ...REFERENCE_TUNING.lives, ...changes.lives },
      score: { ...REFERENCE_TUNING.score, ...changes.score },
    }),
  );
}

/**
 * A tuning in which every Phys field has a value of its own, at least 2 away
 * from every other field's value. At the reference numbers several fields are
 * equal (airAccel and airDecel are both 48, thrustAccel and groundDecel 96,
 * the fire, spike and enemy-touch insets and ledgeCatch 768, ...), so code
 * that reads the wrong one of two twins passes every test on REFERENCE_PHYS.
 * A rule also tested on DISTINCT_PHYS shows which field the code reads. Why 2
 * apart: a threshold read from a field only 1 away can make no difference (a
 * cut from -117 to -116 and a cut from -116 to -116 end the same).
 * Speeds and lengths are exact multiples of 1/256 px; the comment after each
 * gives its value in sub-pixels.
 */
export const DISTINCT_TUNING: Tuning = Object.freeze({
  hero: Object.freeze({ heroHitboxW: 10, heroHitboxH: 14 }),
  run: Object.freeze({
    runMaxSpeed: 1.5, // 384, as at the reference
    groundAccel: 0.2421875, // 62
    groundDecel: 0.359375, // 92
    groundTurnAccel: 0.515625, // 132
    airAccel: 0.16015625, // 41
    airDecel: 0.203125, // 52
    airTurnAccel: 0.28515625, // 73
  }),
  jump: Object.freeze({
    jumpVelocity: 5.0390625, // 1290
    jumpCutVelocity: 1.3515625, // 346
  }),
  gravity: Object.freeze({
    gravityRise: 0.265625, // 68
    gravityFall: 0.421875, // 108
    apexHangSpeed: 0.59375, // 152
    apexHangScale: 0.5,
    maxFallSpeed: 3.90625, // 1000
  }),
  forgiveness: Object.freeze({
    coyoteFrames: 5,
    jumpBufferFrames: 11,
    cornerNudgePx: 3.75, // 960
    ledgeCatchPx: 2.890625, // 740
    hurtInsetSidePx: 1.875, // 480
    hurtInsetTopPx: 2.5, // 640
    hurtInsetBottomPx: 1.25, // 320
    spikeInsetSidePx: 3.25, // 832
    spikeInsetTopPx: 7.5, // 1920
    fireInsetSidePx: 2.75, // 704
    fireInsetTopPx: 4.5, // 1152
    coolantInsetTopPx: 5.75, // 1472
    enemyTouchInsetPx: 3.5, // 896
    pickupOutsetPx: 2.125, // 544
    doorInsetSidePx: 4.75, // 1216
  }),
  thruster: Object.freeze({
    jetAccel: 0.34375, // 88
    jetMaxRiseSpeed: 1.6796875, // 430
    jetCutSpeed: 0.453125, // 116
    jetFuelFrames: 81,
  }),
  blaster: Object.freeze({
    boltSpeed: 3.828125, // 980
    boltRangePx: 150, // 38400
    boltHitboxW: 7, // 1792
    boltHitboxH: 5.5, // 1408
    fireBufferFrames: 7,
  }),
  enemies: Object.freeze({
    cinderpegSpeed: 0.484375, // 124
    mothSpeed: 0.734375, // 188
  }),
  timing: Object.freeze({ hitStopFrames: 6, deathAnimFrames: 35, fadeFrames: 8, readyMinFrames: 13, exitFrames: 59 }),
  lives: Object.freeze({ startLives: 3, maxLives: 9, livesPerLevelClear: 1 }),
  score: Object.freeze({ crystal: 15, cog: 105, cinderpeg: 46, arcMoth: 95, levelClear: 210, lifeLeft: 505 }),
  camera: TUNING.camera,
  view: TUNING.view,
  touch: TUNING.touch,
  effects: TUNING.effects,
  pacing: TUNING.pacing,
});

/** DISTINCT_TUNING compiled. compileTuning.test.ts checks that its fields really are pairwise 2 or more apart. */
export const DISTINCT_PHYS: Phys = Object.freeze(compileTuning(DISTINCT_TUNING));

/**
 * Art pixels to sub-pixels: `sub(5.25)` is 1344. Throws when the result is
 * not a whole number, so a test cannot put a fraction into the state.
 */
export function sub(px: number): number {
  const value = px * SUB;
  if (!Number.isInteger(value)) throw new Error(`sub(${px}): ${px} px is not a whole number of sub-pixels`);
  return value;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface LevelFromRowsOptions {
  /** The level id (the file stem in error messages). Default 'fixture'. */
  readonly id?: string;
  /**
   * Wrap the grid in walls: a row of # above and below, a column of # on each
   * side. EVERY CELL MOVES one column right and one row down. Default false:
   * outside the grid is solid on the left, the right and the top anyway, and
   * open below.
   */
  readonly frame?: boolean;
}

/**
 * A level from an array of grid rows, read by the real parseLevel (so the
 * rules of the format apply: one P, T and D, a wall under P and under each C).
 * Header and comment lines (`@requires blaster`, `; note`) may come first.
 */
export function levelFromRows(rows: readonly string[], options: LevelFromRowsOptions = {}): LevelData {
  const id = options.id ?? 'fixture';
  if (options.frame !== true) return parseLevel(rows.join('\n'), id);

  const firstGridRow = rows.findIndex((line) => line !== '' && !line.startsWith('@') && !line.startsWith(';'));
  const headers = firstGridRow < 0 ? rows : rows.slice(0, firstGridRow);
  const grid = firstGridRow < 0 ? [] : rows.slice(firstGridRow);
  const wall = '#'.repeat((grid[0]?.length ?? 0) + 2);
  return parseLevel([...headers, wall, ...grid.map((line) => `#${line}#`), wall].join('\n'), id);
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/**
 * A one-level GameState in phase 'playing': the ready gate has just opened
 * and no tick has been simulated yet, the hero stands on P, run.tick is 0.
 * Built from createRun and the types alone, so it needs neither game.ts nor
 * the twelve ready ticks. For the ready gate itself use createSession.
 */
export function playingGame(level: LevelData, phys: Phys = REFERENCE_PHYS): GameState {
  const run = createRun(level, phys);
  run.phase = 'playing';
  run.phaseTicks = 0;
  run.phaseLength = 0;
  // As step() leaves it when the gate opens: armed.
  run.readyArmed = true;
  return {
    phys,
    levels: [level],
    level,
    session: { status: 'playing', levelIndex: 0, score: 0, lives: phys.startLives, highestUnlocked: 0 },
    run,
  };
}

// ---------------------------------------------------------------------------
// Input and stepping
// ---------------------------------------------------------------------------

const LETTER_BITS: Readonly<Record<string, number>> = {
  L: InputBit.Left,
  R: InputBit.Right,
  J: InputBit.Jump,
  F: InputBit.Fire,
  T: InputBit.Thrust,
};

/**
 * The Input that holds the named buttons: L left, R right, J jump, F fire,
 * T thrust, in any order; `IN('RJ')` runs right with jump held, `IN('')` holds
 * nothing. Any other character throws. The result is a shared frozen object.
 */
export function IN(letters: string): Input {
  let bits = 0;
  for (const letter of letters) {
    const bit = LETTER_BITS[letter];
    if (bit === undefined) throw new Error(`IN('${letters}'): unknown button '${letter}' (use L R J F T)`);
    bits |= bit;
  }
  return inputFromBits(bits);
}

/** Nothing held. */
export const NONE: Input = IN('');

/**
 * Calls `stepFn(game, input, events)` n times with the same input, given as
 * an Input or as letters for IN. `stepFn` is whatever is under test: step
 * from game.ts for whole ticks, or one stage such as stepPlayer. Stages that
 * take no input are combined in an arrow function:
 * `stepTicks((g, input, ev) => { stepPlayer(g, input, ev); stepBolt(g, ev); }, game, 'F', 3)`.
 */
export function stepTicks(
  stepFn: (game: GameState, input: Input, events?: GameEvent[]) => void,
  game: GameState,
  input: Input | string,
  n: number,
  events?: GameEvent[],
): void {
  const held = typeof input === 'string' ? IN(input) : input;
  for (let i = 0; i < n; i++) stepFn(game, held, events);
}
