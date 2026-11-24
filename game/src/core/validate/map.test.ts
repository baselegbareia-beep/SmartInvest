import { describe, expect, it } from 'vitest';

import { cloneGame } from '../game';
import { levelFromRows, REFERENCE_PHYS } from '../testkit';
import type { Estimate } from './heuristic';
import { closenessEstimate, floodEstimate } from './heuristic';
import { buildMap, guidedEstimate } from './map';
import { TILE } from '../types';
import { DEFAULT_OPTIONS, UNKNOWN_KEY_PENALTY_TICKS } from './options';
import { Expander, Sim, StateKeys } from './successors';

const P = REFERENCE_PHYS;

/** The closeness the validator ranks stuckAt by, on the jump height this tuning measures. */
const closenessOf = (sim: Sim): Estimate => closenessEstimate(sim.level, P, floodEstimate(sim.level, P, sim.climbTiles()));

describe('buildMap (the enemy-free map)', () => {
  // A Cinderpeg guards the cog, but the map removes every enemy.
  const level = levelFromRows(
    ['################', '#..............#', '#..............#', '#.P.G.....C.T.D#', '################'],
    { id: 'map' },
  );

  it('expands everything, finds the win, and gives every stored key its cost to go in ticks', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 50_000_000);
    expect(map).toMatchObject({ finished: true, trophyReached: true, winReached: true });
    expect(map.groundNodes).toBeGreaterThan(10);
    expect(map.flightNodes).toBe(0);
    expect(map.expanded).toBeGreaterThan(10);
    // From the start: about 10 tiles there and 2 more to the airlock at 10.7 ticks a tile, plus the run-up.
    expect(map.rootCost).toBeGreaterThan(100);
    expect(map.rootCost).toBeLessThan(400);
    const root = sim.root(true);
    expect(map.costToGo(root)).toBe(map.rootCost);
    // The crystal on the way was taken by some state; the map holds no enemy.
    expect(map.pickupsTaken).toEqual([true]);
  });

  it('a key it never stored has no cost; so does every key when the budget runs out first', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 1);
    expect(map.finished).toBe(false);
    expect(map.rootCost).toBe(-1);
    expect(map.costToGo(sim.root(true))).toBe(-1);
  });

  it('with a budget of 0 stores the root and expands nothing', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 0);
    expect(map).toMatchObject({ finished: false, expanded: 0, groundNodes: 1, flightNodes: 0 });
  });

  it('keeps the cost to go consistent: from the root, no manoeuvre leads to a key with a shorter way than the root has', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 50_000_000);
    const root = sim.root(true);
    const through: number[] = [];
    new Expander(sim, root, (game) => keys.hero(game), false).expand(root, (game, runs) => {
      const rest = map.costToGo(game);
      if (rest >= 0) through.push(runs.total + rest);
    });
    expect(through.length).toBeGreaterThan(0);
    // The root's cost is the shortest way through any of its own manoeuvres.
    expect(Math.min(...through)).toBe(map.rootCost);
  });
});

describe('guidedEstimate (the guided search\'s estimate)', () => {
  // The start ledge has a shaft 1 tile wide and 4 deep: a hero that falls in stays there, and wins nothing.
  const trap = levelFromRows(
    ['############', '#..........#', '#..........#', '#.P........#', '###.#......#', '###.#......#', '###.#......#', '###G#......#', '#####.D..T.#', '############'],
    { id: 'crystal-trap' },
  );

  it('is the map\'s cost to go where the map has a way to win, and its root cost plus 600 ticks everywhere else', () => {
    const sim = new Sim(trap, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(trap, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 50_000_000);
    const estimate = guidedEstimate(map);
    const root = sim.root(true);
    expect(map.rootCost).toBeGreaterThan(0);
    expect(estimate(root)).toBe(map.rootCost);
    const unknown = map.rootCost + UNKNOWN_KEY_PENALTY_TICKS;
    expect(UNKNOWN_KEY_PENALTY_TICKS).toBe(600);
    // A key the map stored but from which it found no win: the hero at the bottom of the shaft.
    let trapped = 0;
    new Expander(sim, root, (game) => keys.hero(game), false).expand(root, (game) => {
      if (game.run.player.onGround && game.run.player.y > 6 * TILE && map.costToGo(game) < 0) {
        trapped += 1;
        expect(estimate(game)).toBe(unknown);
      }
    });
    expect(trapped).toBeGreaterThan(0);
    // A key the map never stored: a flight state, on a level without a pack.
    const flying = cloneGame(root);
    flying.run.player.onGround = false;
    expect(map.costToGo(flying)).toBe(-1);
    expect(estimate(flying)).toBe(unknown);
  });
});

describe('buildMap with a thruster pack', () => {
  const level = levelFromRows(['########', '#.....T#', '#......#', '#P.J..D#', '########'], { id: 'tiny-pack' });

  it('pins the map of a small level with a pack: its shortest way, and what it stored and expanded', () => {
    // Regression numbers. The order (most effective fuel first), the merge (a later state with more effective
    // fuel replaces the representative) and the edges into keys already stored each move them; update them
    // only for a change that is meant to.
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const map = buildMap(sim, keys, closenessOf(sim), 50_000_000);
    expect(map).toMatchObject({ finished: true, trophyReached: true, winReached: true });
    expect({ rootCost: map.rootCost, ground: map.groundNodes, flight: map.flightNodes, expanded: map.expanded }).toEqual({
      rootCost: 47,
      ground: 222,
      flight: 307,
      expanded: 527,
    });
  });
});
