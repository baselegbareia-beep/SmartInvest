/**
 * What the hero touches: steps 14 to 17 of the tick (docs/ARCHITECTURE.md,
 * sections 5.4, 5.5 and 6). The order is the contract:
 *
 *   14 pickups, 15 the golden cog, 16 the airlock, 17 deaths.
 *
 * Good things come first on purpose. A hero who reaches a crystal, the cog
 * or the open airlock on the very tick something kills him keeps the crystal,
 * the cog and the win.
 *
 * Called once per playing tick, tens of millions of times by the level
 * validator, so nothing here allocates unless an event is being reported to a
 * caller that asked for events.
 */
import * as units from './types';
import type { Cell, DeathCause, GameEvent, GameState, ResolveContactsFn } from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { ENEMY_SIZE, Tile, TILE, TILE_SHIFT } = units;

/** Two half-open boxes overlap when each starts before the other ends, on both axes. */
function boxesOverlap(
  aLeft: number,
  aTop: number,
  aRight: number,
  aBottom: number,
  bLeft: number,
  bTop: number,
  bRight: number,
  bBottom: number,
): boolean {
  return aLeft < bRight && bLeft < aRight && aTop < bBottom && bTop < aBottom;
}

/** The middle of a cell, in sub-pixels: where the effects of a pickup, the cog and the door belong. */
function cellCentreX(cell: Cell): number {
  return cell.col * TILE + (TILE >> 1);
}
function cellCentreY(cell: Cell): number {
  return cell.row * TILE + (TILE >> 1);
}

/**
 * Step 16, the hero is inside the open airlock: the level is cleared here and
 * now (score, the life back, the next level unlocked), and the world freezes
 * for the exiting phase. game.ts loads the next level when that phase is over.
 */
function startExit(game: GameState, events: GameEvent[] | undefined): void {
  const P = game.phys;
  const session = game.session;
  const run = game.run;
  const p = run.player;

  const last = session.levelIndex === game.levels.length - 1;
  session.score += P.scoreLevelClear;
  // The life comes back now, also on the last level, so it counts for the win bonus.
  session.lives = Math.min(session.lives + P.livesPerLevelClear, P.maxLives);
  session.highestUnlocked = Math.max(session.highestUnlocked, last ? session.levelIndex : session.levelIndex + 1);

  run.phase = 'exiting';
  run.phaseTicks = 0;
  run.phaseLength = P.exitTicks;

  if (p.thrusting) {
    p.thrusting = false;
    events?.push({ type: 'thrustStopped' });
  }
  events?.push({
    type: 'levelCompleted',
    levelIndex: session.levelIndex,
    last,
    bonus: P.scoreLevelClear,
    score: session.score,
    lives: session.lives,
    highestUnlocked: session.highestUnlocked,
  });
}

/**
 * Step 17, first match wins: hazard tiles, then falling out of the level,
 * then an enemy. Everything dangerous is tested against the hurt box, which
 * is smaller than the body, so a graze is forgiven.
 */
function findDeath(game: GameState): DeathCause | null {
  const P = game.phys;
  const level = game.level;
  const p = game.run.player;

  const hurtLeft = p.x + P.hurtInsetSide;
  const hurtRight = p.x + P.heroW - P.hurtInsetSide;
  const hurtTop = p.y + P.hurtInsetTop;
  const hurtBottom = p.y + P.heroH - P.hurtInsetBottom;

  // 1. Hazard tiles under the hurt box, rows top to bottom, columns left to
  // right. Cells outside the grid are wall or open air, never a hazard, so
  // the scan stays inside it.
  const width = level.width;
  const tiles = level.tiles;
  const colFirst = Math.max(hurtLeft >> TILE_SHIFT, 0);
  const colLast = Math.min((hurtRight - 1) >> TILE_SHIFT, width - 1);
  const rowFirst = Math.max(hurtTop >> TILE_SHIFT, 0);
  const rowLast = Math.min((hurtBottom - 1) >> TILE_SHIFT, level.height - 1);
  for (let row = rowFirst; row <= rowLast; row++) {
    const cellTop = row * TILE;
    for (let col = colFirst; col <= colLast; col++) {
      const kind = tiles[row * width + col];
      // The common case, tested first: nothing dangerous in this cell.
      if (kind === Tile.Empty || kind === Tile.Solid) continue;

      // Each hazard kills through a box that is smaller than its cell: narrower
      // (not coolant, which fills its basin) and lower at the top.
      const cellLeft = col * TILE;
      let cause: DeathCause;
      let insetSide: number;
      let insetTop: number;
      if (kind === Tile.Spikes) {
        cause = 'spikes';
        insetSide = P.spikeInsetSide;
        insetTop = P.spikeInsetTop;
      } else if (kind === Tile.Fire) {
        cause = 'fire';
        insetSide = P.fireInsetSide;
        insetTop = P.fireInsetTop;
      } else if (kind === Tile.Coolant) {
        cause = 'coolant';
        insetSide = 0;
        insetTop = P.coolantInsetTop;
      } else {
        continue;
      }
      if (
        boxesOverlap(
          hurtLeft,
          hurtTop,
          hurtRight,
          hurtBottom,
          cellLeft + insetSide,
          cellTop + insetTop,
          cellLeft + TILE - insetSide,
          cellTop + TILE,
        )
      ) {
        return cause;
      }
    }
  }

  // 2. Falling out: the whole body has passed the bottom edge of the level.
  if (p.y >= level.height * TILE) return 'fell';

  // 3. Enemies, in index order. Their touch box is the one-tile body shrunk on
  // all four sides; there is no stomping, every side kills.
  const inset = P.enemyTouchInset;
  const enemies = game.run.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy === undefined || !enemy.alive) continue;
    if (
      boxesOverlap(
        hurtLeft,
        hurtTop,
        hurtRight,
        hurtBottom,
        enemy.x + inset,
        enemy.y + inset,
        enemy.x + ENEMY_SIZE - inset,
        enemy.y + ENEMY_SIZE - inset,
      )
    ) {
      return 'enemy';
    }
  }

  return null;
}

