import { describe, expect, it } from 'vitest';

import { holdReady, step } from '../core/game';
import { IN, levelFromRows, playingGame } from '../core/testkit';
import { SUB_SHIFT, TILE_PX } from '../core/types';
import type { CameraTuning } from '../core/types';
import { TUNING } from '../tuning';

import { NO_PAD, cameraTarget, feetAnchor, frameShift, levelSize, padReach, riseLookMax, snapCamera, stepCamera } from './camera';
import type { CameraState, CameraTarget, FrameScene, PadButtonsOnView, PadReach, Size } from './camera';
import { STRIP_H } from './hudModel';

/**
 * The rules of docs/ARCHITECTURE.md 11.4 on a frozen copy of the camera numbers the game shipped with,
 * written against the fields (`CAM.camDeadzoneHalfW`, not 12) so they read as the rule. A change to
 * src/tuning.ts cannot break them; the last block checks the live numbers for sanity.
 */
const CAM: CameraTuning = Object.freeze({
  camLookAheadPx: 32,
  camLookShiftSpeed: 0.75,
  camDeadzoneHalfW: 12,
  camAnchorY: 0.6,
  camVerticalEase: 0.12,
  camAirBandTop: 0.15,
  camAirBandBottom: 0.78,
  camPassGlideSpeed: 3,
  camPadClearPx: 16,
  camRiseBandTop: 0.45,
  camRiseLookSpeed: 1.5,
  camVerticalMaxStep: 4,
  camFrameDownPx: 32,
  camFrameUpPx: 16,
});

const VIEW: Size = { w: 320, h: 180 };
const BIG: Size = { w: 100 * TILE_PX, h: 40 * TILE_PX };

const target = (x: number, feetY: number, more: Partial<CameraTarget> = {}): CameraTarget => ({
  x,
  feetY,
  facing: 1,
  moving: false,
  onGround: true,
  running: true,
  ...more,
});

/** Where the hero's middle and feet are on screen. */
const onScreen = (cam: CameraState, t: CameraTarget): { x: number; y: number } => ({
  x: t.x - cam.scrollX,
  y: t.feetY - cam.scrollY,
});

describe('snapCamera: the resting position', () => {
  it('puts the hero camLookAheadPx behind the middle, on the side away from where he faces, and his feet on camAnchorY', () => {
    const right = target(800, 320);
    const cam = snapCamera(right, VIEW, BIG, CAM);
    expect(cam.look).toBe(CAM.camLookAheadPx);
    expect(onScreen(cam, right)).toEqual({ x: VIEW.w / 2 - CAM.camLookAheadPx, y: Math.round(CAM.camAnchorY * VIEW.h) });

    const left = target(800, 320, { facing: -1 });
    const camLeft = snapCamera(left, VIEW, BIG, CAM);
    expect(camLeft.look).toBe(-CAM.camLookAheadPx);
    expect(onScreen(camLeft, left).x).toBe(VIEW.w / 2 + CAM.camLookAheadPx);
  });

  it('stops at the level edges', () => {
    expect(snapCamera(target(20, 30), VIEW, BIG, CAM)).toMatchObject({ x: 0, y: 0, scrollX: 0, scrollY: 0 });
    expect(snapCamera(target(BIG.w - 5, BIG.h), VIEW, BIG, CAM)).toMatchObject({
      x: BIG.w - VIEW.w,
      y: BIG.h - VIEW.h,
      scrollX: BIG.w - VIEW.w,
      scrollY: BIG.h - VIEW.h,
    });
  });

  it('centres a room smaller than the view, on each axis separately, on a whole pixel', () => {
    const room: Size = { w: 10 * TILE_PX, h: 5 * TILE_PX };
    expect(snapCamera(target(50, 60), VIEW, room, CAM)).toMatchObject({ scrollX: -80, scrollY: -50 });
    // An odd leftover: the odd pixel of border goes to the near side (left 87, right 86; top 54,
    // bottom 53), never a fractional scroll.
    const odd: Size = { w: 333, h: 187 };
    const centred = snapCamera(target(50, 60), odd, room, CAM);
    expect(centred).toMatchObject({ scrollX: -87, scrollY: -54 });
    const borders = { left: -centred.scrollX, right: odd.w - room.w + centred.scrollX, top: -centred.scrollY, bottom: odd.h - room.h + centred.scrollY };
    expect(borders).toEqual({ left: 87, right: 86, top: 54, bottom: 53 });
    // Wide but low: scrolls sideways, centred vertically.
    const corridor: Size = { w: 60 * TILE_PX, h: 3 * TILE_PX };
    const cam = snapCamera(target(500, 40), VIEW, corridor, CAM);
    expect(cam.scrollX).toBe(500 - (VIEW.w / 2 - CAM.camLookAheadPx));
    expect(cam.scrollY).toBe(Math.floor((corridor.h - VIEW.h) / 2));
    // Exactly the view's size: nothing to scroll.
    expect(snapCamera(target(50, 60), VIEW, VIEW, CAM)).toMatchObject({ scrollX: 0, scrollY: 0 });
  });
});

describe('stepCamera: look-ahead', () => {
  it('after a turn, slides to the other side at camLookShiftSpeed per tick while the hero moves, then stays', () => {
    let cam = snapCamera(target(800, 320), VIEW, BIG, CAM);
    const looks: number[] = [];
    for (let i = 0; i < 200; i++) {
      cam = stepCamera(cam, target(800, 320, { facing: -1, moving: true }), VIEW, BIG, CAM);
      looks.push(cam.look);
    }
    const ticks = Math.ceil((2 * CAM.camLookAheadPx) / CAM.camLookShiftSpeed);
    expect(looks[0]).toBeCloseTo(CAM.camLookAheadPx - CAM.camLookShiftSpeed, 9);
    expect(looks[ticks - 2]).toBeGreaterThan(-CAM.camLookAheadPx);
    expect(looks[ticks - 1]).toBe(-CAM.camLookAheadPx);
    expect(looks.slice(ticks - 1).every((look) => look === -CAM.camLookAheadPx)).toBe(true);
    for (let i = 1; i < looks.length; i++) {
      const change = (looks[i - 1] ?? 0) - (looks[i] ?? 0);
      expect(change).toBeGreaterThanOrEqual(0);
      expect(change).toBeLessThanOrEqual(CAM.camLookShiftSpeed + 1e-9);
    }
  });

  it('turning on the spot does not swing the view', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    let cam = start;
    for (let i = 0; i < 60; i++) cam = stepCamera(cam, target(800, 320, { facing: -1, moving: false }), VIEW, BIG, CAM);
    expect(cam).toEqual(start);
  });
});

describe('stepCamera: horizontal dead zone', () => {
  it('lets the hero move camDeadzoneHalfW px either way before it follows', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    for (let dx = -CAM.camDeadzoneHalfW; dx <= CAM.camDeadzoneHalfW; dx++) {
      expect(stepCamera(start, target(800 + dx, 320), VIEW, BIG, CAM).x).toBe(start.x);
    }
    expect(stepCamera(start, target(800 + CAM.camDeadzoneHalfW + 1, 320), VIEW, BIG, CAM).x).toBe(start.x + 1);
    expect(stepCamera(start, target(800 - CAM.camDeadzoneHalfW - 1, 320), VIEW, BIG, CAM).x).toBe(start.x - 1);
  });

  it('beyond the dead zone moves by exactly the overshoot, with no smoothing', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    for (const dx of [13, 20, 47, 200, -13, -30, -150]) {
      const moved = stepCamera(start, target(800 + dx, 320), VIEW, BIG, CAM).x - start.x;
      expect(moved).toBe(dx - Math.sign(dx) * CAM.camDeadzoneHalfW);
    }
  });

  it('a hero running at 1.5 px per tick (drawn 1, 2, 1, 2 px) keeps one screen position once the camera follows: no shimmer', () => {
    let cam = snapCamera(target(800, 320), VIEW, BIG, CAM);
    let sub = 800 * 256;
    const screenX = new Set<number>();
    for (let tick = 0; tick < 300; tick++) {
      sub += 384;
      const t = target(sub >> 8, 320, { moving: true });
      cam = stepCamera(cam, t, VIEW, BIG, CAM);
      expect(Number.isInteger(cam.scrollX)).toBe(true);
      if (tick > 20) screenX.add(onScreen(cam, t).x);
    }
    expect([...screenX]).toEqual([VIEW.w / 2 - CAM.camLookAheadPx + CAM.camDeadzoneHalfW]);
  });
});

