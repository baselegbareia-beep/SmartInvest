/**
 * tilePick: which picture goes in which cell (docs/ART-AND-SOUND.md, section 6).
 *
 * The game's tile layer (src/shell/TileLayer.ts) and the scene tool (tools/scene.ts)
 * both ask here, so a level looks the same in both:
 *
 *   wallPick(grid, col, row)        wall variant and side trims of a wall cell
 *   hazardPick(grid, col, row)      hazard sprite of a fire, coolant or spikes cell
 *   hazardFrame(pick, tick)         its frame at a tick
 *   decorate(grid, seed, occupied)  far-wall panels and decoration of every other cell
 *   starField, earthSpot, ridgeTop  the backdrop
 *
 * Every answer depends only on the grid, the cell and the level's seed: there is no
 * randomness at run time. Pure: no Phaser, no DOM, runs in Node.
 *
 * From a pick to a tile number (src/art/pixels.ts):
 *
 *   const wall = wallPick(level, col, row);
 *   if (wall) layer.putTileAt(tileIndex(wallFrameName(wall.sprite, wall.trimLeft, wall.trimRight)), col, row);
 *   const deco = decorate(level, levelSeed(level.id), occupiedCells(level)).at(col, row);
 *   if (deco.panel) panels.putTileAt(tileIndex(deco.panel), col, row);
 *   if (deco.over) objects.putTileAt(tileIndex(deco.over.frame, deco.over.cellX, deco.over.cellY), col, row);
 */
import type { TileKind } from '../core/types.ts';

import { spriteSpec } from './manifest.ts';
import type { WallSpriteName } from './manifest.ts';

// ---------------------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------------------

/**
 * The tile kinds, with the numbers of `Tile` in src/core/types.ts (a test compares
 * them). Repeated here because src/art may take only types from the core.
 */
export const KIND = { Empty: 0, Solid: 1, Fire: 2, Coolant: 3, Spikes: 4 } as const satisfies Readonly<Record<string, TileKind>>;

/**
 * The grid of tile kinds, row by row: index = row * width + col. A `LevelData` of
 * the core fits as it is.
 */
export interface TileGrid {
  readonly width: number;
  readonly height: number;
  readonly tiles: ArrayLike<number>;
}

/** A tile position: 0-based, col from the left, row from the top. */
export interface CellRef {
  readonly col: number;
  readonly row: number;
}

/**
 * The kind of a cell. Outside the grid on the left, the right and the top is Solid;
 * below the bottom row is Empty (the level is open below), as in the core's tileAt.
 */
export function kindAt(grid: TileGrid, col: number, row: number): number {
  if (col < 0 || col >= grid.width || row < 0) return KIND.Solid;
  if (row >= grid.height) return KIND.Empty;
  return grid.tiles[row * grid.width + col] ?? KIND.Empty;
}

/** "Wall" in the guide's sense: a `#` cell, or any cell outside the grid on the left, right and top. */
export function isWall(grid: TileGrid, col: number, row: number): boolean {
  return kindAt(grid, col, row) === KIND.Solid;
}

function inGrid(grid: TileGrid, col: number, row: number): boolean {
  return col >= 0 && col < grid.width && row >= 0 && row < grid.height;
}

// ---------------------------------------------------------------------------------------
// Hash: a fixed integer mix, so that a level always looks the same
// ---------------------------------------------------------------------------------------

function mix(h: number): number {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A fixed mix of whole numbers into one number from 0 to 2^32 - 1. The same arguments always give the same result. */
export function hash(...values: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) h = mix(h ^ Math.imul(value | 0, 0x85ebca6b));
  return h;
}

/**
 * The seed of a level, from its id: the level number for `level-03` (3), and a fixed
 * mix of the letters for any other name (`test`, `debug`).
 */
export function levelSeed(id: string): number {
  const numbered = /^level-(\d+)$/.exec(id);
  if (numbered) return Number(numbered[1]);
  let h = 0x51ed270b;
  for (let i = 0; i < id.length; i++) h = mix(h ^ id.charCodeAt(i));
  return 1000 + (h % 1_000_000);
}

