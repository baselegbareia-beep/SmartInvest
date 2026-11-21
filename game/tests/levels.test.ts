import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LEVEL_CHARS,
  LEVEL_MAX_ENEMIES,
  LEVEL_MAX_HEIGHT,
  LEVEL_MAX_THRUSTERS,
  LEVEL_MAX_WIDTH,
} from '../src/core/types';

/**
 * Shape checks for every file in levels/: the header lines and the rules of
 * the grid that can be checked without the simulation (docs/LEVELS.md, "The
 * level file").
 *
 * This file is a stand-in. The real suites arrive with the core and the
 * validator and replace the small reader below with parseLevel: the proof by
 * search that the cog and then the airlock can be reached, the comfort proof,
 * and the "@requires" tests (docs/ARCHITECTURE.md, section 9.6).
 *
 * Two checks below are style rules of the game's own levels that parseLevel
 * does NOT make (unit-test fixtures may break them), so they stay in this
 * file when the stand-in reader goes:
 * - names and hints the pixel font can show, at most 42 characters;
 * - the picture frame: the top row and both side columns are walls.
 * The rule that @name, @teaches and @hardest are present stays too, for
 * level-01 to level-10 (the two development levels carry them as well).
 */

const LEVELS_DIR = new URL('../levels/', import.meta.url);
const HEADERS = ['@name', '@teaches', '@hardest', '@requires'];
/** The characters of the pixel font (docs/ART-AND-SOUND.md); the game shows names and hints in capitals. */
const FONT_TEXT = /^[A-Z0-9 .,!?:\-+/'%]+$/;
const MAX_TEXT_LENGTH = 42;

interface LevelFile {
  readonly id: string;
  /** Header keyword to the texts that follow it, in file order. */
  readonly headers: ReadonlyMap<string, readonly string[]>;
  readonly rows: readonly string[];
}

function readLevel(fileName: string): LevelFile {
  const lines = readFileSync(new URL(fileName, LEVELS_DIR), 'utf8')
    .split('\n')
    .map((line) => line.replace(/[ \t\r]+$/, ''));
  const headers = new Map<string, string[]>();
  const rows: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@') && rows.length === 0) {
      const [keyword = '', ...rest] = line.split(/ +/);
      headers.set(keyword, [...(headers.get(keyword) ?? []), rest.join(' ')]);
    } else if (line !== '' && !(line.startsWith(';') && rows.length === 0)) {
      rows.push(line);
    }
  }
  return { id: fileName.replace(/\.txt$/, ''), headers, rows };
}

/** Every cell holding `char`, in reading order. */
function cellsOf(rows: readonly string[], char: string): { col: number; row: number }[] {
  return rows.flatMap((line, row) =>
    Array.from(line).flatMap((cell, col) => (cell === char ? [{ col, row }] : [])),
  );
}

const count = (rows: readonly string[], chars: string): number =>
  Array.from(chars).reduce((total, char) => total + cellsOf(rows, char).length, 0);

const levels = readdirSync(LEVELS_DIR)
  .filter((name) => name.endsWith('.txt'))
  .sort()
  .map(readLevel);

it('finds the two development levels', () => {
  expect(levels.map((level) => level.id)).toEqual(expect.arrayContaining(['debug', 'test']));
});

describe.each(levels)('levels/$id.txt', ({ headers, rows }) => {
  const width = rows[0]?.length ?? 0;

  it('uses only the four header keywords, with a name and a hint the pixel font can show', () => {
    expect([...headers.keys()].filter((keyword) => !HEADERS.includes(keyword))).toEqual([]);
    for (const keyword of ['@name', '@teaches']) {
      const texts = headers.get(keyword) ?? [];
      expect(texts, `exactly one ${keyword}`).toHaveLength(1);
      const text = (texts[0] ?? '').toUpperCase();
      expect(text, keyword).toMatch(FONT_TEXT);
      expect(text.length, `${keyword} length`).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    }
  });

  it('points @hardest at a cell inside the grid', () => {
    const match = /^(\d+),(\d+) \S/.exec(headers.get('@hardest')?.[0] ?? '');
    expect(match, '@hardest must look like "col,row note"').not.toBeNull();
    expect(Number(match?.[1])).toBeLessThan(width);
    expect(Number(match?.[2])).toBeLessThan(rows.length);
  });

  it('contains the item named by each @requires line', () => {
    const letters: Record<string, string> = { blaster: 'B', thruster: 'J' };
    for (const item of headers.get('@requires') ?? []) {
      expect(Object.keys(letters), '@requires must be "blaster" or "thruster"').toContain(item);
      expect(count(rows, letters[item] ?? ''), `@requires ${item}`).toBeGreaterThan(0);
    }
  });

  it('is a rectangle within the size cap, made of legend characters only', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(LEVEL_MAX_HEIGHT);
    expect(width).toBeLessThanOrEqual(LEVEL_MAX_WIDTH);
    expect(rows.filter((line) => line.length !== width)).toEqual([]);
    expect([...new Set(rows.join(''))].filter((char) => !LEVEL_CHARS.includes(char))).toEqual([]);
  });

  it('has exactly one start, one cog and one airlock', () => {
    expect({ P: count(rows, 'P'), T: count(rows, 'T'), D: count(rows, 'D') }).toEqual({ P: 1, T: 1, D: 1 });
  });

  // A style rule of this game's levels, not a parser rule: keep this test when parseLevel takes over.
  it('is closed by walls on the left, the right and the top', () => {
    expect(rows[0]).toMatch(/^#+$/);
    expect(rows.filter((line) => !line.startsWith('#') || !line.endsWith('#'))).toEqual([]);
  });

  it('stands the hero and every Cinderpeg on a wall', () => {
    const floating = [...cellsOf(rows, 'P'), ...cellsOf(rows, 'C')].filter(
      ({ col, row }) => rows[row + 1]?.[col] !== '#',
    );
    expect(floating).toEqual([]);
  });

  it('stays within the caps on enemies and thruster packs', () => {
    expect(count(rows, 'CMH')).toBeLessThanOrEqual(LEVEL_MAX_ENEMIES);
    expect(count(rows, 'J')).toBeLessThanOrEqual(LEVEL_MAX_THRUSTERS);
  });
});

describe('the development levels', () => {
  const byId = (id: string): readonly string[] => levels.find((level) => level.id === id)?.rows ?? [];

  it('test.txt (movement room) has nothing that can kill: no hazard, no enemy, a solid bottom', () => {
    const rows = byId('test');
    expect(count(rows, 'FWSCMH')).toBe(0);
    expect(rows.at(-1)).toMatch(/^#+$/);
  });

  it('debug.txt uses every character of the legend and asks for both items', () => {
    const rows = byId('debug');
    expect(Array.from(LEVEL_CHARS).filter((char) => count(rows, char) === 0)).toEqual([]);
    expect(levels.find((level) => level.id === 'debug')?.headers.get('@requires')).toEqual(['blaster', 'thruster']);
  });
});
