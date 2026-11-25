import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { compileTuning } from '../src/core/compileTuning.ts';
import { createSession, step } from '../src/core/game.ts';
import { parseLevel } from '../src/core/level.ts';
import { inputFromBits, scriptTicks } from '../src/core/script.ts';
import type { DeathCause, GameEvent, GameState, InputScript, LevelData, ReplayResult, SaveData } from '../src/core/types.ts';
import { TUNING } from '../src/tuning.ts';

/**
 * Phase 4's browser exit check (docs/PLAN.md): the ten campaign levels, each won in the built game by its
 * validator proof, kept as `e2e/scripts/level-NN.json` and written by `src/tools/prove.ts --script`.
 * `tests/levelScripts.test.ts` replays the same files in Node (`replayScript`, live tuning) and fails, naming
 * the command that writes a file again, when a level change breaks one.
 *
 * Here each script is replayed through `window.__E2E__.replay` (docs/ARCHITECTURE.md 11.6), from a fresh
 * start of its level, at 20 ticks per rendered frame: the cog and the airlock on the ticks Node finds, no
 * death, and the session the page shows equal to Node's on the win tick (score, lives, the hero's position
 * and speed in sub-pixels). Node's side is the real core run right here on the level files and the live
 * tuning, the numbers the build plays with. Level 1 is also replayed at 1 tick per frame, and played from
 * the title with real key presses as a player starts it, which also shows the level change: level 2's intro
 * card, then its ready gate, and the save at level 2. Last, the ten scripts as one session: nine level
 * changes and the win screen, with Node's final score.
 */

