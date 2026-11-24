import { describe, expect, it } from 'vitest';

import { createRun, respawnRun } from './run';
import {
  IN,
  NONE,
  REFERENCE_PHYS,
  REFERENCE_TUNING,
  levelFromRows,
  playingGame,
  referencePhysWith,
  stepTicks,
  sub,
} from './testkit';
import { TILE } from './types';
import type { GameEvent, GameState, Input, RunState } from './types';

/**
 * createRun and respawnRun against docs/ARCHITECTURE.md, section 5.1 (hero
 * start) and section 6 (the table "What a respawn keeps and resets"), on the
 * reference numbers. The last block checks the builders of testkit.ts, which
 * every other rule test leans on.
 */

const P = REFERENCE_PHYS;

/**
 * Hero at col 1, row 2. Pickups in reading order: crystal, blaster, thruster,
 * crystal, thruster. Enemies in reading order: H moth, M moth, Cinderpeg.
 */
const ROOM = levelFromRows([
  'G..H....B.',
  '...M..J...',
  '.P.G.CJ.TD',
  '##########',
]);

/** Every value in a run, with its path, so a test can say which field broke a rule. */
function leaves(value: unknown, path = 'run'): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
  }
  return [[path, value]];
}

/** A run in which every field a respawn must reset has been moved off its start value, as after a busy life. */
function usedRun(): RunState {
  const run = createRun(ROOM, P);
  run.tick = 777;
  run.phase = 'dying';
  run.phaseTicks = P.dyingTicks;
  run.phaseLength = P.dyingTicks;
  run.readyArmed = true;
  Object.assign(run.player, {
    x: 30000,
    y: 5000,
    vx: -384,
    vy: 640,
    facing: -1,
    onGround: false,
    coyote: 3,
    jumpBuffer: 4,
    fireBuffer: 5,
    jumpArc: true,
    thrusting: true,
    hasBlaster: true,
    hasThruster: true,
    fuel: 41,
    prevJump: true,
    prevFire: true,
  });
  for (const enemy of run.enemies) {
    enemy.x += 1234;
    enemy.y += 567;
    enemy.dir = 1;
    enemy.alive = false;
  }
  run.enemyPaid.fill(true);
  run.taken.fill(true);
  Object.assign(run.bolt, { active: true, x: 9000, y: 8000, dir: -1, rangeLeft: 2048 });
  run.hasTrophy = true;
  run.deathCause = 'spikes';
  return run;
}

