/**
 * The game's sound: hand-written Web Audio on one private AudioContext. No
 * Phaser (its sound system is switched off) and no audio files.
 *
 * What the rest of the shell does with it:
 *
 *   sfx.install()            once, in main.ts, before anything else. It only adds listeners:
 *                            the first tap or key press creates and starts the context, and
 *                            the page being hidden or losing focus suspends it.
 *   sfx.tick()               once per simulated tick, before that tick's events (EventRouter).
 *   sfx.playEvent(event)     for every GameEvent, in order (EventRouter).
 *   sfx.update(game)         once per rendered frame while the Play scene is stepping:
 *                            the thrust loop and the low-fuel beep follow the state.
 *   sfx.play('uiMove')       menu sounds and the title's 'start' jingle, by name.
 *   sfx.silence()            when the game pauses (PlayScene.pauseGame). Not when Play hands over
 *                            to the End scene: the game-over and win jingles ring on over it.
 *   sfx.setMuted(!sound)     the sound switch; also once at start-up with the saved setting.
 *
 * Rules it keeps by itself:
 * - Nothing is created before a user gesture, and nothing is queued while the
 *   context is locked. (One exception: a sound asked for inside the very
 *   gesture that starts the context is played as soon as it runs.)
 * - A sound asked for in the first WARM_UP_SECONDS of a new context starts
 *   when the master chain has settled, so the title's first tap is heard at
 *   full level.
 * - No voice is started while muted, while the page is hidden or while the
 *   context is not running. The context is suspended while the page is hidden,
 *   also when the page is hidden again while a resume is under way.
 * - At most MAX_VOICES voices sound at any moment; where one more is due, the
 *   oldest voice sounding at that moment is faded out. A voice scheduled for
 *   later (the airlock's hiss, the win's chord) counts only from its start.
 * - An effect is not started twice within one tick (two crystals in one tick
 *   give one note; on two ticks drained in one frame, two). `fuelLow` repeats
 *   every FUEL_LOW_BEEP_TICKS; `start` plays once.
 * - The thrust loop needs to be confirmed by `update` or `setThrust(true)` on
 *   every frame. Left alone (a pause, a scene that went away) it stops by itself.
 * - No method ever throws. Where audio is unavailable every call does nothing.
 */
import type { GameEvent } from '../core/types';
import { TUNING } from '../tuning';

import {
  DROP_FADE,
  GEM_RECIPES,
  MASTER_GAIN,
  MAX_VOICES,
  MUTE_RAMP,
  RECIPES,
  THRUST_LOOP,
  climbGemLadder,
  cuesForEvent,
  thrustState,
  ticksToSeconds,
} from './recipes';
import type { EffectName, GemStep, ShotRecipe, ThrustView } from './recipes';
import { createMaster, createNoiseBuffer, scheduleEffect } from './synth';
import type { ScheduledVoice } from './synth';

/**
 * The events on which a browser lets audio start. A touch counts only when
 * the finger lifts (`pointerup`, `touchend`); the mouse and the keyboard count
 * on the way down (docs/PHASER4-NOTES.md, section 15).
 */
export const UNLOCK_EVENTS = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'] as const;

/** The thrust loop stops by itself when it has not been confirmed for this long, milliseconds. */
export const LOOP_WATCHDOG_MS = 250;

/** A sound asked for while the context is still starting is played if the context runs within this time, milliseconds. */
const PENDING_MS = 300;
/** At most this many such sounds are remembered. */
const MAX_PENDING = 4;
/** After this many failed attempts to create an AudioContext, no further attempt is made. */
const MAX_FAILURES = 3;

/**
 * Sounds asked for in the first moments of a new context start this many
 * seconds after it was created (context time). The compressor at the end of
 * the master chain lets sound through at a reduced level while it settles:
 * measured in Chromium, a sound started at once peaks at 24 to 44 % of its
 * settled level, at 0.08 s at 93 %, from 0.12 s on at 100 %. This delays only
 * sounds asked for in the first 0.12 s after the unlock: the title's first tap.
 */
export const WARM_UP_SECONDS = 0.12;

/** Two context times closer than this are the same moment. */
const SAME_MOMENT = 1e-9;

/** A voice the mixer keeps track of. */
interface Tracked {
  readonly voice: ScheduledVoice;
  /** When it stops counting against MAX_VOICES: Infinity, or the moment it was dropped or faded out. */
  until: number;
}

