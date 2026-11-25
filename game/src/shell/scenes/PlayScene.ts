/**
 * The Play scene: owns the GameState, the fixed-step loop, the world view, the camera and the
 * keyboard (docs/ARCHITECTURE.md 11.1, docs/PHASER4-NOTES.md sections 11 to 13 and 16).
 *
 * Modes:
 *   intro    the level's intro card is up (TUNING.effects.introFrames, skippable by a press after
 *            introSkipAfterFrames); the core is not stepped
 *   running  the core is stepped: one `controls.consume()` per tick, every tick drained by the router
 *   paused   the pause menu is up; nothing is stepped (the rotate guard also stops Phaser itself)
 *   ended    the session is over (End screen starting, Quit to title), or a replay has finished
 *
 * One frame of `update`, while intro or running:
 *   n = replay ? ticksPerFrame : stepper.advance(delta)        whole 60 Hz frames, 0..5
 *   each of the n frames is spent on, in this order:
 *     the intro card (counts its frames, may end it on a fresh press),
 *     a hit stop after a kill (HitStop, TUNING.effects.killHitStopFrames; never during a replay):
 *       no tick, and the view snaps so a fast display holds the picture instead of re-blending,
 *     or one tick: step(sim, input, events) → router.drain → stepCamera → view.capture
 *   then effects, sound loop, pad items and the HUD are pushed, the view draws with
 *   alpha = interpolation gate (1 at 60 Hz and in a replay: the current state exactly), and the
 *   effects pinned to the screen edge (the airlock pointer) are placed for the scroll just drawn.
 * Pausing also stands the particles still (Effects.setPaused) and the HUD's clocks (HudData.held).
 *
 * Public surface for the other scenes and the test hook: `pauseGame`, `resumeGame`, `restartLevel`,
 * `quitToTitle`, `session` (the GameState), `playMode`, `isReplaying`.
 */
import * as Phaser from 'phaser';

import { createSession, holdReady, restartLevel, step } from '../../core/game';
import { inputAtTick, inputFromBits, scriptTicks } from '../../core/script';
import { TICK_HZ, TILE_PX } from '../../core/types';
import type { DeathCause, GameEvent, GameState, Input, InputScript, ReplayResult } from '../../core/types';
import { MUTE_KEYS, PAUSE_KEYS, installKeyboard, releaseKeys } from '../../input/keyboard';
import { TUNING } from '../../tuning';
import { NO_CAMERA, cameraTarget, levelSize, snapCamera, stepCamera } from '../camera';
import type { CameraState, FrameScene, PadButtonsOnView, PadReach, Size } from '../camera';
import { Effects } from '../Effects';
import { EventRouter } from '../EventRouter';
import type { HudEvents, RouterHost, SessionEnd } from '../EventRouter';
import { FixedStepper } from '../FixedStepper';
import { onFreshKey } from '../freshKey';
import { onSceneEnd } from '../sceneEnd';
import { HitStop } from '../hitStop';
import { InterpolationGate } from '../interpolation';
import { controls, haptics, onPadPause, pad, padButtonsOnView, padReachNow, phys, progress, settings, sfx } from '../singletons';
import { WorldView } from '../WorldView';

import type { EndData } from './EndScene';
import { FUEL_PIPS, HudScene, newHudModel } from './HudScene';
import type { HudData, IntroCard } from './HudScene';
import { againStart, levelNumberOf } from './sessions';
import type { PlayStart } from './sessions';

export type PlayMode = 'intro' | 'running' | 'paused' | 'ended';

/** A replay for the test hook (docs/ARCHITECTURE.md 11.6). */
export interface ReplaySpec {
  readonly script: InputScript;
  /** Ticks stepped per rendered frame: fixed, so frame timing cannot change the result. */
  readonly ticksPerFrame: number;
  /** Stop once run.tick reaches this (for a picture of one moment); the result then says not won. */
  readonly stopAtTick?: number;
  /**
   * 'levelCompleted' (the default, as replayScript in Node): stop at the airlock or at the first death.
   * 'sessionEnd': go on through deaths, level changes and the end of the session (the End screen), for
   * pictures of those; the result still reports the first death and the first win.
   */
  readonly until?: 'levelCompleted' | 'sessionEnd';
  /** Called once, when the replay stops: the win, the first death, the end of the script, or stopAtTick. */
  readonly done: (result: ReplayResult) => void;
}

