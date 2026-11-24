import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TICK_HZ } from '../core/types';
import { TUNING } from '../tuning';

import { LOOP_WATCHDOG_MS, Sfx, UNLOCK_EVENTS, WARM_UP_SECONDS } from './Sfx';
import {
  DROP_FADE,
  EFFECT_NAMES,
  FUEL_LOW_BEEP_TICKS,
  FUEL_LOW_PERCENT,
  GEM_LADDER,
  LAND_MIN_SPEED,
  MASTER_GAIN,
  MAX_VOICES,
  MUTE_RAMP,
  THRUST_LOOP,
} from './recipes';
import type { ThrustView } from './recipes';
import { FakeAudioContext, FakeBufferSource, FakeOscillator, settle } from './testkit';
import type { FakeGain } from './testkit';

/**
 * The mixer's rules, checked in Node on a stand-in AudioContext that records
 * what is scheduled (`testkit.ts`). The same rules are checked on the real
 * thing in a browser by the audio harness and `e2e/audio.spec.ts`.
 */

const TICK = 1 / TICK_HZ;

/**
 * A new Sfx whose context has been created by a gesture, is running and is past its warm-up
 * (WARM_UP_SECONDS), so that a sound asked for now starts now. Times below are measured from
 * `ctx.currentTime`, never from 0.
 */
async function running(): Promise<{ sfx: Sfx; ctx: FakeAudioContext }> {
  const sfx = new Sfx();
  sfx.unlock();
  await settle();
  const ctx = FakeAudioContext.created[0];
  if (!ctx) throw new Error('no context was created');
  expect(sfx.state).toBe('running');
  ctx.advance(WARM_UP_SECONDS);
  return { sfx, ctx };
}

const crystal = { type: 'pickup', kind: 'crystal', index: 0, x: 0, y: 0, score: 10 } as const;
const cogTaken = { type: 'trophyCollected', x: 0, y: 0, score: 100 } as const;
const doorOpened = { type: 'doorOpened', x: 0, y: 0 } as const;

/** The most sources that can be heard at once from `from` to `to`, sampled every millisecond. */
function mostAudible(ctx: FakeAudioContext, from: number, to: number): number {
  let most = 0;
  for (let t = from; t <= to; t += 0.001) most = Math.max(most, ctx.audibleAt(t).length);
  return most;
}

/** The master gain: the first gain node the Sfx creates. */
function masterOf(ctx: FakeAudioContext): FakeGain {
  const master = ctx.gains[0];
  if (!master) throw new Error('no master gain');
  return master;
}

const audible = (ctx: FakeAudioContext, after = 0.006): number => ctx.audibleAt(ctx.currentTime + after).length;

const game = (over: { thrusting?: boolean; fuel?: number; phase?: ThrustView['run']['phase'] } = {}): ThrustView => ({
  phys: { fuelTicks: 80 },
  session: { status: 'playing' },
  run: { phase: over.phase ?? 'playing', player: { thrusting: over.thrusting ?? true, fuel: over.fuel ?? 60 } },
});

/** Calls every public method once, in an order a game might. */
function useEverything(sfx: Sfx): void {
  const uninstall = sfx.install();
  sfx.unlock();
  sfx.setActive(true);
  sfx.setMuted(false);
  for (const name of EFFECT_NAMES) sfx.play(name);
  sfx.play('airlock', 0.32);
  sfx.playEvent({ type: 'jumped', x: 0, y: 0 });
  sfx.playEvent({ type: 'doorOpened', x: 0, y: 0 });
  sfx.update(game());
  sfx.setThrust(true, true);
  sfx.setThrust(false);
  sfx.silence();
  sfx.setMuted(true);
  sfx.setMuted(false);
  sfx.setActive(false);
  sfx.setActive(true);
  uninstall();
}

beforeEach(() => {
  FakeAudioContext.reset();
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Sfx: where audio is unavailable', () => {
  it('does nothing and never throws when the browser has no AudioContext', () => {
    vi.stubGlobal('AudioContext', undefined);
    const sfx = new Sfx();
    expect(() => {
      useEverything(sfx);
    }).not.toThrow();
    expect(sfx.state).toBe('none');
    expect(sfx.play('jump')).toBe(false);
    expect(sfx.voiceCount).toBe(0);
    expect(sfx.thrusting).toBe(false);
    expect(sfx.output).toBeNull();
  });

  it('uses the prefixed constructor of old Safari when that is all there is', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    const sfx = new Sfx();
    sfx.unlock();
    await settle();
    expect(sfx.state).toBe('running');
    expect(sfx.play('jump')).toBe(true);
  });

  it('does nothing and never throws when creating the context fails, and stops trying after three attempts', () => {
    FakeAudioContext.broken = true;
    const sfx = new Sfx();
    expect(() => {
      useEverything(sfx);
      useEverything(sfx);
      useEverything(sfx);
    }).not.toThrow();
    expect(sfx.state).toBe('none');
    FakeAudioContext.broken = false;
    sfx.unlock();
    expect(FakeAudioContext.created).toHaveLength(0);
    expect(sfx.state).toBe('none');
  });

  it('never throws when the context breaks under it', async () => {
    const { sfx, ctx } = await running();
    const broken = (): never => {
      throw new Error('InvalidStateError');
    };
    ctx.createOscillator = broken;
    ctx.createGain = broken;
    ctx.createBufferSource = broken;
    ctx.resume = broken;
    ctx.suspend = broken;
    expect(() => {
      useEverything(sfx);
    }).not.toThrow();
    expect(sfx.play('jump')).toBe(false);
  });

  it('never throws on an event or a state it does not understand', async () => {
    const { sfx, ctx } = await running();
    expect(() => {
      sfx.playEvent({ type: 'teleported' } as unknown as Parameters<Sfx['playEvent']>[0]);
      sfx.playEvent(undefined as unknown as Parameters<Sfx['playEvent']>[0]);
      sfx.update({} as unknown as ThrustView);
      sfx.play('kazoo' as unknown as Parameters<Sfx['play']>[0]);
    }).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
    expect(sfx.thrusting).toBe(false);
  });

  it('never throws when its methods are called without a page (no window, no document)', () => {
    const sfx = new Sfx();
    expect(() => {
      sfx.install()();
    }).not.toThrow();
  });
});