/** True while the voice sounds at context time `t`: started, not over, not dropped. */
const soundsAt = (tracked: Tracked, t: number): boolean =>
  tracked.voice.start <= t + SAME_MOMENT && t < Math.min(tracked.until, tracked.voice.end);

interface PendingCue {
  readonly name: EffectName;
  readonly delay: number;
  readonly askedAt: number;
}

const wallClock = (): number => performance.now();
const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

export class Sfx {
  private ctx: AudioContext | null = null;
  /** The master gain: the sound switch moves it. */
  private master: GainNode | null = null;
  /** Every voice connects here. Replaced when everything must be cut at once. */
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private failures = 0;
  /** False while the page is hidden or has lost focus. */
  private wantRunning = true;
  /** True while a resume() started by a gesture has not finished. */
  private resuming = false;
  /** True while a suspend() has not finished. */
  private suspending = false;
  private mutedNow = false;
  /** Context time from which a sound comes out at full level (see WARM_UP_SECONDS). */
  private readyAt = 0;
  /** Shot voices that are sounding or due, and loop voices that are fading out. */
  private voices: Tracked[] = [];
  /** The thrust loop's voices while it sounds. */
  private loop: ScheduledVoice[] | null = null;
  private loopSeenAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** When each effect was last started: the context time it was asked for, and the tick it was asked on. */
  private readonly lastStart = new Map<EffectName, { readonly time: number; readonly tick: number }>();
  /** Counts `tick()` calls: the simulated tick the events being played belong to. */
  private tickNo = 0;
  private gem: GemStep | null = null;
  private pending: PendingCue[] = [];
  private started = 0;
  private installed = false;
  private readonly ladderWindow = ticksToSeconds(TUNING.effects.crystalLadderFrames);

  // -------------------------------------------------------------------------
  // Start-up and the page's life
  // -------------------------------------------------------------------------

