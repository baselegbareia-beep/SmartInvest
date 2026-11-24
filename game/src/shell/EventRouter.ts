/**
 * Drains each tick's GameEvents into everything that reacts to them (docs/ARCHITECTURE.md 11.3):
 * sound, vibration, visual effects, the top bar, the save, and the scene changes.
 *
 * The Play scene calls `drain(events, game)` once per simulated tick, right after `step` (and once
 * for the events of `createSession` and of `restartLevel`). For every tick, in this order:
 *
 *   1. `sound.tick()` once, before that tick's sounds (so the mixer's "once per tick" counts ticks);
 *   2. `effects.tick(game)` once: effects that follow the state (dust while running, the flame's
 *      sparks, the hard-landing tracker);
 *   3. for each event, in order: its sound (`sound.playEvent`), its vibration, its effect, its HUD
 *      message, and what the Play scene itself must do (rebuild on a new level, snap on a respawn,
 *      a hit stop on a kill, start the door's animation);
 *   4. the save: `applyEvents` over the tick's events, written only when it changed;
 *   5. last, the end of the session (`gameOver`, `gameWon`), handed to the host at most once, after
 *      the save has been written, so the End screen sees the save as it now is.
 *
 * Things that last (the thrust loop, the low-fuel beep, the FIRE and THRUST buttons) are not events:
 * the Play scene reads them from the state every frame.
 *
 * No Phaser here: every target is an interface, so the routing is unit-tested in Node with fakes.
 * Effects.ts and HudScene.ts implement `EffectsApi` and `HudEvents`.
 */
import { applyEvents } from '../core/save';
import type {
  DeathCause,
  EnemyKind,
  Facing,
  GameEvent,
  GameState,
  ItemKind,
  PickupKind,
  SaveData,
} from '../core/types';
import { TUNING } from '../tuning';

/** The sound calls the router makes (src/audio/Sfx.ts). */
export interface RouterSound {
  tick(): void;
  playEvent(event: GameEvent): void;
}

/** The vibration calls the router makes (src/input/haptics.ts). */
export interface RouterHaptics {
  death(): boolean;
  cog(): boolean;
  emptyTank(): boolean;
}

/**
 * The visual effects of docs/ART-AND-SOUND.md sections 4 (Effects) and 13, one method per event
 * that has one. Positions are the events' own: SUB-PIXEL world coordinates (`>> 8` for art pixels).
 * Implemented by src/shell/Effects.ts.
 */
export interface EffectsApi {
  /** Once per simulated tick, before the tick's events: effects that follow the state. */
  tick(game: GameState): void;
  /** A new level: forget everything in flight. */
  levelStarted(): void;
  jumped(x: number, y: number): void;
  /** `speed`: downward speed just before landing, sub-pixels per tick. */
  landed(x: number, y: number, speed: number): void;
  bonked(x: number, y: number): void;
  /** `score`: the points added (0 for items). */
  pickup(kind: PickupKind, x: number, y: number, score: number): void;
  pickupRestored(kind: ItemKind, x: number, y: number): void;
  trophyCollected(x: number, y: number, score: number): void;
  /** At the door cell. */
  doorOpened(x: number, y: number): void;
  boltFired(x: number, y: number, dir: Facing): void;
  boltEnded(x: number, y: number, hit: 'wall' | 'enemy' | 'range'): void;
  /**
   * `index`: the enemy's stable id (`enemy:<index>` in the view), so its last picture can flash white.
   * `score`: 0 when this enemy had already paid during this level visit.
   */
  enemyKilled(kind: EnemyKind, index: number, x: number, y: number, score: number): void;
  fuelEmptied(x: number, y: number): void;
  playerDied(cause: DeathCause, x: number, y: number): void;
  respawned(reason: 'death' | 'restart'): void;
  levelCompleted(bonus: number): void;
}

/** The top bar's event messages (src/shell/scenes/HudScene.ts). Its values are pushed every frame by the Play scene. */
export interface HudEvents {
  /** `COG FOUND! AIRLOCK OPEN` toast. */
  cogFound(): void;
  /** `LEVEL CLEAR +bonus` banner, for the exiting phase. */
  levelClear(bonus: number): void;
  /** The hero is back: the icon of the life just lost blinks. `lives` is the count now. */
  lifeLost(lives: number): void;
}

/** Where the progress lives (src/shell/singletons.ts). */
export interface SaveStore {
  /** The save as it is now. */
  readonly current: SaveData;
  /** Keeps `next` and writes it to storage. */
  write(next: SaveData): void;
}

