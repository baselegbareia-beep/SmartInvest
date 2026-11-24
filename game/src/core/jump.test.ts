import { describe, expect, it } from 'vitest';

import { stepPlayer } from './player';
import { DISTINCT_PHYS, IN, levelFromRows, playingGame, REFERENCE_PHYS, referencePhysWith, stepTicks } from './testkit';
import { TILE } from './types';
import type { GameEvent, GameState, LevelData, Phys } from './types';

/**
 * The jump: steps 4, 6, 7, 8, 10 and 11 of the tick, and the ledge catch of
 * step 9, driven through stepPlayer alone. The golden numbers are those of
 * docs/ARCHITECTURE.md, section 4, measured on REFERENCE_PHYS.
 */

const P = REFERENCE_PHYS;

/** One tick with the named buttons held (L R J F T); returns that tick's events. */
function tick(game: GameState, letters: string): GameEvent[] {
  const events: GameEvent[] = [];
  stepPlayer(game, IN(letters), events);
  return events;
}

function has(events: readonly GameEvent[], type: GameEvent['type']): boolean {
  return events.some((e) => e.type === type);
}

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Puts the hero somewhere in mid-air (or on the ground), at rest unless told otherwise. */
function place(
  game: GameState,
  at: { x: number; y: number; vx?: number; vy?: number; onGround?: boolean },
): void {
  const p = game.run.player;
  p.x = at.x;
  p.y = at.y;
  p.vx = at.vx ?? 0;
  p.vy = at.vy ?? 0;
  p.onGround = at.onGround ?? false;
}

/** A floor under six tiles of open sky: room for the whole 3.29-tile jump. */
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
const FLOOR_TOP = 7 * TILE;

describe('a full jump, jump held (golden numbers of section 4)', () => {
  /** y and vy after each tick of a held jump from standing, until the landing; index 0 is tick 1. */
  function heldJump(): { rise: number[]; vy: number[]; landedTick: number; events: GameEvent[] } {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const y0 = p.y;
    const rise: number[] = [];
    const vy: number[] = [];
    const events: GameEvent[] = [];
    let landedTick = 0;
    for (let t = 1; t <= 60 && landedTick === 0; t++) {
      const now = tick(game, 'J');
      events.push(...now);
      rise.push(y0 - p.y);
      vy.push(p.vy);
      if (has(now, 'landed')) landedTick = t;
    }
    return { rise, vy, landedTick, events };
  }

  it('rises 1280, 2496, 3648, 4736 sub-pixels after ticks 1 to 4: jumpVel first, then gravRise less each tick', () => {
    const { rise } = heldJump();
    expect(rise.slice(0, 4)).toEqual([1280, 2496, 3648, 4736]);
    expect(rise[0]).toBe(P.jumpVel);
    expect(rise[1]).toBe(2 * P.jumpVel - P.gravRise);
    expect(rise[2]).toBe(3 * P.jumpVel - 3 * P.gravRise);
    expect(rise[3]).toBe(4 * P.jumpVel - 6 * P.gravRise);
  });

  it('applies no gravity on the launch tick: vy is exactly -jumpVel after it', () => {
    const { vy } = heldJump();
    expect(vy[0]).toBe(-P.jumpVel);
    expect(vy[1]).toBe(-P.jumpVel + P.gravRise);
  });

  it('has vy -192 -128 -64 -32 0 56 112 168 280 392 504 on ticks 18 to 28: the apex hang halves gravity while |vy| < apexHangSpeed', () => {
    const { vy } = heldJump();
    expect(vy.slice(17, 28)).toEqual([-192, -128, -64, -32, 0, 56, 112, 168, 280, 392, 504]);
    // -64 is the first speed inside the hang: from there gravRiseHang up, gravFallHang down, until vy reaches
    // apexHangSpeed, where the arc ends and plain gravFall takes over.
    expect(P.gravRiseHang).toBe(32);
    expect(P.gravFallHang).toBe(56);
    expect(P.apexHangSpeed).toBe(128);
  });

  it('reaches its apex of 13472 sub-pixels (52.625 px, 3.29 tiles) on tick 21', () => {
    const { rise } = heldJump();
    const apex = Math.max(...rise);
    expect(apex).toBe(13472);
    expect(rise.indexOf(apex) + 1).toBe(21);
    expect(apex / TILE).toBeCloseTo(3.29, 2);
  });

  it('is back on the ground on tick 41, at the height it left from', () => {
    const { rise, landedTick, vy } = heldJump();
    expect(landedTick).toBe(41);
    expect(rise[40]).toBe(0);
    expect(vy[40]).toBe(0);
    // Tick 40 is still in the air.
    expect(rise[39]).toBeGreaterThan(0);
  });

  it('is inside the jump arc from tick 1 to tick 24 and out of it from tick 25, when vy passes apexHangSpeed', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const inArc: number[] = [];
    for (let t = 1; t <= 41; t++) {
      tick(game, 'J');
      if (p.jumpArc) inArc.push(t);
    }
    expect(inArc).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('ends the arc on the tick vy reaches apexHangSpeed exactly, not one tick later', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    // Falling inside the hang, one hang step short of apexHangSpeed.
    place(game, { x: p.x, y: 2 * TILE, vy: P.apexHangSpeed - P.gravFallHang });
    p.jumpArc = true;
    p.prevJump = true;
    tick(game, 'J');
    expect(p.vy).toBe(P.apexHangSpeed);
    expect(p.jumpArc).toBe(false);
  });

  it('ends the arc on landing, even with jump still held: the next fall starts with plain gravFall', () => {
    const ledge = levelFromRows([
      'T.......D', //
      '.........',
      '..P......',
      '####.....',
      '.........',
      '.........',
      '.........',
      '#########',
    ]);
    const game = playingGame(ledge);
    const p = game.run.player;
    // Just above the right end of the ledge, at the top of a held jump.
    place(game, { x: 4 * TILE - P.heroW - 100, y: 3 * TILE - P.heroH - 20 });
    p.jumpArc = true;
    p.prevJump = true;
    expect(types(tick(game, 'RJ'))).toEqual(['landed']);
    expect(p.jumpArc).toBe(false);

    // Jump stays held while the hero walks off the ledge: no hang, no gravRise.
    const fall: number[] = [];
    for (let t = 0; t < 40 && fall.length < 3; t++) {
      tick(game, 'RJ');
      if (!p.onGround) fall.push(p.vy);
    }
    expect(fall).toEqual([P.gravFall, 2 * P.gravFall, 3 * P.gravFall]);
  });

  it('reports jumped once on the press tick and landed once, both at the middle of the feet', () => {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const feetX = p.x + (P.heroW >> 1);
    const first = tick(game, 'J');
    expect(first).toEqual([{ type: 'jumped', x: feetX, y: FLOOR_TOP }]);

    const rest: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'J', 60, rest);
    // The fall from 3.29 tiles is long enough to reach terminal speed.
    expect(rest).toEqual([{ type: 'landed', x: feetX, y: FLOOR_TOP, speed: P.maxFall }]);
  });

  it('needs a new press for every jump: jump kept held after the landing does not jump again', () => {
    const game = playingGame(FLAT);
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'J', 200, events);
    expect(events.map((e) => e.type)).toEqual(['jumped', 'landed']);
    expect(game.run.player.onGround).toBe(true);

    // Let go, press again: now it jumps.
    tick(game, '');
    expect(has(tick(game, 'J'), 'jumped')).toBe(true);
  });

  it('cannot jump again in mid-air, however often jump is pressed', () => {
    const game = playingGame(FLAT);
    stepTicks(stepPlayer, game, 'J', 10);
    for (let t = 11; t <= 30; t++) {
      // Tap again on every other tick of the flight.
      expect(has(tick(game, t % 2 === 0 ? '' : 'J'), 'jumped'), `tick ${t}`).toBe(false);
    }
    // The taps were all made in the air: the hero has not come down yet.
    expect(game.run.player.onGround).toBe(false);
  });
});

