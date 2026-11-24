/**
 * The quick pass's estimate (docs/ARCHITECTURE.md, section 9.4): how far the
 * hero still is from the trophy and then the door, in ticks.
 *
 * Breadth-first floods from a goal cell over the grid's cells, four
 * neighbours, never outside the grid. Only Empty cells are entered: walls AND
 * hazards block them. With hazards passable the shortest "path" to a goal on
 * the far side of a deck runs through the coolant set into its floor, and
 * the search piles up underneath (the three-deck fixture of the Phase 4 gate
 * exists to catch that mistake).
 *
 * Two kinds of flood, because what the hero can climb depends on its fuel:
 * - the free flood moves any way, as a hero with fuel in the tank can;
 * - the climb flood lets the hero rise at most `climbTiles` tiles since it
 *   last stood on a wall: what a plain jump can do (Sim.climbTiles measures
 *   it). A hero without fuel is estimated on the climb flood, or by way of a
 *   thruster pack (the climb flood to the pack plus the free flood from it),
 *   whichever is shorter.
 * Without the climb flood, a hole in a deck floor above an empty deck draws
 * a hero without fuel under the hole, where it cannot climb; on a level with
 * packs the quick pass then spent its whole budget there (the level-9 plan:
 * 40 M step calls without a win; with the climb flood, proven in about 8 M).
 *
 * The distance in tiles is turned into ticks at the run speed, because the
 * search's cost so far is counted in ticks.
 */
import * as units from '../types';
import type { Cell, GameState, LevelData, Phys } from '../types';
import { UNREACHABLE_TICKS } from './options';

const { TILE, TILE_SHIFT, Tile } = units;

/** Flood distance of a cell the flood never reached. */
export const FLOOD_UNREACHED = 0x3fffffff;

/**
 * Distance in tiles from every cell to `goal`, row-major like level.tiles,
 * moving any way: the free flood. A cell is entered when `passable(tile)`
 * says so; the goal cell itself is always 0. Unreached cells hold
 * FLOOD_UNREACHED.
 */
export function floodDistances(level: LevelData, goal: Cell, passable: (tile: number) => boolean): Int32Array {
  const width = level.width;
  const height = level.height;
  const tiles = level.tiles;
  const dist = new Int32Array(width * height).fill(FLOOD_UNREACHED);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const first = goal.row * width + goal.col;
  dist[first] = 0;
  queue[tail++] = first;
  while (head < tail) {
    const cell = queue[head++] ?? 0;
    const row = Math.trunc(cell / width);
    const col = cell - row * width;
    const next = (dist[cell] ?? 0) + 1;
    // Right, left, down, up; the bounds checks keep the flood inside the grid.
    const visit = (c: number, r: number): void => {
      const index = r * width + c;
      if ((dist[index] ?? 0) <= next || !passable(tiles[index] ?? Tile.Solid)) return;
      dist[index] = next;
      queue[tail++] = index;
    };
    if (col + 1 < width) visit(col + 1, row);
    if (col > 0) visit(col - 1, row);
    if (row + 1 < height) visit(col, row + 1);
    if (row > 0) visit(col, row - 1);
  }
  return dist;
}

/**
 * Distance in tiles from every cell to `goal` for a hero standing in that
 * cell, when it may rise at most `climbTiles` tiles before it stands on a
 * wall again: the climb flood. Row-major; FLOOD_UNREACHED where no such path
 * exists.
 *
 * The flood runs backwards from the goal over pairs (cell, climb left).
 * Moving up uses one tile of climb; moving sideways keeps it; moving down
 * leaves none (a falling hero cannot rise again); entering a cell with a
 * wall below gives all of it back (the hero stands there). Sideways in the
 * air keeps its climb, so a jump may rise in one column and go on rising in
 * the next: the estimate allows slightly more than a jump does, never less.
 */
