import { describe, expect, it } from 'vitest';

import { textWidth } from '../art/font';
import { REFERENCE_TOUCH } from '../input/testkit';

import {
  BLOCK_W,
  FUEL_PIPS,
  LIFE_BLINK_FRAMES,
  LIFE_BLINK_TOTAL,
  LEVEL_X,
  NO_BLINK,
  PIP_BLINK_FRAMES,
  SCREEN_CORNER_CSS,
  FrameClock,
  advanceBlink,
  cornerClearPx,
  countScore,
  fuelPips,
  lifeBlink,
  lifeLit,
  livesRowPx,
  newHudModel,
  pauseReservePx,
  pipLit,
  topBarLayout,
} from './hudModel';

describe('fuelPips', () => {
  it('rounds the tank up to tenths, so the last drop still lights a pip', () => {
    expect(fuelPips(0, 80)).toBe(0);
    expect(fuelPips(1, 80)).toBe(1);
    expect(fuelPips(8, 80)).toBe(1);
    expect(fuelPips(9, 80)).toBe(2);
    expect(fuelPips(79, 80)).toBe(10);
    expect(fuelPips(80, 80)).toBe(FUEL_PIPS);
  });

  it('never goes outside 0 to 10', () => {
    expect(fuelPips(-5, 80)).toBe(0);
    expect(fuelPips(200, 80)).toBe(10);
    expect(fuelPips(10, 0)).toBe(0);
  });
});

describe('countScore', () => {
  it('counts up 10 a frame and stops at the real score', () => {
    expect(countScore(0, 100, 1)).toBe(10);
    expect(countScore(0, 100, 3)).toBe(30);
    expect(countScore(90, 100, 5)).toBe(100);
    expect(countScore(100, 100, 5)).toBe(100);
  });

  it('never counts down: a lower score (a new session) is shown at once', () => {
    expect(countScore(500, 0, 1)).toBe(0);
  });

  it('a level-clear bonus of 200 is tallied in 20 frames', () => {
    let shown = 1000;
    let frames = 0;
    while (shown < 1200) {
      shown = countScore(shown, 1200, 1);
      frames++;
    }
    expect(frames).toBe(20);
  });
});

describe('the lost life blinks five times, then stays dark', () => {
  it('starts on the icon just past the lit ones', () => {
    expect(lifeBlink(2).index).toBe(2);
    expect(lifeBlink(0).index).toBe(0);
  });

  it('alternates dark and lit every 6 frames, five lit flashes in all, ending dark', () => {
    let blink = lifeBlink(1);
    const seen: boolean[] = [];
    for (let f = 0; f < LIFE_BLINK_TOTAL + 10; f++) {
      seen.push(lifeLit(1, 1, blink));
      blink = advanceBlink(blink, 1);
    }
    expect(seen.slice(0, LIFE_BLINK_FRAMES).every((on) => !on)).toBe(true);
    expect(seen.slice(LIFE_BLINK_FRAMES, 2 * LIFE_BLINK_FRAMES).every((on) => on)).toBe(true);
    let flashes = 0;
    for (let f = 1; f < seen.length; f++) if (seen[f] === true && seen[f - 1] === false) flashes++;
    expect(flashes).toBe(5);
    expect(seen.slice(LIFE_BLINK_TOTAL).every((on) => !on)).toBe(true);
    expect(blink).toEqual(NO_BLINK);
  });

  it('leaves the other icons alone', () => {
    const blink = lifeBlink(1);
    expect(lifeLit(0, 1, blink)).toBe(true);
    expect(lifeLit(2, 1, blink)).toBe(false);
  });
});

