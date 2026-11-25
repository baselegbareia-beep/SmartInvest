/**
 * The test hook `window.__E2E__` (docs/ARCHITECTURE.md 11.6). main.ts loads this module only with
 * `?e2e=1` or in a dev build, as its own chunk, so a normal visit neither downloads nor exposes it.
 *
 * Members:
 *   state()        the session in numbers (null before the first level is played)
 *   held()         the buttons held right now (`controls.held()`): what the keyboard and the pad report
 *   startLevel(id) a one-level session that is never saved: 'test', 'debug', 'level-01' ...
 *   replay(...)    a one-level session fed by an input script through the same step(), a fixed number
 *                  of ticks per rendered frame (or, `realTime`, the real stepper's, drawn interpolated as in
 *                  play), drawn and routed normally; resolves with what happened
 *   renderEffect   src/audio/offline.ts's renderEffect, unchanged (loaded on first use)
 *   freeze(on)     stops (and restarts) Phaser's updates and drawing, for a picture that must not move
 *   pace(n)        the Play scene steps exactly n frames per rendered frame from the controls (null: the
 *                  real stepper), so a test can change real keys between two given ticks on a busy machine
 *   freezeAtTick(t) resolves once run.tick reaches t, with the game frozen at that moment (checked after
 *                  every rendered frame inside the page). A test arms the next stop in the same page.evaluate
 *                  that resumes the game, freeze(false) and then freezeAtTick(t): no frame runs between the two.
 *                  Armed by a second round trip, the stop can come after its tick on a busy machine. Armed
 *                  first, a tick already reached freezes at once and the freeze(false) after it lets the game run on
 *   scenes()       the keys of the running scenes, in draw order
 *   menu()         the buttons of the menu on screen (the words drawn), where to tap them (CSS px), and whether
 *                  the menu takes picks yet (an end screen's lights its buttons after a moment)
 *   menuText()     the words of the menu on screen (headings, the title's prompt) and whether each is drawn now
 *   heroOnPage()   where the hero's sprite was last drawn, in CSS px of the page (to check it is clear of the pad)
 *   cellOnPage(c, r) where a level cell (the airlock's, a crystal's) was last drawn, in CSS px of the page
 *   look()         what the last frame drew of the effects: scroll with and without the shake, particles alive,
 *                  the score pop-ups and how far they have risen,
 *                  the screen flash and fade, the hero's frame (for the reduced-motion test)
 *   hud()          what the HUD shows: the intro card's lines, the toast, the banner, whether its clocks are held
 *   hudPixels(r)   how many pixels of a rectangle of the view the HUD scene changes, whatever draws them: the
 *                  frame is drawn again as it stands (nothing is stepped), without the HUD scene and with it
 *   listeners()    listeners on each scene's own event emitter, to see that scene restarts leave none behind
 *   sound()        the audio's state, for tests of the unlock and the mute
 */
import type * as Phaser from 'phaser';

import type { EffectRender, RenderName } from '../audio/offline';
import type { GameState, Input, InputScript, ReplayResult, RunPhase, SessionStatus } from '../core/types';
import { findLevel } from '../levels';

import { HudScene } from './scenes/HudScene';
import type { HudShown } from './scenes/HudScene';
import { openMenuTargets, openMenuTexts } from './scenes/menu';
import { PlayScene } from './scenes/PlayScene';
import type { PlayData, PlayMode } from './scenes/PlayScene';
import { devStart } from './scenes/sessions';
import { controls, sfx } from './singletons';

/** Phaser.Core.Events.POST_RENDER, spelled out: this module imports only Phaser's types. */
const PHASER_POST_RENDER = 'postrender';

export interface E2EState {
  readonly status: SessionStatus;
  readonly levelId: string;
  readonly levelIndex: number;
  readonly phase: RunPhase;
  readonly tick: number;
  readonly score: number;
  readonly lives: number;
  /** Sub-pixels (the core's own units). */
  readonly player: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly onGround: boolean };
  readonly hasTrophy: boolean;
  /** The Play scene's mode: 'intro' while the level's card is up (the core is not stepped), 'running', 'paused', 'ended'. */
  readonly mode: PlayMode;
}

export interface ReplayOptions {
  /** Stop once run.tick reaches this, for a picture of that moment. */
  readonly stopAtTick?: number;
  /** 'sessionEnd': go on through deaths and level changes to the end of the script or of the session (the End screen). */
  readonly until?: 'levelCompleted' | 'sessionEnd';
  /** Ticks from the real stepper, drawn as in play (interpolated on a fast display), not `ticksPerFrame` a frame. */
  readonly realTime?: boolean;
}