/**
 * The hero is killed: the world freezes for the dying phase. The life itself
 * is taken by game.ts when that phase ends; the event already says how many
 * will be left, so that quitting during the animation cannot save the life.
 */
function startDying(game: GameState, cause: DeathCause, events: GameEvent[] | undefined): void {
  const P = game.phys;
  const run = game.run;
  const p = run.player;

  run.phase = 'dying';
  run.phaseTicks = 0;
  run.phaseLength = P.dyingTicks;
  run.deathCause = cause;

  if (p.thrusting) {
    p.thrusting = false;
    events?.push({ type: 'thrustStopped' });
  }
  events?.push({
    type: 'playerDied',
    cause,
    x: p.x + (P.heroW >> 1),
    y: p.y + (P.heroH >> 1),
    livesAfter: game.session.lives - 1,
    score: game.session.score,
  });
}

export const resolveContacts: ResolveContactsFn = (game, events) => {
  const P = game.phys;
  const level = game.level;
  const run = game.run;
  const session = game.session;
  const p = run.player;

  // The hero's whole body, [left, right) by [top, bottom): pickups, the cog and the door test against it.
  const left = p.x;
  const top = p.y;
  const right = p.x + P.heroW;
  const bottom = p.y + P.heroH;

  // A pickup's box is its cell grown by the outset on all four sides. The
  // body overlaps the box of cell (c, r) exactly when c lies in
  // [reachColFirst, reachColLast] and r in [reachRowFirst, reachRowLast]:
  //   c * TILE - outset < right        <=>  c <= (right + outset - 1) >> TILE_SHIFT
  //   left < (c + 1) * TILE + outset   <=>  c >= (left - outset) >> TILE_SHIFT
  // Working the four cell numbers out once keeps the loop over every pickup
  // of the level down to four comparisons each.
  const outset = P.pickupOutset;
  const reachColFirst = (left - outset) >> TILE_SHIFT;
  const reachColLast = (right + outset - 1) >> TILE_SHIFT;
  const reachRowFirst = (top - outset) >> TILE_SHIFT;
  const reachRowLast = (bottom + outset - 1) >> TILE_SHIFT;

  // Step 14: pickups, in index order.
  const pickups = level.pickups;
  const taken = run.taken;
  for (let i = 0; i < pickups.length; i++) {
    const pickup = pickups[i];
    if (pickup === undefined || taken[i] !== false) continue;
    if (
      pickup.col < reachColFirst ||
      pickup.col > reachColLast ||
      pickup.row < reachRowFirst ||
      pickup.row > reachRowLast
    ) {
      continue;
    }

    taken[i] = true;
    let points = 0;
    if (pickup.kind === 'crystal') {
      points = P.scoreCrystal;
      session.score += points;
    } else if (pickup.kind === 'blaster') {
      p.hasBlaster = true;
    } else {
      // A pack always fills the tank and is always used up, also when the tank was full.
      p.hasThruster = true;
      p.fuel = P.fuelTicks;
    }
    events?.push({
      type: 'pickup',
      kind: pickup.kind,
      index: i,
      x: cellCentreX(pickup),
      y: cellCentreY(pickup),
      score: points,
    });
  }

  // Step 15: the golden cog. Taking it is what opens the airlock.
  if (!run.hasTrophy) {
    const trophy = level.trophy;
    if (
      trophy.col >= reachColFirst &&
      trophy.col <= reachColLast &&
      trophy.row >= reachRowFirst &&
      trophy.row <= reachRowLast
    ) {
      run.hasTrophy = true;
      session.score += P.scoreCog;
      if (events !== undefined) {
        events.push({ type: 'trophyCollected', x: cellCentreX(trophy), y: cellCentreY(trophy), score: P.scoreCog });
        events.push({ type: 'doorOpened', x: cellCentreX(level.door), y: cellCentreY(level.door) });
      }
    }
  }

  // Step 16: the airlock. Without the cog it is scenery. Its box is narrower
  // than its cell, so the hero has to step in, not brush past.
  if (run.hasTrophy) {
    const doorLeft = level.door.col * TILE + P.doorInsetSide;
    const doorRight = (level.door.col + 1) * TILE - P.doorInsetSide;
    const doorTop = level.door.row * TILE;
    if (boxesOverlap(left, top, right, bottom, doorLeft, doorTop, doorRight, doorTop + TILE)) {
      startExit(game, events);
      // The win stands: nothing can kill a hero who is already through the door.
      return;
    }
  }

  // Step 17: deaths.
  const cause = findDeath(game);
  if (cause !== null) startDying(game, cause, events);
};
