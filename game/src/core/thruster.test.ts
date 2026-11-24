import { describe, expect, it } from 'vitest';

import { stepPlayer } from './player';
import { DISTINCT_PHYS, IN, levelFromRows, playingGame, REFERENCE_PHYS, referencePhysWith, stepTicks, sub } from './testkit';
import { TILE } from './types';
import type { GameEvent, GameState, Phys } from './types';

/**
 * The thruster: step 8 of the tick, driven through stepPlayer alone. Picking
 * a pack up is step 14 (contact.ts); here the hero is simply handed a pack
 * and a tank, which is exactly what that step does.
 */

const P = REFERENCE_PHYS;

/** One tick with the named buttons held (L R J F T); returns that tick's events. */
function tick(game: GameState, letters: string): GameEvent[] {
  const events: GameEvent[] = [];
  stepPlayer(game, IN(letters), events);
  return events;
}

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** A floor under 22 tiles of open sky: room for the highest climb a tank allows. */
const SHAFT = levelFromRows([
  'T.......D',
  ...Array.from({ length: 21 }, () => '.........'),
  '....P....',
  '#########',
]);

/** A game on SHAFT with the hero standing, wearing a pack with `fuel` ticks in the tank (full by default). */
function withPack(fuel?: number, phys: Phys = P): GameState {
  const game = playingGame(SHAFT, phys);
  game.run.player.hasThruster = true;
  game.run.player.fuel = fuel ?? phys.fuelTicks;
  return game;
}

/** vy and fuel after each tick of a button sequence, as "vy/fuel". */
function trace(game: GameState, sequence: readonly string[]): string[] {
  return sequence.map((letters) => {
    tick(game, letters);
    return `${game.run.player.vy}/${game.run.player.fuel}`;
  });
}

/** The highest point reached above the start, in sub-pixels, for a thrust pattern (true = THRUST held on tick t, from 0). */
function climb(pattern: (t: number) => boolean, phys: Phys = P): number {
  const game = withPack(undefined, phys);
  const p = game.run.player;
  const y0 = p.y;
  let best = 0;
  for (let t = 0; t < 3000; t++) {
    tick(game, pattern(t) ? 'T' : '');
    best = Math.max(best, y0 - p.y);
    if (p.fuel === 0 && p.onGround) return best;
  }
  throw new Error('the tank never ran dry: the pattern does not burn');
}

