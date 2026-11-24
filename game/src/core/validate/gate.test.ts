import { readFileSync } from 'node:fs';
// A clock, in a test only: item 4 of the gate measures how long step() takes on this machine. The
// global `performance` is banned in src/core by lint; nothing asserted below depends on the time.
import { performance } from 'node:perf_hooks';

import { afterAll, describe, expect, it } from 'vitest';

import { compileTuning } from '../compileTuning';
import { cloneGame, copyGame, createSession, step } from '../game';
import { parseLevel, withoutItem } from '../level';
import { inputFromBits } from '../script';
import { REFERENCE_PHYS, REFERENCE_TUNING } from '../testkit';
import type { LevelData, LevelProof, Phys, ValidateOptions } from '../types';
import { InputBit } from '../types';
import { capRoom, openHall, threeDecks } from './fixtures';
import { handicap } from './handicap';
import { anythingButWalls, floodEstimate } from './heuristic';
import { replayScript, validateLevel } from './index';
import { COMFORT_OPTIONS, DEFAULT_OPTIONS, LEVELS_STEP_BUDGET, REQUIRES_OPTIONS } from './options';
import { searchWithEnemies } from './search';
import { Sim, StateKeys } from './successors';

/**
 * The Phase 4 gate (docs/ARCHITECTURE.md, section 9.6), which the real
 * validator must pass before the first campaign level is built:
 *   1. the three-deck fixture proven, normal and comfort, in under 1 M step
 *      calls each, and NOT proven when its flood fill may pass through hazards;
 *   2. the open hall (64 x 24, 4 packs, 4 enemies) proven, normal and
 *      comfort, inside maxStepCalls;
 *   3. debug.txt without its packs decided (trophy-unreachable) and without
 *      its blaster decided (no-route), each inside REQUIRES_OPTIONS;
 *   4. the measured cost of a proof on a room loaded like a campaign level,
 *      from which LEVELS_STEP_BUDGET is set to 60 s worth of calls: timed
 *      directly, and estimated from bare step() as the first gate run did.
 * Fixtures run on REFERENCE_PHYS (section 12). The numbers printed here are
 * the ones recorded in section 9.6.
 */

const P = REFERENCE_PHYS;
const COMFORT_PHYS = compileTuning(handicap(REFERENCE_TUNING));
const ONE_MILLION = 1_000_000;

/** Wall time and step calls of every validateLevel call in this file, for the validator's own rate (item 4). */
let provedMs = 0;
let provedCalls = 0;

const millions = (calls: number): string => `${(calls / ONE_MILLION).toFixed(2)} M`;

function prove(label: string, level: LevelData, phys: Phys, options: Partial<ValidateOptions>): LevelProof {
  const started = performance.now();
  const proof = validateLevel(level, phys, options);
  const ms = performance.now() - started;
  provedMs += ms;
  provedCalls += proof.stats.stepCalls;
  console.log(
    `gate: ${label.padEnd(34)} ${proof.verdict.padEnd(19)} ${proof.stage.padEnd(8)} ${millions(proof.stats.stepCalls).padStart(9)} step calls, ` +
      `${proof.stats.searchNodes} search nodes, ${proof.stats.groundNodes + proof.stats.flightNodes} map nodes, ${Math.round(ms)} ms`,
  );
  return proof;
}

function expectWins(level: LevelData, phys: Phys, proof: LevelProof): void {
  expect(proof.verdict, JSON.stringify({ stage: proof.stage, stuckAt: proof.stuckAt })).toBe('proven');
  if (proof.script === null) throw new Error('a proven proof carries a script');
  expect(replayScript(level, phys, proof.script)).toMatchObject({
    won: true,
    died: null,
    trophyTick: proof.trophyTick,
    winTick: proof.winTick,
  });
}

/**
 * Microseconds per step() call on `level`: the median of 5 runs of 2 M calls with random input from
 * a fixed seed, each pattern held for 16 ticks as a thumb holds a button. The hero is put back to a
 * playing state whenever it dies or exits, so every call measured is a tick of play, not a frozen one.
 */
function stepRate(level: LevelData): number {
  const game = createSession([level], P);
  for (let i = 0; i < P.readyMinTicks; i++) step(game, inputFromBits(0));
  step(game, inputFromBits(InputBit.Right));
  const playing = cloneGame(game);
  let seed = 12345;
  let bits = 0;
  const calls = 2 * ONE_MILLION;
  const runs: number[] = [];
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    for (let i = 0; i < calls; i++) {
      if ((i & 15) === 0) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        bits = seed >>> 27;
      }
      step(game, inputFromBits(bits));
      if (game.run.phase !== 'playing') copyGame(game, playing);
    }
    runs.push(((performance.now() - started) * 1000) / calls);
  }
  return [...runs].sort((a, b) => a - b)[2] ?? 0;
}