const PROGRESS_KEY = 'moon-foundry:progress';
const CAMPAIGN_IDS = Array.from({ length: 10 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`);
const PHYS = compileTuning(TUNING);
/** The ticks per rendered frame of the bulk replays; level 1 also runs at 1 (rooms.spec does the same). */
const FAST = 20;

interface LevelScript extends InputScript {
  readonly levelId: string;
  readonly trophyTick: number;
  readonly winTick: number;
}

const readScript = (id: string): LevelScript =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as LevelScript;
const readLevel = (id: string): LevelData =>
  parseLevel(readFileSync(path.join(import.meta.dirname, '..', 'levels', `${id}.txt`), 'utf8'), id);

// ---------------------------------------------------------------------------------------------------
// Node's side: the core, as the hook's replay drives it
// ---------------------------------------------------------------------------------------------------

/** The fields of `__E2E__.state()` that come from the core (all but the Play scene's mode). */
interface CoreState {
  readonly status: string;
  readonly levelId: string;
  readonly levelIndex: number;
  readonly phase: string;
  readonly tick: number;
  readonly score: number;
  readonly lives: number;
  readonly player: { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly onGround: boolean };
  readonly hasTrophy: boolean;
}

function coreState(game: GameState): CoreState {
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
  };
}

/**
 * `runs` on a fresh session of `ids` and the live tuning, stopped where the hook's replay stops (PlayScene's
 * ReplayRun): by default at the first win or death, as replayScript does; with 'sessionEnd' at the end of
 * the script or of the session. Returns the replay's result and the session as it then stands.
 */
function nodeReplay(ids: readonly string[], runs: InputScript['runs'], until: 'levelCompleted' | 'sessionEnd' = 'levelCompleted') {
  const game = createSession(ids.map(readLevel), PHYS);
  const events: GameEvent[] = [];
  let ticks = 0;
  let trophyTick = -1;
  let winTick = -1;
  let died: DeathCause | null = null;
  play: for (const [bits, count] of runs) {
    for (let i = 0; i < count; i++) {
      events.length = 0;
      step(game, inputFromBits(bits), events);
      ticks += 1;
      for (const event of events) {
        if (event.type === 'trophyCollected' && trophyTick < 0) trophyTick = game.run.tick;
        if (event.type === 'levelCompleted' && winTick < 0) winTick = game.run.tick;
        if (event.type === 'playerDied' && died === null) died = event.cause;
      }
      if ((until !== 'sessionEnd' && (winTick >= 0 || died !== null)) || game.session.status !== 'playing') break play;
    }
  }
  const result: ReplayResult = { won: winTick >= 0 && died === null, trophyTick, winTick, died, ticks };
  return { result, end: coreState(game) };
}

// ---------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------

/** Collects page errors and console errors. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  return problems;
}

async function openGame(page: Page): Promise<void> {
  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
}

const replay = (page: Page, id: string | readonly string[], runs: InputScript['runs'], ticksPerFrame: number, until?: 'sessionEnd') =>
  page.evaluate(
    async ({ i, r, n, u }) => {
      const hook = window.__E2E__;
      if (!hook) throw new Error('window.__E2E__ is missing');
      return hook.replay(i, { runs: r }, n, u === undefined ? {} : { until: u });
    },
    { i: id, r: runs, n: ticksPerFrame, u: until },
  );

const now = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const stored = async (page: Page): Promise<SaveData | null> => {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PROGRESS_KEY);
  return raw === null ? null : (JSON.parse(raw) as SaveData);
};

// ---------------------------------------------------------------------------------------------------
// Every level, by its proof, through the hook
// ---------------------------------------------------------------------------------------------------

for (const id of CAMPAIGN_IDS) {
  test(`levels/${id}.txt is won in the browser by its proof, on the ticks Node finds`, async ({ page }) => {
    const script = readScript(id);
    const node = nodeReplay([id], script.runs);
    // Node's own replay is the recorded one (tests/levelScripts.test.ts fails first, and names the fix, if not).
    expect(node.result, `Node's replay of e2e/scripts/${id}.json`).toEqual({
      won: true,
      trophyTick: script.trophyTick,
      winTick: script.winTick,
      died: null,
      ticks: scriptTicks(script),
    });

    test.setTimeout(90_000); // level 1 also runs at 1 tick per frame: about 11 s of frames, more on a busy machine
    const problems = watch(page);
    await openGame(page);
    for (const ticksPerFrame of id === 'level-01' ? [FAST, 1] : [FAST]) {
      const result = await replay(page, id, script.runs, ticksPerFrame);
      expect(result, `${id} at ${ticksPerFrame} tick(s) per frame`).toEqual(node.result);
      // The replayed session is what the page shows: on the win tick, the same session as in Node.
      expect(await now(page), `${id} at ${ticksPerFrame} tick(s) per frame, the session on the win tick`).toMatchObject({
        ...node.end,
        phase: 'exiting',
        hasTrophy: true,
        tick: script.winTick,
      });
    }
    expect(await scenes(page)).toEqual(['Play', 'Hud']);
    expect(problems).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------------
// Level 1 from the title, with real key presses, and the change to level 2
// ---------------------------------------------------------------------------------------------------

const KEY_OF = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space', fire: 'KeyX', thrust: 'KeyZ' } as const;
type Button = keyof typeof KEY_OF;
const BUTTON_LIST: readonly Button[] = ['left', 'right', 'jump', 'fire', 'thrust'];
const BITS: Readonly<Record<Button, number>> = { left: 1, right: 2, jump: 4, fire: 8, thrust: 16 };

/**
 * Resumes the frozen game and arms its next stop (`freezeAtTick`) in one call inside the page, and resolves
 * with the tick the game froze on. One call, because with `pace(1)` a run one tick long lasts one rendered
 * frame: a stop armed by a second round trip after the resume can arrive after its tick, and on a busy machine
 * it does. Inside one call no frame can run between the two (`freeze(false)` only clears Phaser's pause flag),
 * so the stop sees every tick from the resume on. A tick already reached freezes the game at once and is
 * reported as it is.
 */
const resumeUntil = (page: Page, tick: number): Promise<number | undefined> =>
  page.evaluate((t) => {
    const hook = window.__E2E__;
    hook?.freeze(false);
    return hook?.freezeAtTick(t);
  }, tick);

