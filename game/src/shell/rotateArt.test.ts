import { describe, expect, it } from 'vitest';

import { validateFrame } from '../art/grid';
import { textWidth } from '../art/font';

import { PHONE_SCALE, PHONE_SIDEWAYS, PHONE_UPRIGHT, quarterTurn } from './rotateArt';
import { TEXT } from './scenes/strings';

describe('the rotate message\'s phone', () => {
  it('is two frames of 16 x 16 in palette codes', () => {
    expect(validateFrame('upright', PHONE_UPRIGHT, 16, 16)).toEqual([]);
    expect(validateFrame('sideways', PHONE_SIDEWAYS, 16, 16)).toEqual([]);
  });

  it('turns: the sideways frame is the upright one a quarter turn on, and four turns come back', () => {
    const tall = (f: readonly string[]): { w: number; h: number } => {
      const rows = f.map((r, i) => (/[^.]/.test(r) ? i : -1)).filter((i) => i >= 0);
      const cols = Array.from({ length: 16 }, (_, c) => (f.some((r) => r.charAt(c) !== '.') ? c : -1)).filter((c) => c >= 0);
      return { w: (cols.at(-1) ?? 0) - (cols[0] ?? 0) + 1, h: (rows.at(-1) ?? 0) - (rows[0] ?? 0) + 1 };
    };
    expect(tall(PHONE_UPRIGHT)).toEqual({ w: 10, h: 16 });
    expect(tall(PHONE_SIDEWAYS)).toEqual({ w: 16, h: 10 });
    expect(quarterTurn(quarterTurn(quarterTurn(quarterTurn(PHONE_UPRIGHT))))).toEqual(PHONE_UPRIGHT);
  });

  it('is never wider than the words under it, so it fits wherever they do', () => {
    expect(16 * PHONE_SCALE).toBeLessThanOrEqual(textWidth(TEXT.rotate));
  });
});
