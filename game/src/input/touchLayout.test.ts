import { describe, expect, it } from 'vitest';

import type { TouchTuning } from '../core/types';
import { TUNING } from '../tuning';

import { REFERENCE_TOUCH } from './testkit';
import { CONTROL_IDS, centreOnDevicePx, hitTest, layoutControls, minimumPadSize, onPadZone, snapRect, toDevicePx } from './touchLayout';
import type { ControlId, ControlLayout, Rect, SafeInsets } from './touchLayout';

/**
 * The touch layout. The rules run on REFERENCE_TOUCH (src/input/testkit.ts), a frozen copy of the
 * `touch` group as the game shipped it, written against the fields (`T.moveButtonSize`, not 64), so
 * an owner's edit to src/tuning.ts cannot break them. The promises that must hold for any numbers
 * (each zone holds its buttons, a touch on a drawn button gets it, no flicker between neighbours)
 * are also proven on random touch numbers. Only the last block reads the live src/tuning.ts: it
 * fails when an edit makes two drawn buttons overlap, and says which fields to change.
 */

const T: TouchTuning = REFERENCE_TOUCH;
const ALL = { fire: true, thrust: true };
const HIDDEN = { fire: false, thrust: false };

/** The device table of docs/PHASER4-NOTES.md, section 6: [CSS width, CSS height, pixel ratio, notch left, notch right]. */
const DEVICE_ROWS: readonly (readonly [number, number, number, number, number])[] = [
  [568, 320, 2, 0, 0],
  [667, 375, 2, 0, 0],
  [667, 325, 2, 0, 0],
  [800, 360, 3, 0, 0],
  [844, 390, 3, 47, 47],
  [844, 390, 3, 0, 0],
  [915, 412, 2.625, 0, 0],
  [915, 412, 2.625, 30, 0],
  [932, 430, 3, 59, 59],
  [1080, 810, 2, 0, 0],
  [1280, 720, 1, 0, 0],
  [1920, 1080, 1, 0, 0],
  [3440, 1300, 1, 0, 0],
  [3000, 800, 1, 0, 0],
  [740, 360, 2.75, 0, 0],
  [851, 393, 3.5, 44, 0],
  [1366, 768, 1.25, 0, 0],
  [1536, 864, 1.5, 0, 0],
  [320, 568, 2, 0, 0], // a portrait window
  [740, 304, 2.75, 0, 0], // a browser tab with a toolbar
  [740, 280, 2.75, 0, 0], // toolbar and status bar
  [568, 232, 2, 0, 0], // a small phone with a toolbar
];

interface Screen {
  name: string;
  vw: number;
  vh: number;
  safe: SafeInsets;
}

const screen = (vw: number, vh: number, left: number, right: number, top = 0, bottom = 0): Screen => ({
  name: `${vw} x ${vh}, insets ${left}/${right}/${top}/${bottom}`,
  vw,
  vh,
  safe: { left, right, top, bottom },
});

/** The rows exactly as the table gives them. */
const TABLE: Screen[] = DEVICE_ROWS.map(([vw, vh, , left, right]) => screen(vw, vh, left, right));
/** The same windows with a home bar under them, and with the notch on the other side. */
const TABLE_VARIANTS: Screen[] = DEVICE_ROWS.flatMap(([vw, vh, , left, right]) => [
  screen(vw, vh, left, right),
  screen(vw, vh, left, right, 0, 21),
  screen(vw, vh, right, left, 0, 21),
  screen(vw, vh, Math.max(left, 47), Math.max(right, 47), 0, 21),
]);

const layoutOf = (s: Screen, t: TouchTuning = T): ControlLayout => layoutControls(s.vw, s.vh, s.safe, t);

const isRound = (id: ControlId): boolean => id === 'jump' || id === 'fire' || id === 'thrust';
const centre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const EPS = 1e-9;
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const within = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.h <= outer.y + outer.h + EPS;
const safeRect = (s: Screen): Rect => ({
  x: s.safe.left,
  y: s.safe.top,
  w: s.vw - s.safe.left - s.safe.right,
  h: s.vh - s.safe.top - s.safe.bottom,
});

/** Points spread over the drawn shape of a button: its square, or the circle inside it. */
function pointsOn(id: ControlId, r: Rect): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      // Stay a hair inside: the right and bottom edges themselves belong to the neighbour.
      const x = r.x + (r.w * (i + 0.001)) / (n + 0.002);
      const y = r.y + (r.h * (j + 0.001)) / (n + 0.002);
      if (isRound(id)) {
        const c = centre(r);
        if (Math.hypot(x - c.x, y - c.y) > r.w / 2) continue;
      }
      points.push({ x, y });
    }
  }
  return points;
}

