/**
 * Level text to LevelData (docs/ARCHITECTURE.md, section 8).
 *
 * A level file is written by hand, so the reader's main job is to say exactly
 * what is wrong and where. It stops at the first problem: the line-level
 * checks run while the file is read, top to bottom, and the whole-file checks
 * follow in a fixed order. Both the wording and that order are part of the
 * contract (level authors and the level tests rely on them), so change them
 * in the architecture document first.
 */
import {
  LEVEL_CHARS,
  LEVEL_MAX_ENEMIES,
  LEVEL_MAX_HEIGHT,
  LEVEL_MAX_THRUSTERS,
  LEVEL_MAX_WIDTH,
  Tile,
} from './types';
import type {
  Cell,
  EnemySpawn,
  HardestNote,
  ItemKind,
  LevelData,
  ParseLevelFn,
  PickupDef,
  TileKind,
  WithoutItemFn,
} from './types';

/**
 * Thrown by parseLevel for the first problem found. The message starts with
 * the file name, and with the 1-based line number when the problem belongs to
 * one line: `levels/level-03.txt:17: row 5 has 59 columns, ...`.
 */
export class LevelError extends Error {
  /** The file stem the text was parsed as: "level-03". */
  readonly levelId: string;
  /** The 1-based line of the file, as an editor shows it; null when the problem is about the whole file. */
  readonly line: number | null;

  constructor(levelId: string, line: number | null, text: string) {
    super(line === null ? `levels/${levelId}.txt: ${text}` : `levels/${levelId}.txt:${line}: ${text}`);
    this.name = 'LevelError';
    this.levelId = levelId;
    this.line = line;
  }
}

const BYTE_ORDER_MARK = 0xfeff;

/** A line's trailing carriage return, spaces and tabs: dropped before anything else looks at the line. */
const TRAILING_BLANKS = /[ \t\r]+$/;

/**
 * "@keyword", then the value after one or more spaces (a tab is taken as a
 * space, so that an editor's habit does not turn into an "unknown header").
 * The value never ends in a blank: see TRAILING_BLANKS.
 */
const HEADER = /^@([^ \t]*)(?:[ \t]+(.*))?$/;

/**
 * "col,row note": the note is part of the shape, because the line exists for
 * the reviewer who reads it. Nine digits at most, so the two numbers are
 * exact integers whatever is typed; whether the cell is inside the grid is
 * checked later.
 */
const HARDEST = /^(\d{1,9}),(\d{1,9})[ \t]+(.+)$/;

const LEGEND: ReadonlySet<string> = new Set(LEVEL_CHARS);

/** The legend as the "unknown character" message shows it: "# . P T D G F W S B J C M H". */
const LEGEND_TEXT = Array.from(LEVEL_CHARS).join(' ');

/** The letter an item is drawn with, for the "@requires" message. */
const ITEM_LETTER: Readonly<Record<ItemKind, string>> = { blaster: 'B', thruster: 'J' };

/** The order in which LevelData.requires lists the items, whatever the order of the header lines. */
const ITEM_ORDER: readonly ItemKind[] = ['blaster', 'thruster'];

function tileOfChar(ch: string): TileKind {
  switch (ch) {
    case '#':
      return Tile.Solid;
    case 'F':
      return Tile.Fire;
    case 'W':
      return Tile.Coolant;
    case 'S':
      return Tile.Spikes;
    default:
      // Every other letter of the legend is something standing in an empty cell.
      return Tile.Empty;
  }
}

/** What the header lines said, with the file line of each one that a whole-file check may have to name. */
interface Headers {
  name: string | null;
  teaches: string | null;
  hardest: HardestNote | null;
  hardestLine: number;
  /** In file order. */
  requires: { readonly item: ItemKind; readonly line: number }[];
}

/** One grid row: its characters and the file line it came from. */
interface GridRow {
  readonly chars: readonly string[];
  readonly line: number;
}

