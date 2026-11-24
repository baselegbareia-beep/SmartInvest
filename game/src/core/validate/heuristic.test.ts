import { describe, expect, it } from 'vitest';

import { createSession } from '../game';
import { levelFromRows, REFERENCE_PHYS } from '../testkit';
import type { GameState, LevelData } from '../types';
import { TILE } from '../types';
import {
  FLOOD_UNREACHED,
  anythingButWalls,
  climbDistances,
  closenessEstimate,
  emptyOnly,
  floodDistances,
  floodEstimate,
  heroCell,
} from './heuristic';
import { DEFAULT_OPTIONS, UNREACHABLE_TICKS } from './options';
import { Sim } from './successors';

const P = REFERENCE_PHYS;
/** What a plain jump climbs on the reference tuning, measured as validateLevel measures it. */
const CLIMB = new Sim(levelFromRows(['######', '#P.TD#', '######']), P, DEFAULT_OPTIONS).climbTiles();
const ticksOf = (tiles: number): number => Math.floor((tiles * TILE) / P.runMax);

/** A game on `level` with the hero's box centred on the cell (col, row). */
function heroAt(level: LevelData, col: number, row: number, hasTrophy = false): GameState {
  const game = createSession([level], P);
  game.run.player.x = col * TILE + ((TILE - P.heroW) >> 1);
  game.run.player.y = row * TILE + ((TILE - P.heroH) >> 1);
  game.run.hasTrophy = hasTrophy;
  return game;
}

const at = (dist: Int32Array, level: LevelData, col: number, row: number): number => dist[row * level.width + col] ?? -1;

describe('floodDistances', () => {
  // A coolant pool set into the floor of the upper deck: the only gap between the decks.
  const level = levelFromRows(
    ['#########', '#T......#', '####WW###', '#P.....D#', '#########'],
    { id: 'decks' },
  );

  it('counts tiles from the goal over Empty cells, four neighbours; walls and hazards both block', () => {
    const dist = floodDistances(level, level.trophy, emptyOnly);
    expect(at(dist, level, 1, 1)).toBe(0);
    expect(at(dist, level, 7, 1)).toBe(6);
    // The pool blocks: the lower deck is not reached at all, and neither is the pool.
    expect(at(dist, level, 4, 2)).toBe(FLOOD_UNREACHED);
    expect(at(dist, level, 1, 3)).toBe(FLOOD_UNREACHED);
    expect(at(dist, level, 0, 0)).toBe(FLOOD_UNREACHED);
  });

  it('with hazards passable the "path" runs through the pool: the mistake the three-deck gate catches', () => {
    const dist = floodDistances(level, level.trophy, anythingButWalls);
    expect(at(dist, level, 4, 2)).toBe(4);
    expect(at(dist, level, 4, 3)).toBe(5);
    expect(at(dist, level, 1, 3)).toBe(8);
  });

  it('stays inside the grid on an open grid (no frame)', () => {
    const open = levelFromRows(['T...', '....', 'P..D', '####']);
    const dist = floodDistances(open, open.trophy, emptyOnly);
    expect(at(dist, open, 3, 2)).toBe(5);
    expect(Array.from(dist).filter((d) => d === FLOOD_UNREACHED)).toHaveLength(4);
  });
});

describe('floodEstimate', () => {
  const level = levelFromRows(['##########', '#........#', '#P...T..D#', '##########'], { id: 'line' });

  it('is in ticks: tiles to the cog and on to the airlock, times TILE / runMax, rounded down', () => {
    const estimate = floodEstimate(level, P, CLIMB);
    // From the start: 4 tiles to the cog, then 3 to the airlock.
    expect(estimate(heroAt(level, 1, 2))).toBe(Math.floor((7 * TILE) / P.runMax));
    expect(Math.floor((7 * TILE) / P.runMax)).toBe(74);
    // Holding the cog: to the airlock only.
    expect(estimate(heroAt(level, 1, 2, true))).toBe(Math.floor((7 * TILE) / P.runMax));
    expect(estimate(heroAt(level, 5, 2, true))).toBe(Math.floor((3 * TILE) / P.runMax));
    expect(estimate(heroAt(level, 8, 2, true))).toBe(0);
  });

  it('gives a cell the flood cannot reach a large constant, never a refusal', () => {
    const walled = levelFromRows(['##########', '#....#...#', '#P...#T.D#', '##########'], { id: 'walled' });
    expect(floodEstimate(walled, P, CLIMB)(heroAt(walled, 1, 2))).toBe(UNREACHABLE_TICKS);
  });
});