/**
 * Plays `runs` with real key presses, as `e2e/rooms.spec.ts` does: the Play scene steps one tick per rendered
 * frame (`pace(1)`), and on the tick each run starts the page freezes the game (`freezeAtTick`), the keys change
 * through the browser, Phaser's keyboard plugin and `Controls`, and the game goes on until the next stop
 * (`resumeUntil`). The script starts on the tick the game is at when this is called (`base`). On each of the
 * ticks `look` (counted from `base`) the state is read while the game stands still. After the last stop the game
 * goes on. Returns `base`, how many stops found their tick already past, and the states read, by tick.
 */
async function playKeys(page: Page, runs: InputScript['runs'], look: readonly number[]) {
  await page.evaluate(() => {
    window.__E2E__?.pace(1);
  });
  // Frozen here, on tick base.
  const base = (await page.evaluate(() => window.__E2E__?.freezeAtTick(0))) ?? 0;
  const starts = new Map<number, number>();
  let k = 0;
  for (const [bits, length] of runs) {
    starts.set(k, bits);
    k += length;
  }
  // The stops, in order: each run's first tick and each tick of `look`. Each is armed before the game can pass it.
  const stops = [...new Set([...starts.keys(), ...look])].sort((a, b) => a - b);
  const seen = new Map<number, Awaited<ReturnType<typeof now>>>();
  let held = 0;
  let late = 0;
  // The first run starts on tick base + 0: the game is frozen there again at once.
  let at = await resumeUntil(page, base + (stops[0] ?? 0));
  for (const [i, t] of stops.entries()) {
    if (at !== base + t) late += 1;
    if (look.includes(t)) seen.set(t, await now(page));
    const bits = starts.get(t);
    if (bits !== undefined) {
      for (const b of BUTTON_LIST) {
        const want = (bits & BITS[b]) !== 0;
        if (want === ((held & BITS[b]) !== 0)) continue;
        if (want) await page.keyboard.down(KEY_OF[b]);
        else await page.keyboard.up(KEY_OF[b]);
      }
      held = bits;
    }
    const next = stops[i + 1];
    if (next !== undefined) at = await resumeUntil(page, base + next);
  }
  await page.evaluate(() => {
    window.__E2E__?.freeze(false);
  });
  // Every key up again: what the player's hand does after the airlock.
  for (const b of BUTTON_LIST) if ((held & BITS[b]) !== 0) await page.keyboard.up(KEY_OF[b]);
  return { base, late, seen };
}

