import { describe, expect, it } from 'vitest';

import type { TouchTuning } from '../core/types';

import { createHaptics } from './haptics';
import type { VibrationDevice } from './haptics';
import { REFERENCE_TOUCH } from './testkit';

/** The shipped lengths (src/input/testkit.ts): an owner's edit to src/tuning.ts, 0 included, cannot break these tests. */
const T: TouchTuning = REFERENCE_TOUCH;

/** A stand-in for `navigator` that records what it was asked to do. */
function phone(): VibrationDevice & { calls: (number | number[])[] } {
  const calls: (number | number[])[] = [];
  return {
    calls,
    vibrate(pattern) {
      calls.push(pattern);
      return true;
    },
  };
}

describe('haptics', () => {
  it('buzzes with the lengths of the tuning: death, two pulses for the cog, a tick for the empty tank', () => {
    const device = phone();
    const h = createHaptics(T, true, device);
    expect(h.isSupported()).toBe(true);
    expect(h.death()).toBe(true);
    expect(h.cog()).toBe(true);
    expect(h.emptyTank()).toBe(true);
    expect(device.calls).toEqual([
      [T.vibrateDeathMs],
      [T.vibrateCogPulseMs, T.vibrateCogGapMs, T.vibrateCogPulseMs],
      [T.vibrateEmptyTankMs],
    ]);
  });

  it('honours the saved setting: off means no call at all', () => {
    const device = phone();
    const h = createHaptics(T, false, device);
    expect(h.isEnabled()).toBe(false);
    expect(h.death()).toBe(false);
    expect(h.cog()).toBe(false);
    expect(h.emptyTank()).toBe(false);
    expect(device.calls).toEqual([]);
    h.setEnabled(true);
    expect(h.isEnabled()).toBe(true);
    expect(h.death()).toBe(true);
    expect(device.calls).toEqual([[T.vibrateDeathMs]]);
  });

  it('switching off stops a buzz that is running, once', () => {
    const device = phone();
    const h = createHaptics(T, true, device);
    h.cog();
    h.setEnabled(false);
    h.setEnabled(false);
    expect(device.calls).toEqual([[T.vibrateCogPulseMs, T.vibrateCogGapMs, T.vibrateCogPulseMs], [0]]);
    expect(h.death()).toBe(false);
  });

  it('stop() cancels whatever is running, also while switched off', () => {
    const device = phone();
    const h = createHaptics(T, false, device);
    h.stop();
    expect(device.calls).toEqual([[0]]);
  });

  it('does nothing and does not throw where vibration is missing', () => {
    for (const device of [null, {}, { vibrate: undefined }] as (VibrationDevice | null)[]) {
      const h = createHaptics(T, true, device);
      expect(h.isSupported()).toBe(false);
      expect(h.death()).toBe(false);
      expect(h.cog()).toBe(false);
      expect(h.emptyTank()).toBe(false);
      expect(() => {
        h.stop();
        h.setEnabled(false);
        h.setEnabled(true);
      }).not.toThrow();
    }
  });

  it('does not throw when the browser throws or refuses', () => {
    const throwing: VibrationDevice = {
      vibrate() {
        throw new Error('blocked');
      },
    };
    const refusing: VibrationDevice = { vibrate: () => false };
    for (const device of [throwing, refusing]) {
      const h = createHaptics(T, true, device);
      expect(h.death()).toBe(false);
      expect(() => {
        h.stop();
        h.setEnabled(false);
      }).not.toThrow();
    }
  });

  it('does not throw when even reading the device throws (a locked-down frame)', () => {
    const hostile = {
      get vibrate(): never {
        throw new Error('denied');
      },
    } as VibrationDevice;
    const h = createHaptics(T, true, hostile);
    expect(h.isSupported()).toBe(false);
    expect(h.death()).toBe(false);
    expect(() => {
      h.stop();
    }).not.toThrow();
  });

  it('does not ask before the player has touched the page (browsers refuse and warn)', () => {
    const device = Object.assign(phone(), { userActivation: { hasBeenActive: false } });
    const h = createHaptics(T, true, device);
    expect(h.death()).toBe(false);
    expect(device.calls).toEqual([]);
    device.userActivation.hasBeenActive = true;
    expect(h.death()).toBe(true);
    expect(device.calls).toEqual([[T.vibrateDeathMs]]);
  });

  it('a length of 0 in the tuning switches that buzz off', () => {
    const device = phone();
    const h = createHaptics({ ...T, vibrateDeathMs: 0, vibrateCogPulseMs: 0 }, true, device);
    expect(h.death()).toBe(false);
    expect(h.cog()).toBe(false); // a gap with no pulse around it is no buzz either
    expect(h.emptyTank()).toBe(true);
    expect(device.calls).toEqual([[T.vibrateEmptyTankMs]]);
  });

  it('every length at 0 means no call at all, while the switch still stops a running buzz', () => {
    const device = phone();
    const silent = createHaptics({ ...T, vibrateDeathMs: 0, vibrateCogPulseMs: 0, vibrateCogGapMs: 0, vibrateEmptyTankMs: 0 }, true, device);
    expect(silent.death()).toBe(false);
    expect(silent.cog()).toBe(false);
    expect(silent.emptyTank()).toBe(false);
    expect(device.calls).toEqual([]);
    silent.stop();
    expect(device.calls).toEqual([[0]]);
  });

  it('works with the real global in Node, where navigator has no vibrate', () => {
    const h = createHaptics(T);
    expect(h.isEnabled()).toBe(true);
    expect(h.isSupported()).toBe(false);
    expect(h.death()).toBe(false);
  });
});
