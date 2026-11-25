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
 *                 screen edge and the score pop-ups (kept under the top bar, and under the cog's toast while
 *                 the HUD shows it); `setPaused` with the pause menu; `resize` on a new view size.
 *
 * Particles. One emitter, burst-only, never more than MAX_PARTICLES alive. Each burst sets how its
 * particles move (MOTION) and which frames they show: a fixed frame (sparks, scrap bits) or a sequence
 * played once over the particle's life (fx_sparkle twinkles, fx_dust drifts apart), by a Particle
 * subclass; Phaser's animation manager is not used.
 *
 * Reduced motion (prefers-reduced-motion, docs/ART-AND-SOUND.md section 13): no shake, no screen flash
 * and no particles (no burst is fired); score pop-ups appear where they would rise from and stay there; the
 * airlock pointer does not nudge. Kept, because each is the event itself, once, on one sprite: the enemy's
 * white fill and its fx_poof, and the fades of a death and a respawn (the hero's own fill is WorldView's).
 *
 * Draw order inside the world: particles, the enemy flash and fx_poof at EFFECTS_DEPTH, above the hero;
 * pop-ups, the pointer, the flash and the fade above those. The top bar is its own scene above all.
 */
import * as Phaser from 'phaser';

import { FONT_SIZE, textWidth } from '../art/font';
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
  POPUP_H,
  POPUP_POOL,
  PopupBoard,
  ShakeTimer,
  emberDue,
  fireCells,
  popupAnchor,
} from './fxModel';
import { STRIP_H } from './hudModel';
import { prefersReducedMotion } from './motion';
import { airlockPointer, heroDrawX, heroDrawY, overlayAt } from './viewModel';
import type { EdgeInsets, Point, PointerPlace } from './viewModel';

/** At most this many particles alive at once (docs/ART-AND-SOUND.md section 4), shared by the two emitters below. */
export const MAX_PARTICLES = 48;
/** Of them, the tinted ones (sparks, sparkles, embers, exhaust); the rest are drawn in their own colours (dust, scrap). */
const MAX_TINTED = 36;
/**
 * The tinted particles' texture: pure white copies of fx_spark and fx_sparkle. The art's white is the palette's
 * #f5f8fc, so a tint multiplied over it came out about 4 % darker than the palette (amber #ea932a for #f4972a):
 * the only off-palette pixels of the canvas (the route watch). Over pure white a tint is the palette colour itself.
 */
const WHITE_FX_KEY = 'fx-white';
const WHITE_FX_FRAMES = ['fx_spark', 'fx_sparkle'] as const;
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
/** Pools: more than this many at once is never needed (the oldest is reused). Pop-ups: POPUP_POOL. */
const POOF_POOL = 3;
/** While running on the ground a puff of dust every this many ticks; while thrusting an exhaust spark every this many. */
const RUN_DUST_EVERY = 10;
const THRUST_SPARK_EVERY = 2;
/** Pop-ups start this far above the centre of what scored: just above a 16 px thing. */
const POPUP_LIFT_PX = 16;
/** The fuel bar's top over the hero's sprite while he thrusts (WorldView: a 2 px bar 3 px above it). */
const FUELBAR_RISE = 5;
/**
 * Where the airlock pointer's centre may go: clear of the top bar (y 3..11) and its toast (y 16..23),
 * and above the thumbs' buttons in the lower corners (on a phone about 50 art px tall).
 */
