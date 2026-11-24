/**
 * preview: SEE the art. Renders sprite grids to a PNG file so that an artist can open
 * it and judge the drawing. Node only; never part of the game.
 *
 * HOW TO RUN (from the game/ folder; no build step and no extra package):
 *
 *   node src/art/tools/preview.ts <mode> [what ...] [options] <out.png>
 *
 * Node 22.18 or newer runs .ts files directly, as above. On Node 22.6 to 22.17 add the
 * flag: node --experimental-strip-types src/art/tools/preview.ts ...
 *
 * The output path is the argument that ends in .png. Pictures do not belong in the
 * project: the tool refuses to write inside game/ unless --in-project is given.
 *
 * MODES
 *   sheet [what ...]   Every frame of the chosen sprites (default: all), labelled, on the
 *                      night backdrop. Default zoom 4. Sprites that are still placeholders
 *                      are labelled TODO in amber.
 *   strip <sprite ...> The frames of one animation side by side, then the same mirrored
 *                      (how it looks facing left), then at 1x, 2x and 3x. Default zoom 8.
 *   stage [item ...]   The chosen sprites standing on a row of wall tiles, with spikes,
 *                      fire and a coolant pool beside them, at 1x, 2x and 3x in one
 *                      picture: the place to judge size and contrast together.
 *                      An item is  name[:frame][:flip][^lift][+overlay ...]  for example
 *                        hero_run:2            frame 2
 *                        cinderpeg:flip        mirrored, facing left
 *                        moth^10               lifted 10 px off the floor
 *                        hero_idle+ovl_pack+ovl_blaster   with overlays where the game puts them
 *                                                         (overlayOffsetOn: they follow the bob)
 *   font               All 47 glyphs large, then sample lines at 1x, 2x and 3x in the
 *                      text colours, and the look-alike pairs. --text adds lines.
 *   sheets             The three textures exactly as the game packs them.
 *   palette            The 24 colours with their codes, names and contrast against night.
 *   contact            The contact sheet: every sprite, labelled, then the font and its
 *                      text colours, all at one zoom (default 3). docs/art/contact-sheet.png
 *                      is this mode with --width 1400 --in-project.
 *
 * WHAT (for sheet and strip)
 *   a sprite name (hero_run), a pattern (hero_*, *_top), a group (hero, things, enemies,
 *   fx, tiles, background, hud, buttons, ui), or: all, todo (placeholders), done.
 *
 * OPTIONS
 *   --zoom N      screen pixels per art pixel (sheet, strip, sheets, font)
 *   --bg CODE     palette code or name behind the frames (default night; try void or steel)
 *   --width N     widest picture in pixels before a new line starts (default 1000)
 *   --text "..."  font mode: an extra sample line (may be repeated)
 *   --in-project  allow an output path inside game/
 *
 * EXAMPLES
 *   node src/art/tools/preview.ts sheet /tmp/art/all.png
 *   node src/art/tools/preview.ts sheet hero todo --zoom 6 /tmp/art/hero.png
 *   node src/art/tools/preview.ts strip hero_run /tmp/art/run.png
 *   node src/art/tools/preview.ts stage hero_idle cinderpeg moth^10 /tmp/art/stage.png
 *   node src/art/tools/preview.ts font /tmp/art/font.png
 *   node src/art/tools/preview.ts palette /tmp/art/palette.png
 *   node src/art/tools/preview.ts contact --width 1400 --in-project docs/art/contact-sheet.png
 *
 * A character that is not a palette code is drawn in loud magenta, and every grid that
 * does not match the manifest (wrong size, wrong frame count) is listed on the terminal.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { FONT_ADVANCE, FONT_CHARS, FONT_LINE_HEIGHT, GLYPH_H, GLYPH_INK, GLYPH_W, glyphOf } from '../font.ts';
import { mirrorFrame } from '../grid.ts';
import type { Frame } from '../grid.ts';
import { OVERLAY_OFFSET, SPRITE_SPECS, TILE_SIZE, findSpriteSpec, overlayOffsetOn } from '../manifest.ts';
import type { OverlayName, SpriteName, SpriteSpec } from '../manifest.ts';
import { PALETTE, TRANSPARENT, contrast, paletteColor } from '../palette.ts';
import { buildSheets, validateSprites } from '../pixels.ts';
import type { Sheet } from '../pixels.ts';
import { PLACEHOLDERS, SPRITES } from '../sprites/index.ts';

import { encodePng } from './png.ts';

// ---------------------------------------------------------------------------------------
// A tiny RGBA canvas
// ---------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** Not a palette colour on purpose: marks a bad character in a grid. */
const MAGENTA: Rgb = [255, 0, 255];