/** How many CSS px the area that answers to `id` extends along one axis through the button's centre. */
function hitExtent(l: ControlLayout, s: Screen, id: ControlId, axis: 'x' | 'y'): number {
  const c = centre(l.buttons[id]);
  const at = (d: number): ControlId | null => (axis === 'x' ? hitTest(l, ALL, c.x + d, c.y, null) : hitTest(l, ALL, c.x, c.y + d, null));
  const limit = Math.max(s.vw, s.vh);
  let before = 0;
  while (before < limit && at(-(before + 1)) === id) before++;
  let after = 0;
  while (after < limit && at(after + 1) === id) after++;
  return before + after + 1;
}

/** The hit size the tuning asks for: the drawn size of a button, and PAUSE's enlarged hit size. */
const TUNED_HIT: Record<ControlId, number> = {
  left: T.moveButtonSize,
  right: T.moveButtonSize,
  jump: T.jumpButtonSize,
  fire: T.fireButtonSize,
  thrust: T.thrustButtonSize,
  pause: T.pauseHitSize,
};

/** A small seeded generator, so the sampled cases are the same on every run. */
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

/** Every pair of buttons that share an area, as readable names. */
function overlappingPairs(l: ControlLayout): string[] {
  const out: string[] = [];
  for (const a of CONTROL_IDS) {
    for (const b of CONTROL_IDS) {
      if (a < b && overlaps(l.buttons[a], l.buttons[b])) out.push(`${a} and ${b}`);
    }
  }
  return out;
}

/**
 * Points of drawn buttons that answer to another control although they lie more than the hysteresis
 * inside the button: for a new touch every point must answer, for a finger that held anything else
 * every point at least `splitHysteresis` inside.
 */
function deepMisses(l: ControlLayout, name = ''): string[] {
  const out: string[] = [];
  for (const id of CONTROL_IDS) {
    const r = l.buttons[id];
    const c = centre(r);
    const deep = (p: { x: number; y: number }): boolean =>
      isRound(id)
        ? Math.hypot(p.x - c.x, p.y - c.y) <= r.w / 2 - l.splitHysteresis - EPS
        : p.x >= r.x + l.splitHysteresis && p.x <= r.x + r.w - l.splitHysteresis && p.y >= r.y + l.splitHysteresis && p.y <= r.y + r.h - l.splitHysteresis;
    for (const prev of [null, ...CONTROL_IDS]) {
      const points = pointsOn(id, r).filter((p) => prev === null || prev === id || deep(p));
      const missed = points.filter((p) => hitTest(l, ALL, p.x, p.y, prev) !== id).length;
      if (missed > 0) out.push(`${name}: ${missed} points on ${id} do not answer to it for a finger that held ${String(prev)}`);
    }
  }
  return out;
}

/**
 * The buttons a finger sees, in order, as it slides from the centre of `from` to the centre of `to`
 * in 200 steps, wobbling `wobble` px back and forth along the way as a real thumb does.
 */
function slideSeen(l: ControlLayout, from: ControlId, to: ControlId, wobble: number): ControlId[] {
  const a = centre(l.buttons[from]);
  const b = centre(l.buttons[to]);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const seen: ControlId[] = [];
  let prev: ControlId | null = null;
  for (let i = 0; i <= 200; i++) {
    const f = Math.min(1, Math.max(0, i / 200 + (i % 2 === 0 ? 1 : -1) * (wobble / length)));
    prev = hitTest(l, ALL, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, prev);
    if (prev !== null && seen[seen.length - 1] !== prev) seen.push(prev);
  }
  return seen;
}

/** The checks that must hold on any window at all, for any touch numbers whose buttons do not overlap. Returns what is wrong, in words. */
function problems(s: Screen, t: TouchTuning = T): string[] {
  const l = layoutOf(s, t);
  const out: string[] = overlappingPairs(l).map((pair) => `${pair} overlap`);
  for (const id of CONTROL_IDS) {
    if (!within(l.buttons[id], safeRect(s))) out.push(`${id} leaves the safe area`);
    const missed = pointsOn(id, l.buttons[id]).filter((p) => hitTest(l, ALL, p.x, p.y, null) !== id);
    if (missed.length > 0) out.push(`${missed.length} points on the drawn ${id} button do not answer to it`);
  }
  if (overlaps(l.moveZone, l.actionZone)) out.push('the move zone and the action zone overlap');
  if (!within(l.buttons.left, l.moveZone) || !within(l.buttons.right, l.moveZone)) out.push('LEFT or RIGHT is outside the move zone');
  for (const id of ['jump', 'fire', 'thrust'] as const) {
    if (!within(l.buttons[id], l.actionZone)) out.push(`${id} is outside the action zone`);
  }
  if (!(l.scale > 0 && l.scale <= 1)) out.push(`scale is ${l.scale}`);
  return out.map((p) => `${s.name}: ${p}`);
}