  /**
   * Call once at start-up, before any gesture: it only adds listeners. From
   * then on every tap, click and key press unlocks (or re-starts) the audio,
   * and hiding or leaving the page suspends it. Returns a function that
   * removes the listeners again (tests use it; the game never needs to). A
   * second call while installed adds nothing.
   */
  install(): () => void {
    if (this.installed || typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
    this.installed = true;
    const followPage = (): void => {
      this.setActive(!document.hidden);
    };
    const leave = (): void => {
      this.setActive(false);
    };
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, this.unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', followPage);
    window.addEventListener('focus', followPage);
    window.addEventListener('pageshow', followPage);
    window.addEventListener('blur', leave);
    window.addEventListener('pagehide', leave);
    return () => {
      this.installed = false;
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
      document.removeEventListener('visibilitychange', followPage);
      window.removeEventListener('focus', followPage);
      window.removeEventListener('pageshow', followPage);
      window.removeEventListener('blur', leave);
      window.removeEventListener('pagehide', leave);
    };
  }

  /**
   * Creates the AudioContext if there is none yet and starts it. Browsers
   * allow that only inside a user gesture, so call this from a `pointerup`,
   * `touchend`, `mousedown`, `keydown` or `click` handler and from nowhere
   * else. `install()` already does so for every such event on the window; a
   * scene may call it again in its own handler to be sure the context exists
   * before it plays the first sound.
   */
  readonly unlock = (): void => {
    try {
      this.wantRunning = !pageHidden(); // a gesture proves the player is here, even if a focus event went missing
      this.ensure();
      this.sync();
    } catch {
      // sound is optional
    }
  };

  /**
   * false: the page is hidden or has lost focus. Everything is cut and the
   * context is suspended. true: the context runs again (the thrust loop comes
   * back with the next `update`). `install()` calls this by itself.
   */
  setActive(active: boolean): void {
    try {
      this.wantRunning = active;
      if (!active) this.cutEverything();
      this.sync();
    } catch {
      // sound is optional
    }
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------

  /**
   * Starts one effect by name, `delay` seconds from now. Returns true when it
   * was started; false when audio is locked, muted, hidden or unavailable,
   * when the effect was started too recently, or for the `thrust` loop (which
   * follows the state: see `update`).
   */
  play(name: EffectName, delay = 0): boolean {
    try {
      return this.startShot(name, delay);
    } catch {
      return false;
    }
  }

  /**
   * Call once per simulated tick, before that tick's events are played
   * (EventRouter.drain does it). "Not twice within one tick" then counts
   * ticks: two crystals taken on consecutive ticks that are drained in the
   * same rendered frame (a 30 Hz screen, a catch-up after a hitch) give two
   * notes, although the audio clock has not moved between them. Where it is
   * never called (menus), half a tick of audio time stands in for a tick.
   */
  tick(): void {
    this.tickNo += 1;
  }

  /** Plays what one GameEvent sounds like (nothing for the silent ones). Call it for every event, in order, after `tick()`. */
  playEvent(event: GameEvent): void {
    try {
      for (const cue of cuesForEvent(event)) this.startShot(cue.effect, cue.delay);
    } catch {
      // sound is optional
    }
  }

  /**
   * Makes the thrust loop and the low-fuel beep follow the game state. Call it
   * once per rendered frame while the game is being stepped, after the ticks.
   * When the calls stop (pause, scene change) the loop stops by itself within
   * LOOP_WATCHDOG_MS; call `silence()` to stop it at once.
   */
  update(game: ThrustView): void {
    try {
      const sound = thrustState(game);
      this.setThrust(sound.thrust, sound.fuelLow);
    } catch {
      // sound is optional
    }
  }

  /**
   * The same as `update` for a caller that has worked the two answers out
   * itself: `thrusting` keeps the loop sounding for another frame (or stops
   * it), `fuelLow` adds the repeating beep.
   */
  setThrust(thrusting: boolean, fuelLow = false): void {
    try {
      const c = this.ctx;
      const bus = this.bus;
      if (!thrusting || !c || !bus || c.state !== 'running' || this.mutedNow || !this.wantRunning) {
        this.stopLoop(THRUST_LOOP.fadeOut);
        return;
      }
      this.loopSeenAt = wallClock();
      if (!this.loop) {
        const now = c.currentTime;
        const at = Math.max(now, this.readyAt);
        this.loop = scheduleEffect(c, bus, at, THRUST_LOOP, this.noise ?? undefined);
        this.makeRoom(now, at, Infinity); // the loop's voices are held from now on
        this.watchdog ??= setInterval(this.checkLoop, LOOP_WATCHDOG_MS / 2);
      }
      if (fuelLow) this.startShot('fuelLow', 0);
    } catch {
      // sound is optional
    }
  }

  /**
   * Stops the thrust loop and fades out every voice that is sounding or
   * scheduled (the airlock's delayed hiss too), within DROP_FADE. The context
   * keeps running, so the pause menu can still play its own sounds.
   *
   * Call it when the game pauses. Do not call it when the Play scene ends
   * because of a game over or a win: those jingles are meant to ring on over
   * the End screen. A scene change needs no call for the thrust loop either:
   * the loop follows the state and stops by itself.
   */
  silence(): void {
    try {
      this.pending.length = 0;
      this.fadeEverything(DROP_FADE);
    } catch {
      // sound is optional
    }
  }

  /**
   * The sound switch. Muting slides the master gain to 0 in MUTE_RAMP, stops
   * the thrust loop and every voice, and no new voice is started until it is
   * switched back. The caller saves the choice in the settings.
   */
  setMuted(muted: boolean): void {
    try {
      this.mutedNow = muted;
      if (muted) {
        this.pending.length = 0;
        this.fadeEverything(MUTE_RAMP);
      }
      const c = this.ctx;
      const master = this.master;
      if (!c || !master) return;
      const now = c.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + MUTE_RAMP);
    } catch {
      // sound is optional
    }
  }

  // -------------------------------------------------------------------------
  // For tests and the debug overlay
  // -------------------------------------------------------------------------

  get muted(): boolean {
    return this.mutedNow;
  }

  /** 'none' until the first gesture (or where audio is unavailable), then the context's own state. */
  get state(): 'none' | AudioContextState {
    return this.ctx ? this.ctx.state : 'none';
  }

  /** True while the thrust loop sounds. */
  get thrusting(): boolean {
    return this.loop !== null;
  }

  /**
   * Voices sounding right now, the thrust loop's included. A voice that is
   * scheduled for later does not count yet; one being faded out to make room
   * no longer counts. Never above MAX_VOICES.
   */
  get voiceCount(): number {
    const now = this.ctx?.currentTime ?? 0;
    return this.voices.filter((tracked) => soundsAt(tracked, now)).length + (this.loop?.length ?? 0);
  }

  /** Effects started since the page loaded (the loop not counted). */
  get plays(): number {
    return this.started;
  }

  /** The context and its master gain, for a test that wants to measure the output. Null before the first gesture. */
  get output(): { ctx: AudioContext; node: GainNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, node: this.master } : null;
  }

