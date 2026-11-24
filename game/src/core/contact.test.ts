import { describe, expect, it } from 'vitest';

import { resolveContacts } from './contact';
import { step } from './game';
import { DISTINCT_PHYS, IN, NONE, REFERENCE_PHYS, levelFromRows, playingGame, referencePhysWith, stepTicks, sub } from './testkit';
import { TILE } from './types';
import type { DeathCause, EnemyState, GameEvent, GameState, LevelData, Phys } from './types';

/**
 * Steps 14 to 17 of the tick against docs/ARCHITECTURE.md, sections 5.4, 5.5
 * and 6, on the reference numbers: pickups, the golden cog, the airlock,
 * deaths, and who wins when two of them happen on one tick.
 *
 * Most tests put the hero's box somewhere by hand and call resolveContacts
 * once: contacts read nothing but positions, so this is exact to the
 * sub-pixel and needs no run-up. The tests marked "in play" go through the
 * whole step().
 */

const P = REFERENCE_PHYS;

/** Steps 14 to 17 once; returns that call's events. */
function touch(game: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  resolveContacts(game, events);
  return events;
}

/** One whole tick with the named buttons held (L R J F T); returns that tick's events. */
function tick(game: GameState, letters = ''): GameEvent[] {
  const events: GameEvent[] = [];
  step(game, IN(letters), events);
  return events;
}

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Puts the top-left corner of the hero's box at (x, y) sub-pixels, at rest. */
function putHero(game: GameState, x: number, y: number): void {
  const p = game.run.player;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
}

/** The hero in a cell the way a level start places it: centred, feet on the cell's bottom edge. */
function standIn(game: GameState, col: number, row: number, phys: Phys = P): void {
  putHero(game, col * TILE + ((TILE - phys.heroW) >> 1), (row + 1) * TILE - phys.heroH);
}

function enemyOf(game: GameState, index: number): EnemyState {
  const enemy = game.run.enemies[index];
  if (enemy === undefined) throw new Error(`the level has no enemy ${index}`);
  return enemy;
}

/** A box in sub-pixels, [left, right) by [top, bottom). */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Section 5.1 in one line, written independently of contact.ts: each starts before the other ends, on both axes. */
function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function cellBox(col: number, row: number): Box {
  return { left: col * TILE, top: row * TILE, right: (col + 1) * TILE, bottom: (row + 1) * TILE };
}

const CENTRE = TILE >> 1;

// ---------------------------------------------------------------------------
// Step 14: pickups
// ---------------------------------------------------------------------------

/** One crystal (pickup 0) at col 4, row 3, with open air on every side. */
const CRYSTAL_ROOM = levelFromRows([
  '..........',
  '..........',
  '..........',
  '....G.....',
  '..........',
  '..........',
  '.P......TD',
  '##########',
]);
const CRYSTAL = cellBox(4, 3);

/** Pickups in reading order: blaster 0, thruster 1, crystal 2, thruster 3, crystal 4. */
const ITEM_ROOM = levelFromRows([
  '............',
  '.B.J.G.JG...',
  '............',
  '.P........TD',
  '############',
]);

