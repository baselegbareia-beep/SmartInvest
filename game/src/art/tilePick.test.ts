/**
 * The rules of docs/ART-AND-SOUND.md, section 6, one by one: wall variants and trims,
 * hazard pictures and their clocks, decoration, and the backdrop.
 *
 * Grids are written here as text, with the legend of docs/LEVELS.md (section 1), so
 * each test shows the room it is about.
 */
import { describe, expect, it } from 'vitest';

import { Tile } from '../core/types.ts';

import { frameNamesOf, spriteSpec } from './manifest.ts';
import type { WallSpriteName } from './manifest.ts';
import {
  KIND,
  PARALLAX,
  STARS_PER_SCREEN,
  decorate,
  earthSpot,
  farShift,
  hash,
  hazardFrame,
  hazardFrameIndex,
  hazardPick,
  isWall,
  kindAt,
  levelSeed,
  occupiedCells,
  ridgeTop,
  starField,
  starShift,
  wallPick,
} from './tilePick.ts';
import type { CellRef, Decoration, DecorationFrameName, TileGrid } from './tilePick.ts';

// ---------------------------------------------------------------------------------------
// Rooms as text
// ---------------------------------------------------------------------------------------

interface Room extends TileGrid {
  /** Cells of 'P', 'T', 'D', 'G', 'B', 'J' (pickups, cog, airlock, start). */
  readonly things: readonly (CellRef & { readonly ch: string })[];
}

const KIND_OF: Readonly<Record<string, number>> = { '#': KIND.Solid, F: KIND.Fire, W: KIND.Coolant, S: KIND.Spikes };

function room(...rows: string[]): Room {
  const width = rows[0]?.length ?? 0;
  const tiles: number[] = [];
  const things: (CellRef & { ch: string })[] = [];
  rows.forEach((line, row) => {
    expect(line.length, `row ${row} of the test room`).toBe(width);
    for (let col = 0; col < line.length; col++) {
      const ch = line.charAt(col);
      tiles.push(KIND_OF[ch] ?? KIND.Empty);
      if ('PTDGBJ'.includes(ch)) things.push({ col, row, ch });
    }
  });
  return { width, height: rows.length, tiles, things };
}

/** The occupied cells of a room: pickups, the cog and the airlock (not the start). */
function occupied(r: Room): CellRef[] {
  return r.things.filter((t) => t.ch !== 'P');
}

function eachCell(grid: TileGrid, visit: (col: number, row: number) => void): void {
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) visit(col, row);
  }
}

/** A big room with everything the decoration rules look at: ceilings, ledges, pillars, pits, hazards and things. */
const HALL = room(
  '################################################',
  '#..............................................#',
  '#.......................#####..................#',
  '#.......................#####..................#',
  '#..........G...................................#',
  '#......#######.................T..........#....#',
  '#..............................####.......#....#',
  '#.........................................#....#',
  '#...####.............###..................#....#',
  '#...........G....................###...........#',
  '#.P....S..F.....J.......B..............G.....D.#',
  '###########..######WWW#####....#################',
  '##########....#####WWW#####....#################',
  '################################################',
);

// ---------------------------------------------------------------------------------------
// The grid and its edges
// ---------------------------------------------------------------------------------------

describe('the grid', () => {
  it('numbers the tile kinds as the core does', () => {
    expect(KIND).toEqual(Tile);
  });

  it('counts outside the grid on the left, the right and the top as wall, and below the bottom as open', () => {
    const r = room('...', '...');
    expect(isWall(r, -1, 0)).toBe(true);
    expect(isWall(r, 3, 1)).toBe(true);
    expect(isWall(r, 1, -1)).toBe(true);
    expect(isWall(r, 1, 2)).toBe(false);
    expect(kindAt(r, 1, 2)).toBe(KIND.Empty);
    expect(isWall(r, 1, 1)).toBe(false);
  });

  it('treats hazards as not wall', () => {
    const r = room('#FWS#');
    expect([0, 1, 2, 3, 4].map((col) => isWall(r, col, 0))).toEqual([true, false, false, false, true]);
  });
});

