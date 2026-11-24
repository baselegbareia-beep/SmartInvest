import { describe, expect, it } from 'vitest';

import { resolveContacts } from './contact';
import { stepEnemies } from './enemies';
import { stepPlayer } from './player';
import { respawnRun } from './run';
import { DISTINCT_PHYS, IN, NONE, levelFromRows, playingGame, REFERENCE_PHYS, referencePhysWith } from './testkit';
import { tileAt } from './tiles';
import { ENEMY_SIZE, Tile, TILE, TILE_SHIFT } from './types';
import type { EnemyState, GameState, LevelData, Phys } from './types';

/**
 * The Cinderpeg and the Arc Moth: step 12 of the tick (docs/ARCHITECTURE.md,
 * section 5.6), driven through stepEnemies alone, on the reference numbers.
 * The last block adds the other half of an enemy, the touch that kills
 * (step 17), through resolveContacts.
 *
 * In most rooms the hero, the cog and the airlock are walled into the
 * top-left corner (`PTD#` over `####`): the enemies have the rest to
 * themselves, and nothing here depends on where the hero is.
 */

const P = REFERENCE_PHYS;

function enemyAt(game: GameState, index = 0): EnemyState {
  const enemy = game.run.enemies[index];
  if (enemy === undefined) throw new Error(`the level has no enemy ${index}`);
  return enemy;
}

/** n ticks of step 12. */
function advance(game: GameState, n: number): void {
  for (let i = 0; i < n; i++) stepEnemies(game);
}

/** Steps until the enemy turns round; the number of ticks that took, the turn tick included. */
function ticksToTurn(game: GameState, enemy: EnemyState): number {
  const before = enemy.dir;
  for (let t = 1; t <= 5000; t++) {
    stepEnemies(game);
    if (enemy.dir !== before) return t;
  }
  throw new Error('the enemy never turned round');
}

/** True when the cell is open air inside the grid. */
function isOpen(level: LevelData, col: number, row: number): boolean {
  const inside = col >= 0 && col < level.width && row >= 0 && row < level.height;
  return inside && tileAt(level, col, row) === Tile.Empty;
}

/** The cells a one-tile body at (x, y) overlaps: one, two or four of them. */
function bodyCells(x: number, y: number): [col: number, row: number][] {
  const cells: [number, number][] = [];
  for (let row = y >> TILE_SHIFT; row <= (y + ENEMY_SIZE - 1) >> TILE_SHIFT; row++) {
    for (let col = x >> TILE_SHIFT; col <= (x + ENEMY_SIZE - 1) >> TILE_SHIFT; col++) cells.push([col, row]);
  }
  return cells;
}

interface Patrol {
  /** Lowest and highest value of the coordinate the enemy moves along, in sub-pixels. */
  readonly min: number;
  readonly max: number;
}

/**
 * Watches the first enemy of a room for a long patrol and checks, on every
 * tick, what must hold for any enemy at any speed: it stays on its line, and
 * every cell its body overlaps is one it may be in (`allowed`).
 */
function patrol(
  rows: readonly string[],
  phys: Phys,
  allowed: (level: LevelData, col: number, row: number) => boolean,
): Patrol {
  const level = levelFromRows(rows);
  const game = playingGame(level, phys);
  const enemy = enemyAt(game);
  const alongX = enemy.kind === 'cinderpeg' || enemy.axis === 'h';
  const acrossAtStart = alongX ? enemy.y : enemy.x;
  let min = alongX ? enemy.x : enemy.y;
  let max = min;
  for (let t = 1; t <= 6000; t++) {
    stepEnemies(game);
    const along = alongX ? enemy.x : enemy.y;
    min = Math.min(min, along);
    max = Math.max(max, along);
    // Plain throws, not expect(): this runs some hundred thousand times per test file.
    if ((alongX ? enemy.y : enemy.x) !== acrossAtStart) throw new Error(`tick ${t}: the enemy left its line`);
    for (const [col, row] of bodyCells(enemy.x, enemy.y)) {
      if (!allowed(level, col, row)) throw new Error(`tick ${t}: body in cell col ${col}, row ${row}`);
    }
  }
  return { min, max };
}

/** A Cinderpeg may stand only in open air with a wall underneath. */
function cinderpegMayStand(level: LevelData, col: number, row: number): boolean {
  return isOpen(level, col, row) && tileAt(level, col, row + 1) === Tile.Solid;
}

