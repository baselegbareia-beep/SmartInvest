/**
 * Search constants of the level validator (docs/ARCHITECTURE.md, section 9.5).
 *
 * These are not feel numbers: they say how finely the search looks and how
 * long it may look, never how the hero moves. Every budget is counted in
 * step() calls, because the core has no clock; that keeps every verdict
 * reproducible on any machine.
 */
import type { ValidateOptions } from '../types';

/** The normal proof: every level in levels/, on the owner's tuning. */
export const DEFAULT_OPTIONS: ValidateOptions = Object.freeze({
  decisionTicks: 6,
  maxHoldDecisions: 3,
  groundBucketPx: 4,
  flightCellPx: 8,
  tapTicks: 4,
  airSwitchTicks: Object.freeze([8, 16, 24]),
  enemyKeyRadiusTiles: 4,
  enemyBucketPx: 8,
  heuristicWeight: 2,
  quickStepCalls: 2_000_000,
  maxStepCalls: 40_000_000,
  safeStartTicks: 120,
  alwaysMap: false,
});

/**
 * The comfort proof, on the handicapped tuning: coarser decisions, because
 * the clumsy thumb it stands for does not change direction every 6 ticks.
 */
export const COMFORT_OPTIONS: ValidateOptions = Object.freeze({
  ...DEFAULT_OPTIONS,
  decisionTicks: 8,
  airSwitchTicks: Object.freeze([12, 24]),
});

/**
 * The "@requires" runs: the level without one item must NOT be proven. A
 * smaller budget, because such a level is usually decided fast, and a run
 * that spends it decides nothing either way (it is listed, not failed). When
 * no pack is left the pipeline itself runs the quick pass and then the map,
 * so a failure there is the verdict of every search.
 */
export const REQUIRES_OPTIONS: ValidateOptions = Object.freeze({
  ...DEFAULT_OPTIONS,
  maxStepCalls: 6_000_000,
});

/**
 * The step-call budget of the whole of tests/levels.test.ts: the sum of
 * stats.stepCalls over every proof in it must stay below this. Ruling R10
 * gives the file about 60 seconds on the 4-core build machine; the core has
 * no clock, so the test asserts calls, not seconds.
 *
 * Set from the Phase 4 gate (src/core/validate/gate.test.ts, item 4;
 * docs/ARCHITECTURE.md, section 9.6), measured under Vitest on a room loaded
 * like a full campaign level (64 x 24, 16 enemies, 37 pickups): a proof there,
 * timed directly, spends 0.54 to 0.60 microseconds of wall time per step call,
 * and the first estimate (bare step() times the search's overhead) said 0.65
 * to 0.69; the machine is shared, so runs differ. 60 s at those rates is 87 to
 * 111 million calls, so 90 million is 49 to 62 s. Real campaign rooms are
 * lighter: 0.21 to 0.36 microseconds a call, about 20 to 32 s for the budget.
 */
export const LEVELS_STEP_BUDGET = 90_000_000;

/**
 * Flood-fill estimate of a cell the flood cannot reach from the goal, in
 * ticks (section 9.4): far more than any real route, so such a state is
 * searched last, but never thrown away.
 */
export const UNREACHABLE_TICKS = 100_000;

/**
 * The guided search's estimate for a state whose key the enemy-free map
 * never stored (or stored without a way to win): the map's cost from the
 * start plus this many ticks. Penalised, never pruned.
 */
export const UNKNOWN_KEY_PENALTY_TICKS = 600;

/**
 * Longest ballistic arc the generator follows, in ticks. Gravity ends every
 * arc on its own (a fall from the top of the tallest level lands or leaves
 * the grid in about 100 ticks); this is a guard, not a rule.
 */
export const MAX_AIR_TICKS = 400;

/** The whole numbers each option must be, with their smallest allowed value. */
const WHOLE_OPTIONS = Object.freeze([
  ['decisionTicks', 1],
  ['maxHoldDecisions', 1],
  ['groundBucketPx', 1],
  ['flightCellPx', 1],
  ['tapTicks', 1],
  ['enemyKeyRadiusTiles', 0],
  ['enemyBucketPx', 1],
  ['heuristicWeight', 0],
  ['quickStepCalls', 0],
  ['maxStepCalls', 0],
  ['safeStartTicks', 0],
] as const);

/**
 * DEFAULT_OPTIONS with the given fields replaced, checked: every count is a
 * whole number in range, and the arc ticks at which a jump may change
 * direction are positive whole numbers. Throws RangeError naming the field.
 */
export function resolveOptions(partial: Partial<ValidateOptions> = {}): ValidateOptions {
  const options: ValidateOptions = { ...DEFAULT_OPTIONS, ...partial };
  for (const [name, min] of WHOLE_OPTIONS) {
    const value = options[name];
    if (!Number.isInteger(value) || value < min) {
      throw new RangeError(`validateLevel: option ${name} must be a whole number of at least ${min}, not ${value}`);
    }
  }
  for (const tick of options.airSwitchTicks) {
    if (!Number.isInteger(tick) || tick < 1) {
      throw new RangeError(`validateLevel: option airSwitchTicks holds ${tick}; every entry must be a whole number of at least 1`);
    }
  }
  return options;
}
