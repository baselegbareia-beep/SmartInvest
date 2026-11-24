/**
 * The two enemies: step 12 of the tick (docs/ARCHITECTURE.md, section 5.6).
 *
 * Neither enemy notices the hero, gravity or the other enemies. Each keeps to
 * one straight line and turns round where the line ends, so its position
 * depends on nothing but the number of playing ticks since it was put on its
 * cell. That is what lets a player learn its rhythm and the level validator
 * predict it. Whether a touch kills the hero is decided later in the tick
 * (step 17, contact.ts); whether a bolt destroys it, in step 13 (bolt.ts).
 *
 * An enemy never stops flush "by force": when the next move would put its
 * leading edge into a cell it may not enter, it turns round and stays where
 * it is for that tick. With a speed that does not divide a tile it therefore
 * turns a little short of the obstacle, never inside it.
 */
import * as tilesModule from './tiles';
import * as units from './types';
import type { EnemyState, LevelData, StepEnemiesFn } from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { tileAt } = tilesModule;
const { ENEMY_SIZE, Tile, TILE_SHIFT } = units;

/**
 * The column (or row) that the front of the body would be in after moving to
 * `next`: the left or top edge when heading that way, otherwise the last
 * sub-pixel of the body. Speeds are below half a tile (compileTuning), so
 * the front enters at most one new cell per tick and looking at this one
 * cell is enough.
 */
function leadingCell(next: number, dir: number): number {
  return (dir > 0 ? next + ENEMY_SIZE - 1 : next) >> TILE_SHIFT;
}

/** Turn round. Written as a choice, not as a negation, so the result stays one of the two Facing values. */
function turnRound(enemy: EnemyState): void {
  enemy.dir = enemy.dir > 0 ? -1 : 1;
}

/**
 * A Cinderpeg walks: its leading foot may enter a cell only if the cell is
 * open and has a wall for a floor. Anything else turns it round: a wall, a
 * hazard in its way, a hazard or a hole where the floor should be, and the
 * left and right edges of the grid (which tileAt reports as walls).
 */
function cinderpegBlocked(level: LevelData, col: number, row: number): boolean {
  return tileAt(level, col, row) !== Tile.Empty || tileAt(level, col, row + 1) !== Tile.Solid;
}

/**
 * An Arc Moth flies: it needs no floor, only an open cell inside the grid.
 * tileAt already reports the cells left of, right of and above the grid as
 * walls. Below the grid it reports open air, because that is where the hero
 * falls out; a moth must not follow, so the bottom edge is closed here.
 */
function mothBlocked(level: LevelData, col: number, row: number): boolean {
  return row >= level.height || tileAt(level, col, row) !== Tile.Empty;
}

export const stepEnemies: StepEnemiesFn = (game) => {
  const level = game.level;
  const P = game.phys;
  const enemies = game.run.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    // A destroyed enemy stays where it fell until a respawn puts it back on its cell.
    if (enemy === undefined || !enemy.alive) continue;

    if (enemy.kind === 'cinderpeg') {
      // Its row never changes: it is not subject to gravity and never steps off its floor.
      const next = enemy.x + enemy.dir * P.cinderpegSpeed;
      if (cinderpegBlocked(level, leadingCell(next, enemy.dir), enemy.y >> TILE_SHIFT)) turnRound(enemy);
      else enemy.x = next;
    } else if (enemy.axis === 'h') {
      const next = enemy.x + enemy.dir * P.mothSpeed;
      if (mothBlocked(level, leadingCell(next, enemy.dir), enemy.y >> TILE_SHIFT)) turnRound(enemy);
      else enemy.x = next;
    } else {
      const next = enemy.y + enemy.dir * P.mothSpeed;
      if (mothBlocked(level, enemy.x >> TILE_SHIFT, leadingCell(next, enemy.dir))) turnRound(enemy);
      else enemy.y = next;
    }
  }
};
