import { describe, expect, it } from 'vitest';

import { stepPlayer } from './player';
import { DISTINCT_PHYS, IN, levelFromRows, playingGame, REFERENCE_PHYS, referencePhysWith, stepTicks, sub } from './testkit';
import { boxHitsSolid } from './tiles';
import { TILE } from './types';
import type { GameEvent, GameState } from './types';

/**
 * Running, stopping, turning, walls and the edges of the level: steps 5, 9
 * and 11 of the tick, driven through stepPlayer alone. T and D are in every
 * room only because the level format wants them; nothing here touches them.
 */

const P = REFERENCE_PHYS;

/** One tick with the named buttons held (L R J F T); returns that tick's events. */
function tick(game: GameState, letters: string): GameEvent[] {
  const events: GameEvent[] = [];
  stepPlayer(game, IN(letters), events);
  return events;
}

/** The hero's vx after each of n ticks with the same buttons held. */
function speeds(game: GameState, letters: string, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    tick(game, letters);
    out.push(game.run.player.vx);
  }
  return out;
}

/** A long floor under open sky. The hero starts on col 8, well away from both ends. */
const FLAT = levelFromRows([
  'T......................D',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........P...............',
  '########################',
]);

/** A game on FLAT with the hero already running right at full speed. */
function atFullSpeed(): GameState {
  const game = playingGame(FLAT);
  stepTicks(stepPlayer, game, 'R', 8);
  expect(game.run.player.vx).toBe(P.runMax);
  return game;
}

describe('running on the ground', () => {
  it('reaches full speed after 6 ticks and 5.25 px: runMax / groundAccel ticks', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const x0 = p.x;
    const ticks = Math.ceil(P.runMax / P.groundAccel);
    expect(ticks).toBe(6);

    expect(speeds(game, 'R', ticks)).toEqual([64, 128, 192, 256, 320, 384]);
    expect(p.vx).toBe(P.runMax);
    expect(p.x - x0).toBe(sub(5.25));

    // From then on the speed holds and each tick covers runMax.
    tick(game, 'R');
    expect(p.vx).toBe(P.runMax);
    expect(p.x - x0).toBe(sub(5.25) + P.runMax);
  });

  it('runs left exactly as it runs right, mirrored', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const x0 = p.x;
    expect(speeds(game, 'L', 6)).toEqual([-64, -128, -192, -256, -320, -384]);
    expect(p.x - x0).toBe(-sub(5.25));
    expect(p.facing).toBe(-1);
  });

  it('stops from full speed in 4 ticks and 2.25 px when the direction is let go: runMax / groundDecel ticks', () => {
    const game = atFullSpeed();
    const p = game.run.player;
    const x0 = p.x;
    const ticks = Math.ceil(P.runMax / P.groundDecel);
    expect(ticks).toBe(4);

    expect(speeds(game, '', ticks)).toEqual([288, 192, 96, 0]);
    expect(p.x - x0).toBe(sub(2.25));

    // And stays stopped.
    stepTicks(stepPlayer, game, '', 5);
    expect(p.vx).toBe(0);
    expect(p.x - x0).toBe(sub(2.25));
  });

  it('reverses from full speed one way to full speed the other way in 9 ticks: 3 braking with groundTurn, 6 with groundAccel', () => {
    const game = atFullSpeed();
    const p = game.run.player;
    const ticks = Math.ceil(P.runMax / P.groundTurn) + Math.ceil(P.runMax / P.groundAccel);
    expect(ticks).toBe(9);

    expect(speeds(game, 'L', ticks)).toEqual([256, 128, 0, -64, -128, -192, -256, -320, -384]);
    expect(p.vx).toBe(-P.runMax);
    expect(p.facing).toBe(-1);
  });

  it('treats left and right held together as neither: the hero brakes and keeps facing where it faced', () => {
    const game = atFullSpeed();
    const p = game.run.player;
    expect(speeds(game, 'LR', 4)).toEqual([288, 192, 96, 0]);
    expect(p.facing).toBe(1);

    const still = playingGame(FLAT);
    stepTicks(stepPlayer, still, 'LR', 10);
    expect(still.run.player.vx).toBe(0);
    expect(still.run.player.x).toBe(playingGame(FLAT).run.player.x);
  });

  it('faces the last direction held, starting to the right, and keeps it after the button is let go', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    expect(p.facing).toBe(1);
    tick(game, 'L');
    expect(p.facing).toBe(-1);
    stepTicks(stepPlayer, game, '', 10);
    expect(p.facing).toBe(-1);
    // Facing turns at once, before the speed has turned.
    stepTicks(stepPlayer, game, 'L', 6);
    tick(game, 'R');
    expect(p.vx).toBeLessThan(0);
    expect(p.facing).toBe(1);
  });

  it('never passes its target speed when the acceleration does not divide it (run speed 365, as under the handicap)', () => {
    const phys = referencePhysWith({ run: { runMaxSpeed: 365 / 256 } });
    expect(phys.runMax).toBe(365);
    const game = playingGame(FLAT, phys);
    expect(speeds(game, 'R', 8)).toEqual([64, 128, 192, 256, 320, 365, 365, 365]);
    expect(speeds(game, '', 5)).toEqual([269, 173, 77, 0, 0]);
    stepTicks(stepPlayer, game, 'R', 8);
    // Turning: 365, 237, 109, then through zero to -19 and on with groundAccel.
    expect(speeds(game, 'L', 5)).toEqual([237, 109, -19, -83, -147]);
  });

  it('keeps a standing hero exactly where it is, on the ground, with no events', () => {
    const game = playingGame(FLAT);
    const before = { ...game.run.player };
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, '', 200, events);
    // The only thing that changes is the coyote timer, which is wound up on every tick spent on the ground.
    expect(game.run.player).toEqual({ ...before, coyote: P.coyoteTicks + 1 });
    expect(game.run.player.onGround).toBe(true);
    expect(events).toEqual([]);
  });
});