describe('layoutControls: where the buttons are', () => {
  const phones = [screen(568, 320, 0, 0), screen(667, 375, 0, 0, 0, 21), screen(844, 390, 47, 47, 0, 21), screen(932, 430, 59, 59, 0, 21)];

  it.each(phones)('$name: every button sits at its tuned size and margins from the safe edges', (s) => {
    const l = layoutOf(s);
    const right = s.vw - s.safe.right;
    const bottom = s.vh - s.safe.bottom;
    expect(l.scale).toBe(1);
    expect(l.buttons.left).toEqual({
      x: s.safe.left + T.moveMarginSide,
      y: bottom - T.moveMarginBottom - T.moveButtonSize,
      w: T.moveButtonSize,
      h: T.moveButtonSize,
    });
    expect(l.buttons.right).toEqual({
      x: s.safe.left + T.moveMarginSide + T.moveButtonSize + T.moveButtonGap,
      y: bottom - T.moveMarginBottom - T.moveButtonSize,
      w: T.moveButtonSize,
      h: T.moveButtonSize,
    });
    expect(l.buttons.jump).toEqual({
      x: right - T.jumpMarginSide - T.jumpButtonSize,
      y: bottom - T.jumpMarginBottom - T.jumpButtonSize,
      w: T.jumpButtonSize,
      h: T.jumpButtonSize,
    });
    expect(l.buttons.fire).toEqual({
      x: right - T.fireMarginSide - T.fireButtonSize,
      y: bottom - T.fireMarginBottom - T.fireButtonSize,
      w: T.fireButtonSize,
      h: T.fireButtonSize,
    });
    expect(l.buttons.thrust).toEqual({
      x: right - T.thrustMarginSide - T.thrustButtonSize,
      y: bottom - T.thrustMarginBottom - T.thrustButtonSize,
      w: T.thrustButtonSize,
      h: T.thrustButtonSize,
    });
    expect(l.buttons.pause).toEqual({
      x: right - T.pauseMarginSide - T.pauseButtonSize,
      y: s.safe.top + T.pauseMarginTop,
      w: T.pauseButtonSize,
      h: T.pauseButtonSize,
    });
    expect(l.splitX).toBe(s.safe.left + T.moveMarginSide + T.moveButtonSize + T.moveButtonGap / 2);
  });

  it("in a level without a thruster pack, FIRE takes THRUST's place (the slot beside JUMP), and its zone still holds it", () => {
    for (const s of TABLE) {
      const l = layoutControls(s.vw, s.vh, s.safe, T, { fireBesideJump: true });
      const right = s.vw - s.safe.right;
      const bottom = s.vh - s.safe.bottom;
      if (l.scale < 1) continue;
      expect(l.buttons.fire, s.name).toEqual({
        x: right - T.thrustMarginSide - T.fireButtonSize,
        y: bottom - T.thrustMarginBottom - T.fireButtonSize,
        w: T.fireButtonSize,
        h: T.fireButtonSize,
      });
      // Everything else where it always is.
      const both = layoutOf(s);
      for (const id of ['left', 'right', 'jump', 'thrust', 'pause'] as const) expect(l.buttons[id], `${s.name} ${id}`).toEqual(both.buttons[id]);
      const f = l.buttons.fire;
      const z = l.actionZone;
      expect(f.x >= z.x && f.y >= z.y && f.x + f.w <= z.x + z.w && f.y + f.h <= z.y + z.h, `${s.name}: FIRE inside the action zone`).toBe(true);
      expect(hitTest(l, { fire: true, thrust: false }, f.x + f.w / 2, f.y + f.h / 2, null), s.name).toBe('fire');
    }
  });

  it('puts LEFT and RIGHT bottom-left, JUMP bottom-right, FIRE left of JUMP, THRUST above JUMP and PAUSE on top', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      const b = l.buttons;
      const mid = { x: s.vw / 2, y: s.vh / 2 };
      expect(centre(b.left).x, s.name).toBeLessThan(centre(b.right).x);
      expect(centre(b.right).x, s.name).toBeLessThan(mid.x);
      expect(centre(b.left).y, s.name).toBeGreaterThan(mid.y);
      expect(centre(b.jump).x, s.name).toBeGreaterThan(mid.x);
      expect(centre(b.jump).y, s.name).toBeGreaterThan(mid.y);
      expect(centre(b.fire).x, s.name).toBeLessThan(b.jump.x);
      expect(centre(b.thrust).y, s.name).toBeLessThan(b.jump.y);
      expect(centre(b.pause).y, s.name).toBeLessThan(mid.y);
      expect(b.pause.y + b.pause.h, s.name).toBeLessThanOrEqual(b.thrust.y);
    }
  });

  it('moves every button in by the safe-area insets and nothing else', () => {
    const plain = layoutControls(844, 390, { left: 0, right: 0, top: 0, bottom: 0 }, T);
    const notched = layoutControls(844, 390, { left: 47, right: 31, top: 5, bottom: 21 }, T);
    for (const id of ['left', 'right'] as const) {
      expect(notched.buttons[id].x - plain.buttons[id].x).toBe(47);
      expect(notched.buttons[id].y - plain.buttons[id].y).toBe(-21);
    }
    for (const id of ['jump', 'fire', 'thrust'] as const) {
      expect(notched.buttons[id].x - plain.buttons[id].x).toBe(-31);
      expect(notched.buttons[id].y - plain.buttons[id].y).toBe(-21);
    }
    expect(notched.buttons.pause.x - plain.buttons.pause.x).toBe(-31);
    expect(notched.buttons.pause.y - plain.buttons.pause.y).toBe(5);
  });
});

