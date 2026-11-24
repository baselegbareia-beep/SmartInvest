import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LevelError, parseLevel, withoutItem } from './level';
import { LEVEL_MAX_ENEMIES, LEVEL_MAX_HEIGHT, LEVEL_MAX_THRUSTERS, LEVEL_MAX_WIDTH, Tile } from './types';
import type { LevelData } from './types';

/**
 * The level file format of docs/ARCHITECTURE.md, section 8: the legend, the
 * headers, 0-based cells, every error message of the table there, and the
 * order in which the checks run.
 */

const text = (...lines: string[]): string => lines.join('\n');

/** The smallest legal grid: hero, cog and airlock on one floor. P is at col 1, row 1. */
const MINIMAL = ['....', '.PTD', '####'];

const parse = (...lines: string[]): LevelData => parseLevel(text(...lines), 'room');

/** A row of `width` empty cells with `content` written from the left edge. */
const row = (width: number, content = ''): string => content + '.'.repeat(width - content.length);

/** A grid of the given size with the three required things on a floor, plus extra rows placed first. */
function gridOf(width: number, height: number, extraRows: string[] = []): string[] {
  const filler = Array.from({ length: height - 2 - extraRows.length }, () => row(width));
  return [...extraRows, ...filler, row(width, '.PTD'), '#'.repeat(width)];
}

/** Parses and returns the LevelError; fails the test when nothing is thrown or something else is. */
function errorOf(fileText: string, id = 'room'): LevelError {
  try {
    parseLevel(fileText, id);
  } catch (error) {
    if (error instanceof LevelError) return error;
    throw error;
  }
  throw new Error('parseLevel did not throw');
}

/** Asserts the exact message, with the file line when one is named. */
function expectError(lines: string[], line: number | null, message: string): void {
  const error = errorOf(text(...lines));
  expect(error.message).toBe(line === null ? `levels/room.txt: ${message}` : `levels/room.txt:${line}: ${message}`);
  expect(error.line).toBe(line);
}

