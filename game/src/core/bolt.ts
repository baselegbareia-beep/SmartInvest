/**
 * The blaster's bolt: step 13 of the tick (docs/ARCHITECTURE.md, section 5.7).
 *
 * There is one bolt slot. A fire press is turned into player.fireBuffer by
 * stepPlayer (step 4) earlier in the same tick; here the buffer becomes a
 * bolt as soon as the hero holds the blaster and the slot is free, so a press
 * made just before the old bolt dies still fires.
 *
 * The bolt moves on the tick it is born. Together with the place of this
 * step in the tick (after the enemies have moved, before any death is
 * decided) that means a shot at point-blank range destroys an enemy before
 * the enemy can kill.
 */
import * as tilesModule from './tiles';
import * as units from './types';
import type { BoltState, GameEvent, Phys, StepBoltFn } from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { boxHitsSolid } = tilesModule;
const { ENEMY_SIZE } = units;

/** Ends the bolt and reports where: the centre of its box as it is now. */
function endBolt(bolt: BoltState, P: Phys, hit: 'wall' | 'enemy' | 'range', events: GameEvent[] | undefined): void {
  bolt.active = false;
  events?.push({ type: 'boltEnded', x: bolt.x + (P.boltW >> 1), y: bolt.y + (P.boltH >> 1), hit });
}

export const stepBolt: StepBoltFn = (game, events) => {
  const P = game.phys;
  const run = game.run;
  const player = run.player;
  const bolt = run.bolt;

  // Spawn. The bolt starts inside the hero's box, flush with the side the
  // hero faces and centred on the body's height, so it can never start inside
  // a wall: whatever the hero stands against is met by the move below.
  if (player.fireBuffer > 0 && player.hasBlaster && !bolt.active) {
    bolt.dir = player.facing;
    bolt.x = player.facing > 0 ? player.x + P.heroW - P.boltW : player.x;
    bolt.y = player.y + ((P.heroH - P.boltH) >> 1);
    bolt.rangeLeft = P.boltRange;
    bolt.active = true;
    // The press is used up: one press, one bolt.
    player.fireBuffer = 0;
    events?.push({ type: 'boltFired', x: bolt.x + (P.boltW >> 1), y: bolt.y + (P.boltH >> 1), dir: bolt.dir });
  }
  if (!bolt.active) return;

  // Move, also on the spawn tick.
  bolt.x += bolt.dir * P.boltSpeed;
  bolt.rangeLeft -= P.boltSpeed;

  // What ends it, first match wins: a wall, then an enemy, then the end of its range.
  // 1. Walls come first, so a bolt never reaches an enemy through the corner of a wall.
  if (boxHitsSolid(game.level, bolt.x, bolt.y, P.boltW, P.boltH)) {
    endBolt(bolt, P, 'wall', events);
    return;
  }

  // 2. The first live enemy in index order. The whole one-tile body counts
  //    (the hero is only killed by the smaller touch box), so shooting is
  //    more generous than being touched. compileTuning guarantees that bolt
  //    and enemy close in on each other by less than their combined width
  //    per tick, so a bolt never skips over an enemy that moves along its
  //    line. (A vertical moth can still slip past the corner of the bolt box
  //    between two ticks, like anything that is looked at once per tick.)
  const left = bolt.x;
  const right = left + P.boltW;
  const top = bolt.y;
  const bottom = top + P.boltH;
  const enemies = run.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy === undefined || !enemy.alive) continue;
    if (left < enemy.x + ENEMY_SIZE && enemy.x < right && top < enemy.y + ENEMY_SIZE && enemy.y < bottom) {
      enemy.alive = false;
      // An enemy pays once per level visit. It comes back after a death, and
      // is then worth nothing, so dying on purpose earns no points.
      const value = enemy.kind === 'cinderpeg' ? P.scoreCinderpeg : P.scoreMoth;
      const points = run.enemyPaid[i] === true ? 0 : value;
      run.enemyPaid[i] = true;
      game.session.score += points;
      events?.push({
        type: 'enemyKilled',
        index: i,
        kind: enemy.kind,
        x: enemy.x + (ENEMY_SIZE >> 1),
        y: enemy.y + (ENEMY_SIZE >> 1),
        score: points,
      });
      endBolt(bolt, P, 'enemy', events);
      return;
    }
  }

  // 3. Out of range: it fizzles where it is.
  if (bolt.rangeLeft <= 0) endBolt(bolt, P, 'range', events);
};
