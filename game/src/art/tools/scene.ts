/**
 * scene: draws a whole level file as the game will show it, to a PNG. Node only;
 * never part of the game. The place to judge tiles, hazards, decoration and backdrop
 * together, with the hero, the pickups and the enemies standing in them.
 *
 * HOW TO RUN (from the game/ folder; no build step and no extra package):
 *
 *   node src/art/tools/scene.ts <levels/name.txt> [options] <out.png>
 *
 * Node 22.18 or newer runs .ts files directly. The output path is the argument that
 * ends in .png; the tool refuses to write inside game/ unless --in-project is given.
 *
 * WHAT IS DRAWN, back to front (docs/ART-AND-SOUND.md, section 6):
 *   backdrop     void, the stars, the crescent Earth once, the ridge along the bottom
 *   decoration   far-wall panels, then chains, vents, pipes, braces and portholes
 *   tiles        walls with their variants and side trims, then the hazards
 *   things       pickups, the cog, the locked airlock, enemies, Sprue on his start cell
 * Every choice comes from src/art/tilePick.ts, the same functions the game's tile
 * layer calls.
 *
 * The grid is read straight from the file's text (lines that start with '@' or ';'
 * are skipped; the legend is docs/LEVELS.md, section 1), so the tool does not depend
 * on the level parser.
 *
 * OPTIONS
 *   --zoom N            screen pixels per art pixel (default 2)
 *   --tick N            the simulation tick, for the animated tiles (default 0)
 *   --window C,R        show one view instead of the whole level: its top-left tile is
 *                       column C, row R. The backdrop is then placed as on a phone:
 *                       stars scroll at 0.2 of the camera, Earth and ridge at 0.1
 *   --view COLSxROWS    the size of that view in tiles (default 30x14, the largest)
 *   --seed N            the level's seed (default: from the file name, as levelSeed does)
 *   --ridge-lift N      lift the ridge N px above the bottom and fill the ground under it
 *   --no-things         leave out pickups, cog, airlock, enemies and Sprue
 *   --no-decoration     leave out panels and decoration
 *   --in-project        allow an output path inside game/
 *
 * EXAMPLES
 *   node src/art/tools/scene.ts levels/debug.txt /tmp/art/debug.png
 *   node src/art/tools/scene.ts levels/test.txt --zoom 3 /tmp/art/test-3x.png
 *   node src/art/tools/scene.ts levels/debug.txt --window 0,0 /tmp/art/phone.png
 *   node src/art/tools/scene.ts levels/debug.txt --tick 8 --window 34,0 --view 17x10 --zoom 4 /tmp/art/small.png
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { mirrorFrame } from '../grid.ts';
import type { Frame } from '../grid.ts';
import { ENEMY_SPRITE, ITEM_PICKUP_SPRITE, TILE_SIZE, gemSpriteAt, spriteSpec } from '../manifest.ts';
import type { SpriteName } from '../manifest.ts';
import { TRANSPARENT, paletteColor } from '../palette.ts';
import { validateSprites } from '../pixels.ts';
import { SPRITES } from '../sprites/index.ts';
import { KIND, decorate, earthSpot, farShift, hazardFrameIndex, hazardPick, levelSeed, ridgeTop, starField, starShift, wallPick } from '../tilePick.ts';
import type { CellRef, TileGrid } from '../tilePick.ts';

import { encodePng } from './png.ts';

// ---------------------------------------------------------------------------------------
// A tiny RGBA canvas
// ---------------------------------------------------------------------------------------

/** A picture: `data` holds width * height * 4 bytes, RGBA, row by row. */
export interface Image {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

type Rgb = readonly [number, number, number];

/** Not a palette colour on purpose: marks a bad character in a grid. */
const MAGENTA: Rgb = [255, 0, 255];

function rgbOf(code: string): Rgb {
  const entry = paletteColor(code);
  return entry ? [(entry.rgb >> 16) & 255, (entry.rgb >> 8) & 255, entry.rgb & 255] : MAGENTA;
}

function fillRect(img: Image, x: number, y: number, w: number, h: number, code: string): void {
  const [r, g, b] = rgbOf(code);
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

function createImage(width: number, height: number, code: string): Image {
  const img: Image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  fillRect(img, 0, 0, width, height, code);
  return img;
}

/** Draws a grid with its top-left corner at (x, y); pixels outside the image are dropped. */
function drawFrame(img: Image, frame: Frame, x: number, y: number): void {
  frame.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      const ch = row.charAt(gx);
      if (ch !== TRANSPARENT) fillRect(img, x + gx, y + gy, 1, 1, ch);
    }
  });
}