describe('parseLevel: the grid', () => {
  it('reads the format example of the architecture document, every letter of the legend once', () => {
    const level = parseLevel(
      text(
        '@name Format Example',
        '@teaches Every letter of the legend, once',
        '@hardest 12,3 the two-tile coolant pool',
        '@requires thruster',
        '; a free comment',
        '########################################',
        '#......................................#',
        '#.P..G..B..J....C...S..F....M...H..T.D.#',
        '############WW##########################',
      ),
      'example',
    );

    expect(level.id).toBe('example');
    expect(level.name).toBe('Format Example');
    expect(level.teaches).toBe('Every letter of the legend, once');
    expect(level.hardest).toEqual({ col: 12, row: 3, note: 'the two-tile coolant pool' });
    expect(level.requires).toEqual(['thruster']);
    expect(level.width).toBe(40);
    expect(level.height).toBe(4);
    expect(level.start).toEqual({ col: 2, row: 2 });
    expect(level.trophy).toEqual({ col: 35, row: 2 });
    expect(level.door).toEqual({ col: 37, row: 2 });
    expect(level.pickups).toEqual([
      { col: 5, row: 2, kind: 'crystal' },
      { col: 8, row: 2, kind: 'blaster' },
      { col: 11, row: 2, kind: 'thruster' },
    ]);
    expect(level.enemies).toEqual([
      { col: 16, row: 2, kind: 'cinderpeg' },
      { col: 28, row: 2, kind: 'moth', axis: 'v' },
      { col: 32, row: 2, kind: 'moth', axis: 'h' },
    ]);
  });

  it('turns # F W S into Solid, Fire, Coolant, Spikes and every other letter into an Empty tile', () => {
    const level = parse('.PTDGBJCMH', '####FWS###');
    expect(level.tiles).toBeInstanceOf(Uint8Array);
    expect(Array.from(level.tiles.subarray(0, 10))).toEqual(Array.from({ length: 10 }, () => Tile.Empty));
    expect(Array.from(level.tiles.subarray(10))).toEqual([
      Tile.Solid,
      Tile.Solid,
      Tile.Solid,
      Tile.Solid,
      Tile.Fire,
      Tile.Coolant,
      Tile.Spikes,
      Tile.Solid,
      Tile.Solid,
      Tile.Solid,
    ]);
  });

  it('stores tiles row-major: index = row * width + col, with 0-based cells', () => {
    const level = parse('#....', '.PTD.', '####S');
    expect(level.width).toBe(5);
    expect(level.height).toBe(3);
    expect(level.tiles[0 * 5 + 0]).toBe(Tile.Solid);
    expect(level.tiles[0 * 5 + 1]).toBe(Tile.Empty);
    expect(level.tiles[2 * 5 + 4]).toBe(Tile.Spikes);
    expect(level.start).toEqual({ col: 1, row: 1 });
  });

  it('lists pickups and enemies in reading order, so the index is a stable id', () => {
    const level = parse('G.H.J...', 'M..B...G', '.PTD.C.G', '########');
    expect(level.pickups.map((p) => `${p.kind}@${p.col},${p.row}`)).toEqual([
      'crystal@0,0',
      'thruster@4,0',
      'blaster@3,1',
      'crystal@7,1',
      'crystal@7,2',
    ]);
    expect(level.enemies.map((e) => `${e.kind}@${e.col},${e.row}`)).toEqual(['moth@2,0', 'moth@0,1', 'cinderpeg@5,2']);
  });

  it('accepts an open grid: no wall frame is needed, only a wall under P and under each C', () => {
    expect(() => parse('PTDC', '#..#')).not.toThrow();
  });

  it('accepts a grid at the size cap and with the most enemies and packs allowed', () => {
    const enemies = 'M'.repeat(LEVEL_MAX_ENEMIES);
    const packs = 'J'.repeat(LEVEL_MAX_THRUSTERS);
    const level = parse(...gridOf(LEVEL_MAX_WIDTH, LEVEL_MAX_HEIGHT, [row(LEVEL_MAX_WIDTH, enemies + packs)]));
    expect(level.width).toBe(LEVEL_MAX_WIDTH);
    expect(level.height).toBe(LEVEL_MAX_HEIGHT);
    expect(level.enemies).toHaveLength(LEVEL_MAX_ENEMIES);
    expect(level.pickups).toHaveLength(LEVEL_MAX_THRUSTERS);
  });

  it('returns a frozen level, because one LevelData is shared by every clone of the game', () => {
    const level = parse('@hardest 1,1 here', ...MINIMAL);
    expect(Object.isFrozen(level)).toBe(true);
    expect(Object.isFrozen(level.enemies)).toBe(true);
    expect(Object.isFrozen(level.requires)).toBe(true);
    expect(Object.isFrozen(level.start)).toBe(true);
    expect(Object.isFrozen(level.hardest)).toBe(true);
  });

  it('freezes every pickup but not the pickups array: step() scans that array on every tick, and V8 reads a frozen array 2.5 times slower', () => {
    const level = parse('GBJG', 'JPTD', '####');
    expect(level.pickups).toHaveLength(5);
    expect(level.pickups.every((pickup) => Object.isFrozen(pickup))).toBe(true);
    expect(Object.isFrozen(level.pickups)).toBe(false);
    // withoutItem keeps both properties.
    const copy = withoutItem(level, 'blaster');
    expect(copy.pickups.every((pickup) => Object.isFrozen(pickup))).toBe(true);
    expect(Object.isFrozen(copy.pickups)).toBe(false);
  });
});