describe('stepCamera: vertical', () => {
  it('while standing, the feet ease toward camAnchorY by camVerticalEase of the distance left each tick', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    // He now stands two tiles higher.
    const higher = target(800, 288);
    const rest = higher.feetY - CAM.camAnchorY * VIEW.h;
    let cam = start;
    let left = start.y - rest;
    for (let i = 0; i < 80; i++) {
      cam = stepCamera(cam, higher, VIEW, BIG, CAM);
      left *= 1 - CAM.camVerticalEase;
      expect(cam.y - rest).toBeCloseTo(left, 9);
      expect(Number.isInteger(cam.scrollY)).toBe(true);
    }
    expect(onScreen(cam, higher).y).toBe(Math.round(CAM.camAnchorY * VIEW.h));
  });

  it('in the air holds still while the feet stay inside the band (its top measured from under the top bar\'s strip)', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    const top = Math.ceil(STRIP_H + CAM.camAirBandTop * VIEW.h);
    const bottom = Math.floor(CAM.camAirBandBottom * VIEW.h);
    let cam = start;
    // A jump: up to the top of the band and down to the bottom of it.
    for (let feetOnScreen = Math.round(CAM.camAnchorY * VIEW.h); feetOnScreen >= top; feetOnScreen--) {
      cam = stepCamera(cam, target(800, start.y + feetOnScreen, { onGround: false }), VIEW, BIG, CAM);
      expect(cam.y).toBe(start.y);
    }
    for (let feetOnScreen = top; feetOnScreen <= bottom; feetOnScreen++) {
      cam = stepCamera(cam, target(800, start.y + feetOnScreen, { onGround: false }), VIEW, BIG, CAM);
      expect(cam.y).toBe(start.y);
    }
  });

  it('in the air follows rigidly once the feet leave the band, above or below', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    let cam = start;
    // Flying up 3 px a tick: the feet stop at the top of the band and the view rises with him.
    let feet = 320;
    for (let i = 0; i < 40; i++) {
      feet -= 3;
      cam = stepCamera(cam, target(800, feet, { onGround: false }), VIEW, BIG, CAM);
      expect(feet - cam.y).toBeGreaterThanOrEqual(STRIP_H + CAM.camAirBandTop * VIEW.h - 1e-9);
    }
    expect(feet - cam.y).toBeCloseTo(STRIP_H + CAM.camAirBandTop * VIEW.h, 9);
    // Falling 4 px a tick: the feet sink to the bottom of the band and the view falls with him.
    for (let i = 0; i < 60; i++) {
      feet += 4;
      cam = stepCamera(cam, target(800, feet, { onGround: false }), VIEW, BIG, CAM);
      expect(feet - cam.y).toBeLessThanOrEqual(CAM.camAirBandBottom * VIEW.h + 1e-9);
    }
    expect(feet - cam.y).toBeCloseTo(CAM.camAirBandBottom * VIEW.h, 9);
  });

  it('a standing hero is never left outside the band, even right after the view changed size', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    const tall: Size = { w: 320, h: 400 };
    const cam = stepCamera(start, target(800, 320), tall, BIG, CAM);
    const feet = 320 - cam.y;
    expect(feet).toBeGreaterThanOrEqual(STRIP_H + CAM.camAirBandTop * tall.h - 1e-9);
    expect(feet).toBeLessThanOrEqual(CAM.camAirBandBottom * tall.h + 1e-9);
  });

  /** The mini fuel bar over a thrusting hero: 2 px tall, 3 px above his 16 px sprite (WorldView FUELBAR_H, FUELBAR_GAP). */
  const FUEL_BAR_ABOVE = 5;

  it("a hero flying up a shaft is drawn below the top bar's dark strip, his fuel bar too, with as much undimmed level above him as before the strip", () => {
    // The review's case: the strip (void at 70 %) darkened his hat and antenna whenever he rose to the top of the view.
    for (const h of [160, 167, 180, 187, 224]) {
      const view: Size = { w: 320, h };
      let feet = 600;
      let cam = snapCamera(target(800, feet), view, BIG, CAM);
      for (let i = 0; i < 150; i++) {
        feet -= 3;
        cam = stepCamera(cam, target(800, feet, { onGround: false }), view, BIG, CAM);
        const spriteTop = feet - TILE_PX - cam.scrollY;
        expect(spriteTop - FUEL_BAR_ABOVE, `view ${h} px tall, tick ${i}`).toBeGreaterThanOrEqual(STRIP_H);
      }
      // At the top of the band: the band's top lies camAirBandTop of the view below the strip, so the air above his
      // head that shows undimmed is what the whole band top showed before the strip was there.
      expect(feet - TILE_PX - cam.y - STRIP_H).toBeCloseTo(CAM.camAirBandTop * h - TILE_PX, 9);
    }
  });

  it('a full jump from rest on the real core stays inside the band on the smallest view: the view holds still', () => {
    // Fourteen rows of air over a deck with rock beneath, so the hero can rest on camAnchorY with no level edge near.
    const tall = levelFromRows([...Array.from({ length: 14 }, () => '.'.repeat(40)), '.P..........T.............D.............', ...Array.from({ length: 9 }, () => '#'.repeat(40))]);
    const smallest: Size = { w: 17 * TILE_PX, h: 10 * TILE_PX };
    for (const run of ['', 'R']) {
      const game = playingGame(tall);
      const level = levelSize(game.level);
      let cam = snapCamera(cameraTarget(game), smallest, level, CAM);
      const rest = cam.scrollY;
      let airborne = 0;
      let highest = Infinity;
      for (let tick = 0; tick < 90; tick++) {
        step(game, IN(`${run}J`), []);
        cam = stepCamera(cam, cameraTarget(game), smallest, level, CAM);
        if (!game.run.player.onGround) airborne += 1;
        highest = Math.min(highest, cameraTarget(game).feetY - cam.scrollY);
        expect(cam.scrollY, `${run || 'standing'} jump, tick ${tick}`).toBe(rest);
      }
      expect(airborne, 'he did jump').toBeGreaterThan(20);
      expect(highest, 'and rose more than three tiles on screen').toBeLessThan(CAM.camAnchorY * smallest.h - 3 * TILE_PX);
    }
  });
});

