import { describe, expect, it } from 'vitest';

import { cloneGame, copyGame, createSession, holdReady, restartLevel, startLevel, step } from './game';
import { stepPlayer } from './player';
import { createRun } from './run';
import { DISTINCT_PHYS, IN, NONE, REFERENCE_PHYS, levelFromRows, playingGame, referencePhysWith, stepTicks, sub } from './testkit';
import { TILE } from './types';
import type { EnemyState, GameEvent, GameEventType, GameState, LevelData, SessionStart } from './types';

/**
 * The game loop against docs/ARCHITECTURE.md, sections 4 (steps 1 to 3), 6
 * and 10, on the reference numbers: the ready gate, the death timeline, what
 * a respawn keeps, lives, Restart level, resume after a pause, the airlock,
 * the next level, the win, and the two ways of copying a game.
 *
 * Everything here goes through the public functions of game.ts, mostly by
 * holding buttons and counting ticks, the way a player and the shell do.
 */

const P = REFERENCE_PHYS;

/** n ticks with the named buttons held (L R J F T); returns the events of those ticks. */
function hold(game: GameState, letters: string, n = 1): GameEvent[] {
  const events: GameEvent[] = [];
  stepTicks(step, game, letters, n, events);
  return events;
}

/**
 * Holds the named buttons until `done(game)` is true and returns the events
 * of those ticks. Bounded, so a rule that broke cannot hang the test run.
 */
function holdUntil(game: GameState, letters: string, done: (game: GameState) => boolean, limit = 3000): GameEvent[] {
  const events: GameEvent[] = [];
  const input = IN(letters);
  for (let t = 0; t < limit && !done(game); t++) step(game, input, events);
  if (!done(game)) throw new Error(`holding '${letters}' for ${limit} ticks did not get there`);
  return events;
}

function types(events: readonly GameEvent[]): GameEventType[] {
  return events.map((e) => e.type);
}

/** The events of one type, typed as that event. */
function only<T extends GameEventType>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** A session whose gate has waited out its minimum with nothing held: armed, still shut. The next press opens it. */
function armed(levels: readonly LevelData[], start?: Partial<SessionStart>): GameState {
  const game = createSession(levels, P, start);
  hold(game, '', P.readyMinTicks);
  return game;
}

function enemyOf(game: GameState, index: number): EnemyState {
  const enemy = game.run.enemies[index];
  if (enemy === undefined) throw new Error(`the level has no enemy ${index}`);
  return enemy;
}

const isPlaying = (game: GameState): boolean => game.run.phase === 'playing';
const isDying = (game: GameState): boolean => game.run.phase === 'dying';
const isExiting = (game: GameState): boolean => game.run.phase === 'exiting';

/** Session and run as plain data, for "nothing changed" and "these two are the same" checks. */
function snapshot(game: GameState): unknown {
  return structuredClone({ session: game.session, run: game.run });
}

/**
 * A small seeded generator: a test must be repeatable. It hands out the top
 * 16 bits of a 32-bit LCG; the low bits of such a generator repeat with a
 * short period (bit k with period 2^(k+1)), which made `% 16` cycle through a
 * handful of values and left whole kinds of input untried.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 16;
  };
}

/** Buttons that change every few ticks, with pauses, so gates open, things are collected and the hero dies. */
function randomLetters(next: () => number): string {
  const r = next() % 16;
  if (r < 3) return '';
  let letters = r < 11 ? 'R' : 'L';
  if (next() % 3 === 0) letters += 'J';
  if (next() % 4 === 0) letters += 'F';
  if (next() % 5 === 0) letters += 'T';
  return letters;
}

/** A long empty floor. An Arc Moth patrols the row above it, out of reach: it shows whether the world runs. */
const HALL = levelFromRows(['.........H..........', '.P................TD', '####################']);

/** Spikes in the cell next to the start: holding RIGHT kills within a few ticks. The moth is out of reach. */
const SPIKE_WALK = levelFromRows(['......H...', '.PS.....TD', '##########']);

/**
 * One of everything on one floor, in walking order: crystal (pickup 0),
 * blaster (1), thruster pack (2), the cog, a Cinderpeg walking toward the
 * hero, spikes, and the airlock behind the spikes.
 */
const BUSY = levelFromRows([
  '............................',
  '.P.G.B.J.T.........C...S...D',
  '############################',
]);

/** Holding RIGHT from the start takes a crystal and the cog and walks into the airlock. */
const WALK_A = levelFromRows(['..........', '.P.G.T..D.', '##########']);
/** The same walk without a crystal, with a pack and a blaster on the way. */
const WALK_B = levelFromRows(['............', '.P.J.B.T..D.', '############']);

// ---------------------------------------------------------------------------
// createSession and startLevel
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('defaults: level 0, score 0, startLives (3), highestUnlocked 0, status playing; it reports levelStarted', () => {
    const events: GameEvent[] = [];
    const game = createSession([WALK_A, WALK_B], P, undefined, events);

    expect(game.session).toEqual({ status: 'playing', levelIndex: 0, score: 0, lives: 3, highestUnlocked: 0 });
    expect(P.startLives).toBe(3);
    expect(events).toEqual([{ type: 'levelStarted', levelIndex: 0, score: 0, lives: 3 }]);
  });

  it('the starting level is loaded into the ready gate: a fresh run, phaseLength readyMinTicks (12), not armed', () => {
    const game = createSession([WALK_A, WALK_B], P);

    expect(game.level).toBe(WALK_A);
    expect(game.run).toEqual(createRun(WALK_A, P));
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.readyMinTicks);
    expect(P.readyMinTicks).toBe(12);
    expect(game.run.readyArmed).toBe(false);
    expect(game.run.tick).toBe(0);
  });

  it('phys and the level list are shared, not copied', () => {
    const levels = [WALK_A, WALK_B];
    const game = createSession(levels, P);
    expect(game.phys).toBe(P);
    expect(game.levels).toBe(levels);
  });

  it('a start point is honoured field by field: level, score, lives', () => {
    const events: GameEvent[] = [];
    const game = createSession([WALK_A, WALK_B], P, { levelIndex: 1, score: 730, lives: 2 }, events);

    expect(game.session).toEqual({ status: 'playing', levelIndex: 1, score: 730, lives: 2, highestUnlocked: 1 });
    expect(game.level).toBe(WALK_B);
    expect(game.run).toEqual(createRun(WALK_B, P));
    expect(events).toEqual([{ type: 'levelStarted', levelIndex: 1, score: 730, lives: 2 }]);
  });

  it('start lives are clamped to 1..maxLives: a hand-edited save cannot bring 999 lives, and a clear then gives one back as usual', () => {
    // parseSave keeps any whole number of lives from 1 up, because it never sees Phys; createSession is the check.
    const events: GameEvent[] = [];
    const game = createSession([WALK_A, WALK_B], P, { lives: 999 }, events);
    expect(game.session.lives).toBe(P.maxLives);
    expect(events).toEqual([{ type: 'levelStarted', levelIndex: 0, score: 0, lives: P.maxLives }]);
    expect(createSession([WALK_A], P, { lives: 0 }).session.lives).toBe(1);
    expect(createSession([WALK_A], P, { lives: -5 }).session.lives).toBe(1);
    expect(createSession([WALK_A], P, { lives: 2 }).session.lives).toBe(2);
    // The cap is maxLives, not startLives (equal at the reference numbers, 3 and 9 on DISTINCT_PHYS).
    expect(createSession([WALK_A], DISTINCT_PHYS, { lives: 7 }).session.lives).toBe(7);
    expect(createSession([WALK_A], DISTINCT_PHYS, { lives: 999 }).session.lives).toBe(DISTINCT_PHYS.maxLives);

    // Unclamped, the first clear would set lives to min(999 + 1, maxLives): a level clear taking 996 lives away.
    hold(game, '', P.readyMinTicks);
    const before = game.session.lives;
    const cleared = only(holdUntil(game, 'R', isExiting), 'levelCompleted');
    expect(cleared.map((event) => event.lives)).toEqual([P.maxLives]);
    expect(game.session.lives).toBeGreaterThanOrEqual(before);
  });

  it('highestUnlocked defaults to the starting level, is raised to it when lower, and is kept when higher', () => {
    const levels = [WALK_A, WALK_B, HALL];
    expect(createSession(levels, P, { levelIndex: 2 }).session.highestUnlocked).toBe(2);
    expect(createSession(levels, P, { levelIndex: 2, highestUnlocked: 0 }).session.highestUnlocked).toBe(2);
    expect(createSession(levels, P, { levelIndex: 0, highestUnlocked: 2 }).session.highestUnlocked).toBe(2);
    // The title screen's "New game" and "Continue" (section 10).
    expect(createSession(levels, P, { highestUnlocked: 1 }).session).toEqual({
      status: 'playing',
      levelIndex: 0,
      score: 0,
      lives: 3,
      highestUnlocked: 1,
    });
  });

  it('throws RangeError for an empty level list and for a level index outside it', () => {
    expect(() => createSession([], P)).toThrow(RangeError);
    expect(() => createSession([WALK_A], P, { levelIndex: 1 })).toThrow(RangeError);
    expect(() => createSession([WALK_A], P, { levelIndex: -1 })).toThrow(RangeError);
    expect(() => createSession([WALK_A, WALK_B], P, { levelIndex: 0.5 })).toThrow(RangeError);

    // Nothing is reported for a session that was never made.
    const events: GameEvent[] = [];
    expect(() => createSession([WALK_A], P, { levelIndex: 3 }, events)).toThrow(RangeError);
    expect(events).toEqual([]);
  });
});

