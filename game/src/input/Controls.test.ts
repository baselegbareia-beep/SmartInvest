import { describe, expect, it } from 'vitest';

import { BUTTONS, Controls, SOURCES } from './Controls';
import type { Button } from './Controls';

const NOTHING = { left: false, right: false, jump: false, fire: false, thrust: false };

describe('Controls: held states', () => {
  it('reports nothing until something is pressed', () => {
    const c = new Controls();
    expect(c.consume()).toEqual(NOTHING);
    expect(c.held()).toEqual(NOTHING);
    expect(c.anyDown()).toBe(false);
  });

  it.each(BUTTONS)('%s held by either source is reported every tick until both let go', (button) => {
    const c = new Controls();
    c.set('keys', button, true);
    for (let i = 0; i < 3; i++) expect(c.consume()).toEqual({ ...NOTHING, [button]: true });
    c.set('touch', button, true);
    c.set('keys', button, false);
    expect(c.consume()).toEqual({ ...NOTHING, [button]: true });
    expect(c.isDown(button)).toBe(true);
    expect(c.anyDown()).toBe(true);
    c.set('touch', button, false);
    expect(c.consume()).toEqual(NOTHING);
    expect(c.isDown(button)).toBe(false);
  });

  it('keeps the two sources apart: letting go on the pad does not release a key', () => {
    const c = new Controls();
    c.set('keys', 'jump', true);
    c.set('touch', 'jump', true);
    c.set('touch', 'jump', false);
    expect(c.consume().jump).toBe(true);
    expect(c.consume().jump).toBe(true);
  });

  it('gives a fresh object every tick', () => {
    const c = new Controls();
    const a = c.consume();
    c.set('keys', 'fire', true);
    const b = c.consume();
    expect(a).toEqual(NOTHING);
    expect(b.fire).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('Controls: the press latch', () => {
  it.each(BUTTONS)('a %s press that begins and ends between two ticks is reported for exactly one tick', (button) => {
    const c = new Controls();
    c.set('touch', button, true);
    c.set('touch', button, false);
    expect(c.consume()).toEqual({ ...NOTHING, [button]: true });
    expect(c.consume()).toEqual(NOTHING);
  });

  it('latch() alone (a key event whose key is already up again) gives one tick', () => {
    const c = new Controls();
    c.latch('jump');
    c.latch('jump');
    expect(c.consume().jump).toBe(true);
    expect(c.consume().jump).toBe(false);
  });

  it('three taps inside three ticks give three separate presses when a tick falls between them', () => {
    const c = new Controls();
    const seen: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      c.set('keys', 'jump', true);
      c.set('keys', 'jump', false);
      seen.push(c.consume().jump);
      seen.push(c.consume().jump);
    }
    expect(seen).toEqual([true, false, true, false, true, false]);
  });

  it('polling the same state again and again is not a new press', () => {
    const c = new Controls();
    c.set('keys', 'fire', true);
    expect(c.consume().fire).toBe(true);
    c.set('keys', 'fire', false);
    for (let i = 0; i < 5; i++) c.set('keys', 'fire', false);
    expect(c.consume().fire).toBe(false);
  });

  it('held() and isDown() never use up or show a latched press', () => {
    const c = new Controls();
    c.set('touch', 'jump', true);
    c.set('touch', 'jump', false);
    expect(c.held()).toEqual(NOTHING);
    expect(c.isDown('jump')).toBe(false);
    expect(c.consume().jump).toBe(true);
  });
});

describe('Controls: at most one of left and right', () => {
  it('the most recently pressed direction wins, and the older one returns when it is let go', () => {
    const c = new Controls();
    c.set('keys', 'left', true);
    expect(c.consume()).toMatchObject({ left: true, right: false });
    c.set('touch', 'right', true);
    expect(c.consume()).toMatchObject({ left: false, right: true });
    expect(c.held()).toMatchObject({ left: false, right: true });
    c.set('touch', 'right', false);
    expect(c.consume()).toMatchObject({ left: true, right: false });
  });

  it('pressing the held-over direction again makes it the newest', () => {
    const c = new Controls();
    c.set('keys', 'right', true);
    c.set('keys', 'left', true);
    expect(c.consume()).toMatchObject({ left: true, right: false });
    c.set('keys', 'right', false);
    c.set('keys', 'right', true);
    expect(c.consume()).toMatchObject({ left: false, right: true });
  });

  it('a quick tap of the other direction wins for its one tick', () => {
    const c = new Controls();
    c.set('keys', 'left', true);
    c.consume();
    c.set('touch', 'right', true);
    c.set('touch', 'right', false);
    expect(c.consume()).toMatchObject({ left: false, right: true });
    expect(c.consume()).toMatchObject({ left: true, right: false });
  });

  it('a slide from LEFT to RIGHT (left released and right pressed in one go) never gives a tick with neither', () => {
    const c = new Controls();
    c.set('touch', 'left', true);
    expect(c.consume()).toMatchObject({ left: true, right: false });
    // The pad reports all five buttons after every pointer event, in this order.
    c.set('touch', 'left', false);
    c.set('touch', 'right', true);
    expect(c.consume()).toMatchObject({ left: false, right: true });
    expect(c.consume()).toMatchObject({ left: false, right: true });
  });

  it('never sends both, whatever the order of events', () => {
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const c = new Controls();
    const directions: Button[] = ['left', 'right'];
    for (let i = 0; i < 5000; i++) {
      const source = SOURCES[Math.floor(random() * SOURCES.length)] ?? 'keys';
      const button = directions[Math.floor(random() * 2)] ?? 'left';
      if (random() < 0.2) c.latch(button);
      else c.set(source, button, random() < 0.5);
      if (random() < 0.6) {
        const out = c.consume();
        expect(out.left && out.right).toBe(false);
        const held = c.held();
        expect(held.left && held.right).toBe(false);
        // A direction that is held is never dropped unless the other one is sent instead.
        if (c.isDown('left') || c.isDown('right')) expect(held.left || held.right).toBe(true);
      }
    }
  });
});

describe('Controls: releaseAll', () => {
  it('with no source lets go of everything, latches included', () => {
    const c = new Controls();
    c.set('keys', 'thrust', true);
    c.set('touch', 'right', true);
    c.latch('jump');
    c.releaseAll();
    expect(c.consume()).toEqual(NOTHING);
    expect(c.anyDown()).toBe(false);
  });

  it('with a source lets go of that source only, and forgets presses not yet consumed', () => {
    const c = new Controls();
    c.set('keys', 'left', true);
    c.set('touch', 'jump', true);
    c.set('touch', 'fire', true);
    c.releaseAll('touch');
    expect(c.consume()).toEqual({ ...NOTHING, left: true });
    c.set('touch', 'jump', true);
    c.releaseAll('keys');
    expect(c.consume()).toEqual({ ...NOTHING, jump: true });
  });

  it('a button pressed again after a release is a new press', () => {
    const c = new Controls();
    c.set('touch', 'jump', true);
    c.releaseAll('touch');
    expect(c.consume().jump).toBe(false);
    c.set('touch', 'jump', true);
    c.set('touch', 'jump', false);
    expect(c.consume().jump).toBe(true);
  });
});
