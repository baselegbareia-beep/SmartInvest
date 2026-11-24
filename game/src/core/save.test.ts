import { describe, expect, it } from 'vitest';

import { createSession, step } from './game';
import { applyEvents, defaultSave, parseSave } from './save';
import { IN, NONE, REFERENCE_PHYS, levelFromRows } from './testkit';
import type { GameEvent, SaveData } from './types';

/**
 * The save reducers of docs/ARCHITECTURE.md, section 10: corrupt stored data
 * falls back to defaults field by field, and applyEvents does exactly what
 * the list on ApplySaveEventsFn (types.ts) says for each event.
 */

const LEVELS = 10;

const SAVED: SaveData = {
  v: 1,
  unlocked: 4,
  bestScore: 2350,
  finished: false,
  resume: { levelIndex: 3, score: 900, lives: 2 },
};

/** Freezes a save and its resume point, so a reducer that writes to its input fails loudly. */
function frozen(save: SaveData): SaveData {
  return Object.freeze({ ...save, resume: save.resume === null ? null : Object.freeze({ ...save.resume }) });
}

// The events the reducer listens to, with plain values.
const levelStarted = (levelIndex: number, score: number, lives: number): GameEvent => ({
  type: 'levelStarted',
  levelIndex,
  score,
  lives,
});
const playerDied = (livesAfter: number, score: number): GameEvent => ({
  type: 'playerDied',
  cause: 'spikes',
  x: 0,
  y: 0,
  livesAfter,
  score,
});
const respawned = (lives: number, reason: 'death' | 'restart' = 'death'): GameEvent => ({
  type: 'respawned',
  lives,
  reason,
});
const levelCompleted = (
  levelIndex: number,
  last: boolean,
  score: number,
  lives: number,
  highestUnlocked: number,
): GameEvent => ({ type: 'levelCompleted', levelIndex, last, bonus: 200, score, lives, highestUnlocked });
const gameOver = (score: number): GameEvent => ({ type: 'gameOver', score });
const gameWon = (score: number, lives: number): GameEvent => ({ type: 'gameWon', score, lives, lifeBonus: lives * 500 });

describe('defaultSave', () => {
  it('is the empty progress: level 0 unlocked, no best score, not finished, nothing to resume', () => {
    expect(defaultSave()).toEqual({ v: 1, unlocked: 0, bestScore: 0, finished: false, resume: null });
  });

  it('returns a new object every time', () => {
    expect(defaultSave()).not.toBe(defaultSave());
  });
});

