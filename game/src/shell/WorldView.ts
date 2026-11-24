/**
 * The simulation state as Phaser objects (docs/ARCHITECTURE.md 11.1 and 11.2, docs/PHASER4-NOTES.md
 * sections 7, 8 and 12). Owned by the Play scene; nothing here decides a rule.
 *
 *   backdrop   depth -10..-8  stars (0.2 of the camera), the Earth and the ridge (0.1), fixed to the screen
 *   tiles      depth -3..0    TileLayer: panels, decoration, walls and animated hazards
 *   door       depth 4        locked, opening (DOOR_OPENING_TICKS after doorOpened), open
 *   pickups    depth 5        `pickup:<i>`, bobbing 1 px; `trophy`
 *   enemies    depth 8        `enemy:<i>`
 *   bolt       depth 9
 *   hero       depth 10       `hero`, then its overlays `hero.pack`, `hero.flame`, `hero.blaster`
 *                              (placed with overlayOffsetOn, left out where it answers null) and
 *                              `hero.fuelbar` (two rectangles) while thrusting
 *
 * Every image is keyed by the stable id of 11.2 (`sprite(id)` finds one) and rebuilt on `levelStarted`.
 *
 * Positions. After every simulated tick `capture` stores each moving thing's WHOLE-PIXEL draw position
 * (and the camera's whole-pixel scroll) as "current" and the old current as "previous". `render(alpha)`
 * draws `lerpPx(previous, current, alpha)`: with interpolation off alpha is 1 and the current state is
 * drawn exactly. Something that was not drawn on the previous tick (a bolt just fired, an enemy back to
 * life) starts with previous = current, and `snap()` does that for everything (level start, respawn,
 * and every frame the kill's hit stop holds). The rules live in viewModel.ts (`Track`, unit-tested).
 * Every draw position is a whole number and the camera scroll is a whole number, so nothing shimmers.
 *
 * Per frame nothing is allocated: the tracks are made once per level, overlay offsets are cached per
 * hero frame (viewModel.overlayAt), and the frame names come from tables (frames.ts).
 */
import * as Phaser from 'phaser';

import { ENEMY_SPRITE, TEXTURE_KEY, TILE_SIZE, spriteSpec } from '../art/manifest';
import type { OverlayName } from '../art/manifest';
import { COLOR } from '../art/palette';
import { earthSpot, farShift, levelSeed, ridgeTop, starField, starShift } from '../art/tilePick';
import { SUB_SHIFT } from '../core/types';
import type { DeathCause, GameState, LevelData } from '../core/types';
import { TUNING } from '../tuning';

import type { CameraState } from './camera';
import {
  boltFrame,
  doorFrame,
  enemyFlip,
  enemyFrame,
  flameFrame,
  heroLook,
  newHeroLook,
  pickupBob,
  pickupFrame,
  trophyFrame,
} from './frames';
import { prefersReducedMotion } from './motion';
import { TileLayer } from './TileLayer';
import { Track, boltDrawX, boltDrawY, deathFill, exitDrawPos, fellDrawY, fuelBarWidth, heroDrawX, heroDrawY, openShare, overlayAt } from './viewModel';
import type { Point } from './viewModel';

/** Draw depths (docs/PHASER4-NOTES.md section 8: backdrop -10, tiles 0, pickups 5, enemies 8, hero 10, effects 50). */
export const DEPTH = {
  stars: -10,
  earth: -9,
  ridge: -8,
  door: 4,
  pickup: 5,
  trophy: 5,
  enemy: 8,
  bolt: 9,
  hero: 10,
  overlayBack: 10.1,
  flame: 10.2,
  overlayFront: 10.3,
  fuelbar: 10.5,
} as const;

/** The ready gate's blink dims the hero to this, never hides him (docs/ART-AND-SOUND.md section 9). */
const READY_DIM_ALPHA = 0.35;
/**
 * After this many ticks of waiting in the ready gate, a small white chevron over the hero's head says "press
 * something" without words (LEVELS.md rule 11): it blinks with him, steady under reduced motion.
 */
