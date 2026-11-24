import { describe, expect, it } from 'vitest';

import { stepBolt } from './bolt';
import { resolveContacts } from './contact';
import { stepEnemies } from './enemies';
import { stepPlayer } from './player';
import { createRun, respawnRun } from './run';
import { DISTINCT_PHYS, IN, levelFromRows, playingGame, REFERENCE_PHYS, referencePhysWith } from './testkit';
import { ENEMY_SIZE, TILE } from './types';
import type { EnemyState, GameEvent, GameState, LevelData, Phys } from './types';

/**
 * The blaster's bolt: step 13 of the tick (docs/ARCHITECTURE.md, section 5.7),
 * on the reference numbers. Two ways of driving it:
 *
 * - `tick(game, 'F')` runs steps 4 to 13 in the contract's order (stepPlayer,
 *   stepEnemies, stepBolt), for the rules about presses, the fire buffer and
 *   moving enemies;
 * - `shoot(game)` puts a press in the buffer, as step 4 does, and runs
 *   stepBolt alone, so that the hero and the enemies stay exactly where the
 *   test put them. That is how the geometry is pinned to the sub-pixel.
 */

const P = REFERENCE_PHYS;

/** Steps 4 to 13 of one playing tick with the named buttons held (L R J F T); returns that tick's events. */
function tick(game: GameState, letters = ''): GameEvent[] {
  const events: GameEvent[] = [];
  stepPlayer(game, IN(letters), events);
  stepEnemies(game);
  stepBolt(game, events);
  return events;
}

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

/** A game on the level with the hero standing on P, blaster in hand. */
function armed(level: LevelData, phys: Phys = P): GameState {
  const game = playingGame(level, phys);
  game.run.player.hasBlaster = true;
  return game;
}

function enemyAt(game: GameState, index = 0): EnemyState {
  const enemy = game.run.enemies[index];
  if (enemy === undefined) throw new Error(`the level has no enemy ${index}`);
  return enemy;
}

/** How a flight ended: the tick it ended on (1 = the spawn tick), the reason, and every event since the press. */
interface Shot {
  readonly ticks: number;
  readonly hit: 'wall' | 'enemy' | 'range';
  readonly events: GameEvent[];
}

function endOf(events: GameEvent[], ticks: number): Shot {
  const ended = events.find((e) => e.type === 'boltEnded');
  if (ended === undefined) throw new Error('no boltEnded event');
  return { ticks, hit: ended.hit, events };
}

/** A fire press as step 4 leaves it in the buffer, then step 13 alone until the bolt is gone. Nothing else moves. */
function shoot(game: GameState): Shot {
  const events: GameEvent[] = [];
  game.run.player.fireBuffer = game.phys.fireBufferTicks + 1;
  for (let ticks = 1; ticks <= 1000; ticks++) {
    stepBolt(game, events);
    if (!game.run.bolt.active) return endOf(events, ticks);
  }
  throw new Error('the bolt never ended');
}

/** FIRE pressed for one tick, then nothing held, with steps 4 to 13 running, until the bolt is gone. */
function fireAndWatch(game: GameState): Shot {
  const events = tick(game, 'F');
  for (let ticks = 1; ticks <= 1000; ticks++) {
    if (!game.run.bolt.active) return endOf(events, ticks);
    events.push(...tick(game));
  }
  throw new Error('the bolt never ended');
}

/** The hero's front edge: his right side when facing right, his left side when facing left. */
function front(game: GameState): number {
  const p = game.run.player;
  return p.facing > 0 ? p.x + game.phys.heroW : p.x;
}

/** A flat hall 41 tiles wide, open to the grid edges: the hero stands in the middle, 20 clear tiles on either side. */
const HALL = levelFromRows([
  'T' + '.'.repeat(39) + 'D',
  '.'.repeat(41),
  '.'.repeat(20) + 'P' + '.'.repeat(20),
  '#'.repeat(41),
]);

/** HALL with two moths parked out of the way in the top corner; tests put them where they need them. */
const MOTH_HALL = levelFromRows([
  'T' + '.'.repeat(37) + 'HHD',
  '.'.repeat(41),
  '.'.repeat(20) + 'P' + '.'.repeat(20),
  '#'.repeat(41),
]);

/** Puts an enemy's body at (x, y), heading `dir`. */
function place(enemy: EnemyState, x: number, y: number, dir: -1 | 1 = -1): void {
  enemy.x = x;
  enemy.y = y;
  enemy.dir = dir;
}

/** The row the hero of HALL stands in, as a y coordinate: a body placed here is level with him. */
const HERO_ROW_Y = 2 * TILE;

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