  // -------------------------------------------------------------------------
  // Inside
  // -------------------------------------------------------------------------

  private ensure(): void {
    if (this.ctx || this.failures >= MAX_FAILURES) return;
    const scope = globalThis as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Context = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Context) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Context({ latencyHint: 'interactive' });
      const master = createMaster(ctx);
      master.input.gain.value = this.mutedNow ? 0 : MASTER_GAIN;
      master.output.connect(ctx.destination);
      const bus = ctx.createGain();
      bus.connect(master.input);
      this.noise = createNoiseBuffer(ctx);
      ctx.addEventListener('statechange', this.onStateChange);
      this.readyAt = ctx.currentTime + WARM_UP_SECONDS;
      this.ctx = ctx;
      this.master = master.input;
      this.bus = bus;
    } catch {
      this.failures += 1;
      this.ctx = null;
      this.master = null;
      this.bus = null;
      this.noise = null;
      if (ctx) void Promise.resolve(ctx.close()).catch(() => undefined);
    }
  }

  /**
   * Brings the context's state in line with `wantRunning`. A resume or a
   * suspend takes a moment; when it lands, the wish is checked again, so a page
   * hidden while its audio was starting ends up suspended, and one shown again
   * while its audio was stopping ends up running.
   */
  private sync(): void {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    if (!this.wantRunning) {
      if (c.state !== 'running' || this.suspending) return;
      this.suspending = true;
      const landed = (): void => {
        this.suspending = false;
        if (this.wantRunning) this.sync();
      };
      void Promise.resolve(c.suspend()).then(landed, landed);
      return;
    }
    if (c.state === 'running') return;
    this.resuming = true;
    void Promise.resolve(c.resume()).then(
      () => {
        this.resuming = false;
        if (this.wantRunning) this.flushPending();
        else this.sync();
      },
      () => {
        this.resuming = false;
        this.pending.length = 0;
      },
    );
  }

  /** The browser may stop the context on its own (a phone call, the screen lock): nothing may be left sounding when it returns. */
  private readonly onStateChange = (): void => {
    try {
      if (this.ctx?.state !== 'running') this.cutEverything();
      else if (this.wantRunning) this.flushPending();
      else this.sync(); // it started although the page has gone away meanwhile
    } catch {
      // sound is optional
    }
  };

  private flushPending(): void {
    if (this.ctx?.state !== 'running') return;
    const waiting = this.pending;
    this.pending = [];
    const now = wallClock();
    try {
      for (const cue of waiting) {
        if (now - cue.askedAt <= PENDING_MS) this.startShot(cue.name, cue.delay);
      }
    } catch {
      // sound is optional
    }
  }

  private startShot(name: EffectName, delay: number): boolean {
    const c = this.ctx;
    const bus = this.bus;
    if (!c || !bus || this.mutedNow || !this.wantRunning) return false;
    const recipe = RECIPES[name];
    if (recipe.kind !== 'shot') return false;
    if (c.state !== 'running') {
      // Still starting up inside the gesture that created it: keep the sound for the moment it runs.
      if (this.resuming) {
        this.pending.push({ name, delay, askedAt: wallClock() });
        if (this.pending.length > MAX_PENDING) this.pending.shift();
      }
      return false;
    }

    const now = c.currentTime;
    /** When the sound is meant to start; the rate limit and the crystal ladder go by this. */
    const asked = now + Math.max(0, delay);
    const last = this.lastStart.get(name);
    if (last !== undefined) {
      if (recipe.once === true) return false;
      const gap = recipe.minGapTicks ?? 1;
      // Half a tick of slack: the audio clock moves in small jumps, and "every 20 ticks" must not become "every 21".
      const tooSoon = asked - last.time < ticksToSeconds(Math.max(gap, 1) - 0.5);
      // Once per tick: refused only on the same tick. The audio clock stands still within a frame,
      // so it alone cannot tell two ticks drained in one frame apart.
      if (gap <= 1 ? tooSoon && last.tick === this.tickNo : tooSoon) return false;
    }

    let actual: ShotRecipe = recipe;
    if (name === 'gem') {
      this.gem = climbGemLadder(this.gem, asked, this.ladderWindow);
      actual = GEM_RECIPES[this.gem.step] ?? recipe;
    }
    const added = scheduleEffect(c, bus, Math.max(asked, this.readyAt), actual, this.noise ?? undefined);
    if (added.length === 0) return false;
    for (const voice of added) this.voices.push({ voice, until: Infinity });
    this.makeRoom(now, Math.min(...added.map((voice) => voice.start)), Math.max(...added.map((voice) => voice.end)));
    this.lastStart.set(name, { time: asked, tick: this.tickNo });
    this.started += 1;
    return true;
  }

  /**
   * Keeps the cap at every moment from `from` to `to` (context time), the span
   * of what was just scheduled. The count only grows where a voice starts, so
   * it is checked at `from` and wherever a voice starts inside the span (the
   * new ones, and ones scheduled earlier for later, like the airlock's). At
   * each such moment, while more than MAX_VOICES would sound there (the loop's
   * included), the oldest voice sounding then (the one that started first)
   * is faded out so that it is silent when the new voice starts (or within
   * DROP_FADE where that moment is now); a voice that has not started by then
   * is not counted and not touched. Loop voices are never dropped. Also
   * forgets voices that are over.
   */
  private makeRoom(now: number, from: number, to: number): void {
    this.voices = this.voices.filter((tracked) => tracked.voice.end > now);
    const held = this.loop?.length ?? 0;
    const starts = this.voices.map((tracked) => tracked.voice.start).filter((t) => t > from && t < to);
    const moments = [...new Set([from, ...starts])].sort((a, b) => a - b);
    for (const moment of moments) {
      // Oldest first; a stable sort keeps the order they were asked for among voices that start together.
      const sounding = this.voices.filter((tracked) => soundsAt(tracked, moment)).sort((a, b) => a.voice.start - b.voice.start);
      const at = Math.max(now, moment - DROP_FADE);
      for (let excess = sounding.length + held - MAX_VOICES, i = 0; excess > 0 && i < sounding.length; excess--, i++) {
        const oldest = sounding[i];
        if (!oldest) break;
        oldest.voice.stop(at, DROP_FADE);
        oldest.until = at;
      }
    }
  }

  private readonly checkLoop = (): void => {
    try {
      if (this.loop && wallClock() - this.loopSeenAt > LOOP_WATCHDOG_MS) this.stopLoop(THRUST_LOOP.fadeOut);
    } catch {
      // sound is optional
    }
  };

  private stopLoop(fade: number): void {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    const loop = this.loop;
    if (!loop) return;
    this.loop = null;
    const now = this.ctx?.currentTime ?? 0;
    for (const voice of loop) {
      voice.stop(now, fade);
      this.voices.push({ voice, until: Infinity }); // still a voice until its fade is over
    }
  }

  /** Fades out the loop and every voice, sounding or due, from now on. Those voices no longer count against the cap. */
  private fadeEverything(fade: number): void {
    this.stopLoop(fade);
    const now = this.ctx?.currentTime ?? 0;
    for (const tracked of this.voices) {
      tracked.voice.stop(now, fade);
      tracked.until = Math.min(tracked.until, now);
    }
    this.voices = this.voices.filter((tracked) => tracked.voice.end > now);
  }

  /**
   * Cuts everything this instant, for the moment before the context is
   * suspended: a fade would be frozen half-way and finish when the page comes
   * back. The old bus is disconnected, so nothing scheduled on it can be heard
   * again, whatever state its voices were in.
   */
  private cutEverything(): void {
    this.pending.length = 0;
    const hadVoices = this.loop !== null || this.voices.length > 0;
    this.fadeEverything(0);
    this.voices = [];
    const c = this.ctx;
    const master = this.master;
    const old = this.bus;
    if (!hadVoices || !c || !master || !old || c.state === 'closed') return;
    old.disconnect();
    const bus = c.createGain();
    bus.connect(master);
    this.bus = bus;
  }
}