// ---------------------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------------------

export interface WallPick {
  /** The wall picture: fill, riveted fill, top, bottom or beam. */
  readonly sprite: WallSpriteName;
  /** Lay trim_left over it: the cell to the left is not wall. */
  readonly trimLeft: boolean;
  /** Lay trim_right over it: the cell to the right is not wall. */
  readonly trimRight: boolean;
}

/** One riveted plate among this many plain ones. */
const RIVETED_ONE_IN = 5;

/**
 * The picture of a wall cell, or null when the cell is not wall.
 *
 *   base = (cell above is wall ? 0 : 1) + (cell below is wall ? 0 : 2)   0 fill, 1 top, 2 bottom, 3 beam
 *
 * Below the bottom row counts as wall here (the picture ends there), so the lowest
 * row never shows an underside.
 */
export function wallPick(grid: TileGrid, col: number, row: number): WallPick | null {
  if (!inGrid(grid, col, row) || !isWall(grid, col, row)) return null;
  const wallAbove = isWall(grid, col, row - 1);
  const wallBelow = row + 1 >= grid.height || isWall(grid, col, row + 1);
  const base = (wallAbove ? 0 : 1) + (wallBelow ? 0 : 2);
  const sprite: WallSpriteName =
    base === 1
      ? 'wall_top'
      : base === 2
        ? 'wall_bottom'
        : base === 3
          ? 'wall_beam'
          : hash(col, row) % RIVETED_ONE_IN === 0
            ? 'wall_fill_b'
            : 'wall_fill';
  return { sprite, trimLeft: !isWall(grid, col - 1, row), trimRight: !isWall(grid, col + 1, row) };
}

// ---------------------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------------------

export type HazardSpriteName = 'fire' | 'coolant_top' | 'coolant_body' | 'spikes';

export interface HazardPick {
  readonly sprite: HazardSpriteName;
  /** Number of frames of the sprite. */
  readonly frames: number;
  /** Ticks each frame stays up; 0 for a picture that does not move (spikes). */
  readonly ticksPerFrame: number;
  /**
   * How many frames this cell runs ahead of the clock, so that neighbouring fires do
   * not flicker in step. Always 0 for the coolant surface: its froth drifts from tile
   * to tile and must stay in step.
   */
  readonly phaseFrames: number;
}

function hazard(sprite: HazardSpriteName, phaseFrames: number): HazardPick {
  const spec = spriteSpec(sprite);
  return { sprite, frames: spec.frames, ticksPerFrame: spec.ticksPerFrame ?? 0, phaseFrames: phaseFrames % spec.frames };
}

/**
 * The hazard picture of a cell, or null when the cell holds no hazard. A coolant cell
 * with no coolant above it is the surface; under another coolant cell it is the body.
 */
export function hazardPick(grid: TileGrid, col: number, row: number): HazardPick | null {
  if (!inGrid(grid, col, row)) return null;
  switch (kindAt(grid, col, row)) {
    case KIND.Fire:
      // Columns side by side are 3 frames apart, rows 1: never the same frame next to each other.
      return hazard('fire', col * 3 + row);
    case KIND.Coolant:
      return inGrid(grid, col, row - 1) && kindAt(grid, col, row - 1) === KIND.Coolant
        ? hazard('coolant_body', col + row)
        : hazard('coolant_top', 0);
    case KIND.Spikes:
      return hazard('spikes', 0);
    default:
      return null;
  }
}

/** The index of the frame a hazard shows at a tick (`run.tick`). */
export function hazardFrameIndex(pick: HazardPick, tick: number): number {
  if (pick.ticksPerFrame <= 0) return 0;
  const steps = Math.floor(Math.max(0, tick) / pick.ticksPerFrame);
  return (steps + pick.phaseFrames) % pick.frames;
}

/** The name of the frame a hazard shows at a tick: `fire_2`. */
export function hazardFrame(pick: HazardPick, tick: number): string {
  return `${pick.sprite}_${hazardFrameIndex(pick, tick)}`;
}

// ---------------------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------------------

