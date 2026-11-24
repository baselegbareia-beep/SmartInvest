/**
 * The title screen (docs/ART-AND-SOUND.md section 9), and the screen parts the End and Hud scenes share
 * with it: the shutter wipe, the starry backdrop with the Earth and the crater ridge, Sprue on his
 * girder, and the canvas's accessible name.
 *
 * - Stars, the Earth (top left), the ridge along the bottom; Sprue idling on a girder that juts in
 *   from the left; `logo_cog` behind the first word of the game's name (3x, from src/meta.ts) over the
 *   rest of it (1x).
 * - With saved progress (docs/ARCHITECTURE.md 10): `CONTINUE - LEVEL n` and `NEW GAME`. Without:
 *   `TAP TO START` (`PRESS SPACE TO START` when the keyboard was used last), blinking once a second;
 *   a tap anywhere, or Space, Enter or a jump or fire key, starts a new game. `BEST 07900` once there
 *   is a best score. A build without any campaign level says so, and NEW GAME plays the test rooms.
 * - The sound switch in the top-right corner (a 12 px icon with a hit square of at least 44 CSS px),
 *   and the M key; the choice is saved in the settings.
 * - The first tap (its release) unlocks the audio and, on a touch device outside a frame, asks for
 *   fullscreen (ARCHITECTURE 11.5). A refusal is ignored.
 * - The screen opens with the 12-frame shutter wipe (none under reduced motion).
 */
import * as Phaser from 'phaser';

import { HERO_BLINK, TEXTURE_KEY } from '../../art/manifest';
import { COLOR } from '../../art/palette';
import { earthSpot, starField } from '../../art/tilePick';
import { CAMPAIGN, DEV_LEVELS } from '../../levels';
import { GAME_TITLE } from '../../meta';
import { onFreshKey } from '../freshKey';
import { cornerClearPx } from '../hudModel';
import { contains, cornerSwitch } from '../menuLayout';
import type { Rect } from '../menuLayout';
import { onSceneEnd } from '../sceneEnd';
import { SHUTTER_FRAMES, ridgeRow, screenLabel, shutterBlades, splitTitle, titleBest, titleScenery } from '../screens';
import type { Scenery } from '../screens';
import { app, canvasEdgeGapsCss, controls, cssPerArt, pad, progress, settings, sfx } from '../singletons';

import { Menu } from './menu';
import type { MenuEntry } from './menu';
import { titleOffer } from './sessions';
import type { PlayStart } from './sessions';
import { TEXT } from './strings';

/** The start prompt blinks once a second (section 9): shown for this many frames of every 60. */
const BLINK_ON_FRAMES = 40;
const FRAMES_PER_BLINK = 60;
const FRAME_MS = 1000 / 60;
/** The seed of the title's star field (any fixed number: the title always looks the same). */
const TITLE_STARS_SEED = 7;
/** The title's cog is drawn at twice its size behind the 3x name. */
const LOGO_SCALE = 2;
/** Keys that start the game from the prompt: the game's own jump and fire keys, Space and Enter. M is the sound. */
const START_KEYS = ['SPACE', 'ENTER', 'UP', 'W', 'X', 'Z'] as const;

/** The start jingle plays on the first start of a visit only (section 12: "the first tap on the title, once"). */
let jinglePlayed = false;

// ---------------------------------------------------------------------------------------
// Shared screen parts (Title, End, Hud)
// ---------------------------------------------------------------------------------------

/** True when the device asks for reduced motion: no shutter wipe then (docs/ART-AND-SOUND.md section 13). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Names what the canvas shows, for screen readers (the words are drawn in the pixel font, which a
 * reader cannot see) and for the browser tests. Never shown on screen.
 */
export function setScreenLabel(scene: Phaser.Scene, lines: readonly string[]): void {
  const canvas = scene.game.canvas;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', screenLabel(lines));
}

/** The words the canvas is named with now. */
export function screenLabelOf(scene: Phaser.Scene): string {
  return scene.game.canvas.getAttribute('aria-label') ?? '';
}