export const parseLevel: ParseLevelFn = (text, id) => {
  // The explicit type is what lets the compiler treat a call as the end of the path.
  const fail: (line: number | null, message: string) => never = (line, message) => {
    throw new LevelError(id, line, message);
  };

  const headers: Headers = { name: null, teaches: null, hardest: null, hardestLine: 0, requires: [] };

  const readHeader = (line: string, lineNo: number): void => {
    const match = HEADER.exec(line);
    // HEADER matches every line that starts with "@"; the fallbacks only satisfy the compiler.
    const keyword = match?.[1] ?? '';
    const value = match?.[2] ?? '';

    switch (keyword) {
      case 'name':
      case 'teaches':
        if (headers[keyword] !== null) fail(lineNo, `duplicate @${keyword}`);
        if (value === '') fail(lineNo, `@${keyword} needs a value`);
        headers[keyword] = value;
        return;

      case 'hardest': {
        if (headers.hardest !== null) fail(lineNo, 'duplicate @hardest');
        const parts = HARDEST.exec(value);
        if (parts === null) {
          fail(lineNo, '@hardest must look like "col,row note", for example "@hardest 35,9 the two-tile step"');
        }
        headers.hardest = { col: Number(parts[1]), row: Number(parts[2]), note: parts[3] ?? '' };
        headers.hardestLine = lineNo;
        return;
      }

      case 'requires':
        // The value is checked before the repeat, because a repeat is counted per item.
        if (value !== 'blaster' && value !== 'thruster') {
          fail(lineNo, `@requires must be "blaster" or "thruster", found "${value}"`);
        }
        if (headers.requires.some((entry) => entry.item === value)) fail(lineNo, `duplicate @requires ${value}`);
        headers.requires.push({ item: value, line: lineNo });
        return;

      default:
        fail(lineNo, `unknown header "@${keyword}" (allowed: @name, @teaches, @hardest, @requires)`);
    }
  };

  // ---- Line-level checks, in file order ----

  const rows: GridRow[] = [];
  /** The first blank line after the last grid row read so far, or 0. Harmless unless another row follows it. */
  let blankAfterGrid = 0;

  const lines = (text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text).split('\n');
  for (const [index, raw] of lines.entries()) {
    const lineNo = index + 1;
    const line = raw.replace(TRAILING_BLANKS, '');
    const first = rows[0];

    if (line === '') {
      if (first !== undefined && blankAfterGrid === 0) blankAfterGrid = lineNo;
      continue;
    }

    if (line.startsWith('@') || line.startsWith(';')) {
      if (first !== undefined) fail(lineNo, 'header line after the grid has started');
      if (line.startsWith('@')) readHeader(line, lineNo);
      continue;
    }

    if (blankAfterGrid !== 0) fail(blankAfterGrid, 'blank line inside the grid');

    // By character, not by UTF-16 unit, so a stray emoji counts as one column and is quoted whole.
    const chars = Array.from(line);
    const row = rows.length;
    if (first !== undefined && chars.length !== first.chars.length) {
      fail(lineNo, `row ${row} has ${chars.length} columns, expected ${first.chars.length} (the width of row 0)`);
    }
    for (const [col, ch] of chars.entries()) {
      if (!LEGEND.has(ch)) {
        fail(lineNo, `unknown character "${ch}" at col ${col}, row ${row} (allowed: ${LEGEND_TEXT})`);
      }
    }
    rows.push({ chars, line: lineNo });
  }

  // ---- Whole-file checks, in the order of the table in section 8 ----

  const height = rows.length;
  const width = rows[0]?.chars.length ?? 0;
  if (height === 0) fail(null, 'no grid rows found');
  if (width > LEVEL_MAX_WIDTH || height > LEVEL_MAX_HEIGHT) {
    fail(null, `grid is ${width}x${height}; the limit is ${LEVEL_MAX_WIDTH}x${LEVEL_MAX_HEIGHT}`);
  }

  const tiles = new Uint8Array(width * height);
  const starts: Cell[] = [];
  const trophies: Cell[] = [];
  const doors: Cell[] = [];
  const pickups: PickupDef[] = [];
  const enemies: EnemySpawn[] = [];
  let thrusters = 0;

  for (const [row, { chars }] of rows.entries()) {
    for (const [col, ch] of chars.entries()) {
      tiles[row * width + col] = tileOfChar(ch);
      switch (ch) {
        case 'P':
          starts.push({ col, row });
          break;
        case 'T':
          trophies.push({ col, row });
          break;
        case 'D':
          doors.push({ col, row });
          break;
        case 'G':
          pickups.push({ col, row, kind: 'crystal' });
          break;
        case 'B':
          pickups.push({ col, row, kind: 'blaster' });
          break;
        case 'J':
          pickups.push({ col, row, kind: 'thruster' });
          thrusters += 1;
          break;
        case 'C':
          enemies.push({ col, row, kind: 'cinderpeg' });
          break;
        case 'M':
          enemies.push({ col, row, kind: 'moth', axis: 'v' });
          break;
        case 'H':
          enemies.push({ col, row, kind: 'moth', axis: 'h' });
          break;
        default:
          break;
      }
    }
  }

  const exactlyOne = (found: readonly Cell[], what: string): Cell => {
    const only = found[0];
    if (only === undefined || found.length !== 1) fail(null, `expected exactly one ${what}, found ${found.length}`);
    return only;
  };
  const start = exactlyOne(starts, 'P (player start)');
  const trophy = exactlyOne(trophies, 'T (trophy)');
  const door = exactlyOne(doors, 'D (door)');

  // The hero and every Cinderpeg begin standing, so each needs a wall under its cell. A level is
  // open at the bottom, so there is nothing to stand on under the last row.
  const mustStand = (letter: string, cell: Cell): void => {
    const below = cell.row + 1;
    if (below >= height || tiles[below * width + cell.col] !== Tile.Solid) {
      fail(rows[cell.row]?.line ?? null, `${letter} at col ${cell.col}, row ${cell.row} must stand on a wall (#)`);
    }
  };
  mustStand('P', start);
  for (const enemy of enemies) {
    if (enemy.kind === 'cinderpeg') mustStand('C', enemy);
  }

  if (enemies.length > LEVEL_MAX_ENEMIES) {
    fail(null, `too many enemies (${enemies.length}, limit ${LEVEL_MAX_ENEMIES})`);
  }
  if (thrusters > LEVEL_MAX_THRUSTERS) {
    fail(null, `too many J (${thrusters}, limit ${LEVEL_MAX_THRUSTERS})`);
  }

  const hardest = headers.hardest;
  if (hardest !== null && (hardest.col >= width || hardest.row >= height)) {
    fail(headers.hardestLine, `@hardest ${hardest.col},${hardest.row} is outside the ${width}x${height} grid`);
  }

  for (const { item, line } of headers.requires) {
    if (!pickups.some((pickup) => pickup.kind === item)) {
      fail(line, `@requires ${item}, but the grid has no ${ITEM_LETTER[item]}`);
    }
  }

  // Frozen wherever JavaScript allows it (a typed array cannot be frozen): one LevelData is
  // shared by every clone of the game state, so nothing may ever write to it. The one
  // exception is the pickups array itself (each pickup in it is frozen): step() scans it on
  // every tick, V8 reads a frozen array about 2.5 times slower than a plain one, and its
  // readonly type already refuses writes at compile time.
  return Object.freeze<LevelData>({
    id,
    name: headers.name ?? id,
    teaches: headers.teaches ?? '',
    hardest: hardest === null ? null : Object.freeze(hardest),
    requires: Object.freeze(ITEM_ORDER.filter((item) => headers.requires.some((entry) => entry.item === item))),
    width,
    height,
    tiles,
    start: Object.freeze(start),
    trophy: Object.freeze(trophy),
    door: Object.freeze(door),
    pickups: pickups.map((pickup) => Object.freeze(pickup)),
    enemies: Object.freeze(enemies.map((enemy) => Object.freeze(enemy))),
  });
};

export const withoutItem: WithoutItemFn = (level, item) =>
  Object.freeze<LevelData>({
    ...level,
    requires: Object.freeze(level.requires.filter((kind) => kind !== item)),
    // The pickups after a removed one move up, so their ids differ from the original level's.
    // Not frozen, for the same reason as in parseLevel: step() scans this array on every tick.
    pickups: level.pickups.filter((pickup) => pickup.kind !== item),
  });