describe('burning', () => {
  it('follows the golden sequence: 7 ticks of thrust from standing, then release, gives vy/fuel -96/79 ... -448/73, -16/73, 96/73, 208/73', () => {
    const game = withPack();
    expect(trace(game, ['T', 'T', 'T', 'T', 'T', 'T', 'T', '', '', ''])).toEqual([
      '-96/79',
      '-192/78',
      '-288/77',
      '-384/76',
      '-448/75',
      '-448/74',
      '-448/73',
      '-16/73',
      '96/73',
      '208/73',
    ]);
  });

  it('uses one unit of fuel per burning tick, so a full tank burns for exactly fuelTicks ticks', () => {
    const game = withPack();
    const p = game.run.player;
    expect(P.fuelTicks).toBe(80);
    for (let t = 1; t <= P.fuelTicks; t++) {
      tick(game, 'T');
      expect(p.fuel, `tick ${t}`).toBe(P.fuelTicks - t);
      expect(p.thrusting, `tick ${t}`).toBe(true);
    }
    tick(game, 'T');
    expect(p.fuel).toBe(0);
    expect(p.thrusting).toBe(false);
  });

  it('speeds the climb up by thrustAccel per tick and never past thrustMaxRise, with gravity switched off', () => {
    const game = withPack();
    const p = game.run.player;
    for (let t = 1; t <= 30; t++) {
      tick(game, 'T');
      expect(p.vy).toBe(-Math.min(t * P.thrustAccel, P.thrustMaxRise));
    }
    expect(p.vy).toBe(-P.thrustMaxRise);
  });

  it('lifts a standing hero off the ground on the first burning tick', () => {
    const game = withPack();
    const p = game.run.player;
    const y0 = p.y;
    tick(game, 'T');
    expect(p.onGround).toBe(false);
    expect(y0 - p.y).toBe(P.thrustAccel);
  });

  it('stops a fall at terminal speed in 11 ticks and 19.25 px: maxFall / thrustAccel ticks, rounded up', () => {
    const game = withPack();
    const p = game.run.player;
    p.y = 2 * TILE;
    p.onGround = false;
    p.vy = P.maxFall;
    const y0 = p.y;
    const ticks = Math.ceil(P.maxFall / P.thrustAccel);
    expect(ticks).toBe(11);
    let lowest = y0;
    for (let t = 1; t <= ticks; t++) {
      tick(game, 'T');
      lowest = Math.max(lowest, p.y);
      // Still falling until the last of them.
      if (t < ticks) expect(p.vy).toBeGreaterThan(0);
    }
    expect(p.vy).toBeLessThanOrEqual(0);
    // After those 11 ticks the hero is 19.25 px below where the burn began...
    expect(p.y - y0).toBe(sub(19.25));
    // ...having touched 19.375 px one tick earlier: the 11th tick already rises by 32 sub-pixels.
    expect(lowest - y0).toBe(sub(19.375));
  });

  it('does nothing without a pack, and nothing with a pack whose tank is empty', () => {
    const none = playingGame(SHAFT);
    const empty = withPack(0);
    const plain = playingGame(SHAFT);
    for (let t = 0; t < 20; t++) {
      const events = [...tick(none, 'T'), ...tick(empty, 'T')];
      tick(plain, '');
      expect(events).toEqual([]);
      expect(none.run.player).toEqual(plain.run.player);
      expect(empty.run.player).toEqual({ ...plain.run.player, hasThruster: true });
    }
  });

  it('needs the pack as well as fuel: a tank with no pack on the hero does nothing', () => {
    const game = playingGame(SHAFT);
    const p = game.run.player;
    p.fuel = 5;
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'T', 10, events);
    expect(events).toEqual([]);
    expect(p.fuel).toBe(5);
    expect(p.onGround).toBe(true);
  });

  it('reports thrustStarted on the first burning tick and thrustStopped on the first tick without, once each', () => {
    const game = withPack();
    expect(types(tick(game, 'T'))).toEqual(['thrustStarted']);
    const during: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'T', 10, during);
    expect(during).toEqual([]);
    expect(types(tick(game, ''))).toEqual(['thrustStopped']);
    expect(game.run.player.thrusting).toBe(false);
    const after: GameEvent[] = [];
    stepTicks(stepPlayer, game, '', 5, after);
    expect(after).toEqual([]);
  });

  it('ends the jump arc: after a burn, letting go of jump no longer cuts the rise and gravity is plain gravFall', () => {
    const game = withPack();
    const p = game.run.player;
    // Jump and hold until the rise has slowed to the engine's range, then burn for one tick.
    stepTicks(stepPlayer, game, 'J', 14);
    expect(p.jumpArc).toBe(true);
    tick(game, 'JT');
    expect(p.thrusting).toBe(true);
    expect(p.jumpArc).toBe(false);
    expect(p.vy).toBe(-P.thrustMaxRise);
    // Engine off, jump still held: no gravRise any more, and the thrust cut applies.
    tick(game, 'J');
    expect(p.vy).toBe(-P.thrustCutVel + P.gravFall);
  });
});

describe('each thrust rule reads its own Phys field (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers thrustAccel = groundDecel (96) and thrustCutVel = apexHangSpeed = groundTurn =
  // cinderpegSpeed (128), so the golden sequence above cannot tell those fields apart.
  const D = DISTINCT_PHYS;

  /** One tick from a hero two tiles up in open air, wearing a full pack, with the given vy and thrusting flag. */
  function airTick(vy: number, letters: string, thrusting = false): { vy: number; fuel: number } {
    const game = withPack(undefined, D);
    const p = game.run.player;
    p.y -= 2 * TILE;
    p.onGround = false;
    p.vy = vy;
    p.thrusting = thrusting;
    tick(game, letters);
    return { vy: p.vy, fuel: p.fuel };
  }

  it('a burning tick adds thrustAccel upward and uses one unit of a tank of fuelTicks', () => {
    const game = withPack(undefined, D);
    tick(game, 'T');
    expect(game.run.player.vy).toBe(-D.thrustAccel);
    expect(game.run.player.fuel).toBe(D.fuelTicks - 1);
  });

  it('burns up to thrustMaxRise and idles above it: no fuel used, plain gravity', () => {
    expect(airTick(1 - D.thrustMaxRise, 'T')).toEqual({ vy: -D.thrustMaxRise, fuel: D.fuelTicks - 1 });
    expect(airTick(-D.thrustMaxRise, 'T')).toEqual({ vy: -D.thrustMaxRise, fuel: D.fuelTicks - 1 });
    expect(airTick(-D.thrustMaxRise - 1, 'T')).toEqual({ vy: -D.thrustMaxRise - 1 + D.gravFall, fuel: D.fuelTicks });
  });

  it('the thrust cut takes a climb faster than thrustCutVel down to thrustCutVel, and leaves a slower climb alone', () => {
    expect(airTick(-D.thrustCutVel - 1, '', true).vy).toBe(-D.thrustCutVel + D.gravFall);
    expect(airTick(1 - D.thrustCutVel, '', true).vy).toBe(1 - D.thrustCutVel + D.gravFall);
  });
});

