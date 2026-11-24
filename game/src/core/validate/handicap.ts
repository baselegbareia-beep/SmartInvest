/**
 * The "clumsy thumbs" tuning of the comfort proof (docs/ARCHITECTURE.md,
 * sections 9.6 and 13): what a level must still allow when the player gets
 * no help from the forgiveness timers and is a little slower and weaker.
 *
 * - coyoteFrames and jumpBufferFrames 0: no jump after walking off a ledge,
 *   no remembered early press;
 * - runMaxSpeed and jumpVelocity times 0.95;
 * - jetFuelFrames times 0.9, rounded down.
 *
 * Everything else is the owner's tuning unchanged. Fractions are allowed in
 * this file (docs/ARCHITECTURE.md, section 1): the result is a Tuning in px,
 * and compileTuning rounds it like any other.
 */
import type { HandicapFn } from '../types';

/** The share of run speed and jump speed a clumsy thumb keeps. */
const SPEED_SHARE = 0.95;

export const handicap: HandicapFn = (tuning) => ({
  ...tuning,
  run: { ...tuning.run, runMaxSpeed: tuning.run.runMaxSpeed * SPEED_SHARE },
  jump: { ...tuning.jump, jumpVelocity: tuning.jump.jumpVelocity * SPEED_SHARE },
  forgiveness: { ...tuning.forgiveness, coyoteFrames: 0, jumpBufferFrames: 0 },
  // Nine tenths in whole numbers, so that 80 frames give exactly 72 and no
  // floating-point error can round a whole result down by one.
  thruster: { ...tuning.thruster, jetFuelFrames: Math.floor((tuning.thruster.jetFuelFrames * 9) / 10) },
});
