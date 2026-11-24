/**
 * The search with enemies (docs/ARCHITECTURE.md, section 9.4): stage 1, the
 * quick pass, and stage 3, the guided search. Both are the same weighted A*
 * over manoeuvres, ordered by f = ticks so far + heuristicWeight * estimate;
 * only the estimate differs (the flood fill, or the enemy-free map's cost to
 * go). A win found ends the search, and the chain of manoeuvres that led to
 * it is the script.
 *
 * Also here: the two small containers the map shares (a growable list of
 * integers and a priority queue), so that no stage allocates per node more
 * than the GameState it keeps.
 */
import type { Cell, GameState, InputScript } from '../types';
import type { Estimate } from './heuristic';
import { heroCell } from './heuristic';
import type { RunBuffer, Sim, StateKeys } from './successors';
import { Expander, isWon, readyTicks } from './successors';

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** A list of 32-bit integers that grows by doubling. */
export class IntList {
  data: Int32Array;
  length = 0;

  constructor(capacity = 1024) {
    this.data = new Int32Array(capacity);
  }

  push(value: number): number {
    if (this.length === this.data.length) {
      const bigger = new Int32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length] = value;
    this.length += 1;
    return this.length - 1;
  }

  get(index: number): number {
    return this.data[index] ?? 0;
  }

  set(index: number, value: number): void {
    this.data[index] = value;
  }
}

/**
 * A binary min-heap of entry ids ordered by (priority, id). Ids are handed
 * out in increasing order, so among equal priorities the oldest comes first:
 * the order is fixed, which keeps every verdict and script reproducible.
 */
export class NodeQueue {
  private ids = new Int32Array(1024);
  private keys = new Float64Array(1024);
  size = 0;

  push(id: number, priority: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      this.ids = ids;
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    let at = this.size;
    this.size += 1;
    // Sift up.
    while (at > 0) {
      const up = (at - 1) >> 1;
      const upKey = this.keys[up] ?? 0;
      if (upKey < priority || (upKey === priority && (this.ids[up] ?? 0) < id)) break;
      this.keys[at] = upKey;
      this.ids[at] = this.ids[up] ?? 0;
      at = up;
    }
    this.keys[at] = priority;
    this.ids[at] = id;
  }

