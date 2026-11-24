import { describe, expect, it } from 'vitest';

import { levelFromRows, REFERENCE_PHYS } from '../testkit';
import { closenessEstimate, floodEstimate } from './heuristic';
import { DEFAULT_OPTIONS } from './options';
import { IntList, NodeQueue, searchWithEnemies } from './search';
import { Sim, StateKeys } from './successors';

const P = REFERENCE_PHYS;

describe('NodeQueue', () => {
  it('pops the lowest priority first and, among equals, the entry pushed first', () => {
    const queue = new NodeQueue();
    const pushed: [number, number][] = [];
    // A fixed scramble of priorities, many of them equal, past the first growth of the arrays.
    for (let id = 0; id < 3000; id++) {
      const priority = Math.imul(id, 2654435761) >>> 27;
      pushed.push([id, priority]);
      queue.push(id, priority);
    }
    const expected = [...pushed].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([id]) => id);
    const popped: number[] = [];
    for (let id = queue.pop(); id >= 0; id = queue.pop()) popped.push(id);
    expect(popped).toEqual(expected);
    expect(queue.size).toBe(0);
  });

  it('takes negative priorities (the map pops the most fuel first)', () => {
    const queue = new NodeQueue();
    queue.push(0, -5);
    queue.push(1, -80);
    queue.push(2, 0);
    expect([queue.pop(), queue.pop(), queue.pop(), queue.pop()]).toEqual([1, 0, 2, -1]);
  });
});

describe('IntList', () => {
  it('grows by doubling and keeps every value', () => {
    const list = new IntList(2);
    for (let i = 0; i < 100; i++) expect(list.push(i * 3)).toBe(i);
    expect(list.length).toBe(100);
    expect(list.get(99)).toBe(297);
    list.set(5, -1);
    expect(list.get(5)).toBe(-1);
  });
});

describe('searchWithEnemies', () => {
  const level = levelFromRows(
    ['################', '#..............#', '#..............#', '#.P....S....T.D#', '################'],
    { id: 'spike' },
  );

  it('finds a script that starts with the idle ready minimum, and reports what it stored and expanded', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const result = searchWithEnemies(sim, keys, floodEstimate(level, P, sim.climbTiles()), 1_000_000);
    expect(result.end).toBe('won');
    expect(result.script?.runs[0]).toEqual([0, P.readyMinTicks]);
    expect(result.nodes).toBeGreaterThan(result.expanded);
    expect(result.expanded).toBeGreaterThan(0);
  });

  it('stops at the budget, before the next expansion, and names its closest approach', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const flood = floodEstimate(level, P, sim.climbTiles());
    const result = searchWithEnemies(sim, keys, flood, 1, closenessEstimate(level, P, flood));
    expect(result.end).toBe('budget');
    expect(result.script).toBeNull();
    expect(result.expanded).toBe(1);
    expect(result.stuckAt?.row).toBe(3);
  });

  it('with a budget of 0 stores the root and expands nothing', () => {
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const result = searchWithEnemies(sim, keys, floodEstimate(level, P, sim.climbTiles()), 0);
    expect(result).toMatchObject({ end: 'budget', script: null, nodes: 1, expanded: 0 });
  });

  it('skips a representative that a state with more fuel replaced while it was queued', () => {
    // A cog boxed in on every side, and a pack: flight states of one key are met with different fuel. When the
    // search runs dry every stored state has come off the queue once, expanded or skipped as replaced.
    const boxed = levelFromRows(['##########', '#....###.#', '#....#T#.#', '#PJ..###D#', '##########'], { id: 'boxed-cog-pack' });
    const sim = new Sim(boxed, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(boxed, P, DEFAULT_OPTIONS);
    const result = searchWithEnemies(sim, keys, floodEstimate(boxed, P, sim.climbTiles()), 10_000_000);
    expect(result.end).toBe('exhausted');
    expect(result.expanded).toBeLessThan(result.nodes);
  });

  it('tells an empty frontier from a spent budget: a walled-in cog is "exhausted"', () => {
    const walled = levelFromRows(['##########', '#....#...#', '#P...#T.D#', '##########'], { id: 'walled' });
    const sim = new Sim(walled, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(walled, P, DEFAULT_OPTIONS);
    const result = searchWithEnemies(sim, keys, floodEstimate(walled, P, sim.climbTiles()), 10_000_000);
    expect(result.end).toBe('exhausted');
    expect(sim.stepCalls).toBeLessThan(10_000_000);
  });
});