export interface E2EHook {
  state(): E2EState | null;
  held(): Input;
  startLevel(id: string): void;
  /**
   * `id` may also be a list of ids: a session of those levels in that order (never saved), to see a
   * level change; the script then runs on across it with `until: 'sessionEnd'`.
   */
  replay(id: string | readonly string[], script: InputScript, ticksPerFrame?: number, options?: ReplayOptions): Promise<ReplayResult>;
  renderEffect(what: string | readonly string[]): Promise<EffectRender>;
  freeze(on: boolean): void;
  /** The Play scene steps exactly this many frames per rendered frame, from the controls; null: the real stepper. */
  pace(framesPerRender: number | null): void;
  /**
   * Resolves with run.tick once it has reached `tick`, the game frozen (freeze(true)) at that moment. To go on from a
   * frozen game, call freeze(false) and then this in one page.evaluate, so the stop is armed before any frame runs.
   * In that order: for a tick already reached, this pauses at once and a freeze(false) after it lets the game run on.
   */
  freezeAtTick(tick: number): Promise<number>;
  scenes(): string[];
  /**
   * The buttons and switches of the menu on screen (title, pause or end), with where to tap them in
   * CSS px of the page: `{ label: 'RESUME', focused, x, y, w, h }`. Empty when no menu is up.
   */
  menu(): {
    readonly label: string;
    readonly focused: boolean;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /** The menu takes picks now: an end screen's takes none until its buttons light (menu.ts `armed`). */
    readonly armed: boolean;
  }[];
  /** The text entries of the menu on screen (headings, the title's prompt), each with whether it is drawn now (the prompt blinks). */
  menuText(): { readonly text: string; readonly shown: boolean }[];
  /** The hero's 16 px sprite as last drawn, in CSS px of the page; null before a level. */
  heroOnPage(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  /**
   * What the last frame drew of the effects: `scrollX`/`scrollY` as Phaser drew them (the shake included) and
   * `camX`/`camY`, the camera's own whole-pixel scroll; the shake; particles alive; the screen flash's and the
   * fade's strength (0 = none); the hero's frame, whether he is shown, and whether he is filled (a death's flash).
   */
  look(): ReturnType<PlayScene['lookNow']>;
  /** The level cell at (col, row), 0-based, as last drawn (the camera's scroll), in CSS px of the page; null before a level. */
  cellOnPage(col: number, row: number): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  /** What the HUD scene shows, or null while it is not running. */
  hud(): HudShown | null;
  /**
   * How many pixels of `rect` (art px of the view, which are the canvas's own pixels) the HUD scene changes now,
   * whatever kind of object draws them (a Graphics or a Text as much as an Image): the frame is drawn again as it
   * stands, stepping nothing, once with the HUD scene hidden and once with it shown. Null while it is not running.
   */
  hudPixels(rect: ViewRect): number | null;
  /** Listeners on each scene's `sys.events` (every scene, running or not), by scene key. */
  listeners(): Record<string, number>;
  sound(): { readonly state: string; readonly muted: boolean; readonly plays: number; readonly thrusting: boolean };
}

/** A rectangle in art px of the view. */
export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Draws the frame again as it stands (no scene is updated, nothing is stepped) and copies `rect` of the canvas,
 * clipped to it. Read in the same task as the drawing, so WebGL's drawing buffer still holds the frame.
 */
function drawAndRead(game: Phaser.Game, rect: ViewRect): Uint8ClampedArray {
  const renderer = game.renderer;
  renderer.preRender();
  game.scene.render(renderer);
  renderer.postRender();
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(game.canvas.width, Math.ceil(rect.x + rect.w)) - x);
  const h = Math.max(1, Math.min(game.canvas.height, Math.ceil(rect.y + rect.h)) - y);
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  if (!ctx) throw new Error('__E2E__.hudPixels: no 2D context');
  ctx.drawImage(game.canvas, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function snapshot(game: GameState, mode: PlayMode): E2EState {
  const p = game.run.player;
  return {
    status: game.session.status,
    levelId: game.level.id,
    levelIndex: game.session.levelIndex,
    phase: game.run.phase,
    tick: game.run.tick,
    score: game.session.score,
    lives: game.session.lives,
    player: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, onGround: p.onGround },
    hasTrophy: game.run.hasTrophy,
    mode,
  };
}

export function installE2EHook(game: Phaser.Game): void {
  const play = (): PlayScene | null => {
    const scene = game.scene.getScene('Play');
    return scene instanceof PlayScene ? scene : null;
  };

  /** Stops every running scene but Play and (re)starts Play with `data`. */
  const startPlay = (data: PlayData): void => {
    for (const scene of game.scene.getScenes(true)) {
      const key = scene.scene.key;
      if (key !== 'Play' && key !== 'Hud' && key !== 'Pause') game.scene.stop(key);
    }
    game.scene.start('Play', data); // a running Play is shut down (stopping Hud and Pause) and started again
  };

  /** Art px of the view to CSS px of the page: the canvas is placed and enlarged by a CSS transform (applyLayout). */
  const onPage = (r: { x: number; y: number; w: number; h: number } | null): { x: number; y: number; w: number; h: number } | null => {
    if (!r) return null;
    const box = game.canvas.getBoundingClientRect();
    const k = box.width / Math.max(1, game.scale.width);
    return { x: box.left + r.x * k, y: box.top + r.y * k, w: r.w * k, h: r.h * k };
  };

  const level = (id: string): ReturnType<typeof findLevel> & object => {
    const found = findLevel(id);
    if (!found) throw new Error(`__E2E__: there is no level "${id}"`);
    return found;
  };

  const hook: E2EHook = {
    state() {
      const scene = play();
      const sim = scene?.session;
      return scene && sim ? snapshot(sim, scene.playMode) : null;
    },
    held: () => controls.held(),
    startLevel(id) {
      startPlay(devStart(level(id)));
    },
    replay(id, script, ticksPerFrame = 1, options = {}) {
      const levels = typeof id === 'string' ? [level(id)] : id.map(level);
      if (!Number.isInteger(ticksPerFrame) || ticksPerFrame < 1) throw new Error('__E2E__.replay: ticksPerFrame must be a whole number of at least 1');
      // Numbered as `?level=` would number its first level (`LEVEL 8` for level-08), counting on from there.
      const first = levels[0] ? devStart(levels[0]).firstNumber : undefined;
      return new Promise<ReplayResult>((resolve) => {
        startPlay({
          levels,
          start: {},
          saved: false,
          ...(first === undefined ? {} : { firstNumber: first }),
          replay: {
            script,
            ticksPerFrame,
            ...(options.stopAtTick === undefined ? {} : { stopAtTick: options.stopAtTick }),
            ...(options.until === undefined ? {} : { until: options.until }),
            ...(options.realTime === undefined ? {} : { realTime: options.realTime }),
            done: resolve,
          },
        });
      });
    },
    async renderEffect(what) {
      // Its own chunk: the analysis code is not part of the game.
      const offline = await import('../audio/offline');
      return offline.renderEffect(what as RenderName | readonly RenderName[]);
    },
    freeze(on) {
      if (on) game.pause();
      else game.resume();
    },
    pace(framesPerRender) {
      if (framesPerRender !== null && (!Number.isInteger(framesPerRender) || framesPerRender < 1)) {
        throw new Error('__E2E__.pace: a whole number of at least 1, or null');
      }
      play()?.setPace(framesPerRender);
    },
    freezeAtTick(tick) {
      // POST_RENDER comes once per rendered frame, after all of that frame's ticks: checked there, the tick is seen
      // as each frame leaves it (every tick with pace(1)), and game.pause() keeps the next frame from stepping.
      return new Promise<number>((resolve) => {
        const check = (): void => {
          const now = play()?.session?.run.tick ?? -1;
          if (now < tick) return;
          game.events.off(PHASER_POST_RENDER, check);
          game.pause();
          resolve(now);
        };
        game.events.on(PHASER_POST_RENDER, check);
        check();
      });
    },
    scenes: () => game.scene.getScenes(true).map((scene) => scene.scene.key),
    menu() {
      // Art px to page CSS px: the canvas is placed and enlarged by a CSS transform (applyLayout).
      const box = game.canvas.getBoundingClientRect();
      const k = box.width / Math.max(1, game.scale.width);
      return openMenuTargets().map((t) => ({
        label: t.label,
        focused: t.focused,
        armed: t.armed,
        x: box.left + t.hit.x * k,
        y: box.top + t.hit.y * k,
        w: t.hit.w * k,
        h: t.hit.h * k,
      }));
    },
    menuText: () => openMenuTexts(),
    heroOnPage() {
      return onPage(play()?.heroOnView() ?? null);
    },
    look: () => play()?.lookNow() ?? null,
    cellOnPage(col, row) {
      return onPage(play()?.cellOnView(col, row) ?? null);
    },
    hud() {
      const scene = game.scene.getScene('Hud');
      return scene instanceof HudScene && game.scene.isActive('Hud') ? scene.shown() : null;
    },
    hudPixels(rect) {
      const scene = game.scene.getScene('Hud');
      if (!(scene instanceof HudScene) || !game.scene.isActive('Hud')) return null;
      const visible = scene.sys.settings.visible;
      try {
        scene.sys.setVisible(false);
        const without = drawAndRead(game, rect);
        scene.sys.setVisible(true);
        const withHud = drawAndRead(game, rect);
        let changed = 0;
        for (let i = 0; i < withHud.length; i += 4) {
          if (withHud[i] !== without[i] || withHud[i + 1] !== without[i + 1] || withHud[i + 2] !== without[i + 2]) changed += 1;
        }
        return changed;
      } finally {
        scene.sys.setVisible(visible);
      }
    },
    listeners() {
      const counts: Record<string, number> = {};
      for (const scene of game.scene.getScenes(false)) {
        const events = scene.sys.events;
        counts[scene.scene.key] = events.eventNames().reduce((n, name) => n + events.listenerCount(name), 0);
      }
      return counts;
    },
    sound: () => ({ state: sfx.state, muted: sfx.muted, plays: sfx.plays, thrusting: sfx.thrusting }),
  };
  window.__E2E__ = hook;
}