describe('parseSave', () => {
  it('returns a valid save unchanged in value', () => {
    expect(parseSave(SAVED, LEVELS)).toEqual(SAVED);
    expect(parseSave(JSON.parse(JSON.stringify(SAVED)), LEVELS)).toEqual(SAVED);
    const finished: SaveData = { v: 1, unlocked: 9, bestScore: 7900, finished: true, resume: null };
    expect(parseSave(finished, LEVELS)).toEqual(finished);
  });

  it('falls back to the default save when the stored value is not an object', () => {
    for (const junk of [undefined, null, 0, 17, NaN, '', 'save', true, false]) {
      expect(parseSave(junk, LEVELS)).toEqual(defaultSave());
    }
  });

  it('falls back to defaults for an object with none of the fields, an array included', () => {
    expect(parseSave({}, LEVELS)).toEqual(defaultSave());
    expect(parseSave([], LEVELS)).toEqual(defaultSave());
    expect(parseSave([1, 2, 3], LEVELS)).toEqual(defaultSave());
  });

  it('judges each field by itself: one bad field falls back, the others are kept', () => {
    expect(parseSave({ ...SAVED, unlocked: 'four' }, LEVELS)).toEqual({ ...SAVED, unlocked: 0 });
    expect(parseSave({ ...SAVED, bestScore: null }, LEVELS)).toEqual({ ...SAVED, bestScore: 0 });
    expect(parseSave({ ...SAVED, finished: 'yes' }, LEVELS)).toEqual({ ...SAVED, finished: false });
    expect(parseSave({ ...SAVED, resume: 'level 3' }, LEVELS)).toEqual({ ...SAVED, resume: null });
    const withoutUnlocked: Record<string, unknown> = { ...SAVED };
    delete withoutUnlocked.unlocked;
    expect(parseSave(withoutUnlocked, LEVELS)).toEqual({ ...SAVED, unlocked: 0 });
  });

  it('accepts only whole numbers of zero or more for unlocked and bestScore', () => {
    for (const bad of [-1, 2.5, NaN, Infinity, -Infinity, 1e30, '3', true, null, [3], {}]) {
      expect(parseSave({ ...SAVED, unlocked: bad }, LEVELS).unlocked).toBe(0);
      expect(parseSave({ ...SAVED, bestScore: bad }, LEVELS).bestScore).toBe(0);
    }
  });

  it('accepts finished only as the boolean true', () => {
    expect(parseSave({ ...SAVED, finished: true }, LEVELS).finished).toBe(true);
    for (const bad of [1, 'true', null, undefined, {}]) {
      expect(parseSave({ ...SAVED, finished: bad }, LEVELS).finished).toBe(false);
    }
  });

  it('always answers with version 1, whatever version was stored', () => {
    expect(parseSave({ ...SAVED, v: 2 }, LEVELS)).toEqual(SAVED);
    expect(parseSave({ ...SAVED, v: 'one' }, LEVELS)).toEqual(SAVED);
    const withoutVersion: Record<string, unknown> = { ...SAVED };
    delete withoutVersion.v;
    expect(parseSave(withoutVersion, LEVELS)).toEqual(SAVED);
  });

  it('clamps unlocked to the last level of the campaign', () => {
    expect(parseSave({ ...SAVED, unlocked: 9 }, LEVELS).unlocked).toBe(9);
    expect(parseSave({ ...SAVED, unlocked: 10 }, LEVELS).unlocked).toBe(9);
    expect(parseSave({ ...SAVED, unlocked: 4 }, 3).unlocked).toBe(2);
  });

  it('clamps resume.levelIndex to the last level of the campaign', () => {
    expect(parseSave({ ...SAVED, resume: { levelIndex: 12, score: 5, lives: 1 } }, LEVELS).resume).toEqual({
      levelIndex: 9,
      score: 5,
      lives: 1,
    });
    expect(parseSave(SAVED, 2).resume).toEqual({ levelIndex: 1, score: 900, lives: 2 });
  });

  it('drops a resume point that is not whole: a missing or bad level, score or lives', () => {
    const good = { levelIndex: 3, score: 900, lives: 2 };
    for (const bad of [
      { ...good, levelIndex: -1 },
      { ...good, levelIndex: 1.5 },
      { ...good, levelIndex: '3' },
      { ...good, score: -10 },
      { ...good, score: null },
      { ...good, lives: 0 },
      { ...good, lives: -1 },
      { ...good, lives: 2.5 },
      { levelIndex: 3, score: 900 },
      { levelIndex: 3, lives: 2 },
      { score: 900, lives: 2 },
      {},
      [],
      3,
      'x',
      true,
    ]) {
      expect(parseSave({ ...SAVED, resume: bad }, LEVELS)).toEqual({ ...SAVED, resume: null });
    }
  });

  it('keeps only the known fields', () => {
    const noisy = { ...SAVED, extra: 1, resume: { ...SAVED.resume, extra: 2 } };
    expect(parseSave(noisy, LEVELS)).toEqual(SAVED);
  });

  it('gives a new object, never the one it was handed', () => {
    const parsed = parseSave(SAVED, LEVELS);
    expect(parsed).not.toBe(SAVED);
    expect(parsed.resume).not.toBe(SAVED.resume);
  });

  it('has nothing unlocked and nothing to resume when the campaign is empty', () => {
    expect(parseSave(SAVED, 0)).toEqual({ ...SAVED, unlocked: 0, resume: null });
    expect(parseSave(SAVED, NaN)).toEqual({ ...SAVED, unlocked: 0, resume: null });
  });

  it('never throws, whatever is stored', () => {
    const odd: unknown[] = [
      Symbol('s'),
      () => 1,
      new Date(0),
      new Map([['unlocked', 3]]),
      Object.create(null),
      { resume: { levelIndex: {}, score: [], lives: () => 3 } },
      { unlocked: { valueOf: () => 3 } },
    ];
    for (const value of odd) {
      expect(() => parseSave(value, LEVELS)).not.toThrow();
      expect(parseSave(value, LEVELS)).toEqual(defaultSave());
    }
  });
});