/** The image enlarged a whole number of times. */
export function enlarge(src: Image, zoom: number): Image {
  const out: Image = { width: src.width * zoom, height: src.height * zoom, data: new Uint8ClampedArray(src.width * zoom * src.height * zoom * 4) };
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / zoom);
    for (let x = 0; x < out.width; x++) {
      const from = (sy * src.width + Math.floor(x / zoom)) * 4;
      const to = (y * out.width + x) * 4;
      out.data[to] = src.data[from] ?? 0;
      out.data[to + 1] = src.data[from + 1] ?? 0;
      out.data[to + 2] = src.data[from + 2] ?? 0;
      out.data[to + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The level file
// ---------------------------------------------------------------------------------------

type Thing =
  | (CellRef & { readonly what: 'start' | 'trophy' | 'door' | 'crystal' | 'blaster' | 'thruster' | 'cinderpeg' })
  | (CellRef & { readonly what: 'moth'; readonly axis: 'h' | 'v' });

/** The grid of a level file and the things standing in it. */
export interface Level extends TileGrid {
  /** The file stem: 'debug', 'level-03'. */
  readonly id: string;
  readonly things: readonly Thing[];
}

function fail(message: string): never {
  console.error(`scene: ${message}`);
  process.exit(1);
}

/** Reads the grid of a level file: every line that does not start with '@' or ';'. */
export function readLevel(file: string): Level {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return fail(`cannot read ${file}`);
  }
  const rows = text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0 && !line.startsWith('@') && !line.startsWith(';'));
  const width = rows[0]?.length ?? 0;
  if (width === 0) fail(`${file} has no grid`);
  const tiles = new Uint8Array(width * rows.length);
  const things: Thing[] = [];
  rows.forEach((line, row) => {
    if (line.length !== width) fail(`${file}: grid row ${row} is ${line.length} characters long, the first is ${width}`);
    for (let col = 0; col < width; col++) {
      const ch = line.charAt(col);
      const cell = { col, row };
      let kind: number = KIND.Empty;
      if (ch === '#') kind = KIND.Solid;
      else if (ch === 'F') kind = KIND.Fire;
      else if (ch === 'W') kind = KIND.Coolant;
      else if (ch === 'S') kind = KIND.Spikes;
      else if (ch === 'P') things.push({ ...cell, what: 'start' });
      else if (ch === 'T') things.push({ ...cell, what: 'trophy' });
      else if (ch === 'D') things.push({ ...cell, what: 'door' });
      else if (ch === 'G') things.push({ ...cell, what: 'crystal' });
      else if (ch === 'B') things.push({ ...cell, what: 'blaster' });
      else if (ch === 'J') things.push({ ...cell, what: 'thruster' });
      else if (ch === 'C') things.push({ ...cell, what: 'cinderpeg' });
      else if (ch === 'M') things.push({ ...cell, what: 'moth', axis: 'v' });
      else if (ch === 'H') things.push({ ...cell, what: 'moth', axis: 'h' });
      else if (ch !== '.') fail(`${file}: grid row ${row}, column ${col}: '${ch}' is not in the legend`);
      tiles[row * width + col] = kind;
    }
  });
  return { id: path.basename(file).replace(/\.txt$/, ''), width, height: rows.length, tiles, things };
}

// ---------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------

export interface SceneOptions {
  readonly tick: number;
  readonly seed: number;
  /** The view in art pixels and where its top-left corner is in the level. */
  readonly viewW: number;
  readonly viewH: number;
  readonly camX: number;
  readonly camY: number;
  readonly ridgeLift: number;
  readonly things: boolean;
  readonly decoration: boolean;
}

const T = TILE_SIZE;

function grid(name: SpriteName, index = 0): Frame {
  return SPRITES[name][index] ?? [];
}

/** The frame of a steadily looping sprite at a tick. */
function looped(name: SpriteName, tick: number): Frame {
  const spec = spriteSpec(name);
  const index = spec.ticksPerFrame === undefined ? 0 : Math.floor(tick / spec.ticksPerFrame) % spec.frames;
  return grid(name, index);
}