// ---------------------------------------------------------------------------
// Cinderpeg
// ---------------------------------------------------------------------------

/**
 * One Cinderpeg (col 6) between two things that must turn it round. In every
 * room but the last the cells it may stand in are cols 2 to 9.
 */
const CINDERPEG_ROOMS: readonly { where: string; rows: readonly string[]; first: number; last: number }[] = [
  {
    where: 'a wall',
    rows: ['PTD#........', '####........', '.#....C...#.', '############'],
    first: 2,
    last: 9,
  },
  {
    where: 'a ledge (no floor ahead)',
    rows: ['PTD#........', '####........', '......C.....', '..########..'],
    first: 2,
    last: 9,
  },
  {
    where: 'a hole one tile wide',
    rows: ['PTD#........', '####........', '......C.....', '#.########.#'],
    first: 2,
    last: 9,
  },
  {
    where: 'furnace fire in its way',
    rows: ['PTD#........', '####........', '.F....C...F.', '############'],
    first: 2,
    last: 9,
  },
  {
    where: 'coolant in its way',
    rows: ['PTD#........', '####........', '.W....C...W.', '############'],
    first: 2,
    last: 9,
  },
  {
    where: 'spikes in its way',
    rows: ['PTD#........', '####........', '.S....C...S.', '############'],
    first: 2,
    last: 9,
  },
  {
    where: 'furnace fire set into the floor',
    rows: ['PTD#........', '####........', '......C.....', '#F########F#'],
    first: 2,
    last: 9,
  },
  {
    where: 'a coolant pool set into the floor',
    rows: ['PTD#........', '####........', '......C.....', '#W########W#'],
    first: 2,
    last: 9,
  },
  {
    where: 'spikes set into the floor',
    rows: ['PTD#........', '####........', '......C.....', '#S########S#'],
    first: 2,
    last: 9,
  },
  {
    where: 'the left and right edges of the grid',
    rows: ['....C...', '########', 'PTD.....', '###.....'],
    first: 0,
    last: 7,
  },
];

const WALLED = ['PTD#........', '####........', '.#....C...#.', '############'];

