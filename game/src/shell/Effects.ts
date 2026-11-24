/**
 * The shell's visual feedback (docs/ART-AND-SOUND.md sections 4 "Effects" and 13): one particle
 * emitter, the enemy's white flash and burst, score pop-ups, the screen flash, the screen fade, the
 * shake and the airlock pointer. All of it is presentation: nothing here changes what happens in the
 * game, and `Math.random` is fine here (never in src/core).
 *
 * Who calls what:
 *   EventRouter   one method per event (EffectsApi: positions in SUB-PIXELS, as the events carry them),
 *                 and `tick(game)` once per simulated tick, before the tick's events, for the effects
 *                 that follow the state (dust while running, the exhaust, embers, the hero breaking up)
 *   Play scene    `update(frames, game)` once per rendered frame with the 60 Hz frames that went by
 *                 (timers count those, also while the core is held by a hit stop or the intro card);
 *                 reads the shake from `shakeX` / `shakeY` (whole pixels, added to the camera scroll by
 *                 WorldView.render); `place(...)` after the world is drawn, for what is pinned to the
 *                 screen edge; `setPaused` with the pause menu; `resize` on a new view size.
 *
 * Particles. One emitter, burst-only, never more than MAX_PARTICLES alive. Each burst sets how its
 * particles move (MOTION) and which frames they show: a fixed frame (sparks, scrap bits) or a sequence
 * played once over the particle's life (fx_sparkle twinkles, fx_dust drifts apart), by a Particle
 * subclass; Phaser's animation manager is not used.
 *
 * Reduced motion (prefers-reduced-motion): the shake and the screen flash are off, as section 13 says
 * for effects that move or flash the whole screen. The fade after a death stays: it is the death.
 *
 * Draw order inside the world: particles, the enemy flash and fx_poof at EFFECTS_DEPTH, above the hero;
 * pop-ups, the pointer, the flash and the fade above those. The top bar is its own scene above all.
 */
import * as Phaser from 'phaser';

import { FONT_LINE_HEIGHT, FONT_SIZE } from '../art/font';
import { ENEMY_SPRITE, FONT_KEY, FX_SCRAP_FRAMES, TEXTURE_KEY, TILE_SIZE } from '../art/manifest';
import { COLOR } from '../art/palette';
import { SUB_SHIFT, TILE_PX } from '../core/types';
import type { DeathCause, EnemyKind, GameState, ItemKind, LevelData, PickupKind } from '../core/types';
import { TUNING } from '../tuning';

import type { EffectsApi } from './EventRouter';
import { deathBreakTick, framesOf, livePose, screenFade } from './frames';
import {
  COG_FLASH_ALPHA,
  COG_FLASH_FRAMES,
  ENEMY_FLASH_FRAMES,
  FallTracker,
  FlashTimer,
  POINTER_TICKS,
  POPUP_FRAMES,
  ShakeTimer,
  emberDue,
  fireCells,
  popupRise,
} from './fxModel';
import { airlockPointer, heroDrawX, heroDrawY, overlayAt } from './viewModel';
import type { EdgeInsets, Point, PointerPlace } from './viewModel';

/** At most this many particles alive at once (docs/ART-AND-SOUND.md section 4). */
export const MAX_PARTICLES = 48;
/** Depth of the particles, the enemy flash and the poof: above the hero (10). */
export const EFFECTS_DEPTH = 50;
const DEPTH = { popup: EFFECTS_DEPTH + 1, pointer: EFFECTS_DEPTH + 2, flash: EFFECTS_DEPTH + 3, fade: EFFECTS_DEPTH + 4 } as const;

/**
 * How a burst's particles move: life in ms, speed in art px per second, angle in degrees (0 right,
 * 90 down), gravity in px/s² (each particle keeps its own: it is given as the particle's acceleration,
 * because Phaser reads the emitter's `gravityY` afresh every frame for every live particle, so one
 * shared gravity would let an ember's lift carry the hero's debris away). Phaser moves particles on its
 * own clock; these are art numbers, like the frames of a sprite, not feel numbers.
 */