interface Image {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function rgbOf(code: string): Rgb {
  const entry = paletteColor(code);
  return entry ? [(entry.rgb >> 16) & 255, (entry.rgb >> 8) & 255, entry.rgb & 255] : MAGENTA;
}

function createImage(width: number, height: number, code: string): Image {
  const img: Image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  fillRect(img, 0, 0, width, height, code);
  return img;
}

function fillRgb(img: Image, x: number, y: number, w: number, h: number, [r, g, b]: Rgb): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * img.width + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
}

function fillRect(img: Image, x: number, y: number, w: number, h: number, code: string): void {
  fillRgb(img, x, y, w, h, rgbOf(code));
}

/** Draws a grid with its top-left corner at (x, y), each art pixel `zoom` screen pixels wide. */
function drawFrame(img: Image, frame: Frame, x: number, y: number, zoom = 1): void {
  frame.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      const ch = row.charAt(gx);
      if (ch === TRANSPARENT) continue;
      fillRgb(img, x + gx * zoom, y + gy * zoom, zoom, zoom, rgbOf(ch));
    }
  });
}

/** Copies `src` into `dst` at (x, y), enlarged `zoom` times. */
function paste(dst: Image, src: Image, x: number, y: number, zoom = 1): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const i = (sy * src.width + sx) * 4;
      if (src.data[i + 3] === 0) continue;
      fillRgb(dst, x + sx * zoom, y + sy * zoom, zoom, zoom, [src.data[i] ?? 0, src.data[i + 1] ?? 0, src.data[i + 2] ?? 0]);
    }
  }
}

/** Characters that labels need and the game's font lacks. They exist only in this tool. */
const LABEL_ONLY: Readonly<Record<string, Frame>> = {
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '^': ['..#..', '.#.#.', '#...#', '.....', '.....', '.....', '.....'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '(': ['...#.', '..#..', '..#..', '..#..', '..#..', '..#..', '...#.'],
  ')': ['.#...', '..#..', '..#..', '..#..', '..#..', '..#..', '.#...'],
};

/** A lower-case name is drawn in capitals; an unknown character as a hollow box. */
function glyphForLabel(ch: string): Frame {
  return LABEL_ONLY[ch] ?? glyphOf(ch.toUpperCase()) ?? ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
}

function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : (text.length * FONT_ADVANCE - 1) * scale;
}

/** Draws one line in the game's font. With `shadow`, the 1 px void shadow down and right that all game text has. */
function drawText(img: Image, text: string, x: number, y: number, code: string, scale = 1, shadow = false): void {
  const pass = (dx: number, dy: number, rgb: Rgb): void => {
    text.split('').forEach((ch, n) => {
      glyphForLabel(ch).forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          if (row.charAt(gx) !== GLYPH_INK) continue;
          fillRgb(img, x + dx + (n * FONT_ADVANCE + gx) * scale, y + dy + gy * scale, scale, scale, rgb);
        }
      });
    });
  };
  if (shadow) pass(scale, scale, rgbOf('0'));
  pass(0, 0, rgbOf(code));
}

// ---------------------------------------------------------------------------------------
// Flow layout: boxes left to right, wrapping at a width
// ---------------------------------------------------------------------------------------

interface Box {
  readonly w: number;
  readonly h: number;
  readonly draw: (img: Image, x: number, y: number) => void;
  /** Start a new line before this box and after it. */
  readonly ownLine?: boolean;
}

const MARGIN = 8;

function flow(boxes: readonly Box[], maxWidth: number, gapX = 12, gapY = 10): Image {
  const placed: { box: Box; x: number; y: number }[] = [];
  let x = MARGIN;
  let y = MARGIN;
  let lineH = 0;
  let width = 0;
  const newLine = (): void => {
    if (lineH === 0) return;
    x = MARGIN;
    y += lineH + gapY;
    lineH = 0;
  };
  for (const box of boxes) {
    if (box.ownLine === true || x + box.w > maxWidth - MARGIN) newLine();
    placed.push({ box, x, y });
    x += box.w + gapX;
    lineH = Math.max(lineH, box.h);
    width = Math.max(width, x - gapX + MARGIN);
    if (box.ownLine === true) newLine();
  }
  const img = createImage(Math.max(width, 64), y + lineH + MARGIN, '0');
  for (const { box, x: bx, y: by } of placed) box.draw(img, bx, by);
  return img;
}

