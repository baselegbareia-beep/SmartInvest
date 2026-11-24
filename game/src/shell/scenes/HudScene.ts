/**
 * The top bar and the banners, in their own scene above the game (docs/ART-AND-SOUND.md sections 8
 * and 9, docs/ARCHITECTURE.md 11.1).
 *
 * Fed by pushes, never by polling the simulation (Phaser updates this scene BEFORE Play, so a poll
 * would show the previous frame):
 *   show(model)        every rendered frame, after Play's ticks: lives, level, score, cog, items, fuel,
 *                      and the level intro card while it is up
 *   cogFound()         the `COG FOUND! AIRLOCK OPEN` toast            (EventRouter, trophyCollected)
 *   levelClear(bonus)  the `LEVEL CLEAR +200` banner and its tally    (EventRouter, levelCompleted)
 *   lifeLost(lives)    the lost life's icon blinks five times         (EventRouter, respawned)
 * Its own `update` only runs the clocks of those, in whole 60 Hz frames, and none of them while the
 * Play scene is paused (`HudData.held`, a FrameClock): under the pause menu the toast, the life blink,
 * the score count and the intro shutter stand still with the world and go on after RESUME.
 *
 * - The bar is one row along the TOP, y = 3 to 11 (no status bar along the bottom: docs/LEVELS.md
 *   rule 11): lives at x = 4, `LEVEL n` at x = 36, the score centred (counting up 10 a frame), and the
 *   cog, items and fuel pips in a block 61 px wide ending 4 px left of the touch pad's PAUSE button.
 *   It is a band over the world: a dark strip (void at 70 %) lies behind it, so the level's own crystals
 *   and wall tops never read as part of the bar. Where each goes is src/shell/hudModel.ts; it is
 *   re-placed on every view resize.
 * - The intro card: a shutter wipe opens on the dimmed level, with `LEVEL 3` (2x), the name in lime, the
 *   hint and the life icons on a plate, while the Play scene holds the card up (it is not stepped).
 * - The level-clear banner: `LEVEL CLEAR +200` on a plate under the bar, with the score tallied under
 *   it as the bar counts it up, for the hero's time in the airlock: shown while the pushed model says
 *   `exiting` (run.phase), so it cannot run out under a pause.
 */
import * as Phaser from 'phaser';

import { FONT_SIZE } from '../../art/font';
import { FONT_KEY, TEXTURE_KEY } from '../../art/manifest';
import { COLOR } from '../../art/palette';
import { TUNING } from '../../tuning';
import type { HudEvents } from '../EventRouter';
import {
  FUEL_PIPS,
  FrameClock,
  NO_BLINK,
  PIP_Y,
  STRIP_ALPHA,
  STRIP_H,
  TOAST_BAND_BOTTOM,
  TOAST_PAD,
  TOAST_Y,
  advanceBlink,
  cornerClearPx,
  countScore,
  lifeBlink,
  lifeLit,
  newHudModel,
  pauseReservePx,
  pipLit,
  topBarLayout,
} from '../hudModel';
import type { HudModel, IntroCard, LifeBlink } from '../hudModel';
import { textPx } from '../menuLayout';
import { bannerLayout, introLayout } from '../screens';
import type { PlacedLine } from '../screens';
import { prefersReducedMotion } from '../motion';
import { onSceneEnd } from '../sceneEnd';
import { canvasEdgeGapsCss, cssPerArt } from '../singletons';

import { TEXT, scoreDigits } from './strings';
import { Shutter, setScreenLabel } from './TitleScene';

// The Play scene imports the model from here; it lives in the pure module so it can be unit-tested.
export { FUEL_PIPS, newHudModel };
export type { HudModel, IntroCard };

/** The data of `scene.launch('Hud', data)`. */
export interface HudData {
  /** True while the HUD's clocks must stand still: the Play scene's pause menu is up. */
  readonly held?: () => boolean;
}

