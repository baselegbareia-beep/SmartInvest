/**
 * Tuning (px and frames, decimals allowed) to Phys (integers only).
 *
 * This is the one place where the owner's numbers are rounded, and the one
 * gate that keeps unsafe numbers out of the simulation: the collision code
 * relies on every speed being below half a tile per tick, on the hero fitting
 * in a tile, and on every box having some size. The table and the list of
 * rejections are docs/ARCHITECTURE.md, section 3.
 */
import { SUB, TILE, TILE_PX } from './types';
import type { CompileTuningFn, Phys, Tuning } from './types';

/**
 * Thrown by compileTuning. The message lists every problem found, one per
 * line, each starting with the "group.name" of the number to change.
 */
export class TuningError extends Error {
  /** The same problems as in the message, one entry each. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`unsafe tuning, ${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'TuningError';
    this.problems = problems;
  }
}

/** The groups the core reads. camera, view, touch, effects and pacing belong to the shell and are not looked at. */
const CORE_GROUPS = [
  'hero',
  'run',
  'jump',
  'gravity',
  'forgiveness',
  'thruster',
  'blaster',
  'enemies',
  'timing',
  'lives',
  'score',
] as const;

/** Half a tile in sub-pixels: a speed must stay below it, or a move could enter two rows or columns at once. */
const HALF_TILE = TILE >> 1;

/** Art pixels to sub-pixels, rounded to the nearest 1/256 px. */
function sub(px: number): number {
  return Math.round(px * SUB);
}

/** Frame counts, lives and points are copied, not scaled, so they must be whole already. */
function mustBeWhole(group: string, name: string): boolean {
  return name.endsWith('Frames') || group === 'lives' || group === 'score';
}

export const compileTuning: CompileTuningFn = (tuning: Tuning): Phys => {
  const { hero, run, jump, gravity, forgiveness, thruster, blaster, enemies, timing, lives, score } = tuning;
  const problems: string[] = [];
  /** Numbers that already failed a basic check; the rules below skip them so one slip gives one line. */
  const broken = new Set<string>();

  for (const group of CORE_GROUPS) {
    const entries: [string, unknown][] = Object.entries(tuning[group]);
    for (const [name, value] of entries) {
      const path = `${group}.${name}`;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        problems.push(`${path} is ${String(value)}: it must be a finite number, zero or more`);
        broken.add(path);
      } else if (mustBeWhole(group, name) && !Number.isInteger(value)) {
        problems.push(`${path} is ${value}: it must be a whole number`);
        broken.add(path);
      }
    }
  }
  const sound = (...paths: string[]): boolean => paths.every((path) => !broken.has(path));

