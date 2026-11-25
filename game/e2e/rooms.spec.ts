import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { InputScript, ReplayResult } from '../src/core/types.ts';

/**
 * The two development rooms, won in the real game in the browser by the input scripts kept beside this
 * file (docs/ARCHITECTURE.md section 2, "Tests and levels"; 11.6). `src/core/rooms.test.ts` replays the
 * same files in Node and finds the cog and the airlock on the same ticks: so browser and Node simulate
 * identically, and the shell feeds exactly one input per tick through the same step().
 *
 * Each replay runs through `window.__E2E__.replay`, which draws, plays and routes every event as in a
 * real game; a run at one tick per rendered frame and a fast one at 20 ticks per frame must agree.
 */

interface RoomScript extends InputScript {
  readonly levelId: string;
  readonly trophyTick: number;
  readonly winTick: number;
}

const readScript = (id: string): RoomScript =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as RoomScript;

async function openGame(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const replay = (page: Page, script: RoomScript, ticksPerFrame: number): Promise<ReplayResult> =>
  page.evaluate(
    async ({ s, n }) => {
      const hook = window.__E2E__;
      if (!hook) throw new Error('window.__E2E__ is missing');
      return hook.replay(s.levelId, { runs: s.runs }, n);
    },
    { s: script, n: ticksPerFrame },
  );

for (const id of ['test', 'debug']) {
  test(`levels/${id}.txt is won in the browser on the ticks Node finds`, async ({ page }) => {
    const script = readScript(id);
    const problems = await openGame(page);

    for (const ticksPerFrame of [20, 1]) {
      const result = await replay(page, script, ticksPerFrame);
      expect(result, `${id} at ${ticksPerFrame} tick(s) per frame`).toEqual({
        won: true,
        trophyTick: script.trophyTick,
        winTick: script.winTick,
        died: null,
        ticks: script.winTick,
      });
      // The replayed session is what the page shows: the hero is in the airlock, the cog is taken.
      const state = await page.evaluate(() => window.__E2E__?.state() ?? null);
      expect(state?.levelId).toBe(id);
      expect(state?.phase).toBe('exiting');
      expect(state?.hasTrophy).toBe(true);
      expect(state?.tick).toBe(script.winTick);
    }

    expect(await page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);
    expect(problems).toEqual([]);
  });
}

/** The fields of the hook's state this file reads, or null before a session. */
const now = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);

test('the movement room played with the keyboard: the hero runs, stops, jumps and lands; Esc pauses and resumes', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?level=test&e2e=1');
  // The intro card is up first; then the core runs in the ready gate. Wait for a ready tick with nothing
  // held: a key already down on the gate's first tick counts as held from before and never opens it.
  await page.waitForFunction(() => (window.__E2E__?.state()?.tick ?? 0) > 1);
  // The ready gate: the world waits for a press.
  const start = await now(page);
  expect(start?.phase).toBe('ready');

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await now(page))?.player.vx ?? 0).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const running = await now(page);
  expect(running?.phase).toBe('playing');
  expect(running?.player.x ?? 0).toBeGreaterThan(start?.player.x ?? 0);
  expect(running?.player.onGround).toBe(true);

  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => (await now(page))?.player.vx).toBe(0);
  const stopped = (await now(page))?.player.x;
  await page.waitForTimeout(200);
  expect((await now(page))?.player.x).toBe(stopped);

  await page.keyboard.down('Space');
  await expect.poll(async () => (await now(page))?.player.onGround).toBe(false);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await now(page))?.player.onGround).toBe(true);

  // Esc pauses (the core stands still), Esc resumes behind the ready gate.
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toContain('Pause');
  const pausedTick = (await now(page))?.tick;
  await page.waitForTimeout(250);
  expect((await now(page))?.tick).toBe(pausedTick);
  expect((await now(page))?.mode).toBe('paused');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await now(page))?.mode).toBe('running');
  expect((await now(page))?.phase).toBe('ready');
  // Scene changes are applied at the start of the next frame.
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);
  expect(problems).toEqual([]);
});