/** A small seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('stepCamera: bounds, over random walks', () => {
  it('never shows outside the level when the level is larger than the view, centres it when smaller, scrolls in whole pixels and keeps the hero in the picture', () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 300 && found.length === 0; seed++) {
      const random = seeded(seed);
      const int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
      const view: Size = { w: int(272, 480), h: int(160, 224) };
      const level = levelSize({ width: int(8, 64), height: int(4, 24) });
      let x = int(0, level.w);
      let feetY = int(0, level.h);
      let facing: 1 | -1 = 1;
      let t = target(x, feetY);
      let cam = snapCamera(t, view, level, CAM);
      for (let tick = 0; tick < 600; tick++) {
        const r = random();
        if (r < 0.02) {
          // A teleport somewhere else in the level (no snap: the camera must cope).
          x = int(0, level.w);
          feetY = int(0, level.h);
        } else {
          x = Math.min(level.w, Math.max(0, x + int(-3, 3)));
          feetY = Math.min(level.h, Math.max(0, feetY + int(-5, 5)));
        }
        if (random() < 0.05) facing = facing === 1 ? -1 : 1;
        t = target(x, feetY, { facing, moving: random() < 0.7, onGround: random() < 0.5 });
        cam = stepCamera(cam, t, view, level, CAM);

        const where = `seed ${seed} tick ${tick} view ${view.w}x${view.h} level ${level.w}x${level.h} ${JSON.stringify(cam)}`;
        if (!Number.isInteger(cam.scrollX) || !Number.isInteger(cam.scrollY)) found.push(`not whole pixels: ${where}`);
        for (const [scroll, exact, viewLen, levelLen, axis] of [
          [cam.scrollX, cam.x, view.w, level.w, 'x'],
          [cam.scrollY, cam.y, view.h, level.h, 'y'],
        ] as const) {
          if (levelLen >= viewLen) {
            if (scroll < 0 || scroll + viewLen > levelLen) found.push(`shows outside the level on ${axis}: ${where}`);
            if (exact < 0 || exact + viewLen > levelLen) found.push(`exact position outside the level on ${axis}: ${where}`);
          } else if (scroll !== Math.floor((levelLen - viewLen) / 2)) {
            found.push(`small level not centred on ${axis}: ${where}`);
          }
        }
        const s = onScreen(cam, t);
        if (s.x < 0 || s.x > view.w || s.y < 0 || s.y > view.h) found.push(`hero out of the picture: ${where}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('cameraTarget and the camera on the real core', () => {
  const CORRIDOR = levelFromRows([
    '............................................................',
    '............................................................',
    '.P...............................................T........D.',
    '############################################################',
  ]);

  it('follows the drawn hero in whole pixels: the middle of his box and his feet line', () => {
    const game = playingGame(CORRIDOR);
    for (let tick = 0; tick < 120; tick++) {
      step(game, IN('R'), []);
      const p = game.run.player;
      const t = cameraTarget(game);
      expect(t.x).toBe((p.x >> SUB_SHIFT) + (game.phys.heroW >> SUB_SHIFT) / 2);
      expect(t.feetY).toBe((p.y >> SUB_SHIFT) + (game.phys.heroH >> SUB_SHIFT));
      expect(t).toMatchObject({ facing: p.facing, moving: p.vx !== 0, onGround: p.onGround });
    }
  });

  /** A one-row level on a deck, 64 tiles wide, through the real parser. */
  const deck = (row: string) => levelFromRows(['', '', row, ''].map((r, i) => (i === 3 ? '#'.repeat(64) : r.padEnd(64, '.'))));
  /** The narrowest view: 17 tiles and a bit. */
  const NARROW: Size = { w: 284, h: 160 };

  /**
   * Runs `script` through the real core, stepping the camera after every tick as PlayScene does, and
   * returns the camera and the hero on every tick spent in `phase`.
   */
  function frozenRun(row: string, script: readonly (readonly [string, number])[], phase: 'dying' | 'exiting'): { cam: CameraState; heroX: number; vx: number }[] {
    const game = playingGame(deck(row));
    const level = levelSize(game.level);
    let cam = snapCamera(cameraTarget(game), NARROW, level, CAM);
    const seen: { cam: CameraState; heroX: number; vx: number }[] = [];
    for (const [keys, ticks] of script) {
      for (let i = 0; i < ticks; i++) {
        step(game, IN(keys), []);
        cam = stepCamera(cam, cameraTarget(game), NARROW, level, CAM);
        if (game.run.phase === phase) seen.push({ cam, heroX: game.run.player.x, vx: game.run.player.vx });
        else if (seen.length > 0) return seen;
      }
    }
    return seen;
  }

  it('holds the view still through the whole death after a turn (the review\'s case: it slid 34 px)', () => {
    // Run right, turn and run left into fire three tiles away: he dies while the look-ahead is still swinging round.
    const seen = frozenRun('..............................F..P.........T....D', [['R', 10], ['L', 200]], 'dying');
    expect(seen.length).toBeGreaterThan(40);
    expect(seen.some((s) => s.vx !== 0), 'the core keeps vx while dying, so this test means something').toBe(true);
    expect(new Set(seen.map((s) => s.heroX)).size).toBe(1);
    expect(new Set(seen.map((s) => `${s.cam.scrollX},${s.cam.scrollY},${s.cam.look}`)).size).toBe(1);
  });

  it('holds the view still through the whole level exit after a turn', () => {
    const seen = frozenRun('..............................DT...P', [['R', 10], ['L', 300]], 'exiting');
    expect(seen.length).toBeGreaterThan(50);
    expect(seen.some((s) => s.vx !== 0), 'the core keeps vx while exiting').toBe(true);
    expect(new Set(seen.map((s) => `${s.cam.scrollX},${s.cam.scrollY},${s.cam.look}`)).size).toBe(1);
  });

  it('holds the view still in the ready gate after a pause, although the hero keeps his speed', () => {
    const game = playingGame(deck('...................................P.........T....D'));
    const level = levelSize(game.level);
    let cam = snapCamera(cameraTarget(game), NARROW, level, CAM);
    for (const [keys, ticks] of [['R', 10], ['L', 4]] as const) {
      for (let i = 0; i < ticks; i++) {
        step(game, IN(keys), []);
        cam = stepCamera(cam, cameraTarget(game), NARROW, level, CAM);
      }
    }
    holdReady(game); // the pause menu closed: frozen until a press, with speed and facing kept
    expect(game.run.phase).toBe('ready');
    expect(game.run.player.vx).not.toBe(0);
    const before = cam;
    for (let i = 0; i < 30; i++) {
      step(game, IN(''), []);
      cam = stepCamera(cam, cameraTarget(game), NARROW, level, CAM);
    }
    expect(game.run.phase).toBe('ready');
    expect(cam).toEqual(before);
  });

  it('does not go on easing vertically in the ready gate: paused just after landing from a long fall', () => {
    // A ledge high up a shaft taller than the view: the hero walks off, falls ten tiles and lands on a
    // floor well above the level's bottom edge (rock below it), so the bounds do not stop the ease.
    const rows = Array.from({ length: 24 }, (_, i) => (i === 3 ? '.P' : i === 4 ? '####' : i >= 15 ? '#'.repeat(24) : '').padEnd(24, '.'));
    rows[14] = `${rows[14]?.slice(0, 20) ?? ''}T..D`;
    const game = playingGame(levelFromRows(rows));
    const level = levelSize(game.level);
    let cam = snapCamera(cameraTarget(game), NARROW, level, CAM);
    let wasInAir = false;
    for (let i = 0; i < 200 && !(wasInAir && game.run.player.onGround); i++) {
      step(game, IN(i < 40 ? 'R' : ''), []);
      cam = stepCamera(cam, cameraTarget(game), NARROW, level, CAM);
      if (!game.run.player.onGround) wasInAir = true;
    }
    expect(wasInAir && game.run.player.onGround, 'the hero has landed').toBe(true);
    const rest = cameraTarget(game).feetY - CAM.camAnchorY * NARROW.h;
    expect(Math.abs(cam.y - rest), 'the vertical ease has work left to do').toBeGreaterThan(4);
    expect(rest + NARROW.h, 'and the level goes on below the view it would settle at').toBeLessThan(level.h);
    holdReady(game);
    const before = cam;
    for (let i = 0; i < 30; i++) {
      step(game, IN(''), []);
      cam = stepCamera(cam, cameraTarget(game), NARROW, level, CAM);
    }
    expect(cam).toEqual(before);
  });

  it('a hero running right along a corridor keeps one screen position while the camera follows him', () => {
    const game = playingGame(CORRIDOR);
    const level = levelSize(game.level);
    let cam = snapCamera(cameraTarget(game), VIEW, level, CAM);
    const screenX = new Set<number>();
    for (let tick = 0; tick < 400; tick++) {
      step(game, IN('R'), []);
      const t = cameraTarget(game);
      cam = stepCamera(cam, t, VIEW, level, CAM);
      if (cam.scrollX > 0 && cam.scrollX < level.w - VIEW.w) screenX.add(t.x - cam.scrollX);
      // A corridor lower than the view is centred vertically all the way.
      expect(cam.scrollY).toBe(Math.floor((level.h - VIEW.h) / 2));
    }
    expect([...screenX]).toEqual([VIEW.w / 2 - CAM.camLookAheadPx + CAM.camDeadzoneHalfW]);
  });
});

