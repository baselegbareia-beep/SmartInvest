/**
 * Run-length input scripts: how the validator hands a winning route to the
 * replay, and how a test or the browser plays one back. One entry holds one
 * set of held buttons, packed into a number, for a count of ticks.
 */
import { InputBit } from './types';
import type { BitsFromInputFn, Input, InputAtTickFn, InputFromBitsFn, ScriptTicksFn } from './types';

/** Every InputBit set: the five buttons give 32 patterns. */
const ALL_BITS = InputBit.Left | InputBit.Right | InputBit.Jump | InputBit.Fire | InputBit.Thrust;

/** Nothing held: pattern 0. */
const NO_INPUT: Input = Object.freeze({ left: false, right: false, jump: false, fire: false, thrust: false });

/**
 * One frozen Input per pattern, built once. The search and the replay ask for
 * an Input on every tick, tens of millions of times: handing out the same
 * object costs nothing, and freezing it means no caller can spoil it for the
 * others.
 */
const INPUTS: readonly Input[] = Array.from({ length: ALL_BITS + 1 }, (_, bits) =>
  bits === 0
    ? NO_INPUT
    : Object.freeze({
        left: (bits & InputBit.Left) !== 0,
        right: (bits & InputBit.Right) !== 0,
        jump: (bits & InputBit.Jump) !== 0,
        fire: (bits & InputBit.Fire) !== 0,
        thrust: (bits & InputBit.Thrust) !== 0,
      }),
);

// The mask keeps the index inside the table; the fallback is there for the compiler only.
export const inputFromBits: InputFromBitsFn = (bits) => INPUTS[bits & ALL_BITS] ?? NO_INPUT;

export const bitsFromInput: BitsFromInputFn = (input) =>
  (input.left ? InputBit.Left : 0) |
  (input.right ? InputBit.Right : 0) |
  (input.jump ? InputBit.Jump : 0) |
  (input.fire ? InputBit.Fire : 0) |
  (input.thrust ? InputBit.Thrust : 0);

export const scriptTicks: ScriptTicksFn = (script) => {
  let total = 0;
  for (const [, ticks] of script.runs) total += ticks;
  return total;
};

export const inputAtTick: InputAtTickFn = (script, tick) => {
  if (tick < 0) return 0;
  // `end` is the first tick after the entry being looked at.
  let end = 0;
  for (const [bits, ticks] of script.runs) {
    end += ticks;
    if (tick < end) return bits;
  }
  return 0;
};