describe('layoutControls and hitTest on the device table (docs/PHASER4-NOTES.md, section 6)', () => {
  it('buttons never overlap, never leave the safe area, and every point of a drawn button answers to it', () => {
    expect(TABLE_VARIANTS.flatMap((s) => problems(s))).toEqual([]);
  });

  it('every hit area is at least its tuned size, on every row', () => {
    const tooSmall: string[] = [];
    for (const s of TABLE) {
      const l = layoutOf(s);
      for (const id of CONTROL_IDS) {
        for (const axis of ['x', 'y'] as const) {
          const extent = hitExtent(l, s, id, axis);
          if (extent < TUNED_HIT[id]) tooSmall.push(`${s.name}: ${id} reacts over ${extent} px along ${axis}, tuned ${TUNED_HIT[id]}`);
        }
      }
    }
    expect(tooSmall).toEqual([]);
  });

  it('draws the buttons at their tuned size on every landscape row of full height (a phone in full screen, a desktop)', () => {
    const need = minimumPadSize(T);
    const shrunk = TABLE_VARIANTS.filter((s) => s.vw > s.vh && s.vh >= 320 && layoutOf(s).scale < 1).map(
      (s) => `${s.name}: the pad needs ${need.w} x ${need.h} CSS px of safe area and is drawn at ${Math.round(layoutOf(s).scale * 100)} %`,
    );
    expect(shrunk).toEqual([]);
    // The rows left out are short browser-tab windows and the portrait window: there the pad may
    // shrink as a whole (never below what the tests above and below allow).
    for (const s of TABLE_VARIANTS) expect(layoutOf(s).scale, s.name).toBeGreaterThan(0.5);
  });

  it('the slop reaches the screen edges and corners, and the middle of the screen is nobody\'s', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      expect(hitTest(l, ALL, 0, s.vh - 1, null), s.name).toBe('left');
      expect(hitTest(l, ALL, s.vw - 1, s.vh - 1, null), s.name).toBe('jump');
      expect(hitTest(l, ALL, s.vw - 1, 0, null), s.name).toBe('pause');
      expect(hitTest(l, ALL, s.vw / 2, s.vh / 2, null), s.name).toBe(null);
      // Outside the drawn button, toward the middle of the screen, still counts.
      const { left, right, fire } = l.buttons;
      expect(hitTest(l, ALL, left.x + left.w / 2, (l.moveZone.y + left.y) / 2, null), s.name).toBe('left');
      expect(hitTest(l, ALL, (right.x + right.w + l.moveZone.x + l.moveZone.w) / 2, right.y + right.h / 2, null), s.name).toBe('right');
      expect(hitTest(l, ALL, (l.actionZone.x + fire.x) / 2, fire.y + fire.h / 2, null), s.name).toBe('fire');
    }
  });

  it('onPadZone is true exactly where hitTest finds a control', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      for (let x = 0; x < s.vw; x += 7) {
        for (let y = 0; y < s.vh; y += 7) {
          expect(onPadZone(l, x, y), `${s.name} at ${x}, ${y}`).toBe(hitTest(l, ALL, x, y, null) !== null);
        }
      }
    }
  });
});