describe('the touch pad: nothing by a side wall is held under a drawn button (the view passes the wall instead)', () => {
  // How far LEFT and RIGHT, and JUMP, FIRE, THRUST and PAUSE, reach into the view: art px, as padReach gives them.
  const PAD: PadReach = { left: 80, right: 85 };
  /** Where the hero's sprite (one tile, centred on target.x) is drawn: its left and right edges on screen. */
  const sprite = (cam: CameraState, t: CameraTarget): { left: number; right: number } => ({
    left: t.x - TILE_PX / 2 - cam.scrollX,
    right: t.x + TILE_PX / 2 - cam.scrollX,
  });
  /** Where a tile at `col` is drawn: its left and right edges on screen. */
  const tile = (cam: CameraState, col: number): { left: number; right: number } => ({
    left: col * TILE_PX - cam.scrollX,
    right: (col + 1) * TILE_PX - cam.scrollX,
  });
  const lastCol = BIG.w / TILE_PX - 1;

  it('stopped by the east wall, the level ends where JUMP and FIRE begin: the airlock in the last column is clear of them', () => {
    // Level 4's case: the airlock one tile from the east wall, the hero walking up to it from 12 tiles away.
    const door = lastCol - 1;
    let t = target((door - 12) * TILE_PX + 8, 320, { moving: true });
    let cam = snapCamera(t, VIEW, BIG, CAM, PAD);
    for (let x = t.x; x <= door * TILE_PX + 8; x++) {
      t = target(x, 320, { moving: true });
      cam = stepCamera(cam, t, VIEW, BIG, CAM, PAD);
      const tilesLeft = (door * TILE_PX + 8 - x) / TILE_PX;
      if (tilesLeft <= 4) expect(tile(cam, door).right, `${tilesLeft} tiles from the airlock`).toBeLessThanOrEqual(VIEW.w - PAD.right);
      expect(sprite(cam, t).right).toBeLessThanOrEqual(VIEW.w - PAD.right);
    }
    // At the wall the camera stands where the level's edge meets the buttons, never further.
    expect(cam.scrollX).toBe(BIG.w - VIEW.w + PAD.right);
    expect(tile(cam, lastCol).right).toBe(VIEW.w - PAD.right);
  });

  it('stopped by the west wall, the level begins where RIGHT ends: the first columns are clear of LEFT and RIGHT', () => {
    let t = target(12 * TILE_PX, 320, { facing: -1, moving: true });
    let cam = snapCamera(t, VIEW, BIG, CAM, PAD);
    for (let x = t.x; x >= 8; x--) {
      t = target(x, 320, { facing: -1, moving: true });
      cam = stepCamera(cam, t, VIEW, BIG, CAM, PAD);
      expect(sprite(cam, t).left, `hero at ${x}`).toBeGreaterThanOrEqual(PAD.left);
    }
    expect(cam.scrollX).toBe(-PAD.left);
    expect(tile(cam, 0).left).toBe(PAD.left);
  });

  it('at the ready gate, a hero who starts a few tiles from the airlock by the east wall sees it clear of the buttons', () => {
    const door = lastCol - 1;
    for (const tilesAway of [1, 2, 3, 4, 5]) {
      for (const facing of [1, -1] as const) {
        const t = target((door - tilesAway) * TILE_PX + 8, 320, { facing });
        const cam = snapCamera(t, VIEW, BIG, CAM, PAD);
        if (facing === 1) expect(tile(cam, door).right, `${tilesAway} tiles, facing the airlock`).toBeLessThanOrEqual(VIEW.w - PAD.right);
        expect(sprite(cam, t).right, `${tilesAway} tiles, facing ${facing}`).toBeLessThanOrEqual(VIEW.w - PAD.right);
      }
    }
  });

  it('never shows more than the reach beyond a wall, and the hero is always drawn clear of the buttons there', () => {
    for (let x = 0; x <= BIG.w; x += 4) {
      for (const facing of [1, -1] as const) {
        const t = target(x, 320, { facing });
        const cam = snapCamera(t, VIEW, BIG, CAM, PAD);
        expect(cam.scrollX).toBeGreaterThanOrEqual(-PAD.left - TILE_PX / 2);
        expect(cam.scrollX).toBeLessThanOrEqual(BIG.w - VIEW.w + PAD.right + TILE_PX / 2);
        if (cam.scrollX <= 0) expect(sprite(cam, t).left, `hero at ${x}`).toBeGreaterThanOrEqual(PAD.left);
        if (cam.scrollX >= BIG.w - VIEW.w) expect(VIEW.w - sprite(cam, t).right, `hero at ${x}`).toBeGreaterThanOrEqual(PAD.right);
      }
    }
  });

  it('changes nothing away from the walls, nor without a pad', () => {
    const placed = ({ x, y, look, scrollX, scrollY }: CameraState): Partial<CameraState> => ({ x, y, look, scrollX, scrollY });
    for (const x of [200, 400, 800, BIG.w - 300]) {
      const t = target(x, 320);
      expect(placed(snapCamera(t, VIEW, BIG, CAM, PAD))).toEqual(placed(snapCamera(t, VIEW, BIG, CAM)));
    }
    const nearWall = target(24, 320);
    expect(snapCamera(nearWall, VIEW, BIG, CAM, NO_PAD)).toEqual(snapCamera(nearWall, VIEW, BIG, CAM));
    expect(snapCamera(nearWall, VIEW, BIG, CAM, NO_PAD).scrollX).toBe(0);
  });

  it("walking away from the wall, the view comes back into the level without a jump, on the hero's whole pixels", () => {
    let t = target(24, 320, { moving: true });
    let cam = snapCamera(t, VIEW, BIG, CAM, PAD);
    for (let x = 24; x < 400; x++) {
      t = target(x, 320, { moving: true });
      const next = stepCamera(cam, t, VIEW, BIG, CAM, PAD);
      expect(Math.abs(next.scrollX - cam.scrollX), `at x = ${x}`).toBeLessThanOrEqual(1);
      expect(Number.isInteger(next.scrollX)).toBe(true);
      expect(sprite(next, t).left, `at x = ${x}`).toBeGreaterThanOrEqual(PAD.left);
      cam = next;
    }
    expect(cam.scrollX).toBeGreaterThan(0); // back inside the level, following as before
  });

  it('a room narrower than the view is centred without a pad, and passes its walls like any level with one', () => {
    const room: Size = { w: 15 * TILE_PX, h: 10 * TILE_PX };
    const centred = Math.floor((room.w - VIEW.w) / 2);
    expect(snapCamera(target(room.w / 2, 100), VIEW, room, CAM).scrollX).toBe(centred);
    const atEast = target(room.w - 24, 100);
    const east = snapCamera(atEast, VIEW, room, CAM, PAD);
    expect(east.scrollX).toBeLessThanOrEqual(centred + PAD.right);
    expect(room.w - east.scrollX, 'the room ends where the buttons begin, or before').toBeLessThanOrEqual(VIEW.w - PAD.right);
    const atWest = target(24, 100, { facing: -1 });
    const west = snapCamera(atWest, VIEW, room, CAM, PAD);
    expect(west.scrollX).toBeGreaterThanOrEqual(centred - PAD.left);
    expect(sprite(west, atWest).left).toBeGreaterThanOrEqual(PAD.left);
  });

  it('padReach measures the drawn buttons over the canvas in whole art px, from either edge', () => {
    const canvas = { x: 47, y: 0, w: 750, h: 390 }; // 375 art px at 2 CSS px per art px, after a 47 px notch
    const left = { x: 67, y: 286, w: 64, h: 64 };
    const right = { x: 143, y: 286, w: 64, h: 64 };
    const jump = { x: 701, y: 274, w: 76, h: 76 };
    const fire = { x: 627, y: 290, w: 60, h: 60 };
    const pause = { x: 749, y: 10, w: 36, h: 36 };
    const out: PadReach = { left: -1, right: -1, bottom: -1 };
    expect(padReach([left, right], [jump, fire, pause], canvas, 2, out)).toBe(out);
    // Up from the bottom: the tallest of the bottom row (JUMP, from y 274 on a 390 px canvas), not PAUSE at the top.
    expect(out).toEqual({ left: Math.ceil((143 + 64 - 47) / 2), right: Math.ceil((47 + 750 - 627) / 2), bottom: Math.ceil((390 - 274) / 2) });
    // PAUSE counts too at the side: alone it reaches (47 + 750 - 749) / 2 = 24 art px; it is not in the bottom row.
    expect(padReach([], [pause], canvas, 2, out)).toEqual({ left: 0, right: 24, bottom: 0 });
    // Buttons beyond the canvas (wide bars beside it) reach nothing.
    expect(padReach([{ x: 0, y: 0, w: 20, h: 20 }], [{ x: 900, y: 0, w: 20, h: 20 }], canvas, 2, out)).toEqual({ left: 0, right: 0, bottom: 0 });
  });
});

