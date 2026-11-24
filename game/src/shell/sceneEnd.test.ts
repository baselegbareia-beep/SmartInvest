import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { SCENE_DESTROY, SCENE_SHUTDOWN, onSceneEnd } from './sceneEnd';

/** Every listener on the emitter: the number that grew by one per scene visit before onSceneEnd. */
const total = (em: EventEmitter): number => em.eventNames().reduce((n, e) => n + em.listenerCount(e), 0);

describe('onSceneEnd', () => {
  it('a shutdown runs the cleanup once and leaves no listener behind, the destroy one included', () => {
    const events = new EventEmitter();
    const seen: string[] = [];
    onSceneEnd(events, (how) => seen.push(how));
    expect(total(events)).toBe(2);
    events.emit(SCENE_SHUTDOWN);
    events.emit(SCENE_DESTROY);
    events.emit(SCENE_SHUTDOWN);
    expect(seen).toEqual(['shutdown']);
    expect(total(events)).toBe(0);
  });

  it('a destroy (game.destroy skips the shutdown) runs it once and takes the shutdown listener off', () => {
    const events = new EventEmitter();
    const seen: string[] = [];
    onSceneEnd(events, (how) => seen.push(how));
    events.emit(SCENE_DESTROY);
    events.emit(SCENE_SHUTDOWN);
    expect(seen).toEqual(['destroy']);
    expect(total(events)).toBe(0);
  });

  it('a hundred visits of a scene that registers on every create keep the count of the first', () => {
    const events = new EventEmitter();
    let cleanups = 0;
    const counts: number[] = [];
    for (let visit = 0; visit < 100; visit++) {
      onSceneEnd(events, () => {
        cleanups += 1;
      });
      counts.push(total(events));
      events.emit(SCENE_SHUTDOWN); // Phaser's scene.stop / scene.start of another scene
    }
    expect(cleanups).toBe(100);
    expect(new Set(counts)).toEqual(new Set([2]));
    expect(total(events)).toBe(0);
  });

  it('the returned function unregisters both without cleaning up', () => {
    const events = new EventEmitter();
    let called = false;
    const off = onSceneEnd(events, () => {
      called = true;
    });
    off();
    events.emit(SCENE_SHUTDOWN);
    events.emit(SCENE_DESTROY);
    expect(called).toBe(false);
    expect(total(events)).toBe(0);
  });

  it('matches the names of Phaser 4.2.1 scene events', async () => {
    // Phaser is not loaded by the unit tests (it needs a browser): read the constants from its source files.
    const { readFileSync } = await import('node:fs');
    const read = (name: string): string => readFileSync(new URL(`../../node_modules/phaser/src/scene/events/${name}_EVENT.js`, import.meta.url), 'utf8');
    expect(read('SHUTDOWN')).toContain(`module.exports = '${SCENE_SHUTDOWN}';`);
    expect(read('DESTROY')).toContain(`module.exports = '${SCENE_DESTROY}';`);
  });
});
