import { describe, expect, it } from 'vitest';

import { REFERENCE_TUNING, levelFromRows } from '../core/testkit';

import {
  EMBER_EVERY_TICKS,
  FallTracker,
  FlashTimer,
  POPUP_FRAMES,
  POPUP_H,
  POPUP_HEAD_PX,
  POPUP_MIN_FRAMES,
  POPUP_POOL,
  POPUP_RISE_PX,
  PopupBoard,
  ShakeTimer,
  emberDue,
  fireCells,
  heroSweep,
  popupAnchor,
  popupClampY,
  popupRise,
} from './fxModel';
import type { HeroMotion } from './fxModel';
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

  it('a hero jumping up through his own +10 never covers it: it steps aside and rises on from there', () => {
    const camY = 0;
    const board = new PopupBoard(false);
    board.spawn(17, 108, 80, camY, false);
    // He stands under it, then rises 5, 4, 3 ... px a frame into it.
    const heroAt = (f: number): Box => ({ x: 100, y: 96 - Math.max(0, f * 5 - (f * (f - 1)) / 4), w: 16, h: 16 });
    expect(watch(board, camY, false, heroAt)).toEqual([]);
  });

  /**
   * Under reduced motion: `heroAt(f)` and `motion(f)` give the hero on each frame (f = 0 when the pop-up appears); every
   * frame is placed with where he is going (`heroSweep`). Answers each pop-up's frames shown, its moves (frame and px),
   * and the faults: on him, on another one.
   */
  const stillRun = (board: PopupBoard, heroAt: (f: number) => Box, motion: (f: number) => HeroMotion, frames: number) => {
    const shownFor = new Map<number, number>();
    const moves: string[] = [];
    const faults: string[] = [];
    const last = new Map<number, { x: number; y: number }>();
    for (let f = 0; f < frames; f++) {
      if (f > 0) board.advance(1);
      const hero = heroAt(f);
      board.place(0, false, hero, heroSweep(hero, motion(f), FALL, POPUP_MIN_FRAMES, POPUP_HEAD_PX, { x: 0, y: 0, w: 0, h: 0 }));
      const now = board.shown();
      now.forEach((p, i) => {
        const b = { x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H };
        shownFor.set(p.seq, (shownFor.get(p.seq) ?? 0) + 1);
        if (meet(b, hero)) faults.push(`frame ${f}: #${p.seq} on the hero`);
        for (const q of now.slice(i + 1)) if (meet(b, { x: q.drawX, y: q.drawY, w: q.w, h: POPUP_H })) faults.push(`frame ${f}: #${p.seq} on #${q.seq}`);
        const was = last.get(p.seq);
        if (was && (was.x !== p.drawX || was.y !== p.drawY)) moves.push(`frame ${f}: #${p.seq} ${p.drawX - was.x},${p.drawY - was.y}`);
        last.set(p.seq, { x: p.drawX, y: p.drawY });
      });
    }
    return { shownFor: [...shownFor.values()], moves, faults };
  };
  const FALL = { rise: REFERENCE_TUNING.gravity.gravityRise, fall: REFERENCE_TUNING.gravity.gravityFall, maxFall: REFERENCE_TUNING.gravity.maxFallSpeed };
  const walking = (vx: number): HeroMotion => ({ vx, vy: 0, airborne: false });

  it("under reduced motion a pop-up appears off the way of a hero walking at 1.5 px a frame, and is not taken down: it stays, still (level 1, tick 397: '+10' against his side, gone the next frame)", () => {
    const board = new PopupBoard(true);
    // He walks left on his row; a crystal just taken puts its +10 right against his left side, at his head's height.
    board.spawn(17, 468, 56, 0, false);
    const hero = (f: number): Box => ({ x: 477 - Math.floor(1.5 * f), y: 59, w: 16, h: 16 });
    const run = stillRun(board, hero, () => walking(-1.5), POPUP_FRAMES + 1);
    expect(run.faults).toEqual([]);
    expect(run.shownFor, 'frames shown: all of its life').toEqual([POPUP_FRAMES]);
    expect(run.moves, 'it never moves').toEqual([]);
  });

  it("under reduced motion a pop-up does not appear under a falling hero's feet (level 1, tick 653: gone the next frame)", () => {
    const board = new PopupBoard(true);
    // He falls straight down, faster each frame; the +10 would appear right under his feet.
    board.spawn(17, 120, 79, 0, false);
    let y = 63;
    let vy = 2;
    const track: { y: number; vy: number }[] = [];
    for (let f = 0; f <= POPUP_FRAMES; f++) {
      track.push({ y: Math.floor(y), vy });
      vy = Math.min(vy + FALL.fall, FALL.maxFall);
      y += vy;
    }
    const run = stillRun(
      board,
      (f) => ({ x: 113, y: track[f]?.y ?? 0, w: 16, h: 16 }),
      (f) => ({ vx: 0, vy: track[f]?.vy ?? 0, airborne: true }),
      POPUP_FRAMES + 1,
    );
    expect(run.faults).toEqual([]);
    expect(run.shownFor).toEqual([POPUP_FRAMES]);
    expect(run.moves).toEqual([]);
  });

  it('under reduced motion a pop-up the hero comes onto before it has shown POPUP_MIN_FRAMES frames (he turned) moves once, at once, out of his way; one he comes onto later is taken down', () => {
    expect(POPUP_MIN_FRAMES, 'a third of a second at least, and less than a whole life').toBeGreaterThanOrEqual(20);
    expect(POPUP_MIN_FRAMES).toBeLessThan(POPUP_FRAMES);
    // He walks right, away from a +10 placed behind him, then turns at frame 4 and walks back through it.
    const turnAt = 4;
    const xAt = (f: number): number => (f <= turnAt ? 100 + Math.floor(1.5 * f) : 106 - Math.floor(1.5 * (f - turnAt)));
    const young = new PopupBoard(true);
    young.spawn(17, 90, 60, 0, false);
    const a = stillRun(young, (f) => ({ x: xAt(f), y: 60, w: 16, h: 16 }), (f) => walking(f < turnAt ? 1.5 : -1.5), POPUP_FRAMES + 1);
    expect(a.faults).toEqual([]);
    expect(a.shownFor, 'shown all its life').toEqual([POPUP_FRAMES]);
    expect(a.moves.length, `one move: ${a.moves.join('; ')}`).toBe(1);
    // The same turn after the pop-up has shown POPUP_MIN_FRAMES frames: taken down when he reaches it.
    const late = POPUP_MIN_FRAMES + 2;
    const xLate = (f: number): number => (f <= late ? 100 : 100 - Math.floor(1.5 * (f - late)));
    const old = new PopupBoard(true);
    old.spawn(17, 90, 60, 0, false);
    const b = stillRun(old, (f) => ({ x: xLate(f), y: 60, w: 16, h: 16 }), (f) => (f < late ? walking(0) : walking(-1.5)), POPUP_FRAMES + 1);
    expect(b.faults).toEqual([]);
    expect(b.moves).toEqual([]);
    expect(b.shownFor[0], 'taken down when he reaches it, after it was read').toBeGreaterThanOrEqual(POPUP_MIN_FRAMES);
    expect(b.shownFor[0]).toBeLessThan(POPUP_FRAMES);
  });

  it('under reduced motion a young pop-up moves each time he comes onto it before POPUP_MIN_FRAMES, never left on him nor taken down early (twice here; on the proofs at most once, src/shell/routeView.test.ts)', () => {
    // He walks right past a +10, turns back at frame 2, jumps at 4 and turns right again at 6: it moves out of his way at
    // frame 4 to just behind him, where his second turn brings him onto it again.
    const heroes: Box[] = [];
    const motions: HeroMotion[] = [];
    let x = 100;
    let y = 60;
    let vx = 1.5;
    let vy = 0;
    let air = false;
    for (let f = 0; f <= POPUP_FRAMES; f++) {
      if (f === 2 || f === 6) vx = -vx;
      if (f === 4) {
        vy = -5;
        air = true;
      }
      if (f > 0) {
        x += vx;
        if (air) {
          vy = Math.min(vy + (vy < 0 ? FALL.rise : FALL.fall), FALL.maxFall);
          y += vy;
          if (y >= 60) {
            y = 60;
            vy = 0;
            air = false;
          }
        }
      }
      heroes.push({ x: Math.floor(x), y: Math.floor(y), w: 16, h: 16 });
      motions.push({ vx, vy, airborne: air });
    }
    const board = new PopupBoard(true);
    board.spawn(17, 90, 50, 0, false);
    const run = stillRun(board, (f) => heroes[f] as Box, (f) => motions[f] as HeroMotion, POPUP_FRAMES + 1);
    expect(run.faults).toEqual([]);
    expect(run.shownFor, 'shown all its life').toEqual([POPUP_FRAMES]);
    expect(run.moves.length, `two moves: ${run.moves.join('; ')}`).toBe(2);
  });

  it('under reduced motion, over random walks, turns and jumps: every pop-up shows POPUP_MIN_FRAMES frames or more, never on him or on another', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let moved = 0;
    let pops = 0;
    for (let trial = 0; trial < 300; trial++) {
      // A hero on a floor at y 200: he walks, turns and jumps at random moments; pop-ups appear by him now and then.
      const board = new PopupBoard(true);
      let x = 200;
      let y = 200;
      let vx = rnd() < 0.5 ? 1.5 : -1.5;
      let vy = 0;
      let air = false;
      const heroes: Box[] = [];
      const motions: HeroMotion[] = [];
      const spawns = new Map<number, { x: number; y: number }>();
      for (let f = 0; f < 90; f++) {
        if (rnd() < 0.05) vx = -vx;
        if (!air && rnd() < 0.04) {
          vy = -5;
          air = true;
        }
        if (air) {
          vy = Math.min(vy + (vy < 0 ? FALL.rise : FALL.fall), FALL.maxFall);
          y += vy;
          if (y >= 200) {
            y = 200;
            vy = 0;
            air = false;
          }
        }
        x += vx;
        heroes.push({ x: Math.floor(x), y: Math.floor(y), w: 16, h: 16 });
        motions.push({ vx, vy, airborne: air });
        if (f < 60 && rnd() < 0.08) spawns.set(f, { x: Math.floor(x) + 8 + Math.floor(rnd() * 24) - 12, y: Math.floor(y) - Math.floor(rnd() * 20) });
      }
      const shownFor = new Map<number, number>();
      const last = new Map<number, { x: number; y: number }>();
      for (let f = 0; f < 90; f++) {
        if (f > 0) board.advance(1);
        const s = spawns.get(f);
        // (Never more than the pool holds: a seventh would reuse the oldest's slot and cut it short.)
        if (s && board.shown().length < POPUP_POOL) board.spawn(17, s.x, s.y, 0, false);
        const hero = heroes[f] as Box;
        board.place(0, false, hero, heroSweep(hero, motions[f] as HeroMotion, FALL, POPUP_MIN_FRAMES, POPUP_HEAD_PX, { x: 0, y: 0, w: 0, h: 0 }));
        const now = board.shown();
        now.forEach((p, i) => {
          const b = { x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H };
          expect(meet(b, hero), `trial ${trial} frame ${f}: on the hero`).toBe(false);
          for (const q of now.slice(i + 1)) expect(meet(b, { x: q.drawX, y: q.drawY, w: q.w, h: POPUP_H }), `trial ${trial} frame ${f}: on another`).toBe(false);
          shownFor.set(p.seq, (shownFor.get(p.seq) ?? 0) + 1);
          const was = last.get(p.seq);
          if (was && (was.x !== p.drawX || was.y !== p.drawY)) moved += 1;
          last.set(p.seq, { x: p.drawX, y: p.drawY });
        });
      }
      // Each appeared by frame 59 of 90: all of its life lies in the trial.
      for (const [seq, n] of shownFor) {
        pops += 1;
        expect(n, `trial ${trial}: #${seq} shown`).toBeGreaterThanOrEqual(POPUP_MIN_FRAMES);
      }
    }
    expect(pops, 'pop-ups seen through').toBeGreaterThan(300);
    // A quarter of a move per pop-up here (he turns or jumps at random every 20 frames or so; a few move twice, as in
    // the test above); placed without looking ahead, 0.77 moves a pop-up.
    expect(moved / pops, 'moves per pop-up: few of them move').toBeLessThan(0.35);
  });

  it("never past the view's side edges: a pop-up by a hero against the view's right edge is drawn inside it (120 Hz, level 4: 3 px past it)", () => {
    // The view is 320 px wide from x 160; he stands at its right edge, and a +10 appears on him.
    const view = { x: 160, w: 320 };
    for (const reduced of [false, true]) {
      const board = new PopupBoard(reduced);
      board.spawn(17, 456, 140, 0, false);
      for (let f = 0; f < POPUP_FRAMES; f++) {
        if (f > 0) board.advance(1);
        // He sinks 1 px a frame, walking left: his right side is 16 px from the view's right edge.
        const hero = { x: 448 - (f >> 1), y: 138 + f, w: 16, h: 16 };
        board.place(0, false, hero, null, view);
        for (const p of board.shown()) {
          expect(p.drawX, `reduced ${reduced}, frame ${f}: the left edge`).toBeGreaterThanOrEqual(view.x);
          expect(p.drawX + p.w, `reduced ${reduced}, frame ${f}: the right edge`).toBeLessThanOrEqual(view.x + view.w);
          expect(meet({ x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H }, hero), `reduced ${reduced}, frame ${f}: on him`).toBe(false);
        }
      }
    }
    // A pop-up the view scrolls past is held at the edge, like the top bar holds one.
    const board = new PopupBoard(false);
    board.spawn(17, 170, 100, 0, false);
    board.place(0, false, null, null, { x: 160, w: 320 });
    board.advance(1);
    board.place(0, false, null, null, { x: 175, w: 320 });
    expect(board.shown()[0]?.drawX).toBe(175);
  });

  /** Frames on which a pop-up moved `min` px or more (across plus up or down) since the frame before; and flips round him. */
  const motion = (board: PopupBoard, heroAt: (frame: number) => Box, frames: number): { jumps: number; flips: number; most: number; mostX: number; mostY: number; faults: string[] } => {
    const last = new Map<number, { x: number; y: number; vx: number; vy: number }>();
    let jumps = 0;
    let flips = 0;
    let most = 0;
    let mostX = 0;
    let mostY = 0;
    const faults: string[] = [];
    for (let f = 0; f < frames; f++) {
      board.advance(1);
      const hero = heroAt(f);
      board.place(0, false, hero);
      for (const p of board.shown()) {
        if (meet({ x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H }, hero)) faults.push(`frame ${f}: on the hero`);
        const q = last.get(p.seq);
        const vx = q ? p.drawX - q.x : 0;
        const vy = q ? p.drawY - q.y : 0;
        const d = Math.abs(vx) + Math.abs(vy);
        most = Math.max(most, d);
        mostX = Math.max(mostX, Math.abs(vx));
        mostY = Math.max(mostY, Math.abs(vy));
        if (d >= 3) jumps += 1;
        if (q && d >= 10 && Math.abs(q.vx) + Math.abs(q.vy) >= 10 && vx * q.vx + vy * q.vy < 0) flips += 1;
        last.set(p.seq, { x: p.drawX, y: p.drawY, vx, vy });
      }
    }
    return { jumps, flips, most, mostX, mostY, faults };
  };

  it('a hero walking into a pop-up beside him pushes it along at his pace: never more than 2 px across a frame, rising as before, never on him (it hopped round him)', () => {
    const board = new PopupBoard(false);
    // A +10 just right of his head; he walks right at 1.5 px a frame, his sprite drawn on whole pixels.
    board.spawn(17, 126, 92, 0, false);
    const m = motion(board, (f) => ({ x: 100 + Math.floor(1.5 * (f + 1)), y: 96, w: 16, h: 16 }), POPUP_FRAMES - 1);
    expect(m.faults).toEqual([]);
    expect(m.mostX, 'the largest move across in one frame, px: his pace').toBeLessThanOrEqual(2);
    expect(m.mostY, 'the largest move up or down in one frame, px: its rise').toBeLessThanOrEqual(1);
  });

  it("a hero hopping along under two pop-ups (level 5's '+10' and '+50', 568 x 320) makes each step aside at most once, and none flips round him", () => {
    // As the route watch's re-check saw it on level 5, ticks 815 to 840: he walks right at 1.5 px a frame and hops (5 px a
    // frame up, then down); the '+50' went left and right of him on alternate frames, 36 px each time.
    const board = new PopupBoard(false);
    board.spawn(17, 792, 152, 79, false);
    board.advance(1);
    board.place(79, false, { x: 769, y: 160, w: 16, h: 16 });
    board.spawn(17, 793, 143, 79, false);
    const hop = [0, 0, 0, 0, 0, 0, -5, -10, -15, -18, -18, -17, -16, -14, -12, -9, -6, -3, 0, 0, 0, -5, -10, -15, -18, -18, -17];
    const m = motion(board, (f) => ({ x: 770 + Math.floor(1.5 * (f + 1)), y: 160 + (hop[f] ?? 0), w: 16, h: 16 }), POPUP_FRAMES - 2);
    expect(m.faults).toEqual([]);
    expect(m.flips, 'flips round him').toBe(0);
    expect(m.jumps, 'moves of 3 px or more in one frame, both pop-ups').toBeLessThanOrEqual(2);
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
