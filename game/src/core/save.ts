/**
 * The saved progress as pure functions (docs/ARCHITECTURE.md, section 10).
 * Nothing here touches storage: the shell reads and writes the JSON, and
 * hands whatever it found to parseSave and every tick's events to
 * applyEvents.
 */
import type { ApplySaveEventsFn, DefaultSaveFn, ParseSaveFn, ResumePoint } from './types';

export const defaultSave: DefaultSaveFn = () => ({ v: 1, unlocked: 0, bestScore: 0, finished: false, resume: null });

/** A whole number, zero or more, small enough to be exact: what every counter in a save must be. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Stored data arrives as "anything": this is the one place that looks inside it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A resume point is used whole or not at all: half of one (a level without a
 * score, a run with no lives left) cannot be continued.
 */
function parseResume(value: unknown, lastLevel: number): ResumePoint | null {
  if (!isRecord(value)) return null;
  const { levelIndex, score, lives } = value;
  if (!isCount(levelIndex) || !isCount(score) || !isCount(lives) || lives < 1) return null;
  return { levelIndex: Math.min(levelIndex, lastLevel), score, lives };
}

/**
 * Stored progress may be missing, cut short, edited by hand or written by
 * another version of the game. Each field is judged by itself, so one bad
 * field costs the player that field and not the rest. The version number is
 * not looked at: there has only ever been version 1, and the result is one.
 */
export const parseSave: ParseSaveFn = (json, levelCount) => {
  if (!isRecord(json)) return defaultSave();

  // With no level at all (a build without a campaign) nothing can be unlocked or resumed.
  const hasLevels = levelCount >= 1;
  const lastLevel = hasLevels ? Math.trunc(levelCount) - 1 : 0;

  return {
    v: 1,
    unlocked: isCount(json.unlocked) ? Math.min(json.unlocked, lastLevel) : 0,
    bestScore: isCount(json.bestScore) ? json.bestScore : 0,
    finished: json.finished === true,
    resume: hasLevels ? parseResume(json.resume, lastLevel) : null,
  };
};

function sameResume(a: ResumePoint | null, b: ResumePoint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.levelIndex === b.levelIndex && a.score === b.score && a.lives === b.lives;
}

/**
 * Called after every tick, almost always with nothing to do, so it returns
 * the save it was given unless a value really changed: the shell writes to
 * storage only when it gets a different object back.
 */
export const applyEvents: ApplySaveEventsFn = (save, events) => {
  let { unlocked, bestScore, finished, resume } = save;

  for (const event of events) {
    switch (event.type) {
      case 'levelStarted':
        resume = { levelIndex: event.levelIndex, score: event.score, lives: event.lives };
        break;

      case 'playerDied':
        if (event.livesAfter <= 0) {
          // The last life: the run is over now, even if the page closes before the game-over screen.
          resume = null;
          bestScore = Math.max(bestScore, event.score);
        } else if (resume !== null) {
          // Saved at the moment of death, so quitting during the animation does not give the life back.
          resume = { ...resume, lives: event.livesAfter };
        }
        break;

      case 'respawned':
        if (resume !== null) resume = { ...resume, lives: event.lives };
        break;

      case 'levelCompleted':
        unlocked = Math.max(unlocked, event.highestUnlocked);
        if (event.last) {
          // Nothing but closing the page can stop the exiting phase now, so the campaign counts as won
          // at once: a closed page must not send the player back to the start of the last level.
          // gameWon, 60 ticks later, adds the life bonus to the best score.
          finished = true;
          resume = null;
          bestScore = Math.max(bestScore, event.score);
        } else {
          // Moved on at once, so closing the page during the clear banner loses nothing.
          resume = { levelIndex: event.levelIndex + 1, score: event.score, lives: event.lives };
        }
        break;

      case 'gameOver':
        bestScore = Math.max(bestScore, event.score);
        resume = null;
        break;

      case 'gameWon':
        bestScore = Math.max(bestScore, event.score);
        finished = true;
        resume = null;
        break;

      default:
        break;
    }
  }

  if (sameResume(resume, save.resume)) resume = save.resume;
  if (
    unlocked === save.unlocked &&
    bestScore === save.bestScore &&
    finished === save.finished &&
    resume === save.resume
  ) {
    return save;
  }
  return { v: 1, unlocked, bestScore, finished, resume };
};
