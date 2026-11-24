import { describe, expect, it } from 'vitest';

import { compileTuning } from '../compileTuning';
import { REFERENCE_PHYS, REFERENCE_TUNING } from '../testkit';
import type { Phys } from '../types';
import { handicap } from './handicap';

describe('handicap (the comfort proof tuning)', () => {
  const H = handicap(REFERENCE_TUNING);
  const PH = compileTuning(H);

  it('switches coyote time and the jump buffer off', () => {
    expect(H.forgiveness.coyoteFrames).toBe(0);
    expect(H.forgiveness.jumpBufferFrames).toBe(0);
    expect(PH.coyoteTicks).toBe(0);
    expect(PH.jumpBufferTicks).toBe(0);
  });

  it('keeps 95 % of run speed and jump speed: 365 and 1216 sub-pixels per tick on the reference tuning (364.8 rounds up)', () => {
    expect(H.run.runMaxSpeed).toBeCloseTo(REFERENCE_TUNING.run.runMaxSpeed * 0.95, 12);
    expect(H.jump.jumpVelocity).toBeCloseTo(REFERENCE_TUNING.jump.jumpVelocity * 0.95, 12);
    expect(PH.runMax).toBe(365);
    expect(PH.jumpVel).toBe(1216);
  });

  it('keeps nine tenths of the tank, rounded down: 80 frames give 72, and every whole result stays whole', () => {
    expect(PH.fuelTicks).toBe(72);
    for (let frames = 0; frames <= 1000; frames++) {
      const fuel = handicap({ ...REFERENCE_TUNING, thruster: { ...REFERENCE_TUNING.thruster, jetFuelFrames: frames } })
        .thruster.jetFuelFrames;
      expect(fuel, `${frames} frames`).toBe(Math.floor((frames * 9) / 10));
      if (frames % 10 === 0) expect(fuel, `${frames} frames`).toBe((frames / 10) * 9);
    }
  });

  it('changes no other Phys field', () => {
    const changed = (Object.keys(REFERENCE_PHYS) as (keyof Phys)[]).filter((k) => PH[k] !== REFERENCE_PHYS[k]);
    expect(changed.sort()).toEqual(['coyoteTicks', 'fuelTicks', 'jumpBufferTicks', 'jumpVel', 'runMax']);
  });

  it('does not touch the tuning it is given', () => {
    expect(REFERENCE_TUNING.run.runMaxSpeed).toBe(1.5);
    expect(REFERENCE_TUNING.forgiveness.coyoteFrames).toBe(6);
    expect(REFERENCE_TUNING.thruster.jetFuelFrames).toBe(80);
  });
});