describe("the touch pad's bottom row: a floor at the level's bottom is drawn above the buttons (the view passes the bottom edge)", () => {
  // The smallest phone (568 x 320 at 2): a 284 x 160 view, the bottom row of buttons reaching 48 art px up.
  const SE: Size = { w: 284, h: 160 };
  const PAD: PadReach = { left: 80, right: 121, bottom: 48 };
  // A 14-row level whose floor is its bottom row (level 2): the hero stands on row 13's top, feet at y 208.
  const LOW: Size = { w: 64 * TILE_PX, h: 14 * TILE_PX };
  const floorFeet = 13 * TILE_PX;

  it('without a pad the view stops at the level bottom, and the floor row lies at the height of the buttons', () => {
    const cam = snapCamera(target(400, floorFeet), SE, LOW, CAM);
    expect(cam.scrollY).toBe(LOW.h - SE.h);
    expect(floorFeet - cam.scrollY, 'the feet sit 16 px above the bottom edge').toBe(SE.h - TILE_PX);
  });

  it('with the pad the view goes below the level by up to the reach, so the feet rest on the anchor and the floor row is above the buttons', () => {
    let cam = snapCamera(target(400, floorFeet), SE, LOW, CAM, PAD);
    const anchor = feetAnchor(SE, CAM, PAD);
    expect(floorFeet - cam.scrollY).toBe(Math.round(anchor));
    // The floor tile under him, and what walks on it, are above the buttons' top edge.
    expect(floorFeet + TILE_PX - cam.scrollY).toBeLessThanOrEqual(SE.h - (PAD.bottom ?? 0));
    expect(cam.scrollY + SE.h - LOW.h, 'never more than the reach below the level').toBeLessThanOrEqual(PAD.bottom ?? 0);
    // Standing still for a while changes nothing.
    for (let i = 0; i < 60; i++) cam = stepCamera(cam, target(400, floorFeet), SE, LOW, CAM, PAD);
    expect(floorFeet - cam.scrollY).toBe(Math.round(anchor));
  });

  it('feetAnchor keeps camPadClearPx between the feet and the bottom row, and is camAnchorY without a pad', () => {
    expect(feetAnchor(SE, CAM)).toBe(CAM.camAnchorY * SE.h);
    for (const bottom of [0, 20, 48, 60, 96]) {
      const a = feetAnchor(SE, CAM, { left: 0, right: 0, bottom });
      expect(a).toBeLessThanOrEqual(CAM.camAnchorY * SE.h);
      if (bottom > 0) expect(a, `reach ${bottom}`).toBeLessThanOrEqual(Math.max(SE.h - bottom - CAM.camPadClearPx, STRIP_H + CAM.camAirBandTop * SE.h));
      expect(a, `reach ${bottom}`).toBeGreaterThanOrEqual(STRIP_H + CAM.camAirBandTop * SE.h);
    }
  });

  it('a hero falling into a pit is followed before his feet reach the buttons', () => {
    const tall: Size = { w: 64 * TILE_PX, h: 40 * TILE_PX };
    let feet = 300;
    let cam = snapCamera(target(400, feet), SE, tall, CAM, PAD);
    for (let i = 0; i < 40; i++) {
      feet += 4;
      cam = stepCamera(cam, target(400, feet, { onGround: false }), SE, tall, CAM, PAD);
      expect(feet - cam.scrollY, `tick ${i}`).toBeLessThanOrEqual(SE.h - (PAD.bottom ?? 0));
    }
  });

  it('touch mode ending: the pass below the level is kept while he stands and given back only as the camera rises with him', () => {
    let cam = snapCamera(target(400, floorFeet), SE, LOW, CAM, PAD);
    const start = cam.scrollY;
    expect(start).toBeGreaterThan(LOW.h - SE.h);
    for (let i = 0; i < 120; i++) {
      const next = stepCamera(cam, target(400, floorFeet), SE, LOW, CAM, NO_PAD);
      expect(Math.abs(next.scrollY - cam.scrollY), `tick ${i}: no jump`).toBeLessThanOrEqual(CAM.camVerticalMaxStep);
      cam = next;
    }
    // Standing, nothing moves: the pass he had is kept (the view would otherwise jump up 48 px to the level's bottom).
    expect(cam.scrollY).toBe(start);
    expect(cam.passBottom).toBe(start - (LOW.h - SE.h));
    // A climb takes him up and the camera with him: the pass shrinks to nothing on the way, without a jump.
    let feet = floorFeet;
    for (let i = 0; i < 200; i++) {
      feet = Math.max(5 * TILE_PX, feet - 1);
      const next = stepCamera(cam, target(400, feet), SE, LOW, CAM, NO_PAD);
      expect(Math.abs(next.scrollY - cam.scrollY), `climb tick ${i}`).toBeLessThanOrEqual(CAM.camVerticalMaxStep);
      cam = next;
    }
    expect(cam.passBottom).toBe(0);
    expect(cam.scrollY + SE.h).toBeLessThanOrEqual(LOW.h);
  });

  it('touch mode coming back: the pass below grows by camPassGlideSpeed a tick at most, and the view eases down, never jumping', () => {
    let cam = snapCamera(target(400, floorFeet), SE, LOW, CAM, NO_PAD);
    expect(cam.passBottom).toBe(0);
    for (let i = 0; i < 80; i++) {
      const next = stepCamera(cam, target(400, floorFeet), SE, LOW, CAM, PAD);
      expect(next.passBottom - cam.passBottom).toBeLessThanOrEqual(CAM.camPassGlideSpeed);
      expect(Math.abs(next.scrollY - cam.scrollY), `tick ${i}`).toBeLessThanOrEqual(CAM.camVerticalMaxStep);
      cam = next;
    }
    expect(floorFeet - cam.scrollY).toBe(Math.round(feetAnchor(SE, CAM, PAD)));
  });
});

describe('a hero thrusting up a shaft sees what is above him (the air band slides down while THRUST is held)', () => {
  const SMALLEST: Size = { w: 17 * TILE_PX, h: 10 * TILE_PX };

  it('on the 17 x 10 view, after the slide, at least three tiles of undimmed level show above his head', () => {
    for (const view of [SMALLEST, { w: 339, h: 165 }, { w: 400, h: 180 }]) {
      let feet = 600;
      let cam = snapCamera(target(800, feet), view, BIG, CAM);
      const above: number[] = [];
      for (let i = 0; i < 90; i++) {
        feet -= 1.75; // the thruster's top climbing speed
        cam = stepCamera(cam, target(800, Math.round(feet), { onGround: false, thrusting: true }), view, BIG, CAM);
        above.push(Math.round(feet) - TILE_PX - cam.scrollY - STRIP_H);
      }
      // A 6-tile shaft is 96 px: climbed at 1.75 px a tick in 55 ticks. From then on at least 3 tiles show above him.
      expect(Math.min(...above.slice(55)), `view ${view.w} x ${view.h}`).toBeGreaterThanOrEqual(3 * TILE_PX);
      expect(cam.rise).toBeCloseTo(riseLookMax(view, CAM), 9);
    }
  });

  it('the slide is gradual (camRiseLookSpeed a tick) and goes back after the thrust, never moving the view by a jump', () => {
    let feet = 600;
    let cam = snapCamera(target(800, feet), SMALLEST, BIG, CAM);
    for (let i = 0; i < 120; i++) {
      const thrusting = i < 60;
      if (thrusting) feet -= 2;
      const next = stepCamera(cam, target(800, feet, { onGround: false, thrusting }), SMALLEST, BIG, CAM);
      expect(Math.abs(next.rise - cam.rise), `tick ${i}`).toBeLessThanOrEqual(CAM.camRiseLookSpeed + 1e-9);
      expect(Math.abs(next.y - cam.y), `tick ${i}`).toBeLessThanOrEqual(2 + CAM.camRiseLookSpeed + 1e-9);
      cam = next;
    }
    expect(cam.rise).toBe(0);
  });

  it('an ordinary jump (no thrust) still leaves the view still: the band only slides for THRUST', () => {
    let cam = snapCamera(target(800, 600), SMALLEST, BIG, CAM);
    const rest = cam.scrollY;
    for (let rise = 0; rise <= 52; rise++) {
      cam = stepCamera(cam, target(800, 600 - rise, { onGround: false }), SMALLEST, BIG, CAM);
      expect(cam.scrollY).toBe(rest);
    }
  });
});

describe('the vertical ease never lurches', () => {
  it('after landing high (a climb of five tiles) the view catches up by at most camVerticalMaxStep a tick', () => {
    let cam = snapCamera(target(800, 600), VIEW, BIG, CAM);
    const higher = target(800, 600 - 5 * TILE_PX);
    const steps: number[] = [];
    for (let i = 0; i < 60; i++) {
      const next = stepCamera(cam, higher, VIEW, BIG, CAM);
      steps.push(cam.y - next.y);
      cam = next;
    }
    expect(Math.max(...steps)).toBeLessThanOrEqual(CAM.camVerticalMaxStep + 1e-9);
    expect(steps[0], 'the first step is the cap, not 12 % of 80 px').toBeCloseTo(CAM.camVerticalMaxStep, 9);
    expect(onScreen(cam, higher).y).toBe(Math.round(CAM.camAnchorY * VIEW.h));
  });
});