function textBox(text: string, code: string, scale = 1, ownLine = true): Box {
  return {
    w: textWidth(text, scale),
    h: GLYPH_H * scale,
    ownLine,
    draw: (img, x, y) => {
      drawText(img, text, x, y, code, scale);
    },
  };
}

// ---------------------------------------------------------------------------------------
// Sprite boxes
// ---------------------------------------------------------------------------------------

/** Screen pixels between two frames of a row. */
const frameGap = (zoom: number): number => Math.max(4, zoom);

function describe(spec: SpriteSpec): string {
  const parts = [`${spec.name} ${spec.width}x${spec.height}`];
  if (spec.frames > 1) parts.push(`x${spec.frames}`);
  if (spec.ticksPerFrame !== undefined) parts.push(`${spec.ticksPerFrame}t`);
  if (PLACEHOLDERS.has(spec.name as SpriteName)) parts.push('todo');
  return parts.join(' ');
}

function framesOf(spec: SpriteSpec<SpriteName>): readonly Frame[] {
  return SPRITES[spec.name];
}

/** One row of frames on a backdrop, each `zoom` times enlarged, with the frame number under it. */
function frameRow(frames: readonly Frame[], spec: SpriteSpec, zoom: number, bg: string, numbered: boolean): Box {
  const cellW = spec.width * zoom;
  const cellH = spec.height * zoom;
  const gap = frameGap(zoom);
  return {
    w: frames.length * cellW + (frames.length - 1) * gap,
    h: cellH + (numbered ? GLYPH_H + 2 : 0),
    draw: (img, x, y) => {
      frames.forEach((frame, n) => {
        const fx = x + n * (cellW + gap);
        fillRect(img, fx, y, cellW, cellH, bg);
        drawFrame(img, frame, fx, y, zoom);
        if (numbered) drawText(img, String(n), fx, y + cellH + 2, '3');
      });
    },
  };
}

/** Boxes stacked top to bottom, as one box. */
function column(boxes: readonly Box[], gap = 3): Box {
  return {
    w: Math.max(0, ...boxes.map((b) => b.w)),
    h: boxes.reduce((sum, b) => sum + b.h, 0) + gap * Math.max(0, boxes.length - 1),
    draw: (img, x, y) => {
      let cy = y;
      for (const box of boxes) {
        box.draw(img, x, cy);
        cy += box.h + gap;
      }
    },
  };
}

/** Boxes side by side, bottoms aligned, as one box. */
function rowOf(boxes: readonly Box[], gap = 12): Box {
  const h = Math.max(0, ...boxes.map((b) => b.h));
  return {
    w: boxes.reduce((sum, b) => sum + b.w, 0) + gap * Math.max(0, boxes.length - 1),
    h,
    draw: (img, x, y) => {
      let cx = x;
      for (const box of boxes) {
        box.draw(img, cx, y + h - box.h);
        cx += box.w + gap;
      }
    },
  };
}

function labelOf(spec: SpriteSpec, extra = ''): Box {
  const todo = PLACEHOLDERS.has(spec.name as SpriteName);
  return textBox(describe(spec) + extra, todo ? 'd' : '5', 1, false);
}

function sheetBox(spec: SpriteSpec<SpriteName>, zoom: number, bg: string): Box {
  return column([labelOf(spec), frameRow(framesOf(spec), spec, zoom, bg, spec.frames > 1)]);
}

function stripBox(spec: SpriteSpec<SpriteName>, zoom: number, bg: string): Box {
  const frames = framesOf(spec);
  return {
    ...column(
      [
        labelOf(spec),
        frameRow(frames, spec, zoom, bg, true),
        textBox('mirrored', '3', 1, false),
        frameRow(frames.map(mirrorFrame), spec, zoom, bg, false),
        textBox('1x 2x 3x', '3', 1, false),
        rowOf([1, 2, 3].map((z) => frameRow(frames, spec, z, bg, false))),
      ],
      4,
    ),
    ownLine: true,
  };
}

// ---------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------

interface Options {
  readonly zoom: number | undefined;
  readonly bg: string;
  readonly width: number;
  readonly texts: readonly string[];
}

