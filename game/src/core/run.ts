/**
 * The state of one level visit: built fresh by createRun, partly reset by
 * respawnRun after a death or "Restart level" (docs/ARCHITECTURE.md,
 * section 6, the table "What a respawn keeps and resets").
 *
 * The two share the functions below, so that a respawned hero and a respawned
 * enemy are, field for field, what a fresh level starts with. That is what
 * lets one death-free proof of a level cover every life.
 */
import { TILE } from './types';
import type {
  CreateRunFn,
  EnemySpawn,
  EnemyState,
  LevelData,
  Phys,
  PlayerState,
  RespawnRunFn,
} from './types';

/** Puts the hero on the start cell: centred in it, feet on its floor, facing right, at rest, empty-handed. */
function resetPlayer(player: PlayerState, level: LevelData, phys: Phys): void {
  player.x = level.start.col * TILE + ((TILE - phys.heroW) >> 1);
  player.y = (level.start.row + 1) * TILE - phys.heroH;
  player.vx = 0;
  player.vy = 0;
  player.facing = 1;
  // parseLevel guarantees a wall under P, so the hero does start on the ground.
  player.onGround = true;
  player.coyote = 0;
  player.jumpBuffer = 0;
  player.fireBuffer = 0;
  player.jumpArc = false;
  player.thrusting = false;
  player.hasBlaster = false;
  player.hasThruster = false;
  player.fuel = 0;
  player.prevJump = false;
  player.prevFire = false;
}

/** Puts an enemy back on its cell, alive, heading left (or up, for a vertical moth). */
function resetEnemy(enemy: EnemyState, spawn: EnemySpawn): void {
  enemy.x = spawn.col * TILE;
  enemy.y = spawn.row * TILE;
  enemy.dir = -1;
  enemy.alive = true;
}

function createEnemy(spawn: EnemySpawn): EnemyState {
  // The moth's axis goes last on purpose: both kinds then share the layout of their first five
  // fields, and the loops over run.enemies in steps 12, 13 and 17 read x, y, dir and alive from
  // the same place in either. With the axis first, a room of 16 mixed enemies made step() about
  // 15 % slower under Vitest.
  const enemy: EnemyState =
    spawn.kind === 'moth'
      ? { kind: 'moth', x: 0, y: 0, dir: -1, alive: true, axis: spawn.axis }
      : { kind: 'cinderpeg', x: 0, y: 0, dir: -1, alive: true };
  resetEnemy(enemy, spawn);
  return enemy;
}

export const createRun: CreateRunFn = (level, phys) => {
  const player: PlayerState = {
    x: 0,
    y: 0,
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
  };
  resetPlayer(player, level, phys);

  return {
    tick: 0,
    phase: 'ready',
    phaseTicks: 0,
    phaseLength: phys.readyMinTicks,
    readyArmed: false,
    player,
    enemies: level.enemies.map(createEnemy),
    enemyPaid: level.enemies.map(() => false),
    bolt: { active: false, x: 0, y: 0, dir: 1, rangeLeft: 0 },
    taken: level.pickups.map(() => false),
    hasTrophy: false,
    deathCause: null,
  };
};

/**
 * In place and without allocating: the objects and arrays of `run` stay the
 * same ones, so a clone made earlier and anything that holds on to
 * run.player or run.enemies stays valid.
 *
 * Kept on purpose: run.tick, hasTrophy, enemyPaid and every taken crystal.
 */
export const respawnRun: RespawnRunFn = (run, level, phys, readyTicks) => {
  resetPlayer(run.player, level, phys);

  const spawns = level.enemies;
  for (let i = 0; i < spawns.length; i++) {
    const enemy = run.enemies[i];
    const spawn = spawns[i];
    if (enemy !== undefined && spawn !== undefined) resetEnemy(enemy, spawn);
  }

  // Items are lost with the life, so their pickups come back; a crystal stays collected.
  const pickups = level.pickups;
  for (let i = 0; i < pickups.length; i++) {
    if (pickups[i]?.kind !== 'crystal') run.taken[i] = false;
  }

  run.bolt.active = false;
  run.deathCause = null;
  run.phase = 'ready';
  run.phaseTicks = 0;
  run.phaseLength = readyTicks;
  // The gate shuts: a thumb still down from before the death must lift before it can open it.
  run.readyArmed = false;
};