describe('each jump rule reads its own Phys field (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers apexHangSpeed = thrustCutVel = groundTurn (128), jumpCutVel = runMax (384) and
  // gravRise = groundAccel (64), so the golden numbers above cannot tell those fields apart.
  const D = DISTINCT_PHYS;

  /** One tick from a hero two tiles up in open air, inside a jump arc, with jump held since the last tick. */
  function arcTick(vy: number, letters: string): { vy: number; jumpArc: boolean } {
    const game = playingGame(FLAT, D);
    const p = game.run.player;
    place(game, { x: p.x, y: p.y - 2 * TILE, vy });
    p.jumpArc = true;
    p.prevJump = true;
    tick(game, letters);
    return { vy: p.vy, jumpArc: p.jumpArc };
  }

  it('the launch is -jumpVel, with no gravity on that tick', () => {
    const game = playingGame(FLAT, D);
    tick(game, 'J');
    expect(game.run.player.vy).toBe(-D.jumpVel);
  });

  it('rising with jump held: gravRise per tick, gravRiseHang once |vy| is below apexHangSpeed, and not at apexHangSpeed itself', () => {
    expect(arcTick(-1000, 'J').vy).toBe(-1000 + D.gravRise);
    expect(arcTick(-D.apexHangSpeed, 'J').vy).toBe(-D.apexHangSpeed + D.gravRise);
    expect(arcTick(1 - D.apexHangSpeed, 'J').vy).toBe(1 - D.apexHangSpeed + D.gravRiseHang);
  });

  it('at the top with jump held: gravFallHang while |vy| is below apexHangSpeed', () => {
    expect(arcTick(0, 'J').vy).toBe(D.gravFallHang);
  });

  it('the arc ends on the tick vy reaches apexHangSpeed, not one sub-pixel earlier', () => {
    // Jump let go: plain gravFall, so the speed after the tick is exactly the one chosen.
    expect(arcTick(D.apexHangSpeed - D.gravFall, '')).toEqual({ vy: D.apexHangSpeed, jumpArc: false });
    expect(arcTick(D.apexHangSpeed - D.gravFall - 1, '')).toEqual({ vy: D.apexHangSpeed - 1, jumpArc: true });
  });

  it('letting go cuts a rise faster than jumpCutVel down to jumpCutVel, and leaves a slower rise alone', () => {
    expect(arcTick(-D.jumpCutVel - 1, '').vy).toBe(-D.jumpCutVel + D.gravFall);
    expect(arcTick(1 - D.jumpCutVel, '').vy).toBe(1 - D.jumpCutVel + D.gravFall);
  });
});