describe('idling above the cap', () => {
  it('burns nothing while the hero rises faster than thrustMaxRise: in a jump with thrust held, fuel starts to go on tick 15', () => {
    const game = withPack();
    const p = game.run.player;
    const plain = playingGame(SHAFT);
    let firstBurn = 0;
    for (let t = 1; t <= 20 && firstBurn === 0; t++) {
      const events = tick(game, 'JT');
      tick(plain, 'J');
      if (p.fuel < P.fuelTicks) {
        firstBurn = t;
        expect(types(events)).toEqual(['thrustStarted']);
      } else {
        // An idling engine changes nothing: the jump is exactly a plain held jump, and it is not "thrusting".
        expect(p.thrusting, `tick ${t}`).toBe(false);
        expect(p.vy, `tick ${t}`).toBe(plain.run.player.vy);
        expect(p.y, `tick ${t}`).toBe(plain.run.player.y);
        expect(p.jumpArc, `tick ${t}`).toBe(true);
      }
    }
    expect(firstBurn).toBe(15);
    // The first burning tick starts from a rise of exactly thrustMaxRise or slower, and holds the cap.
    expect(p.vy).toBe(-P.thrustMaxRise);
    expect(p.fuel).toBe(P.fuelTicks - 1);
  });

  it('starts burning on the first tick whose rise is at thrustMaxRise or slower: vy >= -thrustMaxRise', () => {
    const atCap = withPack();
    atCap.run.player.onGround = false;
    atCap.run.player.vy = -P.thrustMaxRise;
    atCap.run.player.y = 10 * TILE;
    tick(atCap, 'T');
    expect(atCap.run.player.fuel).toBe(P.fuelTicks - 1);

    const above = withPack();
    above.run.player.onGround = false;
    above.run.player.vy = -P.thrustMaxRise - 1;
    above.run.player.y = 10 * TILE;
    tick(above, 'T');
    expect(above.run.player.fuel).toBe(P.fuelTicks);
    expect(above.run.player.thrusting).toBe(false);
    // Idling leaves gravity on.
    expect(above.run.player.vy).toBe(-P.thrustMaxRise - 1 + P.gravFall);
  });
});

