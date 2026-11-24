import { describe, expect, it } from 'vitest';

import { compileTuning } from '../compileTuning';
import { withoutItem } from '../level';
import { createSession, step } from '../game';
import { inputFromBits } from '../script';
import { levelFromRows, REFERENCE_PHYS, REFERENCE_TUNING, referencePhysWith } from '../testkit';
import type { GameEvent, InputScript, LevelData, LevelProof } from '../types';
import { InputBit } from '../types';
import { tunnels } from './fixtures';
import { handicap } from './handicap';
import { replayScript, validateLevel } from './index';
import { COMFORT_OPTIONS, DEFAULT_OPTIONS, REQUIRES_OPTIONS } from './options';

/**
 * The validator's verdicts on small fixtures (docs/ARCHITECTURE.md, sections
 * 9.1 to 9.4, and the row for validate in section 12). Every fixture runs on
 * REFERENCE_PHYS. The Phase 4 gate is in gate.test.ts.
 */

const P = REFERENCE_PHYS;
const COMFORT_PHYS = compileTuning(handicap(REFERENCE_TUNING));

/** A proven proof, its script replayed through the real step(): same ticks, no death. */
function expectProven(level: LevelData, proof: LevelProof, phys = P): InputScript {
  expect(proof.verdict, JSON.stringify({ stage: proof.stage, stuckAt: proof.stuckAt })).toBe('proven');
  expect(proof.stuckAt).toBeNull();
  const script = proof.script;
  if (script === null) throw new Error('a proven proof carries a script');
  const replay = replayScript(level, phys, script);
  expect(replay).toMatchObject({ won: true, died: null, trophyTick: proof.trophyTick, winTick: proof.winTick });
  expect(proof.trophyTick).toBeGreaterThan(0);
  expect(proof.winTick).toBeGreaterThan(proof.trophyTick);
  return script;
}

/** Nothing proven: no script, no ticks. */
function expectNotProven(proof: LevelProof): void {
  expect(proof.script).toBeNull();
  expect(proof.trophyTick).toBe(-1);
  expect(proof.winTick).toBe(-1);
}

// A Cinderpeg walks the floor of a tunnel 1 tile high; 1-tile pits at both ends keep it in there.
// The only way to the cog is through the tunnel. With the blaster at column 3 it can be shot.
const TUNNEL_ROWS = [
  '###############',
  '#....######...#',
  '#P...C......TD#',
  '####.######.###',
  '###############',
];
const tunnelLevel = (withBlaster: boolean): LevelData =>
  levelFromRows(withBlaster ? TUNNEL_ROWS.map((line, row) => (row === 2 ? line.replace('#P..', '#P.B') : line)) : TUNNEL_ROWS, {
    id: withBlaster ? 'tunnel-blaster' : 'tunnel',
  });