/** What the HUD shows now, for the test hook (`__E2E__.hud()`). */
export interface HudShown {
  /** The intro card's lines, top to bottom; empty when no card is up. */
  readonly intro: readonly string[];
  /** The `COG FOUND! AIRLOCK OPEN` toast, or null. */
  readonly toast: string | null;
  /** The `LEVEL CLEAR +200` banner's heading, or null. */
  readonly banner: string | null;
  /** The clocks stand still (the pause menu is up). */
  readonly held: boolean;
  /**
   * Every object of the scene's display list that is shown now (visible, not transparent) and can give its
   * bounds, whatever its kind (an Image, a Sprite, a Text, a Rectangle ...), with those bounds in art px of the
   * view. A Graphics has no bounds and is not listed: the browser test that nothing of the HUD lies along the
   * bottom of the screen (docs/LEVELS.md rule 11) also compares the pixels with and without the scene
   * (`__E2E__.hudPixels`), which sees every kind.
   */
  readonly drawn: readonly { readonly kind: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
}

/** A display-list child that can say where it is drawn. */
interface Bounded {
  readonly type: string;
  readonly visible: boolean;
  readonly alpha?: number;
  getBounds(): Phaser.Geom.Rectangle;
}

/** The child as something with bounds, or null for a kind that has none (a Graphics). */
function bounded(obj: Phaser.GameObjects.GameObject): Bounded | null {
  const o = obj as Partial<Bounded>;
  return typeof o.getBounds === 'function' && typeof o.visible === 'boolean' ? (obj as unknown as Bounded) : null;
}

/** Darkness of the layer under the intro card. */
const INTRO_DIM = 0.6;
/** The `ui_panel` nine-slice: 24 x 24 with 8 px corners (docs/ART-AND-SOUND.md section 4). */
const PANEL_CORNER = 8;
const NEVER_HELD = (): boolean => false;

/** Draw order inside the HUD scene: the bar, then the dim and the card over it, then the shutter. */
const DEPTH = { strip: -1, bar: 0, toast: 1, banner: 2, dim: 10, card: 11, cardText: 12, shutter: 100 } as const;

export class HudScene extends Phaser.Scene implements HudEvents {
  /** The dark strip behind the bar: the bar is a band over the world (hudModel STRIP_H). */
  private strip: Phaser.GameObjects.Rectangle | null = null;
  private lives: Phaser.GameObjects.Image[] = [];
  private level: Phaser.GameObjects.BitmapText | null = null;
  private score: Phaser.GameObjects.BitmapText | null = null;
  private cog: Phaser.GameObjects.Image | null = null;
  private blaster: Phaser.GameObjects.Image | null = null;
  private thruster: Phaser.GameObjects.Image | null = null;
  private pips: Phaser.GameObjects.Image[] = [];
  private toast: Phaser.GameObjects.BitmapText | null = null;
  /** The dark band behind the toast, hanging from the strip (hudModel TOAST_BAND_BOTTOM). */
  private toastBand: Phaser.GameObjects.Rectangle | null = null;
  private bannerPlate: Phaser.GameObjects.NineSlice | null = null;
  private bannerHeading: Phaser.GameObjects.BitmapText | null = null;
  private bannerTally: Phaser.GameObjects.BitmapText | null = null;
  private introDim: Phaser.GameObjects.Rectangle | null = null;
  private introPlate: Phaser.GameObjects.NineSlice | null = null;
  private introTexts: Phaser.GameObjects.BitmapText[] = [];
  private introLives: Phaser.GameObjects.Image[] = [];
  private shutter: Shutter | null = null;

  private readonly model = newHudModel();
  private shownCard: IntroCard | null = null;
  private shownScore = 0;
  private shownLevel = -1;
  private bannerBonus = 0;
  /** The banner is up: from levelClear until the pushed model is no longer `exiting`. */
  private bannerShown = false;
  private readonly frameClock = new FrameClock();
  private held: () => boolean = NEVER_HELD;
  /** Reduced motion: nothing blinks (the lost life's icon goes dark at once, the low pips stay lit). */
  private still = false;
  /** Frames since the scene started: the pips' blink clock. */
  private clock = 0;
  private toastLeft = 0;
  private blink: LifeBlink = NO_BLINK;
  /** What each icon shows now, so a frame changes only what changed. */
  private livesShown: boolean[] = [];
  private pipsShown: (boolean | null)[] = [];
  private cogShown: boolean | null = null;
  private drawnScore = -1;

  constructor() {
    super('Hud');
  }

