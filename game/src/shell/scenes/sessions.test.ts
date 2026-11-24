import { describe, expect, it } from 'vitest';

import { defaultSave } from '../../core/save';
import { levelFromRows } from '../../core/testkit';
import type { LevelData, SaveData } from '../../core/types';

import { againStart, continueStart, devStart, newGameStart, titleOffer } from './sessions';

const room = (id: string): LevelData => levelFromRows(['.P.TD', '#####'], { id, frame: true });
const CAMPAIGN = [room('level-01'), room('level-02'), room('level-03')];
const DEV = [room('test'), room('debug')];
const save = (changes: Partial<SaveData>): SaveData => ({ ...defaultSave(), ...changes });

describe('the title screen (ARCHITECTURE 10)', () => {
  it('a first visit offers only a new game of the campaign, saved', () => {
    const offer = titleOffer(defaultSave(), CAMPAIGN, DEV);
    expect(offer.continueRun).toBeNull();
    expect(offer.noCampaign).toBe(false);
    expect(offer.newGame).toEqual({ levels: CAMPAIGN, start: { highestUnlocked: 0 }, saved: true });
  });

  it('a run in progress is continued with its level, score and lives', () => {
    const s = save({ unlocked: 2, resume: { levelIndex: 1, score: 340, lives: 2 } });
    const offer = titleOffer(s, CAMPAIGN, DEV);
    expect(offer.continueRun).toEqual({
      levelNumber: 2,
      play: { levels: CAMPAIGN, start: { levelIndex: 1, score: 340, lives: 2, highestUnlocked: 2 }, saved: true },
    });
  });

  it('with no run but an unlocked level, Continue starts that level afresh (default lives, score 0)', () => {
    const offer = titleOffer(save({ unlocked: 2 }), CAMPAIGN, DEV);
    expect(offer.continueRun).toEqual({
      levelNumber: 3,
      play: { levels: CAMPAIGN, start: { levelIndex: 2, highestUnlocked: 2 }, saved: true },
    });
  });

  it('NEW GAME keeps what is unlocked', () => {
    expect(newGameStart(save({ unlocked: 2, bestScore: 900 }), CAMPAIGN, DEV)).toEqual({
      levels: CAMPAIGN,
      start: { highestUnlocked: 2 },
      saved: true,
    });
  });

  it('without a campaign: nothing to continue, and NEW GAME plays the test rooms unsaved', () => {
    const offer = titleOffer(save({ unlocked: 0, resume: null }), [], DEV);
    expect(offer.noCampaign).toBe(true);
    expect(offer.continueRun).toBeNull();
    expect(offer.newGame).toEqual({ levels: DEV, start: {}, saved: false });
    expect(continueStart(save({ unlocked: 3 }), [])).toBeNull();
  });
});

describe('development rooms', () => {
  it('are one-room sessions that are never saved', () => {
    const level = DEV[0];
    if (!level) throw new Error('no room');
    expect(devStart(level)).toEqual({ levels: [level], start: {}, saved: false });
  });
});

describe('the End screen', () => {
  const campaignRun = { levels: CAMPAIGN, start: {}, saved: true } as const;

  it('after a game over in the campaign: TRY AGAIN continues at the highest level reached', () => {
    const after = save({ unlocked: 1, resume: null, bestScore: 500 });
    expect(againStart(campaignRun, 'gameOver', 1, after)).toEqual({
      levelNumber: 2,
      play: { levels: CAMPAIGN, start: { levelIndex: 1, highestUnlocked: 1 }, saved: true },
    });
    expect(againStart(campaignRun, 'gameOver', 0, save({}))).toEqual({
      levelNumber: 1,
      play: { levels: CAMPAIGN, start: { highestUnlocked: 0 }, saved: true },
    });
  });

  it('after a win: PLAY AGAIN is a new game', () => {
    expect(againStart(campaignRun, 'won', 2, save({ unlocked: 2, finished: true }))).toEqual({
      levelNumber: 1,
      play: { levels: CAMPAIGN, start: { highestUnlocked: 2 }, saved: true },
    });
  });

  it('an unsaved session tries again from the highest room reached, or from the first after a win', () => {
    const devRun = { levels: DEV, start: {}, saved: false } as const;
    expect(againStart(devRun, 'gameOver', 1, null)).toEqual({
      levelNumber: 2,
      play: { levels: DEV, start: { levelIndex: 1, highestUnlocked: 1 }, saved: false },
    });
    expect(againStart(devRun, 'won', 1, null)).toEqual({ levelNumber: 1, play: { levels: DEV, start: {}, saved: false } });
  });
});
