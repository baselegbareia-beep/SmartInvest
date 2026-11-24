import { describe, expect, it } from 'vitest';

import { boxHitsSolid, isSolid, tileAt } from './tiles';
import { Tile, TILE, TILE_SHIFT } from './types';
import type { LevelData, TileKind } from './types';

/**
 * A bare grid for these tests: '#' wall, 'F' fire, 'W' coolant, 'S' spikes,
 * anything else empty. Built by hand, not by parseLevel, so that a grid here
 * needs no start, trophy or door and the test depends on tiles.ts alone.
 */
function grid(rows: readonly string[]): LevelData {
  const width = rows[0]?.length ?? 0;
  const kinds: Record<string, TileKind> = { '#': Tile.Solid, F: Tile.Fire, W: Tile.Coolant, S: Tile.Spikes };
  const tiles = new Uint8Array(width * rows.length);
  rows.forEach((line, row) => {
    for (let col = 0; col < width; col++) {
      tiles[row * width + col] = kinds[line.charAt(col)] ?? Tile.Empty;
    }
  });
  const nowhere = { col: 0, row: 0 };
  return {
    id: 'grid',
    name: 'grid',
    teaches: '',
    hardest: null,
    requires: [],
    width,
    height: rows.length,
    tiles,
    start: nowhere,
    trophy: nowhere,
    door: nowhere,
    pickups: [],
    enemies: [],
  };
}

/** 5 columns by 3 rows: wider than tall, so swapped row and column indices show. */
const ROOM = grid([
  '.#.FW', //
  '..S..',
  '#...#',
]);

describe('tileAt', () => {
  it('reads the grid row by row: index = row * width + col', () => {
    expect(tileAt(ROOM, 0, 0)).toBe(Tile.Empty);
    expect(tileAt(ROOM, 1, 0)).toBe(Tile.Solid);
    expect(tileAt(ROOM, 3, 0)).toBe(Tile.Fire);
    expect(tileAt(ROOM, 4, 0)).toBe(Tile.Coolant);
    expect(tileAt(ROOM, 2, 1)).toBe(Tile.Spikes);
    expect(tileAt(ROOM, 0, 2)).toBe(Tile.Solid);
    expect(tileAt(ROOM, 4, 2)).toBe(Tile.Solid);
    expect(tileAt(ROOM, 3, 2)).toBe(Tile.Empty);
  });

  it('calls every cell left of, right of and above the grid Solid', () => {
    for (let row = -2; row <= ROOM.height + 2; row++) {
      expect(tileAt(ROOM, -1, row), `left, row ${row}`).toBe(Tile.Solid);
      expect(tileAt(ROOM, ROOM.width, row), `right, row ${row}`).toBe(Tile.Solid);
    }
    for (let col = -2; col <= ROOM.width + 2; col++) {
      expect(tileAt(ROOM, col, -1), `above, col ${col}`).toBe(Tile.Solid);
    }
  });

  it('calls every cell below the grid Empty, but only between the side walls', () => {
    for (let col = 0; col < ROOM.width; col++) {
      expect(tileAt(ROOM, col, ROOM.height), `col ${col}`).toBe(Tile.Empty);
      expect(tileAt(ROOM, col, ROOM.height + 7), `col ${col}, far below`).toBe(Tile.Empty);
    }
    expect(tileAt(ROOM, -1, ROOM.height)).toBe(Tile.Solid);
    expect(tileAt(ROOM, ROOM.width, ROOM.height)).toBe(Tile.Solid);
  });
});

describe('isSolid', () => {
  it('is true for walls only: fire, coolant and spikes do not block', () => {
    expect(isSolid(ROOM, 1, 0)).toBe(true);
    expect(isSolid(ROOM, 0, 0)).toBe(false);
    expect(isSolid(ROOM, 3, 0)).toBe(false);
    expect(isSolid(ROOM, 4, 0)).toBe(false);
    expect(isSolid(ROOM, 2, 1)).toBe(false);
  });

  it('follows the out-of-grid policy of tileAt', () => {
    expect(isSolid(ROOM, -1, 1)).toBe(true);
    expect(isSolid(ROOM, ROOM.width, 1)).toBe(true);
    expect(isSolid(ROOM, 2, -1)).toBe(true);
    expect(isSolid(ROOM, 2, ROOM.height)).toBe(false);
  });
});