describe('step 14: the pickup box', () => {
  it('the reference outset is 2 px', () => {
    expect(P.pickupOutset).toBe(sub(2));
  });

  const o = P.pickupOutset;
  const midX = CRYSTAL.left + sub(3);
  const midY = CRYSTAL.top + sub(1);
  const sides: readonly (readonly [side: string, x: number, y: number, dx: number, dy: number])[] = [
    ['left of it', CRYSTAL.left - o - P.heroW, midY, 1, 0],
    ['right of it', CRYSTAL.right + o, midY, -1, 0],
    ['above it', midX, CRYSTAL.top - o - P.heroH, 0, 1],
    ['below it', midX, CRYSTAL.bottom + o, 0, -1],
  ];
  for (const [side, x, y, dx, dy] of sides) {
    it(`a crystal is collected from pickupOutset outside its tile and not from one sub-pixel further: hero ${side}`, () => {
      const game = playingGame(CRYSTAL_ROOM);

      // The body just touches the grown box: half-open boxes that only touch do not overlap.
      putHero(game, x, y);
      expect(touch(game)).toEqual([]);
      expect(game.run.taken).toEqual([false]);

      // One sub-pixel closer.
      putHero(game, x + dx, y + dy);
      expect(types(touch(game))).toEqual(['pickup']);
      expect(game.run.taken).toEqual([true]);
    });
  }

  it('at a corner of the box both axes must overlap: one alone collects nothing', () => {
    const game = playingGame(CRYSTAL_ROOM);
    const cornerX = CRYSTAL.left - o - P.heroW;
    const cornerY = CRYSTAL.top - o - P.heroH;

    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      putHero(game, cornerX + dx, cornerY + dy);
      expect(touch(game), `shift ${dx},${dy}`).toEqual([]);
    }
    putHero(game, cornerX + 1, cornerY + 1);
    expect(types(touch(game))).toEqual(['pickup']);
  });

  it('collects exactly when the body overlaps the cell grown by the outset, for outsets of 0, 2, 5 and 20 px (every position around all four edges)', () => {
    // Offsets, in sub-pixels, around the two positions on each axis where the answer flips.
    const near = [-300, -2, -1, 0, 1, 2, 300];
    let checked = 0;
    for (const outsetPx of [0, 2, 5, 20]) {
      const phys = referencePhysWith({ forgiveness: { pickupOutsetPx: outsetPx } });
      const game = playingGame(CRYSTAL_ROOM, phys);
      const grown: Box = {
        left: CRYSTAL.left - phys.pickupOutset,
        top: CRYSTAL.top - phys.pickupOutset,
        right: CRYSTAL.right + phys.pickupOutset,
        bottom: CRYSTAL.bottom + phys.pickupOutset,
      };
      const xs = [...near.map((d) => grown.left - phys.heroW + d), ...near.map((d) => grown.right + d), CRYSTAL.left];
      const ys = [...near.map((d) => grown.top - phys.heroH + d), ...near.map((d) => grown.bottom + d), CRYSTAL.top];
      for (const x of xs) {
        for (const y of ys) {
          game.run.taken[0] = false;
          putHero(game, x, y);
          resolveContacts(game);
          const body: Box = { left: x, top: y, right: x + phys.heroW, bottom: y + phys.heroH };
          expect(game.run.taken[0], `outset ${outsetPx} px, hero at ${x},${y}`).toBe(overlap(body, grown));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(4 * 15 * 15);
  });

  it('a pickup is never collected through a wall: the outset is far smaller than a tile', () => {
    // The crystal sits right behind a wall one tile thick; the hero presses against that wall from the other side.
    const level = levelFromRows(['####....', '#.G#P.TD', '########']);
    const game = playingGame(level);
    stepTicks(step, game, 'L', 60);
    expect(game.run.player.x).toBe(4 * TILE);
    expect(game.run.taken).toEqual([false]);
    expect(game.session.score).toBe(0);
  });
});

describe('step 14: what a pickup gives', () => {
  it('a crystal adds scoreCrystal (10) and reports its cell centre, its index and the points', () => {
    const game = playingGame(CRYSTAL_ROOM);
    standIn(game, 4, 3);

    expect(touch(game)).toEqual([
      { type: 'pickup', kind: 'crystal', index: 0, x: 4 * TILE + CENTRE, y: 3 * TILE + CENTRE, score: 10 },
    ]);
    expect(game.session.score).toBe(P.scoreCrystal);
    expect(game.run.taken).toEqual([true]);
  });

  it('a taken crystal is gone: standing in its cell again gives nothing', () => {
    const game = playingGame(CRYSTAL_ROOM);
    standIn(game, 4, 3);
    touch(game);

    expect(touch(game)).toEqual([]);
    expect(game.session.score).toBe(10);
  });

  it('the blaster is handed over for no points', () => {
    const game = playingGame(ITEM_ROOM);
    standIn(game, 1, 1);

    expect(touch(game)).toEqual([
      { type: 'pickup', kind: 'blaster', index: 0, x: TILE + CENTRE, y: TILE + CENTRE, score: 0 },
    ]);
    expect(game.run.player.hasBlaster).toBe(true);
    expect(game.run.player.hasThruster).toBe(false);
    expect(game.session.score).toBe(0);
    expect(game.run.taken).toEqual([true, false, false, false, false]);
  });

  it('a thruster pack gives the pack and a full tank (fuelTicks: 80) for no points', () => {
    const game = playingGame(ITEM_ROOM);
    standIn(game, 3, 1);

    expect(touch(game)).toEqual([
      { type: 'pickup', kind: 'thruster', index: 1, x: 3 * TILE + CENTRE, y: TILE + CENTRE, score: 0 },
    ]);
    expect(game.run.player.hasThruster).toBe(true);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
    expect(P.fuelTicks).toBe(80);
    expect(game.run.player.hasBlaster).toBe(false);
    expect(game.session.score).toBe(0);
  });

  it('a second pack refills a part-used tank', () => {
    const game = playingGame(ITEM_ROOM);
    game.run.player.hasThruster = true;
    game.run.player.fuel = 13;
    standIn(game, 7, 1);

    expect(types(touch(game))).toEqual(['pickup']);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
    expect(game.run.taken[3]).toBe(true);
  });

  it('a pack is always consumed, also when the tank is already full', () => {
    const game = playingGame(ITEM_ROOM);
    game.run.player.hasThruster = true;
    game.run.player.fuel = P.fuelTicks;
    standIn(game, 7, 1);

    expect(touch(game)).toEqual([
      { type: 'pickup', kind: 'thruster', index: 3, x: 7 * TILE + CENTRE, y: TILE + CENTRE, score: 0 },
    ]);
    expect(game.run.taken[3]).toBe(true);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
  });

  it('several pickups touched on one tick are collected in index order', () => {
    const game = playingGame(ITEM_ROOM);
    // Straddling the pack at col 7 and the crystal at col 8.
    putHero(game, 8 * TILE - (P.heroW >> 1), TILE + sub(1));

    const events = touch(game);
    expect(events.map((e) => (e.type === 'pickup' ? `${e.index}:${e.kind}:${e.score}` : e.type))).toEqual([
      '3:thruster:0',
      '4:crystal:10',
    ]);
    expect(game.run.taken).toEqual([false, false, false, true, true]);
    expect(game.session.score).toBe(10);
  });

  it('a crystal and the cog touched on one tick: step 14 before step 15, so pickup is reported before trophyCollected and doorOpened', () => {
    const level = levelFromRows(['PGT..', '#####', 'D....']);
    const game = playingGame(level);
    // The body straddles the line between the crystal's cell (col 1) and the cog's (col 2).
    putHero(game, 2 * TILE - sub(5), TILE - P.heroH);

    expect(types(touch(game))).toEqual(['pickup', 'trophyCollected', 'doorOpened']);
    expect(game.session.score).toBe(P.scoreCrystal + P.scoreCog);
    expect(game.run.taken).toEqual([true]);
    expect(game.run.hasTrophy).toBe(true);
  });

  it('without an events array the same things happen', () => {
    const game = playingGame(ITEM_ROOM);
    putHero(game, 8 * TILE - (P.heroW >> 1), TILE + sub(1));
    resolveContacts(game);

    expect(game.run.taken).toEqual([false, false, false, true, true]);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
    expect(game.session.score).toBe(10);
  });
});

describe('thruster packs come back when the tank runs dry (in play)', () => {
  /** A corridor one tile high: thrust presses the hero against the ceiling, so he stays where he is. */
  const CORRIDOR = levelFromRows(['#########', 'PJ.....TD', '#########']);

  it('a pack taken in play fills the tank; burning it dry puts the pack back in its cell', () => {
    // Twelve tiles of open sky: a full tank climbs less than nine.
    const level = levelFromRows([
      ...Array.from({ length: 12 }, () => '..............'),
      'PJ..........TD',
      '##############',
    ]);
    const game = playingGame(level);

    // Walk into the pack.
    let events: GameEvent[] = [];
    for (let t = 0; t < 20 && !game.run.player.hasThruster; t++) events = tick(game, 'R');
    expect(types(events)).toEqual(['pickup']);
    expect(game.run.taken).toEqual([true]);
    expect(game.run.player.fuel).toBe(P.fuelTicks);

    // Fly up and to the right, away from the pack's cell, until the tank is empty.
    for (let t = 1; t < P.fuelTicks; t++) {
      tick(game, 'RT');
      expect(game.run.taken, `burning tick ${t}`).toEqual([true]);
    }
    expect(game.run.player.fuel).toBe(1);
    // fuelEmptied is reported from where the hero is when the engine dies, before this tick's move.
    const centreX = game.run.player.x + (P.heroW >> 1);
    const centreY = game.run.player.y + (P.heroH >> 1);
    events = tick(game, 'RT');
    expect(game.run.player.fuel).toBe(0);
    expect(events).toEqual([
      { type: 'fuelEmptied', x: centreX, y: centreY },
      { type: 'pickupRestored', kind: 'thruster', index: 0, x: TILE + CENTRE, y: 12 * TILE + CENTRE },
    ]);
    expect(game.run.taken).toEqual([false]);
    // The hero still wears the (empty) pack.
    expect(game.run.player.hasThruster).toBe(true);
  });

  it('a hero still standing in the pack cell when the tank empties takes the returned pack on the same tick (step 8 before step 14)', () => {
    const game = playingGame(CORRIDOR);
    for (let t = 0; t < 20 && !game.run.player.hasThruster; t++) tick(game, 'R');
    expect(game.run.player.hasThruster).toBe(true);

    for (let t = 1; t < P.fuelTicks; t++) tick(game, 'T');
    expect(game.run.player.fuel).toBe(1);
    const events = tick(game, 'T');

    // (The hero also bumps the corridor's ceiling on every tick of thrust; that is not the point here.)
    expect(types(events).filter((type) => type !== 'bonked')).toEqual(['fuelEmptied', 'pickupRestored', 'pickup']);
    expect(game.run.taken).toEqual([true]);
    expect(game.run.player.fuel).toBe(P.fuelTicks);
  });
});

// ---------------------------------------------------------------------------
// Steps 15 and 16: the golden cog and the airlock
// ---------------------------------------------------------------------------

/** The cog at col 4 and the airlock at col 8 on one floor, far enough apart to touch each alone. */
const DOOR_ROOM = levelFromRows(['............', '.P..T...D...', '############']);
const COG = cellBox(4, 1);
const DOOR = cellBox(8, 1);

describe('step 15: the golden cog', () => {
  it('taking the cog adds scoreCog (100), sets hasTrophy and reports trophyCollected, then doorOpened at the door cell', () => {
    const game = playingGame(DOOR_ROOM);
    standIn(game, 4, 1);

    expect(touch(game)).toEqual([
      { type: 'trophyCollected', x: 4 * TILE + CENTRE, y: TILE + CENTRE, score: 100 },
      { type: 'doorOpened', x: 8 * TILE + CENTRE, y: TILE + CENTRE },
    ]);
    expect(game.run.hasTrophy).toBe(true);
    expect(game.session.score).toBe(P.scoreCog);
    expect(game.run.phase).toBe('playing');
  });

  it('the cog is taken once: touching its cell again gives nothing', () => {
    const game = playingGame(DOOR_ROOM);
    standIn(game, 4, 1);
    touch(game);

    expect(touch(game)).toEqual([]);
    expect(game.session.score).toBe(100);
  });

  it('the cog has the same outset as a pickup: taken from pickupOutset outside its tile, not from one sub-pixel further', () => {
    const y = COG.bottom - P.heroH;
    const edges: readonly (readonly [side: string, x: number, dx: number])[] = [
      ['left', COG.left - P.pickupOutset - P.heroW, 1],
      ['right', COG.right + P.pickupOutset, -1],
    ];
    for (const [side, x, dx] of edges) {
      const game = playingGame(DOOR_ROOM);
      putHero(game, x, y);
      expect(touch(game), side).toEqual([]);
      expect(game.run.hasTrophy, side).toBe(false);

      putHero(game, x + dx, y);
      expect(types(touch(game)), side).toEqual(['trophyCollected', 'doorOpened']);
    }

    // From above: a hero falling onto the cog.
    const game = playingGame(DOOR_ROOM);
    putHero(game, COG.left, COG.top - P.pickupOutset - P.heroH);
    expect(touch(game)).toEqual([]);
    putHero(game, COG.left, COG.top - P.pickupOutset - P.heroH + 1);
    expect(game.run.hasTrophy).toBe(false);
    touch(game);
    expect(game.run.hasTrophy).toBe(true);
  });
});

describe('step 16: the airlock', () => {
  it('the door is inert without the cog: a hero standing in it stays in play, tick after tick', () => {
    const game = playingGame(DOOR_ROOM);
    standIn(game, 8, 1);
    game.run.player.onGround = true;

    expect(touch(game)).toEqual([]);
    const events: GameEvent[] = [];
    stepTicks(step, game, NONE, 200, events);
    expect(events).toEqual([]);
    expect(game.run.phase).toBe('playing');
    expect(game.session.score).toBe(0);
    expect(game.session.lives).toBe(P.startLives);
  });

  it('with the cog, the door box is its cell narrowed by doorInsetSide (4 px) on the left and right', () => {
    expect(P.doorInsetSide).toBe(sub(4));
    const y = DOOR.bottom - P.heroH;
    const edges: readonly (readonly [side: string, x: number, dx: number])[] = [
      ['from the left', DOOR.left + P.doorInsetSide - P.heroW, 1],
      ['from the right', DOOR.right - P.doorInsetSide, -1],
    ];
    for (const [side, x, dx] of edges) {
      const game = playingGame(DOOR_ROOM);
      game.run.hasTrophy = true;

      // The body is 4 px inside the cell and only touches the door box.
      putHero(game, x, y);
      expect(touch(game), side).toEqual([]);
      expect(game.run.phase, side).toBe('playing');

      putHero(game, x + dx, y);
      expect(types(touch(game)), side).toEqual(['levelCompleted']);
      expect(game.run.phase, side).toBe('exiting');
    }
  });

  it('the door box is the full height of its cell', () => {
    const x = DOOR.left + P.doorInsetSide;
    const edges: readonly (readonly [side: string, y: number, dy: number])[] = [
      ['from above', DOOR.top - P.heroH, 1],
      ['from below', DOOR.bottom, -1],
    ];
    for (const [side, y, dy] of edges) {
      const game = playingGame(DOOR_ROOM);
      game.run.hasTrophy = true;
      putHero(game, x, y);
      expect(touch(game), side).toEqual([]);
      putHero(game, x, y + dy);
      expect(types(touch(game)), side).toEqual(['levelCompleted']);
    }
  });

  it('entering the open door clears the level: +200, the exiting phase of exitTicks (60), levelCompleted with the new totals', () => {
    const levels = [DOOR_ROOM, CRYSTAL_ROOM];
    const game = playingGame(DOOR_ROOM);
    // playingGame builds a one-level game; this one has a level after it.
    const twoLevels: GameState = { ...game, levels };
    twoLevels.run.hasTrophy = true;
    twoLevels.session.score = 130;
    twoLevels.session.lives = 2;
    standIn(twoLevels, 8, 1);

    expect(touch(twoLevels)).toEqual([
      { type: 'levelCompleted', levelIndex: 0, last: false, bonus: 200, score: 330, lives: 3, highestUnlocked: 1 },
    ]);
    expect(twoLevels.session).toEqual({ status: 'playing', levelIndex: 0, score: 330, lives: 3, highestUnlocked: 1 });
    expect(twoLevels.run.phase).toBe('exiting');
    expect(twoLevels.run.phaseTicks).toBe(0);
    expect(twoLevels.run.phaseLength).toBe(P.exitTicks);
    expect(P.exitTicks).toBe(60);
  });

  it('on the last level, levelCompleted says last and highestUnlocked stays on that level', () => {
    const game = playingGame(DOOR_ROOM);
    game.run.hasTrophy = true;
    standIn(game, 8, 1);

    expect(touch(game)).toEqual([
      { type: 'levelCompleted', levelIndex: 0, last: true, bonus: 200, score: 200, lives: 3, highestUnlocked: 0 },
    ]);
  });

  it('the life returned on a clear never lifts lives above maxLives (3)', () => {
    for (const [before, after] of [
      [1, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      const game = playingGame(DOOR_ROOM);
      game.run.hasTrophy = true;
      game.session.lives = before;
      standIn(game, 8, 1);
      touch(game);
      expect(game.session.lives, `from ${before}`).toBe(after);
    }
    expect(P.maxLives).toBe(3);
    expect(P.livesPerLevelClear).toBe(1);
  });

  it('a clear never lowers highestUnlocked', () => {
    const game = playingGame(DOOR_ROOM);
    const twoLevels: GameState = { ...game, levels: [DOOR_ROOM, CRYSTAL_ROOM] };
    twoLevels.session.highestUnlocked = 7;
    twoLevels.run.hasTrophy = true;
    standIn(twoLevels, 8, 1);
    touch(twoLevels);
    expect(twoLevels.session.highestUnlocked).toBe(7);
  });

  it('a hero flying into the door stops thrusting: thrustStopped comes before levelCompleted', () => {
    const game = playingGame(DOOR_ROOM);
    game.run.hasTrophy = true;
    game.run.player.hasThruster = true;
    game.run.player.thrusting = true;
    standIn(game, 8, 1);

    expect(types(touch(game))).toEqual(['thrustStopped', 'levelCompleted']);
    expect(game.run.player.thrusting).toBe(false);
  });

  it('cog and door touched on the same tick: the cog opens the door and the hero is through it at once', () => {
    const level = levelFromRows(['......', '.P.TD.', '######']);
    const game = playingGame(level);
    // Body from 60 px to 70 px: inside the cog's grown box (ends at 66 px) and inside the door box (starts at 68 px).
    putHero(game, sub(60), 2 * TILE - P.heroH);

    expect(types(touch(game))).toEqual(['trophyCollected', 'doorOpened', 'levelCompleted']);
    expect(game.session.score).toBe(P.scoreCog + P.scoreLevelClear);
    expect(game.run.phase).toBe('exiting');
  });
});

// ---------------------------------------------------------------------------
// Step 17: deaths
// ---------------------------------------------------------------------------

/** Spikes at col 3, furnace fire at col 6, coolant at col 9, all in row 3 with open air on every side. */
const HAZARD_ROOM = levelFromRows([
  '............',
  '............',
  '............',
  '...S..F..W..',
  '............',
  '............',
  '.P........TD',
  '############',
]);

/** In reading order: an Arc Moth (enemy 0, col 6, row 1) and a Cinderpeg (enemy 1, col 4, row 3). Direct tests place them by hand. */
const ENEMY_ROOM = levelFromRows(['............', '......H.....', '............', '.P..C.....TD', '############']);

interface Hazard {
  readonly cause: DeathCause;
  readonly cell: Box;
  /** The part of the cell that kills (section 5.4). */
  readonly kill: Box;
}

function hazardAt(cause: DeathCause, col: number, insetSide: number, insetTop: number): Hazard {
  const cell = cellBox(col, 3);
  return {
    cause,
    cell,
    kill: { left: cell.left + insetSide, top: cell.top + insetTop, right: cell.right - insetSide, bottom: cell.bottom },
  };
}

const SPIKES = hazardAt('spikes', 3, P.spikeInsetSide, P.spikeInsetTop);
const FIRE = hazardAt('fire', 6, P.fireInsetSide, P.fireInsetTop);
const COOLANT = hazardAt('coolant', 9, 0, P.coolantInsetTop);

/** Expects the hero at (x, y) to be untouched, and the hero at (x + dx, y + dy) to die of `cause`. */
function expectGraze(
  level: LevelData,
  cause: DeathCause,
  x: number,
  y: number,
  dx: number,
  dy: number,
  label: string,
  phys: Phys = P,
): void {
  const safe = playingGame(level, phys);
  putHero(safe, x, y);
  expect(touch(safe), `${label}: safe`).toEqual([]);
  expect(safe.run.phase, `${label}: safe`).toBe('playing');

  const dead = playingGame(level, phys);
  putHero(dead, x + dx, y + dy);
  const events = touch(dead);
  expect(types(events), `${label}: deadly`).toEqual(['playerDied']);
  expect(dead.run.deathCause, `${label}: deadly`).toBe(cause);
  expect(dead.run.phase, `${label}: deadly`).toBe('dying');
}

/**
 * The hurt box may touch `kill` on each of its four sides and live; one sub-pixel further it dies of `cause`.
 * Every position is worked out from `phys`, so this holds for any valid numbers.
 */
function expectFourSideGraze(level: LevelData, cause: DeathCause, kill: Box, phys: Phys): void {
  // Hero positions that put the hurt box's own edges where the comment says.
  const hurtLeftAt = (v: number): number => v - phys.hurtInsetSide;
  const hurtRightAt = (v: number): number => v + phys.hurtInsetSide - phys.heroW;
  const hurtTopAt = (v: number): number => v - phys.hurtInsetTop;
  const hurtBottomAt = (v: number): number => v + phys.hurtInsetBottom - phys.heroH;

  // Coming from the left: the hurt box's right edge on the kill box's left edge.
  expectGraze(level, cause, hurtRightAt(kill.left), hurtTopAt(kill.top), 1, 0, 'left', phys);
  // From the right: left edge on right edge.
  expectGraze(level, cause, hurtLeftAt(kill.right), hurtTopAt(kill.top), -1, 0, 'right', phys);
  // From above: bottom edge on top edge.
  expectGraze(level, cause, hurtLeftAt(kill.left), hurtBottomAt(kill.top), 0, 1, 'above', phys);
  // From below: top edge on bottom edge.
  expectGraze(level, cause, hurtLeftAt(kill.left), hurtTopAt(kill.bottom), 0, -1, 'below', phys);
}

describe('step 17: the hurt box and the kill boxes', () => {
  it('the reference hurt box is 6 by 11 px inside the 10 by 14 px body', () => {
    expect(P.heroW - 2 * P.hurtInsetSide).toBe(sub(6));
    expect(P.heroH - P.hurtInsetTop - P.hurtInsetBottom).toBe(sub(11));
    expect([P.heroW, P.heroH]).toEqual([sub(10), sub(14)]);
  });

  it('the reference kill boxes: spikes 3 px in at the sides and 8 px down, fire 3 and 4, coolant full width and 6 px down', () => {
    expect([P.spikeInsetSide, P.spikeInsetTop]).toEqual([sub(3), sub(8)]);
    expect([P.fireInsetSide, P.fireInsetTop]).toEqual([sub(3), sub(4)]);
    expect(P.coolantInsetTop).toBe(sub(6));
  });

  for (const hazard of [SPIKES, FIRE, COOLANT]) {
    it(`${hazard.cause}: the hurt box may touch the kill box on each of its four sides; one sub-pixel further kills`, () => {
      // The kill box reaches the bottom of its cell, so "from below" is a head poking up into it.
      expectFourSideGraze(HAZARD_ROOM, hazard.cause, hazard.kill, P);
    });
  }

  it('sideways grace against spikes and fire is 5 px: the front edge 5 px inside the cell is safe, one more sub-pixel kills', () => {
    for (const hazard of [SPIKES, FIRE]) {
      // Standing level with the cell, as on a floor that the hazard is part of.
      const y = hazard.cell.bottom - P.heroH;
      // Walking right into it: the body's right edge is the front.
      expectGraze(HAZARD_ROOM, hazard.cause, hazard.cell.left + sub(5) - P.heroW, y, 1, 0, `${hazard.cause}, walking right`);
      // Walking left into it: the body's left edge is the front.
      expectGraze(HAZARD_ROOM, hazard.cause, hazard.cell.right - sub(5), y, -1, 0, `${hazard.cause}, walking left`);
    }
  });

  it('in play: a hero walking from the start into spikes or fire in the next cell dies with his front edge 5.25 px inside it (section 13)', () => {
    for (const [letter, cause] of [
      ['S', 'spikes'],
      ['F', 'fire'],
    ] as const) {
      const level = levelFromRows(['........', `.P${letter}...TD`, '########']);
      const game = playingGame(level);
      let frontBefore = 0;
      for (let t = 0; t < 60 && game.run.phase === 'playing'; t++) {
        frontBefore = game.run.player.x + P.heroW;
        tick(game, 'R');
      }
      expect(game.run.deathCause, letter).toBe(cause);
      const front = game.run.player.x + P.heroW;
      expect(front - 2 * TILE, letter).toBe(sub(5.25));
      // One tick earlier the front edge was inside the 5 px of grace.
      expect(frontBefore - 2 * TILE, letter).toBeLessThanOrEqual(sub(5));
    }
  });

  it('coolant has no sideways inset: only the 2 px between body and hurt box are forgiven', () => {
    const y = COOLANT.cell.bottom - P.heroH;
    expectGraze(HAZARD_ROOM, 'coolant', COOLANT.cell.left + sub(2) - P.heroW, y, 1, 0, 'walking right');
    expectGraze(HAZARD_ROOM, 'coolant', COOLANT.cell.right - sub(2), y, -1, 0, 'walking left');
  });

  it('coolant kills only when the feet are more than coolantInsetTop + hurtInsetBottom (7 px) below the surface: 7 px exactly is safe', () => {
    const depth = P.coolantInsetTop + P.hurtInsetBottom;
    expect(depth).toBe(sub(7));
    const x = COOLANT.cell.left + sub(3);
    // Feet `depth` below the top edge of the coolant cell.
    expectGraze(HAZARD_ROOM, 'coolant', x, COOLANT.cell.top + depth - P.heroH, 0, 1, 'sinking');
  });

  it('feet may dip 9 px into a spike cell and 5 px into a fire cell from above; one more sub-pixel kills', () => {
    expectGraze(HAZARD_ROOM, 'spikes', SPIKES.cell.left + sub(3), SPIKES.cell.top + sub(9) - P.heroH, 0, 1, 'spikes');
    expectGraze(HAZARD_ROOM, 'fire', FIRE.cell.left + sub(3), FIRE.cell.top + sub(5) - P.heroH, 0, 1, 'fire');
  });

  it('a head may poke hurtInsetTop (2 px) into a hazard cell from below; one more sub-pixel kills', () => {
    for (const hazard of [SPIKES, FIRE, COOLANT]) {
      expectGraze(HAZARD_ROOM, hazard.cause, hazard.cell.left + sub(3), hazard.cell.bottom - sub(2), 0, -1, hazard.cause);
    }
  });

  it('feet on the floor line are safe over a hazard set into the floor: every kill box starts below that line', () => {
    // Spikes, fire and coolant as floor tiles; the hero's feet are on the floor line right over each of them,
    // as they are for a moment when he walks or jumps across.
    const level = levelFromRows(['........', '.P....TD', '##SFW###']);
    for (const col of [2, 3, 4]) {
      const game = playingGame(level);
      standIn(game, col, 1);
      expect(touch(game), `over col ${col}`).toEqual([]);
    }
  });
});

describe('step 17: what a death starts', () => {
  it('a death starts the dying phase of dyingTicks (52) and reports the cause, the body centre, the lives that will be left and the score', () => {
    const game = playingGame(HAZARD_ROOM);
    game.session.score = 40;
    standIn(game, 3, 3);
    const p = game.run.player;

    expect(touch(game)).toEqual([
      { type: 'playerDied', cause: 'spikes', x: p.x + (P.heroW >> 1), y: p.y + (P.heroH >> 1), livesAfter: 2, score: 40 },
    ]);
    expect(game.run.phase).toBe('dying');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(P.dyingTicks);
    expect(P.dyingTicks).toBe(52);
    expect(game.run.deathCause).toBe('spikes');
    // The life itself is taken when the dying phase ends, not now.
    expect(game.session.lives).toBe(3);
    expect(game.session.status).toBe('playing');
  });

  it('each hazard names itself as the cause', () => {
    for (const hazard of [SPIKES, FIRE, COOLANT]) {
      const game = playingGame(HAZARD_ROOM);
      putHero(game, hazard.cell.left + sub(3), hazard.cell.bottom - P.heroH);
      const events = touch(game);
      expect(events.map((e) => (e.type === 'playerDied' ? e.cause : e.type))).toEqual([hazard.cause]);
    }
  });

  it('a hero killed while thrusting stops thrusting: thrustStopped comes before playerDied', () => {
    const game = playingGame(HAZARD_ROOM);
    game.run.player.hasThruster = true;
    game.run.player.thrusting = true;
    standIn(game, 6, 3);

    expect(types(touch(game))).toEqual(['thrustStopped', 'playerDied']);
    expect(game.run.player.thrusting).toBe(false);
  });

  it('nothing dangerous touched: no event, the phase stays playing and deathCause stays null', () => {
    const game = playingGame(HAZARD_ROOM);
    standIn(game, 1, 6);
    expect(touch(game)).toEqual([]);
    expect(game.run.phase).toBe('playing');
    expect(game.run.deathCause).toBeNull();
  });

  it('without an events array a death starts the same way', () => {
    const game = playingGame(HAZARD_ROOM);
    game.run.player.thrusting = true;
    standIn(game, 9, 3);
    resolveContacts(game);

    expect(game.run.phase).toBe('dying');
    expect(game.run.deathCause).toBe('coolant');
    expect(game.run.phaseLength).toBe(P.dyingTicks);
    expect(game.run.player.thrusting).toBe(false);
  });
});

describe('step 17: the order of causes', () => {
  it('hazard tiles are scanned rows top to bottom, then columns left to right: the first kill box hit names the cause', () => {
    // The hurt box (6 by 11 px) lies over the point where columns 3 and 4 and rows 2 and 3 meet. Its top is
    // 2 px above that point; its left edge is `leftPx` px left of it, chosen so that it reaches both kill boxes
    // (fire and spikes are inset 3 px from their cell's sides, coolant is not).
    const rooms: readonly (readonly [rows: readonly string[], leftPx: number, cause: DeathCause, why: string])[] = [
      // Same row: the left column is met first, whatever it holds.
      [['........', '........', '...WF...', '........', '.P....TD', '########'], 2, 'coolant', 'left before right'],
      [['........', '........', '...FW...', '........', '.P....TD', '########'], 4, 'fire', 'left before right'],
      // Same column: the upper row is met first.
      [['........', '........', '...W....', '...S....', '.P....TD', '########'], 11, 'coolant', 'top before bottom'],
      [['........', '........', '...S....', '...W....', '.P....TD', '########'], 11, 'spikes', 'top before bottom'],
      // Upper right against lower left: the row decides, not the column.
      [['........', '........', '....F...', '...W....', '.P....TD', '########'], 2, 'fire', 'row before column'],
      [['........', '........', '....W...', '...F....', '.P....TD', '########'], 4, 'coolant', 'row before column'],
    ];
    for (const [rows, leftPx, cause, why] of rooms) {
      const level = levelFromRows(rows);
      const x = 4 * TILE - sub(leftPx) - P.hurtInsetSide;
      const y = 3 * TILE - sub(2) - P.hurtInsetTop;
      const game = playingGame(level);
      putHero(game, x, y);
      touch(game);
      expect(game.run.deathCause, `${why}: ${rows.join('/')}`).toBe(cause);

      // The test is only worth something if the other hazard would kill too: take the winner away and look.
      const others = rows.map((row) => row.replace(cause === 'fire' ? 'F' : cause === 'coolant' ? 'W' : 'S', '.'));
      const alone = playingGame(levelFromRows(others));
      putHero(alone, x, y);
      touch(alone);
      expect(alone.run.deathCause, `${why}, loser alone: ${others.join('/')}`).not.toBeNull();
      expect(alone.run.deathCause, `${why}, loser alone: ${others.join('/')}`).not.toBe(cause);
    }
  });

  it('a hazard is named before an enemy that touches on the same tick', () => {
    const level = levelFromRows(['........', '...S....', '........', '.P.C..TD', '########']);
    const game = playingGame(level);
    const enemy = enemyOf(game, 0);
    enemy.x = 3 * TILE;
    enemy.y = TILE;
    standIn(game, 3, 1);

    touch(game);
    expect(game.run.deathCause).toBe('spikes');
  });

  it('falling out is named before an enemy that touches on the same tick', () => {
    const game = playingGame(ENEMY_ROOM);
    const y = ENEMY_ROOM.height * TILE;
    const enemy = enemyOf(game, 0);
    enemy.x = 6 * TILE;
    enemy.y = y;
    putHero(game, 6 * TILE + sub(3), y);

    touch(game);
    expect(game.run.deathCause).toBe('fell');
  });
});

describe('step 17: coolant set into the floor', () => {
  it('in play: a one-tile coolant pool swallows a walking hero like a hole, and kills once his feet are 7 px under the surface', () => {
    const level = levelFromRows(['........', '.P....TD', '###W####']);
    const game = playingGame(level);
    const p = game.run.player;
    const surface = 2 * TILE;
    let feetBefore = 0;
    for (let t = 0; t < 200 && game.run.phase === 'playing'; t++) {
      feetBefore = p.y + P.heroH;
      tick(game, 'R');
    }

    expect(game.run.deathCause).toBe('coolant');
    expect(p.y + P.heroH - surface).toBeGreaterThan(P.coolantInsetTop + P.hurtInsetBottom);
    expect(feetBefore - surface).toBeLessThanOrEqual(P.coolantInsetTop + P.hurtInsetBottom);
    // He went in over the pool, not past it.
    expect(p.x + P.hurtInsetSide).toBeLessThan(4 * TILE);
    expect(p.x + P.heroW - P.hurtInsetSide).toBeGreaterThan(3 * TILE);
  });
});

describe('step 17: falling out of the level', () => {
  it('the hero dies of "fell" when the top of the body reaches the bottom edge of the grid, not one sub-pixel earlier', () => {
    const bottomEdge = HAZARD_ROOM.height * TILE;
    const x = 5 * TILE;
    expectGraze(HAZARD_ROOM, 'fell', x, bottomEdge - 1, 0, 1, 'bottom edge');
  });

  it('in play: a hero who walks into a pit falls through the open bottom and dies there', () => {
    const level = levelFromRows(['........', '.P....TD', '##..####']);
    const game = playingGame(level);
    const p = game.run.player;
    let died: GameEvent[] = [];
    let yBefore = p.y;
    for (let t = 0; t < 200 && game.run.phase === 'playing'; t++) {
      yBefore = p.y;
      died = tick(game, 'R').filter((e) => e.type === 'playerDied');
    }

    expect(game.run.phase).toBe('dying');
    expect(game.run.deathCause).toBe('fell');
    expect(died).toHaveLength(1);
    expect(p.y).toBeGreaterThanOrEqual(level.height * TILE);
    // One tick earlier the body was still partly inside the grid.
    expect(yBefore).toBeLessThan(level.height * TILE);
  });
});

/** An enemy's touch box: its one-tile body shrunk by enemyTouchInset on all four sides. */
function touchBoxOf(body: EnemyState, phys: Phys): Box {
  const k = phys.enemyTouchInset;
  return { left: body.x + k, top: body.y + k, right: body.x + TILE - k, bottom: body.y + TILE - k };
}

describe('step 17: enemy touch', () => {
  it('the reference touch box is 10 px square inside the 16 px body', () => {
    expect(TILE - 2 * P.enemyTouchInset).toBe(sub(10));
  });

  for (const [index, name] of [
    [0, 'Arc Moth'],
    [1, 'Cinderpeg'],
  ] as const) {
    it(`a ${name} kills from every side: the hurt box may touch its touch box, one sub-pixel further is death by "enemy"`, () => {
      // From above too: there is no stomping.
      expectFourSideGraze(ENEMY_ROOM, 'enemy', touchBoxOf(enemyOf(playingGame(ENEMY_ROOM), index), P), P);
    });
  }

  it('the touch follows the enemy: the box is measured from where the enemy is now', () => {
    const game = playingGame(ENEMY_ROOM);
    const moth = enemyOf(game, 0);
    moth.x = 9 * TILE + 123;
    moth.y = 2 * TILE - 77;
    // On the cell the moth started in: nothing there any more.
    standIn(game, 6, 1);
    expect(touch(game)).toEqual([]);
    // Where it is now.
    putHero(game, moth.x + sub(3), moth.y + sub(1));
    touch(game);
    expect(game.run.deathCause).toBe('enemy');
  });

  it('a destroyed enemy is harmless', () => {
    const game = playingGame(ENEMY_ROOM);
    enemyOf(game, 1).alive = false;
    standIn(game, 4, 3);

    expect(touch(game)).toEqual([]);
    expect(game.run.phase).toBe('playing');
  });

  it('in play: landing on a Cinderpeg from above kills, there is no stomping', () => {
    const game = playingGame(ENEMY_ROOM);
    const peg = enemyOf(game, 1);
    // One tile above the Cinderpeg's head, over the spot it is walking toward.
    putHero(game, peg.x - sub(4), 2 * TILE - P.heroH);
    const p = game.run.player;

    let events: GameEvent[] = [];
    let hurtBottomBefore = 0;
    for (let t = 0; t < 60 && game.run.phase === 'playing'; t++) {
      hurtBottomBefore = p.y + P.heroH - P.hurtInsetBottom;
      events = tick(game);
    }

    expect(game.run.deathCause).toBe('enemy');
    expect(types(events)).toEqual(['playerDied']);
    // Killed in the air, coming down, having been above the enemy's touch box a tick earlier: a stomp in any other game.
    expect(p.vy).toBeGreaterThan(0);
    expect(p.onGround).toBe(false);
    expect(hurtBottomBefore).toBeLessThanOrEqual(peg.y + P.enemyTouchInset);
  });
});

// ---------------------------------------------------------------------------
// Ties: 14 to 16 run before 17
// ---------------------------------------------------------------------------

describe('steps 14 to 17 read each box and number from its own Phys field (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers the fire, spike and enemy-touch side insets and ledgeCatch are all 3 px, the hurt
  // box's side and top insets and the pickup outset are all 2 px, the fire top inset, the door inset and the
  // corner nudge are all 4 px, and startLives = maxLives: the tests above cannot tell those fields apart.
  const D = DISTINCT_PHYS;

  const hazards: readonly Hazard[] = [
    hazardAt('spikes', 3, D.spikeInsetSide, D.spikeInsetTop),
    hazardAt('fire', 6, D.fireInsetSide, D.fireInsetTop),
    hazardAt('coolant', 9, 0, D.coolantInsetTop),
  ];
  for (const hazard of hazards) {
    it(`${hazard.cause}: hurt box and kill box as DISTINCT_PHYS draws them; touching on each side is safe, one sub-pixel more kills`, () => {
      expectFourSideGraze(HAZARD_ROOM, hazard.cause, hazard.kill, D);
    });
  }

  for (const [index, name] of [
    [0, 'Arc Moth'],
    [1, 'Cinderpeg'],
  ] as const) {
    it(`a ${name}: touch box as DISTINCT_PHYS draws it; touching on each side is safe, one sub-pixel more kills`, () => {
      expectFourSideGraze(ENEMY_ROOM, 'enemy', touchBoxOf(enemyOf(playingGame(ENEMY_ROOM, D), index), D), D);
    });
  }

  it('the door box is its cell narrowed by doorInsetSide on the left and on the right', () => {
    const y = DOOR.bottom - D.heroH;
    for (const [side, x, dx] of [
      ['from the left', DOOR.left + D.doorInsetSide - D.heroW, 1],
      ['from the right', DOOR.right - D.doorInsetSide, -1],
    ] as const) {
      const game = playingGame(DOOR_ROOM, D);
      game.run.hasTrophy = true;
      putHero(game, x, y);
      expect(touch(game), side).toEqual([]);
      putHero(game, x + dx, y);
      expect(types(touch(game)), side).toEqual(['levelCompleted']);
    }
  });

  it('a crystal and the cog are taken from pickupOutset outside their cell, and pay scoreCrystal and scoreCog', () => {
    const crystal = playingGame(CRYSTAL_ROOM, D);
    putHero(crystal, CRYSTAL.left - D.pickupOutset - D.heroW, CRYSTAL.top);
    expect(touch(crystal)).toEqual([]);
    putHero(crystal, CRYSTAL.left - D.pickupOutset - D.heroW + 1, CRYSTAL.top);
    expect(types(touch(crystal))).toEqual(['pickup']);
    expect(crystal.session.score).toBe(D.scoreCrystal);

    const cog = playingGame(DOOR_ROOM, D);
    putHero(cog, COG.left, COG.top - D.pickupOutset - D.heroH);
    expect(touch(cog)).toEqual([]);
    putHero(cog, COG.left, COG.top - D.pickupOutset - D.heroH + 1);
    expect(touch(cog)[0]).toMatchObject({ type: 'trophyCollected', score: D.scoreCog });
    expect(cog.session.score).toBe(D.scoreCog);
  });

  it('a thruster pack fills the tank to fuelTicks', () => {
    const game = playingGame(ITEM_ROOM, D);
    standIn(game, 3, 1, D);
    touch(game);
    expect(game.run.player.fuel).toBe(D.fuelTicks);
  });

  it('a clear pays scoreLevelClear and gives livesPerLevelClear back, never above maxLives', () => {
    for (const [before, after] of [
      [D.startLives, D.startLives + D.livesPerLevelClear],
      [D.maxLives - 1, D.maxLives],
      [D.maxLives, D.maxLives],
    ] as const) {
      const game = playingGame(DOOR_ROOM, D);
      game.run.hasTrophy = true;
      game.session.lives = before;
      standIn(game, 8, 1, D);
      expect(touch(game)[0], `from ${before}`).toMatchObject({ type: 'levelCompleted', bonus: D.scoreLevelClear, lives: after });
      expect(game.session.score).toBe(D.scoreLevelClear);
    }
  });
});

describe('ties: the good thing happens first', () => {
  it('pickup beats hazard: a crystal touched on the tick the spikes kill is still collected and paid', () => {
    const level = levelFromRows(['......TD', '.P.GS...', '########']);
    const game = playingGame(level);
    // Body from 60 px to 70 px: inside the crystal's grown box (ends at 66 px), and its hurt box (ends at 68 px)
    // 1 px inside the spikes' kill box (starts at 67 px).
    putHero(game, sub(60), 2 * TILE - P.heroH);
    const p = game.run.player;

    expect(touch(game)).toEqual([
      { type: 'pickup', kind: 'crystal', index: 0, x: 3 * TILE + CENTRE, y: TILE + CENTRE, score: 10 },
      { type: 'playerDied', cause: 'spikes', x: p.x + (P.heroW >> 1), y: p.y + (P.heroH >> 1), livesAfter: 2, score: 10 },
    ]);
    expect(game.run.taken).toEqual([true]);
    expect(game.session.score).toBe(10);
    expect(game.run.phase).toBe('dying');
  });

  it('an item beats an enemy: the pack is taken on the tick the hero is killed', () => {
    const level = levelFromRows(['......TD', '.P.J.C..', '########']);
    const game = playingGame(level);
    const peg = enemyOf(game, 0);
    peg.x = 3 * TILE;
    standIn(game, 3, 1);

    expect(types(touch(game))).toEqual(['pickup', 'playerDied']);
    expect(game.run.taken).toEqual([true]);
    expect(game.run.player.hasThruster).toBe(true);
    expect(game.run.deathCause).toBe('enemy');
  });

  it('the cog beats a hazard: it is taken, and the door opened, on the tick the hero dies', () => {
    const level = levelFromRows(['.......', '.P.TF.D', '#######']);
    const game = playingGame(level);
    putHero(game, sub(60), 2 * TILE - P.heroH);

    expect(types(touch(game))).toEqual(['trophyCollected', 'doorOpened', 'playerDied']);
    expect(game.run.hasTrophy).toBe(true);
    expect(game.session.score).toBe(P.scoreCog);
    expect(game.run.deathCause).toBe('fire');
  });

  it('the win beats a death: inside the open door nothing kills, not an enemy and not a hazard', () => {
    // An enemy on top of the hero in the doorway.
    const withEnemy = playingGame(levelFromRows(['.......', '.P.C.TD', '#######']));
    withEnemy.run.hasTrophy = true;
    const peg = enemyOf(withEnemy, 0);
    peg.x = 6 * TILE;
    standIn(withEnemy, 6, 1);
    expect(types(touch(withEnemy))).toEqual(['levelCompleted']);
    expect(withEnemy.run.phase).toBe('exiting');
    expect(withEnemy.run.deathCause).toBeNull();

    // Spikes right behind the door: the body is inside the door box and the hurt box one sub-pixel inside the kill box.
    const withSpikes = playingGame(levelFromRows(['.......', '.P.T.DS', '#######']));
    withSpikes.run.hasTrophy = true;
    const x = 6 * TILE + P.spikeInsetSide + P.hurtInsetSide - P.heroW + 1;
    putHero(withSpikes, x, 2 * TILE - P.heroH);
    expect(types(touch(withSpikes))).toEqual(['levelCompleted']);
    expect(withSpikes.run.phase).toBe('exiting');

    // The same spot without the cog: the door is scenery and the spikes kill.
    const noCog = playingGame(levelFromRows(['.......', '.P.T.DS', '#######']));
    putHero(noCog, x, 2 * TILE - P.heroH);
    expect(types(touch(noCog))).toEqual(['playerDied']);
  });
});