describe('parseLevel: headers and line handling', () => {
  it('makes every header optional: the name falls back to the id, the rest to empty', () => {
    const level = parseLevel(text(...MINIMAL), 'level-07');
    expect(level.name).toBe('level-07');
    expect(level.teaches).toBe('');
    expect(level.hardest).toBeNull();
    expect(level.requires).toEqual([]);
  });

  it('lists required items blaster first, whatever the order of the @requires lines', () => {
    const level = parse('@requires thruster', '@requires blaster', 'BJ..', '.PTD', '####');
    expect(level.requires).toEqual(['blaster', 'thruster']);
  });

  it('allows several spaces, or a tab, between a keyword and its value, and keeps spaces inside the value', () => {
    const level = parse('@name    Two  Words', '@hardest   0,2   the  floor', ...MINIMAL);
    expect(level.name).toBe('Two  Words');
    expect(level.hardest).toEqual({ col: 0, row: 2, note: 'the  floor' });
    expect(parse('@name\tTabbed', ...MINIMAL).name).toBe('Tabbed');
  });

  it('counts @hardest cells from 0: col 0, row 0 is the top-left cell and the last cell is width - 1, height - 1', () => {
    expect(parse('@hardest 0,0 corner', ...MINIMAL).hardest).toEqual({ col: 0, row: 0, note: 'corner' });
    expect(parse('@hardest 3,2 corner', ...MINIMAL).hardest).toEqual({ col: 3, row: 2, note: 'corner' });
  });

  it('skips blank lines and ; comments before the grid, and blank lines after the last row', () => {
    const level = parse('', '; a comment', '@name Room', '', ';another', ...MINIMAL, '', '', '');
    expect(level.name).toBe('Room');
    expect(level.height).toBe(3);
  });

  it('drops a trailing carriage return, trailing spaces and tabs from every line before reading it', () => {
    const level = parseLevel('@name Room \t\r\n....  \r\n.PTD\t\r\n####\r\n \t\r\n', 'room');
    expect(level.name).toBe('Room');
    expect(level.width).toBe(4);
    expect(level.height).toBe(3);
  });

  it('drops a byte-order mark at the start of the file', () => {
    const level = parseLevel(String.fromCharCode(0xfeff) + text('@name Room', ...MINIMAL), 'room');
    expect(level.name).toBe('Room');
    expect(level.height).toBe(3);
  });

  it('treats a line that only looks like a header after leading spaces as the first grid row', () => {
    expectError(
      ['  @name Room', ...MINIMAL],
      1,
      'unknown character " " at col 0, row 0 (allowed: # . P T D G F W S B J C M H)',
    );
  });
});

describe('parseLevel: the shipped development levels', () => {
  const read = (id: string): LevelData =>
    parseLevel(readFileSync(fileURLToPath(new URL(`../../levels/${id}.txt`, import.meta.url)), 'utf8'), id);

  it('reads levels/test.txt', () => {
    const level = read('test');
    expect(level.id).toBe('test');
    expect(level.name).not.toBe('test');
    expect(level.hardest).not.toBeNull();
  });

  it('reads levels/debug.txt, the room that holds every item and both enemies and requires both items', () => {
    const level = read('debug');
    expect(level.requires).toEqual(['blaster', 'thruster']);
    expect(new Set(level.pickups.map((p) => p.kind))).toEqual(new Set(['crystal', 'blaster', 'thruster']));
    expect(new Set(level.enemies.map((e) => (e.kind === 'moth' ? `moth-${e.axis}` : e.kind)))).toEqual(
      new Set(['cinderpeg', 'moth-v', 'moth-h']),
    );
  });
});