/** The 12-frame shutter wipe (section 9): two void blades with a slate edge that open from the middle. */
export class Shutter {
  private readonly blades: Phaser.GameObjects.Rectangle[];
  private readonly edges: Phaser.GameObjects.Rectangle[];
  private frame = SHUTTER_FRAMES;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    const rect = (colour: number, d: number): Phaser.GameObjects.Rectangle =>
      scene.add.rectangle(0, 0, 1, 1, colour).setOrigin(0, 0).setDepth(d).setVisible(false);
    this.blades = [rect(COLOR.void, depth), rect(COLOR.void, depth)];
    this.edges = [rect(COLOR.slate, depth + 1), rect(COLOR.slate, depth + 1)];
  }

  /** Shuts the shutter and starts opening it, unless the device asks for reduced motion. */
  open(): void {
    this.frame = prefersReducedMotion() ? SHUTTER_FRAMES : 0;
    this.draw();
  }

  get isOpen(): boolean {
    return this.frame >= SHUTTER_FRAMES;
  }

  /** Moves the blades on by whole 60 Hz frames. */
  advance(frames: number): void {
    if (this.isOpen || frames <= 0) return;
    this.frame = Math.min(SHUTTER_FRAMES, this.frame + frames);
    this.draw();
  }

  /** Draws the blades for the view as it is now (also on a resize). */
  draw(): void {
    const { width, height } = this.scene.scale;
    const b = shutterBlades(this.frame, height);
    const [top, bottom] = this.blades;
    const [topEdge, bottomEdge] = this.edges;
    if (!top || !bottom || !topEdge || !bottomEdge) return;
    const shown = b.topH > 0;
    top.setVisible(shown).setPosition(0, 0).setSize(width, b.topH);
    bottom.setVisible(shown).setPosition(0, b.bottomY).setSize(width, b.bottomH);
    topEdge.setVisible(shown).setPosition(0, Math.max(0, b.topH - 1)).setSize(width, 1);
    bottomEdge.setVisible(shown).setPosition(0, b.bottomY).setSize(width, 1);
  }
}

/**
 * The backdrop of the title and end screens (section 6: about 40 stars per screen in earthlight and
 * slate, the crescent Earth, the crater ridge), and optionally Sprue's girder with or without Sprue.
 * Still: the screens have no camera to scroll.
 */
export class Backdrop {
  private stars: Phaser.GameObjects.Rectangle[] = [];
  private earth: Phaser.GameObjects.Image;
  private ridges: Phaser.GameObjects.Image[] = [];
  private girder: Phaser.GameObjects.Image[] = [];
  private readonly hero: Phaser.GameObjects.Image;
  private builtFor = '';
  private heroClock = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: { readonly depth: number; readonly girder: boolean; readonly hero: boolean },
  ) {
    const d = options.depth;
    this.earth = scene.add.image(0, 0, TEXTURE_KEY.sprites, 'backdrop_earth_0').setOrigin(0, 0).setDepth(d + 1).setVisible(false);
    this.hero = scene.add.image(0, 0, TEXTURE_KEY.sprites, 'hero_idle_0').setOrigin(0, 0).setDepth(d + 4).setVisible(false);
  }

  /** Places everything for the view as it is now, around the menu's items (`taken`). */
  layout(taken: readonly Rect[]): Scenery {
    const { width, height } = this.scene.scale;
    const d = this.options.depth;
    const scenery = titleScenery(width, height, taken);
    const key = `${width}x${height}`;
    if (key !== this.builtFor) {
      // New size: a new star field and ridge row (rare: rotation or a window resize).
      this.builtFor = key;
      for (const s of this.stars) s.destroy();
      for (const r of this.ridges) r.destroy();
      this.stars = starField(TITLE_STARS_SEED, width, height).map((s) =>
        this.scene.add
          .rectangle(s.x, s.y, 1, 1, s.code === '6' ? COLOR.earthlight : COLOR.slate)
          .setOrigin(0, 0)
          .setDepth(d),
      );
      this.ridges = ridgeRow(width, height).map((at) =>
        this.scene.add.image(at.x, at.y, TEXTURE_KEY.sprites, 'backdrop_ridge_0').setOrigin(0, 0).setDepth(d + 2),
      );
    }
    // The Earth where the title puts it, or where the level backdrops would (a narrow view's own spot).
    const earthAt = scenery.earth ?? earthSpot(TITLE_STARS_SEED, width, height);
    this.earth.setPosition(earthAt.x, earthAt.y).setVisible(scenery.earth !== null);
    for (const g of this.girder) g.destroy();
    this.girder = this.options.girder
      ? scenery.girder.map((t) => this.scene.add.image(t.x, t.y, TEXTURE_KEY.tiles, t.frame).setOrigin(0, 0).setDepth(d + 3))
      : [];
    const hero = this.options.girder && this.options.hero ? scenery.hero : null;
    this.hero.setVisible(hero !== null);
    if (hero) this.hero.setPosition(hero.x, hero.y);
    return scenery;
  }

  /** Sprue's idle blink (section 4: frame 1 for 6 ticks of every 180). */
  advance(frames: number): void {
    this.heroClock += frames;
    const blink = this.heroClock % HERO_BLINK.everyTicks >= HERO_BLINK.everyTicks - HERO_BLINK.ticks;
    const frame = blink ? 'hero_idle_1' : 'hero_idle_0';
    if (this.hero.frame.name !== frame) this.hero.setFrame(frame);
  }
}

