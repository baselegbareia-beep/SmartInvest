import { describe, expect, it } from 'vitest';

import { levelFromRows } from '../core/testkit';

import {
  EMBER_EVERY_TICKS,
  FallTracker,
  FlashTimer,
  POPUP_FRAMES,
  POPUP_H,
  POPUP_RISE_PX,
  PopupBoard,
  ShakeTimer,
  emberDue,
  fireCells,
  popupAnchor,
  popupClampY,
  popupRise,
} from './fxModel';
import { POPUP_TOP, POPUP_TOP_UNDER_TOAST, STRIP_H, TOAST_BAND_BOTTOM } from './hudModel';

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

describe('score pop-ups stay out of the top bar and the toast (the route watch: "+10" over the score, "+100" through the toast)', () => {
  it('a pop-up that would rise above POPUP_TOP is held there; lower down it rises freely', () => {
    expect(POPUP_TOP).toBeGreaterThanOrEqual(STRIP_H);
    expect(POPUP_TOP_UNDER_TOAST).toBeGreaterThanOrEqual(TOAST_BAND_BOTTOM);
    const camY = 100;
    // Taken 20 px from the top of the view: it would appear at view y 4 and rise to -8.
    for (let age = 0; age <= POPUP_FRAMES; age++) {
      const y = popupClampY(camY + 4 - popupRise(age), camY, POPUP_TOP);
      expect(y - camY, `age ${age}`).toBe(POPUP_TOP);
    }
    // While the toast shows: below its band.
    expect(popupClampY(camY + 20, camY, POPUP_TOP_UNDER_TOAST) - camY).toBe(POPUP_TOP_UNDER_TOAST);
    // Well inside the view: untouched.
    expect(popupClampY(camY + 90, camY, POPUP_TOP_UNDER_TOAST)).toBe(camY + 90);
  });

  it('above what scored, or beside it on the side away from a hero rising through it', () => {
    const out = { x: 0, y: 0 };
    expect(popupAnchor(200, 100, 16, false, 1, 17, out)).toEqual({ x: 200, y: 84 });
    // Rising and moving right: to the left of the crystal, at its height, clear of its 16 px tile.
    const left = { ...popupAnchor(200, 100, 16, true, 1, 17, out) };
    expect(left.x + 17 / 2).toBeLessThanOrEqual(200 - 8);
    expect(left.y).toBeGreaterThan(84);
    // Moving left: to the right.
    const right = { ...popupAnchor(200, 100, 16, true, -1, 17, out) };
    expect(right.x - 17 / 2).toBeGreaterThanOrEqual(200 + 8);
  });
});

describe('the pop-up board: never on each other, on the hero, on the score or on the toast (the re-check: "1+100" across the hero at the cog)', () => {
  type Box = { x: number; y: number; w: number; h: number };
  const meet = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const boxes = (board: PopupBoard): Box[] => board.shown().map((p) => ({ x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H }));
  /** Every frame from now until every pop-up is gone: placed, then checked against the rules. */
  const watch = (board: PopupBoard, camY: number, toastUp: boolean, heroAt: (frame: number) => Box): string[] => {
    const faults: string[] = [];
    for (let f = 0; f < POPUP_FRAMES + 2; f++) {
      board.advance(1);
      const hero = heroAt(f);
      board.place(camY, toastUp, hero);
      const shown = boxes(board);
      shown.forEach((a, i) => {
        if (meet(a, hero)) faults.push(`frame ${f}: ${JSON.stringify(a)} on the hero ${JSON.stringify(hero)}`);
        if (a.y - camY < (toastUp ? POPUP_TOP_UNDER_TOAST : POPUP_TOP)) faults.push(`frame ${f}: ${JSON.stringify(a)} in the bar`);
        shown.slice(i + 1).forEach((b) => {
          if (meet(a, b)) faults.push(`frame ${f}: ${JSON.stringify(a)} on ${JSON.stringify(b)}`);
        });
      });
    }
    return faults;
  };

  it("at the cog (levels 1 and 2 on the 568 x 320 phone): a crystal's +10 and the cog's +100 under the toast's band are drawn apart and off the hero", () => {
    // The hero high in the view (his head at view y 22, the toast's band ends at 26), the cog at his chest, a crystal
    // taken four frames before beside it.
    const camY = 1000;
    const hero = { x: 100, y: camY + 22, w: 16, h: 16 };
    const board = new PopupBoard(false);
    board.spawn(17, 112, camY + 14, camY, false);
    for (let f = 0; f < 4; f++) {
      board.advance(1);
      board.place(camY, false, hero);
    }
    board.spawn(23, 108, camY + 14, camY, true);
    expect(watch(board, camY, true, () => hero)).toEqual([]);
  });

  it('a hero jumping up through his own +10 never covers it: it steps aside, then goes back to rising from its place', () => {
    const camY = 0;
    const board = new PopupBoard(false);
    board.spawn(17, 108, 80, camY, false);
    // He stands under it, then rises 5, 4, 3 ... px a frame into it.
    const heroAt = (f: number): Box => ({ x: 100, y: 96 - Math.max(0, f * 5 - (f * (f - 1)) / 4), w: 16, h: 16 });
    expect(watch(board, camY, false, heroAt)).toEqual([]);
  });

  it('under reduced motion a pop-up stays where it was first drawn (placed off the hero when it appears), however he moves after', () => {
    const camY = 0;
    const board = new PopupBoard(true);
    board.spawn(17, 108, 80, camY, false);
    board.place(camY, false, { x: 100, y: 90, w: 16, h: 16 });
    const first = board.shown().map((p) => ({ x: p.drawX, y: p.drawY }));
    expect(first[0]?.y, 'off the hero from the start').toBeLessThanOrEqual(90 - POPUP_H);
    for (let f = 0; f < POPUP_FRAMES - 1; f++) {
      board.advance(1);
      board.place(camY, false, { x: 100 + f, y: 96 - f, w: 16, h: 16 });
      expect(board.shown().map((p) => ({ x: p.drawX, y: p.drawY })), `frame ${f}`).toEqual(first);
    }
  });

  it('over random moments: never on each other, on the hero, above POPUP_TOP, nor above the toast band while it shows', () => {
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 400; trial++) {
      const camY = Math.floor(rnd() * 500);
      const toastUp = rnd() < 0.5;
      const board = new PopupBoard(rnd() < 0.2);
      const hero = { x: 40 + Math.floor(rnd() * 200), y: camY + 20 + Math.floor(rnd() * 120), w: 16, h: 16 };
      const n = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const w = rnd() < 0.5 ? 17 : 23;
        board.spawn(w, hero.x + 8 + Math.floor(rnd() * 48) - 24, hero.y + Math.floor(rnd() * 40) - 30, camY, toastUp);
        const gap = Math.floor(rnd() * 6);
        for (let f = 0; f < gap; f++) {
          board.advance(1);
          board.place(camY, toastUp, hero);
        }
      }
      expect(watch(board, camY, toastUp, () => hero), `trial ${trial}`).toEqual([]);
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