interface Motion {
  readonly lifespan: { readonly min: number; readonly max: number };
  readonly speed: { readonly min: number; readonly max: number };
  readonly angle: { readonly min: number; readonly max: number };
  readonly gravityY: number;
}

const MOTION = {
  /** fx_spark bursts: a bolt hitting a wall, coolant splashing. */
  spark: { lifespan: { min: 250, max: 450 }, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, gravityY: 200 },
  /** The thruster's exhaust: straight down out of the flame. */
  exhaust: { lifespan: { min: 120, max: 260 }, speed: { min: 30, max: 60 }, angle: { min: 75, max: 105 }, gravityY: 120 },
  /** fx_dust: a slow puff that drifts up and apart. */
  dust: { lifespan: { min: 260, max: 380 }, speed: { min: 6, max: 16 }, angle: { min: 200, max: 340 }, gravityY: -12 },
  /** fx_sparkle: a twinkle that hardly moves. */
  sparkle: { lifespan: { min: 360, max: 520 }, speed: { min: 8, max: 26 }, angle: { min: 0, max: 360 }, gravityY: 0 },
  /** fx_scrap: debris thrown up and out, falling back. */
  scrap: { lifespan: { min: 450, max: 650 }, speed: { min: 60, max: 110 }, angle: { min: 205, max: 335 }, gravityY: 420 },
  /** An ember off a fire tile: rising slowly. */
  ember: { lifespan: { min: 500, max: 800 }, speed: { min: 10, max: 20 }, angle: { min: 255, max: 285 }, gravityY: -6 },
} as const satisfies Readonly<Record<string, Motion>>;

/** fx_poof plays its 4 frames at this many frames each. */
const POOF_FRAME_TICKS = 3;
/** Pools: more than this many at once is never needed (the oldest is reused). */
const POPUP_POOL = 6;
const POOF_POOL = 3;
/** While running on the ground a puff of dust every this many ticks; while thrusting an exhaust spark every this many. */
const RUN_DUST_EVERY = 10;
const THRUST_SPARK_EVERY = 2;
/** Pop-ups start this far above the centre of what scored: just above a 16 px thing. */
const POPUP_LIFT_PX = 16;
/**
 * Where the airlock pointer's centre may go: clear of the top bar (y 3..11) and its toast (y 16..23),
 * and above the thumbs' buttons in the lower corners (on a phone about 50 art px tall).
 */
const POINTER_INSET: EdgeInsets = { left: 12, right: 12, top: 32, bottom: 56 };
/** The pointer nudges 1 px toward the airlock every this many ticks. */
const POINTER_NUDGE_TICKS = 16;

const toPx = (sub: number): number => sub >> SUB_SHIFT;

/** A particle that can play a frame sequence once over its life (fx_sparkle, fx_dust). */
class FxParticle extends Phaser.GameObjects.Particles.Particle {
  /** Frames shown evenly over the particle's life; null keeps the frame it was fired with. */
  sequence: readonly Phaser.Textures.Frame[] | null = null;

  override update(delta: number, step: number, processors: Phaser.GameObjects.Particles.ParticleProcessor[]): boolean {
    const dead = super.update(delta, step, processors);
    const seq = this.sequence;
    if (!dead && seq) {
      const frame = seq[Math.min(seq.length - 1, Math.floor(this.lifeT * seq.length))];
      if (frame) this.frame = frame;
    }
    return dead;
  }
}

interface Popup {
  readonly text: Phaser.GameObjects.BitmapText;
  x: number;
  y: number;
  age: number;
}

interface Poof {
  readonly image: Phaser.GameObjects.Image;
  age: number;
}

/** A destroyed enemy, filled white for ENEMY_FLASH_FRAMES, then the burst. */
interface Flash {
  readonly image: Phaser.GameObjects.Image;
  age: number;
  /** Centre of the enemy's body, art px. */
  x: number;
  y: number;
  score: number;
}

/** Finds a world image by its stable id (WorldView.sprite). */
export type SpriteLookup = (id: string) => Phaser.GameObjects.Image | undefined;