function renderSheetBoxes(specs: readonly SpriteSpec<SpriteName>[], zoom: number, bg: string): Box[] {
  const boxes: Box[] = [];
  let group = '';
  for (const spec of specs) {
    if (spec.group !== group) {
      group = spec.group;
      boxes.push(textBox(`${group}   src/art/sprites/${group}.ts`, '7'));
    }
    boxes.push(sheetBox(spec, zoom, bg));
  }
  return boxes;
}

function renderSheet(specs: readonly SpriteSpec<SpriteName>[], options: Options): Image {
  return flow(renderSheetBoxes(specs, options.zoom ?? 4, options.bg), options.width);
}

function renderStrip(specs: readonly SpriteSpec<SpriteName>[], options: Options): Image {
  const zoom = options.zoom ?? 8;
  return flow(
    specs.map((spec) => stripBox(spec, zoom, options.bg)),
    options.width,
    12,
    16,
  );
}

function sheetImage(sheet: Sheet): Image {
  return { width: sheet.width, height: sheet.height, data: sheet.rgba };
}

function renderSheets(options: Options): Image {
  const zoom = options.zoom ?? 3;
  let sheets;
  try {
    sheets = buildSheets();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const boxes: Box[] = [];
  for (const sheet of [sheets.tiles, sheets.sprites, sheets.font]) {
    boxes.push(textBox(`texture '${sheet.key}'  ${sheet.width} x ${sheet.height}  ${sheet.frames.length} frames`, '7'));
    boxes.push({
      w: sheet.width * zoom,
      h: sheet.height * zoom,
      ownLine: true,
      draw: (img, x, y) => {
        fillRect(img, x, y, sheet.width * zoom, sheet.height * zoom, options.bg);
        paste(img, sheetImage(sheet), x, y, zoom);
      },
    });
  }
  return flow(boxes, Math.max(options.width, sheets.font.width * zoom + 2 * MARGIN));
}

// --- font ------------------------------------------------------------------------------

const SAMPLE_LINES: readonly (readonly [string, string])[] = [
  ['7', 'SPRUE AND THE MOON FOUNDRY'],
  ['g', 'LEVEL 3 - THE COOLANT RUN'],
  ['c', 'SCORE 07900  BEST 06100  +200'],
  ['d', 'COG FOUND! AIRLOCK OPEN'],
  ['f', 'GAME OVER'],
  ['3', 'RESTART LEVEL -1 LIFE'],
  ['7', "LIVES LEFT 3 X 500. READY? GO, GO: IT'S 50% / 2"],
  ['7', 'THE QUICK BROWN FOX JUMPS OVER A LAZY DOG 1234567890'],
  ['7', '0O 1I 5S 8B 2Z   O0O0 I1I1 S5S5 B8B8 Z2Z2   6G D0 UV QO 7T CG'],
];

function textLine(text: string, code: string, scale: number, bg: string): Box {
  const pad = 3 * scale;
  return {
    w: textWidth(text, scale) + 2 * pad + scale,
    h: GLYPH_H * scale + 2 * pad + scale,
    ownLine: true,
    draw: (img, x, y) => {
      fillRect(img, x, y, textWidth(text, scale) + 2 * pad + scale, GLYPH_H * scale + 2 * pad + scale, bg);
      drawText(img, text, x + pad, y + pad, code, scale, true);
    },
  };
}

/** The 47 glyphs in sheet order, `zoom` times enlarged, 16 to a row. */
function glyphGrid(zoom: number, bg: string): Box[] {
  const perRow = 16;
  const cell = { w: (GLYPH_W + 1) * zoom, h: (GLYPH_H + 1) * zoom };
  const chars = FONT_CHARS.split('');
  const rows = Math.ceil(chars.length / perRow);
  return [
    textBox(`font  ${chars.length} glyphs  ${GLYPH_W}x${GLYPH_H}  advance ${FONT_ADVANCE}  line ${FONT_LINE_HEIGHT}   src/art/font.ts`, '7'),
    {
      w: perRow * (cell.w + 2),
      h: rows * (cell.h + 2),
      ownLine: true,
      draw: (img, x, y) => {
        chars.forEach((ch, n) => {
          const cx = x + (n % perRow) * (cell.w + 2);
          const cy = y + Math.floor(n / perRow) * (cell.h + 2);
          fillRect(img, cx, cy, cell.w, cell.h, bg);
          drawText(img, ch, cx + Math.floor(zoom / 2), cy + Math.floor(zoom / 2), '7', zoom);
        });
      },
    },
  ];
}

function renderFont(options: Options): Image {
  const zoom = options.zoom ?? 6;
  const boxes: Box[] = glyphGrid(zoom, options.bg);
  const letters = FONT_CHARS.slice(1, 27);
  const rest = FONT_CHARS.slice(27);
  const lines: (readonly [string, string])[] = [
    ['7', letters],
    ['7', rest],
    ...SAMPLE_LINES,
    ...options.texts.map((text) => ['7', text.toUpperCase()] as const),
  ];
  for (const scale of [1, 2, 3]) {
    boxes.push(textBox(`${scale}x`, '5'));
    for (const [code, text] of lines) boxes.push(textLine(text, code, scale, options.bg));
  }
  boxes.push(textBox('2x on void and on steel', '5'));
  for (const bg of ['0', '4']) {
    boxes.push(textLine('0O 1I 5S 8B 2Z  SCORE 08250  BEST 05185', bg === '0' ? 'c' : '7', 2, bg));
  }
  return flow(boxes, 4096, 12, 4);
}

// --- contact sheet ---------------------------------------------------------------------

/** Every sprite of the manifest, labelled, then the font and its text colours, all at one zoom. */
function renderContact(options: Options): Image {
  const zoom = options.zoom ?? 3;
  const sprites = renderSheetBoxes(SPRITE_SPECS, zoom, options.bg);
  const title = textBox(
    `${String(SPRITE_SPECS.length)} sprites, ${String(SPRITE_SPECS.reduce((sum, spec) => sum + spec.frames, 0))} frames and the font, at ${String(zoom)}x on ${paletteColor(options.bg)?.name ?? options.bg}`,
    '7',
  );
  const lines = SAMPLE_LINES.slice(0, 6).map(([code, text]) => textLine(text, code, zoom, options.bg));
  return flow([title, ...sprites, ...glyphGrid(zoom, options.bg), textBox('text colours: white, lime, gold, amber, crimson, slate', '5'), ...lines], options.width);
}

// --- palette ---------------------------------------------------------------------------

function renderPalette(): Image {
  const swatch = 28;
  const boxes: Box[] = [
    textBox('palette  24 colours  code, name, contrast against night', '7'),
    textBox("the codes are lower case in the grids: 0 to 9, a to n. '.' is transparent", '5'),
  ];
  for (const entry of PALETTE) {
    const ratio = contrast(entry.code, '1').toFixed(1);
    boxes.push({
      w: swatch + 8 + textWidth('x  deep coolant  00.0', 2),
      h: swatch,
      ownLine: true,
      draw: (img, x, y) => {
        fillRect(img, x - 2, y - 2, swatch + 4, swatch + 4, '1');
        fillRect(img, x, y, swatch, swatch, entry.code);
        drawText(img, entry.code, x + swatch + 8, y + 7, '7', 2);
        drawText(img, entry.name, x + swatch + 8 + 3 * FONT_ADVANCE * 2, y + 7, '6', 2);
        drawText(img, ratio, x + swatch + 8 + 17 * FONT_ADVANCE * 2, y + 7, '5', 2);
      },
    });
  }
  return flow(boxes, 4096, 12, 6);
}

// --- stage -----------------------------------------------------------------------------

interface StageItem {
  readonly text: string;
  readonly spec: SpriteSpec<SpriteName>;
  readonly frame: number;
  readonly flip: boolean;
  readonly lift: number;
  readonly overlays: readonly { readonly spec: SpriteSpec<SpriteName>; readonly frame: number }[];
}

const DEFAULT_STAGE = [
  'hero_idle',
  'hero_idle:flip+ovl_pack+ovl_blaster',
  'cinderpeg',
  'moth^12',
  'trophy',
  'door_locked',
  'gem_a^3',
  'pickup_blaster^3',
  'pickup_thruster^3',
];

function fail(message: string): never {
  console.error(`preview: ${message}`);
  process.exit(1);
}

function spriteOrFail(name: string): SpriteSpec<SpriteName> {
  const spec = findSpriteSpec(name);
  if (spec) return spec;
  const near = SPRITE_SPECS.filter((s) => s.name.includes(name) || name.includes(s.name)).map((s) => s.name);
  return fail(`no sprite called '${name}'.${near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : ''}`);
}

function parseStageItem(text: string): StageItem {
  const [head = '', ...overlayTexts] = text.split('+');
  const liftAt = head.indexOf('^');
  const lift = liftAt < 0 ? 0 : Number(head.slice(liftAt + 1));
  const [name = '', ...mods] = (liftAt < 0 ? head : head.slice(0, liftAt)).split(':');
  if (!Number.isFinite(lift)) fail(`bad lift in '${text}'`);
  const spec = spriteOrFail(name);
  let frame = 0;
  let flip = false;
  for (const mod of mods) {
    if (mod === 'flip') flip = true;
    else if (/^\d+$/.test(mod)) frame = Number(mod);
    else fail(`'${mod}' in '${text}' is neither a frame number nor 'flip'`);
  }
  if (frame >= spec.frames) fail(`${spec.name} has frames 0 to ${spec.frames - 1}, not ${frame}`);
  const overlays = overlayTexts.map((overlayText) => {
    const [overlayName = '', overlayFrame = '0'] = overlayText.split(':');
    const overlaySpec = spriteOrFail(overlayName);
    const index = Number(overlayFrame);
    if (!Number.isInteger(index) || index < 0 || index >= overlaySpec.frames) {
      fail(`${overlaySpec.name} has frames 0 to ${overlaySpec.frames - 1}, not '${overlayFrame}'`);
    }
    return { spec: overlaySpec, frame: index };
  });
  return { text, spec, frame, flip, lift, overlays };
}

function gridAt(spec: SpriteSpec<SpriteName>, frame: number): Frame {
  return SPRITES[spec.name][frame] ?? [];
}

const T = TILE_SIZE;

/** The stage at 1x: a floor of wall tiles, the items standing on it, hazards and the other wall pictures beside them. */
function buildStage(items: readonly StageItem[]): Image {
  const rows = 5;
  const floorRow = 3;
  // Items stand left of the hazards, a few pixels apart.
  let itemsWidth = 4;
  for (const item of items) itemsWidth += item.spec.width + 6;
  const firstHazardCol = Math.max(4, Math.ceil((T + itemsWidth) / T));
  const cols = firstHazardCol + 8;
  const spikesCol = firstHazardCol;
  const fireCol = firstHazardCol + 1;
  const poolCols = [firstHazardCol + 3, firstHazardCol + 4];
  const beamCols = [firstHazardCol + 5, firstHazardCol + 6];

  // 1. What is wall (true) on the grid.
  const wall: boolean[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const setWall = (col: number, row: number, value = true): void => {
    const line = wall[row];
    if (line && col >= 0 && col < cols) line[col] = value;
  };
  const isWall = (col: number, row: number): boolean => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return row >= rows; // below the picture counts as wall
    return wall[row]?.[col] ?? false;
  };
  for (let col = 0; col < cols; col++) {
    setWall(col, floorRow);
    setWall(col, floorRow + 1);
  }
  for (const col of poolCols) {
    setWall(col, floorRow, false);
    setWall(col, floorRow + 1, false);
  }
  setWall(0, 1); // a wall to stand next to
  setWall(0, 2);
  for (const col of beamCols) setWall(col, 1); // a floating girder
  for (let col = spikesCol; col <= fireCol + 1; col++) setWall(col, 0); // a ceiling slab over the hazards
  setWall(cols - 1, 1);
  setWall(cols - 1, 2);

  const img = createImage(cols * T, rows * T, '0');

  // 2. Backdrop: a few stars on void, then far wall panels in empty cells that touch structure.
  let seed = 12345;
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  for (let n = 0; n < Math.round((cols * rows) / 5); n++) {
    fillRect(img, Math.floor(next() * cols * T), Math.floor(next() * rows * T), 1, 1, next() < 0.5 ? '6' : '3');
  }
  const panelIsDrawn = !PLACEHOLDERS.has('bg_panel');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isWall(col, row)) continue;
      let touches = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && row + dy >= 0 && row + dy < rows && isWall(col + dx, row + dy)) touches = true;
        }
      }
      if (!touches) continue;
      if (panelIsDrawn) drawFrame(img, SPRITES.bg_panel[(col * 7 + row * 3) % 4 === 0 ? 1 : 0] ?? [], col * T, row * T);
      else fillRect(img, col * T, row * T, T, T, '1');
    }
  }

  // 3. Walls, by the guide's variant rule, with the side trims laid over.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!isWall(col, row)) continue;
      const base = (isWall(col, row - 1) || row === 0 ? 0 : 1) + (isWall(col, row + 1) ? 0 : 2);
      const name = (['wall_fill', 'wall_top', 'wall_bottom', 'wall_beam'] as const)[base] ?? 'wall_fill';
      const riveted = base === 0 && (col * 3 + row) % 5 === 0;
      drawFrame(img, SPRITES[riveted ? 'wall_fill_b' : name][0] ?? [], col * T, row * T);
      const poolLeft = poolCols.includes(col - 1);
      const poolRight = poolCols.includes(col + 1);
      if (col > 0 && !isWall(col - 1, row) && !poolLeft) drawFrame(img, SPRITES.trim_left[0] ?? [], col * T, row * T);
      if (col < cols - 1 && !isWall(col + 1, row) && !poolRight) drawFrame(img, SPRITES.trim_right[0] ?? [], col * T, row * T);
    }
  }

  // 4. Hazards.
  drawFrame(img, SPRITES.spikes[0] ?? [], spikesCol * T, (floorRow - 1) * T);
  drawFrame(img, SPRITES.fire[0] ?? [], fireCol * T, (floorRow - 1) * T);
  poolCols.forEach((col, n) => {
    drawFrame(img, SPRITES.coolant_top[n % 4] ?? [], col * T, floorRow * T);
    drawFrame(img, SPRITES.coolant_body[n % 2] ?? [], col * T, (floorRow + 1) * T);
  });

  // 5. The items, feet on the floor.
  let x = T + 4;
  for (const item of items) {
    const y = floorRow * T - item.spec.height - item.lift;
    const grid = gridAt(item.spec, item.frame);
    drawFrame(img, item.flip ? mirrorFrame(grid) : grid, x, y);
    for (const overlay of item.overlays) {
      // As the game places them: overlays follow the hero's bob and vanish once he breaks.
      const name = overlay.spec.name;
      const offset = isOverlayName(name)
        ? overlayOffsetOn(name, `${item.spec.name}_${String(item.frame)}`)
        : { x: 0, y: 0 };
      if (!offset) continue;
      const overlayGrid = gridAt(overlay.spec, overlay.frame);
      const ox = item.flip ? item.spec.width - offset.x - overlay.spec.width : offset.x;
      drawFrame(img, item.flip ? mirrorFrame(overlayGrid) : overlayGrid, x + ox, y + offset.y);
    }
    x += item.spec.width + 6;
  }
  return img;
}