describe('thrust cut', () => {
  it('cuts the climb to thrustCutVel on the tick thrust is released, and gravFall applies on that same tick', () => {
    const game = withPack();
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 10);
    expect(p.vy).toBe(-P.thrustMaxRise);
    tick(game, '');
    expect(p.vy).toBe(-P.thrustCutVel + P.gravFall);
    expect(p.vy).toBe(-16);
  });

  it('cuts the climb the same way on the tick after the tank ran dry, with thrust still held', () => {
    const game = withPack(5);
    const p = game.run.player;
    const events: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'T', 5, events);
    expect(p.fuel).toBe(0);
    expect(p.vy).toBe(-P.thrustMaxRise);
    // The emptying tick itself still burns: the pack is still "thrusting" at its end.
    expect(types(events)).toEqual(['thrustStarted', 'fuelEmptied']);
    expect(p.thrusting).toBe(true);

    expect(types(tick(game, 'T'))).toEqual(['thrustStopped']);
    expect(p.vy).toBe(-P.thrustCutVel + P.gravFall);
    expect(p.thrusting).toBe(false);
  });

  it('leaves a climb slower than thrustCutVel alone', () => {
    const game = withPack();
    const p = game.run.player;
    tick(game, 'T');
    expect(p.vy).toBe(-P.thrustAccel);
    expect(P.thrustAccel).toBeLessThan(P.thrustCutVel);
    tick(game, '');
    expect(p.vy).toBe(-P.thrustAccel + P.gravFall);
  });

  it('happens once, on the tick the burn ends: later ticks without thrust are plain gravity', () => {
    const game = withPack();
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 10);
    const after = trace(game, ['', '', '', '']);
    expect(after).toEqual(['-16/70', '96/70', '208/70', '320/70']);
    expect(p.thrusting).toBe(false);
  });

  it('is skipped on the tick a jump starts: releasing thrust and pressing jump together gives the full jump speed', () => {
    // Two ticks of thrust lift the hero off the floor; coyote time still allows a jump.
    const game = withPack();
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 2);
    expect(p.onGround).toBe(false);
    expect(p.thrusting).toBe(true);

    const events = tick(game, 'J');
    expect(types(events)).toEqual(['jumped', 'thrustStopped']);
    expect(p.vy).toBe(-P.jumpVel);
    // And the jump goes on as a plain held jump: 1280, then 64 less each tick.
    tick(game, 'J');
    expect(p.vy).toBe(-P.jumpVel + P.gravRise);
    tick(game, 'J');
    expect(p.vy).toBe(-P.jumpVel + 2 * P.gravRise);
  });

  it('is skipped while the engine only idles: a jump started with thrust held is not cut when thrust is let go', () => {
    const game = withPack();
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 2);
    expect(p.thrusting).toBe(true);

    // Jump with thrust still held: the engine idles above its cap, which ends the burn without a cut.
    const events = tick(game, 'JT');
    expect(types(events)).toEqual(['jumped', 'thrustStopped']);
    expect(p.vy).toBe(-P.jumpVel);
    expect(p.fuel).toBe(P.fuelTicks - 2);

    tick(game, 'JT');
    expect(p.vy).toBe(-P.jumpVel + P.gravRise);
    // Thrust released in mid-jump: nothing to cut, the engine was not burning.
    tick(game, 'J');
    expect(p.vy).toBe(-P.jumpVel + 2 * P.gravRise);
    expect(p.fuel).toBe(P.fuelTicks - 2);
  });

  it('never cuts while thrust is held and the engine idles above its cap, even right after a burn', () => {
    // A state the rules cannot produce without a jump, built by hand to pin the rule down on its own:
    // the pack burned last tick, thrust is still held, and the hero rises faster than the engine's cap.
    const game = withPack();
    const p = game.run.player;
    p.y = 10 * TILE;
    p.onGround = false;
    p.thrusting = true;
    p.vy = -P.thrustMaxRise - 200;
    const events = tick(game, 'T');
    expect(types(events)).toEqual(['thrustStopped']);
    expect(p.vy).toBe(-P.thrustMaxRise - 200 + P.gravFall);
    expect(p.fuel).toBe(P.fuelTicks);

    // The same state with thrust let go is cut.
    const released = withPack();
    const q = released.run.player;
    q.y = 10 * TILE;
    q.onGround = false;
    q.thrusting = true;
    q.vy = -P.thrustMaxRise - 200;
    tick(released, '');
    expect(q.vy).toBe(-P.thrustCutVel + P.gravFall);
  });

  it('follows the tuning: with jetCutSpeed equal to jetMaxRiseSpeed nothing is cut', () => {
    const phys = referencePhysWith({ thruster: { jetCutSpeed: 1.75 } });
    const game = withPack(undefined, phys);
    stepTicks(stepPlayer, game, 'T', 10);
    tick(game, '');
    expect(game.run.player.vy).toBe(-phys.thrustMaxRise + phys.gravFall);
  });
});

describe('how high a tank climbs', () => {
  const held = climb(() => true);

  it('climbs 35024 sub-pixels (136.8 px, 8.55 tiles) with THRUST held from standing', () => {
    expect(held).toBe(35024);
    expect(held / TILE).toBeCloseTo(8.55, 2);
  });

  it('never climbs higher with a periodic tap pattern (1 to 16 ticks on, 1 to 16 off, three phases each) than with THRUST held', () => {
    let best = 0;
    let tried = 0;
    for (let on = 1; on <= 16; on++) {
      for (let off = 1; off <= 16; off++) {
        for (const phase of [0, on >> 1, on]) {
          const period = on + off;
          const height = climb((t) => (t + phase) % period < on);
          best = Math.max(best, height);
          tried++;
          if (height > held) expect.fail(`${on} on / ${off} off, phase ${phase} climbs ${height}, more than holding (${held})`);
        }
      }
    }
    expect(tried).toBe(768);
    // The patterns do climb, just not as high: the comparison is not empty.
    expect(best).toBeGreaterThan(held >> 1);
    expect(best).toBeLessThan(held);
  });

  it('never climbs higher by pausing the burn once (1 to 12 ticks, anywhere in the first second) than with THRUST held', () => {
    for (let pauseAt = 1; pauseAt <= 60; pauseAt += 3) {
      for (let pause = 1; pause <= 12; pause++) {
        const height = climb((t) => t < pauseAt || t >= pauseAt + pause);
        if (height > held) expect.fail(`a pause of ${pause} ticks at tick ${pauseAt} climbs ${height}, more than holding (${held})`);
      }
    }
  });
});

