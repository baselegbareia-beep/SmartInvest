/**
 * Hands the art to Phaser. The only file in src/art that touches Phaser or the DOM:
 * the layout and the pixels come from ./pixels.ts, which runs in Node and is tested there.
 *
 * Follows docs/PHASER4-NOTES.md, section 4 (canvas texture, putImageData, refresh,
 * named frames) and section 9 (bitmap font through RetroFont.Parse).
 *
 * Use, in BootScene.create() (there is no preload):
 *
 *   makeArt(this);
 *   this.add.image(x, y, TEXTURE_KEY.sprites, 'hero_idle_0').setOrigin(0, 0);
 *   map.addTilesetImage(TEXTURE_KEY.tiles, TEXTURE_KEY.tiles, TILE_SIZE, TILE_SIZE, 0, 0);
 *   layer.putTileAt(tileIndex('fire_0'), col, row);
 *   this.add.bitmapText(x, y, FONT_KEY, 'LEVEL 1', FONT_SIZE).setTint(COLOR.white);
 *
 * The glyphs are pure white, so a tint gives the exact palette colour; untinted text
 * is slightly whiter than the palette's white, so tint normal text with COLOR.white.
 */
import * as Phaser from 'phaser';

import { FONT_LINE_SPACING } from './font.ts';
import { FONT_KEY } from './manifest.ts';
import { buildSheets } from './pixels.ts';
import type { Sheet } from './pixels.ts';

/**
 * Turns one painted sheet into ONE canvas texture with a named frame per rectangle.
 * Throws when the texture key is already in use.
 */
export function makeSheet(textures: Phaser.Textures.TextureManager, sheet: Sheet): Phaser.Textures.CanvasTexture {
  const tex = textures.createCanvas(sheet.key, sheet.width, sheet.height);
  if (!tex) throw new Error(`texture key already in use: ${sheet.key}`); // createCanvas returns null on a duplicate key
  const ctx = tex.getContext();
  const img = ctx.createImageData(sheet.width, sheet.height);
  img.data.set(sheet.rgba);
  ctx.putImageData(img, 0, 0);
  tex.refresh(); // REQUIRED: uploads the canvas to the GPU. Without it the texture is blank.
  for (const frame of sheet.frames) tex.add(frame.name, 0, frame.x, frame.y, frame.w, frame.h);
  return tex;
}

/**
 * Registers a fixed-cell bitmap font whose glyphs live in a texture made by makeSheet
 * (white on transparent, one glyph per cell, in the order of `chars`).
 * The font's size is the cell WIDTH: draw it at whole multiples of cellW.
 */
export function addPixelFont(
  scene: Phaser.Scene,
  fontKey: string,
  textureKey: string,
  chars: string,
  cellW: number,
  cellH: number,
  charsPerRow: number,
  lineSpacing: number,
): void {
  // RetroFontConfig is typed with literal keys such as 'offset.x', hence the cast.
  const config = { image: textureKey, width: cellW, height: cellH, chars, charsPerRow, lineSpacing };
  const entry = Phaser.GameObjects.RetroFont.Parse(
    scene,
    config as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig,
  );
  scene.cache.bitmapFont.add(fontKey, entry); // pass Parse()'s result itself, NOT { data: entry }
}

/**
 * Builds every texture of the game and the font: the tile sheet, the sprite sheet and
 * the glyph sheet (keys in TEXTURE_KEY), and the bitmap font FONT_KEY. Call it once.
 * Throws when a sprite grid does not match the manifest.
 */
export function makeArt(scene: Phaser.Scene): void {
  const { tiles, sprites, font } = buildSheets();
  makeSheet(scene.textures, tiles);
  makeSheet(scene.textures, sprites);
  makeSheet(scene.textures, font);
  addPixelFont(scene, FONT_KEY, font.key, font.chars, font.cellW, font.cellH, font.charsPerRow, FONT_LINE_SPACING);
}