describe('touch mode ending (a key press): the view never jumps', () => {
  const PAD: PadReach = { left: 80, right: 85 };
  const levelRightEdge = (cam: CameraState): number => BIG.w - cam.scrollX;

  it('the pass beyond the wall is kept while the hero stands, and given back only as the camera follows him in', () => {
    // The hero stands by the east wall: the view passes it by the whole reach.
    const atWall = target(BIG.w - 24, 320);
    let cam = snapCamera(atWall, VIEW, BIG, CAM, PAD);
    expect(cam.scrollX).toBe(BIG.w - VIEW.w + PAD.right);
    // A key press: the reach drops to 0. Standing still, nothing moves, however long.
    const before = cam;
    for (let i = 0; i < 120; i++) cam = stepCamera(cam, atWall, VIEW, BIG, CAM, NO_PAD);
    expect(cam.scrollX).toBe(before.scrollX);
    expect(cam.passRight).toBe(PAD.right);
    // He walks west at 1.5 px a tick: the view follows him at his own pace (plus the look-ahead swinging round, under
    // a pixel a tick), never in a jump, and the pass shrinks with it.
    let sub = (BIG.w - 24) * 256;
    let last = cam.scrollX;
    let heroLast = BIG.w - 24;
    for (let tick = 0; tick < 400; tick++) {
      sub -= 384;
      const t = target(sub >> 8, 320, { facing: -1, moving: true });
      cam = stepCamera(cam, t, VIEW, BIG, CAM, NO_PAD);
      expect(last - cam.scrollX, `tick ${tick}`).toBeLessThanOrEqual(heroLast - t.x + 1);
      expect(cam.scrollX, `tick ${tick}`).toBeLessThanOrEqual(last);
      expect(cam.passRight).toBe(Math.max(0, cam.x - (BIG.w - VIEW.w)));
      last = cam.scrollX;
      heroLast = t.x;
    }
    expect(cam.passRight).toBe(0);
    // Back to the wall with keys: the view stops inside the level, as it always did without a pad.
    for (let x = heroLast; x <= BIG.w - 8; x++) cam = stepCamera(cam, target(x, 320, { moving: true }), VIEW, BIG, CAM, NO_PAD);
    expect(levelRightEdge(cam)).toBe(VIEW.w);
  });

  it('on the west wall likewise', () => {
    const atWall = target(24, 320, { facing: -1 });
    let cam = snapCamera(atWall, VIEW, BIG, CAM, PAD);
    expect(cam.scrollX).toBe(-PAD.left);
    for (let i = 0; i < 60; i++) cam = stepCamera(cam, atWall, VIEW, BIG, CAM, NO_PAD);
    expect(cam.scrollX).toBe(-PAD.left);
    let last = cam.scrollX;
    for (let x = 24; x < 600; x += 2) {
      cam = stepCamera(cam, target(x, 320, { moving: true }), VIEW, BIG, CAM, NO_PAD);
      expect(cam.scrollX - last, `hero at ${x}`).toBeLessThanOrEqual(2 + 1); // his step, and the look-ahead swinging round
      expect(cam.scrollX - last, `hero at ${x}`).toBeGreaterThanOrEqual(0);
      last = cam.scrollX;
    }
    expect(cam.passLeft).toBe(0);
    expect(cam.scrollX).toBeGreaterThan(0);
  });

  it('touch mode coming back: the view glides out past the wall at camPassGlideSpeed a tick, standing or moving, and waits in a frozen world', () => {
    // At the east wall with keys: the view inside the level, the hero right of the dead zone (the wall stopped the view).
    const door = BIG.w / TILE_PX - 2; // the airlock one tile from the east wall (level 4's case)
    const t = target(door * TILE_PX + 8, 320);
    const keys = snapCamera(t, VIEW, BIG, CAM, NO_PAD);
    expect(keys.scrollX).toBe(BIG.w - VIEW.w);
    // A touch while the world is frozen (the ready gate, a death, the exit): the view does not move.
    let cam = keys;
    for (let i = 0; i < 30; i++) cam = stepCamera(cam, { ...t, running: false, onGround: false }, VIEW, BIG, CAM, PAD);
    expect(cam.scrollX).toBe(keys.scrollX);
    // The world runs and he stands still at the airlock: the view glides out by exactly camPassGlideSpeed a tick (a glide,
    // not a jump), until the level's edge meets the buttons. The review's case: it waited for him to move, then crept
    // out at the look-ahead's 0.75 px a tick, with the airlock under JUMP all that time.
    const ticks = Math.ceil(PAD.right / CAM.camPassGlideSpeed);
    for (let i = 1; i <= ticks; i++) {
      const next = stepCamera(cam, t, VIEW, BIG, CAM, PAD);
      expect(next.x - cam.x, `tick ${i}`).toBeCloseTo(Math.min(CAM.camPassGlideSpeed, BIG.w - VIEW.w + PAD.right - cam.x), 9);
      cam = next;
    }
    expect(cam.scrollX).toBe(BIG.w - VIEW.w + PAD.right);
    expect(cam.passRight).toBe(PAD.right);
    expect((door + 1) * TILE_PX - cam.scrollX, 'the airlock clear of JUMP').toBeLessThanOrEqual(VIEW.w - PAD.right);
  });

  it('touch mode coming back as he walks to the airlock by the east wall: it is clear of the buttons before he is within three tiles of it', () => {
    const door = BIG.w / TILE_PX - 2;
    const airlockRight = (cam: CameraState): number => (door + 1) * TILE_PX - cam.scrollX;
    for (const tilesAway of [4, 5, 6, 8, 10]) {
      // Keys all the way to the wall and back out to `tilesAway` tiles: the pass is given back as he walks away.
      let sub = (door * TILE_PX + 8) * 256;
      let cam = snapCamera(target(sub >> 8, 320), VIEW, BIG, CAM, PAD);
      for (let i = 0; i < 400 && (sub >> 8) > (door - tilesAway) * TILE_PX + 8; i++) {
        sub -= 384;
        cam = stepCamera(cam, target(sub >> 8, 320, { facing: -1, moving: true }), VIEW, BIG, CAM, NO_PAD);
      }
      // A touch, and he runs back at 1.5 px a tick: by three tiles out the airlock is clear of JUMP and FIRE.
      for (let i = 0; i < 400 && (sub >> 8) < door * TILE_PX + 8; i++) {
        sub += 384;
        const t = target(sub >> 8, 320, { moving: true });
        cam = stepCamera(cam, t, VIEW, BIG, CAM, PAD);
        if (door * TILE_PX + 8 - t.x <= 3 * TILE_PX) expect(airlockRight(cam), `from ${tilesAway} tiles, hero at ${t.x}`).toBeLessThanOrEqual(VIEW.w - PAD.right);
      }
    }
  });

  it('over random walks with touch mode switching on and off, the scroll never moves more than the hero did in a tick or the glide, and never passes a wall by more than the reach', () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 200 && found.length === 0; seed++) {
      const random = seeded(seed);
      const int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
      const view: Size = { w: int(272, 480), h: int(160, 224) };
      const level = levelSize({ width: int(17, 64), height: int(10, 24) });
      const reach: PadReach = { left: int(40, 100), right: int(40, 110) };
      let x = int(8, level.w - 8);
      let facing: 1 | -1 = 1;
      let pad: Readonly<PadReach> = random() < 0.5 ? reach : NO_PAD;
      let cam = snapCamera(target(x, 200, { facing }), view, level, CAM, pad);
      for (let tick = 0; tick < 800; tick++) {
        if (random() < 0.01) pad = pad === NO_PAD ? reach : NO_PAD;
        if (random() < 0.03) facing = facing === 1 ? -1 : 1;
        const dx = random() < 0.6 ? facing * int(1, 2) : 0;
        x = Math.min(level.w - 8, Math.max(8, x + dx));
        const next = stepCamera(cam, target(x, 200, { facing, moving: dx !== 0 }), view, level, CAM, pad);
        const where = `seed ${seed} tick ${tick} view ${view.w} level ${level.w} reach ${JSON.stringify(reach)} pad ${pad === NO_PAD ? 'off' : 'on'}`;
        // One whole pixel more than the hero's step (the look-ahead swings under a pixel a tick), or a growing pass's glide.
        const most = Math.max(Math.abs(dx) + 1, Math.ceil(CAM.camPassGlideSpeed));
        if (Math.abs(next.scrollX - cam.scrollX) > most) found.push(`moved ${next.scrollX - cam.scrollX} for a step of ${dx}: ${where}`);
        const small = level.w <= view.w;
        const lo0 = small ? Math.floor((level.w - view.w) / 2) : 0;
        const hi0 = small ? lo0 : level.w - view.w;
        if (next.x < lo0 - reach.left || next.x > hi0 + reach.right) found.push(`beyond the reach: ${next.x}: ${where}`);
        if (pad === NO_PAD && next.passLeft === 0 && next.passRight === 0 && (next.x < lo0 || next.x > hi0)) found.push(`outside the level with no pass: ${where}`);
        cam = next;
      }
    }
    expect(found).toEqual([]);
  });
});