// ---------------------------------------------------------------------------------------
// The title
// ---------------------------------------------------------------------------------------

export class TitleScene extends Phaser.Scene {
  private started = false;
  private menu: Menu | null = null;
  private logo: Phaser.GameObjects.Image | null = null;
  private backdrop: Backdrop | null = null;
  private shutter: Shutter | null = null;
  private soundIcon: Phaser.GameObjects.Image | null = null;
  private soundHit: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private promptIndex = -1;
  /** How many entries the menu has, to keep the scenery off their ink (Menu.inkOf). */
  private entryCount = 0;
  private touchShown = false;
  private frames = 0;
  private age = 0;
  /** A press began on the screen (not on the sound switch): its release starts the game. */
  private armed = false;
  private soundArmed = false;
  private newGame: PlayStart | null = null;
  private readyFlagged = false;
  /** The words of the screen for its accessible name; the prompt's slot is filled in when the name is set. */
  private labelLines: string[] = [];

  constructor() {
    super('Title');
  }

  init(): void {
    this.started = false;
    this.menu = null;
    this.logo = null;
    this.backdrop = null;
    this.shutter = null;
    this.soundIcon = null;
    this.promptIndex = -1;
    this.entryCount = 0;
    this.frames = 0;
    this.age = 0;
    this.armed = false;
    this.soundArmed = false;
    this.newGame = null;
    this.readyFlagged = false;
    this.labelLines = [];
  }

  create(): void {
    pad.hide();
    controls.releaseAll();
    const offer = titleOffer(progress.current, CAMPAIGN, [DEV_LEVELS.test, DEV_LEVELS.debug]);
    const { first, rest } = splitTitle(GAME_TITLE);
    this.touchShown = app.classList.contains('touch');
    this.newGame = offer.newGame;

    const entries: MenuEntry[] = [{ kind: 'text', text: first, scale: 3, colour: COLOR.gold }];
    if (rest) entries.push({ kind: 'text', text: rest, colour: COLOR.white });
    entries.push({ kind: 'text', text: ' ' }); // a line of air between the name and what to do
    const continueRun = offer.continueRun;
    if (continueRun) {
      entries.push({ kind: 'button', text: TEXT.continueLevel(continueRun.levelNumber), onPick: () => { this.begin(continueRun.play); } });
      entries.push({ kind: 'button', text: TEXT.newGame, onPick: () => { this.begin(offer.newGame); } });
    } else {
      this.promptIndex = entries.length;
      entries.push({ kind: 'text', text: this.prompt(), colour: COLOR.white });
    }
    const best = titleBest(progress.current.bestScore);
    if (best) entries.push({ kind: 'text', text: best, colour: COLOR.gold });
    if (offer.noCampaign) entries.push({ kind: 'text', text: TEXT.noCampaign, colour: COLOR.lightSteel });
    this.entryCount = entries.length;
    this.labelLines = entries.flatMap((e) => (e.kind === 'switches' || e.text.trim() === '' ? [] : [e.text]));

    this.backdrop = new Backdrop(this, { depth: -10, girder: true, hero: true });
    // The cog behind the name, as a stamped indigo shape at 2x: drawn in its own gold at 1x it sat behind the R of
    // the gold name and the R could not be read; as a dark plate behind the whole word the name reads at once.
    this.logo = this.add
      .image(0, 0, TEXTURE_KEY.sprites, 'logo_cog_0')
      .setOrigin(0, 0)
      .setScale(LOGO_SCALE)
      .setTint(COLOR.indigo)
      .setTintMode(Phaser.TintModes.FILL)
      .setDepth(-1);
    this.menu = new Menu(this, entries, { panel: false, dim: false });
    this.soundIcon = this.add.image(0, 0, TEXTURE_KEY.sprites, 'btn_sound_0').setOrigin(0, 0).setDepth(5);
    this.shutter = new Shutter(this, 100);
    this.layout();
    this.showSound();
    this.shutter.open();
    setScreenLabel(this, this.label());

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp);
    // The first tap anywhere asks for fullscreen, inside the same release that unlocks the audio.
    this.input.once(Phaser.Input.Events.POINTER_UP, this.requestFullscreen);
    const removers = [
      onFreshKey(this, ['M'], () => {
        this.toggleSound();
      }),
    ];
    if (!continueRun) {
      removers.push(
        onFreshKey(this, START_KEYS, () => {
          this.begin(offer.newGame);
        }),
      );
    }

