/**
 * Saved data that never throws (docs/ARCHITECTURE.md section 10, docs/PHASER4-NOTES.md section 18).
 *
 * This module is the only place in the game that touches `localStorage`. Browsers refuse storage in
 * several ordinary situations, and each of them throws from a different place:
 * - in a sandboxed frame (`<iframe sandbox="allow-scripts">`, some game portals) merely READING
 *   `window.localStorage` throws a SecurityError;
 * - with site data blocked, `window.localStorage` can be null;
 * - a full or private-mode store throws QuotaExceededError from `setItem`;
 * - another script may have left text that is not JSON under our key.
 * None of that may stop the game. Every value saved is also kept in memory, so within one visit the
 * game behaves the same whether or not the browser kept it; only the next visit forgets.
 *
 * Two keys, both starting with `GAME_ID` from src/meta.ts (several games may share one web origin):
 * `PROGRESS_KEY` holds `SaveData`, `SETTINGS_KEY` holds `SettingsData`. The shell's use:
 *
 *   const save = loadProgress(CAMPAIGN.length);            // boot
 *   const next = applyEvents(save, events);                 // after every tick's events
 *   if (next !== save) saveProgress(next);
 *   const settings = loadSettings();  saveSettings({ ...settings, sound: false });
 *
 * `loadJson` / `saveJson` are the general form; `createSafeStorage` builds the same pair over another
 * store (tests pass fakes). `loadStoredJson` reads what the store holds now, for another copy of the game on the
 * same origin: singletons.ts merges each progress save with it (`mergeSave`) and listens for the 'storage' event.
 */
import { parseSave } from '../core/save';
import type { SaveData, SettingsData } from '../core/types';
import { GAME_ID } from '../meta';

/** Where the progress is kept: `moon-foundry:progress`. */
export const PROGRESS_KEY = `${GAME_ID}:progress`;
/** Where the settings are kept: `moon-foundry:settings`. */
export const SETTINGS_KEY = `${GAME_ID}:settings`;

/** The two calls of the Web Storage API this module uses. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Returns the store to use now, or null when there is none. It may throw; that counts as none. */
export type StoreSource = () => KeyValueStore | null | undefined;

export interface SafeStorage {
  /**
   * The value saved under `key`, parsed from JSON, or `undefined` when there is none or it cannot be
   * read or parsed. Never throws. The result is untrusted: pass it through a parser such as `parseSave`.
   */
  readonly loadJson: (key: string) => unknown;
  /**
   * Saves `value` as JSON. Returns true when the browser kept it, false when it could not (the value
   * is then still kept in memory for this visit, unless it cannot be written as JSON at all). Never throws.
   */
  readonly saveJson: (key: string, value: unknown) => boolean;
  /**
   * The value the STORE holds under `key` now, parsed, skipping this visit's memory copy: what another copy of the
   * game on the same origin (a second tab, the installed app) may have saved since. `undefined` when there is no
   * store, nothing under the key, or it cannot be parsed. Never throws.
   */
  readonly loadStoredJson: (key: string) => unknown;
}

/** A safe load / save pair over the store `source` returns, with its own memory copy. */
export function createSafeStorage(source: StoreSource): SafeStorage {
  /** Every value saved during this visit, as JSON text. The newest value wins over the store's copy. */
  const memory = new Map<string, string>();

  const store = (): KeyValueStore | null => {
    try {
      return source() ?? null;
    } catch {
      return null;
    }
  };

  const readStored = (key: string): string | null => {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const parse = (raw: string | null): unknown => {
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  };

  return {
    loadJson(key: string): unknown {
      // Memory first: after a failed write the store may still hold an older value.
      return parse(memory.get(key) ?? readStored(key));
    },

    loadStoredJson(key: string): unknown {
      return parse(readStored(key));
    },

    saveJson(key: string, value: unknown): boolean {
      // Typed as string, but undefined (and a function) give undefined; a BigInt or a cycle throws.
      let raw: unknown;
      try {
        raw = JSON.stringify(value);
      } catch {
        return false;
      }
      if (typeof raw !== 'string') return false;
      memory.set(key, raw);
      try {
        const s = store();
        if (s === null) return false;
        s.setItem(key, raw);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The page's own localStorage. Reading the property itself throws in a sandboxed frame; outside a browser `window` is missing. */
const pageStorage: StoreSource = () => (window as { localStorage?: Storage | null }).localStorage;

const page = createSafeStorage(pageStorage);

/** `SafeStorage.loadJson` over the page's localStorage. */
export function loadJson(key: string): unknown {
  return page.loadJson(key);
}

/** `SafeStorage.saveJson` over the page's localStorage. */
export function saveJson(key: string, value: unknown): boolean {
  return page.saveJson(key, value);
}

/** `SafeStorage.loadStoredJson` over the page's localStorage: what is stored now, whoever wrote it. */
export function loadStoredJson(key: string): unknown {
  return page.loadStoredJson(key);
}

/**
 * Two copies of the game on one origin (two tabs, or the installed app beside a browser tab) share one store, and
 * each keeps its own copy of the progress. Written as it was, the copy of a tab opened before another one's progress
 * put the old unlocked level and best score back on its next save. So a save is merged with what is stored: what
 * only grows stays at the larger (the highest level unlocked, the best score, the campaign finished), and the run in
 * progress is the writer's own (`next.resume`: one tab's run is not another's). Pure.
 */
export function mergeSave(stored: SaveData, next: SaveData): SaveData {
  const unlocked = Math.max(stored.unlocked, next.unlocked);
  const bestScore = Math.max(stored.bestScore, next.bestScore);
  const finished = stored.finished || next.finished;
  if (unlocked === next.unlocked && bestScore === next.bestScore && finished === next.finished) return next;
  return { v: 1, unlocked, bestScore, finished, resume: next.resume };
}

/** Settings of a first visit: sound on, vibration on. */
export function defaultSettings(): SettingsData {
  return { v: 1, sound: true, vibration: true };
}

/** Whatever was stored to valid settings. Never throws: a missing or mistyped field takes its default. */
export function parseSettings(json: unknown): SettingsData {
  const d = defaultSettings();
  if (typeof json !== 'object' || json === null) return d;
  const o = json as { sound?: unknown; vibration?: unknown };
  return {
    v: 1,
    sound: typeof o.sound === 'boolean' ? o.sound : d.sound,
    vibration: typeof o.vibration === 'boolean' ? o.vibration : d.vibration,
  };
}

/** The saved progress (or a fresh one), clamped to a campaign of `levelCount` levels. */
export function loadProgress(levelCount: number): SaveData {
  return parseSave(loadJson(PROGRESS_KEY), levelCount);
}

/** Saves the progress. False when the browser did not keep it (it is kept for this visit). */
export function saveProgress(save: SaveData): boolean {
  return saveJson(PROGRESS_KEY, save);
}

/** The saved settings, or the defaults. */
export function loadSettings(): SettingsData {
  return parseSettings(loadJson(SETTINGS_KEY));
}

/** Saves the settings. False when the browser did not keep them (they are kept for this visit). */
export function saveSettings(settings: SettingsData): boolean {
  return saveJson(SETTINGS_KEY, settings);
}
