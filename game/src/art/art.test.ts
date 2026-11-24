/**
 * The checks of docs/ART-AND-SOUND.md (section 14) that concern the art, and the
 * guide itself: the palette and manifest tables of the document are read here and
 * compared with the code, so neither can drift from the other.
 *
 * The last test, "no placeholder is left", fails until every sprite has a drawing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TILE_PX } from '../core/types';

import {
  FONT_ADVANCE,
  FONT_CELL_H,
  FONT_CELL_W,
  FONT_CHARS,
  FONT_LINE_HEIGHT,
  GLYPHS,
  GLYPH_COUNT,
  GLYPH_H,
  GLYPH_INK,
  GLYPH_W,
  canDraw,
  fontCells,
  glyphOf,
  textWidth,
} from './font.ts';
import {
  countChars,
  decodeFrame,
  frameName,
  mirrorFrame,
  opaqueBounds,
  overlayFrame,
  validateFrame,
  validateSprite,
} from './grid.ts';
import type { Frame } from './grid.ts';
import {
  FRAME_COUNT,
  FX_SCRAP_FRAMES,
  GEM_SPRITES,
  HERO_FRAMES_WITHOUT_GEAR,
  MANIFEST,
  OVERLAY_OFFSET,
  SPRITE_COUNT,
  SPRITE_SPECS,
  TILE_SIZE,
  WALL_SPRITES,
  frameNamesOf,
  frameOf,
  gemSpriteAt,
  loopFrame,
  overlayOffsetOn,
  spriteSpec,
} from './manifest.ts';
import type { SpriteName } from './manifest.ts';
import {
  COLOR,
  PALETTE,
  PALETTE_CODES,
  TRANSPARENT,
  codeToHex,
  codeToRgb,
  codeToRgba,
  contrast,
  isGridChar,
  isPaletteCode,
} from './palette.ts';
import {
  FONT_LAYOUT,
  MAX_SHEET_SIZE,
  SPRITE_LAYOUT,
  TILE_LAYOUT,
  TILE_SHEET_COLUMNS,
  buildSheets,
  frameRect,
  tileIndex,
  validateSprites,
  wallFrameName,
} from './pixels.ts';
import type { FrameRect, Sheet, SheetLayout } from './pixels.ts';
import { PLACEHOLDERS, SPRITES, frameGrid } from './sprites/index.ts';
import { isPlaceholder, placeholder, seedOnly } from './sprites/placeholder.ts';

const ART_DIR = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(ART_DIR, '..', '..');
const GUIDE = readFileSync(path.join(GAME_DIR, 'docs', 'ART-AND-SOUND.md'), 'utf8');

/** The text of one numbered section of the guide, from its heading to the next one. */
function guideSection(number: number): string {
  const start = GUIDE.indexOf(`\n## ${number}. `);
  const end = GUIDE.indexOf(`\n## ${number + 1}. `);
  if (start < 0) throw new Error(`the guide has no section ${number}`);
  return GUIDE.slice(start, end < 0 ? undefined : end);
}

/** The cells of every table row of a text: '| a | b |' gives ['a', 'b']. */
function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function pixelAt(sheet: Sheet, x: number, y: number): number[] {
  const i = (y * sheet.width + x) * 4;
  return Array.from(sheet.rgba.subarray(i, i + 4));
}

const finished = (name: SpriteName): boolean => !PLACEHOLDERS.has(name);

// ---------------------------------------------------------------------------------------

describe('palette', () => {
  it('has 24 colours with one-character codes, none used twice', () => {
    expect(PALETTE).toHaveLength(24);
    expect(new Set(PALETTE.map((c) => c.code)).size).toBe(24);
    expect(new Set(PALETTE.map((c) => c.hex)).size).toBe(24);
    for (const c of PALETTE) {
      expect(c.code).toMatch(/^[0-9a-n]$/);
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.rgb).toBe(Number.parseInt(c.hex.slice(1), 16));
    }
    expect(PALETTE_CODES).toBe('0123456789abcdefghijklmn');
  });

  it('is the table of the guide, section 2: codes, colours, names and roles', () => {
    const rows = tableRows(guideSection(2)).filter((cells) => /^`.`$/.test(cells[0] ?? ''));
    expect(rows).toHaveLength(24);
    expect(PALETTE.map((c) => [`\`${c.code}\``, c.hex, c.name, c.role])).toEqual(rows);
  });

  it('gives the same colours by name as by code', () => {
    const camel = (name: string): string => name.replace(/ (.)/g, (_, ch: string) => ch.toUpperCase());
    expect(Object.keys(COLOR)).toEqual(PALETTE.map((c) => camel(c.name)));
    expect(Object.values(COLOR)).toEqual(PALETTE.map((c) => c.rgb));
  });

  it('turns codes into RGBA, and "." into a transparent pixel', () => {
    expect(codeToRgba('g')).toEqual([0xb4, 0xf0, 0x4a, 255]);
    expect(codeToRgba('0')).toEqual([0x0b, 0x0d, 0x1a, 255]);
    expect(codeToRgba(TRANSPARENT)).toEqual([0, 0, 0, 0]);
    expect(codeToRgb('c')).toBe(0xffd65c);
    expect(codeToHex('c')).toBe('#ffd65c');
    expect(() => codeToRgba('z')).toThrow(/not a palette code/);
    expect(() => codeToRgb('.')).toThrow(/not a palette code/);
    expect(isPaletteCode('n')).toBe(true);
    expect(isPaletteCode('.')).toBe(false);
    expect(isGridChar('.')).toBe(true);
    expect(isGridChar('o')).toBe(false);
    expect(isGridChar('A')).toBe(false);
  });

  it('has the contrast against night that the guide lists', () => {
    const listed: Record<string, number> = {
      cream: 13.3,
      lime: 12.6,
      gold: 12.2,
      ice: 11.9,
      earthlight: 10.4,
      amber: 7.6,
      rose: 6.7,
      'light steel': 5.3,
      violet: 5.0,
      'furnace red': 3.9,
      steel: 2.8,
      char: 1.3,
    };
    for (const [name, ratio] of Object.entries(listed)) {
      const code = PALETTE.find((c) => c.name === name)?.code ?? '';
      expect(Math.abs(contrast(code, '1') - ratio), `${name} on night`).toBeLessThan(0.06);
    }
  });
});