describe('Sfx: unlocking', () => {
  it('creates nothing before a gesture, whatever is called', () => {
    const sfx = new Sfx();
    sfx.play('jump');
    sfx.playEvent({ type: 'jumped', x: 0, y: 0 });
    sfx.setThrust(true, true);
    sfx.update(game());
    sfx.setMuted(true);
    sfx.setMuted(false);
    sfx.setActive(false);
    sfx.setActive(true);
    sfx.silence();
    expect(FakeAudioContext.created).toHaveLength(0);
    expect(sfx.state).toBe('none');
    expect(sfx.plays).toBe(0);
  });

  it('creates one context on the first unlock, wires voices -> master 0.6 -> compressor -> output, and starts it', async () => {
    const sfx = new Sfx();
    sfx.unlock();
    expect(FakeAudioContext.created).toHaveLength(1);
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error('no context');
    expect(sfx.state).toBe('suspended'); // a context starts a moment after the gesture, not during it
    expect(ctx.resumeCalls).toBe(1);
    await settle();
    expect(sfx.state).toBe('running');

    const master = masterOf(ctx);
    expect(master.gain.value).toBe(MASTER_GAIN);
    expect(master.outputs).toEqual([ctx.compressors[0]]);
    expect(ctx.compressors[0]?.outputs).toEqual([ctx.destination]);
    expect(ctx.buffers).toHaveLength(1); // the one noise buffer, built once

    sfx.unlock();
    sfx.unlock();
    await settle();
    expect(FakeAudioContext.created).toHaveLength(1);
    expect(ctx.resumeCalls).toBe(1); // already running: nothing to do
    expect(ctx.buffers).toHaveLength(1);
  });

  it('plays nothing while the browser keeps the context locked, and does not play stale sounds when it opens', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    FakeAudioContext.allowedByDefault = false;
    const sfx = new Sfx();
    sfx.unlock(); // not a real gesture: the browser does not start the context
    await settle();
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error('no context');
    expect(sfx.state).toBe('suspended');
    expect(sfx.play('jump')).toBe(false);
    expect(sfx.play('cog')).toBe(false);
    sfx.setThrust(true);
    expect(ctx.sources).toHaveLength(0);
    expect(sfx.thrusting).toBe(false);

    vi.advanceTimersByTime(2000); // two seconds later a real gesture arrives
    ctx.allow();
    await settle();
    expect(sfx.state).toBe('running');
    expect(ctx.sources).toHaveLength(0); // the jump and the cog of two seconds ago are not played now
    expect(sfx.play('jump')).toBe(true);
  });

  it('plays a sound asked for inside the unlocking gesture as soon as the context runs, once its master chain has settled', async () => {
    const sfx = new Sfx();
    sfx.unlock();
    expect(sfx.play('start')).toBe(false); // not yet: the context is still starting
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error('no context');
    expect(ctx.sources).toHaveLength(0);
    await settle();
    expect(ctx.sources).toHaveLength(2); // the jingle's lead and bass
    expect(sfx.plays).toBe(1);
    // The compressor of a context created a moment ago lets sound through at half level or less:
    // the jingle starts WARM_UP_SECONDS after the context was created.
    expect(ctx.sources.map((source) => source.startTime)).toEqual([WARM_UP_SECONDS, WARM_UP_SECONDS]);
    expect(ctx.audibleAt(WARM_UP_SECONDS + 0.006)).toHaveLength(2);
  });

  it('starts the sounds of the first moments after the unlock when the master chain has settled, and only those', async () => {
    const sfx = new Sfx();
    sfx.unlock();
    await settle();
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error('no context');
    ctx.advance(0.05);
    expect(sfx.play('uiOk')).toBe(true);
    ctx.advance(0.02);
    expect(sfx.play('uiMove')).toBe(true); // a second sound in the warm-up is not refused as "the same moment"
    expect(sfx.play('airlock', 0.3)).toBe(true); // due after the warm-up anyway: not moved
    sfx.setThrust(true);
    expect(ctx.sources.slice(0, 2).map((source) => source.startTime)).toEqual([WARM_UP_SECONDS, WARM_UP_SECONDS]);
    expect(ctx.sources[2]?.startTime).toBeCloseTo(0.07 + 0.3, 9);
    expect(ctx.sources.slice(4).map((source) => source.startTime)).toEqual([WARM_UP_SECONDS, WARM_UP_SECONDS]); // the loop
    ctx.advance(1);
    const now = ctx.currentTime;
    expect(sfx.play('jump')).toBe(true);
    expect(ctx.sources.at(-1)?.startTime).toBe(now); // later sounds start at once
  });

  it('starts the context again on the next gesture when the browser has stopped it', async () => {
    const { sfx, ctx } = await running();
    ctx.setState('suspended'); // a phone call, the screen lock
    expect(sfx.state).toBe('suspended');
    expect(sfx.play('jump')).toBe(false);
    sfx.unlock();
    await settle();
    expect(sfx.state).toBe('running');
    expect(sfx.play('jump')).toBe(true);
  });
});