    onSceneEnd(this.events, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
      for (const remove of removers.splice(0)) remove();
    });
  }

  override update(_time: number, delta: number): void {
    this.frames += delta / FRAME_MS;
    const whole = Math.floor(this.frames);
    if (whole <= 0) return;
    this.frames -= whole;
    this.age += whole;
    this.shutter?.advance(whole);
    this.backdrop?.advance(whole);
    if (!this.readyFlagged && this.shutter?.isOpen === true) {
      // The browser tests wait for this (e2e/smoke.spec.ts takes its picture then): the title is drawn, shutter open.
      this.readyFlagged = true;
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        window.__GAME_READY__ = true;
      });
    }
    if (this.promptIndex < 0 || !this.menu) return;
    this.menu.setTextVisible(this.promptIndex, this.age % FRAMES_PER_BLINK < BLINK_ON_FRAMES);
    const touch = app.classList.contains('touch');
    if (touch !== this.touchShown) {
      this.touchShown = touch;
      this.menu.setText(this.promptIndex, this.prompt());
      this.layout();
      setScreenLabel(this, this.label());
    }
  }

  private prompt(): string {
    return this.touchShown ? TEXT.tapToStart : TEXT.pressToStart;
  }

  private label(): string[] {
    const prompt = this.promptIndex >= 0 ? this.prompt() : null;
    const lines = this.labelLines.map((l) => (l === TEXT.tapToStart || l === TEXT.pressToStart ? (prompt ?? l) : l));
    return [...lines, TEXT.sound(settings.current.sound)];
  }

  /** Starts the session once, whatever asked first. */
  private begin(play: PlayStart): void {
    if (this.started) return;
    this.started = true;
    this.menu?.close();
    sfx.unlock(); // inside the gesture: the context exists before the first sound
    if (!jinglePlayed) {
      jinglePlayed = true;
      sfx.play('start');
    }
    this.scene.start('Play', play);
  }

  private toggleSound(): void {
    settings.toggleSound();
    this.showSound();
    if (settings.current.sound) sfx.play('uiOk'); // the player hears that it is on
    setScreenLabel(this, this.label());
  }

  private showSound(): void {
    this.soundIcon?.setFrame(settings.current.sound ? 'btn_sound_0' : 'btn_sound_1');
  }

  private readonly onDown = (pointer: Phaser.Input.Pointer): void => {
    const onSwitch = contains(this.soundHit, pointer.x, pointer.y);
    this.soundArmed = onSwitch;
    // Only the prompt screen starts on a tap anywhere; with buttons the menu handles its own.
    this.armed = !onSwitch && this.promptIndex >= 0;
  };

  private readonly onUp = (pointer: Phaser.Input.Pointer): void => {
    const onSwitch = contains(this.soundHit, pointer.x, pointer.y);
    if (this.soundArmed && onSwitch && !this.started) this.toggleSound();
    // Release, not press: a touch grants audio and fullscreen only when the finger lifts.
    if (this.armed && !onSwitch && this.newGame) this.begin(this.newGame);
    this.armed = false;
    this.soundArmed = false;
  };

  private readonly requestFullscreen = (): void => {
    try {
      // Touch devices only, never inside a frame (a preview pane), and only where the browser offers it (not on iPhones).
      if (app.classList.contains('touch') && window.self === window.top && this.scale.fullscreen.available && !this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
    } catch {
      // a refusal is fine: the game plays in the window
    }
  };

  /** Re-places the logo, the scenery, the sound switch and the shutter for the view (Scale RESIZE). */
  private readonly layout = (): void => {
    const menu = this.menu;
    if (!menu) return;
    const taken: Rect[] = [];
    for (let i = 0; i < this.entryCount; i++) {
      const ink = menu.inkOf(i); // at the scale drawn: 2x text where the pixels are small
      if (ink) taken.push(ink);
    }
    const word = menu.rectOf(0);
    if (word && this.logo) {
      const size = this.logo.displayWidth;
      const at = { x: word.x + Math.floor((word.w - size) / 2), y: word.y + Math.floor((word.h - size) / 2) };
      this.logo.setPosition(at.x, at.y);
      taken.push({ x: at.x, y: at.y, w: size, h: size });
    }
    const k = cssPerArt();
    const corner = cornerSwitch(this.scale.width, k, cornerClearPx(canvasEdgeGapsCss().right, k)); // off a rounded corner
    this.soundHit = corner.hit;
    this.soundIcon?.setPosition(corner.icon.x, corner.icon.y);
    taken.push(corner.icon);
    this.backdrop?.layout(taken);
    this.shutter?.draw();
  };
}
