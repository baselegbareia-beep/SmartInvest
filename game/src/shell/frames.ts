/**
 * Which picture to draw for each thing, from the simulation state alone (docs/ARCHITECTURE.md 11.2,
 * docs/ART-AND-SOUND.md section 4). Pure: no Phaser, no DOM, no clock. The view asks once per
 * rendered frame; nothing here allocates (frame names are looked up in tables built once).
 *
 * Every animation is timed by `run.tick`, the simulation's own clock, so a replay looks the same
 * every time, and a frozen world (pause, intro card) shows a frozen picture.
 */
import {
  DOOR_OPEN_PULSE_TICKS,
  DOOR_OPENING_TICKS,
  ENEMY_SPRITE,
  HERO_BLINK,
  ITEM_PICKUP_SPRITE,
  frameNamesOf,
  gemSpriteAt,
  spriteSpec,
} from '../art/manifest';
import type { SpriteName } from '../art/manifest';
import type { EnemyState, GameState, PickupDef, PlayerState, TimingTuning } from '../core/types';

// ---------------------------------------------------------------------------------------
// Frame tables
// ---------------------------------------------------------------------------------------

const TABLES = new Map<SpriteName, readonly string[]>();

/** Every frame name of a sprite, built once: `framesOf('hero_run')[2]` is `'hero_run_2'`. */
export function framesOf(name: SpriteName): readonly string[] {
  let table = TABLES.get(name);
  if (!table) {
    table = frameNamesOf(spriteSpec(name));
    TABLES.set(name, table);
  }
  return table;
}

/** Frame `index` of a sprite, wrapped into its frame count. */
function frameAt(name: SpriteName, index: number): string {
  const table = framesOf(name);
  const n = table.length;
  return table[((index % n) + n) % n] ?? `${name}_0`;
}

/** The frame of a steadily looping sprite at a tick (its manifest rate; frame 0 for sprites without one). */
export function loopedFrame(name: SpriteName, tick: number, offsetFrames = 0): string {
  const per = spriteSpec(name).ticksPerFrame;
  return frameAt(name, (per === undefined ? 0 : Math.floor(Math.max(0, tick) / per)) + offsetFrames);
}

// ---------------------------------------------------------------------------------------
// The hero
// ---------------------------------------------------------------------------------------

/** What the hero looks like this frame. The view keeps one of these and lets `heroLook` fill it. */
export interface HeroLook {
  /** Frame name on the sprite sheet. */
  frame: string;
  /** Always true now: the ready gate dims him instead of hiding him (`dim`), so he is never missing from the picture. */
  visible: boolean;
  /** True on the dim half of the ready-gate blink (the sign that the world waits for a press). */
  dim: boolean;
  /** True during the hit stop of a death: the last pose, filled white. */
  flash: boolean;
  /** Mirror the sprite (he faces left). */
  flip: boolean;
}

export function newHeroLook(): HeroLook {
  return { frame: framesOf('hero_idle')[0] ?? 'hero_idle_0', visible: true, dim: false, flash: false, flip: false };
}

/** The pose of a hero in a running world, at a tick: thrusting, in the air, running, standing (first match wins). */
export function livePose(player: PlayerState, tick: number): string {
  if (player.thrusting) return loopedFrame('hero_thrust', tick);
  if (!player.onGround) return frameAt(player.vy < 0 ? 'hero_jump' : 'hero_fall', 0);
  if (player.vx !== 0) return loopedFrame('hero_run', tick);
  // Standing: frame 1 is the blink, shown for HERO_BLINK.ticks out of every HERO_BLINK.everyTicks.
  const blink = Math.max(0, tick) % HERO_BLINK.everyTicks >= HERO_BLINK.everyTicks - HERO_BLINK.ticks;
  return frameAt('hero_idle', blink ? 1 : 0);
}

/**
 * The hero's look from the state (docs/ART-AND-SOUND.md section 4, hero rows):
 * - dying: for the first `hitStopFrames` ticks the pose he died in, filled white; then the four
 *   `hero_die` frames spread evenly over `deathAnimFrames`; then the last of them while the screen
 *   fades (`screenFade`).
 * - ready gate: his live pose, dimmed while `(run.tick >> 3) & 1` is 1 (the blink that says "waiting"),
 *   unless `blink` is false (reduced motion: nothing blinks; he is shown steadily). He was hidden on those
 *   ticks, and a picture taken then showed no hero at all (the route watch): dimmed, he is always there.
 * - exiting: standing inside the airlock (idle).
 * - playing: thrusting, in the air, running, standing.
 */
export function heroLook(game: GameState, timing: TimingTuning, out: HeroLook, blink = true): HeroLook {
  const run = game.run;
  const player = run.player;
  out.flip = player.facing < 0;
  out.visible = true;
  out.dim = false;
  out.flash = false;
  switch (run.phase) {
    case 'dying': {
      const t = run.phaseTicks;
      if (t < timing.hitStopFrames) {
        // The pose of the tick he died on: the world is frozen, so the state still describes it.
        out.frame = livePose(player, run.tick - t);
        out.flash = true;
      } else {
        const k = t - timing.hitStopFrames;
        const frames = framesOf('hero_die').length;
        const index = timing.deathAnimFrames > 0 ? Math.floor((k * frames) / timing.deathAnimFrames) : frames - 1;
        out.frame = frameAt('hero_die', Math.min(frames - 1, index));
      }
      break;
    }
    case 'exiting':
      out.frame = frameAt('hero_idle', 0);
      break;
    case 'ready':
      out.frame = livePose(player, run.tick);
      out.dim = blink && ((run.tick >> 3) & 1) === 1;
      break;
    case 'playing':
      out.frame = livePose(player, run.tick);
      break;
  }
  return out;
}