describe('pipLit', () => {
  it('lights the first `lit` pips', () => {
    expect([...Array(FUEL_PIPS).keys()].map((i) => pipLit(i, 6, 0))).toEqual([true, true, true, true, true, true, false, false, false, false]);
  });

  it('blinks the pips when two or fewer are lit, and only then', () => {
    expect(pipLit(0, 2, 0)).toBe(true);
    expect(pipLit(0, 2, PIP_BLINK_FRAMES)).toBe(false);
    expect(pipLit(0, 2, 2 * PIP_BLINK_FRAMES)).toBe(true);
    expect(pipLit(0, 3, PIP_BLINK_FRAMES)).toBe(true);
  });
});

describe('topBarLayout (docs/ART-AND-SOUND.md section 8)', () => {
  // The guide's numbers are for three lives; a literal, so an owner's edit of TUNING.lives cannot break this file.
  const maxLives = 3;

  it('puts the lives at x = 4, 9 px apart, the level at x = 36 and the score centred', () => {
    const bar = topBarLayout(284, maxLives, 24);
    expect(bar.y).toBe(3);
    expect(bar.lives).toEqual([4, 13, 22]);
    expect(bar.levelX).toBe(LEVEL_X);
    expect(bar.scoreX).toBe(Math.floor((284 - textWidth('00000')) / 2));
  });

  it('ends the 61 px block 4 px left of the space kept for PAUSE', () => {
    const bar = topBarLayout(422, maxLives, 24);
    expect(bar.blockEnd).toBe(422 - 24 - 4);
    expect(bar.blockEnd - bar.blockX).toBe(BLOCK_W);
    expect(bar.cogX).toBe(bar.blockX);
    const lastPip = bar.pips[bar.pips.length - 1] ?? 0;
    expect(lastPip + 2).toBe(bar.blockEnd);
    expect(bar.thrusterX + 8).toBeLessThan(bar.pips[0] ?? 0);
  });

  it('has the gaps of the guide on the smallest phone (284 px) and at the 272 px minimum', () => {
    const gaps = (w: number): number[] => {
      const bar = topBarLayout(w, maxLives, 24);
      const livesEnd = (bar.lives[bar.lives.length - 1] ?? 0) + 8;
      const levelEnd = bar.levelX + textWidth('LEVEL 10');
      const scoreEnd = bar.scoreX + textWidth('00000');
      return [bar.levelX - livesEnd, bar.scoreX - levelEnd, bar.blockX - scoreEnd];
    };
    expect(gaps(284)).toEqual([6, 44, 39]);
    expect(gaps(272)).toEqual([6, 38, 33]);
  });

  it('keeps 24 px for PAUSE at 2 CSS px per art px, and fewer at larger pixels', () => {
    // On the frozen touch numbers (src/input/testkit.ts), never the live ones: raising the button sizes, as
    // src/tuning.ts advises after a playtest, must not turn this file red.
    const t = REFERENCE_TOUCH;
    const css = t.pauseMarginSide + t.pauseButtonSize;
    expect(pauseReservePx(2, t.pauseMarginSide, t.pauseButtonSize)).toBe(Math.ceil(css / 2));
    expect(pauseReservePx(4, t.pauseMarginSide, t.pauseButtonSize)).toBe(Math.ceil(css / 4));
    expect(pauseReservePx(7 / 3, t.pauseMarginSide, t.pauseButtonSize)).toBe(Math.ceil(css / (7 / 3)));
    // The guide's golden numbers, on literal inputs: 24 px on the smallest phone, 12 at 4 CSS px per art px.
    expect(pauseReservePx(2, 12, 36)).toBe(24);
    expect(pauseReservePx(4, 12, 36)).toBe(12);
    expect(pauseReservePx(0, 12, 36)).toBe(48);
  });
});