export function climbDistances(
  level: LevelData,
  goal: Cell,
  climbTiles: number,
  passable: (tile: number) => boolean,
): Int32Array {
  const width = level.width;
  const height = level.height;
  const tiles = level.tiles;
  const top = Math.max(0, climbTiles);
  const levels = top + 1;
  const cells = width * height;
  const dist = new Int32Array(cells * levels).fill(FLOOD_UNREACHED);
  const queue = new Int32Array(cells * levels);
  let head = 0;
  let tail = 0;
  const goalCell = goal.row * width + goal.col;
  for (let k = 0; k < levels; k++) {
    dist[goalCell * levels + k] = 0;
    queue[tail++] = goalCell * levels + k;
  }
  const wallBelow = (col: number, row: number): boolean => row + 1 < height && tiles[(row + 1) * width + col] === Tile.Solid;
  /** A pair (col, row, k) from which one move reaches the pair being expanded, `d` tiles from the goal. */
  const visit = (col: number, row: number, k: number, d: number): void => {
    if (col < 0 || row < 0 || col >= width || row >= height) return;
    const cell = row * width + col;
    if (!passable(tiles[cell] ?? Tile.Solid)) return;
    const pair = cell * levels + k;
    if ((dist[pair] ?? 0) <= d) return;
    dist[pair] = d;
    queue[tail++] = pair;
  };
  const visitAll = (col: number, row: number, d: number): void => {
    for (let k = 0; k < levels; k++) visit(col, row, k, d);
  };
  while (head < tail) {
    const pair = queue[head++] ?? 0;
    const cell = Math.trunc(pair / levels);
    const k = pair - cell * levels;
    const row = Math.trunc(cell / width);
    const col = cell - row * width;
    const d = (dist[pair] ?? 0) + 1;
    // Each move into this cell, read backwards. A hero arriving where a wall is below stands: all climb back.
    const standing = wallBelow(col, row);
    // Up from the cell below, which had one tile more of climb.
    if (k + 1 <= top) visit(col, row + 1, k + 1, d);
    // Sideways: the climb is kept, or given back in full when it lands here.
    if (!standing) {
      visit(col - 1, row, k, d);
      visit(col + 1, row, k, d);
    } else if (k === top) {
      visitAll(col - 1, row, d);
      visitAll(col + 1, row, d);
    }
    // Down from the cell above: from any climb, arriving with none, or standing.
    if ((standing && k === top) || (!standing && k === 0)) visitAll(col, row - 1, d);
  }
  const out = new Int32Array(cells);
  for (let cell = 0; cell < cells; cell++) out[cell] = dist[cell * levels + top] ?? FLOOD_UNREACHED;
  return out;
}

/** Only Empty cells: what the validator uses. */
export const emptyOnly = (tile: number): boolean => tile === Tile.Empty;
/** Everything but walls: the mistake the three-deck fixture catches. For tests only. */
export const anythingButWalls = (tile: number): boolean => tile !== Tile.Solid;

/**
 * The cell holding the centre of the hero's box, its row kept inside the
 * grid (a hero falling out of the bottom is a step from death anyway). This
 * is the cell every report names: the flood estimate and stuckAt.
 */
export function heroCell(level: LevelData, phys: Phys, game: GameState): Cell {
  const player = game.run.player;
  const col = (player.x + (phys.heroW >> 1)) >> TILE_SHIFT;
  const row = (player.y + (phys.heroH >> 1)) >> TILE_SHIFT;
  return {
    col: Math.min(Math.max(col, 0), level.width - 1),
    row: Math.min(Math.max(row, 0), level.height - 1),
  };
}

/** A goal estimate in ticks: low is close. */
export type Estimate = (game: GameState) => number;

/**
 * For every cell, tiles to `goal` for a hero without fuel: the climb flood
 * to the goal, or the climb flood to a thruster pack plus the free flood from
 * that pack to the goal, whichever is shorter. A pack is always there for a
 * hero without fuel: taken packs come back when the tank runs dry.
 */
function withoutFuel(
  goalClimb: Int32Array,
  goalFree: Int32Array,
  packClimbs: readonly Int32Array[],
  packCells: readonly number[],
): Int32Array {
  const out = Int32Array.from(goalClimb);
  for (let p = 0; p < packClimbs.length; p++) {
    const toPack = packClimbs[p];
    const fromPack = goalFree[packCells[p] ?? 0] ?? FLOOD_UNREACHED;
    if (toPack === undefined || fromPack >= FLOOD_UNREACHED) continue;
    for (let cell = 0; cell < out.length; cell++) {
      const via = (toPack[cell] ?? FLOOD_UNREACHED) + fromPack;
      if (via < (out[cell] ?? FLOOD_UNREACHED)) out[cell] = via;
    }
  }
  return out;
}