/**
 * The tick of the dying phase (`run.phaseTicks`) on which the hero breaks apart: the first tick that
 * shows `hero_die_1`, from which on he carries no gear (overlayOffsetOn answers null). The view throws
 * his four fx_scrap pieces then, so the debris leaves the body as it splits.
 */
export function deathBreakTick(timing: TimingTuning): number {
  const frames = framesOf('hero_die').length;
  if (timing.deathAnimFrames <= 0 || frames < 2) return timing.hitStopFrames;
  return timing.hitStopFrames + Math.ceil(timing.deathAnimFrames / frames);
}

/**
 * How dark the screen is, 0 (clear) to 1 (void): it fades out during the last `fadeFrames` ticks of
 * dying and back in during the first `fadeFrames` ticks of the ready gate that follows a death
 * (docs/ART-AND-SOUND.md section 13, "Fade"). A respawn after a death is the only ready gate whose
 * minimum is `phys.respawnReadyTicks`; a level start, Restart level and a resume use `readyMinTicks`
 * and do not fade.
 */
export function screenFade(game: GameState, timing: TimingTuning): number {
  const run = game.run;
  const fade = timing.fadeFrames;
  if (fade <= 0) return 0;
  if (run.phase === 'dying') {
    const fadeStart = timing.hitStopFrames + timing.deathAnimFrames;
    if (run.phaseTicks < fadeStart) return 0;
    return Math.min(1, (run.phaseTicks - fadeStart + 1) / fade);
  }
  const afterDeath = run.phaseLength === game.phys.respawnReadyTicks && game.phys.respawnReadyTicks !== game.phys.readyMinTicks;
  if (run.phase === 'ready' && afterDeath && run.phaseTicks < fade) {
    return 1 - (run.phaseTicks + 1) / fade;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------
// Enemies, pickups, the cog, the airlock, the bolt, the flame
// ---------------------------------------------------------------------------------------

/** An enemy's frame: its own loop. Every enemy is drawn mirrored... */
export function enemyFrame(enemy: EnemyState, tick: number): string {
  return loopedFrame(ENEMY_SPRITE[enemy.kind], tick);
}

/** ...when it walks left (Cinderpeg) or flies left along a sideways path (moth). An up-and-down moth is never mirrored. */
export function enemyFlip(enemy: EnemyState): boolean {
  if (enemy.kind === 'cinderpeg') return enemy.dir < 0;
  return enemy.axis === 'h' && enemy.dir < 0;
}

/**
 * Pickups glint (frame 1) for GLINT_TICKS out of every GLINT_EVERY_TICKS, each pickup at its own
 * moment, and bob 1 px every BOB_TICKS. The guide gives no rate for either (docs/ART-AND-SOUND.md
 * section 4 lists the glint frames only): these are the view's choice, art numbers, not feel numbers.
 */
export const GLINT_EVERY_TICKS = 150;
export const GLINT_TICKS = 8;
export const BOB_TICKS = 30;

/** The sprite of a pickup lying in the level. */
export function pickupSprite(def: PickupDef): SpriteName {
  return def.kind === 'crystal' ? gemSpriteAt(def.col, def.row) : ITEM_PICKUP_SPRITE[def.kind];
}

/** A pickup's frame: its picture, glinting now and then. `index` spreads the glints apart. */
export function pickupFrame(def: PickupDef, index: number, tick: number): string {
  const phase = (Math.max(0, tick) + index * 37) % GLINT_EVERY_TICKS;
  return frameAt(pickupSprite(def), phase < GLINT_TICKS ? 1 : 0);
}

/** A pickup's bob: 0 or -1 px, alternating every BOB_TICKS, neighbours out of step. */
export function pickupBob(index: number, tick: number): number {
  return ((Math.floor(Math.max(0, tick) / BOB_TICKS) + index) & 1) === 1 ? -1 : 0;
}

/** The golden cog on its stand. */
export function trophyFrame(tick: number): string {
  return loopedFrame('trophy', tick);
}

/**
 * The airlock: locked until the cog is taken; then the opening animation for DOOR_OPENING_TICKS ticks
 * after `doorOpened` (`openedAt` is the run.tick of that event, or null when the view did not see it,
 * as after a level is resumed with the cog already taken); then open, its lamp pulsing.
 */
export function doorFrame(hasTrophy: boolean, openedAt: number | null, tick: number): string {
  if (!hasTrophy) return frameAt('door_locked', 0);
  if (openedAt !== null) {
    const since = tick - openedAt;
    if (since >= 0 && since < DOOR_OPENING_TICKS) {
      const frames = framesOf('door_opening').length;
      return frameAt('door_opening', Math.floor((since * frames) / DOOR_OPENING_TICKS));
    }
  }
  return frameAt('door_open', Math.floor(Math.max(0, tick) / DOOR_OPEN_PULSE_TICKS));
}

/** The bolt in flight (mirror it when it flies left). */
export function boltFrame(tick: number): string {
  return loopedFrame('bolt', tick);
}

/** The thruster's exhaust under the pack. */
export function flameFrame(tick: number): string {
  return loopedFrame('thrust_flame', tick);
}