// ---------------------------------------------------------------------------------------

describe('sprite format (grid.ts)', () => {
  const good: Frame = ['.7.', '787', '.7.'];

  it('accepts a frame of the right size made of palette codes and "."', () => {
    expect(validateFrame('x_0', good, 3, 3)).toEqual([]);
    expect(validateSprite('x', [good, good], { width: 3, height: 3, frames: 2 })).toEqual([]);
  });

  it('reports a wrong frame count, row count, row length and character, each by name', () => {
    expect(validateSprite('x', [good], { width: 3, height: 3, frames: 2 })).toEqual(['x: has 1 frames, expected 2']);
    expect(validateFrame('x_0', ['.7.', '787'], 3, 3)).toEqual(['x_0: has 2 rows, expected 3']);
    expect(validateFrame('x_0', ['.7.', '78', '.7.'], 3, 3)).toEqual(['x_0 row 1: is 2 characters long, expected 3']);
    expect(validateFrame('x_0', ['.7.', '7z7', '.7.'], 3, 3)).toEqual([
      "x_0 row 1, column 1: 'z' is not a palette code or '.'",
    ]);
    expect(validateFrame('x_0', ['.7.', '7#7', '.7 '], 3, 3)).toHaveLength(2);
  });

  it('names frames by sprite name, underscore and number from 0', () => {
    expect(frameName('hero_run', 0)).toBe('hero_run_0');
    expect(frameName('hero_run', 3)).toBe('hero_run_3');
  });

  it('decodes a frame to RGBA, row by row', () => {
    const pixels = decodeFrame(['g.', '.0']);
    expect(pixels.width).toBe(2);
    expect(pixels.height).toBe(2);
    expect(Array.from(pixels.data)).toEqual([0xb4, 0xf0, 0x4a, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0x0b, 0x0d, 0x1a, 255]);
    expect(() => decodeFrame(['g?'])).toThrow(/not a palette code/);
  });

  it('mirrors a frame left to right, and twice gives the frame back', () => {
    const frame: Frame = ['12.', '.34', '5..'];
    expect(mirrorFrame(frame)).toEqual(['.21', '43.', '..5']);
    expect(mirrorFrame(mirrorFrame(frame))).toEqual(frame);
    expect(frame).toEqual(['12.', '.34', '5..']); // the input is not changed
  });

  it('lays one frame over another, letting the base show through "."', () => {
    expect(overlayFrame(['444', '444'], ['5..', '..6'])).toEqual(['544', '446']);
    expect(overlayFrame(['4444', '4444', '4444'], ['g7'], 1, 2)).toEqual(['4444', '4444', '4g74']);
  });

  it('finds the box of the opaque pixels', () => {
    expect(opaqueBounds(['....', '.77.', '.7..', '....'])).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
    expect(opaqueBounds(['..', '..'])).toBeNull();
    expect(countChars(['7.', '77']).get('7')).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------

describe('manifest', () => {
  it('lists 62 sprites and 111 frames, as the guide says', () => {
    const [, sprites, frames] = /(\d+) sprites, (\d+) frames/.exec(guideSection(4)) ?? [];
    expect(SPRITE_COUNT).toBe(62);
    expect(FRAME_COUNT).toBe(111);
    expect([Number(sprites), Number(frames)]).toEqual([SPRITE_COUNT, FRAME_COUNT]);
  });

  it('names no sprite twice and no frame twice', () => {
    const names = SPRITE_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    const frames = SPRITE_SPECS.flatMap(frameNamesOf);
    expect(frames).toHaveLength(FRAME_COUNT);
    expect(new Set(frames).size).toBe(frames.length);
  });

  it('matches every row of the tables in the guide, section 4: size, frames, ticks per frame', () => {
    const listed = new Map<string, { width: number; height: number; frames: number; ticksPerFrame: number | undefined }>();
    for (const cells of tableRows(guideSection(4))) {
      const [nameCell = '', sizeCell = '', framesCell = '', description = ''] = cells;
      const names = [...nameCell.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '');
      const size = /^(\d+)x(\d+)$/.exec(sizeCell);
      const frames = /^(\d+)( each)?$/.exec(framesCell);
      if (names.length === 0 || !size || !frames) continue;
      const ticks = /(\d+) ticks per frame/.exec(description);
      for (const name of names) {
        expect(listed.has(name), `${name} is listed twice in the guide`).toBe(false);
        listed.set(name, {
          width: Number(size[1]),
          height: Number(size[2]),
          frames: Number(frames[1]),
          ticksPerFrame: ticks ? Number(ticks[1]) : undefined,
        });
      }
    }
    expect([...listed.keys()].sort()).toEqual(SPRITE_SPECS.map((spec) => spec.name).sort());
    for (const spec of SPRITE_SPECS) {
      expect(
        { width: spec.width, height: spec.height, frames: spec.frames, ticksPerFrame: spec.ticksPerFrame },
        spec.name,
      ).toEqual(listed.get(spec.name));
    }
  });

  it('puts walls, hazards and decoration on the tile sheet and everything else on the sprite sheet', () => {
    const onTiles = SPRITE_SPECS.filter((spec) => spec.sheet === 'tiles').map((spec) => spec.name);
    expect(onTiles).toEqual([
      'wall_fill',
      'wall_fill_b',
      'wall_top',
      'wall_bottom',
      'wall_beam',
      'trim_left',
      'trim_right',
      'fire',
      'coolant_top',
      'coolant_body',
      'spikes',
      'bg_panel',
      'bg_pipe_h',
      'bg_pipe_v',
      'bg_vent',
      'bg_brace',
      'bg_chain',
      'bg_hook',
      'bg_porthole',
    ]);
    expect(spriteSpec('backdrop_earth').sheet).toBe('sprites');
    expect(spriteSpec('backdrop_ridge').sheet).toBe('sprites');
    for (const spec of SPRITE_SPECS) {
      if (spec.sheet !== 'tiles') continue;
      expect(spec.width % TILE_SIZE, spec.name).toBe(0);
      expect(spec.height % TILE_SIZE, spec.name).toBe(0);
    }
  });

  it('uses the tile size of the core', () => {
    expect(TILE_SIZE).toBe(TILE_PX);
  });

  it('gives frame names for looping sprites by tick', () => {
    expect(frameOf('hero_run', 5)).toBe('hero_run_1');
    expect(frameOf('hero_run', -1)).toBe('hero_run_3');
    expect(loopFrame('fire', 0)).toBe('fire_0');
    expect(loopFrame('fire', 8)).toBe('fire_1');
    expect(loopFrame('fire', 8 * 4 + 7)).toBe('fire_0');
    expect(loopFrame('coolant_body', 59)).toBe('coolant_body_1');
    expect(loopFrame('spikes', 1234)).toBe('spikes_0');
    expect(gemSpriteAt(0, 0)).toBe('gem_a');
    expect(gemSpriteAt(1, 0)).toBe('gem_b');
    expect(gemSpriteAt(0, 1)).toBe('gem_c');
    expect(GEM_SPRITES).toHaveLength(3);
    expect(WALL_SPRITES).toHaveLength(5);
  });

  it('keeps the overlays where the guide puts them', () => {
    expect(OVERLAY_OFFSET).toEqual({
      ovl_blaster: { x: 8, y: 6 },
      ovl_pack: { x: 0, y: 5 },
      thrust_flame: { x: 0, y: 13 },
    });
    const text = guideSection(4);
    expect(text).toContain('at sprite offset (8, 6)');
    expect(text).toContain('at sprite offset (0, 5)');
    expect(text).toContain('at sprite offset (0, 13)');
  });

  it('moves the overlays with the body on every frame, and drops them once Sprue breaks', () => {
    // The body's top is the rim's outline row; it is 1 px higher on the bob of the run and in the jump.
    const rimTop = (frame: Frame): number => frame.findIndex((row) => row.includes('0000000000'));
    const standing = rimTop(SPRITES.hero_idle[0] ?? []);
    for (const name of ['hero_idle', 'hero_run', 'hero_jump', 'hero_fall', 'hero_thrust'] as const) {
      SPRITES[name].forEach((frame, index) => {
        for (const overlay of ['ovl_blaster', 'ovl_pack', 'thrust_flame'] as const) {
          expect(overlayOffsetOn(overlay, `${name}_${String(index)}`), `${overlay} on ${name}_${String(index)}`).toEqual({
            x: OVERLAY_OFFSET[overlay].x,
            y: OVERLAY_OFFSET[overlay].y + rimTop(frame) - standing,
          });
        }
      });
    }
    expect(overlayOffsetOn('ovl_pack', 'hero_die_0')).toEqual(OVERLAY_OFFSET.ovl_pack);
    expect([...HERO_FRAMES_WITHOUT_GEAR].sort()).toEqual(['hero_die_1', 'hero_die_2', 'hero_die_3']);
    for (const frame of HERO_FRAMES_WITHOUT_GEAR) expect(overlayOffsetOn('ovl_blaster', frame)).toBeNull();
  });

  it('names fx_scrap bits that exist, and gives enemies none of Sprue\'s colours', () => {
    expect(FX_SCRAP_FRAMES.playerDied).toEqual([0, 1, 2, 3]);
    for (const index of FX_SCRAP_FRAMES.enemyKilled) {
      const counts = countChars(SPRITES.fx_scrap[index] ?? []);
      for (const code of ['8', 'g', 'h']) expect(counts.get(code) ?? 0, `fx_scrap_${String(index)} has '${code}'`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------

describe('sprite grids', () => {
  it('has a sprite for every entry of the manifest and nothing else', () => {
    expect(Object.keys(SPRITES).sort()).toEqual(SPRITE_SPECS.map((spec) => spec.name).sort());
  });

  it.each(MANIFEST.map((spec) => [spec.name, spec] as const))(
    '%s has the listed size and frames, equal rows, and only palette codes or "."',
    (name, spec) => {
      expect(validateSprite(name, SPRITES[name], spec)).toEqual([]);
    },
  );

  it('passes the check the game runs at boot', () => {
    expect(validateSprites()).toEqual([]);
    expect(validateSprites({ ...SPRITES, hero_jump: [['77']], stray: [['7']] })).toEqual([
      'hero_jump_0: has 1 rows, expected 16',
      'hero_jump_0 row 0: is 2 characters long, expected 16',
      'stray: not in the manifest',
    ]);
    expect(validateSprites({ ...SPRITES, moth: undefined })).toEqual(['moth: missing']);
  });

  it('finds a frame grid by its frame name', () => {
    expect(frameGrid('wall_top_0')).toBe(SPRITES.wall_top[0]);
    expect(frameGrid('hero_run_3')).toBe(SPRITES.hero_run[3]);
    expect(frameGrid('hero_run_4')).toBeUndefined();
    expect(frameGrid('nothing_0')).toBeUndefined();
    expect(frameGrid('hero_run')).toBeUndefined();
  });

  it('makes placeholders of the right shape and remembers them', () => {
    const box = placeholder(16, 16, 4, '8', 'R');
    expect(validateSprite('box', box, { width: 16, height: 16, frames: 4 })).toEqual([]);
    expect(isPlaceholder(box)).toBe(true);
    expect(new Set(box.map((frame) => frame.join(''))).size).toBe(4); // every frame looks different
    const tiny = placeholder(4, 4, 4, '6', 'D');
    expect(validateSprite('tiny', tiny, { width: 4, height: 4, frames: 4 })).toEqual([]);
    expect(new Set(tiny.map((frame) => frame.join(''))).size).toBe(4);
    const part = placeholder(16, 16, 1, '5', 'L', { box: { x: 0, y: 0, w: 2, h: 16 } });
    expect(part[0]?.[0]).toBe('55..............');
    const seeded = seedOnly(['77', '77'], 3);
    expect(seeded).toHaveLength(3);
    expect(isPlaceholder(seeded)).toBe(true);
    expect(isPlaceholder([['77', '77']])).toBe(false);
  });

  // The rules below are the guide's; they bind a sprite once it has a real drawing.

  it('draws nothing that can kill mostly in char (guide, section 2)', () => {
    for (const name of ['cinderpeg', 'moth', 'fire', 'spikes'] as const) {
      if (!finished(name)) continue;
      SPRITES[name].forEach((frame, index) => {
        const counts = countChars(frame);
        const opaque = frame.join('').length - (counts.get(TRANSPARENT) ?? 0);
        expect((counts.get('b') ?? 0) * 2, `${name}_${index} is mostly char`).toBeLessThanOrEqual(opaque);
      });
    }
  });

  it('draws the spikes 12 px wide and 9 px tall, standing on the floor (guide, section 4)', () => {
    if (!finished('spikes')) return;
    expect(opaqueBounds(SPRITES.spikes[0] ?? [])).toEqual({ left: 2, top: 7, right: 13, bottom: 15 });
  });

  it('keeps the two trims to a 2 px edge (guide, section 4)', () => {
    if (finished('trim_left')) expect(opaqueBounds(SPRITES.trim_left[0] ?? [])).toMatchObject({ left: 0, right: 1 });
    if (finished('trim_right')) expect(opaqueBounds(SPRITES.trim_right[0] ?? [])).toMatchObject({ left: 14, right: 15 });
  });

  it('draws the solid flame 12 px wide and 13 px tall, with only its tongues above (guide, section 4)', () => {
    // The kill box is 3 px in from each side and 4 px down from the top (TUNING.forgiveness);
    // the art is 1 px larger on each side: columns 2 to 13, rows 3 to 15.
    const flameIn = (row: string): number => row.slice(2, 14).replace(/[^cdef]/g, '').length;
    SPRITES.fire.forEach((frame, index) => {
      const where = `fire_${String(index)}`;
      expect(opaqueBounds(frame), where).toMatchObject({ left: 2, right: 13, bottom: 15 });
      for (let row = 5; row <= 13; row++) expect(flameIn(frame[row] ?? ''), `${where} row ${String(row)}`).toBe(12);
      expect(flameIn(frame[4] ?? ''), `${where} row 4`).toBeGreaterThanOrEqual(11);
      expect(flameIn(frame[3] ?? ''), `${where} row 3`).toBeGreaterThanOrEqual(8);
      for (const row of [14, 15]) expect(frame[row]?.slice(2, 14), `${where}: the grate, row ${String(row)}`).not.toContain(TRANSPARENT);
    });
  });

  it('keeps Sprue in his 10 x 14 box with his feet on row 15; only the aerial and the rim stick out (guide, section 4)', () => {
    // The box is columns 3 to 12, rows 2 to 15. The rim is the two rows from its outline down.
    for (const name of ['hero_idle', 'hero_run', 'hero_jump', 'hero_fall', 'hero_thrust'] as const) {
      SPRITES[name].forEach((frame, index) => {
        const where = `${name}_${String(index)}`;
        const rimTop = frame.findIndex((row) => row.includes('0000000000'));
        expect(rimTop, `${where}: the rim`).toBeGreaterThanOrEqual(2);
        frame.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row.charAt(x) === TRANSPARENT) continue;
            const inBox = x >= 3 && x <= 12 && y >= 2;
            const aerialOrRim = y <= rimTop + 1;
            expect(inBox || aerialOrRim, `${where} has a pixel at (${String(x)}, ${String(y)})`).toBe(true);
          }
        });
        if (name !== 'hero_jump') expect(frame[15]?.replace(/\./g, ''), `${where}: feet on row 15`).not.toBe('');
      });
    }
  });

  it('lets both enemies fill their cell from side to side (guide, section 4)', () => {
    for (const name of ['cinderpeg', 'moth'] as const) {
      SPRITES[name].forEach((frame, index) => {
        expect(opaqueBounds(frame), `${name}_${String(index)}`).toMatchObject({ left: 0, right: 15 });
      });
    }
  });

  it('keeps every hue in its lane (guide, section 1, rule 1)', () => {
    const sprue = ['hero_idle', 'hero_run', 'hero_jump', 'hero_fall', 'hero_thrust', 'hero_die', 'ovl_blaster', 'ovl_pack', 'thrust_flame', 'bolt'] as const;
    const lanes: readonly { readonly codes: string; readonly lane: string; readonly sprites: readonly SpriteName[] }[] = [
      { codes: 'c', lane: 'gold: the cog (the fire core and the ember eyes too)', sprites: ['trophy', 'hud_cog', 'logo_cog', 'icon', 'fire', 'cinderpeg'] },
      {
        codes: 'gh',
        lane: 'lime: Sprue and his tools',
        sprites: [...sprue, 'door_opening', 'door_open', 'pickup_blaster', 'pickup_thruster', 'fx_scrap', 'hud_life', 'hud_blaster', 'hud_thruster', 'hud_pip', 'btn_fire', 'btn_thrust', 'icon'],
      },
      { codes: '8', lane: "cream: Sprue's light side", sprites: [...sprue, 'fx_scrap', 'hud_life', 'icon'] },
      { codes: '9a', lane: "tan and rust: Sprue, and the Cinderpeg's slag", sprites: [...sprue, 'fx_scrap', 'hud_life', 'icon', 'cinderpeg'] },
      { codes: 'ef', lane: 'red: fire, enemies, spike tips', sprites: ['fire', 'spikes', 'cinderpeg', 'moth', 'fx_poof'] },
      { codes: 'ijk', lane: 'ice: coolant', sprites: ['coolant_top', 'coolant_body'] },
      { codes: 'lmn', lane: 'violet and rose: ore', sprites: ['gem_a', 'gem_b', 'gem_c'] },
    ];
    for (const spec of SPRITE_SPECS) {
      const used = new Set(SPRITES[spec.name].join('').split(''));
      for (const { codes, lane, sprites } of lanes) {
        const strays = Array.from(codes).filter((code) => used.has(code));
        if (strays.length > 0) expect(sprites, `${spec.name} uses '${strays.join('')}' (${lane})`).toContain(spec.name);
      }
    }
    // The Cinderpeg's gold is its two ember eyes alone (rows 6 and 7, columns 9 to 13).
    SPRITES.cinderpeg.forEach((frame, index) => {
      frame.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row.charAt(x) === 'c') expect(y >= 6 && y <= 7 && x >= 9 && x <= 13, `cinderpeg_${String(index)} gold at (${String(x)}, ${String(y)})`).toBe(true);
        }
      });
    });
  });
});

// ---------------------------------------------------------------------------------------

describe('font', () => {
  it('has all 47 glyphs at 5 x 7', () => {
    expect(GLYPH_COUNT).toBe(47);
    expect(GLYPHS.size).toBe(47);
    expect([GLYPH_W, GLYPH_H]).toEqual([5, 7]);
    for (const [ch, rows] of GLYPHS) {
      expect(rows, `glyph '${ch}'`).toHaveLength(7);
      for (const row of rows) expect(row, `glyph '${ch}'`).toMatch(/^[#.]{5}$/);
    }
    const [, w, h, count] = /\| font \| (\d+)x(\d+) \| (\d+) glyphs/.exec(guideSection(4)) ?? [];
    expect([Number(w), Number(h), Number(count)]).toEqual([GLYPH_W, GLYPH_H, GLYPH_COUNT]);
  });

  it('holds the characters in the order of the guide, section 7', () => {
    const punctuation = /then `([^`]+)`/.exec(guideSection(7))?.[1]?.split(' ').join('') ?? '';
    expect(punctuation).toHaveLength(10);
    expect(FONT_CHARS).toBe(` ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789${punctuation}`);
    expect(FONT_CHARS).toHaveLength(47);
    expect(new Set(FONT_CHARS).size).toBe(47);
  });

  it('has an empty space and ink in every other glyph, and no two glyphs alike', () => {
    expect(glyphOf(' ')?.join('')).toBe('.'.repeat(35));
    const seen = new Set<string>();
    for (const [ch, rows] of GLYPHS) {
      const flat = rows.join('');
      if (ch !== ' ') expect(flat, `glyph '${ch}'`).toContain(GLYPH_INK);
      expect(seen.has(flat), `glyph '${ch}' is the same as another`).toBe(false);
      seen.add(flat);
    }
  });

  it('keeps the look-alike pairs apart by at least 3 pixels', () => {
    const difference = (a: string, b: string): number => {
      const [x, y] = [glyphOf(a)?.join('') ?? '', glyphOf(b)?.join('') ?? ''];
      let n = 0;
      for (let i = 0; i < 35; i++) if (x.charAt(i) !== y.charAt(i)) n++;
      return n;
    };
    for (const [a, b] of ['0O', '1I', '5S', '8B', '2Z', '6G', 'D0', 'DO', 'UV', 'QO', '7T', 'CG'].map((p) => p.split(''))) {
      expect(difference(a ?? '', b ?? ''), `${a} and ${b}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses a 6 x 8 cell, an advance of 6 and a line height of 9', () => {
    expect([FONT_CELL_W, FONT_CELL_H, FONT_ADVANCE, FONT_LINE_HEIGHT]).toEqual([6, 8, 6, 9]);
    const cells = fontCells();
    expect(cells).toHaveLength(47);
    cells.forEach((cell, n) => {
      expect(validateFrame(`cell ${n}`, cell, FONT_CELL_W, FONT_CELL_H)).toEqual([]);
      expect(cell[FONT_CELL_H - 1]).toBe('......'); // the empty row below
      for (const row of cell) expect(row.charAt(FONT_CELL_W - 1)).toBe('.'); // the empty column on the right
    });
  });

  it('measures text and knows what it can draw', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('A')).toBe(5);
    expect(36 + textWidth('LEVEL 10')).toBe(83); // the guide, section 8: "Ends at x = 83 for LEVEL 10"
    expect(textWidth('0'.repeat(5))).toBe(29); // five score digits
    expect(textWidth('X'.repeat(42)) + 1).toBe(252); // the guide, section 7: 42 characters are 252 px
    expect(canDraw("COG FOUND! AIRLOCK OPEN")).toBe(true);
    expect(canDraw("LIVES LEFT 3 X 500, 50% +200 -1 /?:'.")).toBe(true);
    expect(canDraw('lower case')).toBe(false);
    expect(canDraw('A_B')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------

describe('sheets (pixels.ts)', () => {
  const sheets = buildSheets();
  const layouts: readonly SheetLayout[] = [TILE_LAYOUT, SPRITE_LAYOUT, FONT_LAYOUT];

  it('gives no two frames the same name, on any sheet', () => {
    const names = layouts.flatMap((layout) => layout.frames.map((rect) => rect.name));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).not.toMatch(/^\d+$/); // numeric keys would be reordered by JavaScript
  });

  it('places every frame of the manifest once, on its own sheet, at its own size', () => {
    for (const spec of SPRITE_SPECS) {
      for (const name of frameNamesOf(spec)) {
        const rect = frameRect(name);
        expect(rect, name).toBeDefined();
        expect(rect?.sheet, name).toBe(spec.sheet);
        expect([rect?.w, rect?.h], name).toEqual([spec.width, spec.height]);
      }
    }
    const placed = [...TILE_LAYOUT.frames, ...SPRITE_LAYOUT.frames].filter((rect) => !rect.name.includes('+'));
    expect(placed).toHaveLength(FRAME_COUNT);
    expect(frameRect('nothing_0')).toBeUndefined();
  });

  it('fits every sheet in 1024 x 1024, with no frame outside it and no two frames overlapping', () => {
    const overlap = (a: FrameRect, b: FrameRect): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const layout of layouts) {
      expect(layout.width, layout.key).toBeLessThanOrEqual(MAX_SHEET_SIZE);
      expect(layout.height, layout.key).toBeLessThanOrEqual(MAX_SHEET_SIZE);
      expect(MAX_SHEET_SIZE).toBe(1024);
      layout.frames.forEach((a, i) => {
        expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= layout.width && a.y + a.h <= layout.height, a.name).toBe(true);
        for (const b of layout.frames.slice(i + 1)) expect(overlap(a, b), `${a.name} and ${b.name}`).toBe(false);
      });
    }
  });

  it('keeps the art, font included, under half the area of one 256 x 256 texture', () => {
    const art = SPRITE_SPECS.reduce((sum, spec) => sum + spec.width * spec.height * spec.frames, 0);
    expect(art + GLYPH_COUNT * FONT_CELL_W * FONT_CELL_H).toBeLessThan((256 * 256) / 2);
  });

  it('numbers the tiles row by row, the manifest tiles first and in manifest order', () => {
    expect(TILE_LAYOUT.width).toBe(TILE_SHEET_COLUMNS * TILE_SIZE);
    const single: string[] = [];
    for (const spec of SPRITE_SPECS) {
      if (spec.sheet === 'tiles' && spec.width === TILE_SIZE && spec.height === TILE_SIZE) single.push(...frameNamesOf(spec));
    }
    expect(single.map((name) => tileIndex(name))).toEqual(single.map((_, n) => n));
    expect(tileIndex('wall_fill_0')).toBe(0);
    expect(tileIndex('fire_0')).toBe(7);
    expect(tileIndex('spikes_0')).toBe(17);
    const indexes = new Set<number>();
    for (const rect of TILE_LAYOUT.frames) {
      expect(rect.x % TILE_SIZE, rect.name).toBe(0);
      expect(rect.y % TILE_SIZE, rect.name).toBe(0);
      for (let cy = 0; cy < rect.h / TILE_SIZE; cy++) {
        for (let cx = 0; cx < rect.w / TILE_SIZE; cx++) {
          const index = tileIndex(rect.name, cx, cy);
          expect(index).toBe((rect.y / TILE_SIZE + cy) * TILE_SHEET_COLUMNS + rect.x / TILE_SIZE + cx);
          expect(indexes.has(index), `tile ${index} is used twice`).toBe(false);
          indexes.add(index);
        }
      }
    }
  });

  it('gives the porthole four tiles in a square', () => {
    const base = tileIndex('bg_porthole_0');
    expect(tileIndex('bg_porthole_0', 1, 0)).toBe(base + 1);
    expect(tileIndex('bg_porthole_0', 0, 1)).toBe(base + TILE_SHEET_COLUMNS);
    expect(tileIndex('bg_porthole_0', 1, 1)).toBe(base + TILE_SHEET_COLUMNS + 1);
    expect(() => tileIndex('bg_porthole_0', 2, 0)).toThrow(/no cell/);
    expect(() => tileIndex('hero_idle_0')).toThrow(/not a tile-sheet frame/);
    expect(() => tileIndex('fire_9')).toThrow(/not a tile-sheet frame/);
  });

  it('bakes the side trims into extra wall tiles', () => {
    expect(wallFrameName('wall_top', false, false)).toBe('wall_top_0');
    expect(wallFrameName('wall_top', true, false)).toBe('wall_top_0+l');
    expect(wallFrameName('wall_fill_b', false, true)).toBe('wall_fill_b_0+r');
    expect(wallFrameName('wall_beam', true, true)).toBe('wall_beam_0+lr');
    for (const wall of WALL_SPRITES) {
      for (const [left, right] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const name = wallFrameName(wall, left, right);
        const rect = frameRect(name);
        expect(rect?.sheet, name).toBe('tiles');
        if (!rect) continue;
        let expected: Frame = SPRITES[wall][0] ?? [];
        if (left) expected = overlayFrame(expected, SPRITES.trim_left[0] ?? []);
        if (right) expected = overlayFrame(expected, SPRITES.trim_right[0] ?? []);
        expected.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            expect(pixelAt(sheets.tiles, rect.x + x, rect.y + y), `${name} (${x}, ${y})`).toEqual([...codeToRgba(row.charAt(x))]);
          }
        });
      }
    }
  });

  it('paints every frame of the manifest exactly as its grid says', () => {
    expect(sheets.tiles.rgba).toHaveLength(TILE_LAYOUT.width * TILE_LAYOUT.height * 4);
    expect(sheets.sprites.rgba).toHaveLength(SPRITE_LAYOUT.width * SPRITE_LAYOUT.height * 4);
    for (const spec of SPRITE_SPECS) {
      const sheet = spec.sheet === 'tiles' ? sheets.tiles : sheets.sprites;
      SPRITES[spec.name].forEach((grid, index) => {
        const rect = frameRect(frameName(spec.name, index));
        if (!rect) throw new Error(`${spec.name}_${index} is not on a sheet`);
        const wrong: string[] = [];
        grid.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            const want = codeToRgba(row.charAt(x)).join(',');
            if (pixelAt(sheet, rect.x + x, rect.y + y).join(',') !== want) wrong.push(`(${x}, ${y})`);
          }
        });
        expect(wrong, `${spec.name}_${index}`).toEqual([]);
      });
    }
  });

  it('leaves every pixel outside the frames transparent', () => {
    for (const sheet of [sheets.tiles, sheets.sprites]) {
      const covered = new Uint8Array(sheet.width * sheet.height);
      for (const rect of sheet.frames) {
        for (let y = rect.y; y < rect.y + rect.h; y++) covered.fill(1, y * sheet.width + rect.x, y * sheet.width + rect.x + rect.w);
      }
      let stray = 0;
      for (let i = 0; i < covered.length; i++) if (covered[i] === 0 && sheet.rgba[i * 4 + 3] !== 0) stray++;
      expect(stray, sheet.key).toBe(0);
    }
  });

  it('paints the font as one row of 47 cells, pure white on transparent, in the order of FONT_CHARS', () => {
    const { font } = sheets;
    expect([font.width, font.height]).toEqual([47 * 6, 8]);
    expect(font.chars).toBe(FONT_CHARS);
    expect([font.cellW, font.cellH, font.charsPerRow]).toEqual([6, 8, 47]);
    FONT_CHARS.split('').forEach((ch, n) => {
      const glyph = glyphOf(ch) ?? [];
      for (let y = 0; y < FONT_CELL_H; y++) {
        for (let x = 0; x < FONT_CELL_W; x++) {
          const ink = glyph[y]?.charAt(x) === GLYPH_INK;
          expect(pixelAt(font, n * FONT_CELL_W + x, y), `'${ch}' (${x}, ${y})`).toEqual(ink ? [255, 255, 255, 255] : [0, 0, 0, 0]);
        }
      }
    });
  });

  it('refuses to build from grids that do not match the manifest', () => {
    expect(() => buildSheets({ ...SPRITES, hero_jump: [['77']] })).toThrow(/hero_jump_0: has 1 rows, expected 16/);
  });
});

