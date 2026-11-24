/**
 * From grids to pixels: lays every frame of the manifest out on its sheet and paints
 * the sheets as RGBA buffers with named frame rectangles.
 *
 * Three sheets (docs/ART-AND-SOUND.md, section 3; docs/PHASER4-NOTES.md, sections 4, 5 and 9):
 * - 'tiles': equal 16 x 16 cells, TILE_SHEET_COLUMNS per row. The tile layer addresses a
 *   tile by number: `row * columns + column`, which is what `tileIndex()` returns.
 *   A sprite larger than one cell (the porthole) takes a block of cells.
 * - 'sprites': everything else, packed in shelves, addressed by frame name only.
 * - 'font': the 47 glyphs in one row of 6 x 8 cells, white on transparent.
 *
 * Where a frame lands depends on the manifest alone, never on what is drawn, so tile
 * numbers do not move while the art is redrawn.
 *
 * Pure: no Phaser, no DOM, runs in Node. src/art/makeSheet.ts hands the result to Phaser.
 */
import { FONT_CELL_H, FONT_CELL_W, FONT_CHARS, fontCells } from './font.ts';
import { overlayFrame, paintFrame, validateSprite } from './grid.ts';
import type { Frame, Sprite } from './grid.ts';
import { SPRITE_SPECS, TEXTURE_KEY, TILE_SIZE, WALL_SPRITES, frameNamesOf } from './manifest.ts';
import type { SheetName, SpriteName, WallSpriteName } from './manifest.ts';
import { SPRITES } from './sprites/index.ts';

