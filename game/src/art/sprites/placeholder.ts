/**
 * Stand-ins for sprites that have no drawing yet.
 *
 * A sprite made by `placeholder()` or `seedOnly()` is remembered here, and
 * `PLACEHOLDERS` in ./index.ts lists every sprite that still is one. Nothing has to
 * be kept in step by hand: replace the call with real grids and the sprite leaves
 * the list by itself. The test "no placeholder is left" fails until the list is empty.
 */
import { GLYPH_H, GLYPH_INK, GLYPH_W, glyphOf } from '../font.ts';
import type { Frame, Sprite } from '../grid.ts';

const UNFINISHED = new WeakSet<Sprite>();

export interface PlaceholderOptions {
  /** The part of the frame the box fills, in pixels. Default: the whole frame. The rest is transparent. */
  readonly box?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Palette code of the letter. Default '0' (void). */
  readonly ink?: string;
}

/**
 * PLACEHOLDER: a flat box in the sprite's hue lane with the letter of its role.
 *
 * Where there is room the frame number follows the letter ("R0", "R1", ...), so the
 * shell can be seen changing frames; smaller boxes carry the letter alone, or just a
 * dot on the bottom row that moves one pixel per frame.
 *
 * @param fill One palette code, or one per frame (for sprites whose frames are states, such as lit and dark).
 */
export function placeholder(
  width: number,
  height: number,
  frames: number,
  fill: string | readonly string[],
  letter: string,
  options: PlaceholderOptions = {},
): Sprite {
  const box = options.box ?? { x: 0, y: 0, w: width, h: height };
  const ink = options.ink ?? '0';
  const sprite: Frame[] = [];
  for (let index = 0; index < frames; index++) {
    const code = typeof fill === 'string' ? fill : (fill[index] ?? fill[0] ?? '7');
    const grid = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h ? code : '.',
      ),
    );
    const put = (x: number, y: number): void => {
      const row = grid[y];
      if (row && x >= 0 && x < width) row[x] = ink;
    };
    const letterFits = box.w >= GLYPH_W + 2 && box.h >= GLYPH_H + 1;
    const numberFits = letterFits && frames > 1 && box.w >= GLYPH_W * 2 + 2;
    const text = !letterFits ? '' : numberFits ? `${letter}${index % 10}` : letter;
    const textW = text.length * (GLYPH_W + 1) - 1;
    const left = box.x + Math.floor((box.w - textW) / 2);
    const top = box.y + Math.floor((box.h - GLYPH_H) / 2);
    text.split('').forEach((ch, n) => {
      glyphOf(ch)?.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          if (row.charAt(gx) === GLYPH_INK) put(left + n * (GLYPH_W + 1) + gx, top + gy);
        }
      });
    });
    // Frames that could not carry their number: a dot on the bottom row, one pixel further right per frame.
    if (frames > 1 && !numberFits && typeof fill === 'string') put(box.x + (index % box.w), box.y + box.h - 1);
    sprite.push(grid.map((row) => row.join('')));
  }
  UNFINISHED.add(sprite);
  return sprite;
}

/**
 * PLACEHOLDER built on a seed: frame 0 is a real drawing (one of the guide's seed
 * grids) and the remaining frames repeat it until they are drawn. The sprite looks
 * right standing still and counts as unfinished.
 */
export function seedOnly(seed: Frame, frames: number): Sprite {
  const sprite: Frame[] = Array.from({ length: frames }, () => seed);
  UNFINISHED.add(sprite);
  return sprite;
}

/** True for a sprite made by `placeholder()` or `seedOnly()`. */
export function isPlaceholder(sprite: Sprite): boolean {
  return UNFINISHED.has(sprite);
}