export type PanelFrameName = 'bg_panel_0' | 'bg_panel_1';

export type DecorationFrameName =
  | 'bg_pipe_h_0'
  | 'bg_pipe_v_0'
  | 'bg_vent_0'
  | 'bg_brace_0'
  | 'bg_chain_0'
  | 'bg_hook_0'
  | 'bg_porthole_0';

export interface DecorationObject {
  readonly frame: DecorationFrameName;
  /** The cell inside a frame of several cells (the porthole is 2 x 2); 0, 0 for all others. */
  readonly cellX: number;
  readonly cellY: number;
}

export interface DecorationPick {
  /**
   * The far-wall panel, drawn first, or null where the backdrop shows. A porthole
   * brings its own surround and has no panel under it, so that space shows through
   * its glass.
   */
  readonly panel: PanelFrameName | null;
  /** The object drawn over the panel, or null. */
  readonly over: DecorationObject | null;
}

export interface Decoration {
  readonly width: number;
  readonly height: number;
  /** What goes in a cell. Wall cells and cells outside the grid get nothing. */
  at(col: number, row: number): DecorationPick;
}

/**
 * The cells that hold a pickup, the cog or the airlock: they get the panel only.
 * A `LevelData` of the core fits as it is.
 */
export function occupiedCells(level: {
  readonly pickups: readonly CellRef[];
  readonly trophy: CellRef;
  readonly door: CellRef;
}): CellRef[] {
  return [...level.pickups, level.trophy, level.door];
}

/** The longest chain: 1 to 3 cells of links, then the hook. */
const CHAIN_MAX_LINKS = 3;
/** A pipe run covers 2 to 4 cells. */
const PIPE_MIN_CELLS = 2;
const PIPE_MAX_CELLS = 4;

const NOTHING: DecorationPick = { panel: null, over: null };

/**
 * The far-wall panels and the decoration of a whole level (guide, section 6).
 *
 * A panel goes in every cell that is not wall and has wall among its 8 neighbours
 * (the seamed frame when `h % 4 == 0`), with `h = hash(seed, col, row)`. Over the
 * panel goes at most one object; of these rules the first that matches a cell wins:
 *
 *   1. chain     the cell above is wall and h % 9 == 0: bg_chain down 1 to 3 cells,
 *                ending in bg_hook. A chain stops one cell short of a floor, and
 *                never starts right next to another chain.
 *   2. vent      panel cell with wall on its left or right, h % 11 == 0
 *   3. pipe_h    panel cell with a panel cell to its right, h % 7 == 0: a run of
 *                2 to 4 cells to the right
 *   4. pipe_v    panel cell with a panel cell below, h % 13 == 0: a run of 2 to 4
 *                cells down
 *                A run is cut short where the panel cells or the free cells end, and
 *                left out when fewer than 2 cells would be left.
 *   5. brace     panel cell directly under a wall, h % 6 == 0
 *   6. porthole  a 2 x 2 block of panel cells, h % 23 == 0 at its top-left cell
 *
 * Objects go only in empty cells: a cell that holds a hazard, or one listed in
 * `occupied` (pickups, the cog, the airlock), gets the panel only, and a run stops
 * in front of it.
 */