describe('hitTest: sliding between LEFT and RIGHT', () => {
  it('a finger sliding from LEFT to RIGHT (or back) is always on one of them and switches exactly once', () => {
    const random = seeded(20261121);
    const pick = (r: Rect): { x: number; y: number } => ({ x: r.x + random() * r.w * 0.999, y: r.y + random() * r.h * 0.999 });
    let slides = 0;
    for (const s of TABLE_VARIANTS) {
      const l = layoutOf(s);
      for (const [from, to] of [['left', 'right'], ['right', 'left']] as const) {
        for (let n = 0; n < 25; n++) {
          const a = pick(l.buttons[from]);
          const b = pick(l.buttons[to]);
          const steps = 1 + Math.floor(random() * 60);
          let prev: ControlId | null = null;
          let switches = 0;
          for (let i = 0; i <= steps; i++) {
            const on = hitTest(l, ALL, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, prev);
            expect(on === 'left' || on === 'right', `${s.name}: step ${i} of ${steps} is on ${String(on)}`).toBe(true);
            if (prev !== null && on !== prev) switches++;
            prev = on;
          }
          expect(prev, s.name).toBe(to);
          expect(switches, s.name).toBe(1);
          slides++;
        }
      }
    }
    expect(slides).toBeGreaterThan(4000);
  });

  it('a thumb resting on the split does not flicker: it must cross by the hysteresis to switch', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      const y = centre(l.buttons.left).y;
      const h = l.splitHysteresis;
      expect(h, s.name).toBeGreaterThan(0);
      expect(h, s.name).toBeLessThanOrEqual(T.moveSplitHysteresis);
      // A new touch takes the side it lands on.
      expect(hitTest(l, ALL, l.splitX - 0.5, y, null), s.name).toBe('left');
      expect(hitTest(l, ALL, l.splitX + 0.5, y, null), s.name).toBe('right');
      // A held one keeps its side until it has crossed the middle by h.
      expect(hitTest(l, ALL, l.splitX + h - 0.5, y, 'left'), s.name).toBe('left');
      expect(hitTest(l, ALL, l.splitX + h, y, 'left'), s.name).toBe('right');
      expect(hitTest(l, ALL, l.splitX - h, y, 'right'), s.name).toBe('right');
      expect(hitTest(l, ALL, l.splitX - h - 0.5, y, 'right'), s.name).toBe('left');
      // Wobbling by less than h around the middle never changes the answer.
      let on: ControlId | null = 'left';
      for (let i = 0; i < 40; i++) {
        on = hitTest(l, ALL, l.splitX + (i % 2 === 0 ? 1 : -1) * (h - 0.25), y, on);
        expect(on, s.name).toBe('left');
      }
    }
  });
});

