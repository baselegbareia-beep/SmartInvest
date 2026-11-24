import { describe, expect, it } from 'vitest';

import { MAX_LINE_CHARS, canDraw } from '../../art/font';
import { TUNING } from '../../tuning';

import { TEXT, bestLine, scoreDigits } from './strings';

/**
 * Every fixed screen text, with the widest values it can be given in play: level 10, a five-digit
 * score, the largest bonus (docs/ART-AND-SOUND.md section 14: "Every fixed text the game shows is at
 * most 42 characters and uses only the font's characters").
 */
function everyText(): string[] {
  const out: string[] = [];
  for (const value of Object.values(TEXT)) {
    if (typeof value === 'string') {
      out.push(value);
      continue;
    }
    // Each function is called with values at the edge of what the game can give it.
    for (const sample of [0, 1, 3, 10, 99999]) {
      if (value.length === 1) out.push((value as (n: number) => string)(sample));
      else out.push((value as (a: number, b: number) => string)(TUNING.lives.maxLives, TUNING.score.lifeLeft));
    }
  }
  out.push(TEXT.sound(true), TEXT.sound(false), TEXT.buzz(true), TEXT.buzz(false));
  return out;
}

describe('screen texts', () => {
  it('every one is drawable by the pixel font', () => {
    for (const text of everyText()) expect(canDraw(text), text).toBe(true);
  });

  it(`every one fits on a line of ${MAX_LINE_CHARS} characters`, () => {
    for (const text of everyText()) expect(text.length, text).toBeLessThanOrEqual(MAX_LINE_CHARS);
  });

  it('scores are five digits with leading zeros', () => {
    expect(scoreDigits(0)).toBe('00000');
    expect(scoreDigits(420)).toBe('00420');
    expect(scoreDigits(7900)).toBe('07900');
    expect(TEXT.score(4250)).toBe('SCORE 04250');
  });
});

describe('bestLine', () => {
  it('says NEW BEST! only when the score beats the best as it was when the session began', () => {
    expect(bestLine(500, 400)).toBe('NEW BEST!');
    expect(bestLine(400, 400)).toBe('BEST 00400');
    expect(bestLine(300, 6100)).toBe('BEST 06100');
    expect(bestLine(0, 0)).toBe('BEST 00000');
  });
});