describe('Cinderpeg', () => {
  it('starts on its cell heading left and walks cinderpegSpeed (0.5 px) per tick: one tile every 32 ticks', () => {
    const game = playingGame(levelFromRows(WALLED));
    const c = enemyAt(game);
    expect(c).toEqual({ kind: 'cinderpeg', x: 6 * TILE, y: 2 * TILE, dir: -1, alive: true });
    expect(P.cinderpegSpeed).toBe(128);

    advance(game, 1);
    expect(c.x).toBe(6 * TILE - P.cinderpegSpeed);
    advance(game, 31);
    expect(c.x).toBe(5 * TILE);
    advance(game, 32);
    expect(c.x).toBe(4 * TILE);
    expect(c.y).toBe(2 * TILE);
  });

  it.each(CINDERPEG_ROOMS)(
    'turns round at $where: it walks right up to it, never further, and never leaves its row',
    ({ rows, first, last }) => {
      const { min, max } = patrol(rows, P, cinderpegMayStand);
      expect(min).toBe(first * TILE);
      expect(max).toBe(last * TILE);
    },
  );

  it('turns round on the tick its next move is blocked and does not move on that tick', () => {
    const game = playingGame(levelFromRows(WALLED));
    const c = enemyAt(game);

    // Four tiles to the wall at col 1, 32 ticks each: now flush against it, still heading left.
    advance(game, 4 * 32);
    expect([c.x, c.dir]).toEqual([2 * TILE, -1]);

    // The blocked tick: the turn is the whole move.
    advance(game, 1);
    expect([c.x, c.dir]).toEqual([2 * TILE, 1]);

    // The next tick it is on its way back.
    advance(game, 1);
    expect([c.x, c.dir]).toEqual([2 * TILE + P.cinderpegSpeed, 1]);
  });

  it('takes 32 ticks per tile plus the turn tick from one end of a closed lane to the other', () => {
    const game = playingGame(levelFromRows(WALLED));
    const c = enemyAt(game);
    // From the start cell (col 6) to the left wall: 4 tiles, then the turn.
    expect(ticksToTurn(game, c)).toBe(4 * 32 + 1);
    // The lane is cols 2 to 9: 7 tiles of travel.
    expect(ticksToTurn(game, c)).toBe(7 * 32 + 1);
    expect(c.x).toBe(9 * TILE);
    expect(ticksToTurn(game, c)).toBe(7 * 32 + 1);
    expect(c.x).toBe(2 * TILE);
  });

  it('walled in on both sides, it turns round every tick and never moves', () => {
    const game = playingGame(levelFromRows(['PTD#........', '####........', '.....#C#....', '############']));
    const c = enemyAt(game);
    const seen: number[] = [];
    for (let t = 0; t < 6; t++) {
      advance(game, 1);
      expect(c.x).toBe(6 * TILE);
      seen.push(c.dir);
    }
    expect(seen).toEqual([1, -1, 1, -1, 1, -1]);
  });

  it.each([0.5, 0.75, 1.30078125, 5, 7.99609375])(
    'at %f px per tick, in every room, its body stays on floored open cells and it turns less than one step short of each end',
    (speed) => {
      const phys = referencePhysWith({ enemies: { cinderpegSpeed: speed } });
      for (const { where, rows, first, last } of CINDERPEG_ROOMS) {
        const { min, max } = patrol(rows, phys, cinderpegMayStand);
        expect(min, where).toBeGreaterThanOrEqual(first * TILE);
        expect(min, where).toBeLessThan(first * TILE + phys.cinderpegSpeed);
        expect(max, where).toBeLessThanOrEqual(last * TILE);
        expect(max, where).toBeGreaterThan(last * TILE - phys.cinderpegSpeed);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Arc Moth
// ---------------------------------------------------------------------------

/** One horizontal moth (col 6). No floor anywhere under it: a moth needs none. Lane: cols 2 to 9, or the whole row. */
const H_LANES: readonly { where: string; rows: readonly string[]; first: number; last: number }[] = [
  { where: 'walls', rows: ['PTD#........', '####........', '.#....H...#.', '............'], first: 2, last: 9 },
  { where: 'furnace fire', rows: ['PTD#........', '####........', '.F....H...F.', '............'], first: 2, last: 9 },
  { where: 'coolant', rows: ['PTD#........', '####........', '.W....H...W.', '............'], first: 2, last: 9 },
  { where: 'spikes', rows: ['PTD#........', '####........', '.S....H...S.', '............'], first: 2, last: 9 },
  {
    where: 'the left and right edges of the grid',
    rows: ['....H...', '........', 'PTD.....', '###.....'],
    first: 0,
    last: 7,
  },
];

/** A column of 7 cells at col 5 with a vertical moth in row 3; `top` and `bottom` are what closes the lane. */
function column(top: string, bottom: string): string[] {
  return ['PTD#.' + top + '.', '####...', '.......', '.....M.', '.......', '.......', '.....' + bottom + '.'];
}

/** One vertical moth (row 3). Lane: rows 1 to 5, or the whole column. */
const V_LANES: readonly { where: string; rows: readonly string[]; first: number; last: number }[] = [
  { where: 'walls', rows: column('#', '#'), first: 1, last: 5 },
  { where: 'furnace fire', rows: column('F', 'F'), first: 1, last: 5 },
  { where: 'coolant', rows: column('W', 'W'), first: 1, last: 5 },
  { where: 'spikes', rows: column('S', 'S'), first: 1, last: 5 },
  { where: 'the top and the open bottom of the grid', rows: column('.', '.'), first: 0, last: 6 },
];

/** A closed lane of 5 cells (4 tiles of travel) with a moth in cell `start` (0 to 4), along either axis. */
function laneOfFive(axis: 'h' | 'v', start: number): string[] {
  if (axis === 'h') {
    return ['PTD#...', '####...', '#' + '.'.repeat(start) + 'H' + '.'.repeat(4 - start) + '#', '.......'];
  }
  // Col 0 is wall all the way down, so that the hero's cell has a floor.
  const lane = Array.from({ length: 5 }, (_, i) => (i === start ? '#....M.' : '#......'));
  return ['PTD#.#.', ...lane, '.....#.'];
}

describe('Arc Moth', () => {
  it('H starts heading left and flies mothSpeed (0.75 px) per tick along its row: 3 tiles every 64 ticks (21.3 per tile)', () => {
    const game = playingGame(levelFromRows(['PTD#........', '####........', '.#......H.#.', '............']));
    const moth = enemyAt(game);
    expect(moth).toEqual({ kind: 'moth', axis: 'h', x: 8 * TILE, y: 2 * TILE, dir: -1, alive: true });
    expect(P.mothSpeed).toBe(192);

    advance(game, 1);
    expect(moth.x).toBe(8 * TILE - P.mothSpeed);
    advance(game, 63);
    expect(moth.x).toBe(5 * TILE);
    expect(moth.y).toBe(2 * TILE);
  });

  it('M starts heading up and flies mothSpeed per tick along its column: 3 tiles every 64 ticks', () => {
    const game = playingGame(
      levelFromRows(['PTD#.#.', '####...', '.......', '.......', '.......', '.....M.', '.....#.']),
    );
    const moth = enemyAt(game);
    expect(moth).toEqual({ kind: 'moth', axis: 'v', x: 5 * TILE, y: 5 * TILE, dir: -1, alive: true });

    advance(game, 1);
    expect(moth.y).toBe(5 * TILE - P.mothSpeed);
    advance(game, 63);
    expect(moth.y).toBe(2 * TILE);
    expect(moth.x).toBe(5 * TILE);
  });

  it.each(H_LANES)(
    'a horizontal moth bounces off $where: it never enters them and turns less than one step short, with no floor under it',
    ({ rows, first, last }) => {
      const { min, max } = patrol(rows, P, isOpen);
      expect(min).toBeGreaterThanOrEqual(first * TILE);
      expect(min).toBeLessThan(first * TILE + P.mothSpeed);
      expect(max).toBeLessThanOrEqual(last * TILE);
      expect(max).toBeGreaterThan(last * TILE - P.mothSpeed);
    },
  );

  it.each(V_LANES)(
    'a vertical moth bounces off $where: it never enters them and turns less than one step short',
    ({ rows, first, last }) => {
      const { min, max } = patrol(rows, P, isOpen);
      expect(min).toBeGreaterThanOrEqual(first * TILE);
      expect(min).toBeLessThan(first * TILE + P.mothSpeed);
      expect(max).toBeLessThanOrEqual(last * TILE);
      expect(max).toBeGreaterThan(last * TILE - P.mothSpeed);
    },
  );

  it('a vertical moth turns at the open bottom of the grid, where the hero would fall out', () => {
    const level = levelFromRows(column('.', '.'));
    const game = playingGame(level);
    const moth = enemyAt(game);
    let lowest = moth.y;
    for (let t = 0; t < 2000; t++) {
      advance(game, 1);
      lowest = Math.max(lowest, moth.y);
    }
    // The body's bottom edge reaches the grid's bottom edge to within one step and never passes it.
    expect(lowest + ENEMY_SIZE).toBeLessThanOrEqual(level.height * TILE);
    expect(lowest + ENEMY_SIZE).toBeGreaterThan(level.height * TILE - P.mothSpeed);
  });

  it.each(['h', 'v'] as const)(
    'turns round on the tick its next move is blocked and does not move on that tick (axis %s)',
    (axis) => {
      // Start cell 3 of the lane: three tiles from the near end, which 64 moves cover exactly.
      const game = playingGame(levelFromRows(laneOfFive(axis, 3)));
      const moth = enemyAt(game);
      const along = (): number => (axis === 'h' ? moth.x : moth.y);
      const nearEnd = TILE;

      advance(game, 64);
      expect([along(), moth.dir]).toEqual([nearEnd, -1]);
      advance(game, 1);
      expect([along(), moth.dir]).toEqual([nearEnd, 1]);
      advance(game, 1);
      expect([along(), moth.dir]).toEqual([nearEnd + P.mothSpeed, 1]);
    },
  );

  // Section 13: "In a closed lane of 5 cells (4 tiles of travel) it takes 85 or 86 f from one turn to the
  // next, the turn tick included, depending on the cell it starts in; it stops up to 0.5 px short of each end".
  // Columns: start cell, ticks to the first turn, ticks from turn to turn, sub-pixels short of the near and far end.
  const LANE_TIMING: readonly (readonly [start: number, first: number, period: number, near: number, far: number])[] = [
    [0, 1, 86, 0, 64],
    [1, 22, 86, 64, 0],
    [2, 43, 85, 128, 128],
    [3, 65, 86, 0, 64],
    [4, 86, 86, 64, 0],
  ];

  describe.each(['h', 'v'] as const)('in a closed lane of 5 cells, axis %s', (axis) => {
    it.each(LANE_TIMING)(
      'starting in cell %i it first turns on tick %i, then every %i ticks, %i sub-pixels short of the near end and %i of the far end',
      (start, first, period, near, far) => {
        const game = playingGame(levelFromRows(laneOfFive(axis, start)));
        const moth = enemyAt(game);
        const along = (): number => (axis === 'h' ? moth.x : moth.y);
        // The lane's cells are 1 to 5 along the axis: the body may be anywhere from TILE to 5 * TILE.
        const nearEnd = TILE;
        const farEnd = 5 * TILE;

        expect(ticksToTurn(game, moth)).toBe(first);
        expect(along() - nearEnd).toBe(near);
        for (let lap = 0; lap < 3; lap++) {
          expect(ticksToTurn(game, moth)).toBe(period);
          expect(farEnd - along()).toBe(far);
          expect(ticksToTurn(game, moth)).toBe(period);
          expect(along() - nearEnd).toBe(near);
        }
        // Half a pixel is the most it can stop short: 0.75 px per tick against a 16 px tile.
        expect(Math.max(near, far)).toBeLessThanOrEqual(128);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// The exact turning point
// ---------------------------------------------------------------------------

/**
 * One lane per kind and axis, with the lowest and highest place the body may
 * have along its axis (`low`, `high`, in sub-pixels): flush with whatever
 * closes the lane at either end.
 */
const BOUNDARIES: readonly {
  what: string;
  rows: readonly string[];
  low: number;
  high: number;
  speed: (phys: Phys) => number;
}[] = [
  { what: 'a Cinderpeg between walls', rows: WALLED, low: 2 * TILE, high: 9 * TILE, speed: (p) => p.cinderpegSpeed },
  {
    what: 'a Cinderpeg between two ledges',
    rows: ['PTD#........', '####........', '......C.....', '..########..'],
    low: 2 * TILE,
    high: 9 * TILE,
    speed: (p) => p.cinderpegSpeed,
  },
  {
    what: 'a horizontal moth between walls',
    rows: ['PTD#........', '####........', '.#....H...#.', '............'],
    low: 2 * TILE,
    high: 9 * TILE,
    speed: (p) => p.mothSpeed,
  },
  { what: 'a vertical moth between walls', rows: column('#', '#'), low: TILE, high: 5 * TILE, speed: (p) => p.mothSpeed },
];

describe('the exact turning point', () => {
  /** Puts the enemy at `along` on its axis heading `dir`, runs one tick of step 12, returns [along, dir] after it. */
  function oneTick(rows: readonly string[], along: number, dir: -1 | 1): [number, number] {
    const game = playingGame(levelFromRows(rows));
    const enemy = enemyAt(game);
    const alongX = enemy.kind === 'cinderpeg' || enemy.axis === 'h';
    if (alongX) enemy.x = along;
    else enemy.y = along;
    enemy.dir = dir;
    stepEnemies(game);
    return [alongX ? enemy.x : enemy.y, enemy.dir];
  }

  it.each(BOUNDARIES)(
    '$what: a move that ends flush with the end of the lane is made; one that would put a single sub-pixel of the body past it is a turn without a move',
    ({ rows, low, high, speed }) => {
      const s = speed(P);
      // Heading left or up, toward `low`.
      expect(oneTick(rows, low + s, -1)).toEqual([low, -1]);
      expect(oneTick(rows, low + s - 1, -1)).toEqual([low + s - 1, 1]);
      // Heading right or down, toward `high`: the far edge of the body is what meets the end.
      expect(oneTick(rows, high - s, 1)).toEqual([high, 1]);
      expect(oneTick(rows, high - s + 1, 1)).toEqual([high - s + 1, -1]);
    },
  );
});

// ---------------------------------------------------------------------------
// Both kinds
// ---------------------------------------------------------------------------

/** Enemies in reading order: M (col 4, flies rows 1 to 4), H (row 3), C (row 4). Their lines cross, and the hero stands in the Cinderpeg's way. */
const CROSSING = ['#########', '#T..M..D#', '#.......#', '#......H#', '#.P...C.#', '#########'];

describe('each enemy reads its own speed (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers cinderpegSpeed equals groundTurn, apexHangSpeed and thrustCutVel (0.5 px).
  const D = DISTINCT_PHYS;

  it('a Cinderpeg walks cinderpegSpeed per tick; an Arc Moth flies mothSpeed per tick, along either axis', () => {
    const peg = playingGame(levelFromRows(WALLED), D);
    stepEnemies(peg);
    expect(enemyAt(peg).x).toBe(6 * TILE - D.cinderpegSpeed);

    const flat = playingGame(levelFromRows(['PTD#........', '####........', '.#......H.#.', '............']), D);
    stepEnemies(flat);
    expect(enemyAt(flat).x).toBe(8 * TILE - D.mothSpeed);

    const tall = playingGame(levelFromRows(['PTD#.#.', '####...', '.......', '.......', '.......', '.....M.', '.....#.']), D);
    stepEnemies(tall);
    expect(enemyAt(tall).y).toBe(5 * TILE - D.mothSpeed);
  });
});

describe('both enemies', () => {
  it('ignore the hero and each other: where their lines cross, each moves exactly as it does alone', () => {
    const together = playingGame(levelFromRows(CROSSING));
    const alone = ['M', 'H', 'C'].map((keep) =>
      playingGame(levelFromRows(CROSSING.map((row) => row.replace(/[MHC]/g, (ch) => (ch === keep ? ch : '.'))))),
    );
    for (let t = 1; t <= 1500; t++) {
      // The hero wanders about in the first room and stands still in the others.
      stepPlayer(together, IN(t % 90 < 45 ? 'R' : 'LJ'));
      stepEnemies(together);
      alone.forEach((game, index) => {
        stepEnemies(game);
        expect(enemyAt(together, index), `tick ${t}, enemy ${index}`).toEqual(enemyAt(game));
      });
    }
  });

  it('a destroyed enemy does not move or turn', () => {
    const game = playingGame(levelFromRows(CROSSING));
    advance(game, 10);
    const frozen = game.run.enemies.map((enemy) => {
      enemy.alive = false;
      return { ...enemy };
    });
    advance(game, 500);
    expect(game.run.enemies).toEqual(frozen);
  });

  it('a patrol depends on nothing but the ticks since the enemy was put on its cell: after a respawn it repeats tick for tick', () => {
    const level = levelFromRows(CROSSING);
    const game = playingGame(level);
    const record = (): string[] => {
      const trace: string[] = [];
      for (let t = 0; t < 700; t++) {
        stepEnemies(game);
        trace.push(game.run.enemies.map((e) => `${e.x},${e.y},${e.dir},${e.alive}`).join(' '));
      }
      return trace;
    };
    const firstLife = record();
    // A death in between: one enemy was shot, all are somewhere along their lines.
    enemyAt(game, 2).alive = false;
    respawnRun(game.run, level, P, P.respawnReadyTicks);
    expect(record()).toEqual(firstLife);
  });

  it('changes nothing but the enemies: the hero, the bolt, the score and the phase are left alone', () => {
    const game = playingGame(levelFromRows(CROSSING));
    const before = structuredClone({ ...game.run, enemies: [] });
    const session = { ...game.session };
    advance(game, 300);
    expect({ ...game.run, enemies: [] }).toEqual(before);
    expect(game.session).toEqual(session);
  });
});

// ---------------------------------------------------------------------------
// Touch (step 17, contact.ts)
// ---------------------------------------------------------------------------

/** A moth parked in open air at col 7, row 3. Nothing else is near: no hazard, no pickup, the cog far away. */
const ARENA = levelFromRows(['PTD#.......', '####.......', '...........', '.......H...', '...........', '...........']);
const EX = 7 * TILE;
const EY = 3 * TILE;

/** Puts the hero's box at (x, y) and runs steps 14 to 17: the cause of death, or null when the hero lives. */
function touch(x: number, y: number, enemyAlive = true): string | null {
  const game = playingGame(ARENA);
  const p = game.run.player;
  p.x = x;
  p.y = y;
  p.onGround = false;
  enemyAt(game).alive = enemyAlive;
  resolveContacts(game);
  return game.run.phase === 'dying' ? game.run.deathCause : null;
}

/**
 * For each side: the hero's position at which his hurt box lies flush against
 * the enemy's touch box (no overlap yet), and the one-sub-pixel step that
 * pushes it in. The hurt box is the body shrunk by hurtInsetSide/Top/Bottom;
 * the touch box is the one-tile body shrunk by enemyTouchInset all round.
 */
const SIDES: readonly { side: string; x: number; y: number; dx: number; dy: number }[] = [
  { side: 'the left', x: EX + P.enemyTouchInset - (P.heroW - P.hurtInsetSide), y: EY, dx: 1, dy: 0 },
  { side: 'the right', x: EX + TILE - P.enemyTouchInset - P.hurtInsetSide, y: EY, dx: -1, dy: 0 },
  {
    side: 'above (no stomping)',
    x: EX + ((TILE - P.heroW) >> 1),
    y: EY + P.enemyTouchInset - (P.heroH - P.hurtInsetBottom),
    dx: 0,
    dy: 1,
  },
  { side: 'below', x: EX + ((TILE - P.heroW) >> 1), y: EY + TILE - P.enemyTouchInset - P.hurtInsetTop, dx: 0, dy: -1 },
];

describe('touching an enemy', () => {
  it.each(SIDES)(
    'kills from $side: flush against the touch box is safe, one sub-pixel inside it is death by "enemy"',
    ({ x, y, dx, dy }) => {
      expect(touch(x, y)).toBeNull();
      expect(touch(x + dx, y + dy)).toBe('enemy');
    },
  );

  it('uses a touch box 10 px square inside the 16 px body: bodies may overlap by the two insets and the hero lives', () => {
    expect(TILE - 2 * P.enemyTouchInset).toBe(10 * 256);
    // Coming from the left, the hero's body is this deep inside the enemy's body and still safe.
    const flush = SIDES[0];
    if (flush === undefined) throw new Error('no cases');
    const bodyOverlap = flush.x + P.heroW - EX;
    expect(bodyOverlap).toBe(P.enemyTouchInset + P.hurtInsetSide);
    expect(touch(flush.x, flush.y)).toBeNull();
  });

  it.each(SIDES)('a destroyed enemy is harmless from $side', ({ x, y, dx, dy }) => {
    expect(touch(x + dx, y + dy, false)).toBeNull();
    // Right inside it, too.
    expect(touch(EX + ((TILE - P.heroW) >> 1), EY, false)).toBeNull();
  });

  it('a Cinderpeg that walks into a standing hero kills him on the first tick its touch box reaches his hurt box', () => {
    const game = playingGame(levelFromRows(['T......D', '........', '.P....C.', '########']));
    const p = game.run.player;
    const c = enemyAt(game);
    const hurtRight = p.x + P.heroW - P.hurtInsetSide;
    let died = 0;
    for (let t = 1; t <= 400 && died === 0; t++) {
      stepPlayer(game, NONE);
      stepEnemies(game);
      resolveContacts(game);
      if (game.run.phase === 'dying') died = t;
      else expect(c.x + P.enemyTouchInset, `tick ${t}`).toBeGreaterThanOrEqual(hurtRight);
    }
    expect(game.run.deathCause).toBe('enemy');
    expect(c.x + P.enemyTouchInset).toBeLessThan(hurtRight);
    // 72 px of gap between the two boxes at 0.5 px per tick: flush after 144 ticks, inside on the next.
    expect(died).toBe(145);
  });

  it('a hero who drops onto a Cinderpeg from above dies: landing on an enemy is a touch like any other', () => {
    // The Cinderpeg is penned into one cell (it cannot move); the hero is let go right above it.
    const game = playingGame(levelFromRows(['T...D', '.....', 'P....', '#.#C#', '#####']));
    const p = game.run.player;
    p.x = 3 * TILE + ((TILE - P.heroW) >> 1);
    p.y = 0;
    p.onGround = false;
    for (let t = 1; t <= 200 && game.run.phase === 'playing'; t++) {
      stepPlayer(game, NONE);
      stepEnemies(game);
      resolveContacts(game);
    }
    expect(game.run.phase).toBe('dying');
    expect(game.run.deathCause).toBe('enemy');
    // He never reached the floor of the pen: the Cinderpeg was in the way.
    expect(p.onGround).toBe(false);
    expect(enemyAt(game).alive).toBe(true);
  });
});