describe('hitTest: JUMP, FIRE and THRUST', () => {
  it('FIRE and THRUST are dead while hidden: the whole action zone is JUMP', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      const z = l.actionZone;
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const x = z.x + (z.w * (i + 0.01)) / 20.02;
          const y = z.y + (z.h * (j + 0.01)) / 20.02;
          for (const prev of [null, 'jump', 'fire', 'thrust'] as const) {
            const on = hitTest(l, HIDDEN, x, y, prev);
            expect(on === 'jump' || on === 'pause', `${s.name}: (${x}, ${y}) is on ${String(on)}`).toBe(true);
          }
        }
      }
      const fire = centre(l.buttons.fire);
      const thrust = centre(l.buttons.thrust);
      expect(hitTest(l, HIDDEN, fire.x, fire.y, null), s.name).toBe('jump');
      expect(hitTest(l, HIDDEN, thrust.x, thrust.y, null), s.name).toBe('jump');
      expect(hitTest(l, { fire: true, thrust: false }, fire.x, fire.y, null), s.name).toBe('fire');
      expect(hitTest(l, { fire: true, thrust: false }, thrust.x, thrust.y, null), s.name).toBe('jump');
      expect(hitTest(l, { fire: false, thrust: true }, thrust.x, thrust.y, null), s.name).toBe('thrust');
    }
  });

  it('a finger sliding from JUMP to THRUST or FIRE ends on that button, with one switch and no flicker on the way', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      for (const to of ['thrust', 'fire'] as const) {
        expect(slideSeen(l, 'jump', to, 1.5), s.name).toEqual(['jump', to]);
        expect(slideSeen(l, to, 'jump', 1.5), s.name).toEqual([to, 'jump']);
      }
    }
  });

  it('with the shipped numbers a finger on a drawn button always gets that button, whatever it held before', () => {
    // The action buttons' rims are more than twice the hysteresis apart, so no border band reaches into a drawn button.
    for (const s of TABLE_VARIANTS) {
      const l = layoutOf(s);
      const wrong: string[] = [];
      for (const id of CONTROL_IDS) {
        for (const prev of CONTROL_IDS) {
          const missed = pointsOn(id, l.buttons[id]).filter((p) => hitTest(l, ALL, p.x, p.y, prev) !== id).length;
          if (missed > 0) wrong.push(`${s.name}: ${missed} points on ${id} do not answer to it for a finger that held ${prev}`);
        }
      }
      expect(wrong).toEqual([]);
    }
  });

  it('however large the hysteresis, a new touch gets the drawn button, and a sliding finger reaches no deeper than the hysteresis into one', () => {
    // A wide gap and a huge hysteresis: stickier than the distance between the action buttons' rims.
    const sticky = { ...T, moveButtonGap: T.moveButtonGap * 4, moveSplitHysteresis: T.moveButtonSize * 2 };
    const l = layoutControls(932, 430, { left: 0, right: 0, top: 0, bottom: 0 }, sticky);
    expect(l.splitHysteresis).toBe(sticky.moveButtonGap / 2);
    expect(deepMisses(l)).toEqual([]);
    // LEFT, RIGHT and PAUSE keep the stronger promise: every point, whatever the finger held.
    for (const id of ['left', 'right', 'pause'] as const) {
      for (const prev of CONTROL_IDS) {
        expect(pointsOn(id, l.buttons[id]).filter((p) => hitTest(l, ALL, p.x, p.y, prev) !== id), `${id} after ${prev}`).toEqual([]);
      }
    }
  });

  it('a thumb resting on the seam of two action buttons that touch does not flicker between them', () => {
    // JUMP grown until its rim nearly touches THRUST's (the review's case: 0.3 px apart at 568 x 320).
    const tight = { ...T, jumpButtonSize: 90 };
    const l = layoutControls(568, 320, { left: 0, right: 0, top: 0, bottom: 0 }, tight);
    const jump = centre(l.buttons.jump);
    const thrust = centre(l.buttons.thrust);
    const gap = Math.hypot(thrust.x - jump.x, thrust.y - jump.y) - l.buttons.jump.w / 2 - l.buttons.thrust.w / 2;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(1);
    expect(slideSeen(l, 'jump', 'thrust', 1.5)).toEqual(['jump', 'thrust']);
    expect(slideSeen(l, 'thrust', 'jump', 1.5)).toEqual(['thrust', 'jump']);
  });

  it('a held button whose item disappears is let go of at once', () => {
    const l = layoutOf(screen(844, 390, 0, 0));
    const fire = centre(l.buttons.fire);
    expect(hitTest(l, ALL, fire.x, fire.y, 'fire')).toBe('fire');
    expect(hitTest(l, HIDDEN, fire.x, fire.y, 'fire')).toBe('jump');
  });
});