describe('firing', () => {
  it('facing right: the bolt is born inside the hero, flush with his right side and centred on his height, and moves on that same tick', () => {
    const game = armed(HALL);
    const p = game.run.player;
    const events = tick(game, 'F');

    const bornX = p.x + P.heroW - P.boltW;
    const bornY = p.y + ((P.heroH - P.boltH) >> 1);
    // Centred: as much body above the bolt as below it (4 px each with a 14 px hero and a 6 px bolt).
    expect(bornY - p.y).toBe(p.y + P.heroH - (bornY + P.boltH));
    expect(game.run.bolt).toEqual({
      active: true,
      x: bornX + P.boltSpeed,
      y: bornY,
      dir: 1,
      rangeLeft: P.boltRange - P.boltSpeed,
    });
    // The event marks the centre of the bolt where it was born, before the move.
    expect(events).toEqual([{ type: 'boltFired', x: bornX + (P.boltW >> 1), y: bornY + (P.boltH >> 1), dir: 1 }]);
  });

  it('facing left: the bolt is born flush with his left side and flies left', () => {
    const game = armed(HALL);
    const p = game.run.player;
    p.facing = -1;
    const events = tick(game, 'F');

    const bornY = p.y + ((P.heroH - P.boltH) >> 1);
    expect(game.run.bolt).toEqual({
      active: true,
      x: p.x - P.boltSpeed,
      y: bornY,
      dir: -1,
      rangeLeft: P.boltRange - P.boltSpeed,
    });
    expect(events).toEqual([{ type: 'boltFired', x: p.x + (P.boltW >> 1), y: bornY + (P.boltH >> 1), dir: -1 }]);
  });

  it('for every bolt box compileTuning accepts (1 sub-pixel up to the hero\'s own size), the bolt is born inside the hero box', () => {
    // So it is never born inside a wall (section 5.7): the hero's box never is.
    for (const [w, h] of [
      [1 / 256, 1 / 256],
      [8, 6],
      [10, 14],
      [10, 1 / 256],
      [1 / 256, 14],
      [9, 13],
    ] as const) {
      const phys = referencePhysWith({ blaster: { boltHitboxW: w, boltHitboxH: h } });
      for (const facing of [1, -1] as const) {
        const game = armed(HALL, phys);
        const p = game.run.player;
        p.facing = facing;
        game.run.player.fireBuffer = 1;
        const events: GameEvent[] = [];
        stepBolt(game, events);
        const born = events[0];
        if (born?.type !== 'boltFired') throw new Error('no bolt was fired');
        // boltFired marks the centre of the box where it was born: get the box back from it.
        const left = born.x - (phys.boltW >> 1);
        const top = born.y - (phys.boltH >> 1);
        const label = `${w} x ${h} px, facing ${facing}`;
        expect(left, label).toBeGreaterThanOrEqual(p.x);
        expect(left + phys.boltW, label).toBeLessThanOrEqual(p.x + phys.heroW);
        expect(top, label).toBeGreaterThanOrEqual(p.y);
        expect(top + phys.boltH, label).toBeLessThanOrEqual(p.y + phys.heroH);
      }
    }
  });

  it('flies the way the hero faces: LEFT held and FIRE pressed sends it left, and turning round afterwards does not turn the bolt', () => {
    const game = armed(HALL);
    tick(game, 'L');
    tick(game, 'LF');
    expect(game.run.bolt.dir).toBe(-1);

    const x = game.run.bolt.x;
    tick(game, 'R');
    tick(game, 'R');
    expect(game.run.player.facing).toBe(1);
    expect(game.run.bolt.dir).toBe(-1);
    expect(game.run.bolt.x).toBe(x - 2 * P.boltSpeed);
  });

  it('flies level at boltSpeed per tick whatever the hero does next: his run and his jump do not move it', () => {
    const game = armed(HALL);
    tick(game, 'F');
    const { x, y } = game.run.bolt;
    for (let t = 1; t <= 20; t++) {
      tick(game, 'LJ');
      expect(game.run.bolt.x).toBe(x + t * P.boltSpeed);
      expect(game.run.bolt.y).toBe(y);
    }
    expect(game.run.player.y).toBeLessThan(HERO_ROW_Y);
  });

  it('needs the blaster: without it a press makes no bolt', () => {
    const game = playingGame(HALL);
    const events = [...tick(game, 'F'), ...tick(game), ...tick(game)];
    expect(events).toEqual([]);
    expect(game.run.bolt.active).toBe(false);
  });

  it('needs a press: FIRE held down fires one bolt, and no second one when the first is gone', () => {
    const game = armed(HALL);
    const fired: number[] = [];
    for (let t = 1; t <= 150; t++) {
      if (types(tick(game, 'F')).includes('boltFired')) fired.push(t);
    }
    expect(fired).toEqual([1]);
    expect(game.run.bolt.active).toBe(false);
  });

  it('uses the press up: fireBuffer is 0 after the spawn', () => {
    const game = armed(HALL);
    tick(game, 'F');
    expect(game.run.player.fireBuffer).toBe(0);
  });

  it('works without an events array and then leaves exactly the same state', () => {
    // A kill, a press lost during the flight, a shot in mid-air that fizzles, a shot to the left still flying.
    const idle = (n: number): string[] => Array.from({ length: n }, () => '');
    const script = ['F', '', 'R', 'RF', ...idle(20), 'J', 'JF', ...idle(50), 'L', 'LF', ''];
    const loud = armed(MOTH_HALL);
    const quiet = armed(MOTH_HALL);
    for (const game of [loud, quiet]) place(enemyAt(game), 25 * TILE, HERO_ROW_Y);
    const heard: GameEvent[] = [];
    for (const letters of script) {
      heard.push(...tick(loud, letters));
      stepPlayer(quiet, IN(letters));
      stepEnemies(quiet);
      stepBolt(quiet);
    }
    expect(quiet.run).toEqual(loud.run);
    expect(quiet.session).toEqual(loud.session);
    expect(types(heard).filter((type) => type.startsWith('bolt') || type === 'enemyKilled')).toEqual([
      'boltFired',
      'enemyKilled',
      'boltEnded',
      'boltFired',
      'boltEnded',
      'boltFired',
    ]);
    expect(loud.session.score).toBe(P.scoreMoth);
  });
});