/** The data of `scene.start('Play', data)`. */
export interface PlayData extends PlayStart {
  /** Feed this script instead of the controls; no intro card and no hit stop. */
  readonly replay?: ReplaySpec;
}

/** Feeds a script tick by tick and watches for the cog, the airlock and a death, as replayScript does in Node. */
class ReplayRun {
  readonly spec: ReplaySpec;
  private readonly total: number;
  private ticks = 0;
  private trophyTick = -1;
  private winTick = -1;
  private died: DeathCause | null = null;
  finished = false;

  constructor(spec: ReplaySpec) {
    this.spec = spec;
    this.total = scriptTicks(spec.script);
  }

  next(): Input {
    const bits = inputAtTick(this.spec.script, this.ticks);
    this.ticks += 1;
    return inputFromBits(bits);
  }

  observe(game: GameState, events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'trophyCollected' && this.trophyTick < 0) this.trophyTick = game.run.tick;
      if (event.type === 'levelCompleted' && this.winTick < 0) this.winTick = game.run.tick;
      if (event.type === 'playerDied' && this.died === null) this.died = event.cause;
    }
    const stop = this.spec.stopAtTick;
    const atLevelEnd = this.spec.until !== 'sessionEnd' && (this.winTick >= 0 || this.died !== null);
    if (atLevelEnd || this.ticks >= this.total || (stop !== undefined && game.run.tick >= stop) || game.session.status !== 'playing') {
      this.finish();
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.spec.done({
      won: this.winTick >= 0 && this.died === null,
      trophyTick: this.trophyTick,
      winTick: this.winTick,
      died: this.died,
      ticks: this.ticks,
    });
  }
}

export class PlayScene extends Phaser.Scene {
  private startData: PlayData = { levels: [], start: {}, saved: false };
  private sim: GameState | null = null;
  private mode: PlayMode = 'intro';
  private resumeTo: 'intro' | 'running' = 'running';
  private leaving = false;
  private replay: ReplayRun | null = null;
  /**
   * Test hook only (`__E2E__.pace`): step exactly this many 60 Hz frames per rendered frame from the controls,
   * instead of what the stepper measures, so a browser test can change real keys between two given ticks even
   * on a loaded machine. Kept across scene restarts on purpose; null (the game) uses the stepper.
   */
  private pace: number | null = null;

  private readonly tickEvents: GameEvent[] = [];
  private readonly stepper = new FixedStepper(1000 / TICK_HZ, TUNING.pacing.maxStepsPerFrame);
  private readonly gate = new InterpolationGate(TUNING.pacing.interpolateBelowMs);
  private cam: CameraState = NO_CAMERA;
  private viewSize: Size = { w: 1, h: 1 };
  private levelPx: Size = { w: 1, h: 1 };
  private snapPending = false;
  /** How far the touch buttons reach into the view (art px): the view may pass a side wall by that much. */
  private readonly padReach: PadReach = { left: 0, right: 0, bottom: 0 };
  /** What the standing view frames (camera.ts, `frameShift`): the game and the pad's buttons over the view. Refilled every tick. */
  private readonly frameScene: { game: GameState | null; buttons: PadButtonsOnView | null } = { game: null, buttons: null };
  /** The hold after a kill (TUNING.effects.killHitStopFrames); a replay's ignores every request. */
  private hitStop = new HitStop();

  private introCard: IntroCard | null = null;
  private introAge = 0;
  /** Whether a button was held on the previous intro frame: only a fresh press skips the card. */
  private introHeld = true;

  private view: WorldView | null = null;
  private effects: Effects | null = null;
  private router: EventRouter | null = null;
  private readonly hudModel = newHudModel();