describe('parseLevel: error messages, line by line', () => {
  it('throws a LevelError that carries the level id and the 1-based file line', () => {
    const error = errorOf(text('; comment', '@title Oops', ...MINIMAL), 'level-03');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LevelError');
    expect(error.levelId).toBe('level-03');
    expect(error.line).toBe(2);
    expect(error.message).toBe(
      'levels/level-03.txt:2: unknown header "@title" (allowed: @name, @teaches, @hardest, @requires)',
    );
  });

  it('rejects a header keyword it does not know, upper case included', () => {
    expectError(['@title Oops', ...MINIMAL], 1, 'unknown header "@title" (allowed: @name, @teaches, @hardest, @requires)');
    expectError(['@Name Oops', ...MINIMAL], 1, 'unknown header "@Name" (allowed: @name, @teaches, @hardest, @requires)');
    expectError(['@', ...MINIMAL], 1, 'unknown header "@" (allowed: @name, @teaches, @hardest, @requires)');
  });

  it('rejects a repeated @name, @teaches or @hardest', () => {
    expectError(['@name A', '@name B', ...MINIMAL], 2, 'duplicate @name');
    expectError(['@teaches A', '', '@teaches B', ...MINIMAL], 3, 'duplicate @teaches');
    expectError(['@hardest 1,1 a', '@hardest 2,1 b', ...MINIMAL], 2, 'duplicate @hardest');
  });

  it('rejects a repeated @requires of the same item, but allows one of each', () => {
    expectError(['@requires blaster', '@requires blaster', ...MINIMAL], 2, 'duplicate @requires blaster');
    expectError(
      ['@requires thruster', '@requires blaster', '@requires thruster', ...MINIMAL],
      3,
      'duplicate @requires thruster',
    );
    expect(() => parse('@requires blaster', '@requires thruster', 'BJ..', '.PTD', '####')).not.toThrow();
  });

  it('rejects @name and @teaches with no text', () => {
    expectError(['@name', ...MINIMAL], 1, '@name needs a value');
    expectError(['@name   ', ...MINIMAL], 1, '@name needs a value');
    expectError(['@name Room', '@teaches', ...MINIMAL], 2, '@teaches needs a value');
  });

  it('rejects an @hardest that is not "col,row note"', () => {
    const message = '@hardest must look like "col,row note", for example "@hardest 35,9 the two-tile step"';
    for (const value of ['', ' 1,1', ' 1 1 note', ' 1, 1 note', ' a,b note', ' -1,1 note', ' 1.5,1 note', ' 1,1,1']) {
      expectError([`@hardest${value}`, ...MINIMAL], 1, message);
    }
  });

  it('rejects an @requires that names anything but the two items', () => {
    expectError(['@requires jetpack', ...MINIMAL], 1, '@requires must be "blaster" or "thruster", found "jetpack"');
    expectError(['@requires Blaster', ...MINIMAL], 1, '@requires must be "blaster" or "thruster", found "Blaster"');
    expectError(
      ['@requires blaster thruster', ...MINIMAL],
      1,
      '@requires must be "blaster" or "thruster", found "blaster thruster"',
    );
    expectError(['@requires', ...MINIMAL], 1, '@requires must be "blaster" or "thruster", found ""');
  });

  it('rejects a header or a comment once the grid has started', () => {
    expectError(['....', '@name Late', '.PTD', '####'], 2, 'header line after the grid has started');
    expectError(['....', '.PTD', '; late comment', '####'], 3, 'header line after the grid has started');
    expectError([...MINIMAL, '; trailing comment'], 4, 'header line after the grid has started');
  });

  it('rejects a grid row after a blank line that follows the grid, naming the first blank line', () => {
    expectError(['....', '', '.PTD', '####'], 2, 'blank line inside the grid');
    expectError(['; c', '....', '.PTD', '', '   ', '####'], 4, 'blank line inside the grid');
  });

  it('rejects a row whose length differs from row 0, counting rows from 0', () => {
    const rows = gridOf(60, 14);
    rows[5] = row(59);
    expectError(rows, 6, 'row 5 has 59 columns, expected 60 (the width of row 0)');
    expectError(['@name Room', '....', '.PTD.', '####'], 3, 'row 1 has 5 columns, expected 4 (the width of row 0)');
  });

  it('rejects a character outside the legend, with its 0-based cell', () => {
    const rows = gridOf(60, 14);
    rows[3] = row(60, `${'.'.repeat(16)}x`);
    expectError(rows, 4, 'unknown character "x" at col 16, row 3 (allowed: # . P T D G F W S B J C M H)');
    expectError(
      ['; one comment line', '....', '.PTd', '####'],
      3,
      'unknown character "d" at col 3, row 1 (allowed: # . P T D G F W S B J C M H)',
    );
  });

  it('counts a character outside the basic plane as one column', () => {
    expectError(
      ['..\u{1F600}.', '.PTD', '####'],
      1,
      'unknown character "\u{1F600}" at col 2, row 0 (allowed: # . P T D G F W S B J C M H)',
    );
  });
});