export class Effects implements EffectsApi {
  private readonly spriteOf: SpriteLookup;
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashRect: Phaser.GameObjects.Rectangle;
  private readonly fadeRect: Phaser.GameObjects.Rectangle;
  private readonly pointer: Phaser.GameObjects.Image;
  private readonly popups: Popup[] = [];
  private readonly poofs: Poof[] = [];
  private readonly flashes: Flash[] = [];
  private readonly reducedMotion: boolean;

  private readonly poofFrames: readonly string[];
  private readonly scrapEnemy: readonly string[];
  private readonly scrapHero: readonly string[];
  private readonly sparkleSeq: readonly Phaser.Textures.Frame[];
  private readonly dustSeq: readonly Phaser.Textures.Frame[];
  /** The frame sequence of the burst being fired now (read by the emit callback). */
  private burstSeq: readonly Phaser.Textures.Frame[] | null = null;

  private readonly screenFlash = new FlashTimer();
  private readonly shaker = new ShakeTimer();
  private readonly fall = new FallTracker();

  private level: LevelData | null = null;
  private fires: Int32Array = new Int32Array(0);
  private tickNow = 0;
  /** run.tick until which the airlock pointer may show (-1: not since the last level start). */
  private pointerUntil = -1;
  private readonly pointerAt: PointerPlace = { x: 0, y: 0, dir: 'right' };
  private readonly flamePoint: Point = { x: 0, y: 0 };
  /** The view as last drawn (scroll without the shake), for embers and the pointer. */
  private camX = 0;
  private camY = 0;
  private viewW: number;
  private viewH: number;

  /** Whole-pixel camera offset of the shake this frame. */
  get shakeX(): number {
    return this.shaker.x;
  }

  get shakeY(): number {
    return this.shaker.y;
  }

  constructor(scene: Phaser.Scene, spriteOf: SpriteLookup) {
    this.spriteOf = spriteOf;
    this.reducedMotion = prefersReducedMotion();
    // One emitter, burst-only. No tint in its config: the colour is set per burst (docs/PHASER4-NOTES.md
    // section 10). maxAliveParticles, not maxParticles: Phaser counts the pool of dead particles
    // against maxParticles, so that cap would stop all bursts for good after the 48th particle.
    this.emitter = scene.add
      .particles(0, 0, TEXTURE_KEY.sprites, {
        frame: 'fx_spark_0',
        lifespan: MOTION.spark.lifespan,
        speed: MOTION.spark.speed,
        angle: MOTION.spark.angle,
        accelerationY: 0,
        emitting: false,
        maxAliveParticles: MAX_PARTICLES,
        particleClass: FxParticle,
      })
      .setDepth(EFFECTS_DEPTH);
    // Every particle takes its burst's gravity as its own acceleration (see Motion); none is shared.
    this.emitter.acceleration = true;
    this.emitter.onParticleEmit((particle) => {
      if (particle instanceof FxParticle) particle.sequence = this.burstSeq;
    });

    const { width, height } = scene.scale;
    this.viewW = width;
    this.viewH = height;
    this.flashRect = scene.add.rectangle(0, 0, width, height, COLOR.gold, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.flash).setVisible(false);
    this.fadeRect = scene.add.rectangle(0, 0, width, height, COLOR.void, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.fade).setVisible(false);
    // The airlock pointer: the touch pad's chevron, filled lime (Sprue's own hue: the way out is his).
    this.pointer = scene.add
      .image(0, 0, TEXTURE_KEY.sprites, 'btn_arrow_0')
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.pointer)
      .setTint(COLOR.lime)
      .setTintMode(Phaser.TintModes.FILL)
      .setVisible(false);