  constructor() {
    super('Play');
  }

  // -------------------------------------------------------------------------------------
  // Read by the test hook and the other scenes
  // -------------------------------------------------------------------------------------

  /** The game being played, or null before the first session. Read only. */
  get session(): GameState | null {
    return this.sim;
  }

  get playMode(): PlayMode {
    return this.mode;
  }

  get isReplaying(): boolean {
    return this.replay !== null;
  }

  /** Test hook only: the hero's 16 px sprite as last drawn, art px from the view's top-left corner (null before a level). */
  heroOnView(): { x: number; y: number; w: number; h: number } | null {
    const view = this.view;
    if (!this.sim || !view) return null;
    // Where he is drawn: the core's place, except where the picture moves him (into the airlock, a fall's edge).
    const at = view.heroDrawn();
    return { x: at.x - view.camX, y: at.y - view.camY, w: TILE_PX, h: TILE_PX };
  }

  /** Test hook only: a level cell as last drawn, art px from the view's top-left corner (null before a level). */
  cellOnView(col: number, row: number): { x: number; y: number; w: number; h: number } | null {
    const view = this.view;
    if (!this.sim || !view) return null;
    return { x: col * TILE_PX - view.camX, y: row * TILE_PX - view.camY, w: TILE_PX, h: TILE_PX };
  }

  /**
   * Test hook only: what the last frame drew of the effects: the scroll Phaser drew with (shake included) and the
   * camera's own (without it), the shake, particles alive, the screen flash and fade, and the hero's look.
   */
  lookNow(): {
    scrollX: number;
    scrollY: number;
    camX: number;
    camY: number;
    shakeX: number;
    shakeY: number;
    particles: number;
    flash: number;
    fade: number;
    popups: number;
    popupRise: number;
    popupTop: number | null;
    popupBoxes: { x: number; y: number; w: number; h: number }[];
    pointer: string | null;
    hero: { frame: string; visible: boolean; filled: boolean; dim: boolean; prompt: boolean } | null;
  } | null {
    const view = this.view;
    const fx = this.effects;
    if (!view || !fx) return null;
    const cam = this.cameras.main;
    return { scrollX: cam.scrollX, scrollY: cam.scrollY, camX: view.camX, camY: view.camY, shakeX: fx.shakeX, shakeY: fx.shakeY, ...fx.shown(), hero: view.heroShown() };
  }

  /** Test hook only: a fixed number of frames per rendered frame (null: the real stepper). */
  setPace(framesPerRender: number | null): void {
    this.pace = framesPerRender;
    this.stepper.reset();
  }

  // -------------------------------------------------------------------------------------
  // Scene life
  // -------------------------------------------------------------------------------------

  /** Per-session state is reset here: Phaser reuses the scene object. */
  init(data: PlayData): void {
    this.startData = data;
    this.sim = null;
    this.mode = 'intro';
    this.resumeTo = 'running';
    this.leaving = false;
    this.replay = data.replay ? new ReplayRun(data.replay) : null;
    this.tickEvents.length = 0;
    this.stepper.reset();
    this.gate.reset();
    this.snapPending = false;
    this.hitStop = new HitStop(!data.replay);
    this.introCard = null;
    this.introAge = 0;
    this.introHeld = true;
    this.view = null;
    this.effects = null;
    this.router = null;
  }

