import { describe, expect, it } from 'vitest';

import { cloneGame, createSession, step } from '../game';
import { inputFromBits } from '../script';
import { levelFromRows, REFERENCE_PHYS } from '../testkit';
import type { GameState } from '../types';
import { InputBit, SUB, TILE } from '../types';
import { DEFAULT_OPTIONS } from './options';
import { Expander, RunBuffer, Sim, StateKeys } from './successors';

const P = REFERENCE_PHYS;
const { Left: LEFT, Right: RIGHT, Jump: JUMP, Fire: FIRE, Thrust: THRUST } = InputBit;

/** Session and run of a state as text: everything a manoeuvre may change. */
const snapshot = (game: GameState): string => JSON.stringify({ session: game.session, run: game.run });

interface Emitted {
  readonly state: GameState;
  readonly runs: readonly (readonly [number, number])[];
}

/** Expands `state` once and keeps a copy of every result with its runs. */
function expandAll(sim: Sim, state: GameState, keyOf: (game: GameState) => number, allowFire: boolean): Emitted[] {
  const out: Emitted[] = [];
  const expander = new Expander(sim, state, keyOf, allowFire);
  expander.expand(state, (game, runs) => {
    const copy: [number, number][] = [];
    for (let i = 0; i < runs.length; i++) copy.push([runs.bits[i] ?? 0, runs.ticks[i] ?? 0]);
    let total = 0;
    for (const [, n] of copy) total += n;
    expect(runs.total).toBe(total);
    out.push({ state: cloneGame(game), runs: copy });
  });
  return out;
}

/** The parent stepped through the real step() with the runs: must give the emitted state exactly. */
function replayFrom(parent: GameState, runs: readonly (readonly [number, number])[]): GameState {
  const game = cloneGame(parent);
  for (const [bits, n] of runs) for (let i = 0; i < n; i++) step(game, inputFromBits(bits));
  return game;
}

/** The search root: on the ground, the ready gate armed by the idle minimum. */
function rootOf(sim: Sim): GameState {
  return sim.root(false);
}

describe('RunBuffer', () => {
  it('joins ticks of the same bits, counts the total, and restores an earlier point', () => {
    const runs = new RunBuffer();
    runs.add(RIGHT, 3);
    runs.add(RIGHT, 2);
    runs.add(RIGHT | JUMP, 1);
    runs.add(0, 0);
    expect(runs.length).toBe(2);
    expect(runs.total).toBe(6);
    const length = runs.length;
    const last = runs.lastTicks();
    const total = runs.total;
    runs.add(RIGHT | JUMP, 4);
    runs.add(LEFT, 9);
    runs.restore(length, last, total);
    expect([runs.length, runs.total, runs.lastTicks()]).toEqual([2, 6, 1]);
    expect(Array.from(runs.bits.slice(0, 2))).toEqual([RIGHT, RIGHT | JUMP]);
  });
});

