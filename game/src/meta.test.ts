import { describe, expect, it } from 'vitest';

import { GAME_ID, GAME_TITLE } from './meta';

describe('meta', () => {
  it('has a non-empty title without stray whitespace', () => {
    expect(GAME_TITLE.length).toBeGreaterThan(0);
    expect(GAME_TITLE).toBe(GAME_TITLE.trim());
  });

  it('has a title the pixel font can draw on the smallest screen', () => {
    // The font holds capitals, digits, the space and . , ! ? : - + / ' % (docs/ART-AND-SOUND.md).
    expect(GAME_TITLE.toUpperCase()).toMatch(/^[A-Z0-9 .,!?:\-+/'%]+$/);
    // Title screen: the first word at three times the font size, the rest at normal size.
    // A letter is 6 px wide and the narrowest view is 272 px: 15 large or 42 small letters fit.
    const [firstWord = '', ...rest] = GAME_TITLE.split(' ');
    expect(firstWord.length).toBeLessThanOrEqual(15);
    expect(rest.join(' ').length).toBeLessThanOrEqual(42);
  });

  it('has an id that is safe to use as a storage key prefix', () => {
    expect(GAME_ID).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('keeps the id that saved games are stored under', () => {
    // Changing the id would orphan every player's progress and best score.
    expect(GAME_ID).toBe('moon-foundry');
  });
});