describe('jump cut: letting go early', () => {
  /** Holds jump for `hold` ticks, then lets go; returns the apex in sub-pixels and vy after each tick. */
  function hop(hold: number): { apex: number; vy: number[] } {
    const game = playingGame(FLAT);
    const p = game.run.player;
    const y0 = p.y;
    const vy: number[] = [];
    let apex = 0;
    for (let t = 1; t <= 80; t++) {
      tick(game, t <= hold ? 'J' : '');
      vy.push(p.vy);
      apex = Math.max(apex, y0 - p.y);
      if (p.onGround) break;
    }
    return { apex, vy };
  }

  it('cuts a faster rise down to jumpCutVel on the tick jump is released, and gravFall applies on that same tick', () => {
    const { vy } = hop(3);
    // Ticks 1 to 3 held: -1280, -1216, -1152. Tick 4 released: cut to -384, then gravFall.
    expect(vy.slice(0, 3)).toEqual([-1280, -1216, -1152]);
    expect(vy[3]).toBe(-P.jumpCutVel + P.gravFall);
    expect(vy[4]).toBe(-P.jumpCutVel + 2 * P.gravFall);
  });

  it('makes a one-tick tap a small hop of 1760 sub-pixels (0.43 tiles)', () => {
    const { apex, vy } = hop(1);
    expect(vy.slice(0, 5)).toEqual([-1280, -272, -160, -48, 64]);
    expect(apex).toBe(1760);
    expect(apex / TILE).toBeCloseTo(0.43, 2);
  });

  it('gives a higher jump for every longer hold, up to the full 13472', () => {
    let last = 0;
    for (let hold = 1; hold <= 21; hold++) {
      const { apex } = hop(hold);
      expect(apex, `hold ${hold}`).toBeGreaterThan(last);
      last = apex;
    }
    expect(last).toBe(13472);
    expect(hop(40).apex).toBe(13472);
  });

  it('does not cut a rise that is already at jumpCutVel or slower: letting go then only swaps gravRise for gravFall', () => {
    // After 15 held ticks vy is -1280 + 14 * 64 = -384, exactly jumpCutVel.
    const { vy } = hop(15);
    expect(vy[14]).toBe(-P.jumpCutVel);
    expect(vy[15]).toBe(-P.jumpCutVel + P.gravFall);
  });

  it('takes the apex hang away when jump is let go near the top: full gravFall at once', () => {
    // After 22 held ticks vy is 0 (the golden sequence); released, the next tick falls with plain gravFall.
    const { vy } = hop(22);
    expect(vy[21]).toBe(0);
    expect(vy[22]).toBe(P.gravFall);
  });
});

