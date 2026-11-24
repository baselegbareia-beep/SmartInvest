/**
 * The hero's movement: steps 4 to 11 of the tick (docs/ARCHITECTURE.md,
 * sections 4, 5.2 and 5.3). The order of the steps is the contract; the
 * comments below say why each one sits where it does.
 *
 * Called once per playing tick by game.ts, tens of millions of times by the
 * level validator, so nothing here allocates unless an event is being
 * reported to a caller that asked for events.
 */
import * as tilesModule from './tiles';
import * as units from './types';
import type { GameEvent, LevelData, Phys, PlayerState, StepPlayerFn } from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { boxHitsSolid } = tilesModule;
const { TILE, TILE_SHIFT } = units;

/** Moves v toward target by at most a, without passing it. */
function approach(v: number, target: number, a: number): number {
  if (v < target) return Math.min(v + a, target);
  if (v > target) return Math.max(v - a, target);
  return v;
}

/**
 * Step 9. Sideways first, so that a hero arriving at a ledge at foot height
 * is already over it when the vertical move runs and does not snag on its
 * corner.
 */
function moveX(level: LevelData, P: Phys, p: PlayerState): void {
  if (p.vx === 0) return;
  const nx = p.x + p.vx;
  if (!boxHitsSolid(level, nx, p.y, P.heroW, P.heroH)) {
    p.x = nx;
    return;
  }

  // Ledge catch: a falling hero whose feet are only a little below the top of
  // the ledge in the way is lifted onto it. onGround is still last tick's
  // value here (cleared by a jump start), so a walking hero is never lifted.
  const rowTop = ((p.y + P.heroH - 1) >> TILE_SHIFT) << TILE_SHIFT;
  const lift = p.y + P.heroH - rowTop;
  if (
    !p.onGround &&
    p.vy >= 0 &&
    lift <= P.ledgeCatch &&
    !boxHitsSolid(level, nx, rowTop - P.heroH, P.heroW, P.heroH)
  ) {
    p.x = nx;
    p.y = rowTop - P.heroH;
    p.vy = 0;
    return;
  }

  // Wall: stop flush against it. Speeds are below half a tile, so the wall is
  // in the column the leading edge just entered.
  p.x = p.vx > 0 ? (((nx + P.heroW - 1) >> TILE_SHIFT) << TILE_SHIFT) - P.heroW : ((nx >> TILE_SHIFT) + 1) << TILE_SHIFT;
  p.vx = 0;
}

/** Step 10. Landing, or for a rising hero: slide past a clipped ceiling corner, else bonk. */
function moveY(level: LevelData, P: Phys, p: PlayerState, events: GameEvent[] | undefined): void {
  if (p.vy === 0) return;
  const ny = p.y + p.vy;
  if (!boxHitsSolid(level, p.x, ny, P.heroW, P.heroH)) {
    p.y = ny;
    return;
  }

  if (p.vy > 0) {
    // Landing: feet on top of the row they just entered.
    p.y = (((ny + P.heroH - 1) >> TILE_SHIFT) << TILE_SHIFT) - P.heroH;
    p.vy = 0;
    return;
  }

  // Corner nudge. shiftRight puts the left edge on the next column line;
  // shiftLeft puts the right edge on its own column line. The side the hero
  // is moving toward is tried first.
  const shiftRight = (((p.x >> TILE_SHIFT) + 1) << TILE_SHIFT) - p.x;
  const shiftLeft = p.x + P.heroW - (((p.x + P.heroW - 1) >> TILE_SHIFT) << TILE_SHIFT);
  const rightFirst = p.vx >= 0;
  const first = rightFirst ? shiftRight : -shiftLeft;
  const second = rightFirst ? -shiftLeft : shiftRight;
  if (Math.abs(first) <= P.cornerNudge && !boxHitsSolid(level, p.x + first, ny, P.heroW, P.heroH)) {
    p.x += first;
    p.y = ny;
    return;
  }
  if (Math.abs(second) <= P.cornerNudge && !boxHitsSolid(level, p.x + second, ny, P.heroW, P.heroH)) {
    p.x += second;
    p.y = ny;
    return;
  }

  // Bonk: head flush under the ceiling, and the jump arc is over.
  p.y = ((ny >> TILE_SHIFT) + 1) << TILE_SHIFT;
  p.vy = 0;
  p.jumpArc = false;
  events?.push({ type: 'bonked', x: p.x + (P.heroW >> 1), y: p.y });
}