const READY_PROMPT_AFTER = 90;
/** Its centre lies this far above the top of his sprite. */
const READY_PROMPT_LIFT = 6;

/**
 * The Earth is drawn only while enough of its disc lies over open space: hidden below EARTH_HIDE_BELOW of it, shown
 * again from EARTH_SHOW_FROM (the gap between keeps it from flickering at the edge of a window in the panels).
 */
const EARTH_HIDE_BELOW = 0.35;
const EARTH_SHOW_FROM = 0.45;

/** The mini fuel bar over the hero while he thrusts (docs/ART-AND-SOUND.md section 8): art numbers. */
const FUELBAR_W = 12;
const FUELBAR_H = 2;
/** Gap between the bar's bottom and the top of the hero's 16 px sprite. */
const FUELBAR_GAP = 3;

/** The fill of the hero during the hit stop of a death (docs/ART-AND-SOUND.md section 13): white first, then by cause. */
function deathFillColour(cause: DeathCause | null, ticksIn: number): number {
  return COLOR[deathFill(cause, ticksIn)];
}

export class WorldView {
  private readonly scene: Phaser.Scene;
  private tiles: TileLayer | null = null;
  private level: LevelData | null = null;

  /** Every image by its stable id (`hero`, `enemy:3`, `pickup:7`, `trophy`, `door`, `bolt`, `hero.pack`, ...). */
  private readonly byId = new Map<string, Phaser.GameObjects.Image>();
  private hero: Phaser.GameObjects.Image | null = null;
  /** The chevron over a hero kept waiting in the ready gate. */
  private prompt: Phaser.GameObjects.Image | null = null;
  /** run.tick when the current ready gate began (null outside it). */
  private readySince: number | null = null;
  private readonly overlays = new Map<OverlayName, Phaser.GameObjects.Image>();
  private flame: Phaser.GameObjects.Image | null = null;
  private fuelBack: Phaser.GameObjects.Rectangle | null = null;
  private fuelFill: Phaser.GameObjects.Rectangle | null = null;
  private enemies: Phaser.GameObjects.Image[] = [];
  private pickups: Phaser.GameObjects.Image[] = [];
  private trophy: Phaser.GameObjects.Image | null = null;
  private door: Phaser.GameObjects.Image | null = null;
  private bolt: Phaser.GameObjects.Image | null = null;

  private readonly heroTrack = new Track();
  private readonly boltTrack = new Track();
  private enemyTracks: Track[] = [];
  private readonly camTrack = new Track();
  private readonly look = newHeroLook();
  private heroFill: number | null = null;
  private doorOpenedAt: number | null = null;
  private readonly overlayPoint: Point = { x: 0, y: 0 };
  /** The hero's eased place in the airlock during a level clear. */
  private readonly exitAt: Point = { x: 0, y: 0 };
  private drawnCamX = 0;
  private drawnCamY = 0;
  /** Reduced motion: the hero does not blink in the ready gate (docs/ART-AND-SOUND.md section 13). */
  private readonly still: boolean;