describe('coyote time: jumping just after walking off a ledge', () => {
  /** A ledge four tiles long with a long drop behind it. */
  const LEDGE = levelFromRows([
    'T.........D',
    '...........',
    '...........',
    '...........',
    '..P........',
    '####.......',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '###########',
  ]);

  /** Walks right off the ledge. Returns after the tick that ended in the air: the next tick is airborne tick 1. */
  function walkOff(phys: Phys): GameState {
    const game = playingGame(LEDGE, phys);
    for (let i = 0; i < 100 && game.run.player.onGround; i++) tick(game, 'R');
    expect(game.run.player.onGround).toBe(false);
    return game;
  }

  /** True when a jump pressed on airborne tick n starts. */
  function jumpsOnAirborneTick(n: number, phys: Phys): boolean {
    const game = walkOff(phys);
    for (let i = 1; i < n; i++) expect(has(tick(game, 'R'), 'jumped')).toBe(false);
    return has(tick(game, 'RJ'), 'jumped');
  }

  it('still jumps on airborne ticks 1 to coyoteTicks', () => {
    expect(P.coyoteTicks).toBe(6);
    for (let n = 1; n <= P.coyoteTicks; n++) {
      expect(jumpsOnAirborneTick(n, P), `airborne tick ${n}`).toBe(true);
    }
  });

  it('does not jump on airborne tick coyoteTicks + 1, or later', () => {
    expect(jumpsOnAirborneTick(P.coyoteTicks + 1, P)).toBe(false);
    expect(jumpsOnAirborneTick(P.coyoteTicks + 2, P)).toBe(false);
    expect(jumpsOnAirborneTick(P.coyoteTicks + 10, P)).toBe(false);
  });

  it('follows the tuning: with coyoteFrames 2 the last tick that jumps is airborne tick 2', () => {
    const phys = referencePhysWith({ forgiveness: { coyoteFrames: 2 } });
    expect(jumpsOnAirborneTick(1, phys)).toBe(true);
    expect(jumpsOnAirborneTick(2, phys)).toBe(true);
    expect(jumpsOnAirborneTick(3, phys)).toBe(false);
  });

  it('gives a full jump whatever the falling speed was: vy becomes -jumpVel', () => {
    const game = walkOff(P);
    stepTicks(stepPlayer, game, 'R', P.coyoteTicks - 1);
    expect(game.run.player.vy).toBeGreaterThan(0);
    tick(game, 'RJ');
    expect(game.run.player.vy).toBe(-P.jumpVel);
    expect(game.run.player.jumpArc).toBe(true);
  });

  it('is used up by the jump: no second jump in the same window, and none after an ordinary jump', () => {
    const game = walkOff(P);
    expect(has(tick(game, 'RJ'), 'jumped')).toBe(true);
    expect(game.run.player.coyote).toBe(0);
    tick(game, 'R');
    expect(has(tick(game, 'RJ'), 'jumped')).toBe(false);

    const ground = playingGame(FLAT);
    expect(has(tick(ground, 'J'), 'jumped')).toBe(true);
    tick(ground, '');
    expect(has(tick(ground, 'J'), 'jumped')).toBe(false);
  });
});

describe('jump buffer: pressing just before touching down', () => {
  /** A ledge, then a drop of 5 tiles: a fall long enough that coyote time is over before the buffer window starts. */
  const DROP = levelFromRows([
    'T.........D',
    '..P........',
    '####.......',
    '...........',
    '...........',
    '...........',
    '...........',
    '###########',
  ]);

  /**
   * Walks off the ledge, lets go, and falls to the floor. Jump is pressed for
   * one tick on tick `pressAt` (counted from the walk-off; null for never).
   * Returns the touchdown tick (the tick whose end finds the hero on the
   * ground) and the ticks on which a jump started.
   */
  function fall(pressAt: number | null, phys: Phys): { touchdown: number; jumpedOn: number[] } {
    const game = playingGame(DROP, phys);
    for (let i = 0; i < 100 && game.run.player.onGround; i++) tick(game, 'R');
    let touchdown = 0;
    const jumpedOn: number[] = [];
    for (let t = 1; t <= 60; t++) {
      const events = tick(game, t === pressAt ? 'J' : '');
      if (has(events, 'landed') && touchdown === 0) touchdown = t;
      if (has(events, 'jumped')) jumpedOn.push(t);
    }
    return { touchdown, jumpedOn };
  }

  it('uses a fall that is longer than coyote time plus the buffer window, so the two cannot be confused', () => {
    const { touchdown, jumpedOn } = fall(null, P);
    expect(jumpedOn).toEqual([]);
    expect(touchdown - P.jumpBufferTicks).toBeGreaterThan(P.coyoteTicks + 1);
  });

  it('honours a press up to jumpBufferTicks - 1 ticks before the touchdown tick: the jump starts on the tick after touchdown', () => {
    expect(P.jumpBufferTicks).toBe(7);
    const { touchdown } = fall(null, P);
    for (let early = 0; early <= P.jumpBufferTicks - 1; early++) {
      const { touchdown: same, jumpedOn } = fall(touchdown - early, P);
      expect(same, `press ${early} ticks early`).toBe(touchdown);
      expect(jumpedOn, `press ${early} ticks early`).toEqual([touchdown + 1]);
    }
  });

  it('forgets a press made jumpBufferTicks ticks before the touchdown tick, or earlier', () => {
    const { touchdown } = fall(null, P);
    expect(fall(touchdown - P.jumpBufferTicks, P).jumpedOn).toEqual([]);
    expect(fall(touchdown - P.jumpBufferTicks - 1, P).jumpedOn).toEqual([]);
  });

  it('jumps on its own tick when the press comes on the first tick after touchdown', () => {
    const { touchdown } = fall(null, P);
    expect(fall(touchdown + 1, P).jumpedOn).toEqual([touchdown + 1]);
  });

  it('follows the tuning: with jumpBufferFrames 3 a press 2 ticks early jumps and 3 ticks early does not', () => {
    const phys = referencePhysWith({ forgiveness: { jumpBufferFrames: 3 } });
    const { touchdown } = fall(null, phys);
    expect(fall(touchdown - 2, phys).jumpedOn).toEqual([touchdown + 1]);
    expect(fall(touchdown - 3, phys).jumpedOn).toEqual([]);
  });

  it('is used up by the jump: one buffered press gives one jump', () => {
    const { touchdown } = fall(null, P);
    const game = playingGame(DROP);
    for (let i = 0; i < 100 && game.run.player.onGround; i++) tick(game, 'R');
    stepTicks(stepPlayer, game, '', touchdown - 3);
    tick(game, 'J');
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, '', 80, events);
    expect(events.filter((e) => e.type === 'jumped')).toHaveLength(1);
    expect(game.run.player.jumpBuffer).toBe(0);
  });
});