export const stepPlayer: StepPlayerFn = (game, input, events) => {
  const P = game.phys;
  const level = game.level;
  const run = game.run;
  const p = run.player;

  // Step 4: presses and timers. Everything here reads onGround as the last
  // tick left it, which is what gives coyote time and the jump buffer their
  // exact lengths.
  const jumpPressed = input.jump && !p.prevJump;
  const firePressed = input.fire && !p.prevFire;
  p.prevJump = input.jump;
  p.prevFire = input.fire;
  const wasOnGround = p.onGround;
  if (p.onGround) p.coyote = P.coyoteTicks + 1;
  else if (p.coyote > 0) p.coyote -= 1;
  if (p.jumpBuffer > 0) p.jumpBuffer -= 1;
  if (jumpPressed) p.jumpBuffer = P.jumpBufferTicks + 1;
  if (p.fireBuffer > 0) p.fireBuffer -= 1;
  if (firePressed) p.fireBuffer = P.fireBufferTicks + 1;

  // Step 5: run. Left and right together count as neither.
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    const turning = p.vx !== 0 && (p.vx > 0) !== (dir > 0);
    let accel: number;
    if (p.onGround) accel = turning ? P.groundTurn : P.groundAccel;
    else accel = turning ? P.airTurn : P.airAccel;
    p.vx = approach(p.vx, dir * P.runMax, accel);
    p.facing = dir > 0 ? 1 : -1;
  } else {
    p.vx = approach(p.vx, 0, p.onGround ? P.groundDecel : P.airDecel);
  }

  // Step 6: jump start. Before the moves, so a press acts on the tick it arrives.
  let jumped = false;
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -P.jumpVel;
    p.jumpArc = true;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.onGround = false;
    jumped = true;
    events?.push({ type: 'jumped', x: p.x + (P.heroW >> 1), y: p.y + P.heroH });
  }

  // Step 7: jump cut. Letting go early keeps only a little of the rise.
  if (p.jumpArc && !input.jump && p.vy < -P.jumpCutVel) p.vy = -P.jumpCutVel;

  // Step 8: thrust or gravity.
  // engaged: the player asks for thrust and the pack can give it.
  // burning: the engine really fires. Above its own top climbing speed (right
  // after a jump) it idles: no fuel is used and the jump is left alone.
  const engaged = input.thrust && p.hasThruster && p.fuel > 0;
  const burning = engaged && p.vy >= -P.thrustMaxRise;

  // Thrust cut: when a burn ends (released or empty) the climb stops almost
  // at once. p.thrusting still holds last tick's value. Not on the tick a
  // jump starts, and not while the engine merely idles (engaged), so a jump
  // is never cut short by the thruster.
  if (!engaged && p.thrusting && !jumped && p.vy < -P.thrustCutVel) p.vy = -P.thrustCutVel;

  if (burning) {
    p.vy = Math.max(p.vy - P.thrustAccel, -P.thrustMaxRise);
    p.fuel -= 1;
    p.jumpArc = false;
    if (p.fuel === 0) {
      events?.push({ type: 'fuelEmptied', x: p.x + (P.heroW >> 1), y: p.y + (P.heroH >> 1) });
      // An empty tank puts every used pack back, so a thruster level can never be left without fuel for good.
      const pickups = level.pickups;
      const taken = run.taken;
      for (let i = 0; i < pickups.length; i++) {
        const pack = pickups[i];
        if (pack?.kind === 'thruster' && taken[i] === true) {
          taken[i] = false;
          events?.push({
            type: 'pickupRestored',
            kind: 'thruster',
            index: i,
            x: pack.col * TILE + (TILE >> 1),
            y: pack.row * TILE + (TILE >> 1),
          });
        }
      }
    }
  } else if (!jumped) {
    // No gravity on the launch tick: the first tick of a jump rises by the full jump speed.
    const heldArc = p.jumpArc && input.jump;
    const hang = heldArc && Math.abs(p.vy) < P.apexHangSpeed;
    const rising = heldArc && p.vy < 0;
    let gravity: number;
    if (rising) gravity = hang ? P.gravRiseHang : P.gravRise;
    else gravity = hang ? P.gravFallHang : P.gravFall;
    p.vy = Math.min(p.vy + gravity, P.maxFall);
  }
  // Falling faster than the hang speed ends the arc: from here on it is an ordinary fall.
  if (p.vy >= P.apexHangSpeed) p.jumpArc = false;
  if (burning !== p.thrusting) {
    p.thrusting = burning;
    events?.push(burning ? { type: 'thrustStarted' } : { type: 'thrustStopped' });
  }
  // The speed the hero arrives with; the moves below zero vy on contact.
  const impact = p.vy;

  // Steps 9 and 10: move and collide, one axis at a time.
  moveX(level, P, p);
  moveY(level, P, p, events);

  // Step 11: ground. One sub-pixel row under the feet decides it.
  p.onGround = p.vy >= 0 && boxHitsSolid(level, p.x, p.y + P.heroH, P.heroW, 1);
  if (p.onGround) {
    p.vy = 0;
    p.jumpArc = false;
    if (!wasOnGround) events?.push({ type: 'landed', x: p.x + (P.heroW >> 1), y: p.y + P.heroH, speed: impact });
  }
};
