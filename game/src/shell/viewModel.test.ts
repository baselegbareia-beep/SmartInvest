import { describe, expect, it } from 'vitest';

import { OVERLAY_OFFSET } from '../art/manifest';
import { REFERENCE_PHYS, levelFromRows, playingGame, sub } from '../core/testkit';

import { TELEPORT_PX } from './interpolation';
import {
  DEATH_WHITE_TICKS,
  EXIT_SETTLE_TICKS,
  Track,
  airlockPointer,
  boltDrawX,
  boltDrawY,
  deathFill,
  exitDrawPos,
  fellDrawY,
  fuelBarWidth,
  openShare,
  heroDrawX,
  heroDrawY,
  overlayAt,
} from './viewModel';
import type { EdgeInsets, Point, PointerPlace } from './viewModel';

describe('Track: whole-pixel draw positions blended between two ticks', () => {
  it('draws the current tick at alpha 1 and the previous one at alpha 0, always on whole pixels', () => {
    const t = new Track();
    t.set(10, 20, true);
    t.set(11, 22, true);
    expect([t.x(1), t.y(1)]).toEqual([11, 22]);
    expect([t.x(0), t.y(0)]).toEqual([10, 20]);
    expect([t.x(0.5), t.y(0.5)]).toEqual([11, 21]);
    for (const a of [0, 0.1, 0.25, 0.49, 0.5, 0.51, 0.75, 0.99, 1]) {
      expect(Number.isInteger(t.x(a))).toBe(true);
      expect(Number.isInteger(t.y(a))).toBe(true);
    }
  });

  it('two tracks moving by the same whole pixels blend to the same pixels: a sprite locked to the camera cannot wobble', () => {
    const hero = new Track();
    const cam = new Track();
    let hx = 100;
    let cx = 40;
    hero.set(hx, 0, true);
    cam.set(cx, 0, true);
    // 1.5 px per tick, as the hero runs; the camera follows by the same whole pixels.
    for (let tick = 1; tick <= 40; tick++) {
      const step = tick % 2 === 0 ? 2 : 1;
      hx += step;
      cx += step;
      hero.set(hx, 0, true);
      cam.set(cx, 0, true);
      for (const a of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
        expect(hero.x(a) - cam.x(a)).toBe(60);
      }
    }
  });

  it('something not drawn on the previous tick starts where it is: no slide in', () => {
    const bolt = new Track();
    bolt.set(0, 0, false); // inactive: its position means nothing
    bolt.set(200, 50, true); // fired this tick
    expect([bolt.x(0), bolt.y(0)]).toEqual([200, 50]);
    bolt.set(204, 50, true);
    expect(bolt.x(0)).toBe(200);
    expect(bolt.x(0.5)).toBe(202);
  });

  it('an enemy back to life after a respawn does not slide from where it died', () => {
    const enemy = new Track();
    enemy.set(300, 80, true);
    enemy.set(300, 80, false); // destroyed
    enemy.set(64, 80, true); // alive again at its spawn
    expect(enemy.x(0)).toBe(64);
  });

  it('snap stops blending until the next tick', () => {
    const t = new Track();
    t.set(10, 10, true);
    t.set(12, 13, true);
    t.snap();
    expect([t.x(0), t.y(0)]).toEqual([12, 13]);
    t.set(13, 13, true);
    expect(t.x(0)).toBe(12);
  });

  it('forget starts the next position fresh (a new level)', () => {
    const t = new Track();
    t.set(10, 10, true);
    t.forget();
    t.set(15, 12, true);
    expect([t.x(0), t.y(0)]).toEqual([15, 12]);
  });

  it('a jump of more than a tile in one tick is a teleport: drawn at the new place at once', () => {
    const t = new Track();
    t.set(0, 0, true);
    t.set(TELEPORT_PX + 1, 0, true);
    expect(t.x(0)).toBe(TELEPORT_PX + 1);
    t.set(TELEPORT_PX + 1 + TELEPORT_PX, 0, true);
    expect(t.x(0)).toBe(TELEPORT_PX + 1);
  });
});

describe('sprite corners from the core', () => {
  const ROOM = levelFromRows(['.....', '.P.TD', '#####']);

  it('centres the 16 px hero sprite on his box with the feet flush', () => {
    const game = playingGame(ROOM);
    const p = game.run.player;
    const heroW = REFERENCE_PHYS.heroW >> 8;
    const heroH = REFERENCE_PHYS.heroH >> 8;
    p.x = sub(40) + 255; // a sub-pixel short of the next pixel: still drawn at 40
    p.y = sub(30) + 128;
    expect(heroDrawX(p, REFERENCE_PHYS)).toBe(40 - (16 - heroW) / 2);
    expect(heroDrawY(p, REFERENCE_PHYS)).toBe(30 - (16 - heroH));
  });

  it('centres the bolt sprite on the bolt box', () => {
    const game = playingGame(ROOM);
    const b = game.run.bolt;
    b.x = sub(100);
    b.y = sub(50);
    expect(boltDrawX(b, REFERENCE_PHYS)).toBe(100 + (REFERENCE_PHYS.boltW >> 9) - 4);
    expect(boltDrawY(b, REFERENCE_PHYS)).toBe(50 + (REFERENCE_PHYS.boltH >> 9) - 3);
  });
});

