/**
 * `onKeyDown` of src/input/keyboard.ts, acting once per keyboard EVENT. Used for every key that does
 * something by itself rather than through `Controls`: menu keys, M (sound), Esc and P (pause), the
 * title's start keys.
 *
 * Why: Phaser 4.2.1 runs a scene's keyboard plugin over the whole frame's queue of key events on EVERY
 * key event, and clears the queue only after the frame; its duplicate check compares with the previous
 * event only. So when a key is tapped and another arrives within one frame (down, up, Enter), the first
 * key's 'down' fires again: a menu focus jumped two rows, M toggled the sound twice (no change), and an
 * Esc that had just closed the pause menu could open it again from the Play scene's own handler. The
 * replay hands over the same KeyboardEvent object, which is how it is recognised here.
 *
 * Only types are imported from Phaser, so this is unit-tested in Node with a fake keyboard.
 */
import type * as Phaser from 'phaser';

import { onKeyDown } from '../input/keyboard';

/**
 * Calls `handler` once per keyboard event that presses any of the named keys (`Phaser.Input.Keyboard.KeyCodes`
 * names). Auto-repeat does not count, not even the first repeat after a reset (onKeyDown). Returns a function
 * that removes the handler.
 */
export function onFreshKey(scene: Phaser.Scene, names: readonly string[], handler: () => void): () => void {
  const seen = new WeakSet();
  return onKeyDown(scene, names, (_key: unknown, event: unknown) => {
    if (typeof event === 'object' && event !== null) {
      if (seen.has(event)) return;
      seen.add(event);
    }
    handler();
  });
}