describe('Sfx: playing', () => {
  it('starts an effect at once and counts it', async () => {
    const { sfx, ctx } = await running();
    ctx.advance(3);
    expect(sfx.play('jump')).toBe(true);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.startTime).toBe(ctx.currentTime);
    expect(audible(ctx)).toBe(1);
    expect(sfx.plays).toBe(1);
    expect(sfx.voiceCount).toBe(1);
    ctx.advance(0.2);
    expect(sfx.voiceCount).toBe(0);
    expect(audible(ctx)).toBe(0);
  });

  it('refuses the thrust loop by name: it follows the state', async () => {
    const { sfx, ctx } = await running();
    expect(sfx.play('thrust')).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it('plays what an event sounds like, the airlock 320 ms late, and nothing for silent events', async () => {
    const { sfx, ctx } = await running();
    ctx.advance(1);
    sfx.playEvent({ type: 'levelStarted', levelIndex: 0, score: 0, lives: 3 });
    sfx.playEvent({ type: 'thrustStarted' });
    sfx.playEvent({ type: 'landed', x: 0, y: 0, speed: 100 });
    sfx.playEvent({ type: 'boltEnded', x: 0, y: 0, hit: 'range' });
    expect(ctx.sources).toHaveLength(0);

    const now = ctx.currentTime;
    sfx.playEvent(cogTaken);
    sfx.playEvent(doorOpened);
    expect(ctx.sources).toHaveLength(4); // cog: two voices; airlock: two voices
    const offsets = ctx.sources.map((source) => (source.startTime ?? NaN) - now);
    [0, 0, 0.32, 0.32].forEach((t, i) => {
      expect(offsets[i], `voice ${i}`).toBeCloseTo(t, 9);
    });
    expect(audible(ctx)).toBe(2);
    expect(ctx.audibleAt(now + 0.33)).toHaveLength(4);
  });

  it('does not start the same effect twice in one tick, but does on the next', async () => {
    const { sfx, ctx } = await running();
    expect(sfx.play('gem')).toBe(true);
    expect(sfx.play('gem')).toBe(false);
    expect(sfx.play('jump')).toBe(true); // another effect is not held back
    expect(ctx.sources).toHaveLength(2);
    ctx.advance(TICK * 0.4); // the same rendered frame, a moment later
    expect(sfx.play('gem')).toBe(false);
    ctx.advance(TICK * 0.5); // the audio clock runs in small jumps: 0.9 of a tick counts as the next tick
    expect(sfx.play('gem')).toBe(true);
    expect(sfx.plays).toBe(3);
  });

  it('counts ticks, not the audio clock: the same effect on two ticks drained in one frame plays twice', async () => {
    const { sfx, ctx } = await running();
    // A 30 Hz screen (or a catch-up): two ticks are stepped and drained in one rendered frame, so
    // the audio clock does not move between them. A crystal on each tick: two notes, up the ladder.
    sfx.tick();
    sfx.playEvent(crystal);
    sfx.playEvent(crystal); // two crystals on the SAME tick: one note
    sfx.tick();
    sfx.playEvent(crystal);
    const notes = (): number[] =>
      ctx.sources.flatMap((source) => (source instanceof FakeOscillator ? [source.frequency.valueAt(source.startTime ?? 0)] : []));
    expect(notes()).toEqual([GEM_LADDER[0], GEM_LADDER[1]]);
    expect(sfx.plays).toBe(2);
    // Up to maxStepsPerFrame ticks in one frame, each with a jump: one jump per tick.
    for (let i = 0; i < 5; i++) {
      sfx.tick();
      expect(sfx.play('jump'), `tick ${i}`).toBe(true);
      expect(sfx.play('jump'), `tick ${i}, again`).toBe(false);
    }
  });

  it('plays the start jingle once, however often it is asked for', async () => {
    const { sfx, ctx } = await running();
    expect(sfx.play('start')).toBe(true);
    ctx.advance(10);
    expect(sfx.play('start')).toBe(false);
    expect(ctx.sources).toHaveLength(2);
  });

  it('climbs the crystal ladder for crystals taken close together and starts again after a pause', async () => {
    const { sfx, ctx } = await running();
    const window = TUNING.effects.crystalLadderFrames / TICK_HZ;
    expect(window, 'effects.crystalLadderFrames must be above 0 for the ladder to climb').toBeGreaterThan(0);
    const heard: number[] = [];
    const take = (): void => {
      expect(sfx.play('gem')).toBe(true);
      const voice = ctx.sources.at(-1);
      if (!(voice instanceof FakeOscillator)) throw new Error('a crystal is a tone');
      heard.push(voice.frequency.valueAt(ctx.currentTime));
    };
    take();
    for (let i = 0; i < 7; i++) {
      ctx.advance(window * 0.9);
      take();
    }
    expect(heard).toEqual([...GEM_LADDER, GEM_LADDER.at(-1), GEM_LADDER.at(-1)]);
    ctx.advance(window * 1.01);
    take();
    expect(heard.at(-1)).toBe(GEM_LADDER[0]);
  });
});

describe('Sfx: the voice cap', () => {
  it('never has more than six voices sounding: where a seventh is due, the oldest sounding voice is faded out', async () => {
    const { sfx, ctx } = await running();
    const t0 = ctx.currentTime;
    sfx.play('gameOver'); // 1 voice, 1.04 s
    ctx.advance(0.01);
    sfx.play('win'); // 3 voices, 1.3 s; the third is the chord, 0.6 s in
    ctx.advance(0.01);
    sfx.play('start'); // 2 voices, 2 s
    // The win's chord is not sounding yet, so it does not count yet (the review's finding: it used to).
    expect(sfx.voiceCount).toBe(5);
    expect(audible(ctx)).toBe(5);
    expect(ctx.sources.every((source) => source.stopTime === null || source.stopTime > t0 + 1)).toBe(true); // nothing dropped
    expect(ctx.audibleAt(t0 + 0.65)).toHaveLength(6);

    ctx.advance(0.01);
    const now = ctx.currentTime;
    sfx.play('cog'); // 2 more voices now: seven would sound, so the oldest one, the game over, makes way
    expect(sfx.voiceCount).toBe(MAX_VOICES);
    const [gameOver, winLead, winBass] = ctx.sources;
    expect(gameOver?.stopTime).toBeLessThan(now + 0.05);
    expect(winLead?.stopTime).toBeGreaterThan(t0 + 1.3); // the win plays on
    expect(winBass?.stopTime).toBeGreaterThan(t0 + 1.3);
    expect(ctx.audibleAt(now + DROP_FADE + 0.001)).toHaveLength(MAX_VOICES);
    expect(mostAudible(ctx, now + DROP_FADE, t0 + 2.1)).toBeLessThanOrEqual(MAX_VOICES);

    for (let i = 0; i < 40; i++) {
      ctx.advance(TICK);
      sfx.tick();
      sfx.play('jump');
      sfx.play('enemyDown');
      sfx.play('death');
      sfx.play('cog');
      expect(sfx.voiceCount).toBeLessThanOrEqual(MAX_VOICES);
      expect(ctx.audibleAt(ctx.currentTime + DROP_FADE + 0.001).length).toBeLessThanOrEqual(MAX_VOICES);
    }
    // Also every moment still to come: voices due later were counted where they start.
    expect(mostAudible(ctx, ctx.currentTime + DROP_FADE, ctx.currentTime + 2.5)).toBeLessThanOrEqual(MAX_VOICES);
  });

  it('keeps the cog fanfare whole while flying with the thruster and landing (the airlock is due 320 ms later)', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true); // 2 loop voices
    ctx.advance(0.1);
    sfx.setThrust(true);
    const t0 = ctx.currentTime;
    sfx.tick();
    sfx.playEvent(cogTaken); // 2 voices now
    sfx.playEvent(doorOpened); // 2 voices at t0 + 0.32
    const cog = ctx.sources.slice(2, 4);
    expect(sfx.voiceCount).toBe(4); // 4 sounding; the airlock is not
    ctx.advance(0.1);
    sfx.setThrust(true);
    sfx.tick();
    sfx.playEvent({ type: 'landed', x: 0, y: 0, speed: LAND_MIN_SPEED }); // 5 sounding
    expect(sfx.voiceCount).toBe(5);
    ctx.advance(0.05);
    sfx.setThrust(true);
    sfx.tick();
    sfx.playEvent({ type: 'jumped', x: 0, y: 0 });
    for (let t = t0 + 0.002; t < t0 + 0.55; t += 0.01) {
      const heard = ctx.audibleAt(t);
      expect(cog.every((source) => heard.includes(source)), `${(t - t0).toFixed(2)} s after the cog`).toBe(true);
    }
    expect(mostAudible(ctx, t0, t0 + 1)).toBeLessThanOrEqual(MAX_VOICES);
    expect(ctx.audibleAt(t0 + 0.33)).toHaveLength(6); // loop, cog and airlock: exactly the cap, nothing dropped
  });

  it('makes room for a voice due later at the moment it starts, not before; a pause still cuts the voice at once', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true); // 2
    const t0 = ctx.currentTime;
    sfx.play('start'); // 2, for 2 s
    ctx.advance(0.01);
    sfx.play('win'); // 2 now and the chord at 0.61: then seven would sound
    const lead = ctx.sources[2];
    const chordAt = t0 + 0.01 + 0.6;
    expect(lead?.stopTime).toBeGreaterThan(chordAt - DROP_FADE); // the jingle's lead plays until the chord comes...
    expect(lead?.stopTime).toBeLessThan(chordAt + 0.05); // ...and has faded out when it starts
    expect(ctx.audibleAt(chordAt - 0.05)).toContain(lead);
    expect(ctx.audibleAt(chordAt)).not.toContain(lead);
    expect(mostAudible(ctx, t0, t0 + 2.1)).toBeLessThanOrEqual(MAX_VOICES);

    ctx.advance(0.2); // a pause before the chord: everything goes now, the lead included
    const now = ctx.currentTime;
    sfx.silence();
    expect(mostAudible(ctx, now + DROP_FADE, now + 2)).toBe(0);
  });

  it('counts the thrust loop but never drops it', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    const loop = ctx.sources.slice(0, 2);
    for (let i = 0; i < 30; i++) {
      ctx.advance(TICK);
      sfx.tick();
      sfx.setThrust(true);
      sfx.play('win');
      sfx.play('start');
      sfx.play('death');
      sfx.play('cog');
      expect(sfx.voiceCount).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(sfx.thrusting).toBe(true);
    expect(loop.every((source) => source.stopTime === null)).toBe(true);
    const heard = ctx.audibleAt(ctx.currentTime + DROP_FADE + 0.001);
    expect(heard.length).toBeLessThanOrEqual(MAX_VOICES);
    expect(loop.every((source) => heard.includes(source))).toBe(true);
    expect(mostAudible(ctx, ctx.currentTime + DROP_FADE, ctx.currentTime + 2)).toBeLessThanOrEqual(MAX_VOICES);
  });

  it('makes room for the loop when five voices sound and a sixth is due', async () => {
    const { sfx, ctx } = await running();
    const t0 = ctx.currentTime;
    sfx.play('gameOver');
    sfx.play('win');
    sfx.play('start');
    ctx.advance(0.05);
    const now = ctx.currentTime;
    sfx.setThrust(true);
    expect(sfx.thrusting).toBe(true);
    expect(sfx.voiceCount).toBe(MAX_VOICES);
    // Seven now: the oldest, the game over, makes way at once. At the win's chord (0.6 s) seven again:
    // the oldest then, the win's lead, makes way at that moment.
    const [gameOver, winLead] = ctx.sources;
    expect(gameOver?.stopTime).toBeLessThan(now + 0.05);
    expect(winLead?.stopTime).toBeGreaterThan(t0 + 0.6 - DROP_FADE);
    expect(winLead?.stopTime).toBeLessThan(t0 + 0.6 + 0.05);
    expect(ctx.audibleAt(t0 + 0.55)).toContain(winLead);
    expect(ctx.audibleAt(t0 + 0.65)).toHaveLength(MAX_VOICES);
    expect(mostAudible(ctx, now + DROP_FADE, t0 + 2.1)).toBeLessThanOrEqual(MAX_VOICES);
  });
});