describe('applyEvents: one event at a time', () => {
  it('levelStarted: resume becomes the level with the score and lives it starts with', () => {
    expect(applyEvents(frozen(defaultSave()), [levelStarted(0, 0, 3)])).toEqual({
      ...defaultSave(),
      resume: { levelIndex: 0, score: 0, lives: 3 },
    });
    expect(applyEvents(frozen(SAVED), [levelStarted(4, 1500, 3)]).resume).toEqual({ levelIndex: 4, score: 1500, lives: 3 });
  });

  it('playerDied with lives left: only resume.lives changes, at the moment of death', () => {
    expect(applyEvents(frozen(SAVED), [playerDied(1, 1234)])).toEqual({
      ...SAVED,
      resume: { levelIndex: 3, score: 900, lives: 1 },
    });
  });

  it('playerDied on the last life: resume is cleared and the best score is raised at once', () => {
    expect(applyEvents(frozen(SAVED), [playerDied(0, 3000)])).toEqual({ ...SAVED, bestScore: 3000, resume: null });
    expect(applyEvents(frozen(SAVED), [playerDied(0, 100)])).toEqual({ ...SAVED, resume: null });
  });

  it('respawned: resume.lives becomes the lives now, after a death and after Restart level', () => {
    expect(applyEvents(frozen(SAVED), [respawned(1)]).resume).toEqual({ levelIndex: 3, score: 900, lives: 1 });
    expect(applyEvents(frozen(SAVED), [respawned(1, 'restart')]).resume).toEqual({ levelIndex: 3, score: 900, lives: 1 });
  });

  it('playerDied and respawned change nothing when there is no run to resume', () => {
    const idle = frozen({ ...SAVED, resume: null });
    expect(applyEvents(idle, [playerDied(2, 50), respawned(2)])).toBe(idle);
  });

  it('levelCompleted: unlocked rises to highestUnlocked and resume moves to the next level at once', () => {
    expect(applyEvents(frozen(SAVED), [levelCompleted(4, false, 1700, 3, 5)])).toEqual({
      ...SAVED,
      unlocked: 5,
      resume: { levelIndex: 5, score: 1700, lives: 3 },
    });
  });

  it('levelCompleted never lowers unlocked', () => {
    expect(applyEvents(frozen(SAVED), [levelCompleted(1, false, 1700, 3, 2)]).unlocked).toBe(4);
  });

  it('levelCompleted on the last level: the campaign is finished at once, resume is cleared and the best score is raised', () => {
    // Nothing but a closed page can stop the exiting phase, so the win is saved now, not 60 ticks later at gameWon.
    const lastLevel = frozen({ ...SAVED, unlocked: 9, resume: { levelIndex: 9, score: 5000, lives: 2 } });
    expect(applyEvents(lastLevel, [levelCompleted(9, true, 5600, 3, 9)])).toEqual({
      ...SAVED,
      unlocked: 9,
      bestScore: 5600,
      finished: true,
      resume: null,
    });
    // A lower score leaves the best score alone.
    expect(applyEvents(frozen(SAVED), [levelCompleted(9, true, 2000, 3, 9)])).toEqual({
      ...SAVED,
      unlocked: 9,
      finished: true,
      resume: null,
    });
  });

  it('gameOver: the best score is raised if beaten, and resume is cleared', () => {
    expect(applyEvents(frozen(SAVED), [gameOver(2400)])).toEqual({ ...SAVED, bestScore: 2400, resume: null });
    expect(applyEvents(frozen(SAVED), [gameOver(2000)])).toEqual({ ...SAVED, resume: null });
  });

  it('gameWon: the best score is raised if beaten, finished is set, resume is cleared', () => {
    expect(applyEvents(frozen(SAVED), [gameWon(7900, 3)])).toEqual({
      ...SAVED,
      bestScore: 7900,
      finished: true,
      resume: null,
    });
    expect(applyEvents(frozen(SAVED), [gameWon(1000, 1)])).toEqual({ ...SAVED, finished: true, resume: null });
  });

  it('ignores every other event', () => {
    const save = frozen(SAVED);
    const others: GameEvent[] = [
      { type: 'readyEnded' },
      { type: 'jumped', x: 1, y: 2 },
      { type: 'landed', x: 1, y: 2, speed: 300 },
      { type: 'bonked', x: 1, y: 2 },
      { type: 'thrustStarted' },
      { type: 'thrustStopped' },
      { type: 'fuelEmptied', x: 1, y: 2 },
      { type: 'pickup', kind: 'crystal', index: 0, x: 1, y: 2, score: 10 },
      { type: 'pickupRestored', kind: 'thruster', index: 1, x: 1, y: 2 },
      { type: 'trophyCollected', x: 1, y: 2, score: 100 },
      { type: 'doorOpened', x: 1, y: 2 },
      { type: 'boltFired', x: 1, y: 2, dir: 1 },
      { type: 'boltEnded', x: 1, y: 2, hit: 'wall' },
      { type: 'enemyKilled', index: 0, kind: 'moth', x: 1, y: 2, score: 100 },
    ];
    expect(applyEvents(save, others)).toBe(save);
  });
});

