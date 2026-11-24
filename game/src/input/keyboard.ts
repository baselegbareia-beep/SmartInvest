/**
 * Keyboard to `Controls` (docs/PHASER4-NOTES.md section 13, docs/SPEC.md "Controls").
 *
 * | Action | Keys                 |
 * |--------|----------------------|
 * | Move   | arrows, or A and D   |
 * | Jump   | Space, Up or W       |
 * | Fire   | X                    |
 * | Thrust | Z or Shift           |
 * | Pause  | Esc or P             |
 * | Sound  | M                    |
 *
 * Four things the notes found, all handled here:
 * - Polling `isDown` once per frame misses a key that is hit and released inside one frame, so
 *   every press is also latched from the Key's own 'down' event.
 * - Every action key goes through `addKey(name).on('down', ...)`: that fires once per physical
 *   press. `keyboard.on('keydown-ESC', ...)` fires again on every auto-repeat.
 * - Phaser's own "release every key when the window loses focus" stops working for all scenes as
 *   soon as any scene that used the keyboard shuts down. This module listens for blur itself.
 * - A Key that does not know its key is down (reset by `resetKeys` on a pause, a resume or a blur,
 *   or created by a scene that started while the key was held) takes the key's next auto-repeat
 *   (`repeat: true`, about every 33 ms) for a new press: it emits 'down' and reads `isDown`. A key
 *   held through the pause menu then opened the ready gate after RESUME without a fresh press, and a
 *   held Esc closed the menu it had just opened. Here a 'down' that comes from an auto-repeat never
 *   acts, and the key reads as up until it is let go (`event.repeat` is the browser's own flag).
 *
 * Only types are imported from Phaser, so the module can be unit-tested in Node.
 */
import type * as Phaser from 'phaser';

import { BUTTONS } from './Controls';
import type { Button, Controls } from './Controls';

/** Key names as in `Phaser.Input.Keyboard.KeyCodes`, per game button. */
export const GAME_KEYS: Readonly<Record<Button, readonly string[]>> = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  jump: ['SPACE', 'UP', 'W'],
  fire: ['X'],
  thrust: ['Z', 'SHIFT'],
};
export const PAUSE_KEYS: readonly string[] = ['ESC', 'P'];
export const MUTE_KEYS: readonly string[] = ['M'];

// Phaser's event names, spelled out so that Phaser itself is not needed at run time:
// Phaser.Input.Keyboard.Events.DOWN and Phaser.Scenes.Events.UPDATE, SHUTDOWN and DESTROY.
const KEY_DOWN = 'down';
const KEY_UP = 'up';
const SCENE_UPDATE = 'update';
const SCENE_SHUTDOWN = 'shutdown';
const SCENE_DESTROY = 'destroy';

export interface KeyboardOptions {
  /** Esc or P was pressed. Called on every press: the scene decides from its own state whether to act. */
  onPause?: () => void;
  /** M was pressed. */
  onMute?: () => void;
  /**
   * While this returns false the five game buttons are neither read nor latched (intro card,
   * paused, ended). Default: always read.
   */
  isActive?: () => boolean;
}

/** True for a keydown the browser sent because the key is being held (auto-repeat), not pressed. */
export function isAutoRepeat(event: unknown): boolean {
  return typeof event === 'object' && event !== null && (event as { repeat?: unknown }).repeat === true;
}

/**
 * Calls `handler` once per physical press of any of the named keys: an auto-repeat never counts,
 * also not the first one after the Key was reset while the key was held. Use it for every menu key
 * as well. The keys are captured: they no longer scroll or click the page. `handler` gets the Key
 * and the KeyboardEvent, as Phaser hands them over. Returns a function that removes the handler;
 * call it when the scene shuts down.
 */