describe('climbDistances and the estimate without fuel', () => {
  it('measures the climb of a plain jump on the reference tuning: 3.3 tiles and the ledge catch, rounded up', () => {
    expect(CLIMB).toBe(4);
  });

  // An upper deck whose floor has a hole 2 tiles wide above an empty lower deck: 5 tiles from the lower floor up
  // to the upper one. A jump climbs 4, so for a hero without fuel the hole leads nowhere; a pack stands at the
  // east end of the lower deck.
  const rows = [
    '##############',
    '#T..........D#',
    '#............#',
    '#............#',
    '######..######',
    '#............#',
    '#............#',
    '#............#',
    '#P..........J#',
    '##############',
  ];
  const level = levelFromRows(rows, { id: 'hole' });
  /** Up the hole from column 6 (5 tiles), then 5 tiles west and 2 up to the cog. */
  const holeToTrophy = 5 + 5 + 2;
  /** From the pack 6 tiles west to the hole, then on to the cog. */
  const packToTrophy = 6 + holeToTrophy;
  const trophyToDoor = 11;

  it('lets a hero rise only as far as a jump climbs since it last stood; the free flood climbs anywhere', () => {
    const free = floodDistances(level, level.trophy, emptyOnly);
    const climb = climbDistances(level, level.trophy, CLIMB, emptyOnly);
    // Under the hole the free flood goes straight up through it; the climb flood finds no way at all.
    expect(at(free, level, 6, 8)).toBe(holeToTrophy);
    expect(at(climb, level, 6, 8)).toBe(FLOOD_UNREACHED);
    // On the upper deck everything is within a jump: both agree.
    expect(at(climb, level, 9, 3)).toBe(at(free, level, 9, 3));
    // With 5 tiles of climb the hole is enough.
    expect(at(climbDistances(level, level.trophy, 5, emptyOnly), level, 6, 8)).toBe(holeToTrophy);
  });

  it('keeps the climb left when the hero moves sideways in the air: up, across over a pit, up again', () => {
    // The start has a ceiling 2 tiles up and a pit beside it; the cog is on a ledge 2 tiles up past the pit.
    const pit = levelFromRows(['######', '##.TD#', '#..###', '#P.###', '##.###', '##.###'], { id: 'pit' });
    const free = floodDistances(pit, pit.trophy, emptyOnly);
    expect(at(free, pit, 1, 3)).toBe(4);
    expect(at(climbDistances(pit, pit.trophy, 2, emptyOnly), pit, 1, 3)).toBe(4);
    expect(at(climbDistances(pit, pit.trophy, 1, emptyOnly), pit, 1, 3)).toBe(FLOOD_UNREACHED);
  });

  it('estimates a hero without fuel by way of a pack, and one with fuel on the free flood', () => {
    const estimate = floodEstimate(level, P, CLIMB);
    // At the start: 11 tiles east to the pack, then the free flood from it (up through the hole), then the airlock.
    expect(estimate(heroAt(level, 1, 8))).toBe(ticksOf(11 + packToTrophy + trophyToDoor));
    // Under the hole without fuel: on the way to the pack, so nearer than the start, but not drawn to the hole.
    const under = heroAt(level, 6, 8);
    expect(estimate(under)).toBe(ticksOf(6 + packToTrophy + trophyToDoor));
    expect(estimate(under)).toBeGreaterThan(estimate(heroAt(level, 7, 8)));
    // With fuel the hole is the way: the free flood.
    under.run.player.hasThruster = true;
    under.run.player.fuel = P.fuelTicks;
    expect(estimate(under)).toBe(ticksOf(holeToTrophy + trophyToDoor));
    // An empty tank counts as no fuel.
    under.run.player.fuel = 0;
    expect(estimate(under)).toBe(ticksOf(6 + packToTrophy + trophyToDoor));
  });

  it('takes the trophy-to-door leg of a hero without fuel by way of a pack too', () => {
    // The cog on the lower deck, the airlock on the upper one: from the cog the free flood goes up the hole
    // (5 + 11 tiles), a hero without fuel must first walk 10 tiles east to the pack and back under the hole.
    const swapped = levelFromRows(
      rows.map((line) => line.replace('T', 'X').replace('D', '.').replace('#P.', '#PT').replace('X', 'D')),
      { id: 'hole-door-up' },
    );
    expect([swapped.trophy, swapped.door]).toEqual([{ col: 2, row: 8 }, { col: 1, row: 1 }]);
    const estimate = floodEstimate(swapped, P, CLIMB);
    const freeOnward = at(floodDistances(swapped, swapped.door, emptyOnly), swapped, 2, 8);
    expect(freeOnward).toBe(4 + 5 + 5 + 2);
    const dryOnward = 10 + (6 + 5 + 5 + 2);
    // Standing on the cog's cell without fuel: the whole way round by the pack.
    const atCog = heroAt(swapped, 2, 8);
    expect(estimate(atCog)).toBe(ticksOf(dryOnward));
    // With fuel, the free flood all the way.
    atCog.run.player.hasThruster = true;
    atCog.run.player.fuel = P.fuelTicks;
    expect(estimate(atCog)).toBe(ticksOf(freeOnward));
  });

  it('without a pack, a hero that cannot climb to the goal is far away, not near the hole', () => {
    const noPack = levelFromRows(
      rows.map((line) => line.replace('J', '.')),
      { id: 'hole-no-pack' },
    );
    expect(floodEstimate(noPack, P, CLIMB)(heroAt(noPack, 6, 8))).toBe(UNREACHABLE_TICKS);
  });
});