describe('applyEvents: the same object when nothing changed', () => {
  it('returns the save it was given for an empty list', () => {
    const save = frozen(SAVED);
    expect(applyEvents(save, [])).toBe(save);
  });

  it('returns the save it was given when an event sets the values it already holds', () => {
    const save = frozen(SAVED);
    expect(applyEvents(save, [levelStarted(3, 900, 2)])).toBe(save);
    expect(applyEvents(save, [respawned(2)])).toBe(save);
    expect(applyEvents(save, [playerDied(2, 0)])).toBe(save);
    expect(applyEvents(save, [levelCompleted(2, false, 900, 2, 3)])).toBe(save);
    const won = frozen({ ...SAVED, finished: true, resume: null });
    expect(applyEvents(won, [levelCompleted(9, true, 100, 3, 2)])).toBe(won);
  });

  it('returns the save it was given when several events cancel out', () => {
    const save = frozen(SAVED);
    expect(applyEvents(save, [levelStarted(7, 1, 1), levelStarted(3, 900, 2)])).toBe(save);
  });

  it('keeps the old resume object when only another field changed', () => {
    const save = frozen(SAVED);
    const next = applyEvents(save, [levelStarted(3, 900, 2), levelCompleted(2, false, 900, 2, 9)]);
    expect(next).not.toBe(save);
    expect(next.unlocked).toBe(9);
    expect(next.resume).toBe(save.resume);
  });

  it('returns a new object and leaves the old one alone when something changed', () => {
    const save = frozen(SAVED);
    const next = applyEvents(save, [playerDied(1, 0)]);
    expect(next).not.toBe(save);
    expect(save).toEqual(SAVED);
  });
});

