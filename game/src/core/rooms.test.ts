import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSession, step } from './game';
import { parseLevel } from './level';
import { inputAtTick, inputFromBits, scriptTicks } from './script';
import { REFERENCE_PHYS } from './testkit';
import type { DeathCause, GameEvent, InputScript, ItemKind } from './types';

/**
 * The two development rooms, won through the real core in Node by the same
 * input scripts the browser replays in e2e/rooms.spec.ts
 * (docs/ARCHITECTURE.md, section 2, "Tests and levels"). The scripts were
 * found by a throwaway search over the real step(); each file names its
 * level and the ticks at which the cog is taken and the airlock entered.
 *
 * They are replayed on REFERENCE_PHYS, like every rule test. The browser
 * plays them on the live TUNING, which equals the reference today; a tuning
 * change that breaks a route needs a new script, as it needs new validator
 * proofs.
 */

interface RoomScript extends InputScript {
  readonly levelId: string;
  readonly trophyTick: number;
  readonly winTick: number;
}

function readScript(id: string): RoomScript {
  return JSON.parse(readFileSync(new URL(`../../e2e/scripts/${id}.json`, import.meta.url), 'utf8')) as RoomScript;
}

function readLevel(id: string): string {
  return readFileSync(new URL(`../../levels/${id}.txt`, import.meta.url), 'utf8');
}

interface Replay {
  readonly trophyTick: number;
  readonly winTick: number;
  readonly died: DeathCause | null;
  readonly ticks: number;
  /** Every event, with the RunState.tick it happened on. */
  readonly log: readonly (readonly [number, GameEvent])[];
}

/** createSession([level]) and the script tick by tick, as replayScript will do: stop at the win, a death or the end. */
function replay(script: RoomScript): Replay {
  const level = parseLevel(readLevel(script.levelId), script.levelId);
  const game = createSession([level], REFERENCE_PHYS);
  const log: (readonly [number, GameEvent])[] = [];
  const events: GameEvent[] = [];
  let trophyTick = -1;
  let winTick = -1;
  let died: DeathCause | null = null;
  const total = scriptTicks(script);
  let ticks = 0;
  while (ticks < total && winTick < 0 && died === null) {
    events.length = 0;
    step(game, inputFromBits(inputAtTick(script, ticks)), events);
    ticks++;
    for (const event of events) {
      log.push([game.run.tick, event]);
      if (event.type === 'trophyCollected') trophyTick = game.run.tick;
      if (event.type === 'levelCompleted') winTick = game.run.tick;
      if (event.type === 'playerDied') died = event.cause;
    }
  }
  return { trophyTick, winTick, died, ticks, log };
}

const count = (log: Replay['log'], type: GameEvent['type']): number => log.filter(([, e]) => e.type === type).length;
const itemsTaken = (log: Replay['log']): ItemKind[] =>
  log.flatMap(([, e]) => (e.type === 'pickup' && e.kind !== 'crystal' ? [e.kind] : []));

describe.each(['test', 'debug'])('e2e/scripts/%s.json', (id) => {
  const script = readScript(id);
  const result = replay(script);

  it('is an InputScript for its own level that starts by idling through the ready minimum', () => {
    expect(script.levelId).toBe(id);
    for (const [bits, ticks] of script.runs) {
      expect(Number.isInteger(bits) && bits >= 0 && bits < 32, `bits ${bits}`).toBe(true);
      expect(Number.isInteger(ticks) && ticks > 0, `ticks ${ticks}`).toBe(true);
    }
    const first = script.runs[0];
    expect(first?.[0]).toBe(0);
    expect(first?.[1]).toBeGreaterThanOrEqual(REFERENCE_PHYS.readyMinTicks);
  });

  it('wins without a death: the cog at exactly trophyTick, the airlock at exactly winTick, on the last tick of the script', () => {
    expect(result.died).toBeNull();
    expect(result.trophyTick).toBe(script.trophyTick);
    expect(result.winTick).toBe(script.winTick);
    expect(result.trophyTick).toBeLessThan(result.winTick);
    expect(result.ticks).toBe(scriptTicks(script));
  });

  it('takes the cog before it reaches the open airlock, and the airlock is the end of the level', () => {
    const types = result.log.map(([, e]) => e.type);
    expect(types.indexOf('trophyCollected')).toBeLessThan(types.indexOf('levelCompleted'));
    expect(types.indexOf('doorOpened')).toBe(types.indexOf('trophyCollected') + 1);
    expect(types.at(-1)).toBe('levelCompleted');
  });
});

describe('what each route exercises', () => {
  it('test.txt (the movement room): start, cog, airlock, with jumps and nothing that can kill', () => {
    const { log } = replay(readScript('test'));
    expect(count(log, 'jumped')).toBeGreaterThan(10);
    expect(itemsTaken(log)).toEqual([]);
    expect(count(log, 'playerDied')).toBe(0);
  });

  it('debug.txt (the all-items room): takes the blaster and a thruster pack, flies, and destroys both the Arc Moth and the Cinderpeg on the way', () => {
    const { log } = replay(readScript('debug'));
    const taken = itemsTaken(log);
    expect(taken).toContain('blaster');
    expect(taken).toContain('thruster');
    expect(count(log, 'thrustStarted')).toBeGreaterThan(0);
    const killed = log.flatMap(([, e]) => (e.type === 'enemyKilled' ? [e.kind] : []));
    expect([...killed].sort()).toEqual(['cinderpeg', 'moth']);
    // The blaster comes before the first shot, and a pack before the first burn.
    const tickOf = (match: (e: GameEvent) => boolean): number => log.find(([, e]) => match(e))?.[0] ?? -1;
    expect(tickOf((e) => e.type === 'pickup' && e.kind === 'blaster')).toBeLessThan(tickOf((e) => e.type === 'boltFired'));
    expect(tickOf((e) => e.type === 'pickup' && e.kind === 'thruster')).toBeLessThan(tickOf((e) => e.type === 'thrustStarted'));
  });

  it('every script is stable: replaying it twice gives the same events on the same ticks', () => {
    for (const id of ['test', 'debug']) {
      const a = replay(readScript(id));
      const b = replay(readScript(id));
      expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    }
  });
});