test('a replay can stop at a tick of its choosing, and another can start over it', async ({ page }) => {
  const problems = await openGame(page);
  const script = readScript('debug');
  const stopped = await page.evaluate(async (s) => window.__E2E__?.replay('debug', { runs: s.runs }, 5, { stopAtTick: 100 }), script);
  expect(stopped?.won).toBe(false);
  expect(stopped?.died).toBeNull();
  expect(await page.evaluate(() => window.__E2E__?.state()?.tick)).toBe(100);

  // Several sessions in a row in one page: the scenes restart cleanly every time.
  for (let i = 0; i < 3; i++) {
    const again = await replay(page, script, 30);
    expect(again.won).toBe(true);
  }
  expect(await page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);
  expect(problems).toEqual([]);
});

test('a session of both rooms changes level at the airlock and ends on the win screen', async ({ page }) => {
  const problems = await openGame(page);
  const first = readScript('test');
  const second = readScript('debug');
  // The airlock's exiting phase lasts 60 ticks; the second room's script starts on the tick after it.
  const runs: InputScript['runs'] = [...first.runs, [0, 60], ...second.runs, [0, 120]];
  const result = await page.evaluate(async (r) => window.__E2E__?.replay(['test', 'debug'], { runs: r }, 20, { until: 'sessionEnd' }), runs);
  expect(result).toMatchObject({ won: true, trophyTick: first.trophyTick, winTick: first.winTick, died: null });
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['End']);
  const state = await page.evaluate(() => window.__E2E__?.state() ?? null);
  expect(state).toMatchObject({ status: 'won', levelId: 'debug', levelIndex: 1 });
  expect(await page.evaluate(() => (window.__E2E__?.menu() ?? []).map((item) => item.label))).toEqual(['PLAY AGAIN', 'TITLE']);
  expect(problems).toEqual([]);
});

test('the pause menu: RESTART LEVEL costs a life and waits behind the ready gate; QUIT TO TITLE costs none', async ({ page }) => {
  const problems = await openGame(page);
  await page.evaluate(() => {
    window.__E2E__?.startLevel('test');
  });
  await page.waitForFunction(() => (window.__E2E__?.state()?.tick ?? 0) > 1);
  const lives = (await now(page))?.lives ?? 0;

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window.__E2E__?.menu() ?? []).map((item) => item.label))).toEqual([
    'RESUME',
    'RESTART LEVEL -1 LIFE',
    'QUIT TO TITLE',
    'SOUND ON',
    'BUZZ ON',
  ]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await now(page))?.lives).toBe(lives - 1);
  expect((await now(page))?.phase).toBe('ready');
  await expect.poll(async () => (await now(page))?.mode).toBe('running');
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);

  await page.keyboard.press('Escape');
  // Keys reach the menu once it exists: wait for its buttons, not just the scene.
  await expect.poll(() => page.evaluate(() => (window.__E2E__?.menu() ?? []).length)).toBe(5);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Title']);
  // Quitting cost nothing: the session it left still has its lives.
  expect((await now(page))?.lives).toBe(lives - 1);
  expect(problems).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------
// Real key presses
// ---------------------------------------------------------------------------------------------------

const KEY_OF = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space', fire: 'KeyX', thrust: 'KeyZ' } as const;
type Button = keyof typeof KEY_OF;
const BUTTON_LIST: readonly Button[] = ['left', 'right', 'jump', 'fire', 'thrust'];
const BITS: Readonly<Record<Button, number>> = { left: 1, right: 2, jump: 4, fire: 8, thrust: 16 };

/**
 * Lets the frozen game go on and arms its next stop (`freezeAtTick`) in the same call inside the page, and
 * resolves with the tick the game froze on. One call, because with `pace(1)` a run one tick long lasts one
 * rendered frame: a stop armed by a second round trip after the resume can come after its tick, and on a busy
 * machine it does. No frame runs inside one call (`freeze(false)` only clears Phaser's pause flag), so the stop
 * sees every tick from the resume on. A tick already reached freezes the game at once and is reported as it is.
 */
const resumeUntil = (page: Page, tick: number): Promise<number | undefined> =>
  page.evaluate((t) => {
    const hook = window.__E2E__;
    hook?.freeze(false);
    return hook?.freezeAtTick(t);
  }, tick);