describe('layoutControls on windows of any size', () => {
  it('never lets buttons overlap or leave the safe area, down to windows far too small for the pad', () => {
    const random = seeded(7);
    const failures: string[] = [];
    let cases = 0;
    for (let n = 0; n < 4000; n++) {
      const vw = 80 + Math.floor(random() * 1900);
      const vh = 60 + Math.floor(random() * 1100);
      const inset = (): number => (random() < 0.5 ? 0 : Math.floor(random() * 60));
      const s = screen(vw, vh, inset(), inset(), random() < 0.8 ? 0 : inset(), inset());
      if (s.vw - s.safe.left - s.safe.right < 40 || s.vh - s.safe.top - s.safe.bottom < 40) continue;
      failures.push(...problems(s));
      cases++;
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(cases).toBeGreaterThan(3500);
  });

  it('is at full size exactly when the safe area is at least minimumPadSize', () => {
    const need = minimumPadSize(T);
    const none = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(layoutControls(need.w, need.h, none, T).scale).toBe(1);
    expect(layoutControls(need.w - 1, need.h, none, T).scale).toBeLessThan(1);
    expect(layoutControls(need.w, need.h - 1, none, T).scale).toBeLessThan(1);
    expect(layoutControls(need.w + 40, need.h + 21, { left: 40, right: 0, top: 0, bottom: 21 }, T).scale).toBe(1);
    // Half the room: everything is half the size, in the same arrangement.
    const full = layoutControls(need.w, need.h, none, T);
    const half = layoutControls(need.w / 2, need.h / 2, none, T);
    expect(half.scale).toBe(0.5);
    for (const id of CONTROL_IDS) {
      expect(half.buttons[id].w).toBeCloseTo(full.buttons[id].w / 2, 9);
      expect(half.buttons[id].x).toBeCloseTo(full.buttons[id].x / 2, 9);
      expect(half.buttons[id].y).toBeCloseTo(full.buttons[id].y / 2, 9);
    }
  });

  it('does not throw and makes nothing negative when the insets swallow the window', () => {
    const l = layoutControls(100, 80, { left: 60, right: 60, top: 50, bottom: 50 }, T);
    expect(l.scale).toBe(0);
    for (const id of CONTROL_IDS) expect(l.buttons[id].w).toBe(0);
    for (const zone of [l.moveZone, l.actionZone, l.pauseZone]) {
      expect(zone.w).toBeGreaterThanOrEqual(0);
      expect(zone.h).toBeGreaterThanOrEqual(0);
    }
  });
});

/** Random touch numbers, from cramped to generous, as an owner might try them. */
function randomTouch(random: () => number): TouchTuning {
  const int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  const size = (): number => int(24, 110);
  return {
    ...T,
    moveButtonSize: size(),
    moveMarginSide: int(0, 60),
    moveMarginBottom: int(0, 60),
    moveButtonGap: int(0, 40),
    moveZoneWidth: int(0, 320),
    moveZoneHeight: int(0, 260),
    moveSplitHysteresis: int(0, 30),
    jumpButtonSize: size(),
    jumpMarginSide: int(0, 60),
    jumpMarginBottom: int(0, 60),
    fireButtonSize: size(),
    fireMarginSide: int(60, 220),
    fireMarginBottom: int(0, 60),
    thrustButtonSize: size(),
    thrustMarginSide: int(0, 60),
    thrustMarginBottom: int(60, 220),
    actionZoneSize: int(0, 320),
    pauseButtonSize: int(20, 60),
    pauseHitSize: int(20, 90),
    pauseMarginTop: int(0, 30),
    pauseMarginSide: int(0, 30),
  };
}

describe('layoutControls and hitTest on random touch numbers (any edit an owner might make)', () => {
  const random = seeded(20261124);
  const cases: { t: TouchTuning; s: Screen; name: string }[] = [];
  let overlapping = 0;
  for (let n = 0; n < 600; n++) {
    const t = randomTouch(random);
    const row = TABLE_VARIANTS[Math.floor(random() * TABLE_VARIANTS.length)];
    if (!row) continue;
    const s = random() < 0.7 ? row : screen(300 + Math.floor(random() * 1200), 200 + Math.floor(random() * 700), 0, 0, 0, 0);
    // Numbers that put two drawn buttons on top of each other are refused by the live check below.
    if (overlappingPairs(layoutOf(s, t)).length > 0) {
      overlapping++;
      continue;
    }
    cases.push({ t, s, name: `${s.name}, touch ${JSON.stringify(t)}` });
  }

  it('enough of the random numbers give a pad whose buttons do not overlap', () => {
    expect(cases.length).toBeGreaterThan(300);
    expect(overlapping).toBeGreaterThan(0); // the generator does reach the bad edits, which the live check names
  });

  it('each zone holds its drawn buttons whole and every point of a drawn button answers to it on a new touch', () => {
    const found = cases.flatMap(({ t, s }) => problems(s, t).map((p) => `${p} (touch ${JSON.stringify(t)})`));
    expect(found.slice(0, 5)).toEqual([]);
  });

  it('a finger that held something else gets a drawn button once it is the hysteresis inside it', () => {
    const found = cases.flatMap(({ t, s, name }) => deepMisses(layoutOf(s, t), name));
    expect(found.slice(0, 5)).toEqual([]);
  });

  it('a slide between two buttons, wobbling by less than the hysteresis, never returns to a button it has just left', () => {
    const found: string[] = [];
    for (const { t, s, name } of cases) {
      const l = layoutOf(s, t);
      const wobble = Math.min(1.5, 0.9 * l.splitHysteresis);
      const pairs: [ControlId, ControlId][] = [
        ['left', 'right'],
        ['jump', 'thrust'],
        ['jump', 'fire'],
        ['fire', 'thrust'],
      ];
      for (const [a, b] of pairs) {
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          const seen = slideSeen(l, from, to, wobble);
          // LEFT and RIGHT are neighbours: exactly one switch. A slide between two action buttons
          // may pass over the third; it must still never go back to the one it has just left.
          const flicker = seen.some((id, i) => i >= 2 && seen[i - 2] === id);
          const ok = a === 'left' ? seen.length === 2 : !flicker;
          if (!ok || seen[0] !== from || seen[seen.length - 1] !== to) found.push(`${name}: ${from} to ${to} saw ${seen.join(', ')}`);
        }
      }
    }
    expect(found.slice(0, 5)).toEqual([]);
  });
});

