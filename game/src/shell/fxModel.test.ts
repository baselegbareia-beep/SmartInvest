import { describe, expect, it } from 'vitest';

import { levelFromRows } from '../core/testkit';

import {
  EMBER_EVERY_TICKS,
  FallTracker,
  FlashTimer,
  POPUP_FRAMES,
  POPUP_RISE_PX,
  ShakeTimer,
  emberDue,
  fireCells,
  popupRise,
} from './fxModel';

describe('score pop-ups', () => {
  it('rise POPUP_RISE_PX whole pixels over POPUP_FRAMES frames, and no further', () => {
    expect(popupRise(0)).toBe(0);
    expect(popupRise(POPUP_FRAMES / 2)).toBe(POPUP_RISE_PX / 2);
    expect(popupRise(POPUP_FRAMES)).toBe(POPUP_RISE_PX);
    expect(popupRise(POPUP_FRAMES + 10)).toBe(POPUP_RISE_PX);
    for (let age = 0; age <= POPUP_FRAMES; age++) {
      expect(Number.isInteger(popupRise(age))).toBe(true);
      if (age > 0) expect(popupRise(age)).toBeGreaterThanOrEqual(popupRise(age - 1));
    }
  });
});

describe('embers', () => {
  it('each fire column throws one ember every EMBER_EVERY_TICKS ticks, columns at different moments', () => {
    for (const col of [0, 3, 11]) {
      const due = Array.from({ length: EMBER_EVERY_TICKS * 3 }, (_, t) => t).filter((t) => emberDue(t, col));
      expect(due).toHaveLength(3);
      expect((due[1] ?? 0) - (due[0] ?? 0)).toBe(EMBER_EVERY_TICKS);
    }
    const first = (col: number): number => Array.from({ length: EMBER_EVERY_TICKS }, (_, t) => t).find((t) => emberDue(t, col)) ?? -1;
    expect(first(4)).not.toBe(first(5));
  });

  it('finds every fire cell of a level', () => {
    const level = levelFromRows(['......', 'P.FFTD', '######']);
    expect(Array.from(fireCells(level))).toEqual([2, 1, 3, 1]);
    expect(fireCells(levelFromRows(['P.TD', '####']))).toHaveLength(0);
  });
});

describe('the screen flash', () => {
  it('starts at its alpha and fades to nothing over its frames', () => {
    const f = new FlashTimer();
    expect(f.alpha).toBe(0);
    f.start(0.2, 4);
    expect(f.alpha).toBeCloseTo(0.2);
    f.advance(1);
    expect(f.alpha).toBeCloseTo(0.15);
    f.advance(0); // a frame of a fast display with no new tick
    expect(f.alpha).toBeCloseTo(0.15);
    f.advance(3);
    expect(f.alpha).toBe(0);
  });
});

describe('the shake', () => {
  it('offsets by whole pixels up to its strength, then stops', () => {
    const s = new ShakeTimer();
    s.start(2, 3);
    let r = 0;
    const random = (): number => {
      r = (r + 0.37) % 1;
      return r;
    };
    for (let i = 0; i < 2; i++) {
      s.advance(1, random);
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(2);
    }
    s.advance(1, random);
    expect([s.x, s.y]).toEqual([0, 0]);
    expect(s.active).toBe(false);
  });

  it('reaches its full strength at the extremes of the random number', () => {
    const s = new ShakeTimer();
    s.start(2, 10);
    s.advance(1, () => 0);
    expect([s.x, s.y]).toEqual([-2, -2]);
    s.advance(1, () => 0.999999);
    expect([s.x, s.y]).toEqual([2, 2]);
  });

  it('holds its offset on frames without a tick, so it runs at the game pace on any display', () => {
    const s = new ShakeTimer();
    s.start(1, 2);
    s.advance(1, () => 0);
    s.advance(0, () => 0.99);
    expect(s.x).toBe(-1);
  });

  it('a second shake keeps the longer length and the stronger strength', () => {
    const s = new ShakeTimer();
    s.start(1, 10);
    s.start(2, 2);
    s.advance(5, () => 0);
    expect(s.x).toBe(-2);
    expect(s.active).toBe(true);
    s.advance(5, () => 0);
    expect(s.active).toBe(false);
  });

  it('ignores a shake of nothing', () => {
    const s = new ShakeTimer();
    s.start(0, 10);
    s.start(2, 0);
    expect(s.active).toBe(false);
  });
});

describe('the height of a fall', () => {
  it('is measured from the highest feet line since leaving the ground', () => {
    const f = new FallTracker();
    f.observe(true, true, 200);
    f.observe(true, false, 190); // jumped
    f.observe(true, false, 150); // apex
    f.observe(true, false, 170);
    f.observe(true, true, 280); // the landing tick: the state says grounded, the event follows
    expect(f.landed(280)).toBe(130);
    expect(f.landed(280)).toBe(0); // read once
  });

  it('forgets the climb when the world stops (death, level exit)', () => {
    const f = new FallTracker();
    f.observe(true, false, 100);
    f.observe(false, false, 100);
    expect(f.landed(300)).toBe(0);
  });
});
