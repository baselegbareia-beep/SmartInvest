import { describe, expect, it } from 'vitest';

import { bitsFromInput, inputAtTick, inputFromBits, scriptTicks } from './script';
import { InputBit } from './types';
import type { Input, InputScript } from './types';

/**
 * Packed inputs and run-length scripts (docs/ARCHITECTURE.md, section 2 and
 * the InputScript type): the packing round trip, and which input a script
 * holds on which tick.
 */

const ALL_PATTERNS = Array.from({ length: 32 }, (_, bits) => bits);

/** Run-length encodes per-tick bits: the inverse of reading a script tick by tick. */
function pack(perTick: readonly number[]): InputScript {
  const runs: [number, number][] = [];
  for (const bits of perTick) {
    const last = runs.at(-1);
    if (last !== undefined && last[0] === bits) last[1] += 1;
    else runs.push([bits, 1]);
  }
  return { runs };
}

/** Reads a script tick by tick through inputAtTick. */
function unpack(script: InputScript): number[] {
  return Array.from({ length: scriptTicks(script) }, (_, tick) => inputAtTick(script, tick));
}

describe('inputFromBits and bitsFromInput', () => {
  it('uses the bit values of the contract: left 1, right 2, jump 4, fire 8, thrust 16', () => {
    expect(InputBit).toEqual({ Left: 1, Right: 2, Jump: 4, Fire: 8, Thrust: 16 });
  });

  it('unpacks each bit into its own button and nothing else', () => {
    const none = { left: false, right: false, jump: false, fire: false, thrust: false };
    expect(inputFromBits(0)).toEqual(none);
    expect(inputFromBits(InputBit.Left)).toEqual({ ...none, left: true });
    expect(inputFromBits(InputBit.Right)).toEqual({ ...none, right: true });
    expect(inputFromBits(InputBit.Jump)).toEqual({ ...none, jump: true });
    expect(inputFromBits(InputBit.Fire)).toEqual({ ...none, fire: true });
    expect(inputFromBits(InputBit.Thrust)).toEqual({ ...none, thrust: true });
    expect(inputFromBits(InputBit.Right | InputBit.Jump | InputBit.Thrust)).toEqual({
      ...none,
      right: true,
      jump: true,
      thrust: true,
    });
  });

  it('round-trips all 32 patterns: bits to Input to the same bits', () => {
    expect(ALL_PATTERNS.map((bits) => bitsFromInput(inputFromBits(bits)))).toEqual(ALL_PATTERNS);
  });

  it('round-trips every Input: Input to bits to an equal Input', () => {
    for (const bits of ALL_PATTERNS) {
      const input: Input = {
        left: (bits & 1) !== 0,
        right: (bits & 2) !== 0,
        jump: (bits & 4) !== 0,
        fire: (bits & 8) !== 0,
        thrust: (bits & 16) !== 0,
      };
      expect(bitsFromInput(input)).toBe(bits);
      expect(inputFromBits(bitsFromInput(input))).toEqual(input);
    }
  });

  it('returns one shared frozen object per pattern, so stepping a script allocates nothing', () => {
    for (const bits of ALL_PATTERNS) {
      expect(inputFromBits(bits)).toBe(inputFromBits(bits));
      expect(Object.isFrozen(inputFromBits(bits))).toBe(true);
    }
    expect(new Set(ALL_PATTERNS.map(inputFromBits)).size).toBe(32);
  });

  it('ignores bits above the five buttons', () => {
    expect(inputFromBits(32)).toBe(inputFromBits(0));
    expect(inputFromBits(64 | InputBit.Jump)).toBe(inputFromBits(InputBit.Jump));
    expect(inputFromBits(-1)).toBe(inputFromBits(31));
  });
});

describe('scriptTicks', () => {
  it('adds up the ticks of every run', () => {
    expect(scriptTicks({ runs: [[0, 12], [InputBit.Right, 30], [InputBit.Right | InputBit.Jump, 8]] })).toBe(50);
  });

  it('is 0 for an empty script', () => {
    expect(scriptTicks({ runs: [] })).toBe(0);
  });
});

describe('inputAtTick', () => {
  const script: InputScript = {
    runs: [
      [0, 12],
      [InputBit.Right, 3],
      [InputBit.Right | InputBit.Jump, 1],
      [InputBit.Fire, 2],
    ],
  };

  it('counts ticks from 0: the first run holds from tick 0 to the tick before its length', () => {
    expect(inputAtTick(script, 0)).toBe(0);
    expect(inputAtTick(script, 11)).toBe(0);
    expect(inputAtTick(script, 12)).toBe(InputBit.Right);
    expect(inputAtTick(script, 14)).toBe(InputBit.Right);
    expect(inputAtTick(script, 15)).toBe(InputBit.Right | InputBit.Jump);
    expect(inputAtTick(script, 16)).toBe(InputBit.Fire);
    expect(inputAtTick(script, 17)).toBe(InputBit.Fire);
  });

  it('holds nothing past the end of the script', () => {
    expect(inputAtTick(script, 18)).toBe(0);
    expect(inputAtTick(script, 100000)).toBe(0);
    expect(inputAtTick({ runs: [] }, 0)).toBe(0);
  });

  it('holds nothing before tick 0', () => {
    expect(inputAtTick({ runs: [[InputBit.Jump, 5]] }, -1)).toBe(0);
  });

  it('skips a run of no ticks', () => {
    const withEmptyRun: InputScript = {
      runs: [
        [InputBit.Left, 0],
        [InputBit.Jump, 2],
        [InputBit.Fire, 0],
        [InputBit.Thrust, 1],
      ],
    };
    expect(unpack(withEmptyRun)).toEqual([InputBit.Jump, InputBit.Jump, InputBit.Thrust]);
  });

  it('round-trips: a script read tick by tick and packed again is the same script', () => {
    expect(pack(unpack(script))).toEqual(script);

    // A longer script made by a small fixed generator, so the test needs no randomness.
    const perTick: number[] = [];
    let seed = 12345;
    for (let i = 0; i < 400; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      const bits = (seed >> 8) & 31;
      const length = 1 + ((seed >> 16) & 7);
      for (let t = 0; t < length; t++) perTick.push(bits);
    }
    const packed = pack(perTick);
    expect(scriptTicks(packed)).toBe(perTick.length);
    expect(unpack(packed)).toEqual(perTick);
    expect(pack(unpack(packed))).toEqual(packed);
  });

  it('survives JSON, because the browser test receives its script that way', () => {
    const copy = JSON.parse(JSON.stringify(script)) as InputScript;
    expect(copy).toEqual(script);
    expect(unpack(copy)).toEqual(unpack(script));
  });
});
