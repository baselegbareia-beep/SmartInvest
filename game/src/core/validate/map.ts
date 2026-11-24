/**
 * Stage 2 of the validator (docs/ARCHITECTURE.md, section 9.4): the
 * exhaustive enemy-free map.
 *
 * Every enemy is dead from the root on. The map stores one state per hero
 * key (StateKeys.hero), expands them all, most effective fuel first, and
 * records every edge: which key a manoeuvre led to and how many ticks it
 * took, or that it won. When nothing is left to expand, a backward
 * shortest-path pass from the wins gives every key its cost to go in ticks:
 * the guided search's estimate. The map also answers on its own why a level
 * fails when enemies are not the reason (no state with the trophy, or the
 * trophy but no win), and which crystals no state collected.
 *
 * Edges point at keys, not at states: when a better representative of a key
 * (more effective fuel) replaces one that was not yet expanded, the edges
 * already recorded into that key lead on through the new one.
 */
import type { Cell, GameState } from '../types';
import type { Estimate } from './heuristic';
import { heroCell } from './heuristic';
import { UNKNOWN_KEY_PENALTY_TICKS } from './options';
import { IntList, NodeQueue } from './search';
import type { RunBuffer, Sim, StateKeys } from './successors';
import { Expander, isWon } from './successors';

/** The target of an edge that wins. */
const WIN = -1;

export interface EnemyFreeMap {
  /** True when every stored state was expanded inside the budget. Nothing below is final otherwise. */
  readonly finished: boolean;
  /** Some state held the trophy. */
  readonly trophyReached: boolean;
  /** Some manoeuvre won. */
  readonly winReached: boolean;
  /** Ticks from the root to the nearest win, or -1. */
  readonly rootCost: number;
  /** For each pickup index: true when some state of the map had taken it. */
  readonly pickupsTaken: readonly boolean[];
  /** The stored state closest to the goal by `closeness`: the closest approach. */
  readonly stuckAt: Cell | null;
  readonly groundNodes: number;
  readonly flightNodes: number;
  readonly expanded: number;
  /** Ticks to the nearest win from a state, by its hero key; -1 when the map never stored the key or has no win from it. */
  costToGo(game: GameState): number;
}

/**
 * Builds the map with at most `budget` more step() calls (checked before
 * each expansion). `closeness` ranks stored states for stuckAt (the flood
 * estimate of the quick pass).
 */
export function buildMap(sim: Sim, keys: StateKeys, closeness: Estimate, budget: number): EnemyFreeMap {
  const level = sim.level;
  const phys = sim.phys;
  const root = sim.root(true);
  const keyOf = (game: GameState): number => keys.hero(game);
  const expander = new Expander(sim, root, keyOf, false);
  const start = sim.stepCalls;

  // Keys get slots in the order they are met. Each slot has one representative at a time.
  const slotOf = new Map<number, number>();
  const slotPotential = new IntList();
  const slotEntry = new IntList();
  // Entries: every representative ever queued, with its state until it is expanded or replaced.
  const entrySlot = new IntList();
  const entryState: (GameState | null)[] = [];
  const edgeFrom = new IntList(4096);
  const edgeTo = new IntList(4096);
  const edgeCost = new IntList(4096);
  const queue = new NodeQueue();

  const taken = level.pickups.map(() => false);

  // Set inside emit: a record, so the compiler does not take them for constants after the loop.
  const reached = { trophy: false, win: false };
  let groundNodes = 0;
  let flightNodes = 0;
  let closest = Infinity;
  let closestAt: Cell | null = null;
  let currentSlot = -1;

  const edge = (to: number, cost: number): void => {
    // A move back into its own key shortens no path.
    if (to === currentSlot) return;
    edgeFrom.push(currentSlot);
    edgeTo.push(to);
    edgeCost.push(cost);
  };

  const queueEntry = (game: GameState, slot: number, potential: number): void => {
    const entry = entrySlot.push(slot);
    entryState.push(sim.copyOf(game));
    slotEntry.set(slot, entry);
    // Most effective fuel first: a state with less fuel under the same key comes too late to replace a better one.
    queue.push(entry, -Math.max(0, potential));
    if (game.run.player.onGround) groundNodes += 1;
    else flightNodes += 1;
    const h = closeness(game);
    if (h < closest) {
      closest = h;
      closestAt = heroCell(level, phys, game);
    }
  };

  const emit = (game: GameState, runs: RunBuffer): void => {
    const cost = runs.total;
    // Pickups stay taken along a branch (a death would put items back, but dead branches never get here).
    const takenNow = game.run.taken;
    for (let i = 0; i < takenNow.length; i++) {
      if (takenNow[i] === true) taken[i] = true;
    }
    if (isWon(game)) {
      reached.win = true;
      reached.trophy = true;
      edge(WIN, cost);
      return;
    }
    if (game.run.hasTrophy) reached.trophy = true;
    const key = keyOf(game);
    const potential = keys.potential(game);
    let slot = slotOf.get(key);
    if (slot === undefined) {
      slot = slotPotential.push(potential);
      slotEntry.push(-1);
      slotOf.set(key, slot);
      queueEntry(game, slot, potential);
    } else if (potential > slotPotential.get(slot)) {
      const old = slotEntry.get(slot);
      const oldState = entryState[old];
      if (oldState !== null && oldState !== undefined) {
        sim.recycle(oldState);
        entryState[old] = null;
      }
      slotPotential.set(slot, potential);
      queueEntry(game, slot, potential);
    }
    edge(slot, cost);
  };

  const rootSlot = slotPotential.push(keys.potential(root));
  slotEntry.push(-1);
  slotOf.set(keyOf(root), rootSlot);
  queueEntry(root, rootSlot, keys.potential(root));

  let finished = true;
  let expanded = 0;
  for (;;) {
    if (sim.stepCalls - start >= budget) {
      finished = false;
      break;
    }
    const entry = queue.pop();
    if (entry < 0) break;
    const game = entryState[entry];
    if (game === null || game === undefined) continue;
    entryState[entry] = null;
    currentSlot = entrySlot.get(entry);
    expander.expand(game, emit);
    sim.recycle(game);
    expanded += 1;
  }
  // States still queued when the budget ran out go back to the pool.
  for (let i = 0; i < entryState.length; i++) {
    const game = entryState[i];
    if (game !== null && game !== undefined) sim.recycle(game);
    entryState[i] = null;
  }

  const slots = slotPotential.length;
  const dist = new Int32Array(slots).fill(-1);
  if (finished && reached.win) costsToGo(slots, edgeFrom, edgeTo, edgeCost, dist);

  return {
    finished,
    trophyReached: reached.trophy,
    winReached: reached.win,
    rootCost: dist[rootSlot] ?? -1,
    pickupsTaken: taken,
    stuckAt: closestAt,
    groundNodes,
    flightNodes,
    expanded,
    costToGo: (game) => {
      const slot = slotOf.get(keyOf(game));
      return slot === undefined ? -1 : (dist[slot] ?? -1);
    },
  };
}