describe('parseLevel: error messages about the whole file', () => {
  it('rejects a file without a grid row', () => {
    expectError([''], null, 'no grid rows found');
    expectError(['@name Empty', '; nothing here', ''], null, 'no grid rows found');
  });

  it('rejects a grid wider or taller than the cap, as width x height', () => {
    expectError(gridOf(70, 18), null, 'grid is 70x18; the limit is 64x24');
    expectError(gridOf(10, 25), null, 'grid is 10x25; the limit is 64x24');
  });

  it('wants exactly one P', () => {
    expectError(['..TD', '####'], null, 'expected exactly one P (player start), found 0');
    expectError(['PPTD', '####'], null, 'expected exactly one P (player start), found 2');
  });

  it('wants exactly one T', () => {
    expectError(['P..D', '####'], null, 'expected exactly one T (trophy), found 0');
    expectError(['PTTTD', '#####'], null, 'expected exactly one T (trophy), found 3');
  });

  it('wants exactly one D', () => {
    expectError(['PT..', '####'], null, 'expected exactly one D (door), found 0');
    expectError(['PTDD', '####'], null, 'expected exactly one D (door), found 2');
  });

  it('wants a wall under P, and names the row of P as the line', () => {
    const rows = gridOf(12, 12);
    rows[9] = row(12, '..P');
    rows[10] = row(12, '...TD');
    expectError(['@name Room', ...rows], 11, 'P at col 2, row 9 must stand on a wall (#)');
  });

  it('does not accept a hazard, an item or the bottom edge as the floor under P', () => {
    expectError(['PTD', 'S##'], 1, 'P at col 0, row 0 must stand on a wall (#)');
    expectError(['PTD', 'G##'], 1, 'P at col 0, row 0 must stand on a wall (#)');
    expectError(['...', 'PTD'], 2, 'P at col 0, row 1 must stand on a wall (#)');
  });

  it('wants a wall under every C, checked in reading order', () => {
    expectError(['....C.', '.PTD.C', '####.#'], 1, 'C at col 4, row 0 must stand on a wall (#)');
    expectError(['....C.', '.PTD#C', '####..'], 2, 'C at col 5, row 1 must stand on a wall (#)');
    expectError(['.PTD', '###W', '...C'], 3, 'C at col 3, row 2 must stand on a wall (#)');
  });

  it('lets an Arc Moth hang anywhere: only P and C need a floor', () => {
    expect(() => parse('M.H.', '.PTD', '####')).not.toThrow();
  });

  it('rejects more enemies than the cap, counting C, M and H together', () => {
    const rows = gridOf(20, 6, [row(20, 'MMMMMMMMHHHHHHHH'), row(20, '.....C'), row(20, '.....#')]);
    expectError(rows, null, 'too many enemies (17, limit 16)');
  });

  it('rejects more thruster packs than the cap', () => {
    expectError(gridOf(8, 4, ['JJJJJ...']), null, 'too many J (5, limit 4)');
  });

  it('rejects an @hardest cell outside the grid, naming the line of the header', () => {
    expectError(['; comment', '@hardest 70,3 far away', ...gridOf(60, 14)], 2, '@hardest 70,3 is outside the 60x14 grid');
    expectError(['@hardest 60,0 just past the edge', ...gridOf(60, 14)], 1, '@hardest 60,0 is outside the 60x14 grid');
    expectError(['@hardest 0,14 just past the edge', ...gridOf(60, 14)], 1, '@hardest 0,14 is outside the 60x14 grid');
  });

  it('rejects an @requires whose item is not in the grid, naming the line of the header', () => {
    expectError(['@name Room', '@requires blaster', ...MINIMAL], 2, '@requires blaster, but the grid has no B');
    expectError(['@requires thruster', 'B...', '.PTD', '####'], 1, '@requires thruster, but the grid has no J');
  });
});