  create(): void {
    // The HUD's toast, life blink, score count and shutter stand still while the pause menu is up, as the world does.
    const hudData: HudData = { held: () => this.mode === 'paused' };
    this.scene.launch('Hud', hudData);
    controls.releaseAll();
    this.viewSize = { w: this.scale.width, h: this.scale.height };
    const view = new WorldView(this);
    view.resize(this.viewSize.w, this.viewSize.h);
    this.view = view;
    const effects = new Effects(this, (id) => view.sprite(id));
    this.effects = effects;
    this.router = new EventRouter({
      sound: sfx,
      haptics,
      effects,
      hud: this.hudEvents,
      host: this.host,
      store: this.startData.saved && !this.replay ? progress : null,
    });

    const events: GameEvent[] = [];
    this.sim = createSession(this.startData.levels, phys, this.startData.start, events);
    this.router.drain(events, this.sim); // levelStarted: builds the level (host.levelStarted), saves the resume point
    view.capture(this.sim, this.cam);
    view.snap();
    this.snapPending = false;

    installKeyboard(this, controls, { isActive: () => this.mode === 'running' || this.mode === 'intro' });
    // Esc, P and M act once per key event (freshKey.ts): Phaser can hand a key's 'down' over twice, which toggled
    // the sound twice, and could re-open the pause menu with the very Esc that had just closed it.
    const keyRemovers = [
      onFreshKey(this, PAUSE_KEYS, () => {
        this.pauseGame();
      }),
      onFreshKey(this, MUTE_KEYS, () => {
        settings.toggleSound();
      }),
    ];
    onPadPause(() => {
      this.pauseGame();
    });
    pad.show();

    // Phaser keeps updating while blurred or hidden: pause explicitly (PHASER4-NOTES 16).
    this.game.events.on(Phaser.Core.Events.BLUR, this.autoPause);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.autoPause);
    window.addEventListener('pagehide', this.autoPause);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);

    onSceneEnd(this.events, (how) => {
      // Listeners on game.events, the scale manager and window are NOT removed by Phaser.
      this.game.events.off(Phaser.Core.Events.BLUR, this.autoPause);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.autoPause);
      window.removeEventListener('pagehide', this.autoPause);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
      for (const remove of keyRemovers.splice(0)) remove();
      onPadPause(() => undefined);
      pad.hide();
      controls.releaseAll();
      this.replay?.finish();
      this.view?.destroy();
      this.view = null;
      if (how === 'shutdown') {
        this.scene.stop('Hud'); // scene operations belong here only: inside 'destroy' (game.destroy()) they throw
        this.scene.stop('Pause');
      }
    });

    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      window.__GAME_READY__ = true;
    });
  }

  override update(_time: number, delta: number): void {
    const sim = this.sim;
    if (!sim || (this.mode !== 'running' && this.mode !== 'intro')) return;
    this.gate.sample(this.game.loop.rawDelta);
    padReachNow(this.padReach); // touch mode can change between frames (a key press turns it off)
    const n = this.replay ? this.replay.spec.ticksPerFrame : (this.pace ?? this.stepper.advance(delta));

    for (let i = 0; i < n; i++) {
      if (this.mode === 'intro') {
        this.introFrame();
        continue;
      }
      if (this.modeNow() !== 'running' || this.replay?.finished === true) break;
      if (this.hitStop.hold()) {
        // A kill holds the picture: no tick, and no blending back toward the tick before (fast displays).
        this.view?.snap();
        continue;
      }
      this.tickEvents.length = 0;
      const input = this.replay ? this.replay.next() : controls.consume(); // exactly one input sample per tick
      step(sim, input, this.tickEvents);
      this.afterTick(sim);
      this.replay?.observe(sim, this.tickEvents);
    }

    this.effects?.update(n, sim);
    this.pushFrame(sim);
    this.draw(sim);
  }

  // -------------------------------------------------------------------------------------
  // Called by the Pause scene, the pad, the rotate guard and the lifecycle listeners
  // -------------------------------------------------------------------------------------

  /** Opens the pause menu. Safe to call from anywhere, any number of times: does nothing unless playing. */
  pauseGame(): void {
    if ((this.mode !== 'running' && this.mode !== 'intro') || this.leaving || this.replay) return;
    this.resumeTo = this.mode;
    this.mode = 'paused';
    this.stepper.reset();
    this.gate.reset(); // nothing is drawn while paused: the measured interval starts afresh on resume
    sfx.silence();
    haptics.stop();
    this.hitStop.reset();
    this.effects?.setPaused(true); // particles stand still under the menu, like everything else
    pad.hide(); // the menu underneath must get the taps
    releaseKeys(this, controls);
    controls.releaseAll();
    this.scene.launch('Pause');
  }

  /** Closes the pause: the world waits behind the core's ready gate for a fresh press (holdReady). */
  resumeGame(): void {
    if (this.mode !== 'paused' || this.leaving || !this.sim) return;
    this.mode = this.resumeTo;
    if (this.mode === 'running') holdReady(this.sim);
    this.stepper.reset();
    this.gate.reset();
    releaseKeys(this, controls);
    controls.releaseAll();
    this.introHeld = true;
    this.effects?.setPaused(false);
    pad.show();
  }

  /** Restart level from the pause menu: costs a life (the core's restartLevel), then resumes into the ready gate. */
  restartLevel(): void {
    const sim = this.sim;
    if (this.mode !== 'paused' || this.leaving || !sim) return;
    this.tickEvents.length = 0;
    restartLevel(sim, this.tickEvents);
    this.afterTick(sim);
    if (this.modeNow() === 'paused') {
      // A restart from a pause opened on the intro card ends the card: the restarted level waits at its ready gate
      // (the core's restartLevel brings no levelStarted, so nothing else would ever take the card down).
      this.resumeTo = 'running';
      this.introCard = null;
      this.introAge = TUNING.effects.introFrames;
      this.resumeGame();
    }
  }

  /** Quit to title: costs no life and writes nothing (the save already holds the level's starting point). */
  quitToTitle(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.mode = 'ended';
    this.scene.start('Title');
  }

  // -------------------------------------------------------------------------------------
  // Inside
  // -------------------------------------------------------------------------------------

  /** The mode as it is now: a method, so the compiler does not carry a narrowing across calls that change it. */
  private modeNow(): PlayMode {
    return this.mode;
  }

  private readonly autoPause = (): void => {
    this.pauseGame();
  };

  /** After a tick (or a Restart level): route its events, move the camera, capture the draw positions. */
  private afterTick(sim: GameState): void {
    this.router?.drain(this.tickEvents, sim);
    if (this.leaving) return;
    this.cam = stepCamera(this.cam, cameraTarget(sim), this.viewSize, this.levelPx, TUNING.camera, this.padReach, this.sceneFor(sim));
    this.view?.capture(sim, this.cam);
    if (this.snapPending) {
      this.snapPending = false;
      this.view?.snap();
    }
  }

  /** The camera's framing input for this tick: the game and the pad's buttons as drawn over the view (null: keys). */
  private sceneFor(sim: GameState): FrameScene {
    this.frameScene.game = sim;
    this.frameScene.buttons = padButtonsOnView();
    return this.frameScene as FrameScene;
  }

  /** One 60 Hz frame of the intro card: it ends after introFrames, or on a fresh press after introSkipAfterFrames. */
  private introFrame(): void {
    this.introAge += 1;
    const input = controls.consume(); // used up here: the press that skips the card is not a press in the level
    const any = input.left || input.right || input.jump || input.fire || input.thrust;
    const pressed = any && !this.introHeld;
    this.introHeld = any;
    const fx = TUNING.effects;
    if (this.introAge >= fx.introFrames || (pressed && this.introAge >= fx.introSkipAfterFrames)) {
      this.mode = 'running';
      this.introCard = null;
    }
  }

  private pushFrame(sim: GameState): void {
    const run = sim.run;
    const p = run.player;
    pad.setItems(p.hasBlaster, p.hasThruster, run.bolt.active, p.fuel === 0);
    if (this.mode === 'running') sfx.update(sim); // the thrust loop and the low-fuel beep follow the state
    const hud = this.hud();
    if (!hud) return;
    const m = this.hudModel;
    m.lives = sim.session.lives;
    m.maxLives = sim.phys.maxLives;
    m.levelNumber = levelNumberOf(this.startData, sim.session.levelIndex);
    m.score = sim.session.score;
    m.hasTrophy = run.hasTrophy;
    m.hasBlaster = p.hasBlaster;
    m.hasThruster = p.hasThruster;
    m.fuelPips = p.hasThruster ? Math.ceil((p.fuel * FUEL_PIPS) / Math.max(1, sim.phys.fuelTicks)) : 0;
    m.intro = this.introCard;
    m.exiting = run.phase === 'exiting';
    hud.show(m);
  }

  /** Draws the world (interpolated on fast displays, never in a replay), then what is pinned to the screen edge. */
  private draw(sim: GameState): void {
    const view = this.view;
    if (!view) return;
    const alpha = this.replay ? 1 : this.gate.alpha(this.stepper);
    const fx = this.effects;
    view.render(sim, alpha, fx?.shakeX ?? 0, fx?.shakeY ?? 0);
    fx?.place(view.camX, view.camY, sim, this.hud()?.toastShowing ?? false);
  }

  /** The HUD scene once it has run create() (it is launched in create() and starts a frame later). */
  private hud(): HudScene | null {
    const hud = this.scene.get('Hud');
    return hud instanceof HudScene && this.scene.isActive('Hud') ? hud : null;
  }

  private readonly onResize = (): void => {
    this.viewSize = { w: this.scale.width, h: this.scale.height };
    this.view?.resize(this.viewSize.w, this.viewSize.h);
    this.effects?.resize(this.viewSize.w, this.viewSize.h);
    const sim = this.sim;
    if (!sim) return;
    this.cam = snapCamera(cameraTarget(sim), this.viewSize, this.levelPx, TUNING.camera, padReachNow(this.padReach), this.sceneFor(sim));
    this.view?.capture(sim, this.cam);
    this.view?.snap();
    this.draw(sim);
  };

  /** The top bar's event messages, dropped while the HUD scene is not running yet. */
  private readonly hudEvents: HudEvents = {
    cogFound: () => {
      this.hud()?.cogFound();
    },
    levelClear: (bonus) => {
      this.hud()?.levelClear(bonus);
    },
    lifeLost: (lives) => {
      this.hud()?.lifeLost(lives);
    },
  };

  /** What the EventRouter asks of this scene. */
  private readonly host: RouterHost = {
    levelStarted: () => {
      const sim = this.sim;
      if (!sim || !this.view) return;
      this.view.buildLevel(sim);
      this.levelPx = levelSize(sim.level);
      // FIRE goes beside JUMP in a level without a thruster pack (THRUST's place); before the camera measures the pad.
      pad.setSlots({ fireBesideJump: !sim.level.pickups.some((p) => p.kind === 'thruster') });
      this.cam = snapCamera(cameraTarget(sim), this.viewSize, this.levelPx, TUNING.camera, padReachNow(this.padReach), this.sceneFor(sim));
      this.snapPending = true;
      this.stepper.reset();
      this.gate.reset();
      this.hitStop.reset();
      if (this.replay) {
        this.mode = 'running'; // a replay has no intro card: the script starts at the first tick
        return;
      }
      this.mode = 'intro';
      this.introAge = 0;
      this.introHeld = true;
      this.introCard = {
        levelNumber: levelNumberOf(this.startData, sim.session.levelIndex),
        name: sim.level.name,
        teaches: sim.level.teaches,
        lives: sim.session.lives,
        maxLives: sim.phys.maxLives,
      };
    },
    respawned: () => {
      const sim = this.sim;
      if (!sim) return;
      this.cam = snapCamera(cameraTarget(sim), this.viewSize, this.levelPx, TUNING.camera, padReachNow(this.padReach), this.sceneFor(sim));
      this.snapPending = true;
      this.gate.reset();
    },
    hitStop: (frames) => {
      this.hitStop.request(frames); // never during a replay: its HitStop was built disabled
    },
    doorOpened: (tick) => {
      this.view?.doorOpened(tick);
    },
    ended: (end: SessionEnd) => {
      if (this.leaving) return;
      this.leaving = true;
      this.mode = 'ended';
      pad.hide();
      controls.releaseAll();
      this.replay?.finish();
      const data: EndData = {
        end,
        again: againStart(this.startData, end.outcome, end.highestUnlocked, this.startData.saved ? progress.current : null),
      };
      this.scene.start('End', data);
    },
  };
}