  const phys: Phys = {
    heroW: sub(hero.heroHitboxW),
    heroH: sub(hero.heroHitboxH),

    runMax: sub(run.runMaxSpeed),
    groundAccel: sub(run.groundAccel),
    groundDecel: sub(run.groundDecel),
    groundTurn: sub(run.groundTurnAccel),
    airAccel: sub(run.airAccel),
    airDecel: sub(run.airDecel),
    airTurn: sub(run.airTurnAccel),

    jumpVel: sub(jump.jumpVelocity),
    jumpCutVel: sub(jump.jumpCutVelocity),
    gravRise: sub(gravity.gravityRise),
    gravFall: sub(gravity.gravityFall),
    gravRiseHang: sub(gravity.gravityRise * gravity.apexHangScale),
    gravFallHang: sub(gravity.gravityFall * gravity.apexHangScale),
    apexHangSpeed: sub(gravity.apexHangSpeed),
    maxFall: sub(gravity.maxFallSpeed),

    coyoteTicks: forgiveness.coyoteFrames,
    jumpBufferTicks: forgiveness.jumpBufferFrames,
    cornerNudge: sub(forgiveness.cornerNudgePx),
    ledgeCatch: sub(forgiveness.ledgeCatchPx),
    hurtInsetSide: sub(forgiveness.hurtInsetSidePx),
    hurtInsetTop: sub(forgiveness.hurtInsetTopPx),
    hurtInsetBottom: sub(forgiveness.hurtInsetBottomPx),
    spikeInsetSide: sub(forgiveness.spikeInsetSidePx),
    spikeInsetTop: sub(forgiveness.spikeInsetTopPx),
    fireInsetSide: sub(forgiveness.fireInsetSidePx),
    fireInsetTop: sub(forgiveness.fireInsetTopPx),
    coolantInsetTop: sub(forgiveness.coolantInsetTopPx),
    enemyTouchInset: sub(forgiveness.enemyTouchInsetPx),
    pickupOutset: sub(forgiveness.pickupOutsetPx),
    doorInsetSide: sub(forgiveness.doorInsetSidePx),

    thrustAccel: sub(thruster.jetAccel),
    thrustMaxRise: sub(thruster.jetMaxRiseSpeed),
    thrustCutVel: sub(thruster.jetCutSpeed),
    fuelTicks: thruster.jetFuelFrames,

    boltSpeed: sub(blaster.boltSpeed),
    boltRange: sub(blaster.boltRangePx),
    boltW: sub(blaster.boltHitboxW),
    boltH: sub(blaster.boltHitboxH),
    fireBufferTicks: blaster.fireBufferFrames,

    cinderpegSpeed: sub(enemies.cinderpegSpeed),
    mothSpeed: sub(enemies.mothSpeed),

    dyingTicks: timing.hitStopFrames + timing.deathAnimFrames + timing.fadeFrames,
    respawnReadyTicks: timing.fadeFrames + timing.readyMinFrames,
    readyMinTicks: timing.readyMinFrames,
    exitTicks: timing.exitFrames,

    startLives: lives.startLives,
    maxLives: lives.maxLives,
    livesPerLevelClear: lives.livesPerLevelClear,
    scoreCrystal: score.crystal,
    scoreCog: score.cog,
    scoreCinderpeg: score.cinderpeg,
    scoreMoth: score.arcMoth,
    scoreLevelClear: score.levelClear,
    scoreLifeLeft: score.lifeLeft,
  };

  // Speeds. Checked on the rounded value, because that is what moves things:
  // 0.001 px/f rounds to standing still, and 7.999 px/f rounds to half a tile.
  const speeds: readonly (readonly [path: string, px: number, compiled: number])[] = [
    ['run.runMaxSpeed', run.runMaxSpeed, phys.runMax],
    ['jump.jumpVelocity', jump.jumpVelocity, phys.jumpVel],
    ['gravity.maxFallSpeed', gravity.maxFallSpeed, phys.maxFall],
    ['thruster.jetMaxRiseSpeed', thruster.jetMaxRiseSpeed, phys.thrustMaxRise],
    ['blaster.boltSpeed', blaster.boltSpeed, phys.boltSpeed],
    ['enemies.cinderpegSpeed', enemies.cinderpegSpeed, phys.cinderpegSpeed],
    ['enemies.mothSpeed', enemies.mothSpeed, phys.mothSpeed],
  ];
  for (const [path, px, compiled] of speeds) {
    if (!sound(path)) continue;
    if (compiled <= 0) {
      problems.push(`${path} is ${px}: a speed must be above 0`);
    } else if (compiled >= HALF_TILE) {
      problems.push(
        `${path} is ${px}: a speed must stay below ${TILE_PX >> 1} px per frame (half a tile), or things pass through walls`,
      );
    }
  }