describe('validateLevel: proven', () => {
  it('proves a flat walk to the cog and back to the airlock, with the script starting on the ready minimum', () => {
    const level = levelFromRows(['##########', '#........#', '#D.P...T.#', '##########'], { id: 'walk' });
    const proof = validateLevel(level, P);
    const script = expectProven(level, proof);
    expect(proof.stage).toBe('quick');
    expect(script.runs[0]).toEqual([0, P.readyMinTicks]);
    expect(proof.levelId).toBe('walk');
    // The quick pass ran alone: no map.
    expect(proof.unreachableCrystals).toBeNull();
    expect(proof.stats.groundNodes + proof.stats.flightNodes).toBe(0);
    expect(proof.stats.searchNodes).toBeGreaterThan(0);
  });

  it('proves a route over a fire pit and up a 3-tile step, normal and comfort', () => {
    const level = levelFromRows(
      [
        '################',
        '#..............#',
        '#.........T....#',
        '#.........###..#',
        '#.........###..#',
        '#.P....FF.###.D#',
        '################',
      ],
      { id: 'pit-and-step' },
    );
    expectProven(level, validateLevel(level, P));
    expectProven(level, validateLevel(level, COMFORT_PHYS, COMFORT_OPTIONS), COMFORT_PHYS);
  });

  it('shoots its way through: the blaster is fired from the ground at the Cinderpeg in the tunnel', () => {
    const level = tunnelLevel(true);
    const proof = validateLevel(level, P);
    const script = expectProven(level, proof);
    expect(script.runs.some(([bits]) => (bits & InputBit.Fire) !== 0)).toBe(true);
  });

  it('flies with a thruster pack where no jump reaches: up a 6-tile shaft to the cog', () => {
    const level = levelFromRows(
      [
        '############',
        '#......T...#',
        '#....####.##',
        '#....#.....#',
        '#....#.....#',
        '#....#.....#',
        '#....#.....#',
        '#.P.J#....D#',
        '############',
      ],
      { id: 'shaft' },
    );
    // The airlock is behind the wall: the way there is over it, then down the hole at column 9.
    const proof = validateLevel(level, P);
    const script = expectProven(level, proof);
    expect(script.runs.some(([bits]) => (bits & InputBit.Thrust) !== 0)).toBe(true);
    // Without the pack the cog cannot be reached at all.
    const without = validateLevel(withoutItem(level, 'thruster'), P, { alwaysMap: true });
    expect(without.verdict).toBe('trophy-unreachable');
  });

  it('is deterministic: the same proof twice, script and counters identical', () => {
    const level = tunnelLevel(true);
    const a = validateLevel(level, P);
    const b = validateLevel(level, P);
    expect(b).toEqual(a);
    expect(JSON.stringify(b.script)).toBe(JSON.stringify(a.script));
  });
});