describe('Sfx: the thrust loop and the low-fuel beep follow the state', () => {
  it('starts the loop once, keeps it while confirmed and fades it out over 80 ms when told to stop', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    expect(sfx.thrusting).toBe(true);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0] instanceof FakeBufferSource).toBe(true);
    expect(ctx.sources[1] instanceof FakeOscillator).toBe(true);
    for (let i = 0; i < 120; i++) {
      ctx.advance(TICK);
      sfx.setThrust(true);
    }
    expect(ctx.sources).toHaveLength(2); // still the same two voices after two seconds
    expect(audible(ctx)).toBe(2);

    const now = ctx.currentTime;
    sfx.setThrust(false);
    expect(sfx.thrusting).toBe(false);
    expect(ctx.audibleAt(now + THRUST_LOOP.fadeOut / 2)).toHaveLength(2);
    expect(ctx.audibleAt(now + THRUST_LOOP.fadeOut)).toHaveLength(0);
    expect(ctx.sources.every((source) => source.stopTime !== null)).toBe(true);
    ctx.advance(1);
    expect(sfx.voiceCount).toBe(0);
  });

  it('follows the game state through update: on while playing and burning, off on death, pause and level end', async () => {
    const { sfx, ctx } = await running();
    sfx.update(game({ thrusting: false }));
    expect(sfx.thrusting).toBe(false);
    sfx.update(game());
    expect(sfx.thrusting).toBe(true);
    for (const phase of ['dying', 'exiting', 'ready'] as const) {
      sfx.update(game());
      expect(sfx.thrusting, phase).toBe(true);
      ctx.advance(TICK);
      sfx.update(game({ phase }));
      expect(sfx.thrusting, phase).toBe(false);
      ctx.advance(0.2);
      expect(audible(ctx), phase).toBe(0);
    }
  });

  it('beeps at once when the tank runs low and then every FUEL_LOW_BEEP_TICKS, only while thrusting', async () => {
    const { sfx, ctx } = await running();
    const beeps = (): number =>
      ctx.sources.filter((source) => source instanceof FakeOscillator && source.frequency.valueAt(source.startTime ?? 0) === 880)
        .length;
    for (let tick = 0; tick < 20; tick++) {
      sfx.update(game({ fuel: 40 - tick })); // 40 down to 21: not low yet
      ctx.advance(TICK);
    }
    expect(beeps()).toBe(0);
    const starts: number[] = [];
    for (let tick = 0; tick <= 61; tick++) {
      const before = beeps();
      sfx.update(game({ fuel: 16 }));
      if (beeps() > before) starts.push(tick);
      ctx.advance(TICK);
    }
    const every = Array.from({ length: Math.floor(61 / FUEL_LOW_BEEP_TICKS) + 1 }, (_, i) => i * FUEL_LOW_BEEP_TICKS);
    expect(starts).toEqual(every);
    sfx.update(game({ fuel: 16, thrusting: false }));
    ctx.advance(1);
    sfx.update(game({ fuel: 16, thrusting: false }));
    expect(beeps()).toBe(every.length);
  });

  it('beeps once per FUEL_LOW_BEEP_TICKS of low fuel while a full tank burns down, starting on the first low tick', async () => {
    // Tank sizes as an owner might tune them (phys.fuelTicks; the shipped one is 80).
    for (const fuelTicks of [80, 120, 200, 400]) {
      FakeAudioContext.reset();
      const { sfx, ctx } = await running();
      const before = ctx.sources.length;
      const low: number[] = [];
      for (let fuel = fuelTicks; fuel > 0; fuel--) {
        if (fuel * 100 <= fuelTicks * FUEL_LOW_PERCENT) low.push(fuel);
        sfx.update({ ...game({ fuel }), phys: { fuelTicks } });
        ctx.advance(TICK);
      }
      const beeps = ctx.sources.length - before - THRUST_LOOP.voices.length;
      expect(beeps, `tank of ${fuelTicks} ticks, ${low.length} of them low`).toBe(Math.ceil(low.length / FUEL_LOW_BEEP_TICKS));
      // A warning repeats: with the shipped tank (80 ticks: 16 low) it beeps twice, not once.
      if (fuelTicks === 80) expect(beeps).toBeGreaterThanOrEqual(2);
    }
  });

  it('stops the loop by itself when nobody confirms it any more (a pause or a scene that went away)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    // Confirmed on every frame for a second: it keeps sounding.
    for (let frame = 0; frame < 60; frame++) {
      vi.advanceTimersByTime(1000 / 60);
      ctx.advance(TICK);
      sfx.setThrust(true);
    }
    expect(sfx.thrusting).toBe(true);
    // Then the calls stop.
    vi.advanceTimersByTime(LOOP_WATCHDOG_MS / 2);
    expect(sfx.thrusting).toBe(true);
    vi.advanceTimersByTime(LOOP_WATCHDOG_MS);
    expect(sfx.thrusting).toBe(false);
    expect(ctx.audibleAt(ctx.currentTime + THRUST_LOOP.fadeOut)).toHaveLength(0);
    expect(ctx.sources.every((source) => source.stopTime !== null)).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // and its watchdog timer is gone
  });
});

