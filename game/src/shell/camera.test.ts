import { describe, expect, it } from 'vitest';

import { holdReady, step } from '../core/game';
import { IN, levelFromRows, playingGame } from '../core/testkit';
import { SUB_SHIFT, TILE_PX } from '../core/types';
import type { CameraTuning } from '../core/types';
import { TUNING } from '../tuning';

import { NO_PAD, cameraTarget, levelSize, padReach, snapCamera, stepCamera } from './camera';
import type { CameraState, CameraTarget, PadReach, Size } from './camera';

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
});

const VIEW: Size = { w: 320, h: 180 };
const BIG: Size = { w: 100 * TILE_PX, h: 40 * TILE_PX };

const target = (x: number, feetY: number, more: Partial<CameraTarget> = {}): CameraTarget => ({
  x,
  feetY,
  facing: 1,
  moving: false,
  onGround: true,
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

  it('in the air holds still while the feet stay inside the band', () => {
    const start = snapCamera(target(800, 320), VIEW, BIG, CAM);
    const top = Math.ceil(CAM.camAirBandTop * VIEW.h);
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
      expect(feet - cam.y).toBeGreaterThanOrEqual(CAM.camAirBandTop * VIEW.h - 1e-9);
    }
    expect(feet - cam.y).toBeCloseTo(CAM.camAirBandTop * VIEW.h, 9);
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
    expect(feet).toBeGreaterThanOrEqual(CAM.camAirBandTop * tall.h - 1e-9);
    expect(feet).toBeLessThanOrEqual(CAM.camAirBandBottom * tall.h + 1e-9);
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

describe('the touch pad: the hero is never held under a drawn button by a side wall', () => {
  // How far LEFT and RIGHT, and JUMP and FIRE, reach into the view: art px, as padReach gives them.
  const PAD: PadReach = { left: 80, right: 85 };
  /** Where the hero's sprite (one tile, centred on target.x) is drawn: its left and right edges on screen. */
  const sprite = (cam: CameraState, t: CameraTarget): { left: number; right: number } => ({
    left: t.x - TILE_PX / 2 - cam.scrollX,
    right: t.x + TILE_PX / 2 - cam.scrollX,
  });

  it('at the left wall the view passes the wall by just enough to draw the hero right of RIGHT', () => {
    for (const x of [24, 40, 56, 72, 88]) {
      const t = target(x, 320);
      const cam = snapCamera(t, VIEW, BIG, CAM, PAD);
      expect(sprite(cam, t).left, `hero at ${x}`).toBeGreaterThanOrEqual(PAD.left);
      // ...and no further than needed: either the hero is exactly clear, or the camera is where it would be anyway.
      const free = snapCamera(t, VIEW, BIG, CAM);
      expect(cam.scrollX === free.scrollX || sprite(cam, t).left === PAD.left, `hero at ${x}`).toBe(true);
      expect(cam.scrollX).toBeLessThanOrEqual(0);
    }
  });

  it('at the right wall it passes that wall by just enough to draw the hero left of JUMP and FIRE', () => {
    for (const fromWall of [24, 40, 56, 72, 88]) {
      const t = target(BIG.w - fromWall, 320, { facing: -1 });
      const cam = snapCamera(t, VIEW, BIG, CAM, PAD);
      expect(VIEW.w - sprite(cam, t).right, `hero ${fromWall} px from the wall`).toBeGreaterThanOrEqual(PAD.right);
      expect(cam.scrollX).toBeGreaterThanOrEqual(BIG.w - VIEW.w);
    }
  });

  it('changes nothing away from the walls, nor without a pad', () => {
    for (const x of [200, 400, 800, BIG.w - 300]) {
      const t = target(x, 320);
      expect(snapCamera(t, VIEW, BIG, CAM, PAD)).toEqual(snapCamera(t, VIEW, BIG, CAM));
    }
    const nearWall = target(24, 320);
    expect(snapCamera(nearWall, VIEW, BIG, CAM, NO_PAD)).toEqual(snapCamera(nearWall, VIEW, BIG, CAM));
    expect(snapCamera(nearWall, VIEW, BIG, CAM, NO_PAD).scrollX).toBe(0);
  });

  it('walking away from the wall, the view comes back into the level without a jump, on the hero\'s whole pixels', () => {
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

  it('a room narrower than the view stays centred unless the hero would stand under a button', () => {
    const room: Size = { w: 15 * TILE_PX, h: 10 * TILE_PX };
    const centred = Math.floor((room.w - VIEW.w) / 2);
    const middle = target(room.w / 2, 100);
    expect(snapCamera(middle, VIEW, room, CAM, PAD).scrollX).toBe(centred);
    const atWall = target(24, 100);
    const cam = snapCamera(atWall, VIEW, room, CAM, PAD);
    expect(sprite(cam, atWall).left).toBeGreaterThanOrEqual(PAD.left);
  });

  it('padReach measures the drawn buttons over the canvas in whole art px, from either edge', () => {
    const canvas = { x: 47, y: 0, w: 750, h: 390 }; // 375 art px at 2 CSS px per art px, after a 47 px notch
    const left = { x: 67, y: 286, w: 64, h: 64 };
    const right = { x: 143, y: 286, w: 64, h: 64 };
    const jump = { x: 701, y: 274, w: 76, h: 76 };
    const fire = { x: 627, y: 290, w: 60, h: 60 };
    const out: PadReach = { left: -1, right: -1 };
    expect(padReach([left, right], [jump, fire], canvas, 2, out)).toBe(out);
    expect(out).toEqual({ left: Math.ceil((143 + 64 - 47) / 2), right: Math.ceil((47 + 750 - 627) / 2) });
    // Buttons beyond the canvas (wide bars beside it) reach nothing.
    expect(padReach([{ x: 0, y: 0, w: 20, h: 20 }], [{ x: 900, y: 0, w: 20, h: 20 }], canvas, 2, out)).toEqual({ left: 0, right: 0 });
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
  });
});