  init(data: HudData = {}): void {
    this.held = data.held ?? NEVER_HELD;
    this.still = prefersReducedMotion();
    this.frameClock.reset();
    this.lives = [];
    this.pips = [];
    this.introTexts = [];
    this.introLives = [];
    this.shutter = null;
    this.shownCard = null;
    this.shownScore = 0;
    this.shownLevel = -1;
    this.bannerBonus = 0;
    this.bannerShown = false;
    this.clock = 0;
    this.toastLeft = 0;
    this.blink = NO_BLINK;
    this.livesShown = [];
    this.pipsShown = [];
    this.cogShown = null;
    this.drawnScore = -1;
    Object.assign(this.model, newHudModel());
  }

  create(): void {
    const text = (value: string, colour: number, depth: number, scale = 1): Phaser.GameObjects.BitmapText =>
      this.add.bitmapText(0, 0, FONT_KEY, value, FONT_SIZE * scale).setTint(colour).setDropShadow(1, 1, COLOR.void, 1).setDepth(depth);
    const icon = (frame: string): Phaser.GameObjects.Image => this.add.image(0, 0, TEXTURE_KEY.sprites, frame).setOrigin(0, 0).setDepth(DEPTH.bar);

    this.strip = this.add.rectangle(0, 0, 1, STRIP_H, COLOR.void, STRIP_ALPHA).setOrigin(0, 0).setDepth(DEPTH.strip);
    this.lives = Array.from({ length: TUNING.lives.maxLives }, () => icon('hud_life_0'));
    this.livesShown = this.lives.map(() => true);
    this.level = text(TEXT.level(1), COLOR.white, DEPTH.bar);
    this.score = text(scoreDigits(0), COLOR.gold, DEPTH.bar);
    this.cog = icon('hud_cog_1');
    this.blaster = icon('hud_blaster_0').setVisible(false);
    this.thruster = icon('hud_thruster_0').setVisible(false);
    this.pips = Array.from({ length: FUEL_PIPS }, () => icon('hud_pip_1').setVisible(false));
    this.pipsShown = this.pips.map(() => null);
    this.toast = text(TEXT.cogFound, COLOR.gold, DEPTH.toast).setVisible(false);
    this.toastBand = this.add.rectangle(0, STRIP_H, 1, TOAST_BAND_BOTTOM - STRIP_H, COLOR.void, STRIP_ALPHA).setOrigin(0, 0).setDepth(DEPTH.strip).setVisible(false);
    this.bannerPlate = this.plate(DEPTH.banner).setVisible(false);
    this.bannerHeading = text(TEXT.levelClear(0), COLOR.white, DEPTH.banner + 1, 2).setVisible(false);
    this.bannerTally = text(TEXT.score(0), COLOR.gold, DEPTH.banner + 1).setVisible(false);
    this.introDim = this.add.rectangle(0, 0, 1, 1, COLOR.void, INTRO_DIM).setOrigin(0, 0).setDepth(DEPTH.dim).setVisible(false);
    this.introPlate = this.plate(DEPTH.card).setVisible(false);
    this.shutter = new Shutter(this, DEPTH.shutter);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
    onSceneEnd(this.events, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
    });
  }

  // -------------------------------------------------------------------------------------
  // Pushed by the Play scene and the EventRouter
  // -------------------------------------------------------------------------------------

  /** Every rendered frame, after Play's ticks. The model is copied; the caller may reuse its object. */
  show(model: Readonly<HudModel>): void {
    const m = this.model;
    Object.assign(m, model);
    // A lower score (a new session) is shown at once, and so is the score a level starts with (its card comes up).
    this.shownScore = countScore(this.shownScore, m.score, 0, m.intro !== null && m.intro !== this.shownCard);
    if (m.levelNumber !== this.shownLevel) {
      this.shownLevel = m.levelNumber;
      this.level?.setText(TEXT.level(m.levelNumber));
    }
    if (m.intro !== this.shownCard) this.showIntro(m.intro);
    if (this.bannerShown && !m.exiting) this.clearBanner(); // the hero has left the airlock (or a new level began)
    this.draw();
  }

  /** The `COG FOUND! AIRLOCK OPEN` toast is up (the Play scene keeps score pop-ups below its band meanwhile). */
  get toastShowing(): boolean {
    return this.toast?.visible === true;
  }