  /** The entry with the lowest priority, or -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.ids[0] ?? -1;
    this.size -= 1;
    const size = this.size;
    if (size === 0) return top;
    const key = this.keys[size] ?? 0;
    const id = this.ids[size] ?? 0;
    // Sift the last entry down from the root.
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= size) break;
      const right = child + 1;
      if (right < size) {
        const ck = this.keys[child] ?? 0;
        const rk = this.keys[right] ?? 0;
        if (rk < ck || (rk === ck && (this.ids[right] ?? 0) < (this.ids[child] ?? 0))) child = right;
      }
      const childKey = this.keys[child] ?? 0;
      if (key < childKey || (key === childKey && id < (this.ids[child] ?? 0))) break;
      this.keys[at] = childKey;
      this.ids[at] = this.ids[child] ?? 0;
      at = child;
    }
    this.keys[at] = key;
    this.ids[at] = id;
    return top;
  }
}

// ---------------------------------------------------------------------------
// The search with enemies
// ---------------------------------------------------------------------------

/** How a search ended. */
export type SearchEnd = 'won' | 'exhausted' | 'budget';

export interface SearchResult {
  readonly end: SearchEnd;
  /** The winning script, from the first tick after startLevel; null unless won. */
  readonly script: InputScript | null;
  /** The cell of the stored state that `closeness` ranks first: the closest approach. */
  readonly stuckAt: Cell | null;
  /** States stored (the root included). */
  readonly nodes: number;
  /** States taken from the queue and expanded. */
  readonly expanded: number;
}

/**
 * Weighted A* with enemies on, from the root (enemies alive), until a win,
 * until nothing is left to try, or until `budget` more step() calls are
 * spent (checked before each expansion; one expansion may overrun it by its
 * own few thousand calls). `closeness` ranks the stored states for stuckAt;
 * by default the estimate itself.
 *
 * Merging: one representative per full key; a later state with the same key
 * replaces it only with more effective fuel (StateKeys.potential). A
 * replaced representative still in the queue is skipped when it comes up.
 */
export function searchWithEnemies(
  sim: Sim,
  keys: StateKeys,
  estimate: Estimate,
  budget: number,
  closeness: Estimate = estimate,
): SearchResult {
  const level = sim.level;
  const phys = sim.phys;
  const weight = sim.options.heuristicWeight;
  const root = sim.root(false);
  const keyOf = (game: GameState): number => keys.full(game);
  const expander = new Expander(sim, root, keyOf, true);
  const start = sim.stepCalls;

  // Per node: parent, ticks so far, its runs in the flat run lists, its effective fuel, and its state while queued.
  const parent = new IntList();
  const ticksTo = new IntList();
  const runStart = new IntList();
  const runCount = new IntList();
  const runBits = new IntList(4096);
  const runTicks = new IntList(4096);
  const potentialOf = new IntList();
  const states: (GameState | null)[] = [];
  /** Key to the node that stands for it. */
  const best = new Map<number, number>();
  const queue = new NodeQueue();

  let closest = Infinity;
  let closestAt: Cell | null = null;
  let goal = -1;
  let current = -1;

  const store = (game: GameState | null, from: number, ticks: number, runs: RunBuffer | null, potential: number): number => {
    const id = parent.push(from);
    ticksTo.push(ticks);
    runStart.push(runBits.length);
    runCount.push(runs === null ? 0 : runs.length);
    if (runs !== null) {
      for (let i = 0; i < runs.length; i++) {
        runBits.push(runs.bits[i] ?? 0);
        runTicks.push(runs.ticks[i] ?? 0);
      }
    }
    potentialOf.push(potential);
    states.push(game);
    return id;
  };

  const consider = (game: GameState, id: number, ticks: number): void => {
    const near = closeness(game);
    if (near < closest) {
      closest = near;
      closestAt = heroCell(level, phys, game);
    }
    queue.push(id, ticks + Math.trunc(weight * estimate(game)));
  };

  const emit = (game: GameState, runs: RunBuffer): void => {
    if (goal >= 0) return;
    const ticks = ticksTo.get(current) + runs.total;
    if (isWon(game)) {
      goal = store(null, current, ticks, runs, 0);
      return;
    }
    const key = keyOf(game);
    const potential = keys.potential(game);
    const replaced = best.get(key);
    if (replaced !== undefined && potential <= potentialOf.get(replaced)) return;
    const id = store(sim.copyOf(game), current, ticks, runs, potential);
    if (replaced !== undefined) {
      // The representative it replaces is skipped when it comes up; its state goes back to the pool now.
      const old = states[replaced];
      if (old !== null && old !== undefined) {
        sim.recycle(old);
        states[replaced] = null;
      }
    }
    best.set(key, id);
    consider(game, id, ticks);
  };

  const rootId = store(sim.copyOf(root), -1, 0, null, keys.potential(root));
  best.set(keyOf(root), rootId);
  consider(root, rootId, 0);

  let expanded = 0;
  let end: SearchEnd = 'exhausted';
  for (;;) {
    if (sim.stepCalls - start >= budget) {
      end = 'budget';
      break;
    }
    const id = queue.pop();
    if (id < 0) break;
    const game = states[id];
    if (game === null || game === undefined) continue;
    states[id] = null;
    current = id;
    expander.expand(game, emit);
    sim.recycle(game);
    expanded += 1;
    if (goal >= 0) {
      end = 'won';
      break;
    }
  }
  // What is still queued goes back to the pool: a later stage of the same call reuses it.
  for (let i = 0; i < states.length; i++) {
    const game = states[i];
    if (game !== null && game !== undefined) sim.recycle(game);
    states[i] = null;
  }

  let script: InputScript | null = null;
  if (goal >= 0) {
    const chain: number[] = [];
    for (let id = goal; id > 0; id = parent.get(id)) chain.push(id);
    chain.reverse();
    // The root's idle ticks (Sim.root) come first.
    const out: [number, number][] = [[0, readyTicks(phys)]];
    for (const id of chain) {
      const first = runStart.get(id);
      const count = runCount.get(id);
      for (let i = first; i < first + count; i++) {
        const bits = runBits.get(i);
        const ticks = runTicks.get(i);
        const last = out[out.length - 1];
        if (last !== undefined && last[0] === bits) last[1] += ticks;
        else out.push([bits, ticks]);
      }
    }
    script = { runs: out };
  }

  return { end, script, stuckAt: closestAt, nodes: parent.length, expanded };
}
