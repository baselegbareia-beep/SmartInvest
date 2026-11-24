import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Phaser from 'phaser';

import { BUTTONS, Controls } from './Controls';
import type { Button } from './Controls';
import { GAME_KEYS, MUTE_KEYS, PAUSE_KEYS, installKeyboard, onKeyDown, releaseKeys } from './keyboard';

/**
 * keyboard.ts against a stand-in for Phaser's keyboard plugin: just enough of `scene.input.keyboard`,
 * `Key` and `scene.events` to drive it in Node. The same behaviour was run against the real
 * Phaser 4.2.1 in a browser (see the task report); this file keeps it from regressing.
 */

type Listener = () => void;

class Emitter {
  private readonly listeners = new Map<string, { fn: Listener; once: boolean }[]>();

  on(type: string, fn: Listener): this {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, once: false }]);
    return this;
  }

  once(type: string, fn: Listener): this {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, once: true }]);
    return this;
  }

  off(type: string, fn: Listener): this {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry.fn !== fn),
    );
    return this;
  }

  emit(type: string): void {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      if (entry.once) this.off(type, entry.fn);
      entry.fn();
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

/** Behaves like Phaser's Key: 'down' once per physical press, never on auto-repeat. */
class FakeKey extends Emitter {
  isDown = false;

  keydown(): void {
    if (this.isDown) return; // auto-repeat
    this.isDown = true;
    this.emit('down');
  }

  keyup(): void {
    this.isDown = false;
  }
}

class FakeKeyboard {
  readonly keys = new Map<string, FakeKey>();
  resets = 0;

  addKey(name: string): FakeKey {
    const existing = this.keys.get(name);
    if (existing) return existing;
    const key = new FakeKey();
    this.keys.set(name, key);
    return key;
  }

  resetKeys(): this {
    this.resets++;
    for (const key of this.keys.values()) key.isDown = false;
    return this;
  }

  key(name: string): FakeKey {
    const key = this.keys.get(name);
    if (!key) throw new Error(`no key ${name} was added`);
    return key;
  }

  /** Listeners on every key, to see that nothing is left behind. */
  downListeners(): number {
    return [...this.keys.values()].reduce((sum, key) => sum + key.count('down'), 0);
  }
}

interface Rig {
  scene: Phaser.Scene;
  keyboard: FakeKeyboard;
  events: Emitter;
  controls: Controls;
  /** One rendered frame: the scene's 'update' event, as Phaser emits it before update(). */
  frame: () => void;
}

function rig(keyboard: FakeKeyboard | null = new FakeKeyboard()): Rig {
  const events = new Emitter();
  const scene = { input: { keyboard }, events } as unknown as Phaser.Scene;
  return {
    scene,
    keyboard: keyboard ?? new FakeKeyboard(),
    events,
    controls: new Controls(),
    frame: () => {
      events.emit('update');
    },
  };
}

const NOTHING = { left: false, right: false, jump: false, fire: false, thrust: false };

let fakeWindow: EventTarget;
let fakeDocument: EventTarget & { hidden: boolean };

beforeEach(() => {
  fakeWindow = new EventTarget();
  fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the key map', () => {
  it('is the table of docs/SPEC.md', () => {
    expect(GAME_KEYS).toEqual({
      left: ['LEFT', 'A'],
      right: ['RIGHT', 'D'],
      jump: ['SPACE', 'UP', 'W'],
      fire: ['X'],
      thrust: ['Z', 'SHIFT'],
    });
    expect(PAUSE_KEYS).toEqual(['ESC', 'P']);
    expect(MUTE_KEYS).toEqual(['M']);
  });

  it('uses no key twice', () => {
    const all = [...BUTTONS.flatMap((b) => GAME_KEYS[b]), ...PAUSE_KEYS, ...MUTE_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('installKeyboard', () => {
  const cases: [Button, string][] = BUTTONS.flatMap((b) => GAME_KEYS[b].map((name): [Button, string] => [b, name]));

  it.each(cases)('%s: holding %s is reported every tick until it is released', (button, name) => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key(name).keydown();
    for (let i = 0; i < 3; i++) {
      r.frame();
      expect(r.controls.consume()).toEqual({ ...NOTHING, [button]: true });
    }
    r.keyboard.key(name).keyup();
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it.each(cases)('%s: %s hit and released inside one frame still gives one press', (button, name) => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key(name).keydown();
    r.keyboard.key(name).keyup();
    r.frame();
    expect(r.controls.consume()).toEqual({ ...NOTHING, [button]: true });
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('three instant taps with a frame between them give three presses', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    let presses = 0;
    for (let i = 0; i < 3; i++) {
      r.keyboard.key('SPACE').keydown();
      r.keyboard.key('SPACE').keyup();
      r.frame();
      if (r.controls.consume().jump) presses++;
      r.frame();
      if (r.controls.consume().jump) presses++;
    }
    expect(presses).toBe(3);
  });

  it('either key of a pair holds the button', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key('LEFT').keydown();
    r.keyboard.key('A').keydown();
    r.keyboard.key('LEFT').keyup();
    r.frame();
    expect(r.controls.consume().left).toBe(true);
    r.keyboard.key('A').keyup();
    r.frame();
    expect(r.controls.consume().left).toBe(false);
  });

  it('Left held, then Right added: right; Right released: left again; never both', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key('LEFT').keydown();
    r.frame();
    expect(r.controls.consume()).toEqual({ ...NOTHING, left: true });
    r.keyboard.key('RIGHT').keydown();
    r.frame();
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
    r.keyboard.key('RIGHT').keyup();
    r.frame();
    expect(r.controls.consume()).toEqual({ ...NOTHING, left: true });
  });

  it('auto-repeat is not a new press', () => {
    const r = rig();
    const onPause = vi.fn();
    installKeyboard(r.scene, r.controls, { onPause });
    for (let i = 0; i < 7; i++) r.keyboard.key('ESC').keydown();
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('Esc and P call onPause, M calls onMute, once per press, whatever isActive says', () => {
    const r = rig();
    const onPause = vi.fn();
    const onMute = vi.fn();
    installKeyboard(r.scene, r.controls, { onPause, onMute, isActive: () => false });
    r.keyboard.key('ESC').keydown();
    r.keyboard.key('ESC').keyup();
    r.keyboard.key('P').keydown();
    r.keyboard.key('M').keydown();
    expect(onPause).toHaveBeenCalledTimes(2);
    expect(onMute).toHaveBeenCalledTimes(1);
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('while isActive is false the game buttons are neither read nor latched', () => {
    const r = rig();
    let active = false;
    installKeyboard(r.scene, r.controls, { isActive: () => active });
    r.keyboard.key('RIGHT').keydown();
    r.keyboard.key('SPACE').keydown();
    r.keyboard.key('SPACE').keyup();
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
    active = true;
    r.frame();
    // The key that is still down is read now; the tap that happened meanwhile is gone.
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
  });

  it('a window blur lets go of every key, in Phaser and in Controls', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key('RIGHT').keydown();
    r.keyboard.key('Z').keydown();
    r.frame();
    expect(r.controls.held()).toEqual({ ...NOTHING, right: true, thrust: true });
    fakeWindow.dispatchEvent(new Event('blur'));
    expect(r.keyboard.resets).toBe(1);
    expect(r.controls.held()).toEqual(NOTHING);
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('a hidden page does the same; becoming visible does nothing', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key('LEFT').keydown();
    r.frame();
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(r.keyboard.resets).toBe(0);
    fakeDocument.hidden = true;
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(r.keyboard.resets).toBe(1);
    expect(r.controls.held()).toEqual(NOTHING);
  });

  it('a blur does not touch what the touch pad holds', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.controls.set('touch', 'jump', true);
    fakeWindow.dispatchEvent(new Event('blur'));
    expect(r.controls.held()).toEqual({ ...NOTHING, jump: true });
  });

  it('dispose removes every listener and lets go of the keys; twice is harmless', () => {
    const r = rig();
    const onPause = vi.fn();
    const dispose = installKeyboard(r.scene, r.controls, { onPause, onMute: vi.fn() });
    expect(r.keyboard.downListeners()).toBeGreaterThan(0);
    r.keyboard.key('RIGHT').keydown();
    r.frame();
    dispose();
    dispose();
    expect(r.keyboard.downListeners()).toBe(0);
    expect(r.events.count('update')).toBe(0);
    expect(r.events.count('shutdown')).toBe(0);
    expect(r.events.count('destroy')).toBe(0);
    expect(r.controls.held()).toEqual(NOTHING);
    // Nothing reacts any more.
    r.keyboard.key('ESC').keydown();
    r.keyboard.key('SPACE').keydown();
    r.frame();
    fakeWindow.dispatchEvent(new Event('blur'));
    expect(onPause).not.toHaveBeenCalled();
    expect(r.keyboard.resets).toBe(0);
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it.each(['shutdown', 'destroy'])('disposes by itself when the scene emits %s', (event) => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.events.emit(event);
    expect(r.keyboard.downListeners()).toBe(0);
    expect(r.events.count('update')).toBe(0);
    r.keyboard.key('SPACE').keydown();
    r.frame();
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('installing again after a dispose works (a scene that restarts)', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls)();
    installKeyboard(r.scene, r.controls);
    expect(r.events.count('update')).toBe(1);
    r.keyboard.key('X').keydown();
    r.frame();
    expect(r.controls.consume()).toEqual({ ...NOTHING, fire: true });
  });

  it('does nothing, and does not throw, when the keyboard is switched off', () => {
    const r = rig(null);
    const dispose = installKeyboard(r.scene, r.controls, { onPause: vi.fn() });
    r.frame();
    expect(r.events.count('update')).toBe(0);
    expect(() => {
      dispose();
    }).not.toThrow();
    expect(() => {
      releaseKeys(r.scene, r.controls);
    }).not.toThrow();
    expect(() => {
      onKeyDown(r.scene, ['ENTER'], vi.fn())();
    }).not.toThrow();
  });
});

describe('onKeyDown and releaseKeys', () => {
  it('onKeyDown calls the handler once per press of any named key until it is removed', () => {
    const r = rig();
    const handler = vi.fn();
    const remove = onKeyDown(r.scene, ['ENTER', 'SPACE'], handler);
    r.keyboard.key('ENTER').keydown();
    r.keyboard.key('ENTER').keydown();
    r.keyboard.key('SPACE').keydown();
    expect(handler).toHaveBeenCalledTimes(2);
    remove();
    r.keyboard.key('ENTER').keyup();
    r.keyboard.key('ENTER').keydown();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('releaseKeys resets Phaser\'s keys and the key half of Controls', () => {
    const r = rig();
    installKeyboard(r.scene, r.controls);
    r.keyboard.key('LEFT').keydown();
    r.controls.set('touch', 'jump', true);
    r.frame();
    releaseKeys(r.scene, r.controls);
    expect(r.keyboard.resets).toBe(1);
    expect(r.controls.held()).toEqual({ ...NOTHING, jump: true });
  });
});