describe('Sfx: silence, the sound switch and the page going away', () => {
  it('silence() fades out the loop and every voice, scheduled ones too, and leaves the context running for menus', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    sfx.play('gameOver');
    sfx.playEvent({ type: 'doorOpened', x: 0, y: 0 }); // starts in 320 ms
    ctx.advance(0.1);
    const now = ctx.currentTime;
    sfx.silence();
    expect(sfx.thrusting).toBe(false);
    expect(ctx.audibleAt(now + DROP_FADE)).toHaveLength(0);
    expect(ctx.audibleAt(now + 0.25)).toHaveLength(0); // the airlock never sounds
    expect(ctx.audibleAt(now + 1)).toHaveLength(0);
    expect(sfx.state).toBe('running');
    expect(ctx.suspendCalls).toBe(0);
    ctx.advance(0.02);
    expect(sfx.play('uiMove')).toBe(true);
    expect(audible(ctx, 0.004)).toBe(1);
  });

  it('muting slides the master gain to 0 in 30 ms, stops everything and starts nothing', async () => {
    const { sfx, ctx } = await running();
    const master = masterOf(ctx);
    sfx.setThrust(true);
    sfx.play('gameOver');
    ctx.advance(0.5);
    const now = ctx.currentTime;
    sfx.setMuted(true);
    expect(sfx.muted).toBe(true);
    expect(master.gain.valueAt(now)).toBe(MASTER_GAIN);
    expect(master.gain.valueAt(now + MUTE_RAMP / 2)).toBeCloseTo(MASTER_GAIN / 2, 9);
    expect(master.gain.valueAt(now + MUTE_RAMP)).toBe(0);
    expect(master.gain.valueAt(now + 60)).toBe(0);
    expect(sfx.thrusting).toBe(false);
    expect(ctx.audibleAt(now + MUTE_RAMP)).toHaveLength(0);

    const created = ctx.sources.length;
    ctx.advance(1);
    for (const name of EFFECT_NAMES) expect(sfx.play(name), name).toBe(false);
    sfx.playEvent({ type: 'jumped', x: 0, y: 0 });
    sfx.setThrust(true, true);
    sfx.update(game({ fuel: 5 }));
    expect(ctx.sources).toHaveLength(created); // not one new voice while muted
    expect(sfx.thrusting).toBe(false);
    expect(sfx.voiceCount).toBe(0);
  });

  it('unmuting slides the master gain back to 0.6 in 30 ms and sounds play again', async () => {
    const { sfx, ctx } = await running();
    const master = masterOf(ctx);
    sfx.setMuted(true);
    ctx.advance(2);
    master.gain.value = 0; // what a real param reads once the ramp is over
    const now = ctx.currentTime;
    sfx.setMuted(false);
    expect(sfx.muted).toBe(false);
    expect(master.gain.valueAt(now)).toBe(0);
    expect(master.gain.valueAt(now + MUTE_RAMP)).toBe(MASTER_GAIN);
    expect(sfx.play('jump')).toBe(true);
    sfx.setThrust(true);
    expect(sfx.thrusting).toBe(true);
  });

  it('starts muted when the saved setting says so before the first gesture', async () => {
    const sfx = new Sfx();
    sfx.setMuted(true);
    sfx.unlock();
    await settle();
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error('no context');
    expect(masterOf(ctx).gain.value).toBe(0);
    expect(sfx.play('start')).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it('cuts everything at once and suspends when the page goes away, and resumes when it returns', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    sfx.play('gameOver');
    sfx.playEvent({ type: 'doorOpened', x: 0, y: 0 });
    ctx.advance(0.1);
    const now = ctx.currentTime;

    sfx.setActive(false);
    await settle();
    expect(sfx.state).toBe('suspended');
    expect(ctx.suspendCalls).toBe(1);
    expect(sfx.thrusting).toBe(false);
    expect(sfx.voiceCount).toBe(0);
    // Nothing of what was sounding or scheduled can be heard from this instant on: no fade is left to finish on return.
    expect(ctx.audibleAt(now)).toHaveLength(0);
    expect(ctx.audibleAt(now + 0.3)).toHaveLength(0);
    expect(sfx.play('jump')).toBe(false);
    sfx.setThrust(true);
    expect(sfx.thrusting).toBe(false);

    sfx.setActive(true);
    await settle();
    expect(sfx.state).toBe('running');
    expect(ctx.audibleAt(ctx.currentTime + 0.01)).toHaveLength(0);
    expect(sfx.play('jump')).toBe(true);
    sfx.setThrust(true); // the game is still thrusting: the next update brings the loop back
    expect(sfx.thrusting).toBe(true);
    expect(audible(ctx)).toBe(3);
  });

  it('cuts everything before it suspends, also where the browser reports no state change', async () => {
    const { sfx, ctx } = await running();
    ctx.suspend = () => Promise.resolve(); // an old browser: suspends, but fires no statechange
    sfx.setThrust(true);
    sfx.play('gameOver');
    ctx.advance(0.1);
    sfx.setActive(false);
    expect(sfx.thrusting).toBe(false);
    expect(sfx.voiceCount).toBe(0);
    expect(ctx.audibleAt(ctx.currentTime)).toHaveLength(0);
    expect(ctx.audibleAt(ctx.currentTime + 0.5)).toHaveLength(0);
  });

  it('cuts everything when the browser stops the context on its own', async () => {
    const { sfx, ctx } = await running();
    sfx.setThrust(true);
    sfx.play('win');
    ctx.advance(0.1);
    ctx.setState('suspended');
    expect(sfx.thrusting).toBe(false);
    expect(sfx.voiceCount).toBe(0);
    expect(ctx.audibleAt(ctx.currentTime)).toHaveLength(0);
    expect(ctx.audibleAt(ctx.currentTime + 0.5)).toHaveLength(0);
  });
});