/**
 * Plays a script's runs with real input: `set(bits)` presses and lets go of real keys (or touches the pad).
 * Each run's buttons change on the tick the script names. For that the Play scene steps exactly one tick per
 * rendered frame (`pace(1)`: a loaded machine would otherwise run several ticks in one frame), and the page
 * freezes the game the moment the tick is reached (`freezeAtTick`, checked inside the page after every frame)
 * while the input changes. Each stop is armed in the same call that lets the game go (`resumeUntil`). The input
 * itself goes through the browser, the keyboard plugin or the pad, and `Controls`, as a player's does. The script
 * starts on the tick the game is at when this is called. Returns that tick, and how many runs found the tick
 * already past their first tick. The game is left frozen on the last run's first tick: no stop is armed past it,
 * so none waits for a tick after the win.
 */
async function playRuns(page: Page, runs: InputScript['runs'], set: (bits: number) => Promise<void>): Promise<{ base: number; late: number }> {
  await page.evaluate(() => {
    window.__E2E__?.pace(1);
  });
  // Frozen here, on tick base: the first run starts on it.
  const base = (await page.evaluate(() => window.__E2E__?.freezeAtTick(0))) ?? 0;
  let k = 0;
  let late = 0;
  let at = base;
  for (const [i, [bits, length]] of runs.entries()) {
    if (at !== base + k) late += 1;
    await set(bits);
    k += length;
    if (i + 1 < runs.length) at = (await resumeUntil(page, base + k)) ?? -1;
  }
  return { base, late };
}

/** The state on `tick` exactly: the frozen game goes on to it (resumeUntil) and is read there. It stays frozen. Needs pace(1). */
async function stateAt(page: Page, tick: number): Promise<Awaited<ReturnType<typeof now>>> {
  await resumeUntil(page, tick);
  return now(page);
}

test('the movement room is won with real key presses, on the tick Node finds', async ({ page }) => {
  const problems = await openGame(page);
  const script = readScript('test');
  await page.goto('./?level=test&e2e=1');
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
  let held = 0;
  const { base, late } = await playRuns(page, script.runs, async (bits) => {
    for (const b of BUTTON_LIST) {
      const want = (bits & BITS[b]) !== 0;
      if (want === ((held & BITS[b]) !== 0)) continue;
      if (want) await page.keyboard.down(KEY_OF[b]);
      else await page.keyboard.up(KEY_OF[b]);
    }
    held = bits;
  });
  // The hero enters the airlock on the tick Node finds, not one earlier.
  const before = await stateAt(page, base + script.winTick - 1);
  const end = await stateAt(page, base + script.winTick);
  await page.evaluate(() => {
    window.__E2E__?.pace(null);
    window.__E2E__?.freeze(false);
  });
  expect(late, 'runs whose keys changed late').toBe(0);
  expect(before).toMatchObject({ levelId: 'test', phase: 'playing', hasTrophy: true, tick: base + script.winTick - 1 });
  expect(end).toMatchObject({ levelId: 'test', phase: 'exiting', hasTrophy: true, tick: base + script.winTick });
  expect(problems).toEqual([]);
});

test('a key event acts once: M with another key in the same frame mutes; the Esc that closes the pause menu does not open it again', async ({ page }) => {
  const problems = await openGame(page);
  await page.goto('./?level=test&e2e=1');
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
  const muted = (): Promise<boolean | undefined> => page.evaluate(() => window.__E2E__?.sound().muted);
  const freeze = (on: boolean): Promise<void> =>
    page.evaluate((f) => {
      window.__E2E__?.freeze(f);
    }, on);

  // Phaser 4.2.1 hands a key's 'down' over again when another key event arrives before the frame ends (src/shell/freshKey.ts).
  // With the loop held still, the three events surely share a frame.
  const before = await muted();
  await freeze(true);
  await page.keyboard.press('KeyM');
  await page.keyboard.down('ArrowRight');
  await freeze(false);
  await expect.poll(muted).toBe(!before);
  await page.keyboard.up('ArrowRight');

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window.__E2E__?.menu() ?? []).length)).toBe(5);
  await freeze(true);
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowRight');
  await freeze(false);
  await expect.poll(() => page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);
  await page.waitForTimeout(200);
  expect((await now(page))?.mode).toBe('running');
  expect(await page.evaluate(() => window.__E2E__?.scenes() ?? [])).toEqual(['Play', 'Hud']);
  await page.keyboard.up('ArrowRight');
  expect(problems).toEqual([]);
});