export function onKeyDown(
  scene: Phaser.Scene,
  names: readonly string[],
  handler: (key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => void,
): () => void {
  const kb = scene.input.keyboard;
  if (!kb) return () => undefined;
  const keys = names.map((name) => kb.addKey(name));
  const onDown = (key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (!isAutoRepeat(event)) handler(key, event);
  };
  for (const key of keys) key.on(KEY_DOWN, onDown);
  return () => {
    for (const key of keys) key.off(KEY_DOWN, onDown);
  };
}

/**
 * Lets go of every key, in Phaser and in `Controls`. Call it from the scene's pause path. A key
 * that is still physically down reads as up until it is let go and pressed again: its auto-repeats
 * do not count (installKeyboard).
 */
export function releaseKeys(scene: Phaser.Scene, controls: Controls): void {
  scene.input.keyboard?.resetKeys();
  controls.releaseAll('keys');
}

/**
 * Wires the keyboard of `scene` to `controls`. Call it once in the scene's `create()`.
 *
 * From then on, before every `update()` of the scene, the held state of the five game buttons is
 * written to `controls` (source 'keys'), and every press is latched, so `controls.consume()` in
 * `update()` sees it. Nothing has to be polled by the scene.
 *
 * Returns a function that undoes everything. It also runs by itself when the scene shuts down or
 * is destroyed, and calling it twice is harmless.
 */
export function installKeyboard(scene: Phaser.Scene, controls: Controls, options: KeyboardOptions = {}): () => void {
  const kb = scene.input.keyboard;
  if (!kb) return () => undefined; // keyboard input is switched off in the game config

  const isActive = options.isActive ?? ((): boolean => true);
  const removers: (() => void)[] = [];

  const keys: Record<Button, Phaser.Input.Keyboard.Key[]> = { left: [], right: [], jump: [], fire: [], thrust: [] };
  // Keys whose 'down' came from an auto-repeat: down in Phaser, but not pressed since the Key last knew it was up.
  // They read as up until their keyup (see the header). One Set for the scene's life, no allocation per frame.
  const stale = new Set<Phaser.Input.Keyboard.Key>();
  const onAnyDown = (key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (isAutoRepeat(event)) stale.add(key);
    else stale.delete(key);
  };
  const onAnyUp = (key: Phaser.Input.Keyboard.Key): void => {
    stale.delete(key);
  };
  for (const b of BUTTONS) {
    keys[b] = GAME_KEYS[b].map((name) => kb.addKey(name));
    for (const key of keys[b]) {
      key.on(KEY_DOWN, onAnyDown);
      key.on(KEY_UP, onAnyUp);
    }
    removers.push(
      onKeyDown(scene, GAME_KEYS[b], () => {
        if (isActive()) controls.latch(b);
      }),
    );
  }
  removers.push(() => {
    for (const b of BUTTONS) {
      for (const key of keys[b]) {
        key.off(KEY_DOWN, onAnyDown);
        key.off(KEY_UP, onAnyUp);
      }
    }
    stale.clear();
  });
  if (options.onPause) removers.push(onKeyDown(scene, PAUSE_KEYS, options.onPause));
  if (options.onMute) removers.push(onKeyDown(scene, MUTE_KEYS, options.onMute));

  // The scene's 'update' event is emitted just before its update() method.
  const poll = (): void => {
    if (!isActive()) return;
    for (const b of BUTTONS) {
      controls.set(
        'keys',
        b,
        keys[b].some((key) => key.isDown && !stale.has(key)),
      );
    }
  };
  scene.events.on(SCENE_UPDATE, poll);

  // addEventListener only: Phaser assigns window.onblur, and overwriting that would blind it.
  const release = (): void => {
    kb.resetKeys();
    controls.releaseAll('keys');
  };
  const onVisibility = (): void => {
    if (document.hidden) release();
  };
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', onVisibility);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers) remove();
    scene.events.off(SCENE_UPDATE, poll);
    scene.events.off(SCENE_SHUTDOWN, dispose);
    scene.events.off(SCENE_DESTROY, dispose);
    window.removeEventListener('blur', release);
    document.removeEventListener('visibilitychange', onVisibility);
    controls.releaseAll('keys');
  };
  scene.events.once(SCENE_SHUTDOWN, dispose);
  scene.events.once(SCENE_DESTROY, dispose);
  return dispose;
}
