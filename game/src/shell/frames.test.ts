import { describe, expect, it } from 'vitest';

import { DOOR_OPEN_PULSE_TICKS, DOOR_OPENING_TICKS, HERO_BLINK } from '../art/manifest';
import { createSession, step } from '../core/game';
import { IN, NONE, REFERENCE_PHYS, REFERENCE_TUNING, levelFromRows, playingGame, stepTicks } from '../core/testkit';
import type { EnemyState, GameEvent, GameState } from '../core/types';

import {
  BOB_TICKS,
  GLINT_EVERY_TICKS,
  GLINT_TICKS,
  deathBreakTick,
  doorFrame,
  enemyFlip,
  enemyFrame,
  framesOf,
  heroLook,
  livePose,
  newHeroLook,
  pickupBob,
  pickupFrame,
  pickupSprite,
  screenFade,
  trophyFrame,
} from './frames';

const TIMING = REFERENCE_TUNING.timing;

/** A long flat floor with a spike bed far to the right. */
const ROOM = levelFromRows(['..............................', '.P.......................TD..S', '##############################'], {
  frame: true,
});

const look = (game: GameState): ReturnType<typeof newHeroLook> => heroLook(game, TIMING, newHeroLook());

describe('frame tables', () => {
  it('list every frame of a sprite, built once', () => {
    expect(framesOf('hero_run')).toEqual(['hero_run_0', 'hero_run_1', 'hero_run_2', 'hero_run_3']);
    expect(framesOf('hero_run')).toBe(framesOf('hero_run'));
  });
});

describe('the hero in a running world', () => {
  it('stands idle, and blinks for HERO_BLINK.ticks of every HERO_BLINK.everyTicks', () => {
    const game = playingGame(ROOM);
    const p = game.run.player;
    expect(livePose(p, 0)).toBe('hero_idle_0');
    expect(livePose(p, HERO_BLINK.everyTicks - HERO_BLINK.ticks - 1)).toBe('hero_idle_0');
    expect(livePose(p, HERO_BLINK.everyTicks - HERO_BLINK.ticks)).toBe('hero_idle_1');
    expect(livePose(p, HERO_BLINK.everyTicks - 1)).toBe('hero_idle_1');
    expect(livePose(p, HERO_BLINK.everyTicks)).toBe('hero_idle_0');
  });

  it('runs on the ground while vx is not 0, at the manifest rate', () => {
    const game = playingGame(ROOM);
    stepTicks(step, game, 'R', 3);
    expect(game.run.player.vx).toBeGreaterThan(0);
    expect(livePose(game.run.player, 0)).toBe('hero_run_0');
    expect(livePose(game.run.player, 6)).toBe('hero_run_1');
    expect(livePose(game.run.player, 24)).toBe('hero_run_0');
  });

  it('jumps while rising and falls once vy turns downward', () => {
    const game = playingGame(ROOM);
    step(game, IN('J'));
    expect(game.run.player.onGround).toBe(false);
    expect(look(game).frame).toBe('hero_jump_0');
    for (let i = 0; i < 60 && game.run.player.vy < 0; i++) step(game, IN('J'));
    expect(game.run.player.vy).toBeGreaterThanOrEqual(0);
    expect(game.run.player.onGround).toBe(false);
    expect(look(game).frame).toBe('hero_fall_0');
  });

  it('thrusting wins over being in the air', () => {
    const game = playingGame(ROOM);
    game.run.player.hasThruster = true;
    game.run.player.fuel = REFERENCE_PHYS.fuelTicks;
    stepTicks(step, game, 'T', 2);
    expect(game.run.player.thrusting).toBe(true);
    expect(look(game).frame).toMatch(/^hero_thrust_[01]$/);
  });

  it('is mirrored while facing left', () => {
    const game = playingGame(ROOM);
    expect(look(game).flip).toBe(false);
    step(game, IN('L'));
    expect(look(game).flip).toBe(true);
  });
});

describe('the hero in the ready gate', () => {
  it('blinks: hidden while (tick >> 3) & 1 is 1', () => {
    const game = createSession([ROOM], REFERENCE_PHYS);
    const seen: boolean[] = [];
    for (let i = 0; i < 16; i++) {
      seen.push(look(game).visible);
      step(game, NONE);
    }
    expect(game.run.phase).toBe('ready');
    expect(seen).toEqual([...Array<boolean>(8).fill(true), ...Array<boolean>(8).fill(false)]);
  });
});