describe('with coyoteFrames 0 and jumpBufferFrames 0 (the comfort handicap)', () => {
  const BARE = referencePhysWith({ forgiveness: { coyoteFrames: 0, jumpBufferFrames: 0 } });

  it('still jumps on the very tick of a press made on the ground', () => {
    const game = playingGame(FLAT, BARE);
    const events = tick(game, 'J');
    expect(has(events, 'jumped')).toBe(true);
    expect(game.run.player.vy).toBe(-BARE.jumpVel);
  });

  it('reaches the same apex of 13472 on tick 21 and lands on tick 41', () => {
    const game = playingGame(FLAT, BARE);
    const p = game.run.player;
    const y0 = p.y;
    let apex = 0;
    let apexTick = 0;
    let landedTick = 0;
    for (let t = 1; t <= 60 && landedTick === 0; t++) {
      const events = tick(game, 'J');
      if (y0 - p.y > apex) {
        apex = y0 - p.y;
        apexTick = t;
      }
      if (has(events, 'landed')) landedTick = t;
    }
    expect([apex, apexTick, landedTick]).toEqual([13472, 21, 41]);
  });

  it('does not jump on the first airborne tick after walking off a ledge', () => {
    const ledge = levelFromRows([
      'T.....D', //
      '.P.....',
      '##.....',
      '.......',
      '.......',
      '#######',
    ]);
    const game = playingGame(ledge, BARE);
    for (let i = 0; i < 100 && game.run.player.onGround; i++) tick(game, 'R');
    expect(has(tick(game, 'RJ'), 'jumped')).toBe(false);
  });

  it('forgets a press made on the touchdown tick itself; a press on the next tick jumps', () => {
    const drop = levelFromRows([
      'T.....D', //
      '.P.....',
      '##.....',
      '.......',
      '.......',
      '#######',
    ]);
    const run = (pressAt: number | null): { touchdown: number; jumpedOn: number[] } => {
      const game = playingGame(drop, BARE);
      for (let i = 0; i < 100 && game.run.player.onGround; i++) tick(game, 'R');
      let touchdown = 0;
      const jumpedOn: number[] = [];
      for (let t = 1; t <= 40; t++) {
        const events = tick(game, t === pressAt ? 'J' : '');
        if (has(events, 'landed') && touchdown === 0) touchdown = t;
        if (has(events, 'jumped')) jumpedOn.push(t);
      }
      return { touchdown, jumpedOn };
    };
    const { touchdown } = run(null);
    expect(touchdown).toBeGreaterThan(0);
    expect(run(touchdown).jumpedOn).toEqual([]);
    expect(run(touchdown + 1).jumpedOn).toEqual([touchdown + 1]);
  });
});

