import { describe, expect, it } from 'vitest';

import { cloneGame, copyGame, createSession, holdReady, restartLevel, step } from './game';
import { inputFromBits } from './script';
import { levelFromRows, REFERENCE_PHYS, referencePhysWith } from './testkit';
import type { GameEvent, GameState, LevelData } from './types';

/**
 * docs/ARCHITECTURE.md, section 12: the same script twice gives the same
 * state; a cloneGame copy tracks its original; copyGame forgets no field
 * (readyArmed included); the state stays integral; and a golden hash of a
 * long seeded run pins the whole rule set, so that an unintended change
 * anywhere in the core shows up here.
 *
 * The rooms are fixtures of this file, not files of levels/, so that editing
 * a level never moves the golden hash. Between them they hold every tile,
 * item and enemy, and a seeded random thumb reaches deaths, empty tanks,
 * kills, the cog, the airlock, a level change and a game over.
 */

/** A corridor of pickups: a random thumb walks it to the airlock often. */
const ROOM_A = levelFromRows(['##############', '#............#', '#P.G.B.J.G.TD#', '##############'], { id: 'room-a' });

/**
 * Everything at once: a blaster and a pack over a coolant pool, a Cinderpeg
 * under a low roof that only a bolt gets past, spikes, an Arc Moth bobbing
 * between them and the fire, another sweeping the top row.
 */
const ROOM_B = levelFromRows(
  [
    '######################',
    '#.....H..............#',
    '#..G.........M.......#',
    '#.......###..........#',
    '#P.B.J.C....S..F..GTD#',
    '#####WW###############',
    '######################',
  ],
  { id: 'room-b' },
);

/** A short last level, so that some sessions are won. */
const ROOM_C = levelFromRows(['###########', '#.........#', '#P..G..T.D#', '###########'], { id: 'room-c' });

const LEVELS: readonly LevelData[] = [ROOM_A, ROOM_B, ROOM_C];

/** The reference rules with lives enough that one session lasts through a long random run. */
const MANY_LIVES = referencePhysWith({ lives: { startLives: 999, maxLives: 999 } });

/** A seeded random number from 0 to 65535: a linear congruential generator read from its high bits (its low bits repeat quickly). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 16;
  };
}

/** A seeded thumb: the buttons held on each tick, packed as InputBit flags, held for a while and changed now and then. */
function thumb(seed: number): () => number {
  const next = lcg(seed);
  let bits = 0;
  return () => {
    const roll = next() % 100;
    if (roll < 6) bits = next() % 32;
    else if (roll < 12) bits = (next() % 2 === 0 ? 1 : 2) | (next() % 2 === 0 ? 4 : 0) | (next() % 3 === 0 ? 16 : 0);
    else if (roll < 16) bits ^= 4;
    else if (roll < 19) bits ^= 16;
    else if (roll < 22) bits ^= 8;
    else if (roll < 24) bits = 0;
    return bits;
  };
}

/** Everything mutable in a game, as text with sorted keys, plus the identity of the shared parts. */
function snapshot(game: GameState): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, sorted(v)]));
    }
    return value;
  };
  return JSON.stringify({ level: game.level.id, session: sorted(game.session), run: sorted(game.run) });
}

/** 32-bit FNV-1a of a text, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Plays `ticks` ticks of the seeded thumb. Whenever a session ends (game over
 * or won) a new one starts, on room A, B or C in turn, so that the run sees
 * level changes, game overs and wins. Now and then the pause menu is used, at
 * ticks drawn from a second generator. `onTick` sees the game after every tick.
 */
function play(
  seed: number,
  ticks: number,
  onTick: (game: GameState, events: readonly GameEvent[], tick: number) => void = () => undefined,
  withEvents = true,
): { game: GameState; log: string[] } {
  const press = thumb(seed);
  const menu = lcg(seed ^ 0x5bd1e995);
  const events: GameEvent[] = [];
  const sink = withEvents ? events : undefined;
  let sessions = 0;
  let game = createSession(LEVELS, REFERENCE_PHYS, {}, sink);
  const log: string[] = [];
  for (let t = 0; t < ticks; t++) {
    if (game.session.status !== 'playing') {
      sessions++;
      game = createSession(LEVELS, REFERENCE_PHYS, { levelIndex: sessions % LEVELS.length }, sink);
    }
    const roll = menu() % 1000;
    if (roll === 0) restartLevel(game, sink);
    else if (roll === 1) holdReady(game);
    step(game, inputFromBits(press()), sink);
    for (const e of events) log.push(`${game.run.tick} ${JSON.stringify(e)}`);
    onTick(game, events, t);
    events.length = 0;
  }
  return { game, log };
}