describe('createRun', () => {
  it('stands the hero on P: centred in the cell, feet on its floor, facing right, on the ground', () => {
    const { player } = createRun(ROOM, P);
    expect(player.x).toBe(1 * TILE + ((TILE - P.heroW) >> 1));
    expect(player.y).toBe((2 + 1) * TILE - P.heroH);
    // The same in numbers: a 10 px body leaves 3 px on each side, a 14 px body ends on the floor line.
    expect(player.x).toBe(sub(16 + 3));
    expect(player.y).toBe(sub(48 - 14));
    expect(player.facing).toBe(1);
    expect(player.onGround).toBe(true);
  });

  it('starts the hero at rest, empty-handed, with every timer and press memory cleared', () => {
    const { player } = createRun(ROOM, P);
    expect(player).toEqual({
      x: sub(19),
      y: sub(34),
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: true,
      coyote: 0,
      jumpBuffer: 0,
      fireBuffer: 0,
      jumpArc: false,
      thrusting: false,
      hasBlaster: false,
      hasThruster: false,
      fuel: 0,
      prevJump: false,
      prevFire: false,
    });
  });

  it('starts in the ready gate: tick 0, minimum of readyMinTicks, not armed', () => {
    const run = createRun(ROOM, P);
    expect(run.tick).toBe(0);
    expect(run.phase).toBe('ready');
    expect(run.phaseTicks).toBe(0);
    expect(run.phaseLength).toBe(P.readyMinTicks);
    expect(run.phaseLength).toBe(12);
    expect(run.readyArmed).toBe(false);
    expect(run.deathCause).toBeNull();
  });

  it('puts every enemy on its cell, alive, heading left or up, in the order of the level', () => {
    const run = createRun(ROOM, P);
    expect(run.enemies).toEqual([
      { kind: 'moth', axis: 'h', x: 3 * TILE, y: 0, dir: -1, alive: true },
      { kind: 'moth', axis: 'v', x: 3 * TILE, y: 1 * TILE, dir: -1, alive: true },
      { kind: 'cinderpeg', x: 5 * TILE, y: 2 * TILE, dir: -1, alive: true },
    ]);
    expect(run.enemyPaid).toEqual([false, false, false]);
  });

  it('gives both enemy kinds the same first five fields in the same order, the moth\'s axis last: the per-tick loops read them faster', () => {
    const run = createRun(ROOM, P);
    expect(run.enemies.map((enemy) => Object.keys(enemy))).toEqual([
      ['kind', 'x', 'y', 'dir', 'alive', 'axis'],
      ['kind', 'x', 'y', 'dir', 'alive', 'axis'],
      ['kind', 'x', 'y', 'dir', 'alive'],
    ]);
  });

  it('starts with nothing taken, no trophy and no bolt', () => {
    const run = createRun(ROOM, P);
    expect(run.taken).toEqual([false, false, false, false, false]);
    expect(run.taken).toHaveLength(ROOM.pickups.length);
    expect(run.hasTrophy).toBe(false);
    expect(run.bolt.active).toBe(false);
  });

  it('holds integers, booleans, phase and kind names only', () => {
    const allowedText = new Set(['ready', 'moth', 'cinderpeg', 'h', 'v']);
    const wrong = leaves(createRun(ROOM, P)).filter(([, value]) => {
      if (typeof value === 'number') return !Number.isInteger(value);
      if (typeof value === 'string') return !allowedText.has(value);
      return typeof value !== 'boolean' && value !== null;
    });
    expect(wrong).toEqual([]);
  });

  it('builds a run that shares no object with another run of the same level', () => {
    const a = createRun(ROOM, P);
    const b = createRun(ROOM, P);
    expect(a).toEqual(b);
    expect(a.player).not.toBe(b.player);
    expect(a.enemies).not.toBe(b.enemies);
    expect(a.enemies[0]).not.toBe(b.enemies[0]);
    expect(a.enemyPaid).not.toBe(b.enemyPaid);
    expect(a.taken).not.toBe(b.taken);
    expect(a.bolt).not.toBe(b.bolt);
  });

  it('follows the hero size of the Phys it is given', () => {
    const small = referencePhysWith({ hero: { heroHitboxW: 8, heroHitboxH: 12 } });
    const { player } = createRun(ROOM, small);
    expect(player.x).toBe(sub(16 + 4));
    expect(player.y).toBe(sub(48 - 12));
  });
});

describe('respawnRun: what is reset', () => {
  it('returns the hero to the start: position, zero velocity, facing right, on the ground, timers and flags cleared', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.player).toEqual(createRun(ROOM, P).player);
  });

  it('takes the blaster, the thruster and the fuel away', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.player.hasBlaster).toBe(false);
    expect(run.player.hasThruster).toBe(false);
    expect(run.player.fuel).toBe(0);
  });

  it('puts every blaster and thruster pack back and leaves every crystal taken', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(ROOM.pickups.map((p) => p.kind)).toEqual(['crystal', 'blaster', 'thruster', 'crystal', 'thruster']);
    expect(run.taken).toEqual([true, false, false, true, false]);
  });

  it('does not take a crystal that was still there', () => {
    const run = createRun(ROOM, P);
    run.taken[1] = true;
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.taken).toEqual([false, false, false, false, false]);
  });

  it('brings every enemy back to its cell, alive, heading left or up', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.enemies).toEqual(createRun(ROOM, P).enemies);
  });

  it('removes the bolt and clears the cause of death', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.bolt.active).toBe(false);
    expect(run.deathCause).toBeNull();
  });

  it('shuts the ready gate for the length it is given: unarmed, phaseTicks 0', () => {
    const afterDeath = usedRun();
    respawnRun(afterDeath, ROOM, P, P.respawnReadyTicks);
    expect(afterDeath.phase).toBe('ready');
    expect(afterDeath.phaseTicks).toBe(0);
    expect(afterDeath.phaseLength).toBe(22);
    expect(afterDeath.readyArmed).toBe(false);

    const afterRestart = usedRun();
    afterRestart.phase = 'playing';
    respawnRun(afterRestart, ROOM, P, P.readyMinTicks);
    expect(afterRestart.phase).toBe('ready');
    expect(afterRestart.phaseTicks).toBe(0);
    expect(afterRestart.phaseLength).toBe(12);
    expect(afterRestart.readyArmed).toBe(false);
  });
});