describe('head against a ceiling: corner nudge and bonk', () => {
  /** One ceiling block at col 3, row 2, three tiles above the floor. */
  const BLOCK = levelFromRows([
    'T......D', //
    '........',
    '...#....',
    '........',
    '.P......',
    '########',
  ]);
  const BLOCK_LEFT = 3 * TILE;
  const BLOCK_RIGHT = 4 * TILE;
  const BLOCK_BOTTOM = 3 * TILE;
  const STAND_Y = 5 * TILE - P.heroH;

  /** Jumps straight up from the floor with the hero's left edge at x; returns what happened. */
  function jumpAt(x: number, level: LevelData = BLOCK, phys: Phys = P, steer = ''): { game: GameState; events: GameEvent[]; top: number } {
    const game = playingGame(level, phys);
    place(game, { x, y: STAND_Y, onGround: true });
    const events: GameEvent[] = [];
    let top = STAND_Y;
    for (let t = 0; t < 50; t++) {
      events.push(...tick(game, `J${steer}`));
      top = Math.min(top, game.run.player.y);
    }
    return { game, events, top };
  }

  it('slides a rising hero left past a corner that its right side clips by cornerNudge or less, and the jump goes on to its full height', () => {
    expect(P.cornerNudge).toBe(1024);
    for (const clip of [1, 256, P.cornerNudge - 1, P.cornerNudge]) {
      const { game, events, top } = jumpAt(BLOCK_LEFT + clip - P.heroW);
      expect(has(events, 'bonked'), `clip ${clip}`).toBe(false);
      // Shifted by exactly the clip: the right side now runs along the block's left face.
      expect(game.run.player.x, `clip ${clip}`).toBe(BLOCK_LEFT - P.heroW);
      expect(STAND_Y - top, `clip ${clip}`).toBe(13472);
    }
  });

  it('slides a rising hero right past a corner that its left side clips by cornerNudge or less', () => {
    for (const clip of [1, 256, P.cornerNudge - 1, P.cornerNudge]) {
      const { game, events, top } = jumpAt(BLOCK_RIGHT - clip);
      expect(has(events, 'bonked'), `clip ${clip}`).toBe(false);
      expect(game.run.player.x, `clip ${clip}`).toBe(BLOCK_RIGHT);
      expect(STAND_Y - top, `clip ${clip}`).toBe(13472);
    }
  });

  it('keeps the upward speed through the nudge: the tick of the slide rises as far as a free jump does', () => {
    const free = playingGame(BLOCK);
    place(free, { x: 6 * TILE, y: STAND_Y, onGround: true });
    const nudged = playingGame(BLOCK);
    place(nudged, { x: BLOCK_LEFT + P.cornerNudge - P.heroW, y: STAND_Y, onGround: true });
    for (let t = 0; t < 45; t++) {
      tick(free, 'J');
      tick(nudged, 'J');
      expect(nudged.run.player.y).toBe(free.run.player.y);
      expect(nudged.run.player.vy).toBe(free.run.player.vy);
    }
  });

  it('bonks when the corner is clipped by one sub-pixel more than cornerNudge: head flush under the block, speed gone, arc over', () => {
    for (const x of [BLOCK_LEFT + P.cornerNudge + 1 - P.heroW, BLOCK_RIGHT - P.cornerNudge - 1]) {
      const game = playingGame(BLOCK);
      place(game, { x, y: STAND_Y, onGround: true });
      let bonk: GameEvent[] = [];
      for (let t = 0; t < 10 && bonk.length === 0; t++) bonk = tick(game, 'J').filter((e) => e.type === 'bonked');
      const p = game.run.player;
      expect(bonk).toEqual([{ type: 'bonked', x: x + (P.heroW >> 1), y: BLOCK_BOTTOM }]);
      expect(p.y).toBe(BLOCK_BOTTOM);
      expect(p.x).toBe(x);
      expect(p.vy).toBe(0);
      expect(p.jumpArc).toBe(false);
      // The arc is over, so the fall starts with plain gravFall although jump is still held.
      tick(game, 'J');
      expect(p.vy).toBe(P.gravFall);
    }
  });

  it('bonks a hero that is squarely under the block, and it comes back down to the floor', () => {
    const { game, events, top } = jumpAt(BLOCK_LEFT + ((TILE - P.heroW) >> 1));
    expect(events.map((e) => e.type)).toEqual(['jumped', 'bonked', 'landed']);
    expect(top).toBe(BLOCK_BOTTOM);
    expect(game.run.player.y).toBe(STAND_Y);
  });

  it('never nudges when cornerNudgePx is 0: the slightest clip bonks', () => {
    const phys = referencePhysWith({ forgiveness: { cornerNudgePx: 0 } });
    const { events, top } = jumpAt(BLOCK_LEFT + 1 - P.heroW, BLOCK, phys);
    expect(has(events, 'bonked')).toBe(true);
    expect(top).toBe(BLOCK_BOTTOM);
  });

  it('tries the side the hero is moving toward first: right when vx >= 0, left when vx < 0', () => {
    // With a nudge as wide as a tile a hero squarely under a lone block could slide out on either side.
    const wide = referencePhysWith({ forgiveness: { cornerNudgePx: 16 } });
    const centred = BLOCK_LEFT + ((TILE - P.heroW) >> 1);

    const still = jumpAt(centred, BLOCK, wide);
    expect(has(still.events, 'bonked')).toBe(false);
    expect(still.game.run.player.x).toBe(BLOCK_RIGHT);

    const movingRight = jumpAt(centred, BLOCK, wide, 'R');
    expect(has(movingRight.events, 'bonked')).toBe(false);
    expect(movingRight.game.run.player.x).toBeGreaterThanOrEqual(BLOCK_RIGHT);

    const movingLeft = jumpAt(centred, BLOCK, wide, 'L');
    expect(has(movingLeft.events, 'bonked')).toBe(false);
    expect(movingLeft.game.run.player.x).toBeLessThanOrEqual(BLOCK_LEFT - P.heroW);
  });

  it('takes the other side when the first one is walled in', () => {
    const wide = referencePhysWith({ forgiveness: { cornerNudgePx: 16 } });
    // The cell to the right of the block is solid too, so only the left side is open.
    const level = levelFromRows([
      'T......D', //
      '........',
      '...##...',
      '........',
      '.P......',
      '########',
    ]);
    const { game, events } = jumpAt(BLOCK_LEFT + ((TILE - P.heroW) >> 1), level, wide);
    expect(has(events, 'bonked')).toBe(false);
    expect(game.run.player.x).toBe(BLOCK_LEFT - P.heroW);
  });

  it('does not count a rising hero as standing, even when a nudge leaves a ledge exactly under its feet: the ground needs vy >= 0', () => {
    // Only a hero shorter than the jump speed and narrower than the nudge can get there, so the numbers are
    // made up for this one rule: a 4 px hero (with a bolt box that fits inside it) and a nudge as wide as a tile.
    const tiny = referencePhysWith({
      hero: { heroHitboxW: 4, heroHitboxH: 4 },
      forgiveness: { cornerNudgePx: 16, hurtInsetSidePx: 1, hurtInsetTopPx: 1, hurtInsetBottomPx: 1 },
      blaster: { boltHitboxW: 4, boltHitboxH: 4 },
    });
    // A ceiling block at col 3, row 2, and a ledge at col 2, row 3: the ledge's top is level with the block's underside.
    const level = levelFromRows([
      'T......D', //
      '........',
      '...#....',
      '..#.....',
      '........',
      '.P......',
      '########',
    ]);
    const game = playingGame(level, tiny);
    const p = game.run.player;
    // Under the block, moving up and left, so fast that this tick's rise equals the hero's height above the ledge top.
    place(game, { x: 3 * TILE + 512, y: 3 * TILE + 256, vy: -tiny.jumpVel - tiny.gravFall });
    const events = tick(game, 'L');

    // Nudged left out from under the block: now beside it, feet exactly on the line of the ledge top.
    expect(events).toEqual([]);
    expect(p.x).toBe(3 * TILE - tiny.heroW);
    expect(p.y + tiny.heroH).toBe(3 * TILE);
    // Still rising: not on the ground, speed kept.
    expect(p.onGround).toBe(false);
    expect(p.vy).toBe(-tiny.jumpVel);
  });

  it('gives one jump for one press, also when a low ceiling puts the hero back on the ground within the buffer time', () => {
    const corridor = levelFromRows([
      '#########', //
      'P.....T.D',
      '#########',
    ]);
    const game = playingGame(corridor);
    const events = tick(game, 'J');
    stepTicks(stepPlayer, game, '', 30, events);
    // Back on the floor after a few ticks, well inside jumpBufferTicks: the used-up press must not fire again.
    expect(types(events)).toEqual(['jumped', 'bonked', 'landed']);
    expect(game.run.player.onGround).toBe(true);
  });

  it('bonks at once in a corridor one tile high: the head stops flush under the ceiling', () => {
    const corridor = levelFromRows([
      '#########', //
      'P.....T.D',
      '#########',
    ]);
    const game = playingGame(corridor);
    const p = game.run.player;
    const events = tick(game, 'J');
    expect(events.map((e) => e.type)).toEqual(['jumped', 'bonked']);
    expect(p.y).toBe(TILE);
    expect(p.vy).toBe(0);
    expect(p.onGround).toBe(false);
  });
});