export function decorate(grid: TileGrid, seed: number, occupied: Iterable<CellRef> = []): Decoration {
  const { width, height } = grid;
  const at = (col: number, row: number): number => row * width + col;
  const h = (col: number, row: number): number => hash(seed, col, row);
  /** A second, independent number per cell, for lengths. */
  const h2 = (col: number, row: number): number => hash(seed, col, row, 1);

  const taken = new Set<number>();
  for (const cell of occupied) taken.add(at(cell.col, cell.row));

  const isPanel = (col: number, row: number): boolean => {
    if (!inGrid(grid, col, row) || isWall(grid, col, row)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dy !== 0) && isWall(grid, col + dx, row + dy)) return true;
      }
    }
    return false;
  };
  const over = new Map<number, DecorationObject>();
  /** Empty, not occupied and not yet holding an object. */
  const isFree = (col: number, row: number): boolean =>
    inGrid(grid, col, row) && kindAt(grid, col, row) === KIND.Empty && !taken.has(at(col, row)) && !over.has(at(col, row));
  const put = (col: number, row: number, frame: DecorationFrameName, cellX = 0, cellY = 0): void => {
    over.set(at(col, row), { frame, cellX, cellY });
  };
  const eachCell = (visit: (col: number, row: number) => void): void => {
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) visit(col, row);
    }
  };

  const holdsChain = (col: number, row: number): boolean => {
    const frame = over.get(at(col, row))?.frame;
    return inGrid(grid, col, row) && (frame === 'bg_chain_0' || frame === 'bg_hook_0');
  };

  // 1. Chains. Never two side by side: a chain does not start next to another one.
  eachCell((col, row) => {
    if (!isFree(col, row) || !isWall(grid, col, row - 1) || h(col, row) % 9 !== 0) return;
    if (holdsChain(col - 1, row)) return;
    const links = 1 + (h2(col, row) % CHAIN_MAX_LINKS);
    let length = 0;
    // The chain hangs free: its last cell has no floor directly under it.
    while (length < links + 1 && isFree(col, row + length) && !isWall(grid, col, row + length + 1)) length++;
    for (let n = 0; n < length; n++) put(col, row + n, n === length - 1 ? 'bg_hook_0' : 'bg_chain_0');
  });

  // 2. Vents.
  eachCell((col, row) => {
    if (!isFree(col, row) || !isPanel(col, row) || h(col, row) % 11 !== 0) return;
    if (isWall(grid, col - 1, row) || isWall(grid, col + 1, row)) put(col, row, 'bg_vent_0');
  });

  // 3 and 4. Pipe runs, across and down: 2 to 4 cells, shortened where the panel run or
  // the free cells end, and left out when fewer than 2 cells are left (no stubs).
  const pipeLength = (col: number, row: number): number =>
    PIPE_MIN_CELLS + (h2(col, row) % (PIPE_MAX_CELLS - PIPE_MIN_CELLS + 1));
  const layPipe = (col: number, row: number, dx: number, dy: number, frame: DecorationFrameName): void => {
    const wanted = pipeLength(col, row);
    let cells = 0;
    while (cells < wanted && isPanel(col + cells * dx, row + cells * dy) && isFree(col + cells * dx, row + cells * dy)) cells++;
    if (cells < PIPE_MIN_CELLS) return;
    for (let n = 0; n < cells; n++) put(col + n * dx, row + n * dy, frame);
  };
  eachCell((col, row) => {
    if (isFree(col, row) && isPanel(col, row) && isPanel(col + 1, row) && h(col, row) % 7 === 0) layPipe(col, row, 1, 0, 'bg_pipe_h_0');
  });
  eachCell((col, row) => {
    if (isFree(col, row) && isPanel(col, row) && isPanel(col, row + 1) && h(col, row) % 13 === 0) layPipe(col, row, 0, 1, 'bg_pipe_v_0');
  });

  // 5. Braces.
  eachCell((col, row) => {
    if (isFree(col, row) && isPanel(col, row) && isWall(grid, col, row - 1) && h(col, row) % 6 === 0) put(col, row, 'bg_brace_0');
  });

  // 6. Portholes.
  const portholes = new Set<number>();
  eachCell((col, row) => {
    if (h(col, row) % 23 !== 0) return;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (!isPanel(col + dx, row + dy) || !isFree(col + dx, row + dy)) return;
      }
    }
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        put(col + dx, row + dy, 'bg_porthole_0', dx, dy);
        portholes.add(at(col + dx, row + dy));
      }
    }
  });

  return {
    width,
    height,
    at(col: number, row: number): DecorationPick {
      if (!inGrid(grid, col, row) || isWall(grid, col, row)) return NOTHING;
      const index = at(col, row);
      const object = over.get(index) ?? null;
      const panel: PanelFrameName | null =
        !isPanel(col, row) || portholes.has(index) ? null : h(col, row) % 4 === 0 ? 'bg_panel_1' : 'bg_panel_0';
      return { panel, over: object };
    },
  };
}