// ---------------------------------------------------------------------------------------

describe('layering', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourceFiles(path.join(dir, entry.name))
        : /\.[cm]?[jt]s$/.test(entry.name)
          ? [path.join(dir, entry.name)]
          : [],
    );

  /** Every import of a file: what is imported from, and whether only types are taken. */
  const importsOf = (file: string): { source: string; typeOnly: boolean }[] =>
    [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => ({
      source: m[2] ?? '',
      typeOnly: m[1] !== undefined,
    }));

  const artFiles = sourceFiles(ART_DIR);
  const inFolder = (file: string, folder: string): boolean => !path.relative(path.join(GAME_DIR, 'src', folder), file).startsWith('..');

  it('finds the art files', () => {
    expect(artFiles.length).toBeGreaterThanOrEqual(19);
    expect(importsOf(path.join(ART_DIR, 'makeSheet.ts')).map((i) => i.source)).toContain('phaser');
  });

  it('lets src/art import nothing from src/shell, src/input or src/audio, and only types from src/core/types.ts', () => {
    for (const file of artFiles) {
      const isTest = file.endsWith('.test.ts');
      for (const { source, typeOnly } of importsOf(file)) {
        if (!source.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), source).replace(/\.[cm]?[jt]s$/, '');
        const where = `${path.relative(GAME_DIR, file)} imports ${source}`;
        for (const folder of ['shell', 'input', 'audio']) expect(inFolder(target, folder), where).toBe(false);
        if (inFolder(target, 'core')) {
          expect(path.relative(path.join(GAME_DIR, 'src', 'core'), target), where).toBe('types');
          if (!isTest) expect(typeOnly, `${where}: must be "import type"`).toBe(true);
        } else if (!isTest) {
          expect(inFolder(target, 'art'), where).toBe(true);
        }
      }
    }
  });

  it('keeps Phaser in makeSheet.ts and Node in the tools', () => {
    for (const file of artFiles) {
      const name = path.relative(ART_DIR, file);
      for (const { source } of importsOf(file)) {
        if (source === 'phaser' || source.startsWith('phaser/')) expect(name, 'imports phaser').toBe('makeSheet.ts');
        if (source.startsWith('node:')) expect(name.startsWith('tools') || name.endsWith('.test.ts'), `${name} imports ${source}`).toBe(true);
      }
    }
  });

  it('is not imported by src/core, and neither is src/audio (guide, section 14)', () => {
    for (const file of sourceFiles(path.join(GAME_DIR, 'src', 'core'))) {
      for (const { source } of importsOf(file)) {
        if (!source.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), source);
        for (const folder of ['art', 'audio']) expect(inFolder(target, folder), `${path.relative(GAME_DIR, file)} imports ${source}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------

describe('art is finished', () => {
  it('no placeholder is left', () => {
    // Fails until every sprite listed here has a drawing in src/art/sprites/<group>.ts.
    expect([...PLACEHOLDERS], 'sprites that still have no finished drawing').toEqual([]);
  });
});