const POINTER_INSET: EdgeInsets = { left: 12, right: 12, top: 32, bottom: 56 };
/** The pointer nudges 1 px toward the airlock every this many ticks. */
const POINTER_NUDGE_TICKS = 16;
/** After its first POINTER_TICKS the pointer stays, still and dimmed to this, for as long as the airlock is off screen. */
const POINTER_LATER_ALPHA = 0.55;

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
  /** Particles drawn in their own colours (dust, scrap). */
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Particles of one palette colour each (sparks, sparkles, embers, the exhaust), over pure white frames. */
  private readonly tinted: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly flashRect: Phaser.GameObjects.Rectangle;
  private readonly fadeRect: Phaser.GameObjects.Rectangle;
  private readonly pointer: Phaser.GameObjects.Image;
  /** One text per slot of `board`, the same index. */
  private readonly popupTexts: Phaser.GameObjects.BitmapText[] = [];
  /** Where the score pop-ups go (fxModel): risen, kept out of the top bar and the toast, off each other and off the hero. */
  private readonly board: PopupBoard;
  /**
   * The hero's sprite (and fuel bar) as drawn on this frame, world px: pop-ups keep off it. On a fast display the sprite is
   * drawn between two ticks, so the board is given where it is drawn, not where the tick put him (at 120 Hz the pop-ups
   * kept off the tick's place and slivers of them lay on the drawn sprite: the route watch's second re-check).
   */
  private readonly heroBox = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
  /** As of the last tick: he thrusts, so the fuel bar is drawn over his head. */
  private heroBurning = false;
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
  /** run.tick until which the airlock pointer shows at full strength (-1: the airlock has not opened since the level start). */
  private pointerUntil = -1;
  /** The cog's toast shows under the top bar (the HUD says so each frame): pop-ups keep below its band meanwhile. */
  private toastUp = false;
  /** The hero as of the last tick: rising through the air, and the side he travels to (a pop-up goes the other way). */
  private heroRising = false;
  /** True while the cog's own pop-up is being placed (the toast goes up on the same tick). */
  private cogNow = false;
  private heroSide: 1 | -1 = 1;
  private readonly popupAt = { x: 0, y: 0 };
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

  /**
   * Test hook only: particles alive, how strong the screen flash and the fade are as drawn now (0 = none), the
   * score pop-ups on screen, how far the highest-risen of them is drawn above where it was first drawn, px (0 under
   * reduced motion), the top of the highest one in view px, each one's box in view px (its 1 px shadow included) with
   * an id that stays while it shows, and which way the airlock pointer points (null: hidden).
   */
  shown(): {
    particles: number;
    flash: number;
    fade: number;
    popups: number;
    popupRise: number;
    popupTop: number | null;
    popupBoxes: { x: number; y: number; w: number; h: number; id: number }[];
    pointer: string | null;
  } {
    let popups = 0;
    let popupRise = 0;
    let popupTop: number | null = null;
    const popupBoxes: { x: number; y: number; w: number; h: number; id: number }[] = [];
    for (const p of this.board.slots) {
      const text = this.popupTexts[this.board.slots.indexOf(p)];
      if (!text?.visible) continue;
      popups += 1;
      popupRise = Math.max(popupRise, (Number.isNaN(p.firstY) ? text.y : p.firstY) - text.y);
      const top = text.y - this.camY;
      popupTop = popupTop === null ? top : Math.min(popupTop, top);
      popupBoxes.push({ x: text.x - this.camX, y: top, w: p.w, h: POPUP_H, id: p.seq });
    }
    return {
      particles: this.emitter.getAliveParticleCount() + this.tinted.getAliveParticleCount(),
      flash: this.flashRect.visible ? this.flashRect.alpha : 0,
      fade: this.fadeRect.visible ? this.fadeRect.alpha : 0,
      popups,
      popupRise,
      popupTop,
      popupBoxes,
      pointer: this.pointer.visible ? this.pointerAt.dir : null,
    };
  }

  constructor(scene: Phaser.Scene, spriteOf: SpriteLookup) {
    this.spriteOf = spriteOf;
    this.reducedMotion = prefersReducedMotion();
    this.board = new PopupBoard(this.reducedMotion, POPUP_POOL);
    // Two emitters, burst-only, 48 particles between them: one for what is drawn in its own colours (dust, scrap),
    // one for the tinted sparks and sparkles over pure white frames. No tint in their configs: the colour is set
    // per burst (docs/PHASER4-NOTES.md section 10). maxAliveParticles, not maxParticles: Phaser counts the pool of
    // dead particles against maxParticles, so that cap would stop all bursts for good after the 48th particle.
    const emitter = (texture: string, frame: string, max: number): Phaser.GameObjects.Particles.ParticleEmitter => {
      const e = scene.add
        .particles(0, 0, texture, {
          frame,
          lifespan: MOTION.spark.lifespan,
          speed: MOTION.spark.speed,
          angle: MOTION.spark.angle,
          accelerationY: 0,
          emitting: false,
          maxAliveParticles: max,
          particleClass: FxParticle,
        })
        .setDepth(EFFECTS_DEPTH);
      // Every particle takes its burst's gravity as its own acceleration (see Motion); none is shared.
      e.acceleration = true;
      e.onParticleEmit((particle) => {
        if (particle instanceof FxParticle) particle.sequence = this.burstSeq;
      });
      return e;
    };
    whiteFxTexture(scene);
    this.emitter = emitter(TEXTURE_KEY.sprites, 'fx_dust_0', MAX_PARTICLES - MAX_TINTED);
    this.tinted = emitter(WHITE_FX_KEY, 'fx_spark_0', MAX_TINTED);

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
      this.popupTexts.push(scene.add.bitmapText(0, 0, FONT_KEY, '', FONT_SIZE).setTint(COLOR.gold).setDropShadow(1, 1, COLOR.void, 1).setDepth(DEPTH.popup).setVisible(false));
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
    const white = scene.textures.get(WHITE_FX_KEY);
    this.sparkleSeq = framesOf('fx_sparkle').map((name) => white.get(name));
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
      this.board.advance(frames);
      this.board.slots.forEach((p, i) => {
        if (p.age >= POPUP_FRAMES) this.popupTexts[i]?.setVisible(false); // the others are placed in `place`
      });
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
  place(camX: number, camY: number, game: GameState, toastUp = false): void {
    this.camX = camX;
    this.camY = camY;
    this.toastUp = toastUp;
    const level = this.level;
    const tick = game.run.tick;
    // Score pop-ups: risen by their age, but never into the top bar, nor into the toast's band while it shows, nor
    // over each other or the hero (fxModel's PopupBoard).
    this.placePopups();
    // The airlock pointer: from the cog on, whenever the airlock is off screen (or only dimmed under the top bar);
    // nudging at full strength for its first POINTER_TICKS, then still and dimmed.
    const at =
      level && this.pointerUntil >= 0 && game.run.hasTrophy
        ? airlockPointer(level.door.col, level.door.row, camX, camY, this.viewW, this.viewH, POINTER_INSET, this.pointerAt, STRIP_H)
        : null;
    if (!at) {
      this.pointer.setVisible(false);
      return;
    }
    const fresh = tick < this.pointerUntil;
    const nudge = this.reducedMotion || !fresh ? 0 : Math.floor(tick / POINTER_NUDGE_TICKS) & 1;
    const dx = at.dir === 'right' ? nudge : at.dir === 'left' ? -nudge : 0;
    const dy = at.dir === 'down' ? nudge : at.dir === 'up' ? -nudge : 0;
    this.pointer
      .setVisible(true)
      .setAlpha(fresh ? 1 : POINTER_LATER_ALPHA)
      .setPosition(at.x + dx, at.y + dy)
      .setFlipX(at.dir === 'left')
      .setAngle(at.dir === 'down' ? 90 : at.dir === 'up' ? -90 : 0);
  }

  /** The pause menu: particles stand still under it (pop-ups and timers wait anyway: `update` is not called). */
  setPaused(paused: boolean): void {
    for (const e of [this.emitter, this.tinted]) {
      if (paused) e.pause();
      else e.resume();
    }
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
    this.burst(this.tinted, motion, 'fx_spark_0', true, null, colour, count, x, y);
  }

  /** Puffs of fx_dust, drifting apart. */
  dust(count: number, x: number, y: number): void {
    this.burst(this.emitter, MOTION.dust, 'fx_dust_0', true, this.dustSeq, 0xffffff, count, x, y);
  }

  /** Twinkles of fx_sparkle, tinted. */
  sparkle(colour: number, count: number, x: number, y: number): void {
    this.burst(this.tinted, MOTION.sparkle, 'fx_sparkle_0', true, this.sparkleSeq, colour, count, x, y);
  }

  /** Debris: `count` bits of the given fx_scrap frames, picked at random, or each in turn when `inTurn`. */
  scrap(frames: readonly string[], count: number, x: number, y: number, inTurn = false): void {
    this.burst(this.emitter, MOTION.scrap, frames, !inTurn, null, 0xffffff, count, x, y);
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
    // The cog's own +100 comes with the toast, which the HUD puts up on the same tick: below its band from the start.
    // Placed with the others when the frame is drawn (`place`), off the hero as drawn then.
    const slot = this.board.spawn(textWidth(text), x, y, this.camY, this.toastUp || this.cogNow);
    this.popupTexts[this.board.slots.indexOf(slot)]?.setText(text).setPosition(slot.drawX, slot.drawY).setVisible(true);
  }

  /**
   * Every pop-up shown, placed for the view as last drawn and the hero's sprite as drawn on this frame (one taken down
   * under reduced motion is hidden).
   */
  private placePopups(): void {
    const hero = this.spriteOf('hero');
    const box = this.heroBox;
    if (hero) {
      box.x = hero.x;
      box.y = hero.y - (this.heroBurning ? FUELBAR_RISE : 0);
      box.h = TILE_SIZE + (this.heroBurning ? FUELBAR_RISE : 0);
    }
    this.board.place(this.camY, this.toastUp || this.cogNow, hero?.visible === true ? box : null);
    this.board.slots.forEach((p, i) => {
      const text = this.popupTexts[i];
      if (p.age < POPUP_FRAMES) text?.setPosition(p.drawX, p.drawY);
      else if (text?.visible) text.setVisible(false);
    });
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
    this.tinted.killAll();
    this.board.clear();
    for (const text of this.popupTexts) text.setVisible(false);
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
    this.toastUp = false;
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
    this.heroRising = playing && !p.onGround && p.vy < 0;
    this.heroSide = p.vx > 0 ? 1 : p.vx < 0 ? -1 : p.facing;
    // The hero's sprite, and the fuel bar over it while he thrusts: pop-ups keep off both (FUELBAR_RISE, WorldView), as
    // drawn on each frame, whenever it is drawn (`placePopups`).
    this.heroBurning = playing && p.thrusting;
    const feet = toPx(p.y + phys.heroH);
    this.fall.observe(playing, p.onGround, feet);
    this.embers(run.tick);

    if (run.phase === 'dying' && run.phaseTicks === deathBreakTick(TUNING.timing)) {
      // The crucible splits (hero_die_1): its four pieces fly, each once. After a fall out of the level, from where
      // he is drawn: at the view's bottom edge (WorldView, fellDrawY).
      const midY = toPx(p.y + (phys.heroH >> 1));
      const y = run.deathCause === 'fell' ? Math.min(midY, this.camY + this.viewH - (TILE_SIZE >> 1)) : midY;
      this.scrap(this.scrapHero, this.scrapHero.length, toPx(p.x + (phys.heroW >> 1)), y, true);
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
    if (score > 0) this.scorePopup(score, px, py);
  }

  pickupRestored(_kind: ItemKind, x: number, y: number): void {
    this.sparkle(COLOR.lime, 3, toPx(x), toPx(y));
  }

  trophyCollected(x: number, y: number, score: number): void {
    const px = toPx(x);
    const py = toPx(y);
    this.sparkle(COLOR.gold, 6, px, py);
    this.flashScreen(COLOR.gold, COG_FLASH_ALPHA, COG_FLASH_FRAMES);
    this.cogNow = true;
    if (score > 0) this.scorePopup(score, px, py);
    this.cogNow = false;
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

  /** One burst from one of the two emitters: how its particles move, which frames they show, in which colour. */
  private burst(
    e: Phaser.GameObjects.Particles.ParticleEmitter,
    motion: Motion,
    frames: string | readonly string[],
    randomFrame: boolean,
    sequence: readonly Phaser.Textures.Frame[] | null,
    tint: number,
    count: number,
    x: number,
    y: number,
  ): void {
    if (count <= 0 || this.reducedMotion) return; // reduced motion: no particles at all
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

  /**
   * `+score` for something scored at (x, y): above it, or beside it when the hero is rising through it (he would
   * fly up into his own pop-up), on the side away from where he travels.
   */
  private scorePopup(score: number, x: number, y: number): void {
    const text = `+${score}`;
    const at = popupAnchor(x, y, POPUP_LIFT_PX, this.heroRising, this.heroSide, textWidth(text), this.popupAt);
    this.popup(text, at.x, at.y);
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

/**
 * The tinted particles' texture, made once per game: each frame of WHITE_FX_FRAMES copied from the sprite sheet
 * with every drawn pixel made pure white (#ffffff), under the same frame names.
 */
function whiteFxTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(WHITE_FX_KEY)) return;
  const sheet = scene.textures.get(TEXTURE_KEY.sprites);
  const source = sheet.getSourceImage() as CanvasImageSource;
  const frames = WHITE_FX_FRAMES.flatMap((name) => framesOf(name)).map((name) => sheet.get(name));
  const width = frames.reduce((w, f) => w + f.cutWidth + 1, 0);
  const height = Math.max(1, ...frames.map((f) => f.cutHeight));
  const tex = scene.textures.createCanvas(WHITE_FX_KEY, width, height);
  if (!tex) return;
  const ctx = tex.getContext();
  let x = 0;
  for (const f of frames) {
    ctx.drawImage(source, f.cutX, f.cutY, f.cutWidth, f.cutHeight, x, 0, f.cutWidth, f.cutHeight);
    tex.add(f.name, 0, x, 0, f.cutWidth, f.cutHeight);
    x += f.cutWidth + 1;
  }
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) > 0) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh(); // uploads the canvas to the GPU (docs/PHASER4-NOTES.md section 4)
}
