/**
 * The level validator (docs/ARCHITECTURE.md, section 9): validateLevel proves
 * that a level can be won, and replayScript checks such a proof through the
 * real step().
 *
 * The pipeline of section 9.4:
 *   0. safe start      one tick of fire alone (it opens the ready gate), then
 *                      safeStartTicks idle ticks; a death is 'unsafe-start'
 *   1. quick pass      weighted A* with enemies, ordered by the flood-fill
 *                      estimate (skipped with alwaysMap). A win is 'proven'.
 *                      With thruster packs it has all of maxStepCalls and is
 *                      the only search (their map costs more than the pass):
 *                      an empty frontier is 'no-route', a spent budget
 *                      'budget-exceeded'. Without packs either way on to:
 *   2. map             enemy-free and exhaustive; no trophy is
 *                      'trophy-unreachable', the trophy but no win is
 *                      'door-unreachable'
 *   3. guided search   with enemies again, ordered by the map's cost to go:
 *                      'proven', or when exhausted 'blocked-by-enemies'
 *                      ('no-route' on a level without enemies)
 *   map first          with alwaysMap: stages 2 and 3, and when they fail,
 *                      the quick pass on what is left of the budget
 * Every search merges states on a key and keeps one representative per key,
 * so an exhausted search means "no win among the states it kept", not "no
 * win". That is why no single exhausted search ends the pipeline while
 * another one may still run, and why a win of any stage is 'proven'.
 * Any stage that runs out of the total budget (maxStepCalls) ends in
 * 'budget-exceeded'. stuckAt is the closest approach of the stage that named
 * the verdict. A proven script is replayed here once more before it is
 * returned; that replay gives trophyTick and winTick.
 */
import * as gameModule from '../game';
import * as scriptModule from '../script';
import * as units from '../types';
import type {
  Cell,
  DeathCause,
  GameEvent,
  InputScript,
  LevelProof,
  ProofStage,
  ReplayScriptFn,
  ValidateLevelFn,
  Verdict,
} from '../types';
import { closenessEstimate, floodEstimate, heroCell } from './heuristic';
import { buildMap, guidedEstimate } from './map';
import { resolveOptions } from './options';
import type { SearchResult } from './search';
import { searchWithEnemies } from './search';
import { Sim, StateKeys, isDead } from './successors';

const { createSession, step } = gameModule;
const { inputFromBits } = scriptModule;
const { InputBit } = units;

export const replayScript: ReplayScriptFn = (level, phys, script) => {
  const game = createSession([level], phys);
  const events: GameEvent[] = [];
  let trophyTick = -1;
  let winTick = -1;
  let died: DeathCause | null = null;
  let ticks = 0;
  for (const [bits, count] of script.runs) {
    for (let i = 0; i < count; i++) {
      events.length = 0;
      step(game, inputFromBits(bits), events);
      ticks += 1;
      for (const event of events) {
        if (event.type === 'trophyCollected') trophyTick = game.run.tick;
        else if (event.type === 'levelCompleted') winTick = game.run.tick;
        else if (event.type === 'playerDied') died = event.cause;
      }
      // The first death ends the replay; so does the win (the exiting phase only waits).
      if (died !== null || winTick >= 0) return { won: died === null && winTick >= 0, trophyTick, winTick, died, ticks };
    }
  }
  return { won: false, trophyTick, winTick, died, ticks };
};

/** A failure verdict waiting to be returned, with the closest approach of the stage that named it. */
interface Failure {
  readonly verdict: Verdict;
  readonly stage: ProofStage;
  readonly stuckAt: Cell | null;
}