function isOverlayName(name: string): name is OverlayName {
  return Object.hasOwn(OVERLAY_OFFSET, name);
}

function renderStage(itemTexts: readonly string[]): Image {
  const items = (itemTexts.length > 0 ? itemTexts : DEFAULT_STAGE).map(parseStageItem);
  const stage = buildStage(items);
  const zooms = [1, 2, 3];
  const labelH = GLYPH_H + 3;
  const width = stage.width * 3 + 2 * MARGIN;
  const height = zooms.reduce((sum, z) => sum + stage.height * z + labelH + MARGIN, MARGIN);
  const img = createImage(width, height, '0');
  let y = MARGIN;
  for (const zoom of zooms) {
    drawText(img, `${zoom}x`, MARGIN, y, '5');
    if (zoom === 1) drawText(img, items.map((item) => item.text).join('  '), MARGIN + 24, y, '3');
    y += labelH;
    paste(img, stage, MARGIN, y, zoom);
    y += stage.height * zoom + MARGIN;
  }
  return img;
}

// ---------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------

const GROUPS: readonly string[] = [...new Set(SPRITE_SPECS.map((spec) => spec.group))];

function select(tokens: readonly string[]): SpriteSpec<SpriteName>[] {
  if (tokens.length === 0) return [...SPRITE_SPECS];
  const chosen = new Set<SpriteName>();
  for (const token of tokens) {
    let matches: readonly SpriteSpec<SpriteName>[];
    if (token === 'all') matches = SPRITE_SPECS;
    else if (token === 'todo') matches = SPRITE_SPECS.filter((s) => PLACEHOLDERS.has(s.name));
    else if (token === 'done') matches = SPRITE_SPECS.filter((s) => !PLACEHOLDERS.has(s.name));
    else if (GROUPS.includes(token)) matches = SPRITE_SPECS.filter((s) => s.group === token);
    else if (token.includes('*')) {
      const pattern = new RegExp(`^${token.split('*').map((part) => part.replace(/[^a-z0-9_]/g, '')).join('.*')}$`);
      matches = SPRITE_SPECS.filter((s) => pattern.test(s.name));
      if (matches.length === 0) fail(`no sprite matches '${token}'`);
    } else matches = [spriteOrFail(token)];
    for (const spec of matches) chosen.add(spec.name);
  }
  return SPRITE_SPECS.filter((spec) => chosen.has(spec.name)); // manifest order, whatever was typed
}