describe('validateLevel: the verdicts that fail', () => {
  it('unsafe-start: a Cinderpeg walks into the hero standing still; stuckAt is where the hero died', () => {
    const level = levelFromRows(['##########', '#........#', '#P..C..TD#', '##########'], { id: 'unsafe' });
    const proof = validateLevel(level, P);
    expect(proof.verdict).toBe('unsafe-start');
    expect(proof.stage).toBe('safe-start');
    expect(proof.stuckAt).toEqual({ col: 1, row: 2 });
    expectNotProven(proof);
    // One tick of fire and safeStartTicks idle ticks at most, after the ready minimum.
    expect(proof.stats.stepCalls).toBeLessThanOrEqual(P.readyMinTicks + 1 + DEFAULT_OPTIONS.safeStartTicks);
  });

  it('unsafe-start counts exactly safeStartTicks idle ticks: a death on the last one counts, one later does not', () => {
    const level = levelFromRows(['##########', '#........#', '#P..C..TD#', '##########'], { id: 'unsafe' });
    // The idle tick on which the Cinderpeg reaches the hero, after the ready minimum and one tick of fire.
    const game = createSession([level], P);
    for (let i = 0; i < P.readyMinTicks; i++) step(game, inputFromBits(0));
    step(game, inputFromBits(InputBit.Fire));
    let deathTick = 0;
    while (game.run.phase !== 'dying') {
      step(game, inputFromBits(0));
      deathTick += 1;
    }
    expect(validateLevel(level, P, { safeStartTicks: deathTick }).verdict).toBe('unsafe-start');
    expect(validateLevel(level, P, { safeStartTicks: deathTick - 1 }).verdict).not.toBe('unsafe-start');
  });

  // The cog sits in a closed box; the airlock is beyond a wall that no jump can clear.
  const boxedCog = levelFromRows(
    ['##########', '#....###.#', '#....#T#.#', '#P...###D#', '##########'],
    { id: 'boxed-cog' },
  );

  it('trophy-unreachable: the enemy-free map holds no state with the cog; stuckAt is the nearest point', () => {
    const proof = validateLevel(boxedCog, P, { alwaysMap: true });
    expect(proof.verdict).toBe('trophy-unreachable');
    expect(proof.stage).toBe('map');
    // Standing against the box, the centre of the hero is in column 4 of the floor row.
    expect(proof.stuckAt).toEqual({ col: 4, row: 3 });
    expect(proof.stats.groundNodes).toBeGreaterThan(0);
    // Map first and it failed: the quick pass ran after it, on what was left, and found no win either.
    expect(proof.stats.searchNodes).toBeGreaterThan(0);
    expectNotProven(proof);
  });

  it('a level without packs whose quick pass runs out of budget goes on to the map', () => {
    const proof = validateLevel(boxedCog, P, { quickStepCalls: 0 });
    expect(proof.verdict).toBe('trophy-unreachable');
    expect(proof.stage).toBe('map');
    // The quick pass stored the root and expanded nothing: one search node.
    expect(proof.stats.searchNodes).toBe(1);
  });

  it('a level without packs whose quick pass runs dry goes on to the map too, which names the reason', () => {
    const proof = validateLevel(boxedCog, P);
    expect(proof.verdict).toBe('trophy-unreachable');
    expect(proof.stage).toBe('map');
    expect(proof.stuckAt).toEqual({ col: 4, row: 3 });
    expect(proof.unreachableCrystals).toEqual([]);
    expect(proof.stats.groundNodes).toBeGreaterThan(0);
    expectNotProven(proof);
  });

  it('no-route: on a level with packs the quick pass is the only search; stuckAt is its closest approach', () => {
    // The boxed cog with a pack: the hero can fly, but the box is closed on every side.
    const withPack = levelFromRows(
      ['##########', '#....###.#', '#....#T#.#', '#PJ..###D#', '##########'],
      { id: 'boxed-cog-pack' },
    );
    const proof = validateLevel(withPack, P);
    expect(proof.verdict).toBe('no-route');
    expect(proof.stage).toBe('quick');
    expect(proof.unreachableCrystals).toBeNull();
    expect(proof.stats.groundNodes + proof.stats.flightNodes).toBe(0);
    // No flood reaches the cog, so closeness is the straight distance: the hero flying against the box, level
    // with the cog. Never the start, where every state would be if the order of the search ranked them.
    expect(proof.stuckAt).toEqual({ col: 4, row: 2 });
    expectNotProven(proof);
  });

  it('door-unreachable: the cog can be taken, the airlock is walled in; stuckAt is beside the wall', () => {
    const level = levelFromRows(['##########', '#......###', '#P...T.#D#', '##########'], { id: 'boxed-door' });
    const proof = validateLevel(level, P, { alwaysMap: true });
    expect(proof.verdict).toBe('door-unreachable');
    expect(proof.stage).toBe('map');
    expect(proof.stuckAt).toEqual({ col: 6, row: 2 });
    expectNotProven(proof);
  });

  it('blocked-by-enemies: winnable without enemies, but the Cinderpeg holds the tunnel and there is no blaster', () => {
    const level = tunnelLevel(false);
    const proof = validateLevel(level, P, { alwaysMap: true });
    expect(proof.verdict).toBe('blocked-by-enemies');
    expect(proof.stage).toBe('guided');
    expect(proof.stats.searchNodes).toBeGreaterThan(0);
    // The closest approach is inside the tunnel, behind the Cinderpeg: never past it.
    const stuck = proof.stuckAt;
    expect(stuck?.row).toBe(2);
    expect(stuck?.col).toBeGreaterThanOrEqual(1);
    expect(stuck?.col).toBeLessThanOrEqual(10);
    expectNotProven(proof);
    // The same level without alwaysMap: the quick pass runs dry, then the map and the guided search say the same.
    expect(validateLevel(level, P)).toMatchObject({ verdict: 'blocked-by-enemies', stage: 'guided' });
  });

  it('a level with packs gives its quick pass all of maxStepCalls: quickStepCalls is for levels without packs', () => {
    const shaft = levelFromRows(['########', '#.....T#', '#......#', '#P.J..D#', '########'], { id: 'tiny-pack' });
    const proof = validateLevel(shaft, P, { quickStepCalls: 0 });
    expectProven(shaft, proof);
    expect(proof.stage).toBe('quick');
    expect(proof.stats.groundNodes + proof.stats.flightNodes).toBe(0);
  });

  it('budget-exceeded at each stage that can run out: quick pass with packs, map, and the total budget', () => {
    const shaft = levelFromRows(['########', '#.....T#', '#......#', '#P.J..D#', '########'], { id: 'tiny-pack' });
    const quick = validateLevel(shaft, P, { maxStepCalls: 500 });
    expect(quick).toMatchObject({ verdict: 'budget-exceeded', stage: 'quick' });
    const map = validateLevel(boxedCog, P, { alwaysMap: true, maxStepCalls: 2_000 });
    expect(map).toMatchObject({ verdict: 'budget-exceeded', stage: 'map', unreachableCrystals: null });
    expectNotProven(map);
    // A budget overrun ends the call within one expansion of the limit.
    expect(map.stats.stepCalls).toBeLessThan(2_000 + 20_000);
    const none = validateLevel(boxedCog, P, { maxStepCalls: 0 });
    expect(none.verdict).toBe('budget-exceeded');
  });
});