// ---------------------------------------------------------------------------
// One at a time, and the fire buffer
// ---------------------------------------------------------------------------

describe('one bolt at a time', () => {
  it('a press while a bolt is in flight makes no second bolt and does not disturb the first', () => {
    const game = armed(HALL);
    const events = tick(game, 'F');
    const bornX = game.run.bolt.x - P.boltSpeed;
    for (let t = 2; t <= 20; t++) events.push(...tick(game, t === 10 ? 'F' : ''));

    expect(types(events)).toEqual(['boltFired']);
    expect(game.run.bolt.x).toBe(bornX + 20 * P.boltSpeed);
    expect(game.run.bolt.rangeLeft).toBe(P.boltRange - 20 * P.boltSpeed);
  });

  it('the slot is free on the tick after a bolt ends: a press then fires at once', () => {
    const game = armed(HALL);
    const shot = fireAndWatch(game);
    expect(shot.hit).toBe('range');
    expect(types(tick(game, 'F'))).toEqual(['boltFired']);
  });
});

describe('fire buffer', () => {
  // In HALL a bolt born on tick 1 ends by range on tick 40, so tick 41 is the first on which the next may be born.
  const NEXT = P.boltRange / P.boltSpeed + 1;

  /** FIRE pressed on tick 1 and again on tick `second`; the ticks on which a bolt was born. */
  function bornTicks(second: number, phys: Phys = P): number[] {
    const game = armed(HALL, phys);
    const born: number[] = [];
    for (let t = 1; t <= 120; t++) {
      if (types(tick(game, t === 1 || t === second ? 'F' : '')).includes('boltFired')) born.push(t);
    }
    return born;
  }

  it('a press with the slot free fires on its own tick', () => {
    expect(bornTicks(60)).toEqual([1, 60]);
  });

  it('a press up to fireBufferTicks ticks before the slot is free fires on the first free tick', () => {
    expect(P.fireBufferTicks).toBe(6);
    for (let early = 0; early <= P.fireBufferTicks; early++) {
      expect(bornTicks(NEXT - early), `pressed ${early} ticks early`).toEqual([1, NEXT]);
    }
  });

  it('a press fireBufferTicks + 1 ticks before the slot is free is forgotten: no second bolt', () => {
    expect(bornTicks(NEXT - P.fireBufferTicks - 1)).toEqual([1]);
  });

  it('with fireBufferTicks 0 a press with the slot free still fires on its own tick, and a press one tick early is lost', () => {
    const phys = referencePhysWith({ blaster: { fireBufferFrames: 0 } });
    expect(bornTicks(NEXT, phys)).toEqual([1, NEXT]);
    expect(bornTicks(NEXT - 1, phys)).toEqual([1]);
  });

  it('the buffer also waits for the blaster: a press up to fireBufferTicks ticks before the hero holds it fires when he does', () => {
    const born = (handedOnTick: number): number[] => {
      const game = playingGame(HALL);
      const ticks: number[] = [];
      for (let t = 1; t <= 30; t++) {
        // Step 14 of the previous tick is where a blaster is picked up.
        if (t === handedOnTick) game.run.player.hasBlaster = true;
        if (types(tick(game, t === 1 ? 'F' : '')).includes('boltFired')) ticks.push(t);
      }
      return ticks;
    };
    expect(born(1 + P.fireBufferTicks)).toEqual([1 + P.fireBufferTicks]);
    expect(born(2 + P.fireBufferTicks)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

describe('range', () => {
  it.each([
    ['right', 1],
    ['left', -1],
  ] as const)(
    'flying %s it lives boltRange / boltSpeed = 40 ticks and fizzles exactly boltRange (160 px) from where it was born',
    (_name, facing) => {
      const game = armed(HALL);
      const p = game.run.player;
      p.facing = facing;
      const bornX = facing > 0 ? p.x + P.heroW - P.boltW : p.x;
      const bornY = p.y + ((P.heroH - P.boltH) >> 1);

      const shot = fireAndWatch(game);
      expect(P.boltRange / P.boltSpeed).toBe(40);
      expect(shot.ticks).toBe(40);
      expect(P.boltRange).toBe(160 * 256);
      expect(game.run.bolt.x).toBe(bornX + facing * P.boltRange);
      expect(shot.events).toEqual([
        { type: 'boltFired', x: bornX + (P.boltW >> 1), y: bornY + (P.boltH >> 1), dir: facing },
        {
          type: 'boltEnded',
          x: bornX + facing * P.boltRange + (P.boltW >> 1),
          y: bornY + (P.boltH >> 1),
          hit: 'range',
        },
      ]);
    },
  );

  it('counts the range down by boltSpeed per tick, from the spawn tick on, and ends the bolt when it reaches 0', () => {
    const game = armed(HALL);
    tick(game, 'F');
    for (let t = 1; t < 40; t++) {
      expect(game.run.bolt.active, `tick ${t}`).toBe(true);
      expect(game.run.bolt.rangeLeft, `tick ${t}`).toBe(P.boltRange - t * P.boltSpeed);
      tick(game);
    }
    expect(game.run.bolt.active).toBe(false);
    expect(game.run.bolt.rangeLeft).toBe(0);
  });

  it('with a range that the speed does not divide, it ends on the first tick the range is used up (162 px at 4 px: tick 41)', () => {
    const phys = referencePhysWith({ blaster: { boltRangePx: 162 } });
    const game = armed(HALL, phys);
    const shot = fireAndWatch(game);
    expect(shot.hit).toBe('range');
    expect(shot.ticks).toBe(41);
    expect(game.run.bolt.rangeLeft).toBeLessThan(0);
  });

  it('after a miss the next bolt is born 40 ticks after the last, however eagerly FIRE is tapped (0.67 s)', () => {
    const game = armed(HALL);
    const born: number[] = [];
    for (let t = 1; t <= 130; t++) {
      // Tap on every odd tick.
      if (types(tick(game, t % 2 === 1 ? 'F' : '')).includes('boltFired')) born.push(t);
    }
    expect(born).toEqual([1, 41, 81, 121]);
  });

  it('reaches an enemy whose body starts 1 sub-pixel inside boltRange of the hero\'s front, and not one that starts at boltRange', () => {
    const inside = armed(MOTH_HALL);
    place(enemyAt(inside), front(inside) + P.boltRange - 1, HERO_ROW_Y);
    const hit = shoot(inside);
    // Wall, enemy, range is the order of the tests, so on the last tick of its range a bolt still kills.
    expect([hit.hit, hit.ticks]).toEqual(['enemy', 40]);
    expect(enemyAt(inside).alive).toBe(false);

    const outside = armed(MOTH_HALL);
    place(enemyAt(outside), front(outside) + P.boltRange, HERO_ROW_Y);
    const miss = shoot(outside);
    expect([miss.hit, miss.ticks]).toEqual(['range', 40]);
    expect(enemyAt(outside).alive).toBe(true);
  });

  it('to the left the reach is the same: boltRange from the hero\'s front', () => {
    const inside = armed(MOTH_HALL);
    inside.run.player.facing = -1;
    place(enemyAt(inside), front(inside) - P.boltRange - ENEMY_SIZE + 1, HERO_ROW_Y);
    expect(shoot(inside).hit).toBe('enemy');

    const outside = armed(MOTH_HALL);
    outside.run.player.facing = -1;
    place(enemyAt(outside), front(outside) - P.boltRange - ENEMY_SIZE, HERO_ROW_Y);
    expect(shoot(outside).hit).toBe('range');
  });
});

// ---------------------------------------------------------------------------
// Walls and everything a bolt ignores
// ---------------------------------------------------------------------------

/** The hero at col 5 between two walls at col 0 and col 10. */
const CELL = levelFromRows(['T.........D', '...........', '#....P....#', '###########']);

describe('walls', () => {
  it('flying right, it ends with "wall" on the first tick its box reaches into a wall, and is reported where it is then', () => {
    const game = armed(CELL);
    const wallLeft = 10 * TILE;
    const events = tick(game, 'F');
    let ticks = 1;
    while (game.run.bolt.active) {
      // Still flying: its right edge has not passed the wall's face.
      expect(game.run.bolt.x + P.boltW).toBeLessThanOrEqual(wallLeft);
      events.push(...tick(game));
      ticks++;
    }
    const bolt = game.run.bolt;
    expect(bolt.x + P.boltW).toBeGreaterThan(wallLeft);
    expect(bolt.x + P.boltW).toBeLessThanOrEqual(wallLeft + P.boltSpeed);
    // The hero's front is 67 px from the wall: 16 ticks cover 64 px, the 17th is the first inside.
    expect(ticks).toBe(17);
    expect(events[events.length - 1]).toEqual({
      type: 'boltEnded',
      x: bolt.x + (P.boltW >> 1),
      y: bolt.y + (P.boltH >> 1),
      hit: 'wall',
    });
  });

  it('flying left, the same: "wall" on the first tick its left edge is inside the wall', () => {
    const game = armed(CELL);
    game.run.player.facing = -1;
    const wallRight = TILE;
    const shot = shoot(game);
    expect([shot.hit, shot.ticks]).toEqual(['wall', 17]);
    expect(game.run.bolt.x).toBeLessThan(wallRight);
    expect(game.run.bolt.x).toBeGreaterThanOrEqual(wallRight - P.boltSpeed);
  });

  it('fired by a hero who stands flush against a wall, it is born and ends on the same tick, and the slot is free for the next press', () => {
    const game = armed(CELL);
    const p = game.run.player;
    p.x = 10 * TILE - P.heroW;

    const first = tick(game, 'F');
    expect(types(first)).toEqual(['boltFired', 'boltEnded']);
    expect(first[1]).toMatchObject({ hit: 'wall' });
    expect(game.run.bolt.active).toBe(false);

    tick(game);
    expect(types(tick(game, 'F'))).toEqual(['boltFired', 'boltEnded']);
  });

  it.each([
    ['right', 1],
    ['left', -1],
  ] as const)(
    'flying %s, a box that ends flush with a wall face is still flying; one sub-pixel further it ends with "wall"',
    (_name, facing) => {
      /** Places the hero so that after 3 moves the bolt's front is `past` sub-pixels beyond the face of the wall it flies at. */
      const shotWithFrontPast = (past: number): Shot => {
        const game = armed(CELL);
        const p = game.run.player;
        p.facing = facing;
        // The walls of CELL: col 10 (face at 10 * TILE) on the right, col 0 (face at TILE) on the left.
        if (facing > 0) p.x = 10 * TILE - 3 * P.boltSpeed - P.heroW + past;
        else p.x = TILE + 3 * P.boltSpeed - past;
        return shoot(game);
      };
      expect(shotWithFrontPast(0)).toMatchObject({ hit: 'wall', ticks: 4 });
      expect(shotWithFrontPast(1)).toMatchObject({ hit: 'wall', ticks: 3 });
    },
  );

  it('a bolt skims a block above or below its line when its box only touches the block\'s face, and hits it one sub-pixel closer', () => {
    // Blocks at col 5, row 1 (an overhang) and col 5, row 3 (a step on the floor). The hero hangs in mid-air
    // at col 2 wherever the test puts him; the right edge of the grid ends every bolt that gets past col 5.
    const level = levelFromRows(['T.........D', '.....#.....', '...........', '..P..#.....', '###########']);
    // Also on DISTINCT_PHYS, where boltH differs from every other field (at the reference it equals coolantInsetTop).
    for (const phys of [P, DISTINCT_PHYS]) {
      /** Fires with the bolt's top at `boltY`; true when it got past the blocks, false when it hit one. */
      const passes = (boltY: number): boolean => {
        const game = armed(level, phys);
        const p = game.run.player;
        p.y = boltY - ((phys.heroH - phys.boltH) >> 1);
        p.onGround = false;
        const shot = shoot(game);
        expect(shot.hit).toBe('wall');
        if (game.run.bolt.x + phys.boltW > level.width * TILE) return true;
        // Otherwise it must have stopped at the face of col 5.
        expect(game.run.bolt.x + phys.boltW).toBeGreaterThan(5 * TILE);
        expect(game.run.bolt.x + phys.boltW).toBeLessThanOrEqual(5 * TILE + phys.boltSpeed);
        return false;
      };
      // The top of the box flush with the bottom of the overhang, then one sub-pixel into its row.
      expect(passes(2 * TILE)).toBe(true);
      expect(passes(2 * TILE - 1)).toBe(false);
      // The bottom of the box flush with the top of the step, then one sub-pixel into its row.
      expect(passes(3 * TILE - phys.boltH)).toBe(true);
      expect(passes(3 * TILE - phys.boltH + 1)).toBe(false);
    }
  });

  it('the left and right edges of the grid are walls for a bolt too', () => {
    const level = levelFromRows(['T.....D', '.......', '.P.....', '#######']);
    for (const facing of [-1, 1] as const) {
      const game = armed(level);
      game.run.player.facing = facing;
      const shot = shoot(game);
      expect(shot.hit).toBe('wall');
      const bolt = game.run.bolt;
      if (facing < 0) expect(bolt.x).toBeLessThan(0);
      else expect(bolt.x + P.boltW).toBeGreaterThan(level.width * TILE);
    }
  });

  it('passes through hazards, pickups, the cog and the door: only walls, enemies and its range end it', () => {
    // Everything a bolt must ignore, in its row: crystal, blaster, pack, fire, coolant, spikes, cog, door.
    const game = armed(levelFromRows(['....................', '.P.GBJFWSTD.........', '####################']));
    const shot = shoot(game);
    expect([shot.hit, shot.ticks]).toEqual(['range', 40]);
    expect(types(shot.events)).toEqual(['boltFired', 'boltEnded']);
    expect(game.run.taken).toEqual([false, false, false]);
    expect(game.run.hasTrophy).toBe(false);
    expect(game.session.score).toBe(0);
  });

  it('a wall wins over an enemy met on the same tick: the enemy lives and nothing is paid', () => {
    // A block hangs at col 6, row 1; a moth is put right under it. The hero is in mid-jump, so his bolt
    // straddles rows 1 and 2 and reaches the block and the moth on one and the same tick.
    const game = armed(levelFromRows(['T........HD', '......#....', '..P........', '###########']));
    const p = game.run.player;
    p.y = 2 * TILE - (P.heroH >> 1);
    place(enemyAt(game), 6 * TILE, 2 * TILE);

    const shot = shoot(game);
    const bolt = game.run.bolt;
    expect(bolt.y).toBeLessThan(2 * TILE);
    expect(bolt.y + P.boltH).toBeGreaterThan(2 * TILE);
    expect(bolt.x + P.boltW).toBeGreaterThan(6 * TILE);
    expect(shot.hit).toBe('wall');
    expect(types(shot.events)).toEqual(['boltFired', 'boltEnded']);
    expect(enemyAt(game).alive).toBe(true);
    expect(game.session.score).toBe(0);
  });

  it('a wall wins over the end of the range on the same tick', () => {
    // The hero's front is put 1 px short of a tile line, with a wall 10 tiles on: tick 40 is both the last
    // tick of the range and the first tick inside the wall.
    const level = levelFromRows(['T' + '.'.repeat(14) + 'D', '.'.repeat(16), '..P.........#...', '#'.repeat(16)]);
    const game = armed(level);
    const p = game.run.player;
    p.x = 2 * TILE + 256 - P.heroW;
    expect(front(game) + P.boltRange).toBe(12 * TILE + 256);

    const shot = shoot(game);
    expect([shot.hit, shot.ticks]).toEqual(['wall', 40]);
    expect(game.run.bolt.rangeLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Kills
// ---------------------------------------------------------------------------

describe('kills', () => {
  it('destroys a Cinderpeg walking toward the hero on the first tick their boxes overlap: 50 points, enemyKilled then boltEnded', () => {
    const game = armed(levelFromRows(['T...............D', '.................', '..P.........C....', '#################']));
    const c = enemyAt(game);
    const shot = fireAndWatch(game);

    // The gap between the hero's front and the Cinderpeg is 147 px and closes by 4.5 px per tick: tick 33.
    expect(shot.ticks).toBe(33);
    expect(c.alive).toBe(false);
    expect(c.x).toBe(12 * TILE - 33 * P.cinderpegSpeed);
    expect(game.session.score).toBe(P.scoreCinderpeg);
    expect(P.scoreCinderpeg).toBe(50);
    expect(game.run.enemyPaid).toEqual([true]);
    const bolt = game.run.bolt;
    expect(bolt.active).toBe(false);
    expect(shot.events.slice(1)).toEqual([
      {
        type: 'enemyKilled',
        index: 0,
        kind: 'cinderpeg',
        x: c.x + (ENEMY_SIZE >> 1),
        y: c.y + (ENEMY_SIZE >> 1),
        score: 50,
      },
      { type: 'boltEnded', x: bolt.x + (P.boltW >> 1), y: bolt.y + (P.boltH >> 1), hit: 'enemy' },
    ]);
  });

  it('destroys an Arc Moth for 100 points', () => {
    const game = armed(levelFromRows(['T...............D', '.................', '..P.........H....', '#################']));
    const shot = fireAndWatch(game);
    expect(shot.hit).toBe('enemy');
    expect(enemyAt(game).alive).toBe(false);
    expect(game.session.score).toBe(P.scoreMoth);
    expect(P.scoreMoth).toBe(100);
    expect(shot.events[1]).toMatchObject({ type: 'enemyKilled', index: 0, kind: 'moth', score: 100 });
  });

  it('a destroyed enemy stays where it fell and no longer stops bolts', () => {
    const game = armed(levelFromRows(['T...............D', '.................', '..P.........C....', '#################']));
    fireAndWatch(game);
    const c = enemyAt(game);
    const where = { ...c };

    const second = fireAndWatch(game);
    expect(second.hit).toBe('range');
    expect(c).toEqual(where);
    expect(game.session.score).toBe(P.scoreCinderpeg);
  });

  it('moves on its spawn tick, so an enemy right in front of the hero is destroyed on the tick of the press', () => {
    const game = armed(MOTH_HALL);
    // The body starts just inside the bolt's first step.
    place(enemyAt(game), front(game) + P.boltSpeed - 1, HERO_ROW_Y);
    const shot = shoot(game);
    expect([shot.hit, shot.ticks]).toEqual(['enemy', 1]);
    expect(types(shot.events)).toEqual(['boltFired', 'enemyKilled', 'boltEnded']);

    // One sub-pixel further away and the first step falls short: it takes the second tick.
    const next = armed(MOTH_HALL);
    place(enemyAt(next), front(next) + P.boltSpeed, HERO_ROW_Y);
    expect(shoot(next).ticks).toBe(2);
  });

  it('a point-blank shot saves the hero: steps 12 and 13 run before step 17, so the enemy dies before its touch can kill', () => {
    // A moth flies at the hero; this tick's move brings its touch box 1 sub-pixel into his hurt box.
    const setUp = (): GameState => {
      const game = armed(MOTH_HALL);
      const p = game.run.player;
      const touching = p.x + P.heroW - P.hurtInsetSide - P.enemyTouchInset - 1;
      place(enemyAt(game), touching + P.mothSpeed, HERO_ROW_Y);
      return game;
    };

    const idle = setUp();
    tick(idle);
    resolveContacts(idle);
    expect(idle.run.phase).toBe('dying');
    expect(idle.run.deathCause).toBe('enemy');

    const firing = setUp();
    const events = tick(firing, 'F');
    resolveContacts(firing, events);
    expect(types(events)).toEqual(['boltFired', 'enemyKilled', 'boltEnded']);
    expect(firing.run.phase).toBe('playing');
    expect(enemyAt(firing).alive).toBe(false);
  });

  it('tests the whole one-tile body, not the smaller touch box: 1 sub-pixel of the body in the bolt\'s path is enough, above or below', () => {
    // Also on DISTINCT_PHYS, where boltH differs from every other field (at the reference it equals coolantInsetTop).
    for (const phys of [P, DISTINCT_PHYS]) {
      const boltTop = (game: GameState): number => game.run.player.y + ((phys.heroH - phys.boltH) >> 1);
      const ahead = (game: GameState): number => front(game) + 3 * TILE;
      const shotAt = (y: (game: GameState) => number): Shot => {
        const game = armed(MOTH_HALL, phys);
        place(enemyAt(game), ahead(game), y(game));
        return shoot(game);
      };

      // A moth above the line of fire: its bottom sub-pixel row is in the bolt's box, or just clear of it.
      expect(shotAt((g) => boltTop(g) + 1 - ENEMY_SIZE).hit).toBe('enemy');
      expect(shotAt((g) => boltTop(g) - ENEMY_SIZE).hit).toBe('range');
      // A moth below it: its top sub-pixel row is in the bolt's box, or just clear of it.
      expect(shotAt((g) => boltTop(g) + phys.boltH - 1).hit).toBe('enemy');
      expect(shotAt((g) => boltTop(g) + phys.boltH).hit).toBe('range');
    }
  });

  it('when two enemies are in its box on the same tick, only the one with the lower index is destroyed', () => {
    const game = armed(MOTH_HALL);
    place(enemyAt(game, 0), front(game) + 3 * TILE, HERO_ROW_Y);
    place(enemyAt(game, 1), front(game) + 3 * TILE, HERO_ROW_Y);
    const shot = shoot(game);
    expect(shot.events.filter((e) => e.type === 'enemyKilled')).toHaveLength(1);
    expect(shot.events[1]).toMatchObject({ type: 'enemyKilled', index: 0 });
    expect([enemyAt(game, 0).alive, enemyAt(game, 1).alive]).toEqual([false, true]);
    expect(game.session.score).toBe(P.scoreMoth);

    // The lower index wins even when the other enemy is the nearer one. (Less than one bolt step
    // nearer, so that the bolt's step into the near one also reaches the far one.)
    const swapped = armed(MOTH_HALL);
    place(enemyAt(swapped, 1), front(swapped) + 3 * TILE, HERO_ROW_Y);
    place(enemyAt(swapped, 0), front(swapped) + 3 * TILE + P.boltSpeed - 1, HERO_ROW_Y);
    shoot(swapped);
    expect([enemyAt(swapped, 0).alive, enemyAt(swapped, 1).alive]).toEqual([false, true]);
  });

  it('flies through a destroyed enemy and hits the live one behind it', () => {
    const game = armed(MOTH_HALL);
    place(enemyAt(game, 0), front(game) + 2 * TILE, HERO_ROW_Y);
    place(enemyAt(game, 1), front(game) + 5 * TILE, HERO_ROW_Y);
    enemyAt(game, 0).alive = false;
    const shot = shoot(game);
    expect(shot.events[1]).toMatchObject({ type: 'enemyKilled', index: 1 });
    expect([enemyAt(game, 0).alive, enemyAt(game, 1).alive]).toEqual([false, false]);
  });

  it.each([
    ['toward the hero', -1],
    ['away from the hero', 1],
  ] as const)(
    'never skips over a moth flying %s, at any sub-pixel alignment of the two',
    (_name, dir) => {
      // One alignment for every sub-pixel of the distance the two close in (or the bolt gains) per tick.
      const alignments = P.boltSpeed + P.mothSpeed;
      for (let offset = 0; offset < alignments; offset++) {
        const game = armed(MOTH_HALL);
        const moth = enemyAt(game);
        place(moth, front(game) + 4 * TILE + offset, HERO_ROW_Y, dir);
        game.run.player.fireBuffer = 1;
        let hit: string | null = null;
        for (let t = 0; t < 60 && hit === null; t++) {
          const events: GameEvent[] = [];
          stepEnemies(game);
          stepBolt(game, events);
          hit = events.find((e) => e.type === 'boltEnded')?.hit ?? null;
        }
        if (hit !== 'enemy') throw new Error(`offset ${offset}: the bolt ended with ${String(hit)}`);
      }
    },
  );

  it('does not skip over an enemy at the fastest speeds the tuning allows (bolt and moth just under 8 px per tick, bolt 1 px wide)', () => {
    const phys = referencePhysWith({
      blaster: { boltSpeed: 7.99609375, boltHitboxW: 1, boltRangePx: 300 },
      enemies: { mothSpeed: 7.99609375 },
    });
    for (let offset = 0; offset < phys.boltSpeed + phys.mothSpeed; offset += 7) {
      const game = armed(MOTH_HALL, phys);
      place(enemyAt(game), front(game) + 6 * TILE + offset, HERO_ROW_Y, -1);
      game.run.player.fireBuffer = 1;
      for (let t = 0; t < 40 && enemyAt(game).alive; t++) {
        stepEnemies(game);
        stepBolt(game);
      }
      if (enemyAt(game).alive) throw new Error(`offset ${offset}: the bolt passed the moth`);
    }
  });
});

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

/** The Cinderpeg (enemy 1 in reading order) patrols in front of the hero; the moth (enemy 0) hovers out of the way until a test moves it. */
const TWO_FOES = levelFromRows(['T..............HD', '.................', '..P.........C....', '#################']);

describe('the bolt reads each number from its own Phys field (DISTINCT_PHYS, where no two fields are equal)', () => {
  // At the reference numbers boltW = spikeInsetTop (8 px), boltH = coolantInsetTop (6 px), boltSpeed equals maxFall,
  // cornerNudge, fireInsetTop and doorInsetSide (4 px), and scoreMoth = scoreCog (100): the tests above cannot tell
  // those fields apart.
  const D = DISTINCT_PHYS;

  it.each([
    ['right', 1],
    ['left', -1],
  ] as const)('facing %s: born inside the hero with a box of boltW by boltH, moved boltSpeed on the spawn tick, boltRange to go', (_name, facing) => {
    const game = armed(HALL, D);
    const p = game.run.player;
    p.facing = facing;
    const events = tick(game, 'F');

    const bornX = facing > 0 ? p.x + D.heroW - D.boltW : p.x;
    const bornY = p.y + ((D.heroH - D.boltH) >> 1);
    expect(game.run.bolt).toEqual({
      active: true,
      x: bornX + facing * D.boltSpeed,
      y: bornY,
      dir: facing,
      rangeLeft: D.boltRange - D.boltSpeed,
    });
    expect(events).toEqual([{ type: 'boltFired', x: bornX + (D.boltW >> 1), y: bornY + (D.boltH >> 1), dir: facing }]);
  });

  it('lives boltRange / boltSpeed ticks, rounded up, and is reported at the centre of its box where it fizzles', () => {
    const game = armed(HALL, D);
    const p = game.run.player;
    const bornX = p.x + D.heroW - D.boltW;
    const bornY = p.y + ((D.heroH - D.boltH) >> 1);
    const ticks = Math.ceil(D.boltRange / D.boltSpeed);
    expect(ticks).toBe(40);

    const shot = fireAndWatch(game);
    expect(shot.ticks).toBe(ticks);
    expect(shot.events.at(-1)).toEqual({
      type: 'boltEnded',
      x: bornX + ticks * D.boltSpeed + (D.boltW >> 1),
      y: bornY + (D.boltH >> 1),
      hit: 'range',
    });
  });

  it('its front edge flush with a wall face is no hit; the next move is', () => {
    // A wall at col 12; the hero placed so that the bolt's front reaches the wall face after exactly 2 moves.
    const level = levelFromRows(['T..........#D', '...........#.', '..P........#.', '#############']);
    const game = armed(level, D);
    const p = game.run.player;
    p.x = 11 * TILE - D.heroW - 2 * D.boltSpeed;
    const shot = shoot(game);
    expect(shot.hit).toBe('wall');
    expect(shot.ticks).toBe(3);
  });

  it('its front edge flush with an enemy body is no hit; the next move is', () => {
    const game = armed(MOTH_HALL, D);
    const p = game.run.player;
    place(enemyAt(game), front(game) + 2 * D.boltSpeed, p.y);
    const shot = shoot(game);
    expect(shot.hit).toBe('enemy');
    expect(shot.ticks).toBe(3);
  });

  it('pays scoreCinderpeg for a Cinderpeg and scoreMoth for an Arc Moth', () => {
    const peg = armed(levelFromRows(['T...............D', '.................', '..P.........C....', '#################']), D);
    fireAndWatch(peg);
    expect(peg.session.score).toBe(D.scoreCinderpeg);

    const moth = armed(levelFromRows(['T...............D', '.................', '..P.........H....', '#################']), D);
    fireAndWatch(moth);
    expect(moth.session.score).toBe(D.scoreMoth);
  });
});

describe('score', () => {
  it('pays each enemy once per level visit: destroyed again after a respawn it pays 0, and the event says so', () => {
    const game = armed(TWO_FOES);
    const first = fireAndWatch(game);
    expect(first.events[1]).toMatchObject({ type: 'enemyKilled', index: 1, kind: 'cinderpeg', score: 50 });
    expect(game.session.score).toBe(50);
    expect(game.run.enemyPaid).toEqual([false, true]);

    // The hero dies; the Cinderpeg is back on its cell, and the blaster has to be found again.
    respawnRun(game.run, game.level, P, P.respawnReadyTicks);
    game.run.phase = 'playing';
    expect(enemyAt(game, 1)).toMatchObject({ x: 12 * TILE, alive: true });
    game.run.player.hasBlaster = true;

    const second = fireAndWatch(game);
    expect(second.events[1]).toMatchObject({ type: 'enemyKilled', index: 1, kind: 'cinderpeg', score: 0 });
    expect(enemyAt(game, 1).alive).toBe(false);
    expect(game.session.score).toBe(50);
    expect(game.run.enemyPaid).toEqual([false, true]);
  });

  it('pays again on a new visit of the level', () => {
    const game = armed(TWO_FOES);
    fireAndWatch(game);
    expect(game.session.score).toBe(50);

    // What startLevel does: a fresh run, nothing paid yet.
    game.run = createRun(game.level, P);
    game.run.phase = 'playing';
    game.run.player.hasBlaster = true;
    const again = fireAndWatch(game);
    expect(again.events[1]).toMatchObject({ type: 'enemyKilled', score: 50 });
    expect(game.session.score).toBe(100);
  });

  it('keeps a separate account for every enemy: one that was never destroyed still pays in full after a respawn', () => {
    const game = armed(TWO_FOES);
    fireAndWatch(game);
    respawnRun(game.run, game.level, P, P.respawnReadyTicks);
    game.run.phase = 'playing';
    game.run.player.hasBlaster = true;

    // This life the moth is the one in the line of fire.
    enemyAt(game, 1).alive = false;
    place(enemyAt(game, 0), front(game) + 2 * TILE, HERO_ROW_Y);
    const shot = shoot(game);
    expect(shot.events[1]).toMatchObject({ type: 'enemyKilled', index: 0, kind: 'moth', score: 100 });
    expect(game.session.score).toBe(150);
    expect(game.run.enemyPaid).toEqual([true, true]);
  });

  it('a bolt that hits a wall or fizzles pays nothing', () => {
    const game = armed(CELL);
    shoot(game);
    expect(game.session.score).toBe(0);
    const open = armed(HALL);
    shoot(open);
    expect(open.session.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// After a death
// ---------------------------------------------------------------------------

describe('after a respawn', () => {
  it('the bolt in flight is gone, and the next one starts from scratch: full range, born at the hero', () => {
    const game = armed(HALL);
    tick(game, 'L');
    tick(game, 'LF');
    for (let t = 0; t < 10; t++) tick(game, 'L');
    expect(game.run.bolt.active).toBe(true);

    respawnRun(game.run, game.level, P, P.respawnReadyTicks);
    game.run.phase = 'playing';
    expect(game.run.bolt.active).toBe(false);
    // Nothing flies on while the slot is empty.
    const stale = { ...game.run.bolt };
    tick(game);
    expect(game.run.bolt).toEqual(stale);

    game.run.player.hasBlaster = true;
    const p = game.run.player;
    tick(game, 'F');
    expect(game.run.bolt).toEqual({
      active: true,
      x: p.x + P.heroW - P.boltW + P.boltSpeed,
      y: p.y + ((P.heroH - P.boltH) >> 1),
      dir: 1,
      rangeLeft: P.boltRange - P.boltSpeed,
    });
  });
});