// ---------------------------------------------------------------------------------------
// Wall variant (section 6)
// ---------------------------------------------------------------------------------------

describe('wall variant', () => {
  /** The guide's rule written out once more, independently of the code under test. */
  function expectedBase(r: TileGrid, col: number, row: number): number {
    const wall = (c: number, w: number): boolean =>
      c < 0 || c >= r.width || w < 0 || w >= r.height || (r.tiles[w * r.width + c] ?? 0) === KIND.Solid;
    return (wall(col, row - 1) ? 0 : 1) + (wall(col, row + 1) ? 0 : 2);
  }
  const BASE_SPRITE: readonly WallSpriteName[] = ['wall_fill', 'wall_top', 'wall_bottom', 'wall_beam'];

  it('picks fill, top, bottom or beam from the cells above and below', () => {
    const r = room(
      '#####', //
      '#...#',
      '#.#.#',
      '#.#.#',
      '#...#',
      '#.#.#',
      '#...#',
      '#####',
    );
    expect(wallPick(r, 2, 2)?.sprite).toBe('wall_top'); // empty above, wall below
    expect(wallPick(r, 2, 3)?.sprite).toBe('wall_bottom'); // wall above, empty below
    expect(wallPick(r, 2, 5)?.sprite).toBe('wall_beam'); // empty above and below
    expect(wallPick(r, 2, 0)?.sprite).toBe('wall_bottom'); // the ceiling: outside above counts as wall
    expect(['wall_fill', 'wall_fill_b']).toContain(wallPick(r, 0, 3)?.sprite); // wall above and below
  });

  it('counts the bottom edge of the grid as wall, so the lowest row never shows an underside', () => {
    const r = room(
      '#...#', //
      '#.#.#',
    );
    expect(wallPick(r, 2, 1)?.sprite).toBe('wall_top'); // not a beam
    expect(['wall_fill', 'wall_fill_b']).toContain(wallPick(r, 0, 1)?.sprite); // not a bottom
  });

  it('follows the rule on every wall cell of a whole hall', () => {
    eachCell(HALL, (col, row) => {
      const pick = wallPick(HALL, col, row);
      if (!isWall(HALL, col, row)) {
        expect(pick, `${col},${row}`).toBeNull();
        return;
      }
      const base = expectedBase(HALL, col, row);
      const riveted = base === 0 && hash(col, row) % 5 === 0;
      expect(pick?.sprite, `${col},${row}`).toBe(riveted ? 'wall_fill_b' : BASE_SPRITE[base]);
    });
  });

  it('rivets about one plain plate in five, by hash(col, row) % 5, and nothing else', () => {
    const solid = room(...Array.from({ length: 24 }, () => '#'.repeat(64)));
    let riveted = 0;
    eachCell(solid, (col, row) => {
      const sprite = wallPick(solid, col, row)?.sprite;
      expect(sprite === 'wall_fill_b', `${col},${row}`).toBe(hash(col, row) % 5 === 0);
      if (sprite === 'wall_fill_b') riveted++;
    });
    const share = riveted / (64 * 24);
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    // Never on a cap, a lip or a girder.
    const caps = room('................', '################', '................');
    for (let col = 0; col < 16; col++) expect(wallPick(caps, col, 1)?.sprite).toBe('wall_beam');
  });

  it('lays a trim on each side whose neighbour is not wall', () => {
    const r = room(
      '#######', //
      '#.....#',
      '#..#..#',
      '#.##F.#',
      '#######',
    );
    expect(wallPick(r, 3, 2)).toMatchObject({ trimLeft: true, trimRight: true }); // a lone pillar top
    expect(wallPick(r, 2, 3)).toMatchObject({ trimLeft: true, trimRight: false });
    expect(wallPick(r, 3, 3)).toMatchObject({ trimLeft: false, trimRight: true }); // fire is not wall
    expect(wallPick(r, 0, 2)).toMatchObject({ trimLeft: false, trimRight: true }); // outside the grid is wall
    expect(wallPick(r, 6, 2)).toMatchObject({ trimLeft: true, trimRight: false });
    expect(wallPick(r, 3, 0)).toMatchObject({ trimLeft: false, trimRight: false });
  });

  it('gives nothing for cells that are not wall or are outside the grid', () => {
    const r = room('#.FWS#');
    for (const col of [1, 2, 3, 4]) expect(wallPick(r, col, 0)).toBeNull();
    expect(wallPick(r, -1, 0)).toBeNull();
    expect(wallPick(r, 0, -1)).toBeNull();
    expect(wallPick(r, 0, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Hazards (section 6)
// ---------------------------------------------------------------------------------------

describe('hazards', () => {
  const pool = room(
    '#...........#', //
    '#.FFF..S..WW#',
    '#.FFF..S..WW#',
    '###########W#',
    '###########W#',
  );

  it('uses fire for F, spikes for S, and the coolant surface or body for W', () => {
    expect(hazardPick(pool, 2, 1)?.sprite).toBe('fire');
    expect(hazardPick(pool, 7, 1)?.sprite).toBe('spikes');
    expect(hazardPick(pool, 10, 1)?.sprite).toBe('coolant_top'); // no coolant above
    expect(hazardPick(pool, 10, 2)?.sprite).toBe('coolant_body'); // under coolant
    expect(hazardPick(pool, 11, 4)?.sprite).toBe('coolant_body');
    expect(hazardPick(room('W'), 0, 0)?.sprite).toBe('coolant_top'); // outside above is wall, not coolant
  });

  it('gives nothing for empty cells, walls and cells outside the grid', () => {
    expect(hazardPick(pool, 1, 1)).toBeNull();
    expect(hazardPick(pool, 0, 1)).toBeNull();
    expect(hazardPick(pool, -1, 1)).toBeNull();
    expect(hazardPick(pool, 2, 5)).toBeNull();
  });

  it('takes frame counts and ticks per frame from the manifest', () => {
    for (const [col, row] of [
      [2, 1],
      [7, 1],
      [10, 1],
      [10, 2],
    ] as const) {
      const pick = hazardPick(pool, col, row);
      if (!pick) throw new Error(`no hazard at ${col},${row}`);
      const spec = spriteSpec(pick.sprite);
      expect(pick.frames).toBe(spec.frames);
      expect(pick.ticksPerFrame).toBe(spec.ticksPerFrame ?? 0);
    }
  });

  it('swaps the fire picture every 8 ticks and loops through its 4 frames', () => {
    const fire = hazardPick(pool, 2, 1);
    if (!fire) throw new Error('no fire');
    const first = hazardFrameIndex(fire, 0);
    for (let tick = 0; tick < 8; tick++) expect(hazardFrameIndex(fire, tick)).toBe(first);
    expect(hazardFrameIndex(fire, 8)).toBe((first + 1) % 4);
    expect(hazardFrameIndex(fire, 32)).toBe(first);
    const seen = new Set(Array.from({ length: 32 }, (_, tick) => hazardFrame(fire, tick)));
    expect([...seen].sort()).toEqual(frameNamesOf(spriteSpec('fire')));
  });

  it('never shows the same fire frame in two neighbouring cells', () => {
    for (let tick = 0; tick < 64; tick += 4) {
      for (const [col, row, dc, dr] of [
        [2, 1, 1, 0],
        [3, 1, 1, 0],
        [2, 1, 0, 1],
        [4, 1, 0, 1],
      ] as const) {
        const a = hazardPick(pool, col, row);
        const b = hazardPick(pool, col + dc, row + dr);
        if (!a || !b) throw new Error('no fire');
        expect(hazardFrame(a, tick), `tick ${tick}, ${col},${row} and its neighbour`).not.toBe(hazardFrame(b, tick));
      }
    }
  });

  it('keeps every coolant surface in step, so the froth of a wide pool joins up', () => {
    const wide = room('#WWWWWWW#', '#WWWWWWW#', '#########');
    for (let tick = 0; tick < 120; tick += 5) {
      const frames = new Set(Array.from({ length: 7 }, (_, n) => {
        const pick = hazardPick(wide, n + 1, 0);
        return pick ? hazardFrame(pick, tick) : '';
      }));
      expect(frames.size).toBe(1);
    }
    const top = hazardPick(wide, 1, 0);
    if (!top) throw new Error('no coolant');
    expect(hazardFrame(top, 0)).toBe('coolant_top_0');
    expect(hazardFrame(top, 15)).toBe('coolant_top_1');
  });

  it('shows the spikes still', () => {
    const spikes = hazardPick(pool, 7, 1);
    if (!spikes) throw new Error('no spikes');
    for (const tick of [0, 1, 59, 1000]) expect(hazardFrame(spikes, tick)).toBe('spikes_0');
  });
});

// ---------------------------------------------------------------------------------------
// Decoration (section 6)
// ---------------------------------------------------------------------------------------

describe('decoration', () => {
  const SEED = levelSeed('level-04');
  const h = (col: number, row: number, seed = SEED): number => hash(seed, col, row);
  const touchesWall = (grid: TileGrid, col: number, row: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && isWall(grid, col + dx, row + dy)) return true;
    }
    return false;
  };
  const objectAt = (d: Decoration, col: number, row: number): DecorationFrameName | undefined => d.at(col, row).over?.frame;

  /** The hall under many seeds, so that every rule fires somewhere. */
  const SEEDS = Array.from({ length: 40 }, (_, n) => n + 1);
  const decorations = SEEDS.map((seed) => ({ seed, d: decorate(HALL, seed, occupied(HALL)) }));

  it('lays a far-wall panel in every empty cell that has wall among its 8 neighbours, and nowhere else', () => {
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const pick = d.at(col, row);
        if (isWall(HALL, col, row)) return;
        const porthole = pick.over?.frame === 'bg_porthole_0';
        expect(pick.panel !== null || porthole, `seed ${seed}, ${col},${row}`).toBe(touchesWall(HALL, col, row));
      });
    }
  });

  it('uses the seamed panel when h % 4 == 0 and the plain one otherwise', () => {
    const d = decorate(HALL, SEED, occupied(HALL));
    let seamed = 0;
    eachCell(HALL, (col, row) => {
      const panel = d.at(col, row).panel;
      if (panel === null) return;
      expect(panel, `${col},${row}`).toBe(h(col, row) % 4 === 0 ? 'bg_panel_1' : 'bg_panel_0');
      if (panel === 'bg_panel_1') seamed++;
    });
    expect(seamed).toBeGreaterThan(0);
  });

  it('puts nothing in wall cells or outside the grid', () => {
    const d = decorate(HALL, SEED, occupied(HALL));
    eachCell(HALL, (col, row) => {
      if (isWall(HALL, col, row)) expect(d.at(col, row), `${col},${row}`).toEqual({ panel: null, over: null });
    });
    expect(d.at(-1, 3)).toEqual({ panel: null, over: null });
    expect(d.at(3, HALL.height)).toEqual({ panel: null, over: null });
  });

  it('gives cells holding a pickup, the cog, the airlock or a hazard the panel only', () => {
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const hazard = kindAt(HALL, col, row) !== KIND.Empty && !isWall(HALL, col, row);
        const taken = occupied(HALL).some((c) => c.col === col && c.row === row);
        if (hazard || taken) expect(d.at(col, row).over, `seed ${seed}, ${col},${row}`).toBeNull();
      });
    }
    // And the panel is still there where such a cell touches a wall: the airlock, the fire.
    const d = decorate(HALL, SEED, occupied(HALL));
    const door = HALL.things.find((t) => t.ch === 'D');
    expect(door && d.at(door.col, door.row).panel).toMatch(/^bg_panel_/);
    expect(kindAt(HALL, 10, 10)).toBe(KIND.Fire);
    expect(d.at(10, 10).panel).toMatch(/^bg_panel_/);
  });

  it('hangs chains from a wall above (h % 9 == 0): 1 to 3 links ending in a hook, never resting on a floor', () => {
    let chains = 0;
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const frame = objectAt(d, col, row);
        if (frame !== 'bg_chain_0' && frame !== 'bg_hook_0') return;
        const above = objectAt(d, col, row - 1);
        if (above === 'bg_chain_0') return; // not the top of its chain
        const where = `seed ${seed}, chain at ${col},${row}`;
        chains++;
        expect(isWall(HALL, col, row - 1), where).toBe(true);
        expect(h(col, row, seed) % 9, where).toBe(0);
        let links = 0;
        let end = row;
        while (objectAt(d, col, end) === 'bg_chain_0') {
          links++;
          end++;
        }
        expect(objectAt(d, col, end), where).toBe('bg_hook_0');
        expect(links, where).toBeLessThanOrEqual(3);
        expect(isWall(HALL, col, end + 1), `${where}: the hook rests on a floor`).toBe(false);
      });
    }
    expect(chains).toBeGreaterThan(10);
  });

  it('never hangs two chains side by side', () => {
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const isChain = (c: number): boolean => ['bg_chain_0', 'bg_hook_0'].includes(objectAt(d, c, row) ?? '');
        if (isChain(col) && isWall(HALL, col, row - 1)) {
          expect(isChain(col - 1) || isChain(col + 1), `seed ${seed}, ${col},${row}`).toBe(false);
        }
      });
    }
  });

  it('sets vents (h % 11 == 0) only in panel cells with wall on the left or the right', () => {
    let vents = 0;
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        if (objectAt(d, col, row) !== 'bg_vent_0') return;
        vents++;
        const where = `seed ${seed}, ${col},${row}`;
        expect(h(col, row, seed) % 11, where).toBe(0);
        expect(isWall(HALL, col - 1, row) || isWall(HALL, col + 1, row), where).toBe(true);
      });
    }
    expect(vents).toBeGreaterThan(5);
  });

  it('runs pipes across (h % 7 == 0) and down (h % 13 == 0) panel cells, at least 2 cells at a time', () => {
    const runs = { bg_pipe_h_0: 0, bg_pipe_v_0: 0 };
    for (const { seed, d } of decorations) {
      for (const [frame, dc, dr] of [
        ['bg_pipe_h_0', 1, 0],
        ['bg_pipe_v_0', 0, 1],
      ] as const) {
        eachCell(HALL, (col, row) => {
          if (objectAt(d, col, row) !== frame) return;
          const where = `seed ${seed}, ${frame} at ${col},${row}`;
          expect(touchesWall(HALL, col, row), `${where} is not on a panel`).toBe(true);
          if (objectAt(d, col - dc, row - dr) === frame) return; // not the start of a segment
          runs[frame]++;
          expect(h(col, row, seed) % (frame === 'bg_pipe_h_0' ? 7 : 13), where).toBe(0);
          let length = 0;
          while (objectAt(d, col + length * dc, row + length * dr) === frame) length++;
          expect(length, where).toBeGreaterThanOrEqual(2);
        });
      }
    }
    expect(runs.bg_pipe_h_0).toBeGreaterThan(5);
    expect(runs.bg_pipe_v_0).toBeGreaterThan(5);
  });

  it('sets braces (h % 6 == 0) only in panel cells directly under a wall', () => {
    let braces = 0;
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        if (objectAt(d, col, row) !== 'bg_brace_0') return;
        braces++;
        expect(h(col, row, seed) % 6, `seed ${seed}, ${col},${row}`).toBe(0);
        expect(isWall(HALL, col, row - 1), `seed ${seed}, ${col},${row}`).toBe(true);
      });
    }
    expect(braces).toBeGreaterThan(5);
  });

  it('opens portholes (h % 23 == 0) on 2 x 2 blocks of panel cells, as four quarters with no panel under them', () => {
    let portholes = 0;
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const quarter = d.at(col, row).over;
        if (quarter?.frame !== 'bg_porthole_0') return;
        expect(d.at(col, row).panel, `seed ${seed}, ${col},${row}`).toBeNull();
        expect(touchesWall(HALL, col, row), `seed ${seed}, ${col},${row}`).toBe(true);
        if (quarter.cellX !== 0 || quarter.cellY !== 0) return;
        portholes++;
        expect(h(col, row, seed) % 23).toBe(0);
        expect(d.at(col + 1, row).over).toEqual({ frame: 'bg_porthole_0', cellX: 1, cellY: 0 });
        expect(d.at(col, row + 1).over).toEqual({ frame: 'bg_porthole_0', cellX: 0, cellY: 1 });
        expect(d.at(col + 1, row + 1).over).toEqual({ frame: 'bg_porthole_0', cellX: 1, cellY: 1 });
      });
    }
    expect(portholes).toBeGreaterThan(0);
  });

  it('lets the first rule that matches win: a chain before a brace, a vent before a pipe', () => {
    const ceiling = room('#'.repeat(40), '.'.repeat(40), '.'.repeat(40), '.'.repeat(40), '.'.repeat(40));
    let chainOverBrace = 0;
    let ventOverPipe = 0;
    for (let seed = 0; seed < 400; seed++) {
      const d = decorate(ceiling, seed);
      for (let col = 1; col < 40; col++) {
        // Under the ceiling, h % 18 == 0 matches both the chain and the brace rule.
        const chainFree = !['bg_chain_0', 'bg_hook_0'].includes(objectAt(d, col - 1, 1) ?? '');
        if (h(col, 1, seed) % 18 === 0 && chainFree) {
          expect(['bg_chain_0', 'bg_hook_0'], `seed ${seed}, ${col},1`).toContain(objectAt(d, col, 1));
          chainOverBrace++;
        }
      }
      // A corridor between two walls: every cell is a panel cell. At either end (wall
      // outside the grid beside it), h % 77 == 0 matches both the vent and the pipe rule.
      // (The chain rule finds no room to hang there: the floor is right below.)
      const corridor = room('#'.repeat(12), '.'.repeat(12), '#'.repeat(12));
      const c = decorate(corridor, seed);
      for (const col of [0, 11]) {
        if (h(col, 1, seed) % 77 === 0) {
          expect(objectAt(c, col, 1), `seed ${seed}, ${col},1`).toBe('bg_vent_0');
          ventOverPipe++;
        }
      }
    }
    expect(chainOverBrace).toBeGreaterThan(0);
    expect(ventOverPipe).toBeGreaterThan(0);
  });

  it('puts objects only in empty cells, one per cell, and draws none in the middle of open space', () => {
    for (const { seed, d } of decorations) {
      eachCell(HALL, (col, row) => {
        const over = d.at(col, row).over;
        if (!over) return;
        expect(kindAt(HALL, col, row), `seed ${seed}, ${col},${row}`).toBe(KIND.Empty);
        // Only chains hang away from structure; everything else sits on a panel cell.
        if (over.frame !== 'bg_chain_0' && over.frame !== 'bg_hook_0') expect(touchesWall(HALL, col, row)).toBe(true);
      });
    }
  });

  it('always gives the same picture for the same level, and another for another level', () => {
    const picture = (seed: number): string => {
      const d = decorate(HALL, seed, occupied(HALL));
      const cells: string[] = [];
      eachCell(HALL, (col, row) => {
        const pick = d.at(col, row);
        cells.push(`${pick.panel ?? '-'}/${pick.over ? `${pick.over.frame}${pick.over.cellX}${pick.over.cellY}` : '-'}`);
      });
      return cells.join(' ');
    };
    expect(picture(SEED)).toBe(picture(SEED));
    expect(picture(SEED)).not.toBe(picture(SEED + 1));
  });

  it('takes the pickups, the cog and the airlock of a level as occupied cells', () => {
    const level = { pickups: [{ col: 3, row: 4 }], trophy: { col: 5, row: 6 }, door: { col: 7, row: 8 } };
    expect(occupiedCells(level)).toEqual([
      { col: 3, row: 4 },
      { col: 5, row: 6 },
      { col: 7, row: 8 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// Hash and seed
// ---------------------------------------------------------------------------------------

describe('hash and level seed', () => {
  it('mixes whole numbers into one fixed number from 0 to 2^32 - 1', () => {
    expect(hash(3, 4, 5)).toBe(hash(3, 4, 5));
    expect(hash(3, 4, 5)).not.toBe(hash(3, 5, 4));
    for (let n = 0; n < 100; n++) {
      const value = hash(n, n * 7);
      expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32).toBe(true);
    }
  });

  it('spreads neighbouring cells evenly over the rules', () => {
    const counts = new Map<number, number>();
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 30; col++) {
        const rest = hash(7, col, row) % 9;
        counts.set(rest, (counts.get(rest) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(9);
    for (const count of counts.values()) expect(count).toBeGreaterThan(70); // 100 each on average
  });

  it('seeds a numbered level with its number and any other level with a fixed mix of its name', () => {
    expect(levelSeed('level-03')).toBe(3);
    expect(levelSeed('level-10')).toBe(10);
    expect(levelSeed('debug')).toBe(levelSeed('debug'));
    expect(levelSeed('debug')).not.toBe(levelSeed('test'));
    expect(levelSeed('debug')).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------------------
// Backdrop (section 6)
// ---------------------------------------------------------------------------------------

describe('backdrop', () => {
  it('scatters about 40 stars per screen, in earthlight and slate, the same for the same level', () => {
    const stars = starField(3, 320, 180);
    expect(stars).toHaveLength(STARS_PER_SCREEN);
    expect(starField(3, 320, 180)).toEqual(stars);
    expect(starField(4, 320, 180)).not.toEqual(stars);
    for (const star of stars) {
      expect(star.x >= 0 && star.x < 320 && star.y >= 0 && star.y < 180).toBe(true);
      expect(['6', '3']).toContain(star.code);
    }
    const bright = stars.filter((s) => s.code === '6').length;
    expect(bright).toBeGreaterThan(5);
    expect(bright).toBeLessThan(25);
    // A smaller screen gets fewer stars, at the same density.
    expect(starField(3, 284, 160).length).toBe(Math.round((40 * 284 * 160) / (320 * 180)));
  });

  it('scrolls the stars at 0.2 and the Earth and the ridge at 0.1 of the camera, on whole pixels', () => {
    expect(PARALLAX).toEqual({ stars: 0.2, far: 0.1 });
    expect(starShift(100, 0, 320)).toBe(100);
    expect(starShift(100, 50, 320)).toBe(90);
    expect(starShift(5, 100, 320)).toBe(305); // wraps round
    expect(starShift(5, 33, 320)).toBe(319); // 33 * 0.2 is 6.6: scrolled by 6, never by a fraction
    expect(Number.isInteger(starShift(7, 13, 320))).toBe(true);
    expect(farShift(40, 0)).toBe(40);
    expect(farShift(40, 75)).toBe(33);
  });

  it('places the Earth once, in the upper half, and keeps it on screen wherever the camera goes', () => {
    const size = spriteSpec('backdrop_earth').width;
    for (const [viewW, viewH, levelW, levelH] of [
      [284, 160, 1024, 384],
      [480, 224, 1024, 224],
      [272, 160, 480, 224],
      [480, 224, 480, 224],
    ] as const) {
      const maxCamX = levelW - viewW;
      const maxCamY = levelH - viewH;
      for (let seed = 1; seed <= 12; seed++) {
        const spot = earthSpot(seed, viewW, viewH, maxCamX, maxCamY);
        expect(earthSpot(seed, viewW, viewH, maxCamX, maxCamY)).toEqual(spot);
        for (const camX of [0, maxCamX]) {
          for (const camY of [0, maxCamY]) {
            const x = farShift(spot.x, camX);
            const y = farShift(spot.y, camY);
            const where = `seed ${seed}, view ${viewW} x ${viewH}, camera ${camX},${camY}`;
            expect(x >= 0 && x + size <= viewW, where).toBe(true);
            expect(y >= 0 && y + size <= viewH, where).toBe(true);
          }
        }
        // With the camera at the bottom of the level the whole Earth is in the upper half.
        expect(farShift(spot.y, maxCamY) + size).toBeLessThanOrEqual(viewH / 2);
      }
    }
  });

  it('rests the ridge on the bottom of the view at the bottom of the level, sinking as the camera climbs', () => {
    const ridgeH = spriteSpec('backdrop_ridge').height;
    expect(ridgeTop(160, 0, 0)).toBe(160 - ridgeH);
    expect(ridgeTop(160, 224, 224)).toBe(160 - ridgeH);
    expect(ridgeTop(160, 0, 224)).toBe(160 - ridgeH + 22);
  });
});