describe('respawnRun: what is kept', () => {
  it('keeps the trophy, so the door stays open', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.hasTrophy).toBe(true);
  });

  it('keeps enemyPaid, so an enemy that comes back is worth nothing', () => {
    const run = usedRun();
    run.enemyPaid[1] = false;
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.enemyPaid).toEqual([true, false, true]);
  });

  it('keeps run.tick counting', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.tick).toBe(777);
  });

  it('leaves a level that is its start state plus the kept collectibles, field for field', () => {
    const run = usedRun();
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    const fresh = createRun(ROOM, P);
    // Only bolt.active is reset; the rest of an inactive bolt is meaningless and left as it was.
    expect({ ...run, bolt: { active: run.bolt.active } }).toEqual({
      ...fresh,
      tick: 777,
      phaseLength: P.respawnReadyTicks,
      taken: [true, false, false, true, false],
      enemyPaid: [true, true, true],
      hasTrophy: true,
      bolt: { active: false },
    });
  });

  it('works in place: the player, enemy, bolt and array objects stay the same ones', () => {
    const run = usedRun();
    const { player, enemies, enemyPaid, taken, bolt } = run;
    const firstEnemy = enemies[0];
    respawnRun(run, ROOM, P, P.respawnReadyTicks);
    expect(run.player).toBe(player);
    expect(run.enemies).toBe(enemies);
    expect(run.enemies[0]).toBe(firstEnemy);
    expect(run.enemyPaid).toBe(enemyPaid);
    expect(run.taken).toBe(taken);
    expect(run.bolt).toBe(bolt);
  });

  it('gives the same run however many times it is applied', () => {
    const once = usedRun();
    respawnRun(once, ROOM, P, P.respawnReadyTicks);
    const twice = usedRun();
    respawnRun(twice, ROOM, P, P.respawnReadyTicks);
    respawnRun(twice, ROOM, P, P.respawnReadyTicks);
    expect(twice).toEqual(once);
  });
});

describe('testkit: the reference numbers', () => {
  it('compiles the reference tuning to the numbers the golden values were measured with', () => {
    expect(P.heroW).toBe(sub(10));
    expect(P.heroH).toBe(sub(14));
    expect(P.runMax).toBe(384);
    expect(P.jumpVel).toBe(1280);
    expect(P.gravRise).toBe(64);
    expect(P.gravFall).toBe(112);
    expect(P.thrustAccel).toBe(96);
    expect(P.fuelTicks).toBe(80);
    expect(P.dyingTicks).toBe(52);
    expect(P.respawnReadyTicks).toBe(22);
    expect(P.readyMinTicks).toBe(12);
    expect(P.exitTicks).toBe(60);
  });

  it('holds integers only in REFERENCE_PHYS', () => {
    expect(Object.entries(P).filter(([, value]) => !Number.isInteger(value))).toEqual([]);
  });

  it('is frozen, so one test cannot change the numbers of another', () => {
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(REFERENCE_TUNING)).toBe(true);
    expect(Object.isFrozen(REFERENCE_TUNING.jump)).toBe(true);
    expect(Object.isFrozen(REFERENCE_TUNING.score)).toBe(true);
  });

  it('referencePhysWith changes the named numbers, keeps the rest and recompiles derived fields', () => {
    const phys = referencePhysWith({
      forgiveness: { coyoteFrames: 0, jumpBufferFrames: 0 },
      timing: { fadeFrames: 20 },
    });
    expect(phys.coyoteTicks).toBe(0);
    expect(phys.jumpBufferTicks).toBe(0);
    expect(phys.dyingTicks).toBe(6 + 36 + 20);
    expect(phys.respawnReadyTicks).toBe(20 + 12);
    expect({ ...phys, coyoteTicks: 6, jumpBufferTicks: 7, dyingTicks: 52, respawnReadyTicks: 22 }).toEqual(P);
    expect(referencePhysWith({})).toEqual(P);
    expect(P.coyoteTicks).toBe(6);
  });

  it('referencePhysWith refuses an unsafe number, as compileTuning does', () => {
    expect(() => referencePhysWith({ run: { runMaxSpeed: 8 } })).toThrow(/runMaxSpeed/);
  });

  it('sub converts art pixels exactly and refuses a value that is not a whole number of sub-pixels', () => {
    expect(sub(1)).toBe(256);
    expect(sub(5.25)).toBe(1344);
    expect(sub(-0.5)).toBe(-128);
    expect(() => sub(0.001)).toThrow(/sub\(0\.001\)/);
  });
});