describe('the bar keeps off a rounded corner of the glass', () => {
  it('cornerClearPx: how far in from the view\'s edge, art px, for the canvas\'s distance from the glass\'s edge', () => {
    expect(cornerClearPx(0, 2)).toBe(SCREEN_CORNER_CSS / 2); // Pixel 7 flipped: the canvas at the glass's left edge
    expect(cornerClearPx(0, 7 / 3)).toBe(Math.ceil(SCREEN_CORNER_CSS / (7 / 3)));
    expect(cornerClearPx(47, 2)).toBe(0); // an iPhone's notch inset already keeps it clear
    expect(cornerClearPx(SCREEN_CORNER_CSS, 2)).toBe(0);
    expect(cornerClearPx(10, 2)).toBe(3);
    expect(cornerClearPx(Number.NaN, 2)).toBe(SCREEN_CORNER_CSS / 2);
  });

  it('moves the lives and the level right together, the block left, and leaves the score centred', () => {
    const plain = topBarLayout(394, 3, 24);
    const clear = topBarLayout(394, 3, 24, 8, 30);
    expect(clear.lives).toEqual([8, 17, 26]);
    expect(clear.levelX - (clear.lives[0] ?? 0)).toBe(plain.levelX - (plain.lives[0] ?? 0));
    expect(clear.blockEnd).toBe(394 - 30 - 4);
    expect(clear.scoreX).toBe(plain.scoreX);
    // A clearance smaller than what is kept already changes nothing.
    expect(topBarLayout(394, 3, 24, 2, 10)).toEqual(plain);
  });

  it('on the Pixel 7 turned round (cutout on the right, 2.18 CSS px per art px) the first life is 16 CSS px from the glass\'s edge', () => {
    const k = 6 / 2.75;
    const bar = topBarLayout(375, 3, 24, cornerClearPx(0, k));
    expect((bar.lives[0] ?? 0) * k).toBeGreaterThanOrEqual(SCREEN_CORNER_CSS);
  });
});

describe('helpers', () => {
  it('the life row of three icons is 26 px wide', () => {
    expect(livesRowPx(3)).toBe(26);
    expect(livesRowPx(0)).toBe(0);
  });

  it('a new model shows nothing held and no card', () => {
    expect(newHudModel()).toEqual({
      lives: 0,
      maxLives: 0,
      levelNumber: 1,
      score: 0,
      hasTrophy: false,
      hasBlaster: false,
      hasThruster: false,
      fuelPips: 0,
      intro: null,
      exiting: false,
    });
  });
});

describe('FrameClock (the HUD clocks)', () => {
  const FRAME = 1000 / 60;

  it('turns rendered frames into whole 60 Hz frames, carrying the part frame', () => {
    const clock = new FrameClock();
    expect(clock.advance(FRAME, false)).toBe(1);
    expect(clock.advance(FRAME / 2, false)).toBe(0);
    expect(clock.advance(FRAME / 2, false)).toBe(1);
    expect(clock.advance(FRAME * 3, false)).toBe(3);
    expect(clock.advance(FRAME / 2, false) + clock.advance(FRAME / 2, false)).toBe(1); // 120 Hz: one frame every two
  });

  it('lets no frame pass while held (the pause menu), and banks none to catch up with afterwards', () => {
    const clock = new FrameClock();
    clock.advance(FRAME * 0.9, false);
    let passed = 0;
    for (let i = 0; i < 100; i++) passed += clock.advance(FRAME, true);
    expect(passed).toBe(0);
    // On resume the clocks go on from where they stood: the 0.9 frame carried before the pause is dropped.
    expect(clock.advance(FRAME * 0.5, false)).toBe(0);
    expect(clock.advance(FRAME * 0.5, false)).toBe(1);
  });

  it('a toast of 90 frames still has its 85 frames left after a pause of any length', () => {
    const clock = new FrameClock();
    let left = 90;
    for (let i = 0; i < 5; i++) left -= clock.advance(FRAME, false);
    for (let i = 0; i < 600; i++) left -= clock.advance(FRAME, true);
    expect(left).toBe(85);
  });

  it('ignores a zero, negative or broken delta', () => {
    const clock = new FrameClock();
    expect(clock.advance(0, false)).toBe(0);
    expect(clock.advance(-50, false)).toBe(0);
    expect(clock.advance(Number.NaN, false)).toBe(0);
    expect(clock.advance(FRAME, false)).toBe(1);
  });
});