  /** What is on screen now, for the test hook. */
  shown(): HudShown {
    return {
      intro: this.introTexts.map((t) => t.text),
      toast: this.toast?.visible === true ? this.toast.text : null,
      banner: this.bannerShown && this.bannerHeading ? this.bannerHeading.text : null,
      held: this.held(),
      drawn: this.children.list.flatMap((obj) => {
        const shape = bounded(obj);
        if (!shape || !shape.visible || (shape.alpha ?? 1) <= 0) return [];
        const b = shape.getBounds();
        return [{ kind: shape.type, x: b.x, y: b.y, w: b.width, h: b.height }];
      }),
    };
  }

  cogFound(): void {
    this.toastLeft = TUNING.effects.toastFrames;
    this.showToast(true);
  }

  levelClear(bonus: number): void {
    this.toastLeft = 0;
    this.showToast(false);
    this.bannerBonus = bonus;
    this.bannerShown = true;
    this.placeBanner();
    this.bannerPlate?.setVisible(true);
    this.bannerHeading?.setVisible(true);
    this.bannerTally?.setVisible(true);
  }

  lifeLost(lives: number): void {
    if (!this.still) this.blink = lifeBlink(lives);
  }

  /** Takes every toast and banner down (a new level). */
  clearMessages(): void {
    this.toastLeft = 0;
    this.blink = NO_BLINK;
    this.showToast(false);
    this.clearBanner();
  }

  /** The toast and the dark band behind it come and go together. */
  private showToast(on: boolean): void {
    this.toast?.setVisible(on);
    this.toastBand?.setVisible(on);
  }