describe('steering in the air', () => {
  /** Full speed, then a jump with the direction still held: airborne at runMax. */
  function airborneAtFullSpeed(): GameState {
    const game = atFullSpeed();
    tick(game, 'RJ');
    expect(game.run.player.onGround).toBe(false);
    expect(game.run.player.vx).toBe(P.runMax);
    return game;
  }

  it('stops sideways drift in 8 ticks and 5.25 px when the direction is let go: runMax / airDecel ticks', () => {
    const game = airborneAtFullSpeed();
    const p = game.run.player;
    const x0 = p.x;
    const ticks = Math.ceil(P.runMax / P.airDecel);
    expect(ticks).toBe(8);

    expect(speeds(game, 'J', ticks)).toEqual([336, 288, 240, 192, 144, 96, 48, 0]);
    expect(p.x - x0).toBe(sub(5.25));
    expect(p.onGround).toBe(false);
  });

  it('speeds up with airAccel from a standing jump: 8 ticks to full speed', () => {
    const game = playingGame(FLAT);
    tick(game, 'J');
    expect(speeds(game, 'RJ', 9)).toEqual([48, 96, 144, 192, 240, 288, 336, 384, 384]);
  });

  it('turns with airTurn while still moving the old way, then goes on with airAccel', () => {
    const game = airborneAtFullSpeed();
    // 384 - 80 per tick down to 64, through zero to -16, then 48 per tick.
    expect(speeds(game, 'LJ', 7)).toEqual([304, 224, 144, 64, -16, -64, -112]);
    expect(game.run.player.facing).toBe(-1);
  });

  it('uses the ground numbers on the tick the jump starts, because the hero began that tick on the ground', () => {
    const game = playingGame(FLAT);
    tick(game, 'RJ');
    expect(game.run.player.vx).toBe(P.groundAccel);
    tick(game, 'RJ');
    expect(game.run.player.vx).toBe(P.groundAccel + P.airAccel);
  });
});

