import { describe, expect, it } from 'vitest';

import { Controls } from './Controls';
import { REFERENCE_TOUCH } from './testkit';
import { PointerTracker } from './TouchPad';
import { layoutControls } from './touchLayout';
import type { ControlId, ControlLayout, Rect } from './touchLayout';

/**
 * The pointer tracker of the touch pad, without a browser: the same sequences the browser proof
 * drives with real touches (two fingers, a slide, a tap shorter than a tick, cancel, PAUSE).
 * The DOM half of TouchPad.ts is proven in a real browser (e2e/touch.spec.ts). The layout is the
 * shipped one (REFERENCE_TOUCH), so an edit to src/tuning.ts cannot break these tests.
 */

const NOTHING = { left: false, right: false, jump: false, fire: false, thrust: false };

interface Rig {
  controls: Controls;
  tracker: PointerTracker;
  layout: ControlLayout;
  pauses: number;
  lit: ControlId[];
  at: (id: ControlId) => { x: number; y: number };
}

function rig(): Rig {
  const controls = new Controls();
  const layout = layoutControls(844, 390, { left: 0, right: 0, top: 0, bottom: 0 }, REFERENCE_TOUCH);
  const centre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const out: Rig = {
    controls,
    layout,
    pauses: 0,
    lit: [],
    at: (id) => centre(layout.buttons[id]),
    tracker: new PointerTracker(
      controls,
      () => {
        out.pauses++;
      },
      (pressed) => {
        out.lit = [...pressed].sort();
      },
    ),
  };
  out.tracker.setLayout(layout);
  return out;
}