describe('boxHitsSolid', () => {
  it('treats boxes as half-open: touching a wall is not hitting it, one sub-pixel further is', () => {
    // The wall cell (1, 0) spans x 4096..8191; the empty cell (2, 0) is on its right, (0, 0) on its left.
    expect(boxHitsSolid(ROOM, 0, 0, TILE, TILE)).toBe(false);
    expect(boxHitsSolid(ROOM, 1, 0, TILE, TILE)).toBe(true);
    expect(boxHitsSolid(ROOM, 2 * TILE, 0, 100, 100)).toBe(false);
    expect(boxHitsSolid(ROOM, 2 * TILE - 1, 0, 100, 100)).toBe(true);
    // Above the wall (0, 2): a box ending exactly on its top edge stands clear.
    expect(boxHitsSolid(ROOM, 0, TILE, 100, TILE)).toBe(false);
    expect(boxHitsSolid(ROOM, 0, TILE + 1, 100, TILE)).toBe(true);
  });

  it('finds a wall anywhere inside a box that spans several cells', () => {
    const open = grid(['.....', '.....', '.....', '.....']);
    const pillar = grid(['.....', '..#..', '.....', '.....']);
    expect(boxHitsSolid(open, 100, 100, 4 * TILE, 3 * TILE)).toBe(false);
    expect(boxHitsSolid(pillar, 100, 100, 4 * TILE, 3 * TILE)).toBe(true);
    expect(boxHitsSolid(pillar, 100, 2 * TILE, 4 * TILE, TILE)).toBe(false);
  });

  it('does not count fire, coolant or spikes as solid', () => {
    const hazards = grid(['FWS', 'SFW']);
    expect(boxHitsSolid(hazards, 0, 0, 3 * TILE, 2 * TILE)).toBe(false);
  });

  it('is walled on the left, on the right and above, also for a box of one sub-pixel', () => {
    const open = grid(['...', '...']);
    expect(boxHitsSolid(open, 0, 0, 3 * TILE, 2 * TILE)).toBe(false);
    expect(boxHitsSolid(open, -1, 100, 1, 1)).toBe(true);
    expect(boxHitsSolid(open, 3 * TILE, 100, 1, 1)).toBe(true);
    expect(boxHitsSolid(open, 100, -1, 1, 1)).toBe(true);
    expect(boxHitsSolid(open, 3 * TILE - 1, 100, 2, 1)).toBe(true);
  });

  it('is open below the grid, and the side walls go on below it', () => {
    const open = grid(['...', '...']);
    expect(boxHitsSolid(open, 100, 2 * TILE - 50, 100, 100)).toBe(false);
    expect(boxHitsSolid(open, 100, 5 * TILE, 100, 100)).toBe(false);
    expect(boxHitsSolid(open, -1, 5 * TILE, 100, 100)).toBe(true);
    expect(boxHitsSolid(open, 3 * TILE - 99, 5 * TILE, 100, 100)).toBe(true);
  });

  it('agrees with a cell-by-cell scan through tileAt for boxes all over and around the grid', () => {
    const room = grid([
      '.#..S.#', //
      '...#...',
      'W.....#',
      '..##F..',
    ]);
    const scan = (x: number, y: number, w: number, h: number): boolean => {
      for (let row = y >> TILE_SHIFT; row <= (y + h - 1) >> TILE_SHIFT; row++) {
        for (let col = x >> TILE_SHIFT; col <= (x + w - 1) >> TILE_SHIFT; col++) {
          if (tileAt(room, col, row) === Tile.Solid) return true;
        }
      }
      return false;
    };
    // A fixed pseudo-random sequence: the core's tests may not use Math.random.
    let seed = 12345;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const spanX = (room.width + 4) * TILE;
    const spanY = (room.height + 4) * TILE;
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      const x = next(spanX) - 2 * TILE;
      const y = next(spanY) - 2 * TILE;
      // Mostly hero-sized boxes, sometimes one sub-pixel, sometimes several tiles.
      const w = i % 7 === 0 ? 1 : i % 5 === 0 ? 1 + next(3 * TILE) : 1 + next(TILE);
      const h = i % 11 === 0 ? 1 : i % 3 === 0 ? 1 + next(3 * TILE) : 1 + next(TILE);
      const expected = scan(x, y, w, h);
      if (expected) hits++;
      if (boxHitsSolid(room, x, y, w, h) !== expected) {
        expect.fail(`box x=${x} y=${y} w=${w} h=${h}: boxHitsSolid says ${!expected}, the scan says ${expected}`);
      }
    }
    // The sample must hold both answers, or it proves nothing.
    expect(hits).toBeGreaterThan(2000);
    expect(hits).toBeLessThan(18000);
  });
});