describe('each run and fall rule reads its own Phys field (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers airAccel = airDecel (48), groundAccel = gravRise (64), groundDecel = thrustAccel (96),
  // groundTurn equals three other fields (128) and maxFall four (1024), so the tests above cannot tell them apart.
  const D = DISTINCT_PHYS;

  /** One tick with the named buttons held, from a hero standing on FLAT or two tiles up in open air, with the given speeds. */
  function after(letters: string, start: { vx?: number; vy?: number; onGround: boolean }): { vx: number; vy: number } {
    const game = playingGame(FLAT, D);
    const p = game.run.player;
    p.vx = start.vx ?? 0;
    p.vy = start.vy ?? 0;
    if (!start.onGround) {
      p.y -= 2 * TILE;
      p.onGround = false;
    }
    tick(game, letters);
    return { vx: p.vx, vy: p.vy };
  }

  it('on the ground: groundAccel from rest, groundDecel with nothing held, groundTurn against the motion, never past runMax', () => {
    expect(after('R', { onGround: true }).vx).toBe(D.groundAccel);
    expect(after('', { vx: D.runMax, onGround: true }).vx).toBe(D.runMax - D.groundDecel);
    expect(after('L', { vx: D.runMax, onGround: true }).vx).toBe(D.runMax - D.groundTurn);
    expect(after('R', { vx: D.runMax - 1, onGround: true }).vx).toBe(D.runMax);
  });

  it('in the air: airAccel from rest, airDecel with nothing held, airTurn against the motion, never past runMax', () => {
    expect(after('R', { onGround: false }).vx).toBe(D.airAccel);
    expect(after('', { vx: D.runMax, onGround: false }).vx).toBe(D.runMax - D.airDecel);
    expect(after('L', { vx: D.runMax, onGround: false }).vx).toBe(D.runMax - D.airTurn);
    expect(after('L', { vx: 1 - D.runMax, onGround: false }).vx).toBe(-D.runMax);
  });

  it('falling: gravFall per tick, and never faster than maxFall', () => {
    expect(after('', { onGround: false }).vy).toBe(D.gravFall);
    expect(after('', { vy: D.maxFall - 1, onGround: false }).vy).toBe(D.maxFall);
    expect(after('', { vy: D.maxFall, onGround: false }).vy).toBe(D.maxFall);
  });
});