describe('ledge catch: falling just short of a ledge', () => {
  /** A ledge whose top is the top of row 3 and whose left face is the left edge of col 4. */
  const LEDGE = levelFromRows([
    'T......D', //
    '........',
    '........',
    '....####',
    '....####',
    '.P..####',
    '########',
  ]);
  const LEDGE_TOP = 3 * TILE;
  const LEDGE_FACE = 4 * TILE;
  /** The hero's x when its right side touches the ledge's face. */
  const FLUSH_X = LEDGE_FACE - P.heroW;

  /** A falling hero touching the ledge's face with its feet `lift` sub-pixels below the ledge top, pushing right. */
  function fallBeside(lift: number, level: LevelData = LEDGE, phys: Phys = P, vy = 0): { game: GameState; events: GameEvent[] } {
    const game = playingGame(level, phys);
    place(game, { x: FLUSH_X, y: LEDGE_TOP + lift - phys.heroH, vy });
    const events = tick(game, 'R');
    return { game, events };
  }

  it('lifts a falling hero onto a ledge whose top is ledgeCatch or less above the feet, and it lands there', () => {
    expect(P.ledgeCatch).toBe(768);
    for (const lift of [1, 256, P.ledgeCatch - 1, P.ledgeCatch]) {
      const { game, events } = fallBeside(lift);
      const p = game.run.player;
      expect(p.y + P.heroH, `lift ${lift}`).toBe(LEDGE_TOP);
      // It moved in by this tick's sideways speed, over the ledge.
      expect(p.x, `lift ${lift}`).toBe(FLUSH_X + P.airAccel);
      expect(p.vy, `lift ${lift}`).toBe(0);
      expect(p.onGround, `lift ${lift}`).toBe(true);
      // The landing reports the falling speed the hero had before the catch.
      expect(events, `lift ${lift}`).toEqual([{ type: 'landed', x: p.x + (P.heroW >> 1), y: LEDGE_TOP, speed: P.gravFall }]);
    }
  });

  it('treats the ledge as a wall when its top is one sub-pixel more than ledgeCatch above the feet: flush, no sideways speed, still falling', () => {
    const lift = P.ledgeCatch + 1;
    const { game, events } = fallBeside(lift);
    const p = game.run.player;
    expect(events).toEqual([]);
    expect(p.x).toBe(FLUSH_X);
    expect(p.vx).toBe(0);
    expect(p.onGround).toBe(false);
    expect(p.vy).toBe(P.gravFall);
    expect(p.y + P.heroH).toBe(LEDGE_TOP + lift + P.gravFall);
  });

  it('does not lift a hero that is still rising', () => {
    // vy is -500 before gravity, so it is still negative when the sideways move runs.
    const { game, events } = fallBeside(P.ledgeCatch, LEDGE, P, -500);
    const p = game.run.player;
    expect(events).toEqual([]);
    expect(p.x).toBe(FLUSH_X);
    expect(p.vx).toBe(0);
    expect(p.onGround).toBe(false);
  });

  it('lifts a hero that has just stopped rising: vy 0 after gravity counts as falling', () => {
    const { game } = fallBeside(P.ledgeCatch, LEDGE, P, -P.gravFall);
    expect(game.run.player.y + P.heroH).toBe(LEDGE_TOP);
    expect(game.run.player.onGround).toBe(true);
  });

  it('does not lift when there is no room for the hero on top of the ledge', () => {
    const roofed = levelFromRows([
      'T......D', //
      '........',
      '....#...',
      '....####',
      '....####',
      '.P..####',
      '########',
    ]);
    const { game, events } = fallBeside(P.ledgeCatch, roofed);
    expect(events).toEqual([]);
    expect(game.run.player.x).toBe(FLUSH_X);
    expect(game.run.player.onGround).toBe(false);
  });

  it('never lifts with ledgeCatchPx 0: one sub-pixel short is a wall', () => {
    const phys = referencePhysWith({ forgiveness: { ledgeCatchPx: 0 } });
    const { game, events } = fallBeside(1, LEDGE, phys);
    expect(events).toEqual([]);
    expect(game.run.player.x).toBe(FLUSH_X);
    expect(game.run.player.onGround).toBe(false);
  });

  it('never lifts a hero that is walking on the ground, even with a catch as tall as a tile', () => {
    const tall = referencePhysWith({ forgiveness: { ledgeCatchPx: 16 } });
    const stepUp = levelFromRows([
      'T......D', //
      '........',
      '.P..####',
      '########',
    ]);
    const game = playingGame(stepUp, tall);
    const p = game.run.player;
    const y0 = p.y;
    for (let i = 0; i < 60; i++) {
      tick(game, 'R');
      expect(p.y).toBe(y0);
    }
    expect(p.x).toBe(4 * TILE - tall.heroW);

    // The same step is climbed by a hero that falls beside it, so it was only the ground that stopped the lift.
    const falling = playingGame(stepUp, tall);
    place(falling, { x: 4 * TILE - tall.heroW, y: y0 - 256 });
    tick(falling, 'R');
    expect(falling.run.player.y + tall.heroH).toBe(2 * TILE);
    expect(falling.run.player.onGround).toBe(true);
  });

  describe('a real jump that comes up short', () => {
    /** A step three tiles high. The hero starts beside it, touching its face. */
    const STEP = levelFromRows([
      'T.......D',
      '.........',
      '.........',
      '.........',
      '....#####',
      '....#####',
      '...P#####',
      '#########',
    ]);
    const STEP_TOP = 4 * TILE;
    const STEP_FLOOR = 7 * TILE;
    // The comfort handicap's jump: 5 % weaker. Its apex is 12192 sub-pixels (47.625 px), 96 short of three tiles.
    const weakJump = { jump: { jumpVelocity: 5 * 0.95 } };

    /** Jumps beside the step with right and jump held; returns where the hero's feet end up. */
    function climb(phys: Phys): number {
      const game = playingGame(STEP, phys);
      const p = game.run.player;
      p.x = 4 * TILE - phys.heroW;
      stepTicks(stepPlayer, game, 'RJ', 60);
      expect(p.onGround).toBe(true);
      return p.y + phys.heroH;
    }

    it('has an apex 96 sub-pixels below the top of the step', () => {
      const phys = referencePhysWith(weakJump);
      const game = playingGame(FLAT, phys);
      const p = game.run.player;
      const y0 = p.y;
      let apex = 0;
      for (let t = 0; t < 30; t++) {
        tick(game, 'J');
        apex = Math.max(apex, y0 - p.y);
      }
      expect(apex).toBe(12192);
      expect(STEP_FLOOR - STEP_TOP - apex).toBe(96);
    });

    it('is carried onto the step by the ledge catch', () => {
      expect(climb(referencePhysWith(weakJump))).toBe(STEP_TOP);
    });

    it('falls back to the floor when ledgeCatchPx is 0', () => {
      expect(climb(referencePhysWith({ ...weakJump, forgiveness: { ledgeCatchPx: 0 } }))).toBe(STEP_FLOOR);
    });

    it('needs no catch with the full jump, which clears the step', () => {
      expect(climb(referencePhysWith({ forgiveness: { ledgeCatchPx: 0 } }))).toBe(STEP_TOP);
    });
  });
});