describe('StateKeys', () => {
  const level = levelFromRows(
    ['@requires thruster', '################', '#..............#', '#.P.J.......M.T#', '#D###########.##', '################'],
    { id: 'keys' },
  );
  const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
  const base = createSession([level], P);

  it('gives one key to states in one x bucket, row and vx bucket, and a new key when any of them changes', () => {
    const a = cloneGame(base);
    const b = cloneGame(base);
    // Same 4 px bucket: x differs by 1 px inside it.
    a.run.player.x = 4 * TILE;
    b.run.player.x = 4 * TILE + SUB;
    expect(keys.hero(a)).toBe(keys.hero(b));
    b.run.player.x = 4 * TILE + 4 * SUB;
    expect(keys.hero(a)).not.toBe(keys.hero(b));
    b.run.player.x = a.run.player.x;
    b.run.player.vx = 10;
    expect(keys.hero(a)).not.toBe(keys.hero(b));
    const c = cloneGame(b);
    c.run.player.vx = 20;
    // Both are part speed to the right: one bucket.
    expect(keys.hero(c)).toBe(keys.hero(b));
    c.run.player.vx = P.runMax;
    expect(keys.hero(c)).not.toBe(keys.hero(b));
  });

  it('keys the trophy and which packs are taken, never crystals', () => {
    const a = cloneGame(base);
    const b = cloneGame(base);
    b.run.hasTrophy = true;
    expect(keys.hero(b)).not.toBe(keys.hero(a));
    b.run.hasTrophy = false;
    b.run.taken[0] = true;
    expect(keys.hero(b)).not.toBe(keys.hero(a));
  });

  it('adds hasBlaster, facing while armed and the live enemies near the hero; a far enemy is left out', () => {
    const a = cloneGame(base);
    const b = cloneGame(base);
    expect(keys.full(a)).toBe(keys.full(b));
    // The moth is 10 tiles away: its position is not in the key, its life is. 9 px is past its 8 px bucket.
    const moth = b.run.enemies[0];
    if (moth === undefined) throw new Error('the fixture has a moth');
    moth.y += 9 * SUB;
    expect(keys.full(b)).toBe(keys.full(a));
    b.run.player.x = 10 * TILE;
    a.run.player.x = 10 * TILE;
    expect(keys.full(b)).not.toBe(keys.full(a));
    const dead = cloneGame(base);
    const enemy = dead.run.enemies[0];
    if (enemy !== undefined) enemy.alive = false;
    expect(keys.full(dead)).not.toBe(keys.full(base));
    const armed = cloneGame(base);
    armed.run.player.hasBlaster = true;
    const turned = cloneGame(armed);
    turned.run.player.facing = -1;
    expect(new Set([keys.full(base), keys.full(armed), keys.full(turned)]).size).toBe(3);
    // Unarmed, facing is not in the key.
    const unarmedTurned = cloneGame(base);
    unarmedTurned.run.player.facing = -1;
    expect(keys.full(unarmedTurned)).toBe(keys.full(base));
    // The hero part is the same for all of them.
    expect(keys.hero(armed)).toBe(keys.hero(base));
  });

  it('keys a near enemy by its index, its position bucket and its direction', () => {
    // Two Cinderpegs on one floor; the hero stands between them, both within 4 tiles.
    const pair = levelFromRows(
      ['################', '#..............#', '#.P.C...C....TD#', '################'],
      { id: 'pair' },
    );
    const pairKeys = new StateKeys(pair, P, DEFAULT_OPTIONS);
    const game = createSession([pair], P);
    game.run.player.x = 6 * TILE;
    const [first, second] = game.run.enemies;
    if (first === undefined || second === undefined) throw new Error('the fixture has two Cinderpegs');
    const key = pairKeys.full(game);
    // The same place, walking the other way: another key (one of them may be the only timing that wins).
    first.dir = first.dir > 0 ? -1 : 1;
    expect(pairKeys.full(game)).not.toBe(key);
    first.dir = first.dir > 0 ? -1 : 1;
    expect(pairKeys.full(game)).toBe(key);
    // One enemy near at a place and the other far, then the other way round: two keys.
    second.x = 15 * TILE;
    first.x = 7 * TILE;
    const firstNear = pairKeys.full(game);
    first.x = 15 * TILE;
    second.x = 7 * TILE;
    second.dir = first.dir;
    expect(pairKeys.full(game)).not.toBe(firstNear);
  });

  it('leaves out an enemy exactly enemyKeyRadiusTiles away, and keys one a sub-pixel nearer', () => {
    const game = cloneGame(base);
    const moth = game.run.enemies[0];
    if (moth === undefined) throw new Error('the fixture has a moth');
    game.run.player.x = 2 * TILE;
    game.run.player.y = moth.y;
    const radius = DEFAULT_OPTIONS.enemyKeyRadiusTiles * TILE;
    moth.x = game.run.player.x + radius;
    const far = keys.full(game);
    // Moving a far enemy changes nothing; a near one is in the key.
    moth.y += 9 * SUB;
    expect(keys.full(game)).toBe(far);
    moth.y -= 9 * SUB;
    moth.x -= 1;
    const near = keys.full(game);
    expect(near).not.toBe(far);
    moth.y += 9 * SUB;
    expect(keys.full(game)).not.toBe(near);
  });

  it('keys a flight state by its cell and the sign of vx', () => {
    const right = cloneGame(base);
    const p = right.run.player;
    p.onGround = false;
    p.x = 6 * TILE + 2 * SUB;
    p.y = 2 * TILE + 2 * SUB;
    p.vx = 40;
    const left = cloneGame(right);
    left.run.player.vx = -40;
    const still = cloneGame(right);
    still.run.player.vx = 0;
    expect(new Set([keys.hero(right), keys.hero(left), keys.hero(still)]).size).toBe(3);
    // Inside one 8 px cell, speed and place within it do not matter.
    const faster = cloneGame(right);
    faster.run.player.vx = P.runMax;
    faster.run.player.x += 3 * SUB;
    expect(keys.hero(faster)).toBe(keys.hero(right));
  });

  it('ranks by effective fuel: the fuel on the ground; in flight less the thrust needed to climb, plus height in the cell', () => {
    const ground = cloneGame(base);
    ground.run.player.hasThruster = true;
    ground.run.player.fuel = 50;
    expect(keys.potential(ground)).toBe(50);
    const flight = cloneGame(ground);
    const p = flight.run.player;
    p.onGround = false;
    p.y = 2 * TILE + 2 * SUB;
    p.vy = 200;
    const cell = DEFAULT_OPTIONS.flightCellPx * SUB;
    const below = (Math.trunc(p.y / cell) + 1) * cell - p.y;
    expect(keys.potential(flight)).toBe(
      50 - Math.trunc((200 + P.thrustMaxRise) / P.thrustAccel) + Math.trunc(below / P.thrustMaxRise),
    );
    // Without the pack the fuel counts for nothing.
    expect(keys.potential(base)).toBe(0);
  });
});