describe('walls', () => {
  /** Walls at col 0 and col 6 of the hero's row; the hero starts on col 3. */
  const WALLED = levelFromRows([
    'T.......D', //
    '.........',
    '#..P..#..',
    '#########',
  ]);
  const RIGHT_WALL_X = 6 * TILE - P.heroW;
  const LEFT_WALL_X = TILE;

  it('stops the hero flush against a wall on the right, with no speed left, from any sub-pixel start', () => {
    for (const offset of [0, 1, 7, 33, 63, 100, 255]) {
      const game = playingGame(WALLED);
      const p = game.run.player;
      p.x += offset;
      stepTicks(stepPlayer, game, 'R', 60);
      expect(p.x, `start offset ${offset}`).toBe(RIGHT_WALL_X);
      expect(p.vx, `start offset ${offset}`).toBe(0);
      // Flush: the box does not overlap the wall, and one sub-pixel further it would.
      expect(boxHitsSolid(WALLED, p.x, p.y, P.heroW, P.heroH)).toBe(false);
      expect(boxHitsSolid(WALLED, p.x + 1, p.y, P.heroW, P.heroH)).toBe(true);
    }
  });

  it('stops the hero flush against a wall on the left, with no speed left, from any sub-pixel start', () => {
    for (const offset of [0, 1, 7, 33, 63, 100, 255]) {
      const game = playingGame(WALLED);
      const p = game.run.player;
      p.x -= offset;
      stepTicks(stepPlayer, game, 'L', 60);
      expect(p.x, `start offset ${offset}`).toBe(LEFT_WALL_X);
      expect(p.vx, `start offset ${offset}`).toBe(0);
      expect(boxHitsSolid(WALLED, p.x - 1, p.y, P.heroW, P.heroH)).toBe(true);
    }
  });

  it('snaps on the very tick of the hit: the hero is never left short of the wall or inside it', () => {
    const game = playingGame(WALLED);
    const p = game.run.player;
    let hitTick = 0;
    for (let t = 1; t <= 60 && hitTick === 0; t++) {
      const before = p.x;
      tick(game, 'R');
      if (p.vx === 0) {
        hitTick = t;
        // The last step is shorter than the speed: only what was left to the wall.
        expect(p.x - before).toBeLessThan(P.runMax);
        expect(p.x).toBe(RIGHT_WALL_X);
      } else {
        expect(p.x - before).toBe(p.vx);
      }
    }
    expect(hitTick).toBeGreaterThan(0);
  });

  it('holds a hero that keeps pushing against the wall in place, still on the ground', () => {
    const game = playingGame(WALLED);
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'R', 60);
    for (let i = 0; i < 20; i++) {
      tick(game, 'R');
      expect(p.x).toBe(RIGHT_WALL_X);
      expect(p.vx).toBe(0);
      expect(p.onGround).toBe(true);
    }
    // And lets it walk away again at once.
    tick(game, 'L');
    expect(p.x).toBe(RIGHT_WALL_X - P.groundAccel);
  });

  it('takes away only the sideways speed in mid-air: a jump against a wall rises as high as a free jump', () => {
    // The wall reaches the top of the grid, so the hero cannot get onto it.
    const tall = levelFromRows([
      'T.....#.D', //
      '......#..',
      '......#..',
      '......#..',
      '......#..',
      '......#..',
      '....P.#..',
      '#########',
    ]);
    const free = playingGame(tall);
    const blocked = playingGame(tall);
    const heights: number[] = [];
    const heightsBlocked: number[] = [];
    for (let t = 0; t < 45; t++) {
      tick(free, 'J');
      tick(blocked, 'RJ');
      heights.push(free.run.player.y);
      heightsBlocked.push(blocked.run.player.y);
    }
    expect(heightsBlocked).toEqual(heights);
    expect(blocked.run.player.x).toBe(6 * TILE - P.heroW);
  });

  it('lets the 14 px hero walk through a corridor one tile high', () => {
    const corridor = levelFromRows([
      '#########', //
      'P.....T.D',
      '#########',
    ]);
    const game = playingGame(corridor);
    const p = game.run.player;
    const y0 = p.y;
    expect(P.heroH).toBeLessThanOrEqual(TILE);
    for (let i = 0; i < 120; i++) {
      tick(game, 'R');
      expect(p.y).toBe(y0);
      expect(p.onGround).toBe(true);
    }
    expect(p.x).toBe(corridor.width * TILE - P.heroW);
  });
});

describe('the edges of the level', () => {
  /** No frame of # at all: the grid's own edges must act as walls on the left, the right and the top. */
  const OPEN = levelFromRows([
    'T...D', //
    '.....',
    '.....',
    '..P..',
    '#####',
  ]);

  it('is walled on the left: the hero stops flush at x = 0', () => {
    const game = playingGame(OPEN);
    stepTicks(stepPlayer, game, 'L', 60);
    expect(game.run.player.x).toBe(0);
    expect(game.run.player.vx).toBe(0);
  });

  it('is walled on the right: the hero stops flush with its right side on the last column edge', () => {
    const game = playingGame(OPEN);
    stepTicks(stepPlayer, game, 'R', 60);
    expect(game.run.player.x).toBe(OPEN.width * TILE - P.heroW);
    expect(game.run.player.vx).toBe(0);
  });

  it('is closed above: a jump bonks on the top edge at y = 0', () => {
    const game = playingGame(OPEN);
    const p = game.run.player;
    const events: GameEvent[] = [];
    let top = p.y;
    for (let i = 0; i < 30; i++) {
      events.push(...tick(game, 'J'));
      top = Math.min(top, p.y);
    }
    expect(top).toBe(0);
    const bonks = events.filter((e) => e.type === 'bonked');
    expect(bonks).toEqual([{ type: 'bonked', x: p.x + (P.heroW >> 1), y: 0 }]);
  });

  it('is open below: a hero that walks into a hole in the bottom row falls out of the grid and keeps falling', () => {
    const holed = levelFromRows([
      'T...D', //
      '.....',
      '.P...',
      '##.##',
    ]);
    const game = playingGame(holed);
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'R', 14);
    stepTicks(stepPlayer, game, '', 60);
    expect(p.y).toBeGreaterThan(holed.height * TILE);
    expect(p.onGround).toBe(false);
    expect(p.vy).toBe(P.maxFall);

    // The side walls go on below the grid.
    stepTicks(stepPlayer, game, 'R', 60);
    expect(p.x).toBe(holed.width * TILE - P.heroW);
    stepTicks(stepPlayer, game, 'L', 120);
    expect(p.x).toBe(0);
  });
});