function backdropCode(text: string): string {
  const entry = PALETTE.find((c) => c.code === text || c.name === text.toLowerCase() || c.name.replaceAll(' ', '') === text.toLowerCase());
  if (!entry) fail(`--bg wants a palette code or name (${PALETTE.map((c) => c.name).join(', ')}), not '${text}'`);
  return entry.code;
}

const USAGE = `usage: node src/art/tools/preview.ts <mode> [what ...] [options] <out.png>
  modes:   sheet [what ...] | strip <sprite ...> | stage [item ...] | font | sheets | palette | contact
  what:    sprite name, pattern (hero_*), group (${GROUPS.join(', ')}), all, todo, done
  item:    name[:frame][:flip][^lift][+overlay ...]   e.g. hero_idle:flip+ovl_pack  moth^10
  options: --zoom N  --bg CODE|NAME  --width N  --text "LINE"  --in-project
The top of src/art/tools/preview.ts has the full description and examples.`;

function main(argv: readonly string[]): void {
  const words: string[] = [];
  const texts: string[] = [];
  let out: string | undefined;
  let zoom: number | undefined;
  let bg = '1';
  let width = 1000;
  let inProject = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = (): string => {
      i += 1;
      return argv[i] ?? fail(`${arg} needs a value`);
    };
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return;
    } else if (arg === '--zoom' || arg === '-z') zoom = Number(value());
    else if (arg === '--bg') bg = backdropCode(value());
    else if (arg === '--width') width = Number(value());
    else if (arg === '--text') texts.push(value());
    else if (arg === '--in-project') inProject = true;
    else if (arg === '--out' || arg === '-o') out = value();
    else if (arg.startsWith('--')) fail(`unknown option ${arg}\n${USAGE}`);
    else if (arg.toLowerCase().endsWith('.png')) out = arg;
    else words.push(arg);
  }
  const [mode, ...what] = words;
  if (mode === undefined) fail(`no mode given\n${USAGE}`);
  if (out === undefined) fail(`no output path given (an argument ending in .png)\n${USAGE}`);
  if (zoom !== undefined && (!Number.isInteger(zoom) || zoom < 1 || zoom > 32)) fail('--zoom wants a whole number from 1 to 32');
  if (!Number.isInteger(width) || width < 100) fail('--width wants a whole number of at least 100');

  const outPath = path.resolve(out);
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  if (!inProject && !path.relative(projectRoot, outPath).startsWith('..')) {
    fail(`${outPath} is inside the project. Pictures go in a scratch folder; pass --in-project if you really mean it.`);
  }

  const started = performance.now();
  const options: Options = { zoom, bg, width, texts };
  let img: Image;
  let shown: readonly SpriteSpec<SpriteName>[] = [];
  if (mode === 'sheet') {
    shown = select(what);
    img = renderSheet(shown, options);
  } else if (mode === 'strip') {
    if (what.length === 0) fail('strip needs at least one sprite name');
    shown = select(what);
    img = renderStrip(shown, options);
  } else if (mode === 'stage') {
    img = renderStage(what);
  } else if (mode === 'font') {
    img = renderFont(options);
  } else if (mode === 'sheets') {
    img = renderSheets(options);
  } else if (mode === 'contact') {
    shown = SPRITE_SPECS;
    img = renderContact(options);
  } else if (mode === 'palette') {
    img = renderPalette();
  } else {
    fail(`unknown mode '${mode}'\n${USAGE}`);
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, encodePng(img.width, img.height, img.data));
  const ms = Math.round(performance.now() - started);
  console.log(`wrote ${outPath}  ${img.width} x ${img.height}  (${ms} ms)`);

  const todo = shown.filter((spec) => PLACEHOLDERS.has(spec.name)).map((spec) => spec.name);
  if (todo.length > 0) console.log(`still placeholders (${todo.length}): ${todo.join(', ')}`);
  const problems = validateSprites();
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s) in the grids (magenta marks a bad character):`);
    for (const problem of problems.slice(0, 40)) console.log(`  ${problem}`);
    if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
    process.exitCode = 2;
  }
}

main(process.argv.slice(2));