describe('Sfx: the page hidden and shown again while the context is changing state', () => {
  it('stays suspended when the page is hidden again before a resume has finished (the review\'s race)', async () => {
    const { sfx, ctx } = await running();
    sfx.setActive(false);
    await settle();
    expect(sfx.state).toBe('suspended');
    sfx.setActive(true); // the page is shown: resume() starts...
    sfx.setActive(false); // ...and it is hidden again before the resume lands
    await settle();
    await settle();
    expect(sfx.state).toBe('suspended');
    expect(sfx.play('jump')).toBe(false);
    sfx.setThrust(true);
    expect(sfx.thrusting).toBe(false);
    expect(ctx.audibleAt(ctx.currentTime + 0.01)).toHaveLength(0);
  });

  it('stays suspended when the page is hidden again before a resume has finished, also where the browser reports no state change', async () => {
    const { sfx, ctx } = await running();
    sfx.setActive(false);
    await settle();
    // An old browser: resume() works but fires no statechange, so only the resume's own promise can tell.
    ctx.resume = (): Promise<void> => {
      ctx.resumeCalls += 1;
      return Promise.resolve().then(() => {
        ctx.state = 'running';
      });
    };
    sfx.setActive(true);
    sfx.setActive(false);
    await settle();
    await settle();
    expect(sfx.state).toBe('suspended');
  });

  it('stays suspended when the browser itself starts the context while the page is away', async () => {
    const { sfx, ctx } = await running();
    sfx.setActive(false);
    await settle();
    ctx.setState('running'); // some browsers resume on their own, for example after a call
    await settle();
    expect(sfx.state).toBe('suspended');
  });

  it('ends up running when the page is shown again before a suspend has finished', async () => {
    const { sfx } = await running();
    sfx.setActive(false); // suspend() starts...
    sfx.setActive(true); // ...and the page is back before it lands
    await settle();
    await settle();
    expect(sfx.state).toBe('running');
    expect(sfx.play('jump')).toBe(true);
  });

  it('asks the context to suspend once, however many hide events arrive while it suspends', async () => {
    const { sfx, ctx } = await running();
    sfx.setActive(false);
    sfx.setActive(false);
    sfx.setActive(false);
    await settle();
    expect(ctx.suspendCalls).toBe(1);
    expect(sfx.state).toBe('suspended');
  });
});