describe('falling and landing', () => {
  /** A ledge two tiles long, then a drop of 9 tiles to the floor. */
  const DROP = levelFromRows([
    'T.......D',
    '.P.......',
    '##.......',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '#########',
  ]);

  it('leaves the ground when it walks off a ledge and falls faster by gravFall each tick, up to maxFall after 10 ticks', () => {
    const game = playingGame(DROP);
    const p = game.run.player;
    const fall: number[] = [];
    for (let i = 0; i < 80 && fall.length < 12; i++) {
      tick(game, 'R');
      if (!p.onGround) fall.push(p.vy);
    }
    const ticksToTerminal = Math.ceil(P.maxFall / P.gravFall);
    expect(ticksToTerminal).toBe(10);
    expect(fall).toEqual([112, 224, 336, 448, 560, 672, 784, 896, 1008, 1024, 1024, 1024]);
    expect(fall[ticksToTerminal - 1]).toBe(P.maxFall);
    for (let i = 0; i < ticksToTerminal - 1; i++) expect(fall[i]).toBe((i + 1) * P.gravFall);
  });

  it('lands with its feet exactly on the floor and reports the landing once, with the speed it arrived at', () => {
    const game = playingGame(DROP);
    const p = game.run.player;
    const events: GameEvent[] = [];
    let ticksInAir = 0;
    for (let i = 0; i < 120; i++) {
      const wasOnGround = p.onGround;
      events.push(...tick(game, i < 30 ? 'R' : ''));
      if (!wasOnGround) ticksInAir++;
    }
    const floorTop = (DROP.height - 1) * TILE;
    expect(p.onGround).toBe(true);
    expect(p.y + P.heroH).toBe(floorTop);
    expect(p.vy).toBe(0);
    // 9 tiles is far more than the 10 ticks to terminal speed, so the hero arrives at maxFall.
    expect(events).toEqual([{ type: 'landed', x: p.x + (P.heroW >> 1), y: floorTop, speed: P.maxFall }]);
    expect(ticksInAir).toBeGreaterThan(10);
  });

  it('reports a short drop with the speed gravity had built up by then', () => {
    const step = levelFromRows([
      'T.......D', //
      '.P.......',
      '##.......',
      '#########',
    ]);
    const game = playingGame(step);
    const p = game.run.player;
    const events: GameEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...tick(game, 'R'));

    // The speed after the tick that covers the last of one tile.
    let speed = 0;
    for (let fallen = 0; fallen < TILE; fallen += speed) speed = Math.min(speed + P.gravFall, P.maxFall);
    expect(speed).toBe(1008);
    expect(events.filter((e) => e.type === 'landed')).toEqual([
      { type: 'landed', x: expect.any(Number) as number, y: 3 * TILE, speed },
    ]);
    expect(p.y + P.heroH).toBe(3 * TILE);
  });

  it('does not report a landing while the hero simply walks along the ground', () => {
    const game = playingGame(FLAT);
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'R', 30, events);
    stepTicks(stepPlayer, game, 'L', 30, events);
    expect(events).toEqual([]);
  });
});

