import { describe, expect, it } from 'vitest';

import { createSession, restartLevel, step } from '../core/game';
import { defaultSave } from '../core/save';
import { IN, NONE, REFERENCE_PHYS, levelFromRows } from '../core/testkit';
import type { GameEvent, GameState, LevelData, SaveData } from '../core/types';
import { TUNING } from '../tuning';

import { EventRouter } from './EventRouter';
import type { EffectsApi, HudEvents, RouterHaptics, RouterHost, RouterSound, SaveStore, SessionEnd } from './EventRouter';

/** Every call any target received, in order, as `target.method`. */
type Log = string[];

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the Proxy stands in for any target interface; T only names which
function recorder<T extends object>(name: string, log: Log): T {
  return new Proxy({} as T, {
    get(_target, method: string | symbol) {
      return (...args: unknown[]): boolean => {
        const shown = args.map((a) => (typeof a === 'object' && a !== null && 'type' in a ? (a as { type: string }).type : String(a)));
        log.push(method === 'tick' && name === 'effects' ? 'effects.tick' : `${name}.${String(method)}(${shown.join(',')})`);
        return true;
      };
    },
  });
}

interface Rig {
  router: EventRouter;
  log: Log;
  writes: SaveData[];
  ends: SessionEnd[];
  hitStops: number[];
  store: SaveStore;
}

function rig(saved: boolean, start: SaveData = defaultSave()): Rig {
  const log: Log = [];
  const writes: SaveData[] = [];
  const ends: SessionEnd[] = [];
  const hitStops: number[] = [];
  let current = start;
  const store: SaveStore = {
    get current() {
      return current;
    },
    write(next: SaveData) {
      writes.push(next);
      current = next;
    },
  };
  const host: RouterHost = {
    levelStarted: (i) => log.push(`host.levelStarted(${i})`),
    respawned: () => log.push('host.respawned()'),
    hitStop: (frames) => {
      hitStops.push(frames);
      log.push(`host.hitStop(${frames})`);
    },
    doorOpened: (tick) => log.push(`host.doorOpened(${tick})`),
    ended: (end) => {
      ends.push(end);
      log.push(`host.ended(${end.outcome})`);
    },
  };
  const router = new EventRouter({
    sound: recorder<RouterSound>('sound', log),
    haptics: recorder<RouterHaptics>('haptics', log),
    effects: recorder<EffectsApi>('effects', log),
    hud: recorder<HudEvents>('hud', log),
    host,
    store: saved ? store : null,
  });
  return { router, log, writes, ends, hitStops, store };
}

/** Steps `game` and drains every tick through the router, until `until` or `max` ticks. */
function run(r: Rig, game: GameState, input: string, until: (events: readonly GameEvent[]) => boolean, max = 600): void {
  const events: GameEvent[] = [];
  for (let i = 0; i < max; i++) {
    events.length = 0;
    step(game, input === '' ? NONE : IN(input), events);
    r.router.drain(events, game);
    if (until(events)) return;
  }
  throw new Error('the expected event never came');
}

const has = (type: GameEvent['type']) => (events: readonly GameEvent[]): boolean => events.some((e) => e.type === type);

/** Walk right into spikes. */
const SPIKES: LevelData = levelFromRows(['.P..S..TD', '#########'], { frame: true });
/** Walk right over the cog into the airlock. */
const WALK: LevelData = levelFromRows(['.P.T.D', '######'], { frame: true });