describe('the live camera numbers of src/tuning.ts', () => {
  const t = TUNING.camera;
  const narrowest = TUNING.view.viewMinCols * TILE_PX;

  it('are usable', () => {
    expect(t.camLookShiftSpeed, 'camera.camLookShiftSpeed must be above 0, or the view never swings round').toBeGreaterThan(0);
    expect(t.camVerticalEase, 'camera.camVerticalEase must be above 0 and at most 1').toBeGreaterThan(0);
    expect(t.camVerticalEase, 'camera.camVerticalEase must be above 0 and at most 1').toBeLessThanOrEqual(1);
    expect(t.camDeadzoneHalfW, 'camera.camDeadzoneHalfW cannot be negative').toBeGreaterThanOrEqual(0);
    expect(t.camLookAheadPx, 'camera.camLookAheadPx cannot be negative').toBeGreaterThanOrEqual(0);
    expect(t.camPassGlideSpeed, 'camera.camPassGlideSpeed must be above 0, or the view never makes room for the buttons again').toBeGreaterThan(0);
    expect(t.camVerticalMaxStep, 'camera.camVerticalMaxStep must be above 0, or the view never settles vertically').toBeGreaterThan(0);
    expect(t.camRiseLookSpeed, 'camera.camRiseLookSpeed cannot be negative').toBeGreaterThanOrEqual(0);
    expect(t.camPadClearPx, 'camera.camPadClearPx cannot be negative').toBeGreaterThanOrEqual(0);
    expect(t.camRiseBandTop, 'camera.camRiseBandTop must be between camAirBandTop and 1').toBeGreaterThanOrEqual(t.camAirBandTop);
    expect(t.camRiseBandTop, 'camera.camRiseBandTop must be between camAirBandTop and 1').toBeLessThanOrEqual(1);
  });

  it('keep the hero in the picture', () => {
    expect(
      t.camLookAheadPx + t.camDeadzoneHalfW,
      `camera.camLookAheadPx + camDeadzoneHalfW must stay below half the narrowest view (${narrowest / 2} px)`,
    ).toBeLessThan(narrowest / 2);
    expect(t.camAirBandTop, 'camera.camAirBandTop must be between 0 and camAnchorY').toBeGreaterThanOrEqual(0);
    expect(t.camAirBandTop, 'camera.camAirBandTop must be between 0 and camAnchorY').toBeLessThanOrEqual(t.camAnchorY);
    expect(t.camAirBandBottom, 'camera.camAirBandBottom must be between camAnchorY and 1').toBeGreaterThanOrEqual(t.camAnchorY);
    expect(t.camAirBandBottom, 'camera.camAirBandBottom must be between camAnchorY and 1').toBeLessThanOrEqual(1);
    // The band's top lies under the top bar's strip: on the lowest view it must still be above where the feet rest.
    const lowest = TUNING.view.viewMinRows * TILE_PX;
    expect(STRIP_H + t.camAirBandTop * lowest, `camera.camAirBandTop: the band's top (${STRIP_H} px of strip + camAirBandTop of the view) must stay above camAnchorY on a ${lowest} px view`).toBeLessThan(t.camAnchorY * lowest);
  });
});