describe('testkit: the builders', () => {
  it('levelFromRows reads rows through parseLevel, headers included, with the id it is given', () => {
    const level = levelFromRows(['@requires blaster', '; note', 'B...', '.PTD', '####'], { id: 'tiny' });
    expect(level.id).toBe('tiny');
    expect(level.requires).toEqual(['blaster']);
    expect(level.start).toEqual({ col: 1, row: 1 });
    expect(levelFromRows(['.PTD', '####']).id).toBe('fixture');
    expect(() => levelFromRows(['.P.D', '####'])).toThrow('levels/fixture.txt: expected exactly one T (trophy), found 0');
  });

  it('levelFromRows with frame wraps the grid in walls and moves every cell one column right and one row down', () => {
    const open = levelFromRows(['@name Framed', 'G...', '.PTD', '####']);
    const framed = levelFromRows(['@name Framed', 'G...', '.PTD', '####'], { frame: true });
    expect(framed.name).toBe('Framed');
    expect(framed.width).toBe(open.width + 2);
    expect(framed.height).toBe(open.height + 2);
    expect(framed.start).toEqual({ col: open.start.col + 1, row: open.start.row + 1 });
    expect(framed.pickups).toEqual([{ col: 1, row: 1, kind: 'crystal' }]);
    const text = Array.from({ length: framed.height }, (_, r) =>
      Array.from(framed.tiles.subarray(r * framed.width, (r + 1) * framed.width)).join(''),
    );
    expect(text).toEqual(['111111', '100001', '100001', '111111', '111111']);
  });

  it('playingGame gives a one-level game with the gate open and the hero standing on P', () => {
    const game = playingGame(ROOM);
    expect(game.phys).toBe(P);
    expect(game.levels).toEqual([ROOM]);
    expect(game.level).toBe(ROOM);
    expect(game.session).toEqual({ status: 'playing', levelIndex: 0, score: 0, lives: P.startLives, highestUnlocked: 0 });
    expect(game.run.phase).toBe('playing');
    expect(game.run.phaseTicks).toBe(0);
    expect(game.run.phaseLength).toBe(0);
    expect(game.run.tick).toBe(0);
    expect({ ...game.run, phase: 'ready', phaseLength: P.readyMinTicks, readyArmed: false }).toEqual(createRun(ROOM, P));
  });

  it('playingGame uses the Phys it is given', () => {
    const phys = referencePhysWith({ lives: { startLives: 2 } });
    const game = playingGame(ROOM, phys);
    expect(game.phys).toBe(phys);
    expect(game.session.lives).toBe(2);
  });

  it('IN holds exactly the named buttons and hands out one shared frozen object per combination', () => {
    expect(IN('RJ')).toEqual({ left: false, right: true, jump: true, fire: false, thrust: false });
    expect(IN('LFT')).toEqual({ left: true, right: false, jump: false, fire: true, thrust: true });
    expect(IN('JR')).toBe(IN('RJ'));
    expect(IN('')).toBe(NONE);
    expect(NONE).toEqual({ left: false, right: false, jump: false, fire: false, thrust: false });
    expect(Object.isFrozen(IN('R'))).toBe(true);
  });

  it('IN refuses a letter that is not a button, so a typo cannot pass as "nothing held"', () => {
    expect(() => IN('RX')).toThrow("IN('RX'): unknown button 'X' (use L R J F T)");
    expect(() => IN('r')).toThrow(/unknown button 'r'/);
  });

  it('stepTicks calls the step function n times with the same game, input and event list', () => {
    const game = playingGame(ROOM);
    const events: GameEvent[] = [];
    const calls: [GameState, Input, GameEvent[] | undefined][] = [];
    const record = (g: GameState, input: Input, list?: GameEvent[]): void => {
      calls.push([g, input, list]);
      g.run.tick += 1;
    };

    stepTicks(record, game, 'RJ', 3, events);
    stepTicks(record, game, NONE, 2);
    stepTicks(record, game, 'L', 0);

    expect(game.run.tick).toBe(5);
    expect(calls.map(([g]) => g)).toEqual([game, game, game, game, game]);
    expect(calls.map(([, input]) => input)).toEqual([IN('RJ'), IN('RJ'), IN('RJ'), NONE, NONE]);
    expect(calls.map(([, , list]) => list)).toEqual([events, events, events, undefined, undefined]);
  });
});
