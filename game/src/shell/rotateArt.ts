/**
 * The picture of the "Rotate your phone" message (docs/ART-AND-SOUND.md section 9, Rotate): a phone outline
 * that turns from upright to sideways, above the words. Two frames on the same 16 x 16 grid, so the message
 * does not move when the frame changes; main.ts draws them with `pixelCanvas` and src/shell/rotate.css
 * shows them in turn (the sideways one alone, still, under reduced motion).
 *
 * The phone follows the look of the touch buttons: a `light steel` rim round a `steel` case, an `indigo`
 * screen with an `earthlight` glint at its upper left (the cold light, rule 2), the outer corners cut by
 * one pixel (rule 5). It lives here, beside the message it belongs to, and not in src/art's sprite sheet:
 * it is drawn in the page, never by Phaser.
 *
 * Pure: no DOM.
 */
import type { Frame } from '../art/grid';

/** The phone held upright, 10 x 16, centred on the 16 x 16 grid. */
export const PHONE_UPRIGHT: Frame = [
  '....55555555....',
  '...5444444445...',
  '...5422222245...',
  '...5462222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5422222245...',
  '...5444444445...',
  '...5444664445...',
  '....55555555....',
];

/** A frame turned a quarter turn clockwise (a square frame stays square). */
export function quarterTurn(frame: Frame): Frame {
  const n = frame.length;
  return Array.from({ length: frame[0]?.length ?? 0 }, (_, r) =>
    Array.from({ length: n }, (_, c) => frame[n - 1 - c]?.charAt(r) ?? '.').join(''),
  );
}

/** The same phone turned on its side: the way to hold it. */
export const PHONE_SIDEWAYS: Frame = quarterTurn(PHONE_UPRIGHT);

/** The phone is drawn this many times larger than the words under it. */
export const PHONE_SCALE = 2;

/** Milliseconds each frame is shown: upright, then sideways (src/shell/rotate.css repeats the pair). */
export const PHONE_FRAME_MS = 800;