function drawBackdrop(img: Image, level: Level, o: SceneOptions): void {
  const maxCamX = Math.max(0, level.width * T - o.viewW);
  const maxCamY = Math.max(0, level.height * T - o.viewH);
  for (const star of starField(o.seed, o.viewW, o.viewH)) {
    fillRect(img, starShift(star.x, o.camX, o.viewW), starShift(star.y, o.camY, o.viewH), 1, 1, star.code);
  }
  const earth = earthSpot(o.seed, o.viewW, o.viewH, maxCamX, maxCamY);
  drawFrame(img, grid('backdrop_earth'), farShift(earth.x, o.camX), farShift(earth.y, o.camY));

  const ridge = grid('backdrop_ridge');
  const ridgeW = spriteSpec('backdrop_ridge').width;
  const top = ridgeTop(o.viewH, o.camY, maxCamY) - o.ridgeLift;
  const first = farShift(0, o.camX) % ridgeW;
  for (let x = first > 0 ? first - ridgeW : first; x < o.viewW; x += ridgeW) drawFrame(img, ridge, x, top);
  // Ground under a lifted ridge: the colour of the ridge's last row.
  const ground = ridge[ridge.length - 1]?.charAt(0) ?? TRANSPARENT;
  if (ground !== TRANSPARENT) fillRect(img, 0, top + ridge.length, o.viewW, o.viewH, ground);
}

function drawWorld(img: Image, level: Level, o: SceneOptions): void {
  const ox = -o.camX;
  const oy = -o.camY;
  const eachCell = (visit: (col: number, row: number, x: number, y: number) => void): void => {
    for (let row = 0; row < level.height; row++) {
      for (let col = 0; col < level.width; col++) visit(col, row, ox + col * T, oy + row * T);
    }
  };

  // Decoration: the panel first, then the object over it.
  if (o.decoration) {
    const occupied = level.things.filter((thing) => ['trophy', 'door', 'crystal', 'blaster', 'thruster'].includes(thing.what));
    const decoration = decorate(level, o.seed, occupied);
    eachCell((col, row, x, y) => {
      const pick = decoration.at(col, row);
      if (pick.panel) drawFrame(img, grid('bg_panel', pick.panel === 'bg_panel_1' ? 1 : 0), x, y);
    });
    eachCell((col, row, x, y) => {
      const object = decoration.at(col, row).over;
      if (!object) return;
      const name = object.frame.replace(/_0$/, '') as SpriteName;
      const cell = grid(name).slice(object.cellY * T, (object.cellY + 1) * T).map((line) => line.slice(object.cellX * T, (object.cellX + 1) * T));
      drawFrame(img, cell, x, y);
    });
  }

  // Walls with their trims, then hazards.
  eachCell((col, row, x, y) => {
    const wall = wallPick(level, col, row);
    if (wall) {
      drawFrame(img, grid(wall.sprite), x, y);
      if (wall.trimLeft) drawFrame(img, grid('trim_left'), x, y);
      if (wall.trimRight) drawFrame(img, grid('trim_right'), x, y);
    }
    const hazard = hazardPick(level, col, row);
    if (hazard) drawFrame(img, grid(hazard.sprite, hazardFrameIndex(hazard, o.tick)), x, y);
  });

  if (!o.things) return;
  // Pickups, cog and airlock; then enemies; then Sprue.
  const order = ['crystal', 'blaster', 'thruster', 'trophy', 'door', 'cinderpeg', 'moth', 'start'];
  const things = [...level.things].sort((a, b) => order.indexOf(a.what) - order.indexOf(b.what));
  for (const thing of things) {
    const x = ox + thing.col * T;
    const y = oy + thing.row * T;
    switch (thing.what) {
      case 'crystal':
        drawFrame(img, grid(gemSpriteAt(thing.col, thing.row)), x, y);
        break;
      case 'blaster':
      case 'thruster':
        drawFrame(img, grid(ITEM_PICKUP_SPRITE[thing.what]), x, y);
        break;
      case 'trophy':
        drawFrame(img, looped('trophy', o.tick), x, y);
        break;
      case 'door':
        drawFrame(img, grid('door_locked'), x, y);
        break;
      case 'cinderpeg':
        // A Cinderpeg starts walking left: mirrored.
        drawFrame(img, mirrorFrame(looped(ENEMY_SPRITE.cinderpeg, o.tick)), x, y);
        break;
      case 'moth': {
        // A sideways moth starts leftward: mirrored. An up-and-down moth is never flipped.
        const frame = looped(ENEMY_SPRITE.moth, o.tick);
        drawFrame(img, thing.axis === 'h' ? mirrorFrame(frame) : frame, x, y);
        break;
      }
      case 'start':
        // The 16 px sprite centred on the collision box with the feet flush: exactly the start cell.
        drawFrame(img, grid('hero_idle'), x, y);
        break;
    }
  }
}

