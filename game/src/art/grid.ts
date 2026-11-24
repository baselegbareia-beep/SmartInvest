/**
 * The sprite format (docs/ART-AND-SOUND.md, section 3) and the pure functions on it.
 *
 * - A frame is a list of text rows of equal length. Each character is one pixel:
 *   a palette code or '.' for transparent.
 * - A sprite is a list of frames of the same size, drawn facing right. Facing left
 *   is a mirror flip, never a second drawing.
 * - Frame names are the sprite name, an underscore and the frame number from 0.
 *
 * No Phaser, no DOM: everything here runs in Node.
 */
import { TRANSPARENT, codeToRgba, isGridChar } from './palette.ts';

/** One picture: rows of palette characters, top row first. */
export type Frame = readonly string[];

/** One sprite: its frames in animation order. */
export type Sprite = readonly Frame[];

/** The size and frame count a sprite must have. */
export interface SpriteShape {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

/**
 * Decoded pixels: `data` holds width * height * 4 bytes, RGBA, row by row. In a browser
 * it can go straight into a canvas: `new ImageData(pixels.data, pixels.width, pixels.height)`.
 */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** `hero_run` and 2 give `hero_run_2`. */
export function frameName(sprite: string, index: number): string {
  return `${sprite}_${index}`;
}

/** Width of a frame in pixels: the length of its first row (0 for an empty frame). */
export function frameWidth(frame: Frame): number {
  return frame[0]?.length ?? 0;
}

/** Height of a frame in pixels: its number of rows. */
export function frameHeight(frame: Frame): number {
  return frame.length;
}

/**
 * Everything that is wrong with one frame, as readable sentences; an empty list means
 * the frame is good. Checks the row count, every row's length and every character.
 */
export function validateFrame(label: string, frame: Frame, width: number, height: number): string[] {
  const problems: string[] = [];
  if (frame.length !== height) {
    problems.push(`${label}: has ${frame.length} rows, expected ${height}`);
  }
  frame.forEach((row, y) => {
    if (row.length !== width) {
      problems.push(`${label} row ${y}: is ${row.length} characters long, expected ${width}`);
    }
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (!isGridChar(ch)) {
        problems.push(`${label} row ${y}, column ${x}: '${ch}' is not a palette code or '.'`);
      }
    }
  });
  return problems;
}

/**
 * Everything that is wrong with a sprite, as readable sentences; an empty list means
 * it matches its shape: the frame count, and for every frame the size and the characters.
 */
export function validateSprite(name: string, sprite: Sprite, shape: SpriteShape): string[] {
  const problems: string[] = [];
  if (sprite.length !== shape.frames) {
    problems.push(`${name}: has ${sprite.length} frames, expected ${shape.frames}`);
  }
  sprite.forEach((frame, index) => {
    problems.push(...validateFrame(frameName(name, index), frame, shape.width, shape.height));
  });
  return problems;
}

/** Throws with every problem listed when the sprite does not match its shape. */
export function assertSprite(name: string, sprite: Sprite, shape: SpriteShape): void {
  const problems = validateSprite(name, sprite, shape);
  if (problems.length > 0) throw new Error(`bad sprite grid:\n  ${problems.join('\n  ')}`);
}

/**
 * Writes a frame into an RGBA buffer `stride` pixels wide, with the frame's top-left
 * corner at (left, top). Transparent pixels are skipped, so frames can be laid over
 * each other. Throws on a character that is not a palette code or '.'.
 */
export function paintFrame(
  target: Uint8ClampedArray,
  stride: number,
  frame: Frame,
  left: number,
  top: number,
): void {
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch === TRANSPARENT) continue;
      const [r, g, b, a] = codeToRgba(ch);
      const i = ((top + y) * stride + left + x) * 4;
      target[i] = r;
      target[i + 1] = g;
      target[i + 2] = b;
      target[i + 3] = a;
    }
  });
}

/** A frame as RGBA pixels. '.' becomes a fully transparent pixel. */
export function decodeFrame(frame: Frame): Pixels {
  const width = frameWidth(frame);
  const height = frameHeight(frame);
  const data = new Uint8ClampedArray(width * height * 4);
  paintFrame(data, width, frame, 0, 0);
  return { width, height, data };
}

/** The frame flipped left to right: how a sprite looks when it faces left. */
export function mirrorFrame(frame: Frame): Frame {
  return frame.map((row) => row.split('').reverse().join(''));
}

/** Every frame of a sprite flipped left to right. */
export function mirrorSprite(sprite: Sprite): Sprite {
  return sprite.map(mirrorFrame);
}

/**
 * One frame laid over another of the same or larger size, with the top frame's
 * top-left corner at (left, top) of the base. Transparent pixels of the top frame
 * let the base show; pixels that fall outside the base are dropped.
 */
export function overlayFrame(base: Frame, top: Frame, left = 0, topRow = 0): Frame {
  return base.map((row, y) => {
    const over = top[y - topRow];
    if (over === undefined) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) {
      const ch = x - left >= 0 ? over.charAt(x - left) : '';
      out += ch === '' || ch === TRANSPARENT ? row.charAt(x) : ch;
    }
    return out;
  });
}

/** The smallest box holding every opaque pixel, or null for an empty frame. */
export function opaqueBounds(frame: Frame): { left: number; top: number; right: number; bottom: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row.charAt(x) === TRANSPARENT) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  });
  return right < 0 ? null : { left, top, right, bottom };
}

/** How many pixels of a frame hold each character ('.' included). */
export function countChars(frame: Frame): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of frame) {
    for (const ch of row) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}