describe('the tank and the packs', () => {
  /** Pickups in reading order: 0 crystal, 1 pack, 2 blaster, 3 pack. */
  const PACKS = levelFromRows([
    'T.G.J.B.J.D', //
    '...........',
    '...........',
    '.P.........',
    '###########',
  ]);

  /** The hero on PACKS wearing a pack with `fuel` in the tank, and the given pickups already gone. */
  function wearing(fuel: number, taken: boolean[]): GameState {
    const game = playingGame(PACKS);
    game.run.player.hasThruster = true;
    game.run.player.fuel = fuel;
    game.run.taken = taken;
    return game;
  }

  it('puts every used pack back when the tank reaches 0, and nothing else', () => {
    const game = wearing(2, [true, true, true, true]);
    expect(types(tick(game, 'T'))).toEqual(['thrustStarted']);
    expect(game.run.taken).toEqual([true, true, true, true]);

    tick(game, 'T');
    expect(game.run.player.fuel).toBe(0);
    // The crystal and the blaster stay taken.
    expect(game.run.taken).toEqual([true, false, true, false]);
  });

  it('reports fuelEmptied at the centre of the hero, then one pickupRestored per pack in index order at the centre of its cell', () => {
    const game = wearing(1, [true, true, true, true]);
    const p = game.run.player;
    const centre = { x: p.x + (P.heroW >> 1), y: p.y + (P.heroH >> 1) };
    const events = tick(game, 'T');
    expect(events).toEqual([
      { type: 'fuelEmptied', ...centre },
      { type: 'pickupRestored', kind: 'thruster', index: 1, x: 4 * TILE + (TILE >> 1), y: TILE >> 1 },
      { type: 'pickupRestored', kind: 'thruster', index: 3, x: 8 * TILE + (TILE >> 1), y: TILE >> 1 },
      { type: 'thrustStarted' },
    ]);
  });

  it('restores only the packs that were taken: one still lying in the level is not announced', () => {
    const game = wearing(1, [false, true, false, false]);
    const events = tick(game, 'T');
    expect(types(events)).toEqual(['fuelEmptied', 'pickupRestored', 'thrustStarted']);
    expect(game.run.taken).toEqual([false, false, false, false]);
  });

  it('reports the empty tank once: holding thrust on an empty tank is silent and restores nothing more', () => {
    const game = wearing(1, [true, true, true, true]);
    tick(game, 'T');
    game.run.taken[1] = true;
    const later: GameEvent[] = [];
    stepTicks(stepPlayer, game, 'T', 20, later);
    // The engine stops, and the hero drops back to the floor; nothing about the tank or the packs.
    expect(types(later)).toEqual(['thrustStopped', 'landed']);
    expect(game.run.taken[1]).toBe(true);
  });

  it('keeps the pack on the hero when the tank is empty: hasThruster stays true', () => {
    const game = wearing(1, [true, true, true, true]);
    stepTicks(stepPlayer, game, 'T', 5);
    expect(game.run.player.fuel).toBe(0);
    expect(game.run.player.hasThruster).toBe(true);
  });

  it('burns a refilled tank from the next tick on, one unit per tick, as a full tank does', () => {
    const game = wearing(3, [false, true, false, true]);
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 3);
    expect(p.fuel).toBe(0);
    stepTicks(stepPlayer, game, '', 4);

    // What step 14 does when a pack is touched: a full tank.
    p.fuel = P.fuelTicks;
    const events = tick(game, 'T');
    expect(types(events)).toEqual(['thrustStarted']);
    expect(p.fuel).toBe(P.fuelTicks - 1);
    stepTicks(stepPlayer, game, 'T', 9);
    expect(p.fuel).toBe(P.fuelTicks - 10);
  });

  it('keeps burning without a break when the tank is refilled on the very tick it ran dry', () => {
    const game = wearing(1, [false, true, false, true]);
    const p = game.run.player;
    stepTicks(stepPlayer, game, 'T', 1);
    expect(p.fuel).toBe(0);
    expect(p.thrusting).toBe(true);
    // A pack touched on that same tick (step 14 runs after stepPlayer) refills before the next tick.
    p.fuel = P.fuelTicks;
    const events = tick(game, 'T');
    expect(events).toEqual([]);
    expect(p.thrusting).toBe(true);
    expect(p.vy).toBe(-2 * P.thrustAccel);
  });
});