/** The scene at one screen pixel per art pixel. */
export function renderScene(level: Level, o: SceneOptions): Image {
  const img = createImage(o.viewW, o.viewH, '0');
  drawBackdrop(img, level, o);
  drawWorld(img, level, o);
  return img;
}

// ---------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------

const USAGE = `usage: node src/art/tools/scene.ts <levels/name.txt> [options] <out.png>
  options: --zoom N  --tick N  --window C,R  --view COLSxROWS  --seed N  --ridge-lift N
           --no-things  --no-decoration  --in-project
The top of src/art/tools/scene.ts has the full description and examples.`;

function wholeNumber(text: string, what: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) fail(`${what} wants a whole number from ${min} to ${max}, not '${text}'`);
  return value;
}

function main(argv: readonly string[]): void {
  let levelFile: string | undefined;
  let out: string | undefined;
  let zoom = 2;
  let tick = 0;
  let seed: number | undefined;
  let window: { col: number; row: number } | undefined;
  let view = { cols: 30, rows: 14 };
  let ridgeLift = 0;
  let things = true;
  let decoration = true;
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
    } else if (arg === '--zoom' || arg === '-z') zoom = wholeNumber(value(), '--zoom', 1, 16);
    else if (arg === '--tick') tick = wholeNumber(value(), '--tick', 0, 1_000_000);
    else if (arg === '--seed') seed = wholeNumber(value(), '--seed', 0, 0x7fffffff);
    else if (arg === '--ridge-lift') ridgeLift = wholeNumber(value(), '--ridge-lift', 0, 400);
    else if (arg === '--window') {
      const [col = '', row = ''] = value().split(',');
      window = { col: wholeNumber(col, '--window column', 0, 63), row: wholeNumber(row, '--window row', 0, 23) };
    } else if (arg === '--view') {
      const [cols = '', rows = ''] = value().toLowerCase().split('x');
      view = { cols: wholeNumber(cols, '--view columns', 1, 64), rows: wholeNumber(rows, '--view rows', 1, 24) };
    } else if (arg === '--no-things') things = false;
    else if (arg === '--no-decoration') decoration = false;
    else if (arg === '--in-project') inProject = true;
    else if (arg === '--out' || arg === '-o') out = value();
    else if (arg.startsWith('--')) fail(`unknown option ${arg}\n${USAGE}`);
    else if (arg.toLowerCase().endsWith('.png')) out = arg;
    else if (levelFile === undefined) levelFile = arg;
    else fail(`one level file at a time: '${levelFile}' and '${arg}'\n${USAGE}`);
  }
  if (levelFile === undefined) fail(`no level file given\n${USAGE}`);
  if (out === undefined) fail(`no output path given (an argument ending in .png)\n${USAGE}`);

  const outPath = path.resolve(out);
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  if (!inProject && !path.relative(projectRoot, outPath).startsWith('..')) {
    fail(`${outPath} is inside the project. Pictures go in a scratch folder; pass --in-project if you really mean it.`);
  }

  const started = performance.now();
  const level = readLevel(levelFile);
  const levelW = level.width * T;
  const levelH = level.height * T;
  // A view never shows more than the level: where the level is smaller, the view shrinks to it.
  const viewW = window ? Math.min(view.cols * T, levelW) : levelW;
  const viewH = window ? Math.min(view.rows * T, levelH) : levelH;
  const img = renderScene(level, {
    tick,
    seed: seed ?? levelSeed(level.id),
    viewW,
    viewH,
    camX: window ? Math.min(window.col * T, levelW - viewW) : 0,
    camY: window ? Math.min(window.row * T, levelH - viewH) : 0,
    ridgeLift,
    things,
    decoration,
  });

  mkdirSync(path.dirname(outPath), { recursive: true });
  const big = enlarge(img, zoom);
  writeFileSync(outPath, encodePng(big.width, big.height, big.data));
  const ms = Math.round(performance.now() - started);
  console.log(`wrote ${outPath}  ${big.width} x ${big.height}  (${level.id}: ${level.width} x ${level.height} tiles, zoom ${zoom}, ${ms} ms)`);

  const problems = validateSprites();
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s) in the grids (magenta marks a bad character):`);
    for (const problem of problems.slice(0, 40)) console.log(`  ${problem}`);
    process.exitCode = 2;
  }
}

// Run as a command; other scripts may import readLevel and renderScene without it starting.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