  // The hero's box.
  if (sound('hero.heroHitboxW')) {
    const w = hero.heroHitboxW;
    if (!Number.isInteger(w)) {
      problems.push(`hero.heroHitboxW is ${w}: it must be a whole number of px`);
    } else if (w > TILE_PX) {
      problems.push(`hero.heroHitboxW is ${w}: it must be at most ${TILE_PX} px (one tile)`);
    } else if ((TILE_PX - w) % 2 !== 0) {
      problems.push(
        `hero.heroHitboxW is ${w}: ${TILE_PX} - heroHitboxW must be even, so the hero stands centred in a tile on whole pixels`,
      );
    }
  }
  if (sound('hero.heroHitboxH')) {
    const h = hero.heroHitboxH;
    if (!Number.isInteger(h)) {
      problems.push(`hero.heroHitboxH is ${h}: it must be a whole number of px`);
    } else if (h > TILE_PX) {
      problems.push(`hero.heroHitboxH is ${h}: it must be at most ${TILE_PX} px (one tile)`);
    }
  }

  // Boxes that an inset can shrink to nothing.
  if (sound('hero.heroHitboxW', 'forgiveness.hurtInsetSidePx') && phys.heroW - 2 * phys.hurtInsetSide <= 0) {
    problems.push(
      `forgiveness.hurtInsetSidePx is ${forgiveness.hurtInsetSidePx}: the hurt box has no width (hero.heroHitboxW ${hero.heroHitboxW} minus twice the inset must be above 0)`,
    );
  }
  if (
    sound('hero.heroHitboxH', 'forgiveness.hurtInsetTopPx', 'forgiveness.hurtInsetBottomPx') &&
    phys.heroH - phys.hurtInsetTop - phys.hurtInsetBottom <= 0
  ) {
    problems.push(
      `forgiveness.hurtInsetTopPx is ${forgiveness.hurtInsetTopPx} and forgiveness.hurtInsetBottomPx is ${forgiveness.hurtInsetBottomPx}: the hurt box has no height (hero.heroHitboxH ${hero.heroHitboxH} minus both must be above 0)`,
    );
  }
  const sideInsets: readonly (readonly [path: string, px: number, compiled: number, box: string])[] = [
    ['forgiveness.enemyTouchInsetPx', forgiveness.enemyTouchInsetPx, phys.enemyTouchInset, 'the enemy touch box'],
    ['forgiveness.spikeInsetSidePx', forgiveness.spikeInsetSidePx, phys.spikeInsetSide, 'the spikes kill box'],
    ['forgiveness.fireInsetSidePx', forgiveness.fireInsetSidePx, phys.fireInsetSide, 'the fire kill box'],
    ['forgiveness.doorInsetSidePx', forgiveness.doorInsetSidePx, phys.doorInsetSide, 'the door box'],
  ];
  for (const [path, px, compiled, box] of sideInsets) {
    if (sound(path) && TILE - 2 * compiled <= 0) {
      problems.push(`${path} is ${px}: ${box} has no size (twice the inset must be below ${TILE_PX} px)`);
    }
  }
  const topInsets: readonly (readonly [path: string, px: number, compiled: number, box: string])[] = [
    ['forgiveness.spikeInsetTopPx', forgiveness.spikeInsetTopPx, phys.spikeInsetTop, 'the spikes kill box'],
    ['forgiveness.fireInsetTopPx', forgiveness.fireInsetTopPx, phys.fireInsetTop, 'the fire kill box'],
    ['forgiveness.coolantInsetTopPx', forgiveness.coolantInsetTopPx, phys.coolantInsetTop, 'the coolant kill box'],
  ];
  for (const [path, px, compiled, box] of topInsets) {
    if (sound(path) && TILE - compiled <= 0) {
      problems.push(`${path} is ${px}: ${box} has no size (the inset must be below ${TILE_PX} px)`);
    }
  }