describe('the same script twice gives the same game', () => {
  it('two sessions fed the same 30 000 ticks agree after every tick, in state and in events', () => {
    const first: string[] = [];
    play(7, 30_000, (game, events) => first.push(snapshot(game) + JSON.stringify(events)));
    let i = 0;
    let mismatch = -1;
    play(7, 30_000, (game, events) => {
      if (mismatch < 0 && first[i] !== snapshot(game) + JSON.stringify(events)) mismatch = i;
      i++;
    });
    expect(mismatch).toBe(-1);
  });

  it('the seeded thumb reaches every kind of event, so the runs above and below cover the whole step order', () => {
    const seen = new Set<string>();
    for (const seed of [7, 11, 2026]) {
      play(seed, 30_000, (_game, events) => {
        for (const e of events) seen.add(e.type);
      });
    }
    const expected: GameEvent['type'][] = [
      'readyEnded',
      'jumped',
      'landed',
      'bonked',
      'thrustStarted',
      'thrustStopped',
      'fuelEmptied',
      'pickup',
      'pickupRestored',
      'trophyCollected',
      'doorOpened',
      'boltFired',
      'boltEnded',
      'enemyKilled',
      'playerDied',
      'respawned',
      'levelCompleted',
      'levelStarted',
      'gameOver',
      'gameWon',
    ];
    expect(expected.filter((type) => !seen.has(type))).toEqual([]);
  });

  it('step() decides nothing differently when no events array is passed', () => {
    const states: string[] = [];
    play(11, 20_000, (game, _events, t) => {
      if (t % 50 === 0) states.push(snapshot(game));
    });
    let i = 0;
    let mismatch = -1;
    play(
      11,
      20_000,
      (game, _events, t) => {
        if (t % 50 !== 0) return;
        if (mismatch < 0 && states[i] !== snapshot(game)) mismatch = t;
        i++;
      },
      false,
    );
    expect(mismatch).toBe(-1);
  });
});