describe('presses and timers (step 4)', () => {
  it('remembers a fire press for fireBufferTicks further ticks: fireBufferTicks + 1 on the press tick, one less each tick', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    expect(P.fireBufferTicks).toBe(6);
    tick(game, 'F');
    expect(p.fireBuffer).toBe(P.fireBufferTicks + 1);
    for (let left = P.fireBufferTicks; left >= 0; left--) {
      tick(game, '');
      expect(p.fireBuffer).toBe(left);
    }
    tick(game, '');
    expect(p.fireBuffer).toBe(0);
  });

  it('arms the fire buffer on a press only: fire kept held runs the buffer down, a new press winds it up again', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'F', P.fireBufferTicks + 5);
    expect(p.fireBuffer).toBe(0);
    expect(p.prevFire).toBe(true);
    tick(game, '');
    expect(p.prevFire).toBe(false);
    tick(game, 'F');
    expect(p.fireBuffer).toBe(P.fireBufferTicks + 1);
    // A second press while the first is still remembered starts the count again.
    tick(game, '');
    tick(game, '');
    tick(game, 'F');
    expect(p.fireBuffer).toBe(P.fireBufferTicks + 1);
  });

  it('remembers a jump press the same way while no jump can start: jumpBufferTicks + 1, then one less each tick', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    // High in the air with coyote time long gone, so the press cannot be used.
    p.y = 2 * TILE;
    p.onGround = false;
    tick(game, 'J');
    expect(p.jumpBuffer).toBe(P.jumpBufferTicks + 1);
    expect(p.prevJump).toBe(true);
    for (let left = P.jumpBufferTicks; left >= 0; left--) {
      tick(game, 'J');
      expect(p.jumpBuffer).toBe(left);
    }
  });

  it('winds the coyote timer to coyoteTicks + 1 on every tick that starts on the ground, and runs it down in the air', () => {
    const drop = levelFromRows([
      'T.......D', //
      '.P.......',
      '##.......',
      '.........',
      '.........',
      '.........',
      '.........',
      '#########',
    ]);
    const game = playingGame(drop);
    const p = game.run.player;
    // Bounded, so that a hero that never leaves the ledge fails the test instead of hanging it.
    for (let i = 0; i < 100 && p.onGround; i++) {
      tick(game, 'R');
      expect(p.coyote).toBe(P.coyoteTicks + 1);
    }
    expect(p.onGround).toBe(false);
    for (let left = P.coyoteTicks; left >= 0; left--) {
      tick(game, 'R');
      expect(p.coyote).toBe(left);
    }
    tick(game, 'R');
    expect(p.coyote).toBe(0);
  });

  it('tracks the jump and fire buttons of the last tick, whatever else is held', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    tick(game, 'RJ');
    expect([p.prevJump, p.prevFire]).toEqual([true, false]);
    tick(game, 'LF');
    expect([p.prevJump, p.prevFire]).toEqual([false, true]);
    tick(game, 'JFT');
    expect([p.prevJump, p.prevFire]).toEqual([true, true]);
    tick(game, 'T');
    expect([p.prevJump, p.prevFire]).toEqual([false, false]);
  });
});

describe('what stepPlayer leaves alone', () => {
  it('changes nothing but the hero: session, enemies, bolt, pickups, phase and tick stay as they were', () => {
    const level = levelFromRows([
      'T.G.B.J.D', //
      '....C....',
      '.P.###...',
      '#########',
    ]);
    const game = playingGame(level);
    const before = JSON.stringify({ ...game.run, player: null, session: game.session });
    stepTicks(stepPlayer, game, 'RJF', 20);
    stepTicks(stepPlayer, game, 'LT', 20);
    expect(JSON.stringify({ ...game.run, player: null, session: game.session })).toBe(before);
  });

  it('keeps every number of the hero an integer over a long mixed run', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    p.hasThruster = true;
    p.fuel = P.fuelTicks;
    const pattern = ['R', 'RJ', 'RJ', 'J', 'L', 'LJ', 'T', 'RT', '', 'LJT'];
    for (let i = 0; i < 600; i++) {
      tick(game, pattern[(i >> 3) % pattern.length] ?? '');
      for (const value of [p.x, p.y, p.vx, p.vy, p.coyote, p.jumpBuffer, p.fireBuffer, p.fuel]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });
});
