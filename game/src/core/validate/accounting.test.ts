import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GameModule from '../game';
import { levelFromRows, REFERENCE_PHYS } from '../testkit';
import type { Input } from '../types';
import { validateLevel } from './index';

/**
 * stats.stepCalls counts every step() call of a validateLevel call, the
 * closing replay of a proven script included (docs/ARCHITECTURE.md, section
 * 9.1), and a script that does not win on that replay throws. To see both,
 * this file wraps the real step(): vi.mock replaces the module for every
 * importer, the validator included. In this file only.
 */

const probe = vi.hoisted(() => ({ calls: 0, replayCalls: 0, sabotageReplay: false }));

/** Nothing held: what a sabotaged replay feeds the hero instead of the script. */
const NOTHING: Input = Object.freeze({ left: false, right: false, jump: false, fire: false, thrust: false });

vi.mock('../game', async (importOriginal) => {
  const real = await importOriginal<typeof GameModule>();
  const counted: typeof real.step = (game, input, events) => {
    probe.calls += 1;
    // Only replayScript passes an events list; the search never does.
    if (events !== undefined) probe.replayCalls += 1;
    real.step(game, probe.sabotageReplay && events !== undefined ? NOTHING : input, events);
  };
  return { ...real, step: counted };
});

const P = REFERENCE_PHYS;
const walk = levelFromRows(['##########', '#........#', '#D.P...T.#', '##########'], { id: 'walk' });

beforeEach(() => {
  probe.calls = 0;
  probe.replayCalls = 0;
  probe.sabotageReplay = false;
});

describe('validateLevel counts its step() calls', () => {
  it('a proven proof: every call of every stage and of the closing replay, which runs to the win tick', () => {
    const proof = validateLevel(walk, P);
    expect(proof.verdict).toBe('proven');
    expect(proof.stats.stepCalls).toBe(probe.calls);
    expect(probe.replayCalls).toBe(proof.winTick);
  });

  it('map first with the guided search, and a failure verdict', () => {
    const proven = validateLevel(walk, P, { alwaysMap: true });
    expect(proven.stats.stepCalls).toBe(probe.calls);
    probe.calls = 0;
    const boxed = levelFromRows(['##########', '#....###.#', '#....#T#.#', '#P...###D#', '##########'], { id: 'boxed-cog' });
    const failed = validateLevel(boxed, P);
    expect(failed.verdict).toBe('trophy-unreachable');
    expect(failed.stats.stepCalls).toBe(probe.calls);
  });

  it('throws, naming the level, when the script it found does not win on the replay', () => {
    probe.sabotageReplay = true;
    expect(() => validateLevel(walk, P)).toThrow(/validator bug: the script found for levels\/walk\.txt does not win on replay/);
  });
});