test('level 1 started from the title and won with real key presses on the ticks Node finds; then level 2 starts, and the save is at level 2', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const script = readScript('level-01');
  const node = nodeReplay(['level-01'], script.runs);
  expect(node.result.winTick).toBe(script.winTick);
  const problems = watch(page);
  await openGame(page);
  expect(await stored(page), 'a fresh browser has no save').toBeNull();

  // The title's prompt: Space starts a new game at level 1, on its intro card (the core is not stepped yet).
  await page.keyboard.press('Space');
  await expect.poll(async () => (await now(page))?.mode).toBe('intro');
  expect(await now(page)).toMatchObject({ levelId: 'level-01', levelIndex: 0, phase: 'ready', tick: 0, score: 0, status: 'playing' });

  const { trophyTick: cog, winTick: win } = script;
  const { base, late, seen } = await playKeys(page, script.runs, [cog - 1, cog, win - 1, win]);
  expect(late, 'runs whose keys changed late').toBe(0);
  test.info().annotations.push({ type: 'script start', description: `level 1's script started on tick ${base}` });
  // The script started in the ready gate, where the world stands still: an earlier start only shifts the count.
  expect(seen.get(cog - 1)).toMatchObject({ levelId: 'level-01', phase: 'playing', hasTrophy: false, tick: base + cog - 1 });
  expect(seen.get(cog)).toMatchObject({ levelId: 'level-01', phase: 'playing', hasTrophy: true, tick: base + cog });
  expect(seen.get(win - 1)).toMatchObject({ levelId: 'level-01', phase: 'playing', tick: base + win - 1 });
  expect(seen.get(win), 'the session on the win tick, as in Node').toMatchObject({ ...node.end, tick: base + win, mode: 'running' });
  expect(node.end).toMatchObject({ phase: 'exiting', hasTrophy: true, status: 'playing', levelIndex: 0 });

  // The airlock saved the next level at once (docs/ARCHITECTURE.md section 10), with the score and lives of the win.
  const atWin = { levelIndex: 1, score: node.end.score, lives: node.end.lives };
  expect(await stored(page)).toMatchObject({ unlocked: 1, finished: false, resume: atWin });

  // Level 2 starts: its intro card first (the core waits on tick 0), with the score and lives carried over.
  // Looked for on every animation frame, so the card's 1.5 s cannot slip between two looks.
  await page.evaluate(() => {
    window.__E2E__?.pace(null);
  });
  const introHandle = await page.waitForFunction(
    () => {
      const hook = window.__E2E__;
      const state = hook?.state() ?? null;
      const intro = hook?.hud()?.intro ?? [];
      if (state?.levelId !== 'level-02' || intro.length === 0) return null;
      return { state, intro, label: document.querySelector('#game canvas')?.getAttribute('aria-label') ?? '' };
    },
    undefined,
    { timeout: 10_000 },
  );
  const intro = await introHandle.jsonValue();
  expect(intro?.state).toMatchObject({ levelIndex: 1, mode: 'intro', phase: 'ready', tick: 0, score: atWin.score, lives: atWin.lives });
  expect(intro?.intro.slice(0, 2)).toEqual(['LEVEL 2', readLevel('level-02').name.toUpperCase()]);
  expect(intro?.label).toMatch(/^LEVEL 2\. /);

  // ...then its ready gate: the core runs, the world waits for a press.
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
  const gate = await now(page);
  await page.waitForTimeout(400);
  const later = await now(page);
  expect(later).toMatchObject({ levelId: 'level-02', phase: 'ready' });
  expect(later?.tick ?? 0).toBeGreaterThan(gate?.tick ?? 0);
  expect(later?.player).toEqual(gate?.player);
  expect(await stored(page)).toMatchObject({ unlocked: 1, finished: false, resume: atWin });

  // A press opens the gate.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await now(page))?.phase).toBe('playing');
  await page.keyboard.up('ArrowRight');

  // The page closed and opened again: the title offers level 2.
  await page.reload();
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  expect((await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((item) => item.label)).toEqual(['CONTINUE - LEVEL 2', 'NEW GAME']);
  expect(problems).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------
// The campaign as one session
// ---------------------------------------------------------------------------------------------------

test('the ten scripts as one session change level at every airlock and end on the win screen, with the score Node finds', async ({ page }) => {
  test.setTimeout(120_000);
  // Each airlock's exiting phase lasts exitTicks; the next level's script starts on the tick after it.
  const wait: InputScript['runs'][number] = [0, PHYS.exitTicks];
  const runs = CAMPAIGN_IDS.flatMap((id) => [...readScript(id).runs, wait]);
  const node = nodeReplay(CAMPAIGN_IDS, runs, 'sessionEnd');
  const first = readScript('level-01');
  expect(node.result).toEqual({ won: true, trophyTick: first.trophyTick, winTick: first.winTick, died: null, ticks: scriptTicks({ runs }) });
  expect(node.end).toMatchObject({ status: 'won', levelId: 'level-10', levelIndex: 9 });

  const problems = watch(page);
  await openGame(page);
  const result = await replay(page, CAMPAIGN_IDS, runs, FAST, 'sessionEnd');
  // died: null is the first death of the whole session: there was none in any level.
  expect(result).toEqual(node.result);
  await expect.poll(() => scenes(page)).toEqual(['End']);
  expect(await now(page)).toMatchObject({ ...node.end });
  expect((await page.evaluate(() => window.__E2E__?.menu() ?? [])).map((item) => item.label)).toEqual(['PLAY AGAIN', 'TITLE']);
  expect(problems).toEqual([]);
});
