/**
 * Where a session starts: the save rules of docs/ARCHITECTURE.md section 10, as pure functions that
 * the Title and End scenes call and the unit test checks. No Phaser, no storage: the save is passed
 * in, and the Play scene creates the session from the `PlayStart` it is given.
 */
import type { LevelData, SaveData, SessionStart } from '../../core/types';

/** How the Play scene starts a session. Handed over as the data of `scene.start('Play', ...)`. */
export interface PlayStart {
  /** The levels of the session, in play order: the campaign, or one development room. */
  readonly levels: readonly LevelData[];
  /** `createSession`'s start: level index, score, lives, highest unlocked. Missing fields take its defaults. */
  readonly start: Partial<SessionStart>;
  /**
   * True for the campaign: the save is read when the session starts and written after every tick.
   * False for the development rooms and the test hook: the save is never read or written.
   */
  readonly saved: boolean;
}

/** A start with the level number (1-based) its button names: `CONTINUE - LEVEL 7`. */
export interface NumberedStart {
  readonly levelNumber: number;
  readonly play: PlayStart;
}

export interface TitleOffer {
  /** `CONTINUE - LEVEL n`, or null when there is nothing to continue (the title then shows only the start prompt). */
  readonly continueRun: NumberedStart | null;
  /** `NEW GAME`, or the start prompt. */
  readonly newGame: PlayStart;
  /**
   * True when the build has no campaign level yet: NEW GAME then plays the development rooms one
   * after the other, as a session that is never saved, so the game can still be played.
   */
  readonly noCampaign: boolean;
}

/** A one-room session that is never saved: `?level=test`, `?level=debug`, the test hook. */
export function devStart(level: LevelData): PlayStart {
  return { levels: [level], start: {}, saved: false };
}

/**
 * Continue a saved campaign (ARCHITECTURE 10):
 * - a run in progress (`save.resume`): its level, score and lives (createSession clamps the lives);
 * - otherwise, once a level beyond the first is unlocked: that level, 3 lives, score 0;
 * - otherwise nothing to continue.
 */
export function continueStart(save: SaveData, campaign: readonly LevelData[]): NumberedStart | null {
  if (campaign.length === 0) return null;
  if (save.resume !== null) {
    const { levelIndex, score, lives } = save.resume;
    return {
      levelNumber: levelIndex + 1,
      play: { levels: campaign, start: { levelIndex, score, lives, highestUnlocked: save.unlocked }, saved: true },
    };
  }
  if (save.unlocked > 0) {
    return {
      levelNumber: save.unlocked + 1,
      play: { levels: campaign, start: { levelIndex: save.unlocked, highestUnlocked: save.unlocked }, saved: true },
    };
  }
  return null;
}

/** NEW GAME: level 1, 3 lives, score 0; unlocked levels and the best score are kept. */
export function newGameStart(save: SaveData, campaign: readonly LevelData[], devRooms: readonly LevelData[]): PlayStart {
  if (campaign.length === 0) return { levels: devRooms, start: {}, saved: false };
  return { levels: campaign, start: { highestUnlocked: save.unlocked }, saved: true };
}

/** What the title screen offers. */
export function titleOffer(save: SaveData, campaign: readonly LevelData[], devRooms: readonly LevelData[]): TitleOffer {
  return {
    continueRun: continueStart(save, campaign),
    newGame: newGameStart(save, campaign, devRooms),
    noCampaign: campaign.length === 0,
  };
}

/**
 * The End screen's first button: `TRY AGAIN - LEVEL n` after a game over, `PLAY AGAIN` after a win.
 *
 * - Saved campaign: after a game over the save has no run left, so this is Continue (the highest level
 *   reached, 3 lives, score 0); after a win, a new game. `save` is the save as it is now.
 * - Unsaved session (a development room): the same levels again, from the highest one reached after a
 *   game over, from the first after a win.
 */
export function againStart(ended: PlayStart, outcome: 'gameOver' | 'won', highestUnlocked: number, save: SaveData | null): NumberedStart {
  if (ended.saved && save !== null) {
    if (outcome === 'won') return { levelNumber: 1, play: newGameStart(save, ended.levels, ended.levels) };
    const next = continueStart(save, ended.levels);
    if (next !== null) return next;
    return { levelNumber: 1, play: newGameStart(save, ended.levels, ended.levels) };
  }
  if (outcome === 'won') return { levelNumber: 1, play: { levels: ended.levels, start: {}, saved: false } };
  const levelIndex = Math.max(0, Math.min(highestUnlocked, ended.levels.length - 1));
  return { levelNumber: levelIndex + 1, play: { levels: ended.levels, start: { levelIndex, highestUnlocked: levelIndex }, saved: false } };
}