describe('applyEvents: whole runs', () => {
  /** Applies the ticks one after another, as the shell does, and also all at once: both must agree. */
  function play(start: SaveData, ticks: GameEvent[][]): SaveData {
    const stepwise = ticks.reduce((save, events) => applyEvents(frozen(save), events), start);
    expect(applyEvents(frozen(start), ticks.flat())).toEqual(stepwise);
    return stepwise;
  }

  it('a death, a respawn, a clear and the next level: lives are saved at the death, the next level at the clear', () => {
    const afterDeath = play(defaultSave(), [[levelStarted(0, 0, 3)], [playerDied(2, 40)]]);
    expect(afterDeath.resume).toEqual({ levelIndex: 0, score: 0, lives: 2 });

    const afterClear = play(afterDeath, [[respawned(2)], [levelCompleted(0, false, 350, 3, 1)]]);
    expect(afterClear).toEqual({
      ...defaultSave(),
      unlocked: 1,
      resume: { levelIndex: 1, score: 350, lives: 3 },
    });

    // The level start that follows the clear banner repeats what the clear already saved.
    expect(applyEvents(afterClear, [levelStarted(1, 350, 3)])).toBe(afterClear);
  });

  it('a game over: the best score is already saved at the last death, 52 ticks before gameOver arrives', () => {
    const start: SaveData = { ...SAVED, unlocked: 2, bestScore: 500, resume: { levelIndex: 2, score: 600, lives: 1 } };
    const atDeath = play(start, [[playerDied(0, 730)]]);
    expect(atDeath).toEqual({ v: 1, unlocked: 2, bestScore: 730, finished: false, resume: null });
    expect(applyEvents(atDeath, [gameOver(730)])).toBe(atDeath);
  });

  it('a win: the last clear already saves the win with the score so far; gameWon then adds the life bonus to the best score', () => {
    const start: SaveData = { ...SAVED, unlocked: 9, bestScore: 500, resume: { levelIndex: 9, score: 6000, lives: 2 } };
    const atClear = play(start, [[levelCompleted(9, true, 6400, 3, 9)]]);
    expect(atClear).toEqual({ v: 1, unlocked: 9, bestScore: 6400, finished: true, resume: null });
    expect(play(atClear, [[gameWon(7900, 3)]])).toEqual({ v: 1, unlocked: 9, bestScore: 7900, finished: true, resume: null });
  });

  it('in play: closing the page during the exiting phase of the last level keeps the win (section 10: a clear loses nothing)', () => {
    // A two-level campaign started on its last level: walk right through the cog into the open airlock.
    const room = levelFromRows(['......', '.P.TD.', '######']);
    const events: GameEvent[] = [];
    const game = createSession([room, room], REFERENCE_PHYS, { levelIndex: 1, score: 1000, lives: 2, highestUnlocked: 1 }, events);
    let save = applyEvents(defaultSave(), events);
    let cleared: GameEvent | undefined;
    for (let t = 0; t < 400 && cleared === undefined; t++) {
      events.length = 0;
      step(game, t < REFERENCE_PHYS.readyMinTicks ? NONE : IN('R'), events);
      save = applyEvents(save, events);
      cleared = events.find((event) => event.type === 'levelCompleted');
    }
    expect(cleared).toMatchObject({ last: true, score: 1000 + REFERENCE_PHYS.scoreCog + REFERENCE_PHYS.scoreLevelClear });
    expect(game.run.phase).toBe('exiting');

    // The page closes here, in the middle of the 60 exiting ticks: what is stored is what the next visit finds.
    const stored = parseSave(JSON.parse(JSON.stringify(save)), 2);
    expect(stored).toEqual({ v: 1, unlocked: 1, bestScore: 1300, finished: true, resume: null });
  });

  it('a new game after a win keeps unlocked, the best score and finished', () => {
    const won: SaveData = { v: 1, unlocked: 9, bestScore: 7900, finished: true, resume: null };
    expect(play(won, [[levelStarted(0, 0, 3)], [playerDied(2, 10)], [levelCompleted(0, false, 300, 3, 9)]])).toEqual({
      v: 1,
      unlocked: 9,
      bestScore: 7900,
      finished: true,
      resume: { levelIndex: 1, score: 300, lives: 3 },
    });
  });

  it('what it returns always survives a JSON round trip through parseSave', () => {
    const save = play(defaultSave(), [[levelStarted(0, 0, 3)], [playerDied(2, 40)], [levelCompleted(0, false, 350, 3, 1)]]);
    expect(parseSave(JSON.parse(JSON.stringify(save)), LEVELS)).toEqual(save);
  });
});