describe('the hero dying', () => {
  /** A hero who walked into the spikes: returns the game on the tick of death. */
  function killed(): GameState {
    const game = playingGame(levelFromRows(['.P.S.TD', '#######'], { frame: true }));
    for (let i = 0; i < 200 && game.run.phase === 'playing'; i++) step(game, IN('R'));
    expect(game.run.phase).toBe('dying');
    return game;
  }

  it('keeps the pose he died in, filled white, for hitStopFrames ticks', () => {
    const game = killed();
    const pose = livePose(game.run.player, game.run.tick);
    for (let t = 0; t < TIMING.hitStopFrames; t++) {
      expect(game.run.phaseTicks).toBe(t);
      const now = look(game);
      expect(now.flash).toBe(true);
      expect(now.frame).toBe(pose);
      step(game, NONE);
    }
    expect(look(game).flash).toBe(false);
  });

  it('then plays the four hero_die frames evenly over deathAnimFrames, and holds the last', () => {
    const game = killed();
    stepTicks(step, game, NONE, TIMING.hitStopFrames);
    const frames: string[] = [];
    for (let t = 0; t < TIMING.deathAnimFrames; t++) {
      frames.push(look(game).frame);
      step(game, NONE);
    }
    const quarter = TIMING.deathAnimFrames / 4;
    expect(frames[0]).toBe('hero_die_0');
    expect(frames[Math.ceil(quarter)]).toBe('hero_die_1');
    expect(frames[Math.ceil(2 * quarter)]).toBe('hero_die_2');
    expect(frames[TIMING.deathAnimFrames - 1]).toBe('hero_die_3');
    expect(new Set(frames).size).toBe(4);
    expect(look(game).frame).toBe('hero_die_3');
  });

  it('breaks apart (his gear gone, his scrap thrown) on the first tick that shows hero_die_1', () => {
    const game = killed();
    const at = deathBreakTick(TIMING);
    stepTicks(step, game, NONE, at - 1);
    expect(game.run.phaseTicks).toBe(at - 1);
    expect(look(game).frame).toBe('hero_die_0');
    step(game, NONE);
    expect(game.run.phaseTicks).toBe(at);
    expect(look(game).frame).toBe('hero_die_1');
    expect(deathBreakTick({ ...TIMING, deathAnimFrames: 0 })).toBe(TIMING.hitStopFrames);
  });

  it('the screen fades out at the end of dying and back in after the respawn, but not at a level start', () => {
    const fresh = createSession([ROOM], REFERENCE_PHYS);
    expect(screenFade(fresh, TIMING)).toBe(0);

    const game = killed();
    const fades: number[] = [];
    let respawnAt = -1;
    for (let i = 0; i < REFERENCE_PHYS.dyingTicks + TIMING.fadeFrames + 4; i++) {
      fades.push(screenFade(game, TIMING));
      const events: GameEvent[] = [];
      step(game, NONE, events);
      if (respawnAt < 0 && events.some((e) => e.type === 'respawned')) respawnAt = i + 1;
    }
    const fadeStart = TIMING.hitStopFrames + TIMING.deathAnimFrames;
    expect(fades.slice(0, fadeStart).every((f) => f === 0)).toBe(true);
    expect(fades[fadeStart]).toBeCloseTo(1 / TIMING.fadeFrames);
    expect(fades[REFERENCE_PHYS.dyingTicks - 1]).toBe(1);
    expect(respawnAt).toBe(REFERENCE_PHYS.dyingTicks);
    expect(fades[respawnAt]).toBeCloseTo(1 - 1 / TIMING.fadeFrames);
    expect(fades[respawnAt + TIMING.fadeFrames - 1]).toBe(0);
    expect(fades[respawnAt + TIMING.fadeFrames]).toBe(0);
  });
});

describe('enemies', () => {
  const peg: EnemyState = { kind: 'cinderpeg', x: 0, y: 0, dir: -1, alive: true };
  const mothV: EnemyState = { kind: 'moth', axis: 'v', x: 0, y: 0, dir: -1, alive: true };
  const mothH: EnemyState = { kind: 'moth', axis: 'h', x: 0, y: 0, dir: -1, alive: true };

  it('loop their own sprite', () => {
    expect(enemyFrame(peg, 0)).toBe('cinderpeg_0');
    expect(enemyFrame(peg, 10)).toBe('cinderpeg_1');
    expect(enemyFrame(mothV, 5)).toBe('moth_1');
  });

  it('are mirrored when going left, except a moth that flies up and down', () => {
    expect(enemyFlip(peg)).toBe(true);
    expect(enemyFlip({ ...peg, dir: 1 })).toBe(false);
    expect(enemyFlip(mothH)).toBe(true);
    expect(enemyFlip({ ...mothH, dir: 1 })).toBe(false);
    expect(enemyFlip(mothV)).toBe(false);
  });
});

describe('pickups, cog and airlock', () => {
  it('crystals take their look from the cell; items their own sprite', () => {
    expect(pickupSprite({ kind: 'crystal', col: 0, row: 0 })).toBe('gem_a');
    expect(pickupSprite({ kind: 'crystal', col: 1, row: 0 })).toBe('gem_b');
    expect(pickupSprite({ kind: 'blaster', col: 1, row: 0 })).toBe('pickup_blaster');
    expect(pickupSprite({ kind: 'thruster', col: 1, row: 0 })).toBe('pickup_thruster');
  });

  it('glint for GLINT_TICKS of every GLINT_EVERY_TICKS and bob by one pixel', () => {
    const gem = { kind: 'crystal', col: 0, row: 0 } as const;
    expect(pickupFrame(gem, 0, 0)).toBe('gem_a_1');
    expect(pickupFrame(gem, 0, GLINT_TICKS)).toBe('gem_a_0');
    expect(pickupFrame(gem, 0, GLINT_EVERY_TICKS)).toBe('gem_a_1');
    expect(pickupBob(0, 0)).toBe(0);
    expect(pickupBob(0, BOB_TICKS)).toBe(-1);
    expect(pickupBob(1, 0)).toBe(-1);
  });

  it('the cog turns', () => {
    expect(trophyFrame(0)).toBe('trophy_0');
    expect(trophyFrame(8)).toBe('trophy_1');
  });

  it('the airlock is locked, then opens over DOOR_OPENING_TICKS, then stays open with a pulsing lamp', () => {
    expect(doorFrame(false, null, 500)).toBe('door_locked_0');
    expect(doorFrame(true, 100, 100)).toBe('door_opening_0');
    expect(doorFrame(true, 100, 100 + DOOR_OPENING_TICKS / 3)).toBe('door_opening_1');
    expect(doorFrame(true, 100, 100 + DOOR_OPENING_TICKS - 1)).toBe('door_opening_2');
    expect(doorFrame(true, 100, 100 + DOOR_OPENING_TICKS)).toMatch(/^door_open_[01]$/);
    expect(doorFrame(true, null, 0)).toBe('door_open_0');
    expect(doorFrame(true, null, DOOR_OPEN_PULSE_TICKS)).toBe('door_open_1');
  });
});