/**
 * The flood estimate of section 9.4: from the hero's cell to the trophy and
 * on to the door, or to the door alone once the trophy is held, in tiles;
 * times TILE / runMax (about 10.7 ticks per tile on the shipped run speed),
 * rounded down. A hero with usable fuel goes by the free floods, one without
 * by withoutFuel above, the trophy-to-door leg included (so the estimate
 * never rises when a pack is taken). A cell that no flood reaches gives
 * UNREACHABLE_TICKS. `climbTiles` comes from Sim.climbTiles; `passable` is
 * emptyOnly except in the gate test that shows why.
 */
export function floodEstimate(
  level: LevelData,
  phys: Phys,
  climbTiles: number,
  passable: (tile: number) => boolean = emptyOnly,
): Estimate {
  const width = level.width;
  const cellOf = (cell: Cell): number => cell.row * width + cell.col;
  const packCells = level.pickups.flatMap((pickup) => (pickup.kind === 'thruster' ? [cellOf(pickup)] : []));
  const packClimbs = level.pickups.flatMap((pickup) =>
    pickup.kind === 'thruster' ? [climbDistances(level, pickup, climbTiles, passable)] : [],
  );
  const trophyFree = floodDistances(level, level.trophy, passable);
  const doorFree = floodDistances(level, level.door, passable);
  const trophyDry = withoutFuel(climbDistances(level, level.trophy, climbTiles, passable), trophyFree, packClimbs, packCells);
  const doorDry = withoutFuel(climbDistances(level, level.door, climbTiles, passable), doorFree, packClimbs, packCells);
  const trophyCell = cellOf(level.trophy);
  const onwardFree = doorFree[trophyCell] ?? FLOOD_UNREACHED;
  const onwardDry = doorDry[trophyCell] ?? FLOOD_UNREACHED;
  const lastRow = level.height - 1;
  const lastCol = width - 1;
  const halfW = phys.heroW >> 1;
  const halfH = phys.heroH >> 1;
  const runMax = phys.runMax;

  return (game) => {
    const player = game.run.player;
    const col = Math.min(Math.max((player.x + halfW) >> TILE_SHIFT, 0), lastCol);
    const row = Math.min(Math.max((player.y + halfH) >> TILE_SHIFT, 0), lastRow);
    const cell = row * width + col;
    const fuelled = player.hasThruster && player.fuel > 0;
    let tiles: number;
    if (game.run.hasTrophy) tiles = (fuelled ? doorFree[cell] : doorDry[cell]) ?? FLOOD_UNREACHED;
    else if (fuelled) tiles = (trophyFree[cell] ?? FLOOD_UNREACHED) + onwardFree;
    else tiles = (trophyDry[cell] ?? FLOOD_UNREACHED) + onwardDry;
    if (tiles >= FLOOD_UNREACHED) return UNREACHABLE_TICKS;
    return Math.floor((tiles * TILE) / runMax);
  };
}

/**
 * How close a state is to its goal, for stuckAt only: the flood estimate
 * `flood` where it reaches, otherwise UNREACHABLE_TICKS plus the straight
 * distance in tiles (across and up together) to the trophy and on to the
 * door, or to the door alone once the trophy is held. So a level whose goal
 * no flood can reach still names the nearest point instead of the start;
 * and on one cell, holding the trophy never counts as farther than not.
 */
export function closenessEstimate(level: LevelData, phys: Phys, flood: Estimate): Estimate {
  const { trophy, door } = level;
  const trophyToDoor = Math.abs(trophy.col - door.col) + Math.abs(trophy.row - door.row);
  return (game) => {
    const ticks = flood(game);
    if (ticks < UNREACHABLE_TICKS) return ticks;
    const cell = heroCell(level, phys, game);
    const tiles = game.run.hasTrophy
      ? Math.abs(cell.col - door.col) + Math.abs(cell.row - door.row)
      : Math.abs(cell.col - trophy.col) + Math.abs(cell.row - trophy.row) + trophyToDoor;
    return UNREACHABLE_TICKS + tiles;
  };
}
