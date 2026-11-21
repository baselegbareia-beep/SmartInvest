import { describe, expect, it } from 'vitest';

import { GAME_ID, GAME_TITLE } from './meta';

describe('meta', () => {
  it('has a non-empty title without stray whitespace', () => {
    expect(GAME_TITLE.length).toBeGreaterThan(0);
    expect(GAME_TITLE).toBe(GAME_TITLE.trim());
  });

  it('has an id that is safe to use as a storage key prefix', () => {
    expect(GAME_ID).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