describe('startLevel', () => {
  it('loads a brand-new visit: fresh run in the ready gate, tick 0, nothing taken, no cog, no items', () => {
    const game = armed([WALK_B, WALK_A]);
    holdUntil(game, 'R', (g) => g.run.hasTrophy);
    expect(game.run.player.hasBlaster).toBe(true);
    expect(game.run.player.hasThruster).toBe(true);

    const events: GameEvent[] = [];
    startLevel(game, 1, events);

    expect(game.level).toBe(WALK_A);
    expect(game.session.levelIndex).toBe(1);
    expect(game.run).toEqual(createRun(WALK_A, P));
    expect(events).toEqual([{ type: 'levelStarted', levelIndex: 1, score: P.scoreCog, lives: 3 }]);
  });

  it('keeps score, lives and highestUnlocked', () => {
    const game = createSession([WALK_A, WALK_B], P, { score: 440, lives: 2, highestUnlocked: 1 });
    startLevel(game, 1);
    expect(game.session).toEqual({ status: 'playing', levelIndex: 1, score: 440, lives: 2, highestUnlocked: 1 });
  });

  it('starting the same level again is a new visit: the crystal is back and the enemy pays again', () => {
    const game = armed([BUSY]);
    holdUntil(game, 'R', (g) => g.run.taken[0] === true);
    game.run.enemyPaid[0] = true;

    startLevel(game, 0);
    expect(game.run.taken).toEqual([false, false, false]);
    expect(game.run.enemyPaid).toEqual([false]);
    expect(game.run.tick).toBe(0);
  });

  it('sets the status back to playing, so a finished session can start a level again', () => {
    const game = createSession([SPIKE_WALK], P, { lives: 1 });
    hold(game, '', P.readyMinTicks);
    holdUntil(game, 'R', (g) => g.session.status === 'gameOver');

    startLevel(game, 0);
    expect(game.session.status).toBe('playing');
    expect(game.run.phase).toBe('ready');
  });

  it('throws RangeError for a bad index and leaves the game as it was', () => {
    const game = armed([WALK_A, WALK_B]);
    hold(game, 'R', 5);
    const before = snapshot(game);
    const events: GameEvent[] = [];

    expect(() => {
      startLevel(game, 2, events);
    }).toThrow(RangeError);
    expect(() => {
      startLevel(game, -1, events);
    }).toThrow(RangeError);
    expect(snapshot(game)).toEqual(before);
    expect(game.level).toBe(WALK_A);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ready gate
// ---------------------------------------------------------------------------

describe('the ready gate: frozen until the minimum has passed and a control is pressed', () => {
  it('with nothing held the world stays frozen, however long: nothing moves, nothing is reported, only run.tick counts', () => {
    const game = createSession([HALL], P);
    const fresh = createRun(HALL, P);

    const events = hold(game, '', 2000);

    expect(events).toEqual([]);
    expect(game.run.phase).toBe('ready');
    expect(game.run.player).toEqual(fresh.player);
    expect(game.run.enemies).toEqual(fresh.enemies);
    expect(game.run.tick).toBe(2000);
    // phaseTicks stops counting at the minimum.
    expect(game.run.phaseTicks).toBe(P.readyMinTicks);
    expect(game.run.readyArmed).toBe(true);
  });

  it('phaseTicks counts the minimum: 1 to readyMinTicks on the first ticks, then it stays', () => {
    const game = createSession([HALL], P);
    for (let t = 1; t <= P.readyMinTicks + 5; t++) {
      hold(game, '');
      expect(game.run.phaseTicks, `tick ${t}`).toBe(Math.min(t, P.readyMinTicks));
    }
  });

  it('after the minimum, the first press opens the gate on its own tick and readyEnded is reported', () => {
    for (const idle of [P.readyMinTicks, P.readyMinTicks + 1, 500]) {
      const game = createSession([HALL], P);
      expect(hold(game, '', idle), `${idle} idle ticks`).toEqual([]);

      const events = hold(game, 'R');
      expect(events, `${idle} idle ticks`).toEqual([{ type: 'readyEnded' }]);
      expect(game.run.phase).toBe('playing');
      expect(game.run.tick).toBe(idle + 1);
    }
  });

  it('each of the five controls opens the gate, and so do left and right together', () => {
    for (const letters of ['L', 'R', 'J', 'F', 'T', 'LR']) {
      const game = armed([HALL]);
      hold(game, letters);
      expect(game.run.phase, letters).toBe('playing');
    }
  });

  it('the minimum: a press on any of the first readyMinTicks ticks cannot open the gate on those ticks', () => {
    for (let pressTick = 2; pressTick <= P.readyMinTicks; pressTick++) {
      const game = createSession([HALL], P);
      hold(game, '', pressTick - 1);
      for (let t = pressTick; t <= P.readyMinTicks; t++) {
        expect(hold(game, 'R'), `pressed on tick ${pressTick}, tick ${t}`).toEqual([]);
        expect(game.run.phase, `pressed on tick ${pressTick}, tick ${t}`).toBe('ready');
      }
    }
  });

  it('a press made during the minimum and kept down opens the gate on the first tick after the minimum', () => {
    for (let pressTick = 2; pressTick <= P.readyMinTicks; pressTick++) {
      const game = createSession([HALL], P);
      hold(game, '', pressTick - 1);
      hold(game, 'R', P.readyMinTicks - pressTick + 1);
      expect(game.run.tick).toBe(P.readyMinTicks);
      expect(game.run.phase, `pressed on tick ${pressTick}`).toBe('ready');

      expect(hold(game, 'R'), `pressed on tick ${pressTick}`).toEqual([{ type: 'readyEnded' }]);
      expect(game.run.tick).toBe(P.readyMinTicks + 1);
      expect(game.run.phase).toBe('playing');
    }
  });

  it('a control let go and pressed again during the minimum counts as a press', () => {
    const game = createSession([HALL], P);
    hold(game, 'R', 4); // down since the level began: does not count
    hold(game, '', 1); // lifted
    hold(game, 'R', P.readyMinTicks - 5); // pressed again, still inside the minimum
    expect(game.run.phase).toBe('ready');

    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
    expect(game.run.tick).toBe(P.readyMinTicks + 1);
  });

  it('a tap that ends before the minimum does opens nothing', () => {
    const game = createSession([HALL], P);
    hold(game, '', 3);
    hold(game, 'J', 2);
    hold(game, '', 200);
    expect(game.run.phase).toBe('ready');
  });

  it('a control held since before the gate shut never opens it, however long: each of the five controls', () => {
    const fresh = createRun(HALL, P);
    for (const letters of ['L', 'R', 'J', 'F', 'T']) {
      const game = createSession([HALL], P);

      const events = hold(game, letters, 5000);

      expect(events, letters).toEqual([]);
      expect(game.run.phase, letters).toBe('ready');
      expect(game.run.readyArmed, letters).toBe(false);
      expect(game.run.player.x, letters).toBe(fresh.player.x);
      expect(game.run.player.y, letters).toBe(fresh.player.y);
      expect(game.run.enemies, letters).toEqual(fresh.enemies);
    }
  });

  it('changing from one held control to another without letting go is still not a press', () => {
    const game = createSession([HALL], P);
    hold(game, 'R', 40);
    hold(game, 'L', 40);
    hold(game, 'LJ', 40);
    hold(game, 'T', 40);
    expect(game.run.phase).toBe('ready');
    expect(game.run.readyArmed).toBe(false);
  });

  it('lifting and pressing opens it: one tick with nothing held arms the gate, the next press opens it', () => {
    const game = createSession([HALL], P);
    hold(game, 'R', 300);
    expect(game.run.phase).toBe('ready');

    expect(hold(game, '')).toEqual([]);
    expect(game.run.readyArmed).toBe(true);
    expect(game.run.phase).toBe('ready');

    expect(hold(game, 'R')).toEqual([{ type: 'readyEnded' }]);
    expect(game.run.phase).toBe('playing');
    expect(game.run.tick).toBe(302);
  });
});

describe('the ready gate: the tick that opens it', () => {
  it('is simulated in full: a direction acts at once, exactly as on any playing tick', () => {
    const game = armed([HALL]);
    const startX = game.run.player.x;

    expect(hold(game, 'R')).toEqual([{ type: 'readyEnded' }]);

    expect(game.run.phase).toBe('playing');
    expect(game.run.phaseLength).toBe(0);
    // The opening tick already counts as a playing tick.
    expect(game.run.phaseTicks).toBe(1);
    expect(game.run.player.vx).toBe(P.groundAccel);
    expect(game.run.player.x).toBe(startX + P.groundAccel);

    // The same tick from a hero that was never behind a gate.
    const twin = playingGame(HALL);
    stepPlayer(twin, IN('R'));
    expect(game.run.player).toEqual(twin.run.player);
  });

  it('the world moves on that tick too: the moth has taken its first step', () => {
    const game = armed([HALL]);
    const mothX = enemyOf(game, 0).x;
    hold(game, 'R');
    expect(enemyOf(game, 0).x).toBe(mothX - P.mothSpeed);
  });

  it('thrust acts at once: the engine fires on the opening tick', () => {
    const game = armed([HALL]);
    game.run.player.hasThruster = true;
    game.run.player.fuel = P.fuelTicks;

    expect(types(hold(game, 'T'))).toEqual(['readyEnded', 'thrustStarted']);
    expect(game.run.player.fuel).toBe(P.fuelTicks - 1);
    expect(game.run.player.vy).toBe(-P.thrustAccel);
  });

  it('a jump first pressed on the opening tick is a fresh press: the hero jumps on that tick', () => {
    const game = armed([HALL]);
    expect(types(hold(game, 'J'))).toEqual(['readyEnded', 'jumped']);
    expect(game.run.player.vy).toBe(-P.jumpVel);
  });

  it('a jump pressed before the gate opened is not replayed: the hero starts on the ground and needs a new press to jump', () => {
    const game = createSession([HALL], P);
    hold(game, '', 2);
    // Pressed during the minimum and kept down: this press opens the gate when the minimum is over.
    hold(game, 'J', P.readyMinTicks - 2);
    expect(game.run.phase).toBe('ready');

    expect(hold(game, 'J')).toEqual([{ type: 'readyEnded' }]);
    expect(game.run.player.onGround).toBe(true);
    expect(game.run.player.vy).toBe(0);
    expect(game.run.player.jumpBuffer).toBe(0);

    // Still held: nothing, however long.
    expect(hold(game, 'J', 60)).toEqual([]);
    expect(game.run.player.onGround).toBe(true);

    // Let go and press again: now it jumps.
    hold(game, '');
    expect(types(hold(game, 'J'))).toEqual(['jumped']);
  });

  it('a jump tapped while the gate was shut is forgotten: no jump when another control opens the gate', () => {
    const game = armed([HALL]);
    // A tap of jump would open the gate, so it is made inside the minimum of a gate shut again by a pause.
    hold(game, 'R', 5);
    holdReady(game);
    hold(game, '', 3);
    hold(game, 'J', 2);
    hold(game, '', P.readyMinTicks);

    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
    expect(hold(game, 'R', 20)).toEqual([]);
    expect(game.run.player.onGround).toBe(true);
  });

  it('fire pressed before the gate opened is not replayed either: no bolt until fire is pressed again', () => {
    const game = createSession([HALL], P);
    game.run.player.hasBlaster = true;
    hold(game, '', 2);
    hold(game, 'F', P.readyMinTicks - 2);

    expect(hold(game, 'F')).toEqual([{ type: 'readyEnded' }]);
    expect(game.run.player.fireBuffer).toBe(0);
    expect(game.run.bolt.active).toBe(false);
    expect(hold(game, 'F', 30)).toEqual([]);

    hold(game, '');
    expect(types(hold(game, 'F'))).toEqual(['boltFired']);
    expect(game.run.bolt.active).toBe(true);
  });

  it('fire first pressed on the opening tick fires on that tick', () => {
    const game = armed([HALL]);
    game.run.player.hasBlaster = true;
    expect(types(hold(game, 'F'))).toEqual(['readyEnded', 'boltFired']);
  });
});

describe('press detection across phases', () => {
  it('prevJump and prevFire follow the buttons on every tick of every phase: ready, playing, dying and exiting', () => {
    const game = createSession([SPIKE_WALK, WALK_A, WALK_B], P);
    const next = seeded(4242);
    const running = (g: GameState): boolean => g.session.status === 'playing';
    const checked = new Map<string, number>();
    // Jump and fire change at random. RIGHT is held, with a short pause now and then that re-arms the gate:
    // on SPIKE_WALK the hero dies three times; started again on WALK_A he clears it and WALK_B.
    for (const start of [0, 1]) {
      startLevel(game, start);
      game.session.lives = 3;
      for (let t = 0; t < 1500 && running(game); t++) {
        const r = next();
        const letters = `${t % 40 < 3 ? '' : 'R'}${r % 2 === 0 ? 'J' : ''}${(r >> 1) % 2 === 0 ? 'F' : ''}`;
        const phase = game.run.phase;
        step(game, IN(letters));
        // The tick that ends a dying or exiting phase puts in a fresh hero; every other tick shows the buttons.
        if (game.run.phase === phase && running(game)) {
          expect(game.run.player.prevJump, `${phase}, tick ${t}`).toBe(letters.includes('J'));
          expect(game.run.player.prevFire, `${phase}, tick ${t}`).toBe(letters.includes('F'));
          checked.set(phase, (checked.get(phase) ?? 0) + 1);
        }
      }
    }
    for (const phase of ['ready', 'playing', 'dying', 'exiting']) {
      expect(checked.get(phase) ?? 0, phase).toBeGreaterThan(50);
    }
  });
});

// ---------------------------------------------------------------------------
// Death and respawn
// ---------------------------------------------------------------------------

describe('the death timeline: dyingTicks (52) of dying, then respawnReadyTicks (22) of ready', () => {
  it('the reference lengths are 52 and 22, which is 74 frozen ticks', () => {
    expect(P.dyingTicks).toBe(52);
    expect(P.respawnReadyTicks).toBe(22);
  });

  it('the dying phase freezes the world for dyingTicks ticks; the life is taken and the hero put back on its last tick', () => {
    const game = armed([SPIKE_WALK]);
    const died = only(holdUntil(game, 'R', isDying), 'playerDied');
    expect(died).toHaveLength(1);
    expect(died[0]?.livesAfter).toBe(2);
    const deathTick = game.run.tick;
    const frozenPlayer = structuredClone(game.run.player);
    const frozenEnemies = structuredClone(game.run.enemies);
    // The moth did move while the hero walked.
    expect(frozenEnemies).not.toEqual(createRun(SPIKE_WALK, P).enemies);
    expect(game.run.phaseTicks).toBe(0);

    for (let t = 1; t < P.dyingTicks; t++) {
      expect(hold(game, ''), `dying tick ${t}`).toEqual([]);
      expect(game.run.phase, `dying tick ${t}`).toBe('dying');
      expect(game.run.phaseTicks, `dying tick ${t}`).toBe(t);
      expect(game.run.player, `dying tick ${t}`).toEqual(frozenPlayer);
      expect(game.run.enemies, `dying tick ${t}`).toEqual(frozenEnemies);
      // Not yet: the life goes when the animation is over.
      expect(game.session.lives, `dying tick ${t}`).toBe(3);
      expect(game.run.deathCause, `dying tick ${t}`).toBe('spikes');
    }

    expect(hold(game, '')).toEqual([{ type: 'respawned', lives: 2, reason: 'death' }]);
    expect(game.run.tick).toBe(deathTick + P.dyingTicks);
    expect(game.session.lives).toBe(2);
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.respawnReadyTicks);
    expect(game.run.readyArmed).toBe(false);
    expect(game.run.deathCause).toBeNull();
    expect(game.run.player).toEqual(createRun(SPIKE_WALK, P).player);
  });

  it('from the death tick 74 frozen ticks pass before a control can act: a press opens the gate on tick 75, not earlier', () => {
    const frozen = P.dyingTicks + P.respawnReadyTicks;
    expect(frozen).toBe(74);

    // The player lets go at the death and presses again on every later tick in turn.
    for (const pressTick of [P.dyingTicks + 2, 60, frozen, frozen + 1]) {
      const game = armed([SPIKE_WALK]);
      holdUntil(game, 'R', isDying);
      const deathTick = game.run.tick;
      const start = createRun(SPIKE_WALK, P).player;

      hold(game, '', pressTick - 1);
      const events = hold(game, 'L', frozen + 1 - pressTick);
      // Through tick 74 after the death: still shut, hero still on the start cell.
      expect(game.run.tick, `pressed on tick ${pressTick}`).toBe(deathTick + frozen);
      expect(game.run.phase, `pressed on tick ${pressTick}`).toBe('ready');
      expect(game.run.player.x, `pressed on tick ${pressTick}`).toBe(start.x);
      expect(only(events, 'readyEnded'), `pressed on tick ${pressTick}`).toEqual([]);

      // Tick 75.
      expect(types(hold(game, 'L')), `pressed on tick ${pressTick}`).toEqual(['readyEnded']);
      expect(game.run.tick).toBe(deathTick + frozen + 1);
      expect(game.run.player.x).toBe(start.x - P.groundAccel);
    }
  });

  it('a thumb kept on RIGHT through a death does not start the world again, however long it is held', () => {
    const game = armed([SPIKE_WALK]);
    holdUntil(game, 'R', isDying);

    // Through the dying phase, the respawn and far beyond the minimum.
    const events = hold(game, 'R', P.dyingTicks + 3000);

    expect(types(events)).toEqual(['respawned']);
    expect(game.run.phase).toBe('ready');
    expect(game.run.readyArmed).toBe(false);
    expect(game.session.lives).toBe(2);
    expect(game.run.player).toEqual({ ...createRun(SPIKE_WALK, P).player });

    // It must lift and press again.
    hold(game, '');
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
  });

  it('jump held through a death is not a press afterwards: lifted and pressed during the minimum, it opens the gate without a jump', () => {
    const game = armed([SPIKE_WALK]);
    holdUntil(game, 'R', isDying);
    hold(game, 'J', P.dyingTicks + 5);
    expect(game.run.phase).toBe('ready');
    hold(game, '');
    const events = holdUntil(game, 'J', isPlaying);
    expect(types(events)).toEqual(['readyEnded']);
    expect(game.run.player.onGround).toBe(true);
  });
});

describe('what a respawn keeps and resets, in play', () => {
  /**
   * Plays one life of BUSY the way the level is laid out, from an armed gate,
   * and stops on the tick the spikes kill; returns that life's events. Every
   * life is played with the same inputs, so whatever differs from one life to
   * the next is the respawn's doing.
   */
  function busyLife(game: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    // Walk through the crystal, the blaster, the pack and the cog (col 9), and stop on the cog's cell.
    events.push(...holdUntil(game, 'R', (g) => g.run.player.x >= 9 * TILE));
    // Shoot the Cinderpeg that is walking this way, standing still.
    events.push(...hold(game, 'F'));
    events.push(...holdUntil(game, '', (g) => !enemyOf(g, 0).alive, 80));
    // Walk on; fire once more just before the spikes, so a bolt is in flight at the death.
    events.push(...holdUntil(game, 'R', (g) => g.run.player.x > 21 * TILE));
    events.push(...hold(game, 'RF'));
    events.push(...holdUntil(game, 'R', isDying, 200));
    return events;
  }

  it('kept: score, crystals, the cog, enemyPaid, run.tick. Reset: hero, items and their pickups, enemies, bolt, phase', () => {
    const game = armed([BUSY]);
    const events = busyLife(game);

    // The life was a busy one.
    expect(only(events, 'pickup').map((e) => e.kind)).toEqual(['crystal', 'blaster', 'thruster']);
    expect(only(events, 'enemyKilled').map((e) => e.score)).toEqual([P.scoreCinderpeg]);
    const score = P.scoreCrystal + P.scoreCog + P.scoreCinderpeg;
    expect(game.session.score).toBe(score);
    expect(game.run.deathCause).toBe('spikes');
    expect(game.run.taken).toEqual([true, true, true]);
    expect(game.run.bolt.active).toBe(true);
    expect(enemyOf(game, 0).alive).toBe(false);
    expect(game.run.player.hasBlaster && game.run.player.hasThruster).toBe(true);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
    const deathTick = game.run.tick;
    const fresh = createRun(BUSY, P);

    expect(types(hold(game, '', P.dyingTicks))).toEqual(['respawned']);

    // Kept.
    expect(game.session).toEqual({ status: 'playing', levelIndex: 0, score, lives: 2, highestUnlocked: 0 });
    expect(game.run.taken[0]).toBe(true);
    expect(game.run.hasTrophy).toBe(true);
    expect(game.run.enemyPaid).toEqual([true]);
    expect(game.run.tick).toBe(deathTick + P.dyingTicks);

    // Reset: the hero is exactly the hero of a fresh level (start cell, at rest, facing right, empty-handed).
    expect(game.run.player).toEqual(fresh.player);
    expect(game.run.player.hasBlaster).toBe(false);
    expect(game.run.player.hasThruster).toBe(false);
    expect(game.run.player.fuel).toBe(0);
    // The blaster and the pack are back in their cells.
    expect(game.run.taken).toEqual([true, false, false]);
    // Every enemy is back on its cell, alive, heading left.
    expect(game.run.enemies).toEqual(fresh.enemies);
    expect(game.run.bolt.active).toBe(false);
    expect(game.run.deathCause).toBeNull();
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.respawnReadyTicks);
    expect(game.run.readyArmed).toBe(false);
  });

  it('on the next life the crystal stays gone, the items are taken again, and the enemy pays nothing the second time', () => {
    const game = armed([BUSY]);
    const first = busyLife(game);
    expect(only(first, 'enemyKilled').map((e) => e.score)).toEqual([P.scoreCinderpeg]);
    // Through the dying phase and the longer gate after a death, nothing held: armed again.
    hold(game, '', P.dyingTicks + P.respawnReadyTicks);
    expect(game.run.readyArmed).toBe(true);
    const score = game.session.score;

    const second = busyLife(game);

    expect(only(second, 'pickup').map((e) => e.kind)).toEqual(['blaster', 'thruster']);
    expect(only(second, 'trophyCollected')).toEqual([]);
    const kills = only(second, 'enemyKilled');
    expect(kills).toHaveLength(1);
    expect(kills[0]?.score).toBe(0);
    expect(game.run.enemyPaid).toEqual([true]);
    // Nothing in the level pays twice in one visit.
    expect(game.session.score).toBe(score);
    expect(game.run.deathCause).toBe('spikes');
  });
});

describe('lives and game over', () => {
  it('each death costs one life; with none left the run ends in gameOver and there is no respawn', () => {
    const game = armed([SPIKE_WALK], { score: 70 });
    const livesAfter: number[] = [];

    for (const livesLeft of [2, 1]) {
      livesAfter.push(...only(holdUntil(game, 'R', isDying), 'playerDied').map((e) => e.livesAfter));
      expect(hold(game, '', P.dyingTicks)).toEqual([{ type: 'respawned', lives: livesLeft, reason: 'death' }]);
      expect(game.session.lives).toBe(livesLeft);
      hold(game, '', P.respawnReadyTicks);
    }

    // The last life.
    livesAfter.push(...only(holdUntil(game, 'R', isDying), 'playerDied').map((e) => e.livesAfter));
    expect(livesAfter).toEqual([2, 1, 0]);
    expect(hold(game, '', P.dyingTicks - 1)).toEqual([]);
    expect(game.session.status).toBe('playing');

    expect(hold(game, '')).toEqual([{ type: 'gameOver', score: 70 }]);
    expect(game.session.status).toBe('gameOver');
    expect(game.session.lives).toBe(0);
    // No respawn: the hero stays where he died.
    expect(game.run.phase).toBe('dying');
    expect(game.run.deathCause).toBe('spikes');
  });

  it('step does nothing once the run is over: no tick is counted, nothing changes, nothing is reported', () => {
    const game = armed([SPIKE_WALK], { lives: 1 });
    holdUntil(game, 'R', (g) => g.session.status === 'gameOver');
    const before = snapshot(game);

    expect(hold(game, 'RJFT', 100)).toEqual([]);
    expect(hold(game, '', 100)).toEqual([]);
    expect(snapshot(game)).toEqual(before);
  });

  it('run.tick counts every step of a level visit, in every phase, and is not reset by a respawn', () => {
    const game = createSession([SPIKE_WALK], P);
    let steps = 0;
    for (const [letters, n] of [
      ['', P.readyMinTicks],
      ['R', 30],
      ['', P.dyingTicks],
      ['', P.respawnReadyTicks],
      ['R', 10],
    ] as const) {
      hold(game, letters, n);
      steps += n;
      expect(game.run.tick).toBe(steps);
    }
    expect(game.session.lives).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The pause menu: Restart level, and the gate after a resume
// ---------------------------------------------------------------------------

describe('restartLevel', () => {
  it('from play: costs a life with no dying phase and puts the hero behind a gate of readyMinTicks; reports respawned (restart)', () => {
    const game = armed([BUSY]);
    holdUntil(game, 'R', (g) => g.run.hasTrophy);
    const tickBefore = game.run.tick;
    const score = game.session.score;
    const fresh = createRun(BUSY, P);

    const events: GameEvent[] = [];
    restartLevel(game, events);

    expect(events).toEqual([{ type: 'respawned', lives: 2, reason: 'restart' }]);
    expect(game.session).toEqual({ status: 'playing', levelIndex: 0, score, lives: 2, highestUnlocked: 0 });
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.readyMinTicks);
    expect(game.run.readyArmed).toBe(false);
    // It is not a step.
    expect(game.run.tick).toBe(tickBefore);

    // The same reset as after a death: the crystal and the cog are kept, items and their pickups are not.
    expect(game.run.taken).toEqual([true, false, false]);
    expect(game.run.hasTrophy).toBe(true);
    expect(game.run.player).toEqual(fresh.player);
    expect(game.run.enemies).toEqual(fresh.enemies);
    expect(game.run.deathCause).toBeNull();
  });

  it('after a restart the gate waits readyMinTicks (12), not the longer wait of a death', () => {
    const game = armed([BUSY]);
    hold(game, 'R', 20);
    restartLevel(game);

    hold(game, '', P.readyMinTicks);
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
  });

  it('works from the ready gate too', () => {
    const game = createSession([BUSY], P);
    hold(game, '', 7);
    const events: GameEvent[] = [];
    restartLevel(game, events);

    expect(events).toEqual([{ type: 'respawned', lives: 2, reason: 'restart' }]);
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.readyArmed).toBe(false);
  });

  it('a thrusting hero stops thrusting: thrustStopped comes before respawned', () => {
    const game = armed([WALK_B]);
    holdUntil(game, 'R', (g) => g.run.player.hasThruster);
    hold(game, 'T', 3);
    expect(game.run.player.thrusting).toBe(true);

    const events: GameEvent[] = [];
    restartLevel(game, events);
    expect(types(events)).toEqual(['thrustStopped', 'respawned']);
    expect(game.run.player.thrusting).toBe(false);
  });

  it('on the last life it ends the run: gameOver with the score, no respawn, and the engine is off', () => {
    const game = armed([WALK_B], { lives: 1, score: 55 });
    holdUntil(game, 'R', (g) => g.run.player.hasThruster);
    hold(game, 'T', 3);
    const x = game.run.player.x;

    const events: GameEvent[] = [];
    restartLevel(game, events);

    expect(events).toEqual([{ type: 'thrustStopped' }, { type: 'gameOver', score: 55 }]);
    expect(game.session.status).toBe('gameOver');
    expect(game.session.lives).toBe(0);
    expect(game.run.player.thrusting).toBe(false);
    expect(game.run.player.x).toBe(x);

    // The phase is still 'playing', but the run is over: a second restart does nothing.
    const before = snapshot(game);
    const again: GameEvent[] = [];
    restartLevel(game, again);
    expect(again).toEqual([]);
    expect(snapshot(game)).toEqual(before);
  });

  it('does nothing while dying, while exiting, and after the run has ended', () => {
    const dying = armed([SPIKE_WALK]);
    holdUntil(dying, 'R', isDying);
    hold(dying, '', 10);

    const exiting = armed([WALK_A]);
    holdUntil(exiting, 'R', isExiting);

    const over = armed([SPIKE_WALK], { lives: 1 });
    holdUntil(over, 'R', (g) => g.session.status === 'gameOver');

    const won = armed([WALK_A]);
    holdUntil(won, 'R', (g) => g.session.status === 'won');

    for (const [name, game] of [
      ['dying', dying],
      ['exiting', exiting],
      ['game over', over],
      ['won', won],
    ] as const) {
      const before = snapshot(game);
      const events: GameEvent[] = [];
      restartLevel(game, events);
      expect(events, name).toEqual([]);
      expect(snapshot(game), name).toEqual(before);
    }
  });
});

describe('holdReady', () => {
  it('shuts the gate on a playing game: ready, phaseTicks 0, readyMinTicks to wait, not armed; nothing else changes', () => {
    const game = armed([BUSY]);
    holdUntil(game, 'R', (g) => g.run.player.hasThruster);
    hold(game, 'RJ', 6);
    hold(game, 'RT', 4);
    const before = structuredClone(game.run);
    const session = structuredClone(game.session);

    holdReady(game);

    expect(game.run).toEqual({ ...before, phase: 'ready', phaseTicks: 0, phaseLength: P.readyMinTicks, readyArmed: false });
    expect(game.session).toEqual(session);
    // The hero hangs in the air with its speed and its burning engine.
    expect(game.run.player.onGround).toBe(false);
    expect(game.run.player.vx).not.toBe(0);
    expect(game.run.player.thrusting).toBe(true);
  });

  it('the hero stays frozen in mid-air until a press, then carries on exactly as if there had been no pause', () => {
    const game = armed([HALL]);
    hold(game, 'RJ', 9);
    const twin = cloneGame(game);

    holdReady(game);
    const frozen = structuredClone(game.run.player);
    const moth = structuredClone(game.run.enemies);
    // The shell lets go of every control when the pause closes; the player then waits a while.
    expect(hold(game, '', 300)).toEqual([]);
    expect(game.run.player).toEqual({ ...frozen, prevJump: false });
    expect(game.run.enemies).toEqual(moth);

    // The press that reopens the gate is played on its own tick.
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
    hold(twin, 'R');
    expect(game.run.player).toEqual(twin.run.player);
    expect(game.run.enemies).toEqual(twin.run.enemies);

    hold(game, 'R', 40);
    hold(twin, 'R', 40);
    expect(game.run.player).toEqual(twin.run.player);
  });

  it('after a resume the gate waits readyMinTicks and needs a press: a control held through the pause does not count', () => {
    const game = armed([HALL]);
    hold(game, 'R', 10);
    const x = game.run.player.x;
    holdReady(game);

    expect(hold(game, 'R', 1000)).toEqual([]);
    expect(game.run.phase).toBe('ready');
    expect(game.run.player.x).toBe(x);

    // Lift; the minimum has long passed, so the next press opens it at once.
    hold(game, '');
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
  });

  it('a press right after the resume waits for the minimum', () => {
    const game = armed([HALL]);
    hold(game, 'R', 10);
    holdReady(game);

    hold(game, '');
    hold(game, 'R', P.readyMinTicks - 1);
    expect(game.run.phase).toBe('ready');
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
  });

  it('has no effect in the ready gate, while dying or while exiting', () => {
    const ready = armed([SPIKE_WALK]);
    holdUntil(ready, 'R', isDying);
    hold(ready, '', P.dyingTicks + 7);
    expect(ready.run.phase).toBe('ready');
    expect(ready.run.phaseLength).toBe(P.respawnReadyTicks);

    const dying = armed([SPIKE_WALK]);
    holdUntil(dying, 'R', isDying);
    hold(dying, '', 10);

    const exiting = armed([WALK_A]);
    holdUntil(exiting, 'R', isExiting);
    hold(exiting, '', 10);

    for (const [name, game] of [
      ['ready', ready],
      ['dying', dying],
      ['exiting', exiting],
    ] as const) {
      const before = snapshot(game);
      holdReady(game);
      expect(snapshot(game), name).toEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------
// The airlock, the next level, the win
// ---------------------------------------------------------------------------

describe('exit and the next level', () => {
  it('walking into the open airlock clears the level; the world freezes for exitTicks (60); then the next level starts', () => {
    const levels = [WALK_A, WALK_B];
    const game = armed(levels);

    const events = holdUntil(game, 'R', isExiting);
    const score = P.scoreCrystal + P.scoreCog + P.scoreLevelClear;
    expect(types(events)).toEqual(['readyEnded', 'pickup', 'trophyCollected', 'doorOpened', 'levelCompleted']);
    expect(events.at(-1)).toEqual({
      type: 'levelCompleted',
      levelIndex: 0,
      last: false,
      bonus: P.scoreLevelClear,
      score,
      lives: 3,
      highestUnlocked: 1,
    });
    expect(score).toBe(310);
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.exitTicks);
    expect(P.exitTicks).toBe(60);
    const frozen = structuredClone(game.run.player);

    for (let t = 1; t < P.exitTicks; t++) {
      expect(hold(game, ''), `exit tick ${t}`).toEqual([]);
      expect(game.run.phase, `exit tick ${t}`).toBe('exiting');
      expect(game.run.phaseTicks, `exit tick ${t}`).toBe(t);
      expect(game.run.player, `exit tick ${t}`).toEqual(frozen);
      expect(game.level, `exit tick ${t}`).toBe(WALK_A);
    }

    expect(hold(game, '')).toEqual([{ type: 'levelStarted', levelIndex: 1, score, lives: 3 }]);
    expect(game.level).toBe(WALK_B);
    expect(game.session).toEqual({ status: 'playing', levelIndex: 1, score, lives: 3, highestUnlocked: 1 });
    // A brand-new visit: tick 0, the ready gate, nothing carried over.
    expect(game.run).toEqual(createRun(WALK_B, P));
  });

  it('items never carry over to the next level', () => {
    const game = armed([WALK_B, WALK_A]);
    holdUntil(game, 'R', isExiting);
    expect(game.run.player.hasBlaster && game.run.player.hasThruster).toBe(true);

    hold(game, '', P.exitTicks);
    expect(game.level).toBe(WALK_A);
    expect(game.run.player.hasBlaster).toBe(false);
    expect(game.run.player.hasThruster).toBe(false);
    expect(game.run.player.fuel).toBe(0);
  });

  it('a thumb kept on RIGHT through the airlock does not start the next level, however long it is held', () => {
    const game = armed([WALK_A, WALK_B]);

    const events = hold(game, 'R', 4000);

    expect(only(events, 'levelStarted')).toHaveLength(1);
    expect(only(events, 'readyEnded')).toHaveLength(1);
    expect(game.session.levelIndex).toBe(1);
    expect(game.run.phase).toBe('ready');
    expect(game.run.readyArmed).toBe(false);
    expect(game.run.player).toEqual({ ...createRun(WALK_B, P).player });

    hold(game, '');
    expect(types(hold(game, 'R'))).toEqual(['readyEnded']);
  });

  it('a clear gives one life back, never above maxLives (3)', () => {
    for (const [before, after] of [
      [1, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      const game = armed([WALK_A, WALK_B], { lives: before });
      const done = only(holdUntil(game, 'R', isExiting), 'levelCompleted');
      expect(done[0]?.lives, `from ${before}`).toBe(after);
      expect(game.session.lives, `from ${before}`).toBe(after);
    }
  });

  it('a life lost on the way is returned by the clear: die once, clear with 3 again', () => {
    // Spikes off the direct path would be nicer; a restart costs the same life.
    const game = armed([WALK_A, WALK_B]);
    hold(game, 'R', 3);
    restartLevel(game);
    expect(game.session.lives).toBe(2);
    hold(game, '', P.readyMinTicks);

    holdUntil(game, 'R', isExiting);
    expect(game.session.lives).toBe(3);
  });
});

describe('the win', () => {
  it('after the last level the exiting phase ends in gameWon: each life left pays scoreLifeLeft (500)', () => {
    const game = armed([WALK_B, WALK_A], { levelIndex: 1, score: 1000 });

    const cleared = only(holdUntil(game, 'R', isExiting), 'levelCompleted');
    const scoreAtDoor = 1000 + P.scoreCrystal + P.scoreCog + P.scoreLevelClear;
    expect(cleared).toEqual([
      { type: 'levelCompleted', levelIndex: 1, last: true, bonus: 200, score: scoreAtDoor, lives: 3, highestUnlocked: 1 },
    ]);

    expect(hold(game, '', P.exitTicks - 1)).toEqual([]);
    expect(game.session.status).toBe('playing');

    expect(hold(game, '')).toEqual([{ type: 'gameWon', score: scoreAtDoor + 1500, lives: 3, lifeBonus: 1500 }]);
    expect(P.scoreLifeLeft).toBe(500);
    expect(game.session).toEqual({
      status: 'won',
      levelIndex: 1,
      score: scoreAtDoor + 1500,
      lives: 3,
      highestUnlocked: 1,
    });
  });

  it('the life returned by the last clear is counted in the win bonus', () => {
    for (const [livesAtDoor, bonus] of [
      [1, 1000],
      [2, 1500],
      [3, 1500],
    ] as const) {
      const game = armed([WALK_A], { lives: livesAtDoor });
      const won = only(holdUntil(game, 'R', (g) => g.session.status === 'won'), 'gameWon');
      expect(won[0]?.lifeBonus, `${livesAtDoor} lives at the door`).toBe(bonus);
      expect(game.session.score).toBe(P.scoreCrystal + P.scoreCog + P.scoreLevelClear + bonus);
    }
  });

  it('a one-level session is its own last level', () => {
    const game = armed([WALK_A]);
    const events = holdUntil(game, 'R', (g) => g.session.status === 'won');
    expect(only(events, 'levelCompleted')[0]?.last).toBe(true);
    expect(only(events, 'levelStarted')).toEqual([]);
    expect(game.session.highestUnlocked).toBe(0);
  });

  it('step does nothing after the win', () => {
    const game = armed([WALK_A]);
    holdUntil(game, 'R', (g) => g.session.status === 'won');
    const before = snapshot(game);

    expect(hold(game, 'LJ', 100)).toEqual([]);
    expect(snapshot(game)).toEqual(before);
  });
});

describe('score rules through a whole run', () => {
  /** A crystal, the blaster, an Arc Moth flying along the hero's row, the cog, the airlock. */
  const MOTH_LEVEL = levelFromRows(['................', '.P.G.B.....H..TD', '################']);
  /** The blaster, a Cinderpeg walking toward the hero, a crystal, the cog, the airlock. */
  const PEG_LEVEL = levelFromRows(['................', '.P.B.......C.GTD', '################']);

  /** Walk to the blaster, shoot the one enemy from where the hero stands, walk on into the airlock. */
  function clearLevel(game: GameState): GameEvent[] {
    const events: GameEvent[] = [];
    events.push(...holdUntil(game, 'R', (g) => g.run.player.hasBlaster));
    events.push(...hold(game, 'F'));
    events.push(...holdUntil(game, '', (g) => !enemyOf(g, 0).alive, 120));
    events.push(...holdUntil(game, 'R', (g) => g.run.phase !== 'playing'));
    return events;
  }

  it('crystal 10, cog 100, Arc Moth 100, Cinderpeg 50, level clear 200, each life left at the win 500', () => {
    const game = armed([MOTH_LEVEL, PEG_LEVEL]);

    const first = clearLevel(game);
    expect(game.run.phase).toBe('exiting');
    expect(only(first, 'enemyKilled').map((e) => [e.kind, e.score])).toEqual([['moth', 100]]);
    expect(game.session.score).toBe(10 + 100 + 100 + 200);

    hold(game, '', P.exitTicks + P.readyMinTicks);
    const second = clearLevel(game);
    expect(only(second, 'enemyKilled').map((e) => [e.kind, e.score])).toEqual([['cinderpeg', 50]]);
    expect(game.session.score).toBe(410 + 50 + 10 + 100 + 200);

    const won = only(hold(game, '', P.exitTicks), 'gameWon');
    expect(won).toEqual([{ type: 'gameWon', score: 770 + 1500, lives: 3, lifeBonus: 1500 }]);
    expect(game.session.score).toBe(2270);
  });
});

// ---------------------------------------------------------------------------
// Events are a report, not a rule; copies
// ---------------------------------------------------------------------------

describe('the order of a playing tick, through step()', () => {
  /** A Cinderpeg walks toward a hero who stands still on the start cell, facing it. */
  const FACE_OFF = levelFromRows(['............', '.P......C.TD', '############']);

  /**
   * An armed gate opened by FIRE (harmless without the blaster), so the hero
   * has not moved. Then the blaster, once that press has left the fire buffer
   * (a remembered press would otherwise fire the moment the blaster is held).
   */
  function faceOff(): GameState {
    const game = armed([FACE_OFF]);
    expect(types(hold(game, 'F'))).toEqual(['readyEnded']);
    hold(game, '', P.fireBufferTicks + 1);
    expect(game.run.player.fireBuffer).toBe(0);
    game.run.player.hasBlaster = true;
    return game;
  }

  /** How many more ticks of standing still the hero has, counted on a copy. */
  function ticksToDeath(game: GameState): number {
    const copy = cloneGame(game);
    let n = 0;
    while (copy.run.phase === 'playing') {
      step(copy, NONE);
      n += 1;
      if (n > 2000) throw new Error('the Cinderpeg never arrived');
    }
    expect(copy.run.deathCause).toBe('enemy');
    return n;
  }

  it('steps 12 and 13 come before 17: fire pressed on the tick the Cinderpeg would kill destroys it first, and the hero lives', () => {
    const game = faceOff();
    const n = ticksToDeath(game);
    hold(game, '', n - 1);
    expect(game.run.phase).toBe('playing');

    const events = hold(game, 'F');

    expect(types(events)).toEqual(['boltFired', 'enemyKilled', 'boltEnded']);
    expect(game.run.phase).toBe('playing');
    expect(enemyOf(game, 0).alive).toBe(false);
    expect(game.session.score).toBe(P.scoreCinderpeg);
    // Standing still from here on is safe.
    expect(hold(game, '', 200)).toEqual([]);
  });

  it('step 12 comes before 13: the Cinderpeg takes its step on the tick the bolt destroys it, and stays there', () => {
    const game = faceOff();
    const peg = enemyOf(game, 0);
    hold(game, '', 100);
    expect(types(hold(game, 'F'))).toEqual(['boltFired']);

    let pegBefore = peg.x;
    let events: GameEvent[] = [];
    for (let t = 0; t < 60 && peg.alive; t++) {
      pegBefore = peg.x;
      events = hold(game, '');
    }

    expect(types(events)).toEqual(['enemyKilled', 'boltEnded']);
    expect(peg.x).toBe(pegBefore - P.cinderpegSpeed);
    // The event is reported from where the body is after that step.
    expect(only(events, 'enemyKilled')[0]?.x).toBe(peg.x + (TILE >> 1));
    hold(game, '', 50);
    expect(peg.x).toBe(pegBefore - P.cinderpegSpeed);
  });

  it('step 12 comes before 17: the Cinderpeg kills on the tick its own move brings it into the hero, not a tick later', () => {
    const game = faceOff();
    const p = game.run.player;
    const peg = enemyOf(game, 0);
    const hurtRight = p.x + P.heroW - P.hurtInsetSide;
    const touches = (pegX: number): boolean => pegX + P.enemyTouchInset < hurtRight;

    let pegBefore = peg.x;
    let events: GameEvent[] = [];
    for (let t = 0; t < 2000 && game.run.phase === 'playing'; t++) {
      pegBefore = peg.x;
      events = hold(game, '');
    }

    expect(types(events)).toEqual(['playerDied']);
    // Where the Cinderpeg stood when the tick began it did not touch; where this tick's step moved it, it does.
    expect(touches(pegBefore)).toBe(false);
    expect(touches(peg.x)).toBe(true);
    expect(peg.x).toBe(pegBefore - P.cinderpegSpeed);
  });

  it('the hero moves before the contacts: a crystal is collected on the tick the hero\'s own move first reaches it', () => {
    const game = armed([WALK_A]);
    const crystal = WALK_A.pickups[0];
    if (crystal === undefined) throw new Error('WALK_A has a crystal');
    const reach = crystal.col * TILE - P.pickupOutset;

    let xBefore = game.run.player.x;
    let events: GameEvent[] = [];
    for (let t = 0; t < 200 && game.run.taken[0] !== true; t++) {
      xBefore = game.run.player.x;
      events = hold(game, 'R');
    }

    expect(only(events, 'pickup')).toHaveLength(1);
    expect(xBefore + P.heroW).toBeLessThanOrEqual(reach);
    expect(game.run.player.x + P.heroW).toBeGreaterThan(reach);
  });
});

describe('events are a report only', () => {
  it('a game stepped without an events array goes through exactly the same states as one stepped with it', () => {
    const levels = [WALK_A, WALK_B, BUSY];
    const loud = createSession(levels, P);
    const quiet = createSession(levels, P);
    const next = seeded(20261121);
    const seen = new Set<GameEventType>();

    let letters = '';
    for (let t = 0; t < 6000 && loud.session.status === 'playing'; t++) {
      if (t % 7 === 0) letters = randomLetters(next);
      const events: GameEvent[] = [];
      step(loud, IN(letters), events);
      step(quiet, IN(letters));
      for (const e of events) seen.add(e.type);
      if (t % 10 === 0 || events.length > 0) expect(snapshot(quiet), `tick ${t}`).toEqual(snapshot(loud));
    }
    expect(snapshot(quiet)).toEqual(snapshot(loud));
    // The run was not an idle one: every kind of moment that changes the state was passed through.
    for (const type of [
      'readyEnded',
      'jumped',
      'landed',
      'pickup',
      'trophyCollected',
      'levelCompleted',
      'levelStarted',
      'boltFired',
      'enemyKilled',
      'fuelEmptied',
      'pickupRestored',
      'playerDied',
      'respawned',
      'gameOver',
    ] as const) {
      expect(seen.has(type), type).toBe(true);
    }
  });
});

describe('cloneGame', () => {
  /** A game in the middle of things: items held, a bolt in flight, an enemy dead and paid. */
  function midGame(): GameState {
    const game = armed([BUSY, WALK_A], { score: 5, lives: 2, highestUnlocked: 1 });
    holdUntil(game, 'R', (g) => g.run.hasTrophy);
    hold(game, 'F');
    holdUntil(game, '', (g) => !enemyOf(g, 0).alive, 80);
    hold(game, 'RJ', 4);
    hold(game, 'RTF', 3);
    return game;
  }

  it('copies every value of session and run', () => {
    const game = midGame();
    const clone = cloneGame(game);
    expect(clone.session).toEqual(game.session);
    expect(clone.run).toEqual(game.run);
    expect(clone.run.bolt.active).toBe(true);
  });

  it('shares phys, levels and level, and nothing that changes', () => {
    const game = midGame();
    const clone = cloneGame(game);

    expect(clone.phys).toBe(game.phys);
    expect(clone.levels).toBe(game.levels);
    expect(clone.level).toBe(game.level);

    expect(clone.session).not.toBe(game.session);
    expect(clone.run).not.toBe(game.run);
    expect(clone.run.player).not.toBe(game.run.player);
    expect(clone.run.enemies).not.toBe(game.run.enemies);
    expect(clone.run.enemies[0]).not.toBe(game.run.enemies[0]);
    expect(clone.run.enemyPaid).not.toBe(game.run.enemyPaid);
    expect(clone.run.bolt).not.toBe(game.run.bolt);
    expect(clone.run.taken).not.toBe(game.run.taken);
  });

  it('a clone lives its own life: stepping it leaves the original untouched', () => {
    const game = midGame();
    const before = snapshot(game);
    const clone = cloneGame(game);

    hold(clone, 'R', 400);
    restartLevel(clone);

    expect(snapshot(game)).toEqual(before);
    expect(snapshot(clone)).not.toEqual(before);
  });

  it('a clone fed the same input stays identical to its original, through deaths and a level change', () => {
    const game = createSession([WALK_A, WALK_B, BUSY], P);
    hold(game, '', 5);
    const clone = cloneGame(game);
    const next = seeded(7);
    const seen = new Set<GameEventType>();

    let letters = '';
    for (let t = 0; t < 4000; t++) {
      if (t % 6 === 0) letters = randomLetters(next);
      const events: GameEvent[] = [];
      step(game, IN(letters), events);
      step(clone, IN(letters));
      for (const e of events) seen.add(e.type);
      if (t % 25 === 0 || events.length > 0) expect(snapshot(clone), `tick ${t}`).toEqual(snapshot(game));
    }
    expect(snapshot(clone)).toEqual(snapshot(game));
    expect(clone.level).toBe(game.level);
    // What the name promises did happen.
    for (const type of ['respawned', 'levelStarted', 'enemyKilled', 'pickupRestored'] as const) {
      expect(seen.has(type), type).toBe(true);
    }
  });
});

describe('copyGame', () => {
  /**
   * Gives every number and flag in session and run a value that differs from
   * the one it has, by walking the object: a field added to the state later
   * is covered without touching this test. kind and axis are fixed by the
   * level and are left alone.
   */
  function scramble(value: Record<string, unknown> | unknown[], salt: { n: number }): void {
    const target = value as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      const item = target[key];
      if (key === 'kind' || key === 'axis') continue;
      if (typeof item === 'number') target[key] = item + 1000 + salt.n++;
      else if (typeof item === 'boolean') target[key] = !item;
      else if (typeof item === 'object' && item !== null) scramble(item as Record<string, unknown>, salt);
    }
  }

  /** Every path to a number, flag, string or null in a value. */
  function leaves(value: unknown, path: string, out: Map<string, unknown>): Map<string, unknown> {
    if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) leaves(item, `${path}.${key}`, out);
    } else {
      out.set(path, value);
    }
    return out;
  }

  /** A game in which no field of session or run has the value a fresh game has. */
  function scrambled(): GameState {
    const game = createSession([BUSY, WALK_A], P);
    scramble(game.session as unknown as Record<string, unknown>, { n: 1 });
    scramble(game.run as unknown as Record<string, unknown>, { n: 100 });
    game.session.status = 'won';
    game.run.phase = 'dying';
    game.run.deathCause = 'coolant';
    game.run.player.facing = -1;
    game.run.bolt.dir = -1;
    enemyOf(game, 0).dir = 1;
    return game;
  }

  it('the scrambled fixture differs from a fresh game in every field (so the next test proves something)', () => {
    const fresh = createSession([BUSY, WALK_A], P);
    const other = scrambled();
    const a = leaves({ session: fresh.session, run: fresh.run }, 'game', new Map());
    const b = leaves({ session: other.session, run: other.run }, 'game', new Map());

    expect([...b.keys()]).toEqual([...a.keys()]);
    const same = [...a.keys()].filter((path) => a.get(path) === b.get(path));
    expect(same).toEqual(['game.run.enemies.0.kind']);
  });

  it('copies every mutable field of session and run', () => {
    const source = scrambled();
    const target = createSession([BUSY, WALK_A], P);

    copyGame(target, source);

    expect(target.session).toEqual(source.session);
    expect(target.run).toEqual(source.run);
  });

  it('writes into the objects the target already has: nothing is replaced, nothing is shared with the source', () => {
    const source = scrambled();
    const target = createSession([BUSY, WALK_A], P);
    const { session, run } = target;
    const { player, enemies, enemyPaid, bolt, taken } = run;
    const enemy = enemies[0];

    copyGame(target, source);

    expect(target.session).toBe(session);
    expect(target.run).toBe(run);
    expect(run.player).toBe(player);
    expect(run.enemies).toBe(enemies);
    expect(run.enemies[0]).toBe(enemy);
    expect(run.enemyPaid).toBe(enemyPaid);
    expect(run.bolt).toBe(bolt);
    expect(run.taken).toBe(taken);
    expect(run.player).not.toBe(source.run.player);
    expect(run.enemies[0]).not.toBe(source.run.enemies[0]);
  });

  it('leaves the source untouched', () => {
    const source = scrambled();
    const before = snapshot(source);
    copyGame(createSession([BUSY, WALK_A], P), source);
    expect(snapshot(source)).toEqual(before);
  });

  it('a state copied back into a clone plays on exactly as the original does (the way the validator rewinds)', () => {
    const game = armed([BUSY]);
    holdUntil(game, 'R', (g) => g.run.player.hasThruster);
    const saved = cloneGame(game);
    const scratch = cloneGame(game);

    // Play the scratch copy somewhere else entirely, then rewind it.
    hold(scratch, 'LJT', 300);
    expect(snapshot(scratch)).not.toEqual(snapshot(saved));
    copyGame(scratch, saved);
    expect(snapshot(scratch)).toEqual(snapshot(saved));

    const next = seeded(99);
    let letters = '';
    for (let t = 0; t < 1500; t++) {
      if (t % 5 === 0) letters = randomLetters(next);
      step(game, IN(letters));
      step(scratch, IN(letters));
    }
    expect(snapshot(scratch)).toEqual(snapshot(game));
  });

  it('even between two different levels the target ends as an exact copy', () => {
    const source = armed([BUSY, WALK_B]);
    holdUntil(source, 'R', (g) => g.run.taken[0] === true);
    const target = createSession([BUSY, WALK_B], P, { levelIndex: 1 });

    copyGame(target, source);

    expect(target.level).toBe(BUSY);
    expect(snapshot(target)).toEqual(snapshot(source));
    expect(target.run).not.toBe(source.run);
    expect(target.run.player).not.toBe(source.run.player);
  });
});

// ---------------------------------------------------------------------------
// Other tunings
// ---------------------------------------------------------------------------

describe('the phase lengths come from Phys, not from the reference numbers', () => {
  it('a tuning with other timings moves every wait with it', () => {
    const phys = referencePhysWith({
      timing: { hitStopFrames: 1, deathAnimFrames: 2, fadeFrames: 3, readyMinFrames: 4, exitFrames: 5 },
    });
    expect([phys.dyingTicks, phys.respawnReadyTicks, phys.readyMinTicks, phys.exitTicks]).toEqual([6, 7, 4, 5]);

    // Level start: 4 ticks of minimum. A press on tick 4 is held into tick 5, which opens the gate.
    const game = createSession([SPIKE_WALK, WALK_A], phys);
    stepTicks(step, game, NONE, 3);
    stepTicks(step, game, 'R', 1);
    expect(game.run.phase).toBe('ready');
    stepTicks(step, game, 'R', 1);
    expect(game.run.phase).toBe('playing');
    expect(game.run.tick).toBe(5);

    // Death: 6 ticks of dying, 7 of ready.
    while (game.run.phase === 'playing' && game.run.tick < 200) step(game, IN('R'));
    expect(game.run.phase).toBe('dying');
    stepTicks(step, game, NONE, 5);
    expect(game.run.phase).toBe('dying');
    stepTicks(step, game, NONE, 1);
    expect(game.run.phase).toBe('ready');
    expect(game.run.phaseLength).toBe(7);
    // One idle tick arms the gate; a press held from then on opens it on the first tick after the 7.
    stepTicks(step, game, NONE, 1);
    stepTicks(step, game, 'L', 6);
    expect(game.run.phase).toBe('ready');
    stepTicks(step, game, 'L', 1);
    expect(game.run.phase).toBe('playing');

    // Exit: 5 ticks.
    startLevel(game, 1);
    stepTicks(step, game, NONE, 4);
    while (game.run.phase !== 'exiting' && game.run.tick < 300) step(game, IN('R'));
    expect(game.run.phase).toBe('exiting');
    stepTicks(step, game, NONE, 4);
    expect(game.session.status).toBe('playing');
    stepTicks(step, game, NONE, 1);
    expect(game.session.status).toBe('won');
  });

  it('on DISTINCT_PHYS, where no two fields are equal: lives start at startLives, waits are readyMinTicks, dyingTicks and respawnReadyTicks, and the win pays scoreLifeLeft per life', () => {
    // At the reference numbers startLives = maxLives (3), so a session that started with maxLives would pass the tests above.
    const D = DISTINCT_PHYS;
    const game = createSession([SPIKE_WALK, WALK_A], D);
    expect(game.session.lives).toBe(D.startLives);
    expect(game.run.phaseLength).toBe(D.readyMinTicks);

    stepTicks(step, game, NONE, D.readyMinTicks);
    while (game.run.phase !== 'dying' && game.run.tick < 300) step(game, IN('R'));
    const deathTick = game.run.tick;
    while (game.run.phase === 'dying') step(game, NONE);
    expect(game.run.tick - deathTick).toBe(D.dyingTicks);
    expect(game.run.phaseLength).toBe(D.respawnReadyTicks);
    expect(game.session.lives).toBe(D.startLives - 1);

    // The last level: exitTicks of exiting, then scoreLifeLeft for each life, the one the clear gave back included.
    startLevel(game, 1);
    stepTicks(step, game, NONE, D.readyMinTicks);
    holdUntil(game, 'R', isExiting);
    const exitTick = game.run.tick;
    const won = only(holdUntil(game, '', (g) => g.session.status === 'won'), 'gameWon');
    expect(game.run.tick - exitTick).toBe(D.exitTicks);
    const lives = D.startLives - 1 + D.livesPerLevelClear;
    expect(won).toEqual([{ type: 'gameWon', score: game.session.score, lives, lifeBonus: lives * D.scoreLifeLeft }]);
  });

  it('with every wait at 0 the game still runs: a death respawns on the next tick, a clear loads on the next tick', () => {
    const phys = referencePhysWith({
      timing: { hitStopFrames: 0, deathAnimFrames: 0, fadeFrames: 0, readyMinFrames: 0, exitFrames: 0 },
    });
    const game = createSession([SPIKE_WALK, WALK_A, WALK_B], phys);
    const events: GameEvent[] = [];

    // No minimum: arm on tick 1, open on tick 2.
    stepTicks(step, game, NONE, 1, events);
    stepTicks(step, game, 'R', 1, events);
    expect(types(events)).toEqual(['readyEnded']);

    while (game.run.phase === 'playing' && game.run.tick < 200) step(game, IN('R'), events);
    expect(types(events).at(-1)).toBe('playerDied');
    stepTicks(step, game, NONE, 1, events);
    expect(types(events).at(-1)).toBe('respawned');
    // Still a press gate: RIGHT held from before stays shut; lifted for one tick, then pressed, it opens.
    stepTicks(step, game, 'R', 3, events);
    expect(types(events).at(-1)).toBe('respawned');
    stepTicks(step, game, NONE, 1, events);
    stepTicks(step, game, 'R', 1, events);
    expect(types(events).at(-1)).toBe('readyEnded');

    // A clear: the next level is loaded on the tick after the hero enters the airlock.
    startLevel(game, 1, events);
    stepTicks(step, game, NONE, 1, events);
    while (game.run.phase !== 'exiting' && game.run.tick < 300) step(game, IN('R'), events);
    expect(types(events).at(-1)).toBe('levelCompleted');
    stepTicks(step, game, NONE, 1, events);
    expect(events.at(-1)).toEqual({ type: 'levelStarted', levelIndex: 2, score: game.session.score, lives: 3 });
    expect(game.level).toBe(WALK_B);
  });
});

it('the test rooms are what the comments say (indices used above)', () => {
  expect(BUSY.pickups.map((p) => p.kind)).toEqual(['crystal', 'blaster', 'thruster']);
  expect(BUSY.enemies.map((e) => e.kind)).toEqual(['cinderpeg']);
  expect(HALL.enemies.map((e) => e.kind)).toEqual(['moth']);
  expect(sub(1)).toBe(256);
});