/** How a session ended, for the End screen. */
export interface SessionEnd {
  readonly outcome: 'gameOver' | 'won';
  /** The final score (with the life bonus on a win). */
  readonly score: number;
  /** Lives left (0 after a game over). */
  readonly lives: number;
  /** Lives left times the bonus per life; 0 after a game over. */
  readonly lifeBonus: number;
  /** The best score as it was when the session began; null for a session that is never saved. */
  readonly previousBest: number | null;
  /** The highest level index reached in the session. */
  readonly highestUnlocked: number;
}

/** What the Play scene does on the events that concern it. */
export interface RouterHost {
  /** A level was loaded (session start or the next level): rebuild the world, snap the camera, show the intro. */
  levelStarted(levelIndex: number): void;
  /** The hero is back at the start (death or Restart level): snap the camera and the interpolation. */
  respawned(): void;
  /** Hold the picture for this many 60 Hz frames (a kill). The host ignores it during a replay. */
  hitStop(frames: number): void;
  /** The cog was taken this tick: the airlock's opening animation starts at `tick` (run.tick). */
  doorOpened(tick: number): void;
  /** The session ended. Called at most once per router. */
  ended(end: SessionEnd): void;
}

export interface RouterTargets {
  readonly sound: RouterSound;
  readonly haptics: RouterHaptics;
  readonly effects: EffectsApi;
  readonly hud: HudEvents;
  readonly host: RouterHost;
  /** The progress, for a campaign session; null for a session that is never saved. */
  readonly store: SaveStore | null;
}

export class EventRouter {
  private readonly t: RouterTargets;
  /** The best score when the session began: the save's own is raised before the End screen is built. */
  readonly previousBest: number | null;
  private endedOnce = false;

  constructor(targets: RouterTargets) {
    this.t = targets;
    this.previousBest = targets.store ? targets.store.current.bestScore : null;
  }

  /** True once the session's end has been handed to the host. */
  get hasEnded(): boolean {
    return this.endedOnce;
  }

  /** One simulated tick's events, in the order they happened. `game` is the state after the tick. */
  drain(events: readonly GameEvent[], game: GameState): void {
    const { sound, haptics, effects, hud, host, store } = this.t;
    sound.tick();
    effects.tick(game);
    let end: Extract<GameEvent, { type: 'gameOver' | 'gameWon' }> | null = null;

    for (const event of events) {
      sound.playEvent(event);
      switch (event.type) {
        case 'levelStarted':
          effects.levelStarted();
          host.levelStarted(event.levelIndex);
          break;
        case 'readyEnded':
        case 'thrustStarted':
        case 'thrustStopped':
          // The ready blink, the thrust loop and the flame follow the state.
          break;
        case 'jumped':
          effects.jumped(event.x, event.y);
          break;
        case 'landed':
          effects.landed(event.x, event.y, event.speed);
          break;
        case 'bonked':
          effects.bonked(event.x, event.y);
          break;
        case 'fuelEmptied':
          haptics.emptyTank();
          effects.fuelEmptied(event.x, event.y);
          break;
        case 'pickup':
          effects.pickup(event.kind, event.x, event.y, event.score);
          break;
        case 'pickupRestored':
          effects.pickupRestored(event.kind, event.x, event.y);
          break;
        case 'trophyCollected':
          haptics.cog();
          effects.trophyCollected(event.x, event.y, event.score);
          hud.cogFound();
          break;
        case 'doorOpened':
          effects.doorOpened(event.x, event.y);
          host.doorOpened(game.run.tick);
          break;
        case 'boltFired':
          effects.boltFired(event.x, event.y, event.dir);
          break;
        case 'boltEnded':
          effects.boltEnded(event.x, event.y, event.hit);
          break;
        case 'enemyKilled':
          effects.enemyKilled(event.kind, event.index, event.x, event.y, event.score);
          host.hitStop(TUNING.effects.killHitStopFrames);
          break;
        case 'playerDied':
          haptics.death();
          effects.playerDied(event.cause, event.x, event.y);
          break;
        case 'respawned':
          effects.respawned(event.reason);
          hud.lifeLost(event.lives);
          host.respawned();
          break;
        case 'levelCompleted':
          effects.levelCompleted(event.bonus);
          hud.levelClear(event.bonus);
          break;
        case 'gameOver':
        case 'gameWon':
          end ??= event;
          break;
      }
    }

    if (store !== null && events.length > 0) {
      const next = applyEvents(store.current, events);
      if (next !== store.current) store.write(next);
    }

    if (end !== null && !this.endedOnce) {
      this.endedOnce = true;
      host.ended({
        outcome: end.type === 'gameWon' ? 'won' : 'gameOver',
        score: end.score,
        lives: end.type === 'gameWon' ? end.lives : 0,
        lifeBonus: end.type === 'gameWon' ? end.lifeBonus : 0,
        previousBest: this.previousBest,
        highestUnlocked: game.session.highestUnlocked,
      });
    }
  }
}