  // Backdrop
  private stars: Phaser.GameObjects.Rectangle[] = [];
  private starXY: { x: number; y: number }[] = [];
  private earth: Phaser.GameObjects.Image | null = null;
  private earthAt = { x: 0, y: 0 };
  private earthShown = true;
  private readonly spaceAt = (col: number, row: number): boolean => this.tiles?.showsSpace(col, row) ?? true;
  private ridges: Phaser.GameObjects.Image[] = [];
  private viewW = 0;
  private viewH = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.still = prefersReducedMotion();
  }

  /** Test hook only: how the hero was last drawn (frame, shown, filled by the flash of a death). */
  heroShown(): { frame: string; visible: boolean; filled: boolean; dim: boolean; prompt: boolean } | null {
    const hero = this.hero;
    return hero
      ? { frame: hero.frame.name, visible: hero.visible, filled: this.heroFill !== null, dim: hero.alpha < 1, prompt: this.prompt?.visible === true }
      : null;
  }

  /** Test hook only: the hero's sprite corner as last captured (whole art px in the level): where he is drawn. */
  heroDrawn(): { x: number; y: number } {
    return { x: this.heroTrack.curX, y: this.heroTrack.curY };
  }

  /** The image of a stable id, for effects that need it (an enemy's last frame, the hero's flash). */
  sprite(id: string): Phaser.GameObjects.Image | undefined {
    return this.byId.get(id);
  }

  /** Builds everything for the game's current level: tiles, backdrop and one image per thing. Call on `levelStarted`. */
  buildLevel(game: GameState): void {
    this.clearLevel();
    const level = game.level;
    this.level = level;
    this.tiles = new TileLayer(this.scene, level);
    this.doorOpenedAt = null;

    const image = (id: string, frame: string, depth: number): Phaser.GameObjects.Image => {
      const img = this.scene.add.image(0, 0, TEXTURE_KEY.sprites, frame).setOrigin(0, 0).setDepth(depth);
      this.byId.set(id, img);
      return img;
    };

    this.door = image('door', 'door_locked_0', DEPTH.door).setPosition(level.door.col * TILE_SIZE, level.door.row * TILE_SIZE);
    this.trophy = image('trophy', 'trophy_0', DEPTH.trophy).setPosition(level.trophy.col * TILE_SIZE, level.trophy.row * TILE_SIZE);
    this.pickups = level.pickups.map((def, i) => image(`pickup:${i}`, pickupFrame(def, i, 0), DEPTH.pickup));
    this.enemies = level.enemies.map((spawn, i) => image(`enemy:${i}`, `${ENEMY_SPRITE[spawn.kind]}_0`, DEPTH.enemy));
    this.enemyTracks = level.enemies.map(() => new Track());
    this.bolt = image('bolt', 'bolt_0', DEPTH.bolt).setVisible(false);
    this.hero = image('hero', 'hero_idle_0', DEPTH.hero);
    this.prompt = image('hero.prompt', 'btn_arrow_0', DEPTH.fuelbar)
      .setOrigin(0.5, 0.5)
      .setAngle(-90)
      .setTint(COLOR.white)
      .setTintMode(Phaser.TintModes.FILL)
      .setVisible(false);
    this.readySince = null;
    this.overlays.set('ovl_pack', image('hero.pack', 'ovl_pack_0', DEPTH.overlayBack).setVisible(false));
    this.flame = image('hero.flame', 'thrust_flame_0', DEPTH.flame).setVisible(false);
    this.overlays.set('thrust_flame', this.flame);
    this.overlays.set('ovl_blaster', image('hero.blaster', 'ovl_blaster_0', DEPTH.overlayFront).setVisible(false));
    this.fuelBack = this.scene.add.rectangle(0, 0, FUELBAR_W, FUELBAR_H, COLOR.void).setOrigin(0, 0).setDepth(DEPTH.fuelbar).setVisible(false);
    this.fuelFill = this.scene.add.rectangle(0, 0, FUELBAR_W, FUELBAR_H, COLOR.lime).setOrigin(0, 0).setDepth(DEPTH.fuelbar).setVisible(false);
    this.heroTrack.forget();
    this.boltTrack.forget();
    this.camTrack.forget();
    this.heroFill = null;
    this.buildBackdrop();
  }

  /** The view changed size: the star field and the ridge are laid out for the view. */
  resize(viewW: number, viewH: number): void {
    if (viewW === this.viewW && viewH === this.viewH) return;
    this.viewW = viewW;
    this.viewH = viewH;
    if (this.level) this.buildBackdrop();
  }

  /** The cog was taken: the airlock's opening animation starts at this run.tick. */
  doorOpened(tick: number): void {
    this.doorOpenedAt = tick;
  }

  /**
   * After every simulated tick: previous = current, current = this tick's whole-pixel positions of the
   * hero, the enemies, the bolt and the camera scroll.
   */
  capture(game: GameState, cam: CameraState): void {
    const run = game.run;
    const { player, enemies, bolt } = run;
    const phys = game.phys;
    let hx = heroDrawX(player, phys);
    let hy = heroDrawY(player, phys);
    if (run.phase === 'exiting' && this.level) {
      // The core holds him where his box first touched the airlock (often in mid-fall on its lintel): eased into the cell.
      const at = exitDrawPos(hx, hy, this.level.door.col, this.level.door.row, run.phaseTicks, this.exitAt);
      hx = at.x;
      hy = at.y;
    } else if (run.phase === 'dying' && run.deathCause === 'fell') {
      // He died below the level's bottom row, out of sight: his flash and break-apart play at the view's bottom edge.
      hy = fellDrawY(hy, cam.scrollY, this.viewH);
    }
    this.heroTrack.set(hx, hy, true);
    for (let i = 0; i < this.enemyTracks.length; i++) {
      const e = enemies[i];
      const track = this.enemyTracks[i];
      if (e && track) track.set(e.x >> SUB_SHIFT, e.y >> SUB_SHIFT, e.alive);
    }
    // While inactive the bolt's x and y mean nothing: it is "not drawn", so it never slides in from there.
    this.boltTrack.set(boltDrawX(bolt, phys), boltDrawY(bolt, phys), bolt.active);
    this.camTrack.set(cam.scrollX, cam.scrollY, true);
  }

  /**
   * previous = current for everything: nothing is blended until the next tick. On a level start, a
   * respawn, and every frame the hit stop holds (the picture must stand still, not swing between the
   * last two ticks).
   */
  snap(): void {
    this.heroTrack.snap();
    this.boltTrack.snap();
    for (const track of this.enemyTracks) track.snap();
    this.camTrack.snap();
  }

  /** The camera scroll of the last `render`, whole art px, without the shake. */
  get camX(): number {
    return this.drawnCamX;
  }

  get camY(): number {
    return this.drawnCamY;
  }

  /**
   * Draws the state: positions blended by `alpha` (1 = the current tick exactly), frames from the
   * state, the camera scrolled to a whole pixel plus the shake offset (whole pixels too).
   */
  render(game: GameState, alpha: number, shakeX: number, shakeY: number): void {
    const level = this.level;
    const hero = this.hero;
    if (!level || !hero) return;
    const run = game.run;
    const tick = run.tick;

    this.drawnCamX = this.camTrack.x(alpha);
    this.drawnCamY = this.camTrack.y(alpha);
    const camX = this.drawnCamX + shakeX;
    const camY = this.drawnCamY + shakeY;
    this.scene.cameras.main.setScroll(camX, camY);
    this.renderBackdrop(camX, camY);
    this.tiles?.update(tick);

    // Things in the level
    this.door?.setFrame(doorFrame(run.hasTrophy, this.doorOpenedAt, tick));
    this.trophy?.setVisible(!run.hasTrophy).setFrame(trophyFrame(tick));
    for (let i = 0; i < this.pickups.length; i++) {
      const img = this.pickups[i];
      const def = level.pickups[i];
      if (!img || !def) continue;
      const taken = run.taken[i] === true;
      img.setVisible(!taken);
      if (!taken) img.setFrame(pickupFrame(def, i, tick)).setPosition(def.col * TILE_SIZE, def.row * TILE_SIZE + pickupBob(i, tick));
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const img = this.enemies[i];
      const e = run.enemies[i];
      const track = this.enemyTracks[i];
      if (!img || !e || !track) continue;
      img.setVisible(e.alive);
      if (e.alive) img.setFrame(enemyFrame(e, tick)).setFlipX(enemyFlip(e)).setPosition(track.x(alpha), track.y(alpha));
    }
    const bolt = this.bolt;
    if (bolt) {
      bolt.setVisible(run.bolt.active);
      if (run.bolt.active) bolt.setFrame(boltFrame(tick)).setFlipX(run.bolt.dir < 0).setPosition(this.boltTrack.x(alpha), this.boltTrack.y(alpha));
    }

    // The hero and the gear he carries
    const look = heroLook(game, TUNING.timing, this.look, !this.still);
    const hx = this.heroTrack.x(alpha);
    const hy = this.heroTrack.y(alpha);
    hero.setFrame(look.frame).setFlipX(look.flip).setPosition(hx, hy).setVisible(look.visible).setAlpha(look.dim ? READY_DIM_ALPHA : 1);
    for (const img of this.overlays.values()) img.setAlpha(look.dim ? READY_DIM_ALPHA : 1);
    // Kept waiting at the gate for a while: a chevron over his head, blinking with him.
    if (run.phase === 'ready') this.readySince ??= tick;
    else this.readySince = null;
    const waited = this.readySince === null ? 0 : tick - this.readySince;
    this.prompt?.setVisible(run.phase === 'ready' && waited >= READY_PROMPT_AFTER && !look.dim).setPosition(hx + (TILE_SIZE >> 1), hy - READY_PROMPT_LIFT);
    const fill = look.flash ? deathFillColour(run.deathCause, run.phaseTicks) : null;
    if (fill !== this.heroFill) {
      this.heroFill = fill;
      this.tintHero(hero, fill);
      for (const img of this.overlays.values()) this.tintHero(img, fill);
    }
    const player = run.player;
    // The flame burns only while the world runs: the core clears `thrusting` at a death or the exit anyway.
    const burning = player.thrusting && run.phase === 'playing';
    this.placeOverlay('ovl_pack', look.frame, look.flip, hx, hy, look.visible && player.hasThruster);
    this.placeOverlay('ovl_blaster', look.frame, look.flip, hx, hy, look.visible && player.hasBlaster);
    if (this.placeOverlay('thrust_flame', look.frame, look.flip, hx, hy, look.visible && burning)) this.flame?.setFrame(flameFrame(tick));

    const back = this.fuelBack;
    const bar = this.fuelFill;
    if (back && bar) {
      const fuelShown = burning && look.visible;
      back.setVisible(fuelShown);
      const w = fuelShown ? fuelBarWidth(player.fuel, game.phys.fuelTicks, FUELBAR_W) : 0;
      bar.setVisible(w > 0);
      if (fuelShown) {
        // Centred over the sprite, FUELBAR_GAP px above its top row; the void back shows the empty part.
        const bx = hx + ((TILE_SIZE - FUELBAR_W) >> 1);
        const by = hy - FUELBAR_GAP - FUELBAR_H;
        back.setPosition(bx, by);
        bar.setPosition(bx, by);
        if (bar.width !== w && w > 0) bar.setSize(w, FUELBAR_H);
      }
    }
  }

  /** Removes every object of the level (also on scene shutdown, where Phaser would destroy them anyway). */
  destroy(): void {
    this.clearLevel();
    this.level = null;
  }

  private tintHero(img: Phaser.GameObjects.Image, fill: number | null): void {
    // clearTint first: after FILL a later setTint would stay FILL (docs/PHASER4-NOTES.md section 10).
    img.clearTint();
    if (fill !== null) img.setTint(fill).setTintMode(Phaser.TintModes.FILL);
  }

  /** Shows an overlay at its place on this frame of the hero; hides it when not wanted or not drawn on this frame. True when shown. */
  private placeOverlay(name: OverlayName, heroFrame: string, flip: boolean, hx: number, hy: number, wanted: boolean): boolean {
    const img = this.overlays.get(name);
    if (!img) return false;
    // null: no gear on this frame (the hero has broken apart; overlayOffsetOn answers null).
    const at = wanted ? overlayAt(name, heroFrame, flip, hx, hy, this.overlayPoint) : null;
    if (!at) {
      img.setVisible(false);
      return false;
    }
    img.setVisible(true).setFlipX(flip).setPosition(at.x, at.y);
    return true;
  }

  private clearLevel(): void {
    this.tiles?.destroy();
    this.tiles = null;
    for (const img of this.byId.values()) img.destroy();
    this.byId.clear();
    this.overlays.clear();
    this.fuelBack?.destroy();
    this.fuelFill?.destroy();
    this.fuelBack = null;
    this.fuelFill = null;
    this.hero = null;
    this.prompt = null;
    this.flame = null;
    this.trophy = null;
    this.door = null;
    this.bolt = null;
    this.enemies = [];
    this.pickups = [];
    this.enemyTracks = [];
    this.clearBackdrop();
  }

  // -------------------------------------------------------------------------------------
  // Backdrop (docs/ART-AND-SOUND.md section 6): fixed to the screen, moved by hand on whole pixels
  // -------------------------------------------------------------------------------------

  private buildBackdrop(): void {
    this.clearBackdrop();
    const level = this.level;
    if (!level) return;
    const w = this.viewW > 0 ? this.viewW : this.scene.scale.width;
    const h = this.viewH > 0 ? this.viewH : this.scene.scale.height;
    this.viewW = w;
    this.viewH = h;
    const seed = levelSeed(level.id);
    const maxCamX = Math.max(0, level.width * TILE_SIZE - w);
    const maxCamY = Math.max(0, level.height * TILE_SIZE - h);

    const field = starField(seed, w, h);
    this.starXY = field.map((s) => ({ x: s.x, y: s.y }));
    this.stars = field.map((s) =>
      this.scene.add
        .rectangle(0, 0, 1, 1, s.code === '6' ? COLOR.earthlight : COLOR.slate)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH.stars),
    );
    this.earthAt = earthSpot(seed, w, h, maxCamX, maxCamY);
    this.earth = this.scene.add.image(0, 0, TEXTURE_KEY.sprites, 'backdrop_earth_0').setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.earth);
    const ridgeW = spriteSpec('backdrop_ridge').width;
    const count = Math.ceil(w / ridgeW) + 1;
    this.ridges = Array.from({ length: count }, () =>
      this.scene.add.image(0, 0, TEXTURE_KEY.sprites, 'backdrop_ridge_0').setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.ridge),
    );
  }

  private renderBackdrop(camX: number, camY: number): void {
    const level = this.level;
    if (!level) return;
    const w = this.viewW;
    const h = this.viewH;
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const at = this.starXY[i];
      if (star && at) star.setPosition(starShift(at.x, camX, w), starShift(at.y, camY, h));
    }
    const earth = this.earth;
    if (earth) {
      const ex = farShift(this.earthAt.x, camX);
      const ey = farShift(this.earthAt.y, camY);
      const share = openShare(ex, ey, earth.width, camX, camY, this.spaceAt);
      if (share < EARTH_HIDE_BELOW) this.earthShown = false;
      else if (share >= EARTH_SHOW_FROM) this.earthShown = true;
      earth.setPosition(ex, ey).setVisible(this.earthShown);
    }
    const ridgeW = spriteSpec('backdrop_ridge').width;
    const maxCamY = Math.max(0, level.height * TILE_SIZE - h);
    const top = ridgeTop(h, camY, maxCamY);
    const first = farShift(0, camX) % ridgeW;
    let x = first > 0 ? first - ridgeW : first;
    for (const ridge of this.ridges) {
      ridge.setPosition(x, top);
      x += ridgeW;
    }
  }

  private clearBackdrop(): void {
    for (const star of this.stars) star.destroy();
    this.stars = [];
    this.starXY = [];
    this.earth?.destroy();
    this.earth = null;
    for (const ridge of this.ridges) ridge.destroy();
    this.ridges = [];
  }
}