describe('heroCell and closenessEstimate', () => {
  const level = levelFromRows(['##########', '#....#...#', '#P...#T.D#', '##########'], { id: 'walled' });

  it('names the cell of the centre of the hero box, kept inside the grid', () => {
    expect(heroCell(level, P, createSession([level], P))).toEqual({ col: 1, row: 2 });
    const below = heroAt(level, 3, 2);
    below.run.player.y = level.height * TILE + 5 * TILE;
    expect(heroCell(level, P, below)).toEqual({ col: 3, row: level.height - 1 });
  });

  it('falls back to the straight distance where the flood cannot reach; on one cell the cog never counts against', () => {
    const closeness = closenessEstimate(level, P, floodEstimate(level, P, CLIMB));
    const far = closeness(heroAt(level, 1, 2));
    const near = closeness(heroAt(level, 4, 2));
    // Five tiles to the cog, two more from the cog to the airlock.
    expect(far).toBe(UNREACHABLE_TICKS + 5 + 2);
    expect(near).toBe(UNREACHABLE_TICKS + 2 + 2);
    for (const [col, row] of [[1, 1], [4, 2], [2, 1]] as const) {
      expect(closeness(heroAt(level, col, row, true))).toBeLessThanOrEqual(closeness(heroAt(level, col, row)));
    }
    // Where the flood reaches, closeness is the flood estimate itself.
    const open = levelFromRows(['##########', '#........#', '#P...T..D#', '##########'], { id: 'line' });
    const flood = floodEstimate(open, P, CLIMB);
    expect(closenessEstimate(open, P, flood)(heroAt(open, 1, 2))).toBe(flood(heroAt(open, 1, 2)));
  });
});