describe('Sfx: install', () => {
  /** A page that is just two event targets, which is all `install` touches. */
  function page(): { window: EventTarget; document: EventTarget & { hidden: boolean } } {
    const fakeWindow = new EventTarget();
    const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', fakeDocument);
    return { window: fakeWindow, document: fakeDocument };
  }

  it('unlocks on a finger lifting, a mouse button going down, a key going down and a click: not on a finger touching down', async () => {
    expect([...UNLOCK_EVENTS]).toEqual(['pointerup', 'touchend', 'mousedown', 'keydown', 'click']);
    for (const type of ['pointerdown', 'touchstart', 'pointermove', 'keyup']) {
      FakeAudioContext.reset();
      const { window } = page();
      const sfx = new Sfx();
      sfx.install();
      window.dispatchEvent(new Event(type));
      expect(FakeAudioContext.created, type).toHaveLength(0);
    }
    for (const type of UNLOCK_EVENTS) {
      FakeAudioContext.reset();
      const { window } = page();
      const sfx = new Sfx();
      sfx.install();
      expect(FakeAudioContext.created, type).toHaveLength(0); // installing creates nothing
      window.dispatchEvent(new Event(type));
      expect(FakeAudioContext.created, type).toHaveLength(1);
      await settle();
      expect(sfx.state, type).toBe('running');
    }
  });

  it('suspends on hidden, blur and pagehide and resumes on visible, focus and pageshow', async () => {
    const { window, document } = page();
    const sfx = new Sfx();
    sfx.install();
    window.dispatchEvent(new Event('keydown'));
    await settle();
    sfx.setThrust(true);

    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(sfx.state).toBe('suspended');
    expect(sfx.thrusting).toBe(false);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(sfx.state).toBe('running');

    for (const [away, back] of [
      ['blur', 'focus'],
      ['pagehide', 'pageshow'],
    ] as const) {
      window.dispatchEvent(new Event(away));
      await settle();
      expect(sfx.state, away).toBe('suspended');
      window.dispatchEvent(new Event(back));
      await settle();
      expect(sfx.state, back).toBe('running');
    }

    // Focus does not start a hidden page's audio.
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(sfx.state).toBe('suspended');
  });

  it('takes a gesture as proof that the player is back, even if no focus event came', async () => {
    const { window } = page();
    const sfx = new Sfx();
    sfx.install();
    window.dispatchEvent(new Event('keydown'));
    await settle();
    window.dispatchEvent(new Event('blur'));
    await settle();
    expect(sfx.state).toBe('suspended');
    window.dispatchEvent(new Event('pointerup'));
    await settle();
    expect(sfx.state).toBe('running');
    expect(sfx.play('jump')).toBe(true);
  });

  it('adds its listeners once, however often it is called', async () => {
    const { window } = page();
    const added: string[] = [];
    const add = window.addEventListener.bind(window);
    window.addEventListener = (...args: Parameters<EventTarget['addEventListener']>): void => {
      added.push(args[0]);
      add(...args);
    };
    const sfx = new Sfx();
    sfx.install();
    const once = added.length;
    sfx.install();
    sfx.install();
    expect(added).toHaveLength(once);
    window.dispatchEvent(new Event('keydown'));
    await settle();
    expect(FakeAudioContext.created).toHaveLength(1);
    expect(FakeAudioContext.created[0]?.resumeCalls).toBe(1);
  });

  it('removes every listener again', async () => {
    const { window, document } = page();
    const sfx = new Sfx();
    const uninstall = sfx.install();
    uninstall();
    for (const type of UNLOCK_EVENTS) window.dispatchEvent(new Event(type));
    expect(FakeAudioContext.created).toHaveLength(0);

    sfx.unlock();
    await settle();
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(sfx.state).toBe('running');
  });
});