/** Where one named frame sits on its sheet, in pixels. */
export interface FrameRect {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A sheet's size and its named frames, without the pixels. */
export interface SheetLayout {
  /** The Phaser texture key. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly FrameRect[];
}

/** A painted sheet: `rgba` holds width * height * 4 bytes, row by row. */
export interface Sheet extends SheetLayout {
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** The painted font sheet with what the retro font needs to know about it. */
export interface FontSheet extends Sheet {
  /** The characters in sheet order. */
  readonly chars: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly charsPerRow: number;
}

export interface Sheets {
  readonly tiles: Sheet;
  readonly sprites: Sheet;
  readonly font: FontSheet;
}

/** Both sheets must fit in a texture of this size on every phone. */
export const MAX_SHEET_SIZE = 1024;

/** Cells per row of the tile sheet. */
export const TILE_SHEET_COLUMNS = 16;

/** Width of the sprite sheet in pixels; its height is whatever the shelves need. */
export const SPRITE_SHEET_WIDTH = 256;

// ---------------------------------------------------------------------------------------
// Wall tiles with their side trims baked in
// ---------------------------------------------------------------------------------------

/** Which exposed sides of a wall tile carry a trim: none, left, right or both. */
export type WallTrim = '' | 'l' | 'r' | 'lr';

const BAKED_TRIMS: readonly Exclude<WallTrim, ''>[] = ['l', 'r', 'lr'];

/**
 * The tile-sheet frame of a wall picture with its side trims. Without trims it is the
 * plain frame (`wall_top_0`); with them it is an extra tile made here by laying
 * `trim_left_0` and `trim_right_0` over the wall (`wall_top_0+l`, `+r`, `+lr`), so
 * walls can stay on one tile layer (docs/ART-AND-SOUND.md, section 6).
 */
export function wallFrameName(wall: WallSpriteName, trimLeft: boolean, trimRight: boolean): string {
  const trim: WallTrim = trimLeft ? (trimRight ? 'lr' : 'l') : trimRight ? 'r' : '';
  return trim === '' ? `${wall}_0` : `${wall}_0+${trim}`;
}

// ---------------------------------------------------------------------------------------
// Layout (from the manifest alone)
// ---------------------------------------------------------------------------------------

interface TileSlot {
  readonly name: string;
  /** Size in cells. */
  readonly cw: number;
  readonly ch: number;
}

function tileSlots(): TileSlot[] {
  const slots: TileSlot[] = [];
  for (const spec of SPRITE_SPECS) {
    if (spec.sheet !== 'tiles') continue;
    if (spec.width % TILE_SIZE !== 0 || spec.height % TILE_SIZE !== 0) {
      throw new Error(`${spec.name}: a tile-sheet sprite must be a whole number of ${TILE_SIZE} px cells`);
    }
    for (const name of frameNamesOf(spec)) {
      slots.push({ name, cw: spec.width / TILE_SIZE, ch: spec.height / TILE_SIZE });
    }
  }
  // The baked wall tiles come last, so the manifest's tiles keep the low numbers.
  for (const wall of WALL_SPRITES) {
    for (const trim of BAKED_TRIMS) slots.push({ name: `${wall}_0+${trim}`, cw: 1, ch: 1 });
  }
  return slots;
}

function layoutTiles(): SheetLayout {
  const columns = TILE_SHEET_COLUMNS;
  const taken = new Set<number>();
  const frames: FrameRect[] = [];
  let rows = 0;
  for (const slot of tileSlots()) {
    // First fit, scanning cells in tile-number order.
    for (let n = 0; ; n++) {
      const col = n % columns;
      const row = Math.floor(n / columns);
      if (col + slot.cw > columns) continue;
      let free = true;
      for (let dy = 0; dy < slot.ch && free; dy++) {
        for (let dx = 0; dx < slot.cw && free; dx++) free = !taken.has((row + dy) * columns + col + dx);
      }
      if (!free) continue;
      for (let dy = 0; dy < slot.ch; dy++) {
        for (let dx = 0; dx < slot.cw; dx++) taken.add((row + dy) * columns + col + dx);
      }
      frames.push({
        name: slot.name,
        x: col * TILE_SIZE,
        y: row * TILE_SIZE,
        w: slot.cw * TILE_SIZE,
        h: slot.ch * TILE_SIZE,
      });
      rows = Math.max(rows, row + slot.ch);
      break;
    }
  }
  return { key: TEXTURE_KEY.tiles, width: columns * TILE_SIZE, height: rows * TILE_SIZE, frames };
}

function layoutSprites(): SheetLayout {
  // Shelf packing: tallest first, each frame on the first shelf with room for it.
  const specs = SPRITE_SPECS.filter((spec) => spec.sheet === 'sprites');
  const order = specs
    .map((spec, index) => ({ spec, index }))
    .sort((a, b) => b.spec.height - a.spec.height || a.index - b.index);
  const shelves: { y: number; h: number; x: number }[] = [];
  const frames: FrameRect[] = [];
  let height = 0;
  for (const { spec } of order) {
    if (spec.width > SPRITE_SHEET_WIDTH) throw new Error(`${spec.name}: wider than the sprite sheet`);
    for (const name of frameNamesOf(spec)) {
      let shelf = shelves.find((s) => s.h >= spec.height && s.x + spec.width <= SPRITE_SHEET_WIDTH);
      if (!shelf) {
        shelf = { y: height, h: spec.height, x: 0 };
        shelves.push(shelf);
        height += spec.height;
      }
      frames.push({ name, x: shelf.x, y: shelf.y, w: spec.width, h: spec.height });
      shelf.x += spec.width;
    }
  }
  return { key: TEXTURE_KEY.sprites, width: SPRITE_SHEET_WIDTH, height, frames };
}

function layoutFont(): SheetLayout {
  const frames: FrameRect[] = FONT_CHARS.split('').map((ch, n) => ({
    name: `glyph_${ch.charCodeAt(0)}`,
    x: n * FONT_CELL_W,
    y: 0,
    w: FONT_CELL_W,
    h: FONT_CELL_H,
  }));
  return { key: TEXTURE_KEY.font, width: FONT_CHARS.length * FONT_CELL_W, height: FONT_CELL_H, frames };
}

/** Where every tile-sheet frame sits. Fixed by the manifest. */
export const TILE_LAYOUT: SheetLayout = layoutTiles();

/** Where every sprite-sheet frame sits. Fixed by the manifest. */
export const SPRITE_LAYOUT: SheetLayout = layoutSprites();

/** Where every glyph cell sits. */
export const FONT_LAYOUT: SheetLayout = layoutFont();

const LAYOUTS: Readonly<Record<SheetName | 'font', SheetLayout>> = {
  tiles: TILE_LAYOUT,
  sprites: SPRITE_LAYOUT,
  font: FONT_LAYOUT,
};

const RECTS: ReadonlyMap<string, FrameRect & { readonly sheet: SheetName | 'font' }> = new Map(
  (['tiles', 'sprites', 'font'] as const).flatMap((sheet) =>
    LAYOUTS[sheet].frames.map((rect) => [rect.name, { ...rect, sheet }] as const),
  ),
);

/** The sheet and rectangle of a frame by name, or undefined when there is no such frame. */
export function frameRect(name: string): (FrameRect & { readonly sheet: SheetName | 'font' }) | undefined {
  return RECTS.get(name);
}

/**
 * The tile number of a tile-sheet frame, for `putTileAt` and tilemap data:
 * `tileIndex('fire_2')`, `tileIndex(wallFrameName('wall_top', true, false))`.
 *
 * For a frame of several cells, (cellX, cellY) picks the cell inside it: the porthole's
 * four tiles are `tileIndex('bg_porthole_0', 0, 0)`, `(1, 0)`, `(0, 1)` and `(1, 1)`.
 * Throws when the frame is not on the tile sheet or the cell is outside it.
 */
export function tileIndex(frame: string, cellX = 0, cellY = 0): number {
  const rect = RECTS.get(frame);
  if (rect?.sheet !== 'tiles') throw new Error(`not a tile-sheet frame: ${frame}`);
  if (cellX < 0 || cellY < 0 || cellX >= rect.w / TILE_SIZE || cellY >= rect.h / TILE_SIZE) {
    throw new Error(`${frame} has no cell (${cellX}, ${cellY})`);
  }
  return (rect.y / TILE_SIZE + cellY) * TILE_SHEET_COLUMNS + rect.x / TILE_SIZE + cellX;
}

// ---------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------

/** The grid of a tile-sheet or sprite-sheet frame, baked wall tiles included. */
function gridOf(name: string, sprites: Readonly<Record<SpriteName, Sprite>>): Frame {
  const plus = name.indexOf('+');
  const plain = plus < 0 ? name : name.slice(0, plus);
  const cut = plain.lastIndexOf('_');
  const sprite = sprites[plain.slice(0, cut) as SpriteName] as Sprite | undefined;
  let grid = sprite?.[Number(plain.slice(cut + 1))];
  if (!grid) throw new Error(`no grid for frame ${name}`);
  if (plus >= 0) {
    const trim = name.slice(plus + 1);
    if (trim.includes('l')) grid = overlayFrame(grid, sprites.trim_left[0] ?? []);
    if (trim.includes('r')) grid = overlayFrame(grid, sprites.trim_right[0] ?? []);
  }
  return grid;
}

function paint(layout: SheetLayout, grid: (name: string) => Frame): Sheet {
  const rgba = new Uint8ClampedArray(layout.width * layout.height * 4);
  for (const rect of layout.frames) paintFrame(rgba, layout.width, grid(rect.name), rect.x, rect.y);
  return { ...layout, rgba };
}

/** Everything that is wrong with the grids, as readable sentences; empty when all match the manifest. */
export function validateSprites(sprites: Readonly<Record<string, Sprite | undefined>> = SPRITES): string[] {
  const problems: string[] = [];
  for (const spec of SPRITE_SPECS) {
    const sprite = sprites[spec.name];
    if (!sprite) problems.push(`${spec.name}: missing`);
    else problems.push(...validateSprite(spec.name, sprite, spec));
  }
  const known = new Set<string>(SPRITE_SPECS.map((spec) => spec.name));
  for (const name of Object.keys(sprites)) {
    if (!known.has(name)) problems.push(`${name}: not in the manifest`);
  }
  return problems;
}

/**
 * Paints the three sheets. Throws, listing every problem, when a grid does not match
 * the manifest: a wrong size must fail loudly at boot, not show as garbage.
 */
export function buildSheets(sprites: Readonly<Record<SpriteName, Sprite>> = SPRITES): Sheets {
  const problems = validateSprites(sprites);
  if (problems.length > 0) throw new Error(`the art does not match the manifest:\n  ${problems.join('\n  ')}`);
  const cells = fontCells();
  const font = paint(FONT_LAYOUT, (name) => cells[FONT_LAYOUT.frames.findIndex((f) => f.name === name)] ?? []);
  // Glyphs are pure white so that a tint gives the exact palette colour.
  for (let i = 0; i < font.rgba.length; i += 4) {
    if (font.rgba[i + 3] !== 0) font.rgba.fill(255, i, i + 3);
  }
  return {
    tiles: paint(TILE_LAYOUT, (name) => gridOf(name, sprites)),
    sprites: paint(SPRITE_LAYOUT, (name) => gridOf(name, sprites)),
    font: { ...font, chars: FONT_CHARS, cellW: FONT_CELL_W, cellH: FONT_CELL_H, charsPerRow: FONT_CHARS.length },
  };
}
