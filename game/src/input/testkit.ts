/**
 * TEST SUPPORT ONLY. No game code may import this file.
 *
 * REFERENCE_TOUCH is a frozen copy of the `touch` group of src/tuning.ts as the game first shipped
 * it, in the spirit of `REFERENCE_TUNING` in src/core/testkit.ts (docs/ARCHITECTURE.md, section 12).
 * The unit tests of src/input run on it, written against the fields (`T.moveButtonSize`, not 64),
 * so an owner's edit to the touch numbers cannot break them.
 *
 * Exactly one test of src/input reads the live numbers: the last block of touchLayout.test.ts,
 * which fails only for an edit that makes two drawn buttons overlap, and names the fields to change.
 * Everything else the layout promises (each zone holds its buttons, every drawn point answers to its
 * button, no flicker between neighbours) is proven for random touch numbers, not for one set.
 */
import type { TouchTuning } from '../core/types';

export const REFERENCE_TOUCH: TouchTuning = Object.freeze({
  moveButtonSize: 64,
  moveMarginSide: 20,
  moveMarginBottom: 20,
  moveButtonGap: 12,
  moveZoneWidth: 196,
  moveZoneHeight: 128,
  moveSplitHysteresis: 6,
  jumpButtonSize: 76,
  jumpMarginSide: 20,
  jumpMarginBottom: 20,
  fireButtonSize: 60,
  fireMarginSide: 110,
  fireMarginBottom: 20,
  thrustButtonSize: 60,
  thrustMarginSide: 28,
  thrustMarginBottom: 110,
  actionZoneSize: 198,
  pauseButtonSize: 36,
  pauseHitSize: 56,
  pauseMarginTop: 10,
  pauseMarginSide: 12,
  opacityIdle: 0.35,
  opacityPressed: 0.6,
  opacityDimmed: 0.15,
  pressedScale: 0.94,
  appearMs: 150,
  vibrateDeathMs: 60,
  vibrateCogPulseMs: 30,
  vibrateCogGapMs: 40,
  vibrateEmptyTankMs: 15,
});