/** The fields of src/tuning.ts that place each button, for messages the owner can act on. */
const PLACED_BY: Record<ControlId, string> = {
  left: 'moveButtonSize, moveMarginSide, moveMarginBottom, moveButtonGap',
  right: 'moveButtonSize, moveMarginSide, moveMarginBottom, moveButtonGap',
  jump: 'jumpButtonSize, jumpMarginSide, jumpMarginBottom',
  fire: 'fireButtonSize, fireMarginSide, fireMarginBottom',
  thrust: 'thrustButtonSize, thrustMarginSide, thrustMarginBottom',
  pause: 'pauseButtonSize, pauseMarginTop, pauseMarginSide',
};

describe('the live touch numbers of src/tuning.ts', () => {
  it('draw no two buttons on top of each other', () => {
    const live = TUNING.touch;
    const firstSeen = new Map<string, string>(); // 'a and b' -> the first screen where they overlap
    for (const s of TABLE) {
      const l = layoutOf(s, live);
      for (const a of CONTROL_IDS) {
        for (const b of CONTROL_IDS) {
          if (a < b && overlaps(l.buttons[a], l.buttons[b]) && !firstSeen.has(`${a} ${b}`)) firstSeen.set(`${a} ${b}`, s.name);
        }
      }
    }
    const messages = [...firstSeen].map(([pair, where]) => {
      const [a = 'left', b = 'right'] = pair.split(' ') as ControlId[];
      return (
        `src/tuning.ts, group touch: ${a.toUpperCase()} and ${b.toUpperCase()} are drawn on top of each other (for example on a ${where} screen), ` +
        `so part of one answers to the other. Move them apart with their fields (${a}: ${PLACED_BY[a]}; ${b}: ${PLACED_BY[b]}) or make one smaller.`
      );
    });
    expect(messages.join('\n')).toBe('');
  });
});

describe('drawing on whole device pixels (the glyphs are pixel art)', () => {
  const RATIOS = [1, 1.5, 2, 2.625, 2.75, 3, 3.5, 4.5];
  const whole = (cssPx: number, dpr: number): boolean => Math.abs(cssPx * dpr - Math.round(cssPx * dpr)) < 1e-6;

  it('every drawn button of every row of the device table has its four edges on device pixels, within half a pixel of the layout', () => {
    for (const s of TABLE) {
      const l = layoutOf(s);
      for (const dpr of RATIOS) {
        for (const id of CONTROL_IDS) {
          const b = l.buttons[id];
          const r = snapRect(b, dpr);
          for (const v of [r.x, r.y, r.x + r.w, r.y + r.h]) expect(whole(v, dpr), `${s.name} ${id} at ${dpr}`).toBe(true);
          expect(Math.abs(r.x - b.x)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
          expect(Math.abs(r.x + r.w - (b.x + b.w))).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        }
      }
    }
  });

  it('a glyph centred in a button lands on device pixels, at most half a device pixel off the true centre', () => {
    for (const dpr of RATIOS) {
      for (const space of [60, 64, 76, 36, 59.27]) {
        for (const glyph of [16, 22, 33]) {
          const s = toDevicePx(space, dpr);
          const g = toDevicePx(glyph, dpr); // pixelCanvas makes glyphs a whole number of device px
          const at = centreOnDevicePx(s, g, dpr);
          expect(whole(at, dpr), `${space} ${glyph} at ${dpr}`).toBe(true);
          expect(Math.abs(at - (s - g) / 2)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        }
      }
    }
  });

  it('the review\'s case: 740 x 360 at 2.75 put the FIRE glyph at device x 1602.004; now on a whole device pixel', () => {
    expect(whole(toDevicePx(1602.004 / 2.75, 2.75), 2.75)).toBe(true);
    expect(toDevicePx(1602.004 / 2.75, 2.75) * 2.75).toBeCloseTo(1602, 6);
  });
});