/**
 * Every search keeps one representative per key, so an exhausted search means "no win among the states it
 * kept". The quick pass, the map and the guided search merge on different keys in different orders, and each
 * finds wins the others miss. These small levels (found by a reviewer's fuzzing, on REFERENCE_PHYS) each make
 * one stage miss a win; the pipeline must still prove them. If a later change to the search makes the stage
 * named below win by itself, the fixture no longer tests the fallback: find another one.
 */
describe('validateLevel: one stage misses a win that another finds (merging)', () => {
  // A 2-tile coolant pit before a 3-tile ledge under the lip of the start platform. The quick pass runs dry here.
  const quickMisses = levelFromRows(
    [
      '#############################',
      '#..............G...G........#',
      '#........P.....##...........#',
      '#........####...........G...#',
      '#...........................#',
      '#...........................#',
      '#.T........D.F..........##..#',
      '########..####..........#####',
      '########WW#############.#####',
    ],
    { id: 'quick-misses' },
  );

  it('a level without packs whose quick pass runs dry is proven by the map and the guided search', () => {
    const proof = validateLevel(quickMisses, P);
    expectProven(quickMisses, proof);
    expect(proof.stage).toBe('guided');
    // The quick pass ran first (its nodes are counted) and did not win: it gave up, and the map took over.
    expect(proof.stats.groundNodes).toBeGreaterThan(0);
  });

  // No enemy anywhere. Map first, the map finds no win with the airlock; the quick pass wins.
  const mapMissesDoor = levelFromRows(
    [
      '@requires blaster',
      '##################',
      '#................#',
      '#................#',
      '#................#',
      '#................#',
      '#....P........G..#',
      '#....##..........#',
      '#...........D....#',
      '#..........#####.#',
      '#FF.BT.....#####.#',
      '######...#.#####.#',
      '######W..#W#####.#',
    ],
    { id: 'map-misses-door' },
  );

  it('map first: when the map says door-unreachable, the quick pass after it still proves the level', () => {
    // A false "@requires blaster": nothing here needs the blaster, and suite (c) must not certify the promise.
    const without = withoutItem(mapMissesDoor, 'blaster');
    const proof = validateLevel(without, P, { ...REQUIRES_OPTIONS, alwaysMap: true });
    expectProven(without, proof);
    expect(proof.stage).toBe('quick');
    expect(proof.stats.groundNodes).toBeGreaterThan(0);
    // As suite (c) runs it.
    expect(validateLevel(without, P, REQUIRES_OPTIONS).verdict).toBe('proven');
  });

  it('never says blocked-by-enemies on a level without enemies: an exhausted guided search there is no-route', () => {
    expect(mapMissesDoor.enemies).toEqual([]);
    // Comfort, map first, and no budget for the quick pass afterwards: the guided search's own verdict shows.
    const proof = validateLevel(mapMissesDoor, COMFORT_PHYS, { ...COMFORT_OPTIONS, alwaysMap: true, quickStepCalls: 0 });
    expect(proof).toMatchObject({ verdict: 'no-route', stage: 'guided' });
    expectNotProven(proof);
    // With the quick pass's budget it is proven.
    expectProven(mapMissesDoor, validateLevel(mapMissesDoor, COMFORT_PHYS, { ...COMFORT_OPTIONS, alwaysMap: true }), COMFORT_PHYS);
  });

  it('map first: a false trophy-unreachable and a false blocked-by-enemies are overruled by the quick pass', () => {
    const mapMissesTrophy = levelFromRows(
      [
        '##########################',
        '#.......................G#',
        '#......................M.#',
        '#........................#',
        '#....P.........#####.....#',
        '#....#######.###.CT....G##',
        '#..D....####.######.#.#.##',
        '############.######.#.#.##',
        '############.######W#.#.##',
      ],
      { id: 'map-misses-trophy' },
    );
    const guidedMisses = levelFromRows(
      [
        '####################',
        '#.P................#',
        '#.#####............#',
        '#.........DT.......#',
        '#........####....C.#',
        '#.............####.#',
        '#...............G..#',
        '#...........G......#',
        '#####.....##....G..#',
        '#######W#######.#.##',
      ],
      { id: 'guided-misses' },
    );
    for (const level of [mapMissesTrophy, guidedMisses]) {
      const proof = validateLevel(level, P, { alwaysMap: true });
      expectProven(level, proof);
      expect(proof.stage).toBe('quick');
    }
    // What the map and the guided search say on their own: give the quick pass no budget.
    expect(validateLevel(mapMissesTrophy, P, { alwaysMap: true, quickStepCalls: 0 }).verdict).toBe('trophy-unreachable');
    expect(validateLevel(guidedMisses, P, { alwaysMap: true, quickStepCalls: 0 }).verdict).toBe('blocked-by-enemies');
  });
});