describe('gear on the hero', () => {
  const out: Point = { x: 0, y: 0 };

  it('sits at the manifest offset facing right', () => {
    expect(overlayAt('ovl_pack', 'hero_idle_0', false, 100, 50, out)).toEqual({ x: 100 + OVERLAY_OFFSET.ovl_pack.x, y: 50 + OVERLAY_OFFSET.ovl_pack.y });
    expect(overlayAt('ovl_blaster', 'hero_idle_0', false, 100, 50, out)).toEqual({ x: 108, y: 56 });
  });

  it('is mirrored facing left: 16 - x - width', () => {
    expect(overlayAt('ovl_blaster', 'hero_idle_0', true, 100, 50, out)).toEqual({ x: 100 + 16 - 8 - 8, y: 56 });
    expect(overlayAt('ovl_pack', 'hero_idle_0', true, 100, 50, out)).toEqual({ x: 100 + 16 - 0 - 5, y: 55 });
    expect(overlayAt('thrust_flame', 'hero_thrust_0', true, 100, 50, out)).toEqual({ x: 100 + 16 - 0 - 6, y: 63 });
  });

  it('rides the body: one pixel up on the frames where the body is lifted', () => {
    expect(overlayAt('ovl_pack', 'hero_run_1', false, 0, 0, out)?.y).toBe(OVERLAY_OFFSET.ovl_pack.y - 1);
    expect(overlayAt('ovl_pack', 'hero_run_0', false, 0, 0, out)?.y).toBe(OVERLAY_OFFSET.ovl_pack.y);
    expect(overlayAt('ovl_blaster', 'hero_jump_0', false, 0, 0, out)?.y).toBe(OVERLAY_OFFSET.ovl_blaster.y - 1);
  });

  it('is not drawn once the hero has broken apart (overlayOffsetOn answers null)', () => {
    expect(overlayAt('ovl_pack', 'hero_die_0', false, 0, 0, out)).not.toBeNull();
    for (const frame of ['hero_die_1', 'hero_die_2', 'hero_die_3']) {
      for (const name of ['ovl_pack', 'ovl_blaster', 'thrust_flame'] as const) {
        expect(overlayAt(name, frame, false, 0, 0, out)).toBeNull();
      }
    }
  });

  it('the mini fuel bar is lit by the tank, rounded up, never beyond its length', () => {
    expect(fuelBarWidth(0, 80, 12)).toBe(0);
    expect(fuelBarWidth(1, 80, 12)).toBe(1);
    expect(fuelBarWidth(40, 80, 12)).toBe(6);
    expect(fuelBarWidth(80, 80, 12)).toBe(12);
    expect(fuelBarWidth(99, 80, 12)).toBe(12);
    expect(fuelBarWidth(5, 0, 12)).toBe(12);
  });
});

describe('the airlock pointer', () => {
  const INSET: EdgeInsets = { left: 12, right: 12, top: 32, bottom: 16 };
  const place = (col: number, row: number, camX: number, camY: number): PointerPlace | null =>
    airlockPointer(col, row, camX, camY, 284, 160, INSET, { x: 0, y: 0, dir: 'left' });

  it('is not shown while any part of the airlock is on screen', () => {
    expect(place(5, 5, 0, 0)).toBeNull();
    // One pixel of the cell still shows at the right edge: no pointer.
    expect(place(10, 2, 160 - 284 + 1, 0)).toBeNull();
  });

  it('points right from the right edge, at the airlock height when that is inside the band', () => {
    expect(place(30, 5, 0, 0)).toEqual({ x: 284 - 12, y: 5 * 16 + 8, dir: 'right' });
  });

  it('points left from the left edge', () => {
    expect(place(2, 4, 200, 0)).toEqual({ x: 12, y: 72, dir: 'left' });
  });

  it('points down or up when the airlock is below or above the view, and stays clear of the top bar', () => {
    expect(place(4, 20, 0, 0)).toEqual({ x: 72, y: 160 - 16, dir: 'down' });
    expect(place(4, 0, 0, 100)).toEqual({ x: 72, y: 32, dir: 'up' });
  });

  it('off on both axes: points along the axis where the airlock is further out', () => {
    expect(place(40, 11, 0, 0)?.dir).toBe('right'); // far right, a little low
    expect(place(18, 40, 0, 0)?.dir).toBe('down'); // a little right, far below
  });

  it('a cell flush with an edge shows nothing, so it is off screen and pointed at (level 7 after the cog: top exactly at 160)', () => {
    // Below: the cell's top is exactly the view's height (the review's case on the 284 x 160 view).
    expect(place(4, 10, 0, 0)).toEqual({ x: 72, y: 160 - 16, dir: 'down' });
    // Above: its bottom exactly at 0.
    expect(place(4, 4, 0, 80)?.dir).toBe('up');
    // Right: its left edge exactly at the view's width.
    expect(place(10, 5, 160 - 284, 0)?.dir).toBe('right');
    // Left: its right edge exactly at 0.
    expect(place(4, 5, 80, 0)?.dir).toBe('left');
    // One pixel in, on each edge: on screen.
    expect(place(4, 10, 0, 1)).toBeNull();
    expect(place(4, 4, 0, 79)).toBeNull();
    expect(place(10, 5, 160 - 284 + 1, 0)).toBeNull();
    expect(place(4, 5, 79, 0)).toBeNull();
  });

  it('a cell wholly under the top bar\'s strip counts as off screen when the strip is given', () => {
    const underStrip = (camY: number): PointerPlace | null =>
      airlockPointer(4, 4, 0, camY, 284, 160, INSET, { x: 0, y: 0, dir: 'left' }, 14);
    expect(underStrip(64 + 2)?.dir).toBe('up'); // the cell at y -2..14: only dimmed behind the bar
    expect(underStrip(64 - 1)).toBeNull(); // its bottom row is below the strip
  });
});

