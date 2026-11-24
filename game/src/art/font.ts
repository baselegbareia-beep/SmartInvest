/**
 * The pixel font (docs/ART-AND-SOUND.md, section 7): one font, capitals only.
 *
 * - 47 glyphs, each 5 x 7 px, in this order: space, A to Z, 0 to 9, then . , ! ? : - + / ' %
 * - On the sheet each glyph sits in a 6 x 8 cell (one empty column on the right, one
 *   empty row below), white on transparent, so a tint colours it.
 * - Advance 6 px, line height 9 px (cell height 8 plus a line spacing of 1).
 *
 * The style (look rule 5, "stamped metal"): strokes are one pixel wide; wherever a
 * stroke turns a corner around a bowl the corner pixel is cut away, like plate
 * lettering. Stems and the ends of bars stay square, which is what tells a letter
 * from the digit that looks like it: B has a straight back and 8 has none, S starts
 * with a cut corner and 5 with a square one, O is hollow and 0 carries a slash, I
 * has two wide bars and 1 a flag, Z is all straight lines and 2 has a round head.
 * D is cut twice as deep as the other bowls so that it cannot be taken for O or 0.
 * Full stop, comma and colon are 2 px dots, so they survive on a small phone.
 *
 * In the grids below '#' is a white pixel and '.' is empty.
 *
 * No Phaser, no DOM. src/art/makeSheet.ts registers the font with Phaser.
 */
import type { Frame } from './grid.ts';

/** Glyph size in art pixels. */
export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** The cell a glyph occupies on the font sheet: one empty column right, one empty row below. */
export const FONT_CELL_W = 6;
export const FONT_CELL_H = 8;

/** Extra pixels between lines: line height = FONT_CELL_H + FONT_LINE_SPACING = 9. */
export const FONT_LINE_SPACING = 1;
export const FONT_LINE_HEIGHT = FONT_CELL_H + FONT_LINE_SPACING;

/** Pixels from one character to the next. */
export const FONT_ADVANCE = FONT_CELL_W;

/**
 * The size to pass to bitmap text for 1x. Phaser's retro fonts are sized by the cell
 * WIDTH: draw at FONT_SIZE (1x), FONT_SIZE * 2 (headings) or FONT_SIZE * 3 (the first
 * word of the title), never anything else.
 */
export const FONT_SIZE = FONT_CELL_W;

/** No line of text may be longer than this (252 px; the narrowest view is 272 px). */
export const MAX_LINE_CHARS = 42;

/** The pixel a glyph grid uses for "white". */
export const GLYPH_INK = '#';

// Each entry: the character, then its seven rows. Kept as a list (not an object keyed by
// character) because JavaScript lists keys that look like numbers first, which would
// put the digits before the letters.
const GLYPH_LIST: readonly (readonly [string, Frame])[] = [
  [' ', ['.....', '.....', '.....', '.....', '.....', '.....', '.....']],

  ['A', ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']],
  ['B', ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.']],
  ['C', ['.####', '#....', '#....', '#....', '#....', '#....', '.####']],
  ['D', ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..']],
  ['E', ['#####', '#....', '#....', '####.', '#....', '#....', '#####']],
  ['F', ['#####', '#....', '#....', '####.', '#....', '#....', '#....']],
  ['G', ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.']],
  ['H', ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']],
  ['I', ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####']],
  ['J', ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.']],
  ['K', ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#']],
  ['L', ['#....', '#....', '#....', '#....', '#....', '#....', '#####']],
  ['M', ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#']],
  ['N', ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#']],
  ['O', ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']],
  ['P', ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....']],
  ['Q', ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#']],
  ['R', ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#']],
  ['S', ['.####', '#....', '#....', '.###.', '....#', '....#', '####.']],
  ['T', ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..']],
  ['U', ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']],
  ['V', ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..']],
  ['W', ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#']],
  ['X', ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#']],
  ['Y', ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..']],
  ['Z', ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####']],

  ['0', ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.']],
  ['1', ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.']],
  ['2', ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####']],
  ['3', ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.']],
  ['4', ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.']],
  ['5', ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.']],
  ['6', ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.']],
  ['7', ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..']],
  ['8', ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.']],
  ['9', ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.']],

  ['.', ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..']],
  [',', ['.....', '.....', '.....', '.....', '.##..', '.##..', '#....']],
  ['!', ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..']],
  ['?', ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..']],
  [':', ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....']],
  ['-', ['.....', '.....', '.....', '.###.', '.....', '.....', '.....']],
  ['+', ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....']],
  ['/', ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....']],
  ["'", ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....']],
  ['%', ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##']],
];

/** The 47 characters in sheet order. Pass this to the retro font, never a hand-typed string. */
export const FONT_CHARS: string = GLYPH_LIST.map(([ch]) => ch).join('');

/** Number of glyphs: 47. */
export const GLYPH_COUNT: number = GLYPH_LIST.length;

/** Every glyph by character: seven rows of five, '#' for white and '.' for empty. */
export const GLYPHS: ReadonlyMap<string, Frame> = new Map(GLYPH_LIST);

/** The glyph of a character, or undefined when the font has none (lower case, for example). */
export function glyphOf(ch: string): Frame | undefined {
  return GLYPHS.get(ch);
}

/** True when every character of the text has a glyph. */
export function canDraw(text: string): boolean {
  for (const ch of text) {
    if (!GLYPHS.has(ch)) return false;
  }
  return true;
}

/** Width in art pixels of one line of text at 1x, without the empty column after the last glyph. */
export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * FONT_ADVANCE - (FONT_ADVANCE - GLYPH_W);
}

/**
 * The glyphs as sheet cells in sheet order: FONT_CELL_W x FONT_CELL_H each, the glyph in
 * the top-left corner, white ('7') on transparent.
 */
export function fontCells(): Frame[] {
  const padRight = '.'.repeat(FONT_CELL_W - GLYPH_W);
  const emptyRow = '.'.repeat(FONT_CELL_W);
  return GLYPH_LIST.map(([, rows]) => [
    ...rows.map((row) => row.replaceAll(GLYPH_INK, '7') + padRight),
    ...Array.from({ length: FONT_CELL_H - GLYPH_H }, () => emptyRow),
  ]);
}
