import type * as Phaser from 'phaser';
import { describe, expect, it } from 'vitest';

import { onFreshKey } from './freshKey';

/** The part of a Phaser Key that onKeyDown uses: 'down' listeners, called with (key, event). */
class FakeKey {
  private readonly listeners = new Set<(key: unknown, event: unknown) => void>();
  on(_type: 'down', fn: (key: unknown, event: unknown) => void): void {
    this.listeners.add(fn);
  }
  off(_type: 'down', fn: (key: unknown, event: unknown) => void): void {
    this.listeners.delete(fn);
  }
  /** Phaser emits 'down' with the KeyboardEvent; its queue replay hands over the same object again. */
  down(event: object | undefined): void {
    for (const fn of [...this.listeners]) fn(this, event);
  }
}

function fakeScene(): { scene: Phaser.Scene; key: (name: string) => FakeKey } {
  const keys = new Map<string, FakeKey>();
  const key = (name: string): FakeKey => {
    let k = keys.get(name);
    if (!k) {
      k = new FakeKey();
      keys.set(name, k);
    }
    return k;
  };
  const scene = { input: { keyboard: { addKey: key } } } as unknown as Phaser.Scene;
  return { scene, key };
}

describe('onFreshKey', () => {
  it('acts once per keyboard event, also when Phaser hands the same event over again', () => {
    const { scene, key } = fakeScene();
    let calls = 0;
    onFreshKey(scene, ['M'], () => {
      calls += 1;
    });
    const press = { code: 'KeyM' };
    key('M').down(press);
    key('M').down(press); // the queue replay when another key arrives in the same frame
    expect(calls).toBe(1);
    key('M').down({ code: 'KeyM' }); // a new press is a new event
    expect(calls).toBe(2);
  });

  it('listens to every named key, and to none once removed', () => {
    const { scene, key } = fakeScene();
    const seen: string[] = [];
    const remove = onFreshKey(scene, ['ESC', 'P'], () => {
      seen.push('pause');
    });
    key('ESC').down({});
    key('P').down({});
    remove();
    key('ESC').down({});
    expect(seen).toEqual(['pause', 'pause']);
  });

  it('still acts when no event object comes with the call', () => {
    const { scene, key } = fakeScene();
    let calls = 0;
    onFreshKey(scene, ['SPACE'], () => {
      calls += 1;
    });
    key('SPACE').down(undefined);
    key('SPACE').down(undefined);
    expect(calls).toBe(2);
  });

  it('does nothing in a scene without a keyboard', () => {
    const scene = { input: { keyboard: null } } as unknown as Phaser.Scene;
    expect(() => {
      onFreshKey(scene, ['M'], () => undefined)();
    }).not.toThrow();
  });
});
