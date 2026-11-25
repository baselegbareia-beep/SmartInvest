import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultSave } from '../core/save';
import type { SaveData } from '../core/types';
import { GAME_ID } from '../meta';

import {
  PROGRESS_KEY,
  SETTINGS_KEY,
  createSafeStorage,
  defaultSettings,
  loadJson,
  loadProgress,
  loadSettings,
  mergeSave,
  parseSettings,
  saveJson,
  saveProgress,
  saveSettings,
} from './storage';
import type { KeyValueStore } from './storage';

/** An in-memory Web Storage stand-in that can be told to fail. */
class FakeStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failRead = false;
  failWrite = false;
  writes = 0;

  getItem(key: string): string | null {
    if (this.failRead) throw new DOMException('The operation is insecure.', 'SecurityError');
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrite) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.writes++;
    this.data.set(key, value);
  }
}

const deniedAccess = (): never => {
  throw new DOMException("Failed to read the 'localStorage' property from 'Window': access is denied", 'SecurityError');
};

describe('storage keys', () => {
  it('are the two keys of docs/ARCHITECTURE.md section 10, built from GAME_ID', () => {
    expect(PROGRESS_KEY).toBe(`${GAME_ID}:progress`);
    expect(SETTINGS_KEY).toBe(`${GAME_ID}:settings`);
    expect([PROGRESS_KEY, SETTINGS_KEY]).toEqual(['moon-foundry:progress', 'moon-foundry:settings']);
  });
});

describe('createSafeStorage on a working store', () => {
  it('saves JSON and reads it back, also from a later visit', () => {
    const store = new FakeStore();
    const first = createSafeStorage(() => store);
    expect(first.saveJson('k', { a: 1, b: [true, null] })).toBe(true);
    expect(store.data.get('k')).toBe('{"a":1,"b":[true,null]}');
    expect(first.loadJson('k')).toEqual({ a: 1, b: [true, null] });
    // A new visit has an empty memory and reads the store.
    expect(createSafeStorage(() => store).loadJson('k')).toEqual({ a: 1, b: [true, null] });
  });

  it('gives undefined for a key never saved and for text that is not JSON', () => {
    const store = new FakeStore();
    store.data.set('bad', '{oops');
    const s = createSafeStorage(() => store);
    expect(s.loadJson('missing')).toBeUndefined();
    expect(s.loadJson('bad')).toBeUndefined();
  });
});

describe('createSafeStorage never throws', () => {
  it('when reading the storage property itself throws (a sandboxed frame): saves are kept in memory for this visit', () => {
    const s = createSafeStorage(deniedAccess);
    expect(s.loadJson('k')).toBeUndefined();
    expect(s.saveJson('k', { best: 9 })).toBe(false);
    expect(s.loadJson('k')).toEqual({ best: 9 });
  });

  it('when there is no store at all (null or undefined)', () => {
    for (const s of [createSafeStorage(() => null), createSafeStorage(() => undefined)]) {
      expect(s.loadJson('k')).toBeUndefined();
      expect(s.saveJson('k', 3)).toBe(false);
      expect(s.loadJson('k')).toBe(3);
    }
  });

  it('when getItem throws: nothing is read, a save still reaches the store and memory', () => {
    const store = new FakeStore();
    store.data.set('k', '1');
    store.failRead = true;
    const s = createSafeStorage(() => store);
    expect(s.loadJson('k')).toBeUndefined();
    expect(s.saveJson('k', 2)).toBe(true);
    expect(s.loadJson('k')).toBe(2);
    expect(store.data.get('k')).toBe('2');
  });

  it('when setItem throws (store full): false, and the NEW value is what is read back, not the older stored one', () => {
    const store = new FakeStore();
    const s = createSafeStorage(() => store);
    expect(s.saveJson('k', { lives: 3 })).toBe(true);
    store.failWrite = true;
    expect(s.saveJson('k', { lives: 2 })).toBe(false);
    expect(store.data.get('k')).toBe('{"lives":3}');
    expect(s.loadJson('k')).toEqual({ lives: 2 });
  });

  it('when the value cannot be written as JSON: false, nothing changes', () => {
    const store = new FakeStore();
    const s = createSafeStorage(() => store);
    s.saveJson('k', 'kept');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const bad of [cycle, 10n, undefined, () => 1]) {
      expect(s.saveJson('k', bad)).toBe(false);
    }
    expect(s.loadJson('k')).toBe('kept');
    expect(store.writes).toBe(1);
  });

  it('when the store comes and goes between calls', () => {
    const store = new FakeStore();
    let allowed = true;
    const s = createSafeStorage(() => (allowed ? store : deniedAccess()));
    expect(s.saveJson('k', 1)).toBe(true);
    allowed = false;
    expect(s.saveJson('k', 2)).toBe(false);
    expect(s.loadJson('k')).toBe(2);
    allowed = true;
    expect(s.saveJson('k', 3)).toBe(true);
    expect(store.data.get('k')).toBe('3');
  });
});