describe('EventRouter', () => {
  it('ticks the sound once per drained tick, before that tick sounds, then the state effects', () => {
    const r = rig(false);
    const game = createSession([WALK], REFERENCE_PHYS);
    r.router.drain([], game);
    r.router.drain([{ type: 'jumped', x: 1, y: 2 }], game);
    expect(r.log).toEqual([
      'sound.tick()',
      'effects.tick',
      'sound.tick()',
      'effects.tick',
      'sound.playEvent(jumped)',
      'effects.jumped(1,2)',
    ]);
  });

  it('a session start rebuilds the level and saves the resume point', () => {
    const r = rig(true);
    const events: GameEvent[] = [];
    const game = createSession([WALK], REFERENCE_PHYS, {}, events);
    r.router.drain(events, game);
    expect(r.log).toContain('effects.levelStarted()');
    expect(r.log).toContain('host.levelStarted(0)');
    expect(r.writes).toEqual([{ ...defaultSave(), resume: { levelIndex: 0, score: 0, lives: REFERENCE_PHYS.startLives } }]);
  });

  it('writes the save only when it changed', () => {
    const r = rig(true);
    const game = createSession([WALK], REFERENCE_PHYS);
    for (let i = 0; i < 20; i++) r.router.drain([], game);
    r.router.drain([{ type: 'jumped', x: 0, y: 0 }], game);
    expect(r.writes).toEqual([]);
  });

  it('never touches the save of an unsaved session, and has no previous best', () => {
    const r = rig(false, { ...defaultSave(), bestScore: 999 });
    const events: GameEvent[] = [];
    const game = createSession([WALK], REFERENCE_PHYS, {}, events);
    r.router.drain(events, game);
    expect(r.writes).toEqual([]);
    expect(r.router.previousBest).toBeNull();
  });

  it('the cog: vibration, effect, toast, and the airlock opening on that tick', () => {
    const r = rig(false);
    const game = createSession([WALK], REFERENCE_PHYS);
    // The ready gate opens on a press, not on a button held from the start: idle through it first.
    run(r, game, '', () => game.run.phaseTicks >= REFERENCE_PHYS.readyMinTicks);
    run(r, game, 'R', has('trophyCollected'));
    const tick = game.run.tick;
    const after = r.log.slice(r.log.indexOf('sound.playEvent(trophyCollected)'));
    expect(after).toEqual([
      'sound.playEvent(trophyCollected)',
      'haptics.cog()',
      expect.stringMatching(/^effects\.trophyCollected\(/) as unknown as string,
      'hud.cogFound()',
      'sound.playEvent(doorOpened)',
      expect.stringMatching(/^effects\.doorOpened\(/) as unknown as string,
      `host.doorOpened(${tick})`,
    ]);
  });

  it('a death: vibration and effect at once; the HUD blink and the camera snap at the respawn', () => {
    const r = rig(true);
    const events: GameEvent[] = [];
    const game = createSession([SPIKES], REFERENCE_PHYS, {}, events);
    r.router.drain(events, game);
    run(r, game, '', () => game.run.phase === 'ready' && game.run.readyArmed && game.run.phaseTicks >= REFERENCE_PHYS.readyMinTicks);
    run(r, game, 'R', has('playerDied'));
    expect(r.log.slice(-3)).toEqual(['sound.playEvent(playerDied)', 'haptics.death()', expect.stringMatching(/^effects\.playerDied\(spikes,/)]);
    expect(r.store.current.resume?.lives).toBe(REFERENCE_PHYS.startLives - 1);
    run(r, game, '', has('respawned'));
    expect(r.log.slice(-4)).toEqual([
      'sound.playEvent(respawned)',
      'effects.respawned(death)',
      `hud.lifeLost(${REFERENCE_PHYS.startLives - 1})`,
      'host.respawned()',
    ]);
  });

  it('the last life: the end is handed over once, after the save, with the best score from before the session', () => {
    const r = rig(true, { ...defaultSave(), bestScore: 50 });
    const events: GameEvent[] = [];
    const game = createSession([SPIKES], REFERENCE_PHYS, { lives: 1, score: 120 }, events);
    r.router.drain(events, game);
    run(r, game, '', () => game.run.phaseTicks >= REFERENCE_PHYS.readyMinTicks);
    run(r, game, 'R', has('playerDied'));
    // Saved at the death already, 52 ticks before gameOver: the end screen must not read it.
    expect(r.store.current.bestScore).toBe(120);
    run(r, game, '', has('gameOver'));
    expect(r.ends).toEqual([{ outcome: 'gameOver', score: 120, lives: 0, lifeBonus: 0, previousBest: 50, highestUnlocked: 0 }]);
    expect(r.store.current.resume).toBeNull();
    expect(r.log.at(-1)).toBe('host.ended(gameOver)');
    // Nothing more is handed over, whatever is drained later.
    r.router.drain([{ type: 'gameOver', score: 120 }], game);
    expect(r.ends).toHaveLength(1);
    expect(r.router.hasEnded).toBe(true);
  });

  it('Restart level on the last life ends the session through the same path', () => {
    const r = rig(false);
    const game = createSession([WALK], REFERENCE_PHYS, { lives: 1 });
    const events: GameEvent[] = [];
    restartLevel(game, events);
    r.router.drain(events, game);
    expect(r.ends.map((e) => e.outcome)).toEqual(['gameOver']);
    expect(r.ends[0]?.previousBest).toBeNull();
  });

  it('a win: banner at the clear, then the end with the life bonus', () => {
    const r = rig(true, { ...defaultSave(), bestScore: 10_000 });
    const events: GameEvent[] = [];
    const game = createSession([WALK], REFERENCE_PHYS, {}, events);
    r.router.drain(events, game);
    run(r, game, '', () => game.run.phaseTicks >= REFERENCE_PHYS.readyMinTicks);
    run(r, game, 'R', has('levelCompleted'));
    expect(r.log).toContain(`hud.levelClear(${REFERENCE_PHYS.scoreLevelClear})`);
    run(r, game, '', has('gameWon'));
    const lives = REFERENCE_PHYS.maxLives;
    expect(r.ends).toEqual([
      {
        outcome: 'won',
        score: REFERENCE_PHYS.scoreCog + REFERENCE_PHYS.scoreLevelClear + lives * REFERENCE_PHYS.scoreLifeLeft,
        lives,
        lifeBonus: lives * REFERENCE_PHYS.scoreLifeLeft,
        previousBest: 10_000,
        highestUnlocked: 0,
      },
    ]);
    expect(r.store.current.finished).toBe(true);
  });

  it('a kill asks the host for the hit stop of TUNING.effects', () => {
    const r = rig(false);
    const game = createSession([WALK], REFERENCE_PHYS);
    r.router.drain([{ type: 'enemyKilled', index: 2, kind: 'moth', x: 0, y: 0, score: 100 }], game);
    expect(r.hitStops).toEqual([TUNING.effects.killHitStopFrames]);
    expect(r.log).toContain('effects.enemyKilled(moth,2,0,0,100)');
  });

  it('the tank running dry buzzes', () => {
    const r = rig(false);
    const game = createSession([WALK], REFERENCE_PHYS);
    r.router.drain([{ type: 'fuelEmptied', x: 0, y: 0 }], game);
    expect(r.log).toContain('haptics.emptyTank()');
  });
});