    for (let i = 0; i < POPUP_POOL; i++) {
      const text = scene.add.bitmapText(0, 0, FONT_KEY, '', FONT_SIZE).setTint(COLOR.gold).setDropShadow(1, 1, COLOR.void, 1).setDepth(DEPTH.popup).setVisible(false);
      this.popups.push({ text, x: 0, y: 0, age: POPUP_FRAMES });
    }
    this.poofFrames = framesOf('fx_poof');
    const poofLength = this.poofFrames.length * POOF_FRAME_TICKS;
    for (let i = 0; i < POOF_POOL; i++) {
      const image = scene.add.image(0, 0, TEXTURE_KEY.sprites, 'fx_poof_0').setOrigin(0, 0).setDepth(EFFECTS_DEPTH).setVisible(false);
      this.poofs.push({ image, age: poofLength });
      const ghost = scene.add.image(0, 0, TEXTURE_KEY.sprites, 'cinderpeg_0').setOrigin(0, 0).setDepth(EFFECTS_DEPTH).setVisible(false);
      ghost.setTint(COLOR.white).setTintMode(Phaser.TintModes.FILL);
      this.flashes.push({ image: ghost, age: ENEMY_FLASH_FRAMES, x: 0, y: 0, score: 0 });
    }
    this.scrapEnemy = FX_SCRAP_FRAMES.enemyKilled.map((i) => `fx_scrap_${i}`);
    this.scrapHero = FX_SCRAP_FRAMES.playerDied.map((i) => `fx_scrap_${i}`);
    const texture = scene.textures.get(TEXTURE_KEY.sprites);
    this.sparkleSeq = framesOf('fx_sparkle').map((name) => texture.get(name));
    this.dustSeq = framesOf('fx_dust').map((name) => texture.get(name));
  }

  // -------------------------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------------------------

  /**
   * Once per rendered frame: `frames` 60 Hz frames went by (0 to a few; 0 on a fast display's frame
   * without a tick). Moves pop-ups, plays poofs and enemy flashes, runs the flash, the shake and the fade.
   */
  update(frames: number, game: GameState): void {
    if (frames > 0) {
      for (const p of this.popups) {
        if (p.age >= POPUP_FRAMES) continue;
        p.age += frames;
        if (p.age >= POPUP_FRAMES) p.text.setVisible(false);
        else p.text.setPosition(p.x, p.y - popupRise(p.age));
      }
      const poofLength = this.poofFrames.length * POOF_FRAME_TICKS;
      for (const poof of this.poofs) {
        if (poof.age >= poofLength) continue;
        poof.age += frames;
        if (poof.age >= poofLength) poof.image.setVisible(false);
        else poof.image.setFrame(this.poofFrames[Math.floor(poof.age / POOF_FRAME_TICKS)] ?? 'fx_poof_0');
      }
      for (const flash of this.flashes) {
        if (flash.age >= ENEMY_FLASH_FRAMES) continue;
        flash.age += frames;
        if (flash.age >= ENEMY_FLASH_FRAMES) this.burstEnemy(flash);
      }
      this.screenFlash.advance(frames);
      this.shaker.advance(frames, Math.random);
    }
    const flashAlpha = this.screenFlash.alpha;
    this.flashRect.setVisible(flashAlpha > 0).setAlpha(flashAlpha);
    const fade = screenFade(game, TUNING.timing);
    this.fadeRect.setVisible(fade > 0).setAlpha(fade);
  }

  /**
   * After the world is drawn: the scroll it was drawn with (whole px, without the shake). Places what is
   * pinned to the screen edge: the airlock pointer, while the airlock is off screen.
   */
  place(camX: number, camY: number, game: GameState): void {
    this.camX = camX;
    this.camY = camY;
    const level = this.level;
    const tick = game.run.tick;
    const at =
      level && tick < this.pointerUntil && game.run.hasTrophy
        ? airlockPointer(level.door.col, level.door.row, camX, camY, this.viewW, this.viewH, POINTER_INSET, this.pointerAt)
        : null;
    if (!at) {
      this.pointer.setVisible(false);
      return;
    }
    const nudge = Math.floor(tick / POINTER_NUDGE_TICKS) & 1;
    const dx = at.dir === 'right' ? nudge : at.dir === 'left' ? -nudge : 0;
    const dy = at.dir === 'down' ? nudge : at.dir === 'up' ? -nudge : 0;
    this.pointer
      .setVisible(true)
      .setPosition(at.x + dx, at.y + dy)
      .setFlipX(at.dir === 'left')
      .setAngle(at.dir === 'down' ? 90 : at.dir === 'up' ? -90 : 0);
  }

  /** The pause menu: particles stand still under it (pop-ups and timers wait anyway: `update` is not called). */
  setPaused(paused: boolean): void {
    if (paused) this.emitter.pause();
    else this.emitter.resume();
  }

  /** The view changed size: the screen-sized layers follow. */
  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.flashRect.setSize(width, height);
    this.fadeRect.setSize(width, height);
  }

  // -------------------------------------------------------------------------------------
  // The vocabulary (world art pixels)
  // -------------------------------------------------------------------------------------

  /** `count` 2 x 2 sparks of one palette colour from (x, y). */
  sparks(colour: number, count: number, x: number, y: number, motion: Motion = MOTION.spark): void {
    this.burst(motion, 'fx_spark_0', true, null, colour, count, x, y);
  }

  /** Puffs of fx_dust, drifting apart. */
  dust(count: number, x: number, y: number): void {
    this.burst(MOTION.dust, 'fx_dust_0', true, this.dustSeq, 0xffffff, count, x, y);
  }

  /** Twinkles of fx_sparkle, tinted. */
  sparkle(colour: number, count: number, x: number, y: number): void {
    this.burst(MOTION.sparkle, 'fx_sparkle_0', true, this.sparkleSeq, colour, count, x, y);
  }

  /** Debris: `count` bits of the given fx_scrap frames, picked at random, or each in turn when `inTurn`. */
  scrap(frames: readonly string[], count: number, x: number, y: number, inTurn = false): void {
    this.burst(MOTION.scrap, frames, !inTurn, null, 0xffffff, count, x, y);
  }

  /** The fx_poof burst, 16 x 16 with its top-left corner at (x, y). */
  poof(x: number, y: number): void {
    const poofLength = this.poofFrames.length * POOF_FRAME_TICKS;
    const free = this.poofs.find((p) => p.age >= poofLength) ?? this.poofs[0];
    if (!free) return;
    free.age = 0;
    free.image.setPosition(x, y).setFrame(this.poofFrames[0] ?? 'fx_poof_0').setVisible(true);
  }

  /**
   * A score pop-up (`+10`, gold) centred on x, with its top at y, rising. Two crystals side by side
   * would print `+10+10` on one line: a pop-up that would overlap one still rising goes a line above it.
   */
  popup(text: string, x: number, y: number): void {
    let free: Popup | undefined;
    for (const p of this.popups) if (free === undefined || p.age > free.age) free = p; // a finished one, or the oldest
    if (!free) return;
    free.text.setText(text);
    free.x = Math.round(x - free.text.width / 2);
    free.y = Math.round(y);
    free.age = 0;
    const w = free.text.width;
    for (let tries = 0; tries < POPUP_POOL; tries++) {
      let moved = false;
      for (const p of this.popups) {
        if (p === free || p.age >= POPUP_FRAMES) continue;
        const py = p.y - popupRise(p.age);
        if (Math.abs(p.x - free.x) <= w && Math.abs(py - free.y) < FONT_LINE_HEIGHT) {
          free.y = py - FONT_LINE_HEIGHT;
          moved = true;
        }
      }
      if (!moved) break;
    }
    free.text.setPosition(free.x, free.y).setVisible(true);
  }

  /** The whole view flashes a colour at `alpha`, fading over `frames`. Off under reduced motion. */
  flashScreen(colour: number, alpha: number, frames: number): void {
    if (this.reducedMotion) return;
    this.flashRect.setFillStyle(colour, 1);
    this.screenFlash.start(alpha, frames);
    this.flashRect.setVisible(true).setAlpha(alpha);
  }

  /** Shake the camera by up to `px` whole pixels for `frames`. Off under reduced motion. */
  shake(px: number, frames: number): void {
    if (this.reducedMotion) return;
    this.shaker.start(px, frames);
  }

  /** Clears everything in flight. */
  clear(): void {
    this.emitter.killAll();
    for (const p of this.popups) {
      p.age = POPUP_FRAMES;
      p.text.setVisible(false);
    }
    const poofLength = this.poofFrames.length * POOF_FRAME_TICKS;
    for (const poof of this.poofs) {
      poof.age = poofLength;
      poof.image.setVisible(false);
    }
    for (const flash of this.flashes) {
      flash.age = ENEMY_FLASH_FRAMES;
      flash.image.setVisible(false);
    }
    this.screenFlash.stop();
    this.flashRect.setVisible(false);
    this.shaker.stop();
    this.fall.reset();
    this.pointerUntil = -1;
    this.pointer.setVisible(false);
  }

  // -------------------------------------------------------------------------------------
  // EffectsApi: called by the EventRouter (positions in sub-pixels)
  // -------------------------------------------------------------------------------------

  tick(game: GameState): void {
    const run = game.run;
    const p = run.player;
    const phys = game.phys;
    if (game.level !== this.level) {
      this.level = game.level;
      this.fires = fireCells(game.level);
    }
    this.tickNow = run.tick;
    const playing = run.phase === 'playing';
    const feet = toPx(p.y + phys.heroH);
    this.fall.observe(playing, p.onGround, feet);
    this.embers(run.tick);

    if (run.phase === 'dying' && run.phaseTicks === deathBreakTick(TUNING.timing)) {
      // The crucible splits (hero_die_1): its four pieces fly, each once.
      this.scrap(this.scrapHero, this.scrapHero.length, toPx(p.x + (phys.heroW >> 1)), toPx(p.y + (phys.heroH >> 1)), true);
    }
    if (!playing) return;

    const midX = toPx(p.x + (phys.heroW >> 1));
    if (p.onGround && p.vx !== 0 && run.tick % RUN_DUST_EVERY === 0) this.dust(1, midX - p.facing * 3, feet - 2);
    if (p.thrusting && run.tick % THRUST_SPARK_EVERY === 0) {
      // Out of the bottom of the flame, wherever the flame is drawn on this frame of the hero.
      const flip = p.facing < 0;
      const at = overlayAt('thrust_flame', livePose(p, run.tick), flip, heroDrawX(p, phys), heroDrawY(p, phys), this.flamePoint);
      if (at) this.sparks(COLOR.lime, 1, at.x + (flip ? 4 : 2), at.y + 5, MOTION.exhaust);
    }
  }

  levelStarted(): void {
    this.clear();
  }

  jumped(x: number, y: number): void {
    this.dust(1, toPx(x), toPx(y) - 2);
  }

  landed(x: number, y: number): void {
    const px = toPx(x);
    const py = toPx(y);
    this.dust(2, px, py - 2);
    if (this.fall.landed(py) >= TUNING.effects.shakeLandMinFallTiles * TILE_PX) {
      this.shake(TUNING.effects.shakeLandPx, TUNING.effects.shakeLandFrames);
    }
  }

  bonked(x: number, y: number): void {
    this.dust(1, toPx(x), toPx(y));
  }

  pickup(kind: PickupKind, x: number, y: number, score: number): void {
    const px = toPx(x);
    const py = toPx(y);
    this.sparkle(kind === 'crystal' ? COLOR.white : COLOR.lime, 4, px, py);
    if (score > 0) this.popup(`+${score}`, px, py - POPUP_LIFT_PX);
  }

  pickupRestored(_kind: ItemKind, x: number, y: number): void {
    this.sparkle(COLOR.lime, 3, toPx(x), toPx(y));
  }

  trophyCollected(x: number, y: number, score: number): void {
    const px = toPx(x);
    const py = toPx(y);
    this.sparkle(COLOR.gold, 6, px, py);
    this.flashScreen(COLOR.gold, COG_FLASH_ALPHA, COG_FLASH_FRAMES);
    if (score > 0) this.popup(`+${score}`, px, py - POPUP_LIFT_PX);
  }

  doorOpened(): void {
    // A lime chevron at the screen edge points at the airlock for POINTER_TICKS (while it is off screen).
    this.pointerUntil = this.tickNow + POINTER_TICKS;
  }

  boltFired(): void {
    // No effect of its own: the bolt sprite and the sound say it.
  }

  boltEnded(x: number, y: number, hit: 'wall' | 'enemy' | 'range'): void {
    // Four white sparks where the bolt stops; a hit on an enemy is covered by its burst.
    if (hit !== 'enemy') this.sparks(COLOR.white, 4, toPx(x), toPx(y));
  }

  enemyKilled(kind: EnemyKind, index: number, x: number, y: number, score: number): void {
    const px = toPx(x);
    const py = toPx(y);
    // Filled white in its last pose for ENEMY_FLASH_FRAMES, then the burst (update -> burstEnemy).
    const flash = this.flashes.find((f) => f.age >= ENEMY_FLASH_FRAMES) ?? this.flashes[0];
    const seen = this.spriteOf(`enemy:${index}`);
    if (flash) {
      flash.age = 0;
      flash.x = px;
      flash.y = py;
      flash.score = score;
      flash.image
        .setFrame(seen?.frame.name ?? `${ENEMY_SPRITE[kind]}_0`)
        .setFlipX(seen?.flipX ?? false)
        .setPosition(px - (TILE_SIZE >> 1), py - (TILE_SIZE >> 1))
        .setVisible(true);
    }
    this.shake(TUNING.effects.shakeKillPx, TUNING.effects.shakeKillFrames);
  }

  fuelEmptied(x: number, y: number): void {
    // The tank coughs out its last: a puff from the pack.
    this.dust(2, toPx(x), toPx(y));
  }

  playerDied(cause: DeathCause, x: number, y: number): void {
    // The white (amber, ice) flash is the hero's own (WorldView); the debris flies when he splits (tick).
    if (cause === 'coolant') this.sparks(COLOR.ice, 6, toPx(x), toPx(y));
    this.shake(TUNING.effects.shakeDeathPx, TUNING.effects.shakeDeathFrames);
  }

  respawned(): void {
    // The level starts over behind a fade (or Restart level): nothing of the old attempt stays in the air.
    this.clear();
  }

  levelCompleted(): void {
    // The banner is the top bar's (HudScene.levelClear).
  }

  // -------------------------------------------------------------------------------------
  // Inside
  // -------------------------------------------------------------------------------------

  /** One burst from the one emitter: how its particles move, which frames they show, in which colour. */
  private burst(
    motion: Motion,
    frames: string | readonly string[],
    randomFrame: boolean,
    sequence: readonly Phaser.Textures.Frame[] | null,
    tint: number,
    count: number,
    x: number,
    y: number,
  ): void {
    if (count <= 0) return;
    const e = this.emitter;
    // Load the burst's motion into the emitter's operators (what setConfig does, without rebuilding the rest).
    e.ops.lifespan.loadConfig(motion);
    e.ops.angle.loadConfig(motion);
    e.ops.speedX.loadConfig(motion, 'speed');
    e.ops.speedY.active = false;
    e.radial = true;
    e.accelerationY = motion.gravityY;
    e.setEmitterFrame(typeof frames === 'string' ? frames : [...frames], randomFrame);
    e.setParticleTint(tint);
    this.burstSeq = sequence;
    e.explode(count, x, y);
    this.burstSeq = null;
  }

  /** The enemy's white flash is over: fx_poof, its scrap (legs and plates) and the pop-up. */
  private burstEnemy(flash: Flash): void {
    flash.image.setVisible(false);
    this.poof(flash.x - (TILE_SIZE >> 1), flash.y - (TILE_SIZE >> 1));
    this.scrap(this.scrapEnemy, 6, flash.x, flash.y);
    if (flash.score > 0) this.popup(`+${flash.score}`, flash.x, flash.y - POPUP_LIFT_PX);
  }

  /** One amber ember off each fire tile on screen whose moment it is (ART-AND-SOUND section 4, fx_spark). */
  private embers(tick: number): void {
    const fires = this.fires;
    for (let i = 0; i + 1 < fires.length; i += 2) {
      const col = fires[i] ?? 0;
      const row = fires[i + 1] ?? 0;
      if (!emberDue(tick, col)) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (x + TILE_SIZE <= this.camX || x >= this.camX + this.viewW || y + TILE_SIZE <= this.camY || y >= this.camY + this.viewH) continue;
      this.sparks(COLOR.amber, 1, x + 5 + Math.floor(Math.random() * 6), y + 3, MOTION.ember);
    }
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