describe('the standing framing: what is near the hero is kept out from under the top bar and the buttons (the route watch re-check)', () => {
  // The smallest phone (568 x 320 at 2): a 284 x 160 view; the pad as laid out there with both items, art px of the view.
  const SE: Size = { w: 284, h: 160 };
  const PAD: PadReach = { left: 80, right: 121, bottom: 48 };
  const BUTTONS: PadButtonsOnView = {
    left: { x: 10, y: 118, w: 32, h: 32 },
    right: { x: 48, y: 118, w: 32, h: 32 },
    jump: { x: 236, y: 112, w: 38, h: 38 },
    fire: { x: 163, y: 120, w: 30, h: 30 },
    thrust: { x: 199, y: 120, w: 30, h: 30 },
    pause: { x: 260, y: 5, w: 18, h: 18 },
  };
  // Level 9's start, in small: the hero on deck 1, two rows above the level's bottom; deck 2's floor five rows up,
  // with a thruster pack (J) and a Cinderpeg (C) on it, as at the foot of lift B.
  const rows = [
    ...Array.from({ length: 15 }, (_, r) => (r === 0 ? '#'.repeat(30) : `#${'.'.repeat(28)}#`)),
    '#...J.......C.......T.....D..#',
    '###################.##########',
    `#${'.'.repeat(28)}#`,
    `#${'.'.repeat(28)}#`,
    `#${'.'.repeat(28)}#`,
    '#.P..........................#',
    '#'.repeat(30),
    '#'.repeat(30),
  ];
  const level = levelFromRows(rows);
  const cellOnView = (cam: CameraState, col: number, row: number): { x: number; y: number } => ({ x: col * TILE_PX - cam.scrollX, y: row * TILE_PX - cam.scrollY });
  const underStrip = (y: number): boolean => Math.min(y + TILE_PX, STRIP_H) - Math.max(y, 0) >= TILE_PX / 2;
  const overlaps = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean => x < r.x + r.w && r.x < x + TILE_PX && y < r.y + r.h && r.y < y + TILE_PX;

  it("level 9's start on the 568 x 320 phone: the deck-2 pack and Cinderpeg are drawn below the strip, not in the top bar's row", () => {
    const game = playingGame(level);
    const scene: FrameScene = { game, buttons: BUTTONS };
    const size = levelSize(level);
    // Without the framing (keys' anchor, the bottom pass): the pack lies under the strip, where it read as a HUD icon.
    const plain = snapCamera(cameraTarget(game), SE, size, CAM, PAD);
    expect(underStrip(cellOnView(plain, 4, 15).y), 'the plain anchor hides it').toBe(true);
    let cam = snapCamera(cameraTarget(game), SE, size, CAM, PAD, scene);
    for (let i = 0; i < 60; i++) cam = stepCamera(cam, cameraTarget(game), SE, size, CAM, PAD, scene);
    for (const [col, row] of [
      [4, 15],
      [12, 15],
    ] as const) {
      const at = cellOnView(cam, col, row);
      expect(at.y, `the thing at ${col},${row}: clear of the strip`).toBeGreaterThanOrEqual(STRIP_H);
    }
    // His feet rest lower on screen, and he stays clear of every button: his feet at most at their top.
    expect(cam.shift).toBeGreaterThan(0);
    const feet = cameraTarget(game).feetY - cam.scrollY;
    expect(feet).toBeLessThanOrEqual(SE.h - (PAD.bottom ?? 0));
  });

  it('never moves the view for nothing: with nothing hidden it keeps the anchor, the same as without a scene', () => {
    const open = levelFromRows([...Array.from({ length: 14 }, () => '.'.repeat(40)), '.P..........T.............D.............', ...Array.from({ length: 9 }, () => '#'.repeat(40))]);
    const game = playingGame(open);
    const size = levelSize(open);
    for (const pad of [PAD, NO_PAD]) {
      const scene: FrameScene = { game, buttons: pad === NO_PAD ? null : BUTTONS };
      expect(snapCamera(cameraTarget(game), SE, size, CAM, pad, scene)).toEqual(snapCamera(cameraTarget(game), SE, size, CAM, pad));
    }
  });

  it('never brings anything new under a button or (other than a crystal) under the strip, never puts the hero on the buttons, and moves within its range', () => {
    const rnd = seeded(7);
    for (let trial = 0; trial < 300; trial++) {
      // A random room: a floor somewhere, things scattered above and below it.
      const W = 30;
      const H = 24;
      const floor = 8 + Math.floor(rnd() * 13);
      const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || r >= H - 1 || c === 0 || c === W - 1 || r === floor + 1 ? '#' : '.')));
      const put = (ch: string): void => {
        for (;;) {
          const c = 1 + Math.floor(rnd() * (W - 2));
          const r = 1 + Math.floor(rnd() * (H - 3));
          if (grid[r]?.[c] === '.' && r !== floor + 1) {
            (grid[r] as string[])[c] = ch;
            return;
          }
        }
      };
      (grid[floor] as string[])[2 + Math.floor(rnd() * (W - 4))] = 'P';
      for (const ch of ['T', 'D', 'J', 'B', 'G', 'G', 'G', 'C', 'M', 'F', 'S']) put(ch);
      let built;
      try {
        built = levelFromRows(grid.map((r) => r.join('')));
      } catch {
        continue; // a random room the level reader refuses (a Cinderpeg with no floor): skip it
      }
      const game = playingGame(built);
      const size = levelSize(built);
      const target = cameraTarget(game);
      const scene: FrameScene = { game, buttons: BUTTONS };
      const x = target.x - (SE.w / 2 - target.facing * CAM.camLookAheadPx);
      const s = frameShift(scene, target, x, SE, size, CAM, PAD, PAD.bottom ?? 0);
      expect(s).toBeLessThanOrEqual(CAM.camFrameDownPx);
      expect(s).toBeGreaterThanOrEqual(-CAM.camFrameUpPx);
      const anchor = snapCamera(target, SE, size, CAM, PAD);
      const framed = snapCamera(target, SE, size, CAM, PAD, scene);
      expect(target.feetY - framed.scrollY, `trial ${trial}: the hero's feet above the buttons`).toBeLessThanOrEqual(SE.h - (PAD.bottom ?? 0) + 0.5);
      const drawn = [BUTTONS.left, BUTTONS.right, BUTTONS.jump, BUTTONS.pause];
      const things = [built.trophy, built.door, ...built.pickups, ...built.enemies];
      for (const th of things) {
        const a = cellOnView(anchor, th.col, th.row);
        const f = cellOnView(framed, th.col, th.row);
        if (f.x + TILE_PX / 2 <= 0 || f.x + TILE_PX / 2 >= SE.w) continue;
        const crystal = 'kind' in th && th.kind === 'crystal';
        if (!crystal && underStrip(f.y)) expect(underStrip(a.y), `trial ${trial}: ${JSON.stringify(th)} newly under the strip`).toBe(true);
        for (const r of drawn) if (overlaps(f.x, f.y, r)) expect(overlaps(a.x, a.y, r), `trial ${trial}: ${JSON.stringify(th)} newly under a button`).toBe(true);
      }
    }
  });

  /** A random room: a floor, the hero on it, and the level's things (and `extra`) scattered above and below. */
  const randomRoom = (rnd: () => number, extra: readonly string[] = []): ReturnType<typeof levelFromRows> | null => {
    const W = 30;
    const H = 24;
    const floor = 8 + Math.floor(rnd() * 13);
    const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || r >= H - 1 || c === 0 || c === W - 1 || r === floor + 1 ? '#' : '.')));
    const put = (ch: string): void => {
      for (;;) {
        const c = 1 + Math.floor(rnd() * (W - 2));
        const r = 1 + Math.floor(rnd() * (H - 3));
        if (grid[r]?.[c] === '.' && r !== floor + 1) {
          (grid[r] as string[])[c] = ch;
          return;
        }
      }
    };
    (grid[floor] as string[])[2 + Math.floor(rnd() * (W - 4))] = 'P';
    for (const ch of ['T', 'D', 'J', 'B', 'G', 'G', 'G', 'C', 'M', 'F', 'S', ...extra]) put(ch);
    try {
      return levelFromRows(grid.map((r) => r.join('')));
    } catch {
      return null; // a random room the level reader refuses (a Cinderpeg with no floor)
    }
  };

  it('over random rooms: never newly puts an up-and-down Arc Moth under the strip anywhere on its way in the next half second (src/shell/routeView.test.ts holds level 9)', () => {
    const rnd = seeded(31);
    let moths = 0;
    for (let trial = 0; trial < 1500; trial++) {
      const built = randomRoom(rnd, ['M', 'M']);
      if (!built) continue;
      const game = playingGame(built);
      const size = levelSize(built);
      const scene: FrameScene = { game, buttons: BUTTONS };
      const t = cameraTarget(game);
      const anchor = snapCamera(t, SE, size, CAM, PAD);
      const framed = snapCamera(t, SE, size, CAM, PAD, scene);
      // Where each moth flies over the next 30 ticks, the hero standing still (the core steps it: 0.75 px a tick).
      const ahead = playingGame(built);
      const ys = built.enemies.map(() => [] as number[]);
      for (let k = 0; k <= 30; k++) {
        ahead.run.enemies.forEach((e, i) => {
          const spawn = built.enemies[i];
          if (spawn?.kind === 'moth' && spawn.axis === 'v') ys[i]?.push(e.y >> SUB_SHIFT);
        });
        step(ahead, IN(''), []);
      }
      built.enemies.forEach((e, i) => {
        const way = ys[i] ?? [];
        if (way.length === 0) return;
        moths += 1;
        const x = e.col * TILE_PX - framed.scrollX;
        if (x + TILE_PX / 2 <= 0 || x + TILE_PX / 2 >= SE.w) return;
        const framedUnder = way.some((y) => underStrip(y - framed.scrollY));
        const anchorUnder = way.some((y) => underStrip(y - anchor.scrollY));
        if (framedUnder) expect(anchorUnder, `trial ${trial}: the moth at ${e.col},${e.row} (way ${way[0]} to ${way[way.length - 1]}) newly under the strip`).toBe(true);
      });
    }
    expect(moths, 'up-and-down moths weighed').toBeGreaterThan(150);
  });

  it('does not raise his feet to bring a Cinderpeg out from under FIRE if an Arc Moth would then fly into the strip within half a second (it weighed the moth as one tall thing)', () => {
    // The hero on a floor at row 12, facing a one-tile pit 4 tiles ahead with a Cinderpeg in it, under FIRE on this phone;
    // an up-and-down moth flies in column 18 (left of PAUSE), from under the roof down to the floor.
    const rows = Array.from({ length: 24 }, (_, r) => {
      if (r === 0 || r >= 15) return '#'.repeat(30);
      if (r === 13 || r === 14) return '#'.repeat(13) + (r === 13 ? '...' : '.C.') + '#'.repeat(14);
      const row: string[] = Array.from({ length: 30 }, (_, c) => (c === 0 || c === 29 ? '#' : '.'));
      if (r === 12) {
        row[10] = 'P';
        row[25] = 'T';
        row[27] = 'D';
      }
      if (r === 8) row[18] = 'M';
      return row.join('');
    });
    const built = levelFromRows(rows);
    const game = playingGame(built);
    game.run.player.hasBlaster = true;
    const size = levelSize(built);
    const scene: FrameScene = { game, buttons: BUTTONS };
    const t = cameraTarget(game);
    const x = t.x - (SE.w / 2 - CAM.camLookAheadPx);
    const moth = game.run.enemies.find((e) => e.kind === 'moth');
    if (!moth) throw new Error('no moth');
    // Without the moth the framing raises his feet: the Cinderpeg, 4 tiles ahead, comes out from under FIRE.
    moth.alive = false;
    const raised = frameShift(scene, t, x, SE, size, CAM, PAD, PAD.bottom ?? 0);
    expect(raised, 'his feet raised for the Cinderpeg').toBeLessThan(0);
    // The moth 4 px below where a raise of 8 puts it half under the strip, flying down: within half a second it would be there.
    moth.alive = true;
    moth.y = (16 * 7 + 12) << SUB_SHIFT;
    moth.dir = 1;
    const withMoth = frameShift(scene, t, x, SE, size, CAM, PAD, PAD.bottom ?? 0);
    const anchorY = t.feetY - feetAnchor(SE, CAM, PAD);
    const sy = anchorY - withMoth;
    expect(underStrip((moth.y >> SUB_SHIFT) - Math.round(sy)), `the moth at the framed view (shift ${withMoth})`).toBe(false);
    expect(withMoth, 'his feet not raised into it').toBeGreaterThanOrEqual(0);
  });
});