  // The bolt box (section 5.7). With no width or no height it can lie exactly between two columns or
  // rows and cover none of them, so it would fly through a wall. Larger than the hero's box it would
  // start partly outside the hero, where a wall behind or above him may be.
  const boltSides: readonly (readonly [path: string, px: number, compiled: number, heroPath: string, heroPx: number, heroCompiled: number])[] = [
    ['blaster.boltHitboxW', blaster.boltHitboxW, phys.boltW, 'hero.heroHitboxW', hero.heroHitboxW, phys.heroW],
    ['blaster.boltHitboxH', blaster.boltHitboxH, phys.boltH, 'hero.heroHitboxH', hero.heroHitboxH, phys.heroH],
  ];
  for (const [path, px, compiled, heroPath, heroPx, heroCompiled] of boltSides) {
    if (!sound(path)) continue;
    if (compiled <= 0) {
      problems.push(`${path} is ${px}: the bolt box has no size (it must be at least 1/${SUB} px)`);
    } else if (sound(heroPath) && compiled > heroCompiled) {
      problems.push(
        `${path} is ${px}: the bolt box must fit inside the hero box (at most ${heroPath}, ${heroPx}), so a bolt never starts inside a wall`,
      );
    }
  }

  // Cuts must not be faster than what they cut.
  if (sound('jump.jumpCutVelocity', 'jump.jumpVelocity') && phys.jumpCutVel >= phys.jumpVel) {
    problems.push(
      `jump.jumpCutVelocity is ${jump.jumpCutVelocity}: it must be below jump.jumpVelocity (${jump.jumpVelocity})`,
    );
  }
  if (sound('thruster.jetCutSpeed', 'thruster.jetMaxRiseSpeed') && phys.thrustCutVel > phys.thrustMaxRise) {
    problems.push(
      `thruster.jetCutSpeed is ${thruster.jetCutSpeed}: it must be at most thruster.jetMaxRiseSpeed (${thruster.jetMaxRiseSpeed})`,
    );
  }
  if (sound('gravity.apexHangScale') && !(gravity.apexHangScale > 0 && gravity.apexHangScale <= 1)) {
    problems.push(
      `gravity.apexHangScale is ${gravity.apexHangScale}: it must be above 0 and at most 1 (1 switches the hang off)`,
    );
  }

  // A bolt and an enemy closing on each other must overlap on some tick; otherwise the bolt skips over the enemy.
  const walkers: readonly (readonly [path: string, px: number, compiled: number])[] = [
    ['enemies.cinderpegSpeed', enemies.cinderpegSpeed, phys.cinderpegSpeed],
    ['enemies.mothSpeed', enemies.mothSpeed, phys.mothSpeed],
  ];
  for (const [path, px, compiled] of walkers) {
    if (sound(path, 'blaster.boltSpeed', 'blaster.boltHitboxW') && phys.boltSpeed + compiled >= phys.boltW + TILE) {
      problems.push(
        `blaster.boltSpeed is ${blaster.boltSpeed} and ${path} is ${px}: together they must be below blaster.boltHitboxW + ${TILE_PX} (${blaster.boltHitboxW + TILE_PX}), or a bolt can skip over the enemy`,
      );
    }
  }

  if (sound('lives.startLives', 'lives.maxLives')) {
    if (lives.startLives < 1) {
      problems.push(`lives.startLives is ${lives.startLives}: a run must start with at least 1 life`);
    } else if (lives.startLives > lives.maxLives) {
      problems.push(
        `lives.startLives is ${lives.startLives}: it must be at most lives.maxLives (${lives.maxLives})`,
      );
    }
  }

  if (problems.length === 0) {
    // Last net: a number missing at run time (a hand-built object from plain JavaScript) compiles to NaN.
    const compiled: [string, unknown][] = Object.entries(phys);
    for (const [name, value] of compiled) {
      if (!Number.isInteger(value)) problems.push(`Phys.${name} compiled to ${String(value)}: a tuning number is missing`);
    }
  }
  if (problems.length > 0) throw new TuningError(problems);
  // One Phys is shared by every clone of the game state: frozen, so a stray write fails loudly instead of
  // changing the rules for all of them.
  return Object.freeze(phys);
};