describe('Expander', () => {
  const room = levelFromRows(
    [
      '##################################',
      '#................................#',
      '#................................#',
      '#................................#',
      '#................................#',
      '#.T............P................D#',
      '##################################',
    ],
    { id: 'open-room' },
  );

  it('every result of a ground expansion is the real step() of its runs from the parent', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const root = rootOf(sim);
    const results = expandAll(sim, root, (g) => keys.full(g), true);
    expect(results.length).toBeGreaterThan(0);
    for (const { state, runs } of results) expect(snapshot(replayFrom(root, runs))).toBe(snapshot(state));
  });

  it('offers three holds, 21 full jumps and 15 taps from open ground; each turns once at 8, 16 or 24 arc ticks', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const root = rootOf(sim);
    const results = expandAll(sim, root, (g) => keys.full(g), true);
    const jumps = results.filter(({ runs }) => runs.some(([bits]) => (bits & JUMP) !== 0));
    const holds = results.filter(({ runs }) => runs.every(([bits]) => (bits & JUMP) === 0));
    expect(holds).toHaveLength(3);
    // A full jump holds jump to the end; it lasts 41 ticks on flat ground, past every switch tick: 3 x (1 + 3 x 2).
    const full = jumps.filter(({ runs }) => runs.every(([bits]) => (bits & JUMP) !== 0));
    expect(full).toHaveLength(21);
    // A tap holds jump for exactly tapTicks ticks, then lets go; its hop ends before the third switch tick: 3 x (1 + 2 x 2).
    const taps = jumps.filter((jump) => !full.includes(jump));
    expect(taps).toHaveLength(15);
    for (const { runs } of taps) {
      expect(runs[0]?.[1]).toBe(DEFAULT_OPTIONS.tapTicks);
      expect(runs.slice(1).every(([bits]) => (bits & JUMP) === 0)).toBe(true);
    }
    // A turned full jump changes direction exactly on a switch tick: its first run ends there.
    const turnedAt = new Set(full.filter(({ runs }) => runs.length === 2).map(({ runs }) => runs[0]?.[1]));
    expect([...turnedAt].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...DEFAULT_OPTIONS.airSwitchTicks]);
    for (const { state } of jumps) expect(state.run.player.onGround).toBe(true);
  });

  it('with fuel also lifts off on thrust and hands off a flight state at the apex of each straight full jump', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const root = rootOf(sim);
    root.run.player.hasThruster = true;
    root.run.player.fuel = P.fuelTicks;
    const results = expandAll(sim, root, (g) => keys.full(g), true);
    for (const { state, runs } of results) expect(snapshot(replayFrom(root, runs))).toBe(snapshot(state));
    const airborne = results.filter(({ state }) => !state.run.player.onGround);
    for (const { state } of airborne) expect(state.run.player.fuel).toBeGreaterThan(0);
    // Thrust lift-off: one per direction, thrust held from the first tick.
    const liftOffs = airborne.filter(({ runs }) => ((runs[0]?.[0] ?? 0) & THRUST) !== 0);
    expect(liftOffs.map(({ runs }) => runs[0]?.[0])).toEqual([THRUST, LEFT | THRUST, RIGHT | THRUST]);
    // The apex hand-off: jump held, no thrust, emitted as the rise ends (vy no longer negative).
    const apexes = airborne.filter(({ runs }) => runs.every(([bits]) => (bits & JUMP) !== 0 && (bits & THRUST) === 0));
    expect(apexes.map(({ runs }) => runs.map(([bits]) => bits))).toEqual([[JUMP], [LEFT | JUMP], [RIGHT | JUMP]]);
    for (const { state } of apexes) expect(state.run.player.vy).toBeGreaterThanOrEqual(0);
    expect(airborne).toHaveLength(liftOffs.length + apexes.length);
    // The landed jumps are the same 36 as without fuel.
    expect(results.filter(({ state, runs }) => state.run.player.onGround && runs.some(([bits]) => (bits & JUMP) !== 0))).toHaveLength(36);
  });

  it('walking off a ledge with fuel gives both a flight state and the plain fall to the floor', () => {
    const ledge = levelFromRows(
      ['################', '#..............#', '#....P.........#', '#######........#', '#..............#', '#.T..........D.#', '################'],
      { id: 'ledge' },
    );
    const sim = new Sim(ledge, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(ledge, P, DEFAULT_OPTIONS);
    const edge = rootOf(sim);
    const player = edge.run.player;
    player.hasThruster = true;
    player.fuel = P.fuelTicks;
    // At the very edge of the ledge, running right: the first tick of the right hold steps off.
    player.x = 7 * TILE - SUB;
    player.vx = P.runMax;
    const walks = expandAll(sim, edge, (g) => keys.full(g), true).filter(({ runs }) => runs.every(([bits]) => bits === RIGHT));
    const flying = walks.filter(({ state }) => !state.run.player.onGround);
    const landed = walks.filter(({ state }) => state.run.player.onGround);
    expect(flying).toHaveLength(1);
    expect(flying[0]?.state.run.player.fuel).toBe(P.fuelTicks);
    expect(landed).toHaveLength(1);
    expect(landed[0]?.state.run.player.y).toBeGreaterThan(4 * TILE);
    for (const { state, runs } of walks) expect(snapshot(replayFrom(edge, runs))).toBe(snapshot(state));
  });

  it('lets go of jump for one tick before a jump when it is still held from a landing, so every jump starts', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const landedHolding = rootOf(sim);
    landedHolding.run.player.prevJump = true;
    const results = expandAll(sim, landedHolding, (g) => keys.full(g), true);
    const jumps = results.filter(({ runs }) => runs.some(([bits]) => (bits & JUMP) !== 0));
    expect(jumps).toHaveLength(36);
    for (const { state, runs } of jumps) {
      expect(runs[0]).toEqual([0, 1]);
      expect(snapshot(replayFrom(landedHolding, runs))).toBe(snapshot(state));
    }
    // A full jump really leaves the ground: 41 ticks in the air on flat ground, after the released tick.
    const straight = jumps.filter(({ runs }) => runs.length === 2 && runs[1]?.[0] === JUMP);
    expect(straight.map(({ runs }) => runs[1]?.[1])).toEqual([41]);
  });

  it('holds an input that leaves the key unchanged for up to maxHoldDecisions decisions', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const root = rootOf(sim);
    const results = expandAll(sim, root, (g) => keys.full(g), true);
    const k = DEFAULT_OPTIONS.decisionTicks;
    // Standing still changes nothing in the key: held three decisions. Walking leaves the bucket in one.
    expect(results[0]?.runs).toEqual([[0, DEFAULT_OPTIONS.maxHoldDecisions * k]]);
    expect(results[1]?.runs).toEqual([[LEFT, k]]);
    expect(results[2]?.runs).toEqual([[RIGHT, k]]);
  });

  it('in flight offers thrust and coast in three directions, each the real step() of its runs', () => {
    const sim = new Sim(room, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(room, P, DEFAULT_OPTIONS);
    const flying = rootOf(sim);
    const player = flying.run.player;
    player.hasThruster = true;
    player.fuel = P.fuelTicks;
    // Open the gate and rise for a while on thrust.
    for (let i = 0; i < 10; i++) step(flying, inputFromBits(THRUST));
    expect(player.onGround).toBe(false);
    const results = expandAll(sim, flying, (g) => keys.full(g), true);
    expect(results.map(({ runs }) => runs[0]?.[0])).toEqual([THRUST, 0, LEFT | THRUST, LEFT, RIGHT | THRUST, RIGHT]);
    for (const { state, runs } of results) expect(snapshot(replayFrom(flying, runs))).toBe(snapshot(state));
  });

  it('fires only with the blaster, at a live enemy ahead, and waits for the bolt to end', () => {
    const level = levelFromRows(
      ['################', '#..............#', '#..P......C...D#', '####T###########', '################'],
      { id: 'fire' },
    );
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const armed = rootOf(sim);
    armed.run.player.hasBlaster = true;
    const shots = (state: GameState, allow: boolean): Emitted[] =>
      expandAll(sim, state, (g) => keys.full(g), allow).filter(({ runs }) => runs[0]?.[0] === FIRE);
    const [shot, ...more] = shots(armed, true);
    expect(more).toHaveLength(0);
    if (shot === undefined) throw new Error('a shot is offered');
    expect(shot.state.run.bolt.active).toBe(false);
    expect(shot.state.run.enemies[0]?.alive).toBe(false);
    expect(snapshot(replayFrom(armed, shot.runs))).toBe(snapshot(shot.state));
    // Not in the map (allowFire false), not unarmed, not facing away.
    expect(shots(armed, false)).toHaveLength(0);
    const unarmed = rootOf(sim);
    expect(shots(unarmed, true)).toHaveLength(0);
    const away = cloneGame(armed);
    away.run.player.facing = -1;
    expect(shots(away, true)).toHaveLength(0);
  });

  it('aims at an enemy up to boltRange plus 2 tiles ahead and within 2 tiles of height, and no farther', () => {
    const level = levelFromRows(
      ['################', '#..............#', '#..P......C...D#', '####T###########', '################'],
      { id: 'fire' },
    );
    const sim = new Sim(level, P, DEFAULT_OPTIONS);
    const keys = new StateKeys(level, P, DEFAULT_OPTIONS);
    const armed = rootOf(sim);
    armed.run.player.hasBlaster = true;
    const shotAt = (dx: number, dy: number): number => {
      const state = cloneGame(armed);
      const enemy = state.run.enemies[0];
      if (enemy === undefined) throw new Error('the fixture has a Cinderpeg');
      enemy.x = state.run.player.x + dx;
      enemy.y = state.run.player.y + dy;
      return expandAll(sim, state, (g) => keys.full(g), true).filter(({ runs }) => runs[0]?.[0] === FIRE).length;
    };
    const reach = P.boltRange + 2 * TILE;
    // Out of the bolt's range, but the hero may walk into the bolt's path: still worth a shot.
    expect(shotAt(P.boltRange + TILE, 0)).toBe(1);
    expect(shotAt(reach - 1, 0)).toBe(1);
    expect(shotAt(reach, 0)).toBe(0);
    // One tile higher, and a sub-pixel under two tiles: offered; two tiles: not.
    expect(shotAt(4 * TILE, -TILE)).toBe(1);
    expect(shotAt(4 * TILE, 2 * TILE - 1)).toBe(1);
    expect(shotAt(4 * TILE, 2 * TILE)).toBe(0);
  });
});