describe('validateLevel: the ready gate', () => {
  it('with readyMinFrames 0 the root still takes one idle tick, so the gate is armed and every level can start', () => {
    const phys = referencePhysWith({ timing: { readyMinFrames: 0 } });
    expect(phys.readyMinTicks).toBe(0);
    const level = levelFromRows(['##########', '#........#', '#D.P...T.#', '##########'], { id: 'walk' });
    const proof = validateLevel(level, phys);
    const script = expectProven(level, proof, phys);
    expect(proof.stage).toBe('quick');
    expect(script.runs[0]).toEqual([0, 1]);
    expectProven(level, validateLevel(level, phys, { alwaysMap: true }), phys);
  });
});

describe('validateLevel: the enemy-free map and the guided search', () => {
  it('a level without packs that needs the map and the guided search: the quick pass is given no budget', () => {
    const level = tunnelLevel(true);
    const proof = validateLevel(level, P, { quickStepCalls: 0 });
    expectProven(level, proof);
    expect(proof.stage).toBe('guided');
    expect(proof.stats.groundNodes).toBeGreaterThan(0);
    expect(proof.unreachableCrystals).toEqual([]);
  });

  it('alwaysMap goes map first even when the quick pass would win, and the guided search proves it', () => {
    const level = tunnels();
    const proof = validateLevel(level, P, { alwaysMap: true });
    expectProven(level, proof);
    expect(proof.stage).toBe('guided');
  });

  it('lists the crystals no state of the map collected, and only those', () => {
    const level = levelFromRows(
      [
        '##############',
        '#....G...###.#',
        '#........#G#.#',
        '#........###.#',
        '#.P........TD#',
        '##############',
      ],
      { id: 'crystals' },
    );
    const proof = validateLevel(level, P, { alwaysMap: true });
    expectProven(level, proof);
    // (5,1) is 3 tiles over the floor, under the ceiling: reachable. (10,2) is walled in on all eight sides.
    expect(proof.unreachableCrystals).toEqual([{ col: 10, row: 2 }]);
  });

  it('counts a crystal as reachable when only states that never get the cog collect it', () => {
    // The crystal lies at the bottom of a shaft 1 tile wide and 4 deep on the start ledge: a hero that falls in
    // stays there. The cog is below the ledge, 5 tiles down: no hero holding it ever comes back up.
    const level = levelFromRows(
      [
        '############',
        '#..........#',
        '#..........#',
        '#.P........#',
        '###.#......#',
        '###.#......#',
        '###.#......#',
        '###G#......#',
        '#####.D..T.#',
        '############',
      ],
      { id: 'crystal-trap' },
    );
    const proof = validateLevel(level, P, { alwaysMap: true });
    expectProven(level, proof);
    expect(proof.unreachableCrystals).toEqual([]);
  });

  it('pins the guided search on the tunnel: the map\'s unknown keys cost its root cost plus 600 ticks', () => {
    // Regression numbers: a change to the guided search's order (such as the penalty for a key the map never
    // stored) moves them. Update them only for a change that is meant to move them.
    const proof = validateLevel(tunnelLevel(true), P, { quickStepCalls: 0 });
    expect(proof.stage).toBe('guided');
    expect(proof.stats).toEqual({ groundNodes: 439, flightNodes: 0, searchNodes: 124, stepCalls: 47_967 });
  });

  it('rejects options that are not whole numbers in range, naming the option', () => {
    const level = tunnelLevel(true);
    expect(() => validateLevel(level, P, { decisionTicks: 0 })).toThrow(/decisionTicks/);
    expect(() => validateLevel(level, P, { groundBucketPx: 2.5 })).toThrow(/groundBucketPx/);
    expect(() => validateLevel(level, P, { airSwitchTicks: [8, -1] })).toThrow(/airSwitchTicks/);
  });
});