/**
 * The guided search's estimate (section 9.4): the map's cost to go from the
 * state's hero key. A key the map never stored, or stored without a way to
 * win, is estimated at the map's cost from the root plus
 * UNKNOWN_KEY_PENALTY_TICKS: the search with enemies can reach states the
 * enemy-free map did not keep, so such a state is put back, never pruned.
 */
export function guidedEstimate(map: EnemyFreeMap): Estimate {
  const unknown = map.rootCost + UNKNOWN_KEY_PENALTY_TICKS;
  return (game) => {
    const cost = map.costToGo(game);
    return cost < 0 ? unknown : cost;
  };
}

/**
 * Dijkstra backwards from the wins over the recorded edges: `dist[slot]`
 * becomes the fewest ticks from that key to a win (left at -1 when there is
 * none). Edge costs are at least one tick.
 */
function costsToGo(slots: number, from: IntList, to: IntList, cost: IntList, dist: Int32Array): void {
  // Incoming edges of every slot, as one flat list (counting, then filling).
  const firstIn = new Int32Array(slots + 1);
  for (let e = 0; e < to.length; e++) {
    const target = to.get(e);
    if (target !== WIN) firstIn[target + 1] = (firstIn[target + 1] ?? 0) + 1;
  }
  for (let s = 0; s < slots; s++) firstIn[s + 1] = (firstIn[s + 1] ?? 0) + (firstIn[s] ?? 0);
  const fill = firstIn.slice(0, slots);
  const inFrom = new Int32Array(Math.max(1, firstIn[slots] ?? 0));
  const inCost = new Int32Array(inFrom.length);
  const tentative = new Int32Array(slots).fill(0x7fffffff);
  const queue = new NodeQueue();
  for (let e = 0; e < to.length; e++) {
    const target = to.get(e);
    const source = from.get(e);
    const ticks = cost.get(e);
    if (target === WIN) {
      if (ticks < (tentative[source] ?? 0)) {
        tentative[source] = ticks;
        queue.push(source, ticks);
      }
      continue;
    }
    const at = fill[target] ?? 0;
    fill[target] = at + 1;
    inFrom[at] = source;
    inCost[at] = ticks;
  }
  for (;;) {
    const slot = queue.pop();
    if (slot < 0) break;
    if ((dist[slot] ?? 0) >= 0) continue;
    const d = tentative[slot] ?? 0;
    dist[slot] = d;
    const end = firstIn[slot + 1] ?? 0;
    for (let i = firstIn[slot] ?? 0; i < end; i++) {
      const source = inFrom[i] ?? 0;
      const through = d + (inCost[i] ?? 0);
      if ((dist[source] ?? 0) < 0 && through < (tentative[source] ?? 0)) {
        tentative[source] = through;
        queue.push(source, through);
      }
    }
  }
}