describe('the hero when the world stops for him', () => {
  it('at a level clear he settles into the airlock cell over EXIT_SETTLE_TICKS: centred, feet on its floor', () => {
    const out = { x: 0, y: 0 };
    // Level 1's case: frozen in mid-fall on the lintel, 15 px above the floor and a little off-centre.
    const from = { x: 117, y: 147 };
    const door = { col: 7, row: 10 };
    expect(exitDrawPos(from.x, from.y, door.col, door.row, 0, out)).toEqual(from);
    let last = { ...from };
    for (let t = 1; t <= EXIT_SETTLE_TICKS; t++) {
      const at = { ...exitDrawPos(from.x, from.y, door.col, door.row, t, out) };
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
      // Always moving toward the cell, never past it.
      expect(Math.abs(at.x - door.col * 16)).toBeLessThanOrEqual(Math.abs(last.x - door.col * 16));
      expect(Math.abs(at.y - door.row * 16)).toBeLessThanOrEqual(Math.abs(last.y - door.row * 16));
      last = at;
    }
    expect(last).toEqual({ x: door.col * 16, y: door.row * 16 });
    expect(exitDrawPos(from.x, from.y, door.col, door.row, 59, out)).toEqual({ x: 112, y: 160 });
  });

  it('a hero who walked in a little off-centre (levels 5 and 10) is centred too', () => {
    expect(exitDrawPos(400 - 9, 160, 25, 10, EXIT_SETTLE_TICKS, { x: 0, y: 0 })).toEqual({ x: 400, y: 160 });
  });

  it('a death by falling is drawn at the bottom edge of the view, whole, never lower', () => {
    // The camera stopped at the level's bottom (y 64 on a 160 px view of a 224 px level); he died at y 222.
    expect(fellDrawY(222, 64, 160)).toBe(64 + 160 - 16);
    // Already in the picture: unchanged.
    expect(fellDrawY(150, 64, 160)).toBe(150);
  });

  it("a death's flash is white for its first ticks whatever the cause, then the cause's colour", () => {
    for (let t = 0; t < DEATH_WHITE_TICKS; t++) {
      expect(deathFill('fire', t)).toBe('white');
      expect(deathFill('coolant', t)).toBe('white');
    }
    expect(deathFill('fire', DEATH_WHITE_TICKS)).toBe('amber');
    expect(deathFill('coolant', DEATH_WHITE_TICKS)).toBe('ice');
    expect(deathFill('spikes', DEATH_WHITE_TICKS)).toBe('white');
    expect(deathFill(null, 5)).toBe('white');
  });
});

describe('the Earth seen through the far-wall panels', () => {
  it('measures how much of its disc lies over open space', () => {
    const all = (): boolean => true;
    const none = (): boolean => false;
    expect(openShare(10, 10, 48, 0, 0, all)).toBe(1);
    expect(openShare(10, 10, 48, 0, 0, none)).toBe(0);
    // Space only in the left half of the view (columns 0 to 1): the disc at x 0..48 is half over it.
    const left = (col: number): boolean => col < 2;
    expect(openShare(8, 0, 48, 0, 0, left)).toBeCloseTo(0.5, 1);
    // One 2 x 2 window in the panels (level 9's case): a sliver, well under half.
    const window = (col: number, row: number): boolean => col === 3 && (row === 1 || row === 2);
    expect(openShare(16, 0, 48, 0, 0, window)).toBeLessThan(0.35);
    // The scroll moves the level, not the disc.
    expect(openShare(8, 0, 48, 32, 0, (col) => col >= 2 && col < 4)).toBeCloseTo(0.5, 1);
  });
});