describe('PointerTracker', () => {
  it('does nothing before it has a layout', () => {
    const controls = new Controls();
    const tracker = new PointerTracker(controls, () => undefined);
    tracker.down(1, 50, 350);
    expect(tracker.count).toBe(0);
    expect(controls.consume()).toEqual(NOTHING);
  });

  it('two fingers at once: hold RIGHT, tap JUMP', () => {
    const r = rig();
    const right = r.at('right');
    const jump = r.at('jump');
    r.tracker.down(0, right.x, right.y);
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
    r.tracker.down(1, jump.x, jump.y);
    expect(r.lit).toEqual(['jump', 'right']);
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true, jump: true });
    r.tracker.up(1);
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
    expect(r.lit).toEqual(['right']);
    r.tracker.up(0);
    expect(r.controls.consume()).toEqual(NOTHING);
    expect(r.tracker.count).toBe(0);
  });

  it('a slide from LEFT to RIGHT without lifting: every tick has exactly one of the two', () => {
    const r = rig();
    const from = r.at('left');
    const to = r.at('right');
    r.tracker.down(0, from.x, from.y);
    const seen: string[] = [];
    for (let i = 0; i <= 40; i++) {
      r.tracker.move(0, from.x + ((to.x - from.x) * i) / 40, from.y);
      const input = r.controls.consume();
      expect(input.left !== input.right).toBe(true);
      const side = input.left ? 'left' : 'right';
      if (seen[seen.length - 1] !== side) seen.push(side);
    }
    expect(seen).toEqual(['left', 'right']);
    r.tracker.up(0);
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('a slide off every zone lets go, and sliding back takes hold again', () => {
    const r = rig();
    const left = r.at('left');
    r.tracker.down(0, left.x, left.y);
    r.tracker.move(0, 422, 150);
    expect(r.controls.held()).toEqual(NOTHING);
    expect(r.lit).toEqual([]);
    r.tracker.move(0, left.x, left.y);
    expect(r.controls.held()).toEqual({ ...NOTHING, left: true });
  });

  it('a tap that begins and ends between two ticks still gives one press', () => {
    const r = rig();
    const jump = r.at('jump');
    r.tracker.down(0, jump.x, jump.y);
    r.tracker.up(0);
    expect(r.controls.consume()).toEqual({ ...NOTHING, jump: true });
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('two fingers on LEFT and RIGHT: the later one wins, and the first returns when it lifts', () => {
    const r = rig();
    const left = r.at('left');
    const right = r.at('right');
    r.tracker.down(0, left.x, left.y);
    r.controls.consume();
    r.tracker.down(1, right.x, right.y);
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
    r.tracker.up(1);
    expect(r.controls.consume()).toEqual({ ...NOTHING, left: true });
  });

  it('two fingers on one button: it stays held until both are lifted', () => {
    const r = rig();
    const jump = r.at('jump');
    r.tracker.down(0, jump.x, jump.y);
    r.tracker.down(1, jump.x + 5, jump.y);
    r.tracker.up(0);
    expect(r.controls.held().jump).toBe(true);
    r.tracker.up(1);
    expect(r.controls.held().jump).toBe(false);
  });

  it('FIRE and THRUST are dead while hidden: a tap where FIRE will be jumps', () => {
    const r = rig();
    const fire = r.at('fire');
    const thrust = r.at('thrust');
    r.tracker.down(0, fire.x, fire.y);
    r.tracker.down(1, thrust.x, thrust.y);
    expect(r.controls.consume()).toEqual({ ...NOTHING, jump: true });
    r.tracker.move(0, fire.x + 3, fire.y + 3);
    r.tracker.up(0);
    r.tracker.up(1);
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('with the items held FIRE fires and THRUST thrusts; a slide from JUMP to THRUST switches', () => {
    const r = rig();
    r.tracker.setShown(true, true);
    const fire = r.at('fire');
    const jump = r.at('jump');
    const thrust = r.at('thrust');
    r.tracker.down(0, fire.x, fire.y);
    expect(r.controls.consume()).toEqual({ ...NOTHING, fire: true });
    r.tracker.up(0);
    r.tracker.down(1, jump.x, jump.y);
    expect(r.controls.consume()).toEqual({ ...NOTHING, jump: true });
    for (let i = 1; i <= 10; i++) r.tracker.move(1, jump.x + ((thrust.x - jump.x) * i) / 10, jump.y + ((thrust.y - jump.y) * i) / 10);
    expect(r.controls.consume()).toEqual({ ...NOTHING, thrust: true });
    expect(r.lit).toEqual(['thrust']);
  });

  it('an item that is lost lets go of its button at once', () => {
    const r = rig();
    r.tracker.setShown(true, true);
    const thrust = r.at('thrust');
    r.tracker.down(0, thrust.x, thrust.y);
    expect(r.controls.held()).toEqual({ ...NOTHING, thrust: true });
    r.tracker.setShown(false, false);
    expect(r.controls.held().thrust).toBe(false);
  });

  it('a cancelled pointer is let go of like a lifted one; the others stay', () => {
    const r = rig();
    const right = r.at('right');
    const jump = r.at('jump');
    r.tracker.down(0, right.x, right.y);
    r.tracker.down(1, jump.x, jump.y);
    r.tracker.up(1); // pointercancel is reported the same way
    expect(r.controls.held()).toEqual({ ...NOTHING, right: true });
    r.tracker.up(0);
    expect(r.controls.held()).toEqual(NOTHING);
  });

  it('releaseAll forgets every finger and every unconsumed press; a finger still down stays forgotten', () => {
    const r = rig();
    const right = r.at('right');
    const jump = r.at('jump');
    r.tracker.down(0, right.x, right.y);
    r.tracker.down(1, jump.x, jump.y);
    r.tracker.releaseAll();
    expect(r.tracker.count).toBe(0);
    expect(r.lit).toEqual([]);
    expect(r.controls.consume()).toEqual(NOTHING);
    r.tracker.move(0, right.x + 4, right.y);
    r.tracker.up(1);
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('releaseAll leaves the keyboard alone', () => {
    const r = rig();
    r.controls.set('keys', 'left', true);
    const jump = r.at('jump');
    r.tracker.down(0, jump.x, jump.y);
    r.tracker.releaseAll();
    expect(r.controls.consume()).toEqual({ ...NOTHING, left: true });
  });

  it('PAUSE acts on touch down, once, and is never a held control', () => {
    const r = rig();
    const pause = r.at('pause');
    r.tracker.down(0, pause.x, pause.y);
    expect(r.pauses).toBe(1);
    expect(r.tracker.count).toBe(0);
    r.tracker.move(0, pause.x + 2, pause.y);
    r.tracker.up(0);
    expect(r.pauses).toBe(1);
    expect(r.controls.consume()).toEqual(NOTHING);
  });

  it('a finger that slides onto PAUSE lets go of its button but does not pause', () => {
    const r = rig();
    r.tracker.setShown(true, true);
    const thrust = r.at('thrust');
    const pause = r.at('pause');
    r.tracker.down(0, thrust.x, thrust.y);
    r.tracker.move(0, pause.x, pause.y);
    expect(r.pauses).toBe(0);
    expect(r.controls.held()).toEqual(NOTHING);
  });

  it('a touch the zones never heard of (touch mode came on with it) is taken where it landed, if on the pad', () => {
    const r = rig();
    const right = r.at('right');
    expect(r.tracker.downIfOnPad(7, right.x, right.y)).toBe(true);
    expect(r.controls.consume()).toEqual({ ...NOTHING, right: true });
    // In the middle of the screen it is not the pad's: not followed, so sliding onto a button presses nothing.
    expect(r.tracker.downIfOnPad(8, 422, 150)).toBe(false);
    r.tracker.move(8, right.x, right.y - 2);
    r.tracker.up(7);
    expect(r.controls.consume()).toEqual(NOTHING);
    // PAUSE is taken too, as a tap.
    const pause = r.at('pause');
    expect(r.tracker.downIfOnPad(9, pause.x, pause.y)).toBe(true);
    expect(r.pauses).toBe(1);
  });

  it('a new layout is applied to fingers that are already down', () => {
    const r = rig();
    const right = r.at('right');
    r.tracker.down(0, right.x, right.y);
    expect(r.controls.held().right).toBe(true);
    // The same window with a notch on the left: the point that was RIGHT is now LEFT.
    const shift = REFERENCE_TOUCH.moveButtonSize + REFERENCE_TOUCH.moveButtonGap;
    const notched = layoutControls(844, 390, { left: shift, right: 0, top: 0, bottom: 0 }, REFERENCE_TOUCH);
    r.tracker.setLayout(notched);
    expect(r.controls.held()).toEqual({ ...NOTHING, left: true });
  });
});
