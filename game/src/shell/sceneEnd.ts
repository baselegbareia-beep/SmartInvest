/**
 * Runs a scene's cleanup once, when the scene shuts down OR is destroyed, and removes the other listener.
 *
 * Why: Phaser emits a scene's 'shutdown' on every stop or restart, but its 'destroy' only on game.destroy().
 * A `once('destroy', cleanup)` next to `once('shutdown', cleanup)` was therefore never removed: one more
 * listener, holding its closure (a whole menu, its objects and its callbacks), stayed on the scene's
 * `sys.events` after every visit (docs/PHASER4-NOTES.md section 9). Whichever of the two fires first now
 * takes the other off, so the listener counts are the same after the hundredth visit as after the first.
 *
 * Only an emitter's `once` and `off` are used, so this is unit-tested in Node.
 */

/** Phaser.Scenes.Events.SHUTDOWN and DESTROY, spelled out so that Phaser itself is not needed at run time. */
export const SCENE_SHUTDOWN = 'shutdown';
export const SCENE_DESTROY = 'destroy';

/** The part of a scene's event emitter (`scene.events`) this needs. */
export interface SceneEvents {
  once(event: string, fn: () => void): unknown;
  off(event: string, fn: () => void): unknown;
}

/**
 * Calls `cleanup(how)` once, on the scene's next 'shutdown' or 'destroy', whichever comes first, and
 * unregisters the other. `how` lets the caller do what is only allowed on a shutdown (scene operations
 * throw inside 'destroy'). Returns a function that unregisters both without calling `cleanup`.
 */
export function onSceneEnd(events: SceneEvents, cleanup: (how: 'shutdown' | 'destroy') => void): () => void {
  const off = (): void => {
    events.off(SCENE_SHUTDOWN, onShutdown);
    events.off(SCENE_DESTROY, onDestroy);
  };
  function onShutdown(): void {
    off();
    cleanup('shutdown');
  }
  function onDestroy(): void {
    off();
    cleanup('destroy');
  }
  events.once(SCENE_SHUTDOWN, onShutdown);
  events.once(SCENE_DESTROY, onDestroy);
  return off;
}