describe('replayScript', () => {
  const level = levelFromRows(
    ['##############', '#............#', '#............#', '#............#', '#DP...FF...T.#', '##############'],
    { id: 'fire-pit' },
  );

  it('replays a proof through a fresh session: the cog and the airlock on the proof ticks', () => {
    const proof = validateLevel(level, P);
    expectProven(level, proof);
  });

  it('a tampered script fails: without its jumps the hero walks into the fire', () => {
    const script = validateLevel(level, P).script;
    if (script === null) throw new Error('the fixture is proven');
    const tampered: InputScript = { runs: script.runs.map(([bits, ticks]) => [bits & ~InputBit.Jump, ticks] as const) };
    const replay = replayScript(level, P, tampered);
    expect(replay.won).toBe(false);
    expect(replay.died).toBe('fire');
    expect(replay.winTick).toBe(-1);
    // The replay stops on the tick of the death: count the ticks to the playerDied event independently.
    const game = createSession([level], P);
    const events: GameEvent[] = [];
    let ticks = 0;
    outer: for (const [bits, count] of tampered.runs) {
      for (let i = 0; i < count; i++) {
        step(game, inputFromBits(bits), events);
        ticks += 1;
        if (events.some((event) => event.type === 'playerDied')) break outer;
      }
    }
    expect(replay.ticks).toBe(ticks);
    expect(ticks).toBeLessThan(tampered.runs.reduce((sum, [, count]) => sum + count, 0));
  });

  it('a script cut short ends without a win and without a death', () => {
    const script = validateLevel(level, P).script;
    if (script === null) throw new Error('the fixture is proven');
    const short: InputScript = { runs: script.runs.slice(0, 1) };
    expect(replayScript(level, P, short)).toEqual({
      won: false,
      trophyTick: -1,
      winTick: -1,
      died: null,
      ticks: script.runs[0]?.[1],
    });
  });

  it('stops at the win: ticks after it are not stepped', () => {
    const proof = validateLevel(level, P);
    const script = proof.script;
    if (script === null) throw new Error('the fixture is proven');
    const longer: InputScript = { runs: [...script.runs, [0, 500]] };
    const replay = replayScript(level, P, longer);
    expect(replay.won).toBe(true);
    expect(replay.ticks).toBe(proof.winTick);
  });
});