describe('the page-storage functions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('work outside a browser, where `window` does not exist', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(loadJson('node:missing')).toBeUndefined();
    expect(saveJson('node:k', [1, 2])).toBe(false);
    expect(loadJson('node:k')).toEqual([1, 2]);
  });

  it('use window.localStorage when it works', () => {
    const store = new FakeStore();
    vi.stubGlobal('window', { localStorage: store });
    expect(saveJson('page:k', { x: 1 })).toBe(true);
    expect(store.data.get('page:k')).toBe('{"x":1}');
    store.data.set('page:other', '"from an earlier visit"');
    expect(loadJson('page:other')).toBe('from an earlier visit');
  });

  it('do not throw when reading window.localStorage throws, as in a sandboxed frame', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        return deniedAccess();
      },
    });
    expect(() => loadJson('sandbox:k')).not.toThrow();
    expect(saveJson('sandbox:k', true)).toBe(false);
    expect(loadJson('sandbox:k')).toBe(true);
  });

  it('do not throw when window.localStorage is null', () => {
    vi.stubGlobal('window', { localStorage: null });
    expect(saveJson('null:k', 5)).toBe(false);
    expect(loadJson('null:k')).toBe(5);
  });
});

describe('progress and settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('progress: a first visit gets a fresh save; a saved one comes back; a corrupt one falls back', () => {
    const store = new FakeStore();
    vi.stubGlobal('window', { localStorage: store });
    store.data.delete(PROGRESS_KEY);
    expect(loadProgress(10)).toEqual(defaultSave());
    const save: SaveData = { v: 1, unlocked: 4, bestScore: 7900, finished: false, resume: { levelIndex: 4, score: 3100, lives: 2 } };
    expect(saveProgress(save)).toBe(true);
    expect(JSON.parse(store.data.get(PROGRESS_KEY) ?? 'null')).toEqual(save);
    expect(loadProgress(10)).toEqual(save);
  });

  it('progress is checked by parseSave on the way in: levels beyond the campaign are clamped, junk falls back', () => {
    vi.stubGlobal('window', { localStorage: new FakeStore() });
    saveJson(PROGRESS_KEY, { v: 1, unlocked: 99, bestScore: 5, finished: false, resume: { levelIndex: 42, score: 0, lives: 3 } });
    const clamped = loadProgress(10);
    expect(clamped.unlocked).toBeLessThan(10);
    expect(clamped.resume?.levelIndex ?? 0).toBeLessThan(10);
    expect(clamped.bestScore).toBe(5);
    saveJson(PROGRESS_KEY, 'junk');
    expect(loadProgress(10)).toEqual(defaultSave());
  });

  it('settings: both on by default; a stored choice comes back; wrong types take the default', () => {
    expect(defaultSettings()).toEqual({ v: 1, sound: true, vibration: true });
    expect(parseSettings(undefined)).toEqual(defaultSettings());
    expect(parseSettings('nonsense')).toEqual(defaultSettings());
    expect(parseSettings([false])).toEqual(defaultSettings());
    expect(parseSettings({ v: 1, sound: false, vibration: false })).toEqual({ v: 1, sound: false, vibration: false });
    expect(parseSettings({ sound: 'no', vibration: false })).toEqual({ v: 1, sound: true, vibration: false });
    expect(parseSettings({ v: 7, sound: false })).toEqual({ v: 1, sound: false, vibration: true });

    const store = new FakeStore();
    vi.stubGlobal('window', { localStorage: store });
    expect(saveSettings({ v: 1, sound: false, vibration: true })).toBe(true);
    expect(loadSettings()).toEqual({ v: 1, sound: false, vibration: true });
  });
});

describe('two copies of the game on one origin', () => {
  const run = (levelIndex: number, score: number, lives = 3) => ({ levelIndex, score, lives });
  const save = (fields: Partial<SaveData>): SaveData => ({ ...defaultSave(), ...fields });

  it('mergeSave keeps the larger unlocked level and best score, the campaign finished, and the writer\'s own run', () => {
    // Tab A cleared level 1 and saved; tab B, opened before that, starts a NEW GAME from its old copy.
    const stored = save({ unlocked: 1, bestScore: 410, resume: run(1, 410) });
    const next = save({ unlocked: 0, bestScore: 0, resume: run(0, 0) });
    expect(mergeSave(stored, next)).toEqual(save({ unlocked: 1, bestScore: 410, resume: run(0, 0) }));
    expect(mergeSave(save({ finished: true }), save({ resume: run(2, 50) }))).toEqual(save({ finished: true, resume: run(2, 50) }));
    // A game over in this tab clears this tab's run, whatever the store held.
    expect(mergeSave(save({ resume: run(5, 900) }), save({ unlocked: 5, bestScore: 900 }))).toEqual(save({ unlocked: 5, bestScore: 900 }));
  });

  it('mergeSave gives back the very save it was given when the store adds nothing (one tab: nothing changes)', () => {
    const next = save({ unlocked: 3, bestScore: 1200, resume: run(3, 1000) });
    expect(mergeSave(save({ unlocked: 2, bestScore: 500 }), next)).toBe(next);
    expect(mergeSave(defaultSave(), next)).toBe(next);
  });

  it('loadStoredJson reads what the store holds now, not this visit\'s memory copy', () => {
    const store = new FakeStore();
    const safe = createSafeStorage(() => store);
    safe.saveJson('k', { n: 1 });
    store.data.set('k', JSON.stringify({ n: 2 })); // another tab wrote meanwhile
    expect(safe.loadJson('k')).toEqual({ n: 1 }); // the memory copy wins for this visit's own reads...
    expect(safe.loadStoredJson('k')).toEqual({ n: 2 }); // ...the store says what the other tab saved
    store.data.set('k', 'not json');
    expect(safe.loadStoredJson('k')).toBeUndefined();
    store.failRead = true;
    expect(safe.loadStoredJson('k')).toBeUndefined();
    expect(createSafeStorage(() => null).loadStoredJson('k')).toBeUndefined();
  });
});