describe('parseLevel: the order of the checks', () => {
  it('reports the first bad line of the file, whatever the kind of problem', () => {
    expectError(
      ['@title Oops', '....', '.PTDx', '####'],
      1,
      'unknown header "@title" (allowed: @name, @teaches, @hardest, @requires)',
    );
    expectError(
      ['..x.', '.PTD.', '####'],
      1,
      'unknown character "x" at col 2, row 0 (allowed: # . P T D G F W S B J C M H)',
    );
    expectError(['....', '.PTD.', '##x#'], 2, 'row 1 has 5 columns, expected 4 (the width of row 0)');
  });

  it('checks the width of a row before its characters', () => {
    expectError(['....', '.xTD.', '####'], 2, 'row 1 has 5 columns, expected 4 (the width of row 0)');
  });

  it('checks the characters of a row from left to right', () => {
    expectError(
      ['.y.x', '.PTD', '####'],
      1,
      'unknown character "y" at col 1, row 0 (allowed: # . P T D G F W S B J C M H)',
    );
  });

  it('checks a header for a repeat before it checks its value', () => {
    expectError(['@name Room', '@name', ...MINIMAL], 2, 'duplicate @name');
    expectError(['@hardest 1,1 a', '@hardest nonsense', ...MINIMAL], 2, 'duplicate @hardest');
  });

  it('calls a header after a blank line that follows the grid a late header, not a blank line in the grid', () => {
    expectError([...MINIMAL, '', '@name Late'], 5, 'header line after the grid has started');
  });

  it('runs every line check before any whole-file check', () => {
    expectError(['....', '....', '; late'], 3, 'header line after the grid has started');
    expectError(['@requires jetpack'], 1, '@requires must be "blaster" or "thruster", found "jetpack"');
  });

  it('runs the whole-file checks in the order of the table: size, P, T, D, floors, enemies, packs, @hardest, @requires', () => {
    const wide = (content: string): string => row(70, content);

    // Too large and nothing in it: the size comes first.
    expectError([wide(''), wide('')], null, 'grid is 70x2; the limit is 64x24');
    // No P, no T, no D: P is counted first, then T, then D.
    expectError(['....', '####'], null, 'expected exactly one P (player start), found 0');
    expectError(['P...', '####'], null, 'expected exactly one T (trophy), found 0');
    expectError(['PT..', '####'], null, 'expected exactly one D (door), found 0');
    // A wrong count beats a missing floor.
    expectError(['PTDD', '....'], null, 'expected exactly one D (door), found 2');
    // P's floor is checked before any C's, even when the C comes first in reading order.
    expectError(['C...', '.PTD', '....'], 2, 'P at col 1, row 1 must stand on a wall (#)');
    // A missing floor beats the caps.
    const crowd = 'M'.repeat(17);
    const packs = 'J'.repeat(5);
    expectError(
      ['@hardest 99,0 x', '@requires blaster', row(30, crowd + packs), row(30, '.PTD.C'), row(30, '####')],
      4,
      'C at col 5, row 1 must stand on a wall (#)',
    );
    // Enemies, then packs, then @hardest, then @requires.
    const floor = '#'.repeat(30);
    expectError(
      ['@hardest 99,0 x', '@requires blaster', row(30, crowd + packs), row(30, '.PTD'), floor],
      null,
      'too many enemies (17, limit 16)',
    );
    expectError(
      ['@hardest 99,0 x', '@requires blaster', row(30, packs), row(30, '.PTD'), floor],
      null,
      'too many J (5, limit 4)',
    );
    expectError(
      ['@hardest 99,0 x', '@requires blaster', row(30), row(30, '.PTD'), floor],
      1,
      '@hardest 99,0 is outside the 30x3 grid',
    );
    expectError(
      ['@requires blaster', '@hardest 99,0 x', row(30), row(30, '.PTD'), floor],
      2,
      '@hardest 99,0 is outside the 30x3 grid',
    );
    expectError(
      ['@hardest 0,0 x', '@requires blaster', row(30), row(30, '.PTD'), floor],
      2,
      '@requires blaster, but the grid has no B',
    );
  });

  it('reports the first unkept @requires line of the file when both items are missing', () => {
    expectError(['@requires thruster', '@requires blaster', ...MINIMAL], 1, '@requires thruster, but the grid has no J');
    expectError(['@requires blaster', '@requires thruster', ...MINIMAL], 1, '@requires blaster, but the grid has no B');
  });
});

describe('withoutItem', () => {
  const level = parse('@requires blaster', '@requires thruster', 'GBJG', 'JPTD', '####');

  it('removes every pickup of that kind and drops it from requires', () => {
    const noThruster = withoutItem(level, 'thruster');
    expect(noThruster.pickups).toEqual([
      { col: 0, row: 0, kind: 'crystal' },
      { col: 1, row: 0, kind: 'blaster' },
      { col: 3, row: 0, kind: 'crystal' },
    ]);
    expect(noThruster.requires).toEqual(['blaster']);

    const noBlaster = withoutItem(level, 'blaster');
    expect(noBlaster.pickups.map((p) => p.kind)).toEqual(['crystal', 'thruster', 'crystal', 'thruster']);
    expect(noBlaster.requires).toEqual(['thruster']);
  });

  it('leaves the original level and everything else in the copy untouched', () => {
    const copy = withoutItem(level, 'blaster');
    expect(level.pickups).toHaveLength(5);
    expect(level.requires).toEqual(['blaster', 'thruster']);
    expect(copy).not.toBe(level);
    expect(copy.tiles).toBe(level.tiles);
    expect({ ...copy, pickups: null, requires: null }).toEqual({ ...level, pickups: null, requires: null });
    expect(Object.isFrozen(copy)).toBe(true);
  });

  it('removes both items when applied twice, and changes nothing when the item is absent', () => {
    const bare = withoutItem(withoutItem(level, 'blaster'), 'thruster');
    expect(bare.pickups.map((p) => p.kind)).toEqual(['crystal', 'crystal']);
    expect(bare.requires).toEqual([]);
    expect(withoutItem(bare, 'blaster').pickups).toEqual(bare.pickups);
  });
});