export const validateLevel: ValidateLevelFn = (level, phys, partial) => {
  const options = resolveOptions(partial);
  const sim = new Sim(level, phys, options);
  const keys = new StateKeys(level, phys, options);
  const remaining = (): number => Math.max(0, options.maxStepCalls - sim.stepCalls);
  let groundNodes = 0;
  let flightNodes = 0;
  let searchNodes = 0;
  let unreachableCrystals: readonly Cell[] | null = null;

  const answer = (
    verdict: Verdict,
    stage: ProofStage,
    stuckAt: Cell | null,
    script: InputScript | null = null,
    trophyTick = -1,
    winTick = -1,
  ): LevelProof => ({
    levelId: level.id,
    verdict,
    stage,
    script,
    trophyTick,
    winTick,
    stuckAt: verdict === 'proven' ? null : stuckAt,
    unreachableCrystals,
    stats: { groundNodes, flightNodes, searchNodes, stepCalls: sim.stepCalls },
  });
  const fail = (failure: Failure): LevelProof => answer(failure.verdict, failure.stage, failure.stuckAt);

  const proven = (script: InputScript, stage: ProofStage): LevelProof => {
    const replay = replayScript(level, phys, script);
    sim.stepCalls += replay.ticks;
    if (!replay.won) {
      // Every state of the search came from step(), so this can only be a bug in the validator itself
      // (a field that copyGame forgets, a root that differs from createSession). Say so loudly.
      throw new Error(
        `validator bug: the script found for levels/${level.id}.txt does not win on replay ` +
          `(died: ${replay.died ?? 'no'}, ticks ${replay.ticks})`,
      );
    }
    return answer('proven', stage, null, script, replay.trophyTick, replay.winTick);
  };

  // 0. Safe start: fire opens the gate (harmless without a blaster), then stand still.
  const start = sim.root(false);
  sim.advance(start, InputBit.Fire);
  for (let i = 0; i < options.safeStartTicks && !isDead(start); i++) sim.advance(start, 0);
  if (isDead(start)) return answer('unsafe-start', 'safe-start', heroCell(level, phys, start));

  // The estimates need the height of a plain jump on this tuning (a few dozen counted step() calls).
  const flood = floodEstimate(level, phys, sim.climbTiles());
  const closeness = closenessEstimate(level, phys, flood);
  const hasPacks = level.pickups.some((pickup) => pickup.kind === 'thruster');

  /** Stage 1. Without packs its budget is quickStepCalls; with packs it is the only search and has everything left. */
  const quickPass = (): SearchResult => {
    const budget = hasPacks ? remaining() : Math.min(options.quickStepCalls, remaining());
    const quick = searchWithEnemies(sim, keys, flood, budget, closeness);
    searchNodes += quick.nodes;
    return quick;
  };

  /** Stages 2 and 3: a proof, or the failure they name. */
  const mapThenGuided = (): LevelProof | Failure => {
    const map = buildMap(sim, keys, closeness, remaining());
    groundNodes += map.groundNodes;
    flightNodes += map.flightNodes;
    if (!map.finished) return { verdict: 'budget-exceeded', stage: 'map', stuckAt: map.stuckAt };
    unreachableCrystals = level.pickups.flatMap((pickup, index) =>
      pickup.kind === 'crystal' && map.pickupsTaken[index] !== true ? [{ col: pickup.col, row: pickup.row }] : [],
    );
    if (!map.trophyReached) return { verdict: 'trophy-unreachable', stage: 'map', stuckAt: map.stuckAt };
    if (!map.winReached) return { verdict: 'door-unreachable', stage: 'map', stuckAt: map.stuckAt };

    // Enemies on again, the map's cost to go as the estimate.
    const guided = searchWithEnemies(sim, keys, guidedEstimate(map), remaining());
    searchNodes += guided.nodes;
    if (guided.script !== null) return proven(guided.script, 'guided');
    if (guided.end !== 'exhausted') return { verdict: 'budget-exceeded', stage: 'guided', stuckAt: guided.stuckAt };
    // Exhausted with no enemy in the level: merging lost the win, not an enemy.
    const verdict: Verdict = level.enemies.length > 0 ? 'blocked-by-enemies' : 'no-route';
    return { verdict, stage: 'guided', stuckAt: guided.stuckAt };
  };

  // 1. Quick pass.
  if (!options.alwaysMap) {
    const quick = quickPass();
    if (quick.script !== null) return proven(quick.script, 'quick');
    // With packs the map would cost more than the pass did: no fallback.
    if (hasPacks) return answer(quick.end === 'exhausted' ? 'no-route' : 'budget-exceeded', 'quick', quick.stuckAt);
    if (remaining() === 0) return answer('budget-exceeded', 'quick', quick.stuckAt);
    // Without packs an empty frontier is not the end: the map merges on other keys, in another order.
  }

  // 2 and 3. The enemy-free map and the guided search.
  const result = mapThenGuided();
  if ('levelId' in result) return result;
  // A stage that ran out of budget has left nothing for another one.
  if (!options.alwaysMap || remaining() === 0) return fail(result);

  // Map first and it failed: the quick pass, which merges differently, has the last word on a win.
  const quick = quickPass();
  if (quick.script !== null) return proven(quick.script, 'quick');
  return fail(result);
};