// ---------------------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------------------

/** How fast the backdrop scrolls, as a share of the camera's speed: stars, then the Earth and the ridge. */
export const PARALLAX = { stars: 0.2, far: 0.1 } as const;

/** About this many stars on a screen of STAR_SCREEN size. */
export const STARS_PER_SCREEN = 40;
const STAR_SCREEN = { width: 320, height: 180 } as const;

export interface Star {
  readonly x: number;
  readonly y: number;
  /** Palette code: '6' earthlight for the bright ones, '3' slate for the dim majority. */
  readonly code: '6' | '3';
}

/** A small seeded generator (mulberry32): numbers from 0 up to, not including, 1. */
function generator(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * The stars of a level: single pixels spread over a field of the given size (the
 * view), placed by a generator seeded with the level's seed. One star in three is
 * earthlight, the others slate.
 *
 * With a camera at (camX, camY) a star is drawn at `starShift(star.x, camX, width)`,
 * `starShift(star.y, camY, height)`: the field scrolls at PARALLAX.stars and wraps,
 * so it never runs out.
 */
export function starField(seed: number, width: number, height: number): Star[] {
  const count = Math.max(1, Math.round((STARS_PER_SCREEN * width * height) / (STAR_SCREEN.width * STAR_SCREEN.height)));
  const next = generator(hash(seed, 0x57a2));
  const stars: Star[] = [];
  for (let n = 0; n < count; n++) {
    const x = Math.floor(next() * width);
    const y = Math.floor(next() * height);
    stars.push({ x, y, code: next() < 1 / 3 ? '6' : '3' });
  }
  return stars;
}

/** Where a star coordinate lands on screen for a camera coordinate: scrolled, on a whole pixel, wrapped into the field. */
export function starShift(position: number, camera: number, fieldSize: number): number {
  const shifted = (position - Math.floor(camera * PARALLAX.stars)) % fieldSize;
  return shifted < 0 ? shifted + fieldSize : shifted;
}

/** Where a far picture (Earth, ridge) lands on screen for a camera coordinate: scrolled at PARALLAX.far, on a whole pixel. */
export function farShift(position: number, camera: number): number {
  return position - Math.floor(camera * PARALLAX.far);
}

/**
 * The top-left corner of backdrop_earth on the screen while the camera is at (0, 0):
 * in the upper half, and placed so that it is still on the screen when the camera
 * has scrolled as far as it can (`maxCamX`, `maxCamY`: level size minus view size, or
 * 0 where the level is smaller). Draw it at `farShift(x, camX)`, `farShift(y, camY)`.
 */
export function earthSpot(
  seed: number,
  viewWidth: number,
  viewHeight: number,
  maxCamX = 0,
  maxCamY = 0,
): { x: number; y: number } {
  const size = spriteSpec('backdrop_earth').width;
  const next = generator(hash(seed, 0xea27));
  const margin = 8;
  const shiftX = Math.floor(Math.max(0, maxCamX) * PARALLAX.far);
  const shiftY = Math.floor(Math.max(0, maxCamY) * PARALLAX.far);
  const minX = margin + shiftX;
  const maxX = Math.max(minX, viewWidth - size - margin);
  const minY = margin + shiftY;
  const maxY = Math.max(minY, Math.floor(viewHeight / 2) - size + shiftY);
  return {
    x: minX + Math.floor(next() * (maxX - minX + 1)),
    y: minY + Math.floor(next() * (maxY - minY + 1)),
  };
}

/**
 * The y of the top of backdrop_ridge on the screen: its base rests on the bottom of
 * the view when the camera is at the bottom of the level (`camY === maxCamY`), and
 * it sinks at PARALLAX.far as the camera climbs. Repeat the picture along x from
 * `farShift(0, camX) % ridgeWidth`.
 */
export function ridgeTop(viewHeight: number, camY = 0, maxCamY = 0): number {
  const ridgeHeight = spriteSpec('backdrop_ridge').height;
  return viewHeight - ridgeHeight + Math.floor(Math.max(0, maxCamY - camY) * PARALLAX.far);
}