describe('cloneGame and copyGame', () => {
  it('a cloneGame copy tracks its original over 20 000 random ticks, clone and original stepped side by side', () => {
    const original = createSession(LEVELS, MANY_LIVES);
    const press = thumb(31);
    for (let t = 0; t < 500; t++) step(original, inputFromBits(press()));
    const copy = cloneGame(original);
    let mismatch = -1;
    for (let t = 0; t < 20_000 && mismatch < 0; t++) {
      const input = inputFromBits(press());
      step(original, input);
      step(copy, input);
      if (snapshot(copy) !== snapshot(original)) mismatch = t;
    }
    expect(mismatch).toBe(-1);
    expect(original.session.status).toBe('playing');
  });

  it('cloneGame shares phys, levels and level, and nothing mutable', () => {
    const original = createSession(LEVELS, REFERENCE_PHYS);
    const copy = cloneGame(original);
    expect(copy.phys).toBe(original.phys);
    expect(copy.levels).toBe(original.levels);
    expect(copy.level).toBe(original.level);
    const mutable = (game: GameState): object[] => [
      game.session,
      game.run,
      game.run.player,
      game.run.enemies,
      ...game.run.enemies,
      game.run.enemyPaid,
      game.run.bolt,
      game.run.taken,
    ];
    const theirs = new Set(mutable(original));
    expect(mutable(copy).filter((object) => theirs.has(object))).toEqual([]);
  });

  it('copyGame carries a change of every single field of the state, readyArmed included', () => {
    // A state in the middle of play, with enemies, a bolt slot and pickups.
    const base = createSession([ROOM_B], REFERENCE_PHYS);
    const press = thumb(5);
    for (let t = 0; t < 300; t++) step(base, inputFromBits(press()));

    // Every leaf of session and run, by path; kind and axis belong to the level and are shared by both sides.
    const leaves: string[][] = [];
    const walk = (value: unknown, path: string[]): void => {
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, [...path, key]);
      } else if (path.at(-1) !== 'kind' && path.at(-1) !== 'axis') {
        leaves.push(path);
      }
    };
    walk({ session: base.session, run: base.run }, []);
    expect(leaves.length).toBe(52);
    expect(leaves.map((p) => p.join('.'))).toContain('run.readyArmed');

    const forgotten: string[] = [];
    for (const path of leaves) {
      const source = cloneGame(base);
      const target = cloneGame(base);
      // Change the one leaf in the source to another value of its kind.
      let holder = { session: source.session, run: source.run } as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1)) holder = holder[key] as Record<string, unknown>;
      const key = path.at(-1) ?? '';
      const value = holder[key];
      if (typeof value === 'boolean') holder[key] = !value;
      else if (typeof value === 'number') holder[key] = key === 'dir' || key === 'facing' ? -value : value + 1;
      else if (key === 'phase') holder[key] = value === 'playing' ? 'ready' : 'playing';
      else if (key === 'status') holder[key] = value === 'playing' ? 'won' : 'playing';
      else if (key === 'deathCause') holder[key] = value === null ? 'fell' : null;
      else holder[key] = `${String(value)}?`;
      copyGame(target, source);
      if (snapshot(target) !== snapshot(source)) forgotten.push(path.join('.'));
    }
    expect(forgotten).toEqual([]);
  });

  it('copyGame over a stale copy makes it the same game again, at any moment of 20 000 random ticks', () => {
    const game = createSession(LEVELS, MANY_LIVES);
    const press = thumb(99);
    // Stale copies of earlier moments, overwritten in turn.
    const stale = [cloneGame(game), cloneGame(game), cloneGame(game)];
    let mismatch = -1;
    let copies = 0;
    for (let t = 0; t < 20_000 && mismatch < 0; t++) {
      step(game, inputFromBits(press()));
      const target = stale[t % 3];
      if (target === undefined || t % 97 !== 0) continue;
      // copyGame is defined for two states of the same level; a level change replaces game.level.
      if (target.level !== game.level) {
        stale[t % 3] = cloneGame(game);
        continue;
      }
      copyGame(target, game);
      copies++;
      if (snapshot(target) !== snapshot(game)) mismatch = t;
      // The overwritten copy then keeps in step with the original.
      const input = inputFromBits(press());
      step(game, input);
      step(target, input);
      if (snapshot(target) !== snapshot(game)) mismatch = t;
    }
    expect(mismatch).toBe(-1);
    expect(copies).toBeGreaterThan(100);
    expect(game.session.status).toBe('playing');
  });

  it('copyGame allocates nothing: the target keeps its own objects and arrays', () => {
    const game = createSession([ROOM_A], REFERENCE_PHYS);
    const target = cloneGame(game);
    const before = [target.session, target.run, target.run.player, target.run.enemies, target.run.bolt, target.run.taken];
    const press = thumb(3);
    for (let t = 0; t < 200; t++) step(game, inputFromBits(press()));
    copyGame(target, game);
    expect(snapshot(target)).toBe(snapshot(game));
    before.forEach((object, i) => {
      expect([target.session, target.run, target.run.player, target.run.enemies, target.run.bolt, target.run.taken][i]).toBe(object);
    });
  });

  it('the ready gate is copied: a copy of an armed gate opens on the same press as its original', () => {
    const game = createSession([ROOM_A], REFERENCE_PHYS);
    for (let t = 0; t < REFERENCE_PHYS.readyMinTicks; t++) step(game, inputFromBits(0));
    expect(game.run.readyArmed).toBe(true);
    // A stale copy from before the gate was armed.
    const fresh = createSession([ROOM_A], REFERENCE_PHYS);
    const target = cloneGame(fresh);
    expect(target.run.readyArmed).toBe(false);
    copyGame(target, game);
    const press = inputFromBits(2);
    step(game, press);
    step(target, press);
    expect([game.run.phase, target.run.phase]).toEqual(['playing', 'playing']);
  });
});

describe('integers only', () => {
  it('every number in the state is a whole number within the safe range after every tick of 40 000 random ticks', () => {
    const bad: string[] = [];
    const check = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) bad.push(`${path} = ${value}`);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          check(v, `${path}[${i}]`);
        });
      } else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) check(v, `${path}.${k}`);
      }
    };
    for (const seed of [1, 2]) {
      play(seed, 20_000, (game, events, t) => {
        if (bad.length > 0) return;
        check(game.session, 'session');
        check(game.run, 'run');
        for (const e of events) check(e, `event ${e.type}`);
        if (bad.length > 0) bad.push(`(seed ${seed}, tick ${t})`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('every Phys field is an integer', () => {
    const fractional = Object.entries(REFERENCE_PHYS).filter(([, v]) => !Number.isSafeInteger(v));
    expect(fractional).toEqual([]);
  });
});

describe('golden end state', () => {
  it('a seeded 60 000-tick run through all three rooms ends in exactly the same state, with exactly the same events, as when it was recorded', () => {
    const { game, log } = play(2026, 60_000);
    // A change here means a rule changed somewhere in the core: find out which and why before recording new values.
    expect({
      state: fnv1a(snapshot(game)),
      events: fnv1a(log.join('\n')),
      count: log.length,
      status: game.session.status,
    }).toEqual(GOLDEN);
  });
});

/**
 * Recorded from this core on REFERENCE_PHYS. The same 60 000 ticks were also
 * played on an independent model of the rules (a throwaway written from
 * docs/ARCHITECTURE.md alone), which agreed on the whole state and the event
 * types after every tick: 40 sessions, 9 of them won.
 */
const GOLDEN = { state: 'bac64daf', events: '247e0897', count: 8872, status: 'playing' };