  // -------------------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    // Held under the pause menu: nothing advances, and nothing is banked to catch up with after RESUME.
    const whole = this.frameClock.advance(delta, this.held());
    if (whole <= 0) return;
    this.clock += whole;
    if (this.toastLeft > 0) {
      this.toastLeft = Math.max(0, this.toastLeft - whole);
      if (this.toastLeft === 0) this.showToast(false);
    }
    this.blink = advanceBlink(this.blink, whole);
    this.shownScore = countScore(this.shownScore, this.model.score, whole);
    this.shutter?.advance(whole);
    this.draw();
  }

  private clearBanner(): void {
    this.bannerShown = false;
    this.bannerPlate?.setVisible(false);
    this.bannerHeading?.setVisible(false);
    this.bannerTally?.setVisible(false);
  }

  /** Brings every icon and number up to the model; touches only what changed (it runs every frame). */
  private draw(): void {
    const m = this.model;
    for (let i = 0; i < this.lives.length; i++) {
      const img = this.lives[i];
      if (!img) continue;
      const lit = lifeLit(i, m.lives, this.blink);
      if (this.livesShown[i] !== lit) {
        this.livesShown[i] = lit;
        img.setFrame(lit ? 'hud_life_0' : 'hud_life_1');
      }
      img.setVisible(i < m.maxLives);
    }
    // Text only when the number moved: no new string on the frames it stands still (most of them).
    if (this.drawnScore !== this.shownScore) {
      this.drawnScore = this.shownScore;
      this.score?.setText(scoreDigits(this.shownScore));
      if (this.bannerShown) this.bannerTally?.setText(TEXT.score(this.shownScore));
    }
    if (this.cogShown !== m.hasTrophy) {
      this.cogShown = m.hasTrophy;
      // Before it is taken the slot shows the cog's own filled shape, unlit (rust: the gold lane darkened), not the
      // light toothed ring of hud_cog_0, which read as a settings gear (the route watch): "a gold cog goes here".
      const cog = this.cog?.setFrame('hud_cog_1').clearTint();
      if (!m.hasTrophy) cog?.setTint(COLOR.rust).setTintMode(Phaser.TintModes.FILL);
    }
    this.blaster?.setVisible(m.hasBlaster);
    this.thruster?.setVisible(m.hasThruster);
    for (let i = 0; i < this.pips.length; i++) {
      const pip = this.pips[i];
      if (!pip) continue;
      const state = m.hasThruster ? pipLit(i, m.fuelPips, this.clock, this.still) : null;
      if (this.pipsShown[i] === state) continue;
      this.pipsShown[i] = state;
      pip.setVisible(state !== null).setFrame(state === true ? 'hud_pip_0' : 'hud_pip_1');
    }
  }

  private showIntro(card: IntroCard | null): void {
    this.shownCard = card;
    for (const t of this.introTexts) t.destroy();
    for (const img of this.introLives) img.destroy();
    this.introTexts = [];
    this.introLives = [];
    this.introDim?.setVisible(card !== null);
    this.introPlate?.setVisible(card !== null);
    if (!card) return;
    this.clearMessages();
    const { width, height } = this.scale;
    const layout = introLayout(width, height, card, cssPerArt()); // 2x name and hint where the pixels are small
    this.introTexts = layout.lines.map((line) => this.lineText(line, DEPTH.cardText));
    this.introLives = layout.lives.map((x, i) =>
      this.add
        .image(x, layout.livesY, TEXTURE_KEY.sprites, i < card.lives ? 'hud_life_0' : 'hud_life_1')
        .setOrigin(0, 0)
        .setDepth(DEPTH.cardText),
    );
    this.introPlate?.setPosition(layout.plate.x, layout.plate.y).setSize(layout.plate.w, layout.plate.h);
    // A new level: the shutter opens on it (section 9, level intro), and the canvas says which level.
    this.shutter?.open();
    setScreenLabel(this, layout.lines.map((l) => l.text));
  }

  private lineText(line: PlacedLine, depth: number): Phaser.GameObjects.BitmapText {
    return this.add
      .bitmapText(line.x, line.y, FONT_KEY, line.text, FONT_SIZE * line.scale)
      .setTint(COLOR[line.colour])
      .setDropShadow(1, 1, COLOR.void, 1)
      .setDepth(depth);
  }

  private plate(depth: number): Phaser.GameObjects.NineSlice {
    return this.add
      .nineslice(0, 0, TEXTURE_KEY.sprites, 'ui_panel_0', 24, 24, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER)
      .setOrigin(0, 0)
      .setDepth(depth);
  }

  private placeBanner(): void {
    const { width, height } = this.scale;
    const b = bannerLayout(width, height, this.bannerBonus, this.shownScore);
    this.bannerPlate?.setPosition(b.plate.x, b.plate.y).setSize(b.plate.w, b.plate.h);
    this.bannerHeading?.setText(b.heading.text).setPosition(b.heading.x, b.heading.y);
    this.bannerTally?.setText(b.tally.text).setPosition(b.tally.x, b.tally.y);
  }

  /** Re-places everything for the view size (Scale RESIZE). */
  private readonly layout = (): void => {
    const { width, height } = this.scale;
    // The PAUSE button is DOM, sized in CSS px from the right safe edge: keep its width free (in art px).
    const k = cssPerArt();
    const reserve = pauseReservePx(k, TUNING.touch.pauseMarginSide, TUNING.touch.pauseButtonSize);
    const gaps = canvasEdgeGapsCss(); // off a rounded corner of the glass where no inset says so (hudModel)
    const bar = topBarLayout(width, this.lives.length, reserve, cornerClearPx(gaps.left, k), cornerClearPx(gaps.right, k));
    this.strip?.setSize(width, STRIP_H);
    this.lives.forEach((img, i) => img.setPosition(bar.lives[i] ?? 0, bar.y));
    this.level?.setPosition(bar.levelX, bar.y);
    this.score?.setPosition(bar.scoreX, bar.y);
    this.cog?.setPosition(bar.cogX, bar.y);
    this.blaster?.setPosition(bar.blasterX, bar.y);
    this.thruster?.setPosition(bar.thrusterX, bar.y);
    this.pips.forEach((pip, i) => pip.setPosition(bar.pips[i] ?? 0, PIP_Y));
    if (this.toast) {
      const w = textPx(this.toast.text);
      const x = Math.floor((width - w) / 2);
      this.toast.setPosition(x, TOAST_Y);
      this.toastBand?.setPosition(x - TOAST_PAD, STRIP_H).setSize(w + 2 * TOAST_PAD, TOAST_BAND_BOTTOM - STRIP_H);
    }
    this.placeBanner();
    this.introDim?.setSize(width, height);
    if (this.shownCard) {
      // The card again for the new size: rebuilt from its pure layout.
      const card = this.shownCard;
      this.shownCard = null;
      const left = this.shutter?.isOpen ?? true;
      this.showIntro(card);
      if (left) this.shutter?.advance(Number.MAX_SAFE_INTEGER);
    }
    this.shutter?.draw();
  };
}