describe('Phase 4 gate', () => {
  it('1. three decks (64 x 24, 2 packs, 6 enemies, coolant in the deck floors): proven, normal and comfort, in under 1 M step calls each', () => {
    const level = threeDecks();
    const normal = prove('three decks, normal', level, P, DEFAULT_OPTIONS);
    expectWins(level, P, normal);
    expect(normal.stats.stepCalls).toBeLessThan(ONE_MILLION);
    const comfort = prove('three decks, comfort', level, COMFORT_PHYS, COMFORT_OPTIONS);
    expectWins(level, COMFORT_PHYS, comfort);
    expect(comfort.stats.stepCalls).toBeLessThan(ONE_MILLION);
  }, 120_000);

  it('1. three decks: NOT proven when the flood fill may pass through hazards (twice the budget the right flood fill must fit)', () => {
    const level = threeDecks();
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const started = performance.now();
    const wrong = searchWithEnemies(sim, keys, floodEstimate(level, P, sim.climbTiles(), anythingButWalls), 2 * ONE_MILLION);
    console.log(
      `gate: three decks, hazards passable      ${wrong.end.padEnd(19)} ${millions(sim.stepCalls).padStart(18)} step calls, ` +
        `${wrong.nodes} search nodes, ${Math.round(performance.now() - started)} ms`,
    );
    expect(wrong.end).toBe('budget');
    expect(wrong.script).toBeNull();
  }, 120_000);

  it('2. open hall (64 x 24, 4 packs, 4 enemies): proven, normal and comfort, inside maxStepCalls', () => {
    const level = openHall(4);
    expect([level.width, level.height, level.enemies.length]).toEqual([64, 24, 4]);
    expect(level.pickups.filter((pickup) => pickup.kind === 'thruster')).toHaveLength(4);
    const normal = prove('open hall, normal', level, P, DEFAULT_OPTIONS);
    expectWins(level, P, normal);
    expect(normal.stats.stepCalls).toBeLessThanOrEqual(DEFAULT_OPTIONS.maxStepCalls);
    const comfort = prove('open hall, comfort', level, COMFORT_PHYS, COMFORT_OPTIONS);
    expectWins(level, COMFORT_PHYS, comfort);
    expect(comfort.stats.stepCalls).toBeLessThanOrEqual(COMFORT_OPTIONS.maxStepCalls);
  }, 120_000);

  it('3. debug.txt without its packs is trophy-unreachable, without its blaster no-route, each inside REQUIRES_OPTIONS', () => {
    const debug = parseLevel(readFileSync(new URL('../../../levels/debug.txt', import.meta.url), 'utf8'), 'debug');
    // As suite (c) of tests/levels.test.ts runs them: map first when no pack is left.
    const noPacks = prove('debug.txt without thruster', withoutItem(debug, 'thruster'), P, {
      ...REQUIRES_OPTIONS,
      alwaysMap: true,
    });
    expect(noPacks.verdict).toBe('trophy-unreachable');
    expect(noPacks.stats.stepCalls).toBeLessThanOrEqual(REQUIRES_OPTIONS.maxStepCalls);
    const noBlaster = prove('debug.txt without blaster', withoutItem(debug, 'blaster'), P, REQUIRES_OPTIONS);
    expect(noBlaster.verdict).toBe('no-route');
    expect(noBlaster.stats.stepCalls).toBeLessThanOrEqual(REQUIRES_OPTIONS.maxStepCalls);
  }, 120_000);

  it('4. the cost of step() on a room loaded like a campaign level (64 x 24, 16 enemies, 37 pickups), and of the validator on it', () => {
    const level = capRoom();
    expect([level.width, level.height, level.enemies.length]).toEqual([64, 24, 16]);
    expect(level.pickups.filter((pickup) => pickup.kind === 'crystal').length).toBeGreaterThanOrEqual(30);
    // Measured directly: a real proof of the cap room for 6 M step calls (it ends budget-exceeded; only the
    // wall time per call matters). This is what a proof of a full campaign room costs.
    const started = performance.now();
    const capProof = validateLevel(level, P, { maxStepCalls: 6 * ONE_MILLION });
    const directRate = ((performance.now() - started) * 1000) / capProof.stats.stepCalls;
    // Estimated, as the first gate run did: bare step() on the cap room, times the validator's own overhead
    // over bare step() on the rooms of items 1 to 3 (mostly the open hall). The ratio moves from run to run on a
    // shared machine, so the budget follows the larger of the two.
    const capRate = stepRate(level);
    const hallRate = stepRate(openHall(4));
    const validatorRate = provedCalls > 0 ? (provedMs * 1000) / provedCalls : 0;
    const overhead = hallRate > 0 ? validatorRate / hallRate : 0;
    const estimatedRate = capRate * overhead;
    const rate = Math.max(directRate, estimatedRate);
    console.log(
      `gate: validateLevel on the cap room: ${directRate.toFixed(3)} µs of wall time per step call (${millions(capProof.stats.stepCalls)} calls, ${capProof.verdict})`,
    );
    console.log(`gate: step() alone on the cap room: ${capRate.toFixed(3)} µs per call (median of 5 runs of 2 M)`);
    console.log(`gate: step() alone on the open hall: ${hallRate.toFixed(3)} µs per call (median of 5 runs of 2 M)`);
    console.log(
      `gate: the validator in items 1 to 3: ${validatorRate.toFixed(3)} µs per step call (${millions(provedCalls)} calls in ` +
        `${(provedMs / 1000).toFixed(1)} s), ${overhead.toFixed(2)} times bare step() on the open hall; times step() on the cap room: ${estimatedRate.toFixed(3)} µs`,
    );
    console.log(
      `gate: at the larger rate, ${rate.toFixed(3)} µs per step call, 60 s is ${millions(rate > 0 ? 60e6 / rate : 0)} calls; ` +
        `LEVELS_STEP_BUDGET is ${millions(LEVELS_STEP_BUDGET)} (${((LEVELS_STEP_BUDGET * rate) / 1e6).toFixed(0)} s at that rate)`,
    );
    // The time is printed, never asserted (the build machine is not the CI machine). The budget is a
    // whole number of calls, at least what one level's two proofs may spend.
    expect(Number.isInteger(LEVELS_STEP_BUDGET)).toBe(true);
    expect(LEVELS_STEP_BUDGET).toBeGreaterThanOrEqual(2 * DEFAULT_OPTIONS.maxStepCalls);
  }, 120_000);

  afterAll(() => {
    console.log(`gate: ${millions(provedCalls)} step calls in validateLevel in this file, ${(provedMs / 1000).toFixed(1)} s`);
  });
});
