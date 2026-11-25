import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { InputScript } from '../src/core/types.ts';

/**
 * The pause, as a player meets it (docs/SPEC.md "Pause", docs/ARCHITECTURE.md 11.1): what stands still under
 * the menu, what a key held through it may not do afterwards, RESTART LEVEL from the intro card, and that the
 * scenes can be visited again and again without leaving listeners behind.
 */

interface RoomScript extends InputScript {
  readonly trophyTick: number;
  readonly winTick: number;
}
const readScript = (id: string): RoomScript =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as RoomScript;

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('touchcancel')) problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  return problems;
}

async function open(page: Page, query = ''): Promise<string[]> {
  const problems = watch(page);
  await page.goto(`./?e2e=1${query}`);
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

const state = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const hud = (page: Page) => page.evaluate(() => window.__E2E__?.hud() ?? null);
const menuLabels = (page: Page): Promise<string[]> => page.evaluate(() => (window.__E2E__?.menu() ?? []).map((m) => m.label));

/** Waits `n` rendered frames inside the page. */
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const next = (): void => {
          i += 1;
          if (i >= count) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    n,
  );
}

/** Clicks the menu row whose label starts with `text`, where the hook says it is, once the menu takes picks (an end screen's lights after a moment). */
async function pick(page: Page, text: string): Promise<void> {
  await expect.poll(async () => (await page.evaluate(() => window.__E2E__?.menu() ?? [])).some((i) => i.label.startsWith(text) && i.armed)).toBe(true);
  const items = await page.evaluate(() => window.__E2E__?.menu() ?? []);
  const item = items.find((i) => i.label.startsWith(text));
  if (!item) throw new Error(`no menu row ${text}`);
  await page.mouse.click(item.x + item.w / 2, item.y + item.h / 2);
}

async function openPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await menuLabels(page)).length).toBe(5);
}

/**
 * A key held on a real keyboard auto-repeats: a keydown with `repeat: true` about every 33 ms. Playwright's
 * keyboard.down on a key that is already down sends exactly that. Repeats for `n` frames, two frames apart.
 */
async function holdWithRepeats(page: Page, key: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 2) {
    await page.keyboard.down(key);
    await frames(page, 2);
  }
}

const KEY_OF = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space', fire: 'KeyX', thrust: 'KeyZ' } as const;
type Button = keyof typeof KEY_OF;
const BITS: Readonly<Record<Button, number>> = { left: 1, right: 2, jump: 4, fire: 8, thrust: 16 };

/**
 * Plays a script's runs with real keys up to (not including) script tick `until`, then freezes the game there, as
 * e2e/rooms.spec.ts does (pace(1) and freezeAtTick, so a busy machine cannot let a tick slip). Returns the level tick
 * the script started on. Every key is let go before it returns, with the game still frozen.
 */
async function playUntil(page: Page, runs: InputScript['runs'], until: number): Promise<number> {
  await page.evaluate(() => {
    window.__E2E__?.pace(1);
  });
  const base = (await page.evaluate(() => window.__E2E__?.freezeAtTick(0))) ?? 0;
  let held = 0;
  const set = async (bits: number): Promise<void> => {
    for (const b of Object.keys(KEY_OF) as Button[]) {
      const want = (bits & BITS[b]) !== 0;
      if (want === ((held & BITS[b]) !== 0)) continue;
      if (want) await page.keyboard.down(KEY_OF[b]);
      else await page.keyboard.up(KEY_OF[b]);
    }
    held = bits;
  };
  let k = 0;
  for (const [bits, length] of runs) {
    if (k >= until) break;
    const at = await page.evaluate((t) => window.__E2E__?.freezeAtTick(t), base + k);
    expect(at, 'the script fell behind').toBe(base + k);
    await set(bits);
    await page.evaluate(() => {
      window.__E2E__?.freeze(false);
    });
    k += length;
  }
  await page.evaluate((t) => window.__E2E__?.freezeAtTick(t), base + until);
  await set(0);
  await page.evaluate(() => {
    window.__E2E__?.pace(null);
  });
  return base;
}

test.describe('a key held through the pause', () => {
  /** Each way the menu can close; every one of them must leave RIGHT, still held, unable to open the ready gate. */
  const closes: { name: string; close: (page: Page) => Promise<void> }[] = [
    { name: 'Esc', close: (page) => page.keyboard.press('Escape') },
    { name: 'RESUME', close: (page) => pick(page, 'RESUME') },
    { name: 'RESTART LEVEL', close: (page) => pick(page, 'RESTART LEVEL') },
  ];
  for (const { name, close } of closes) {
    test(`auto-repeating, as on a real keyboard, does not start the world after ${name}`, async ({ page }) => {
      const problems = await open(page, '&level=test');
      await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
      await frames(page, 4);
      await page.keyboard.down('ArrowRight');
      await expect.poll(async () => (await state(page))?.phase).toBe('playing');
      await openPause(page);
      await holdWithRepeats(page, 'ArrowRight', 20);
      await close(page);
      await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
      expect((await state(page))?.phase).toBe('ready');
      // RIGHT is never let go: ruling R4, "a thumb that is already resting on a button does not count".
      await holdWithRepeats(page, 'ArrowRight', 80);
      const held = await state(page);
      expect(held?.phase).toBe('ready');
      expect(await page.evaluate(() => window.__E2E__?.held().right)).toBe(false);
      // Lift and press: the gate opens.
      await page.keyboard.up('ArrowRight');
      await frames(page, 3);
      await page.keyboard.down('ArrowRight');
      await expect.poll(async () => (await state(page))?.phase).toBe('playing');
      await page.keyboard.up('ArrowRight');
      expect(problems).toEqual([]);
    });
  }

  test('a held Esc opens the menu once and its auto-repeats do not close it', async ({ page }) => {
    const problems = await open(page, '&level=test');
    await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
    await page.keyboard.down('Escape');
    await expect.poll(async () => (await menuLabels(page)).length).toBe(5);
    // Every repeat is looked at: a repeat taken for a press closed the menu, and the next one opened it again.
    const modes: (string | undefined)[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.down('Escape');
      await frames(page, 2);
      modes.push((await state(page))?.mode);
    }
    expect(new Set(modes)).toEqual(new Set(['paused']));
    expect(await scenes(page)).toContain('Pause');
    await page.keyboard.up('Escape');
    expect(problems).toEqual([]);
  });

  test('after a blur, a key still held (auto-repeating once the window has focus again) does not start the world', async ({ page }) => {
    const problems = await open(page, '&level=test');
    await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
    await frames(page, 4);
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await state(page))?.phase).toBe('playing');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await menuLabels(page)).length).toBe(5);
    await holdWithRepeats(page, 'ArrowRight', 10);
    await page.keyboard.press('Escape');
    await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
    await holdWithRepeats(page, 'ArrowRight', 60);
    expect((await state(page))?.phase).toBe('ready');
    await page.keyboard.up('ArrowRight');
    expect(problems).toEqual([]);
  });
});

test('RESTART LEVEL from a pause opened on the intro card takes the card down; the level waits at its ready gate', async ({ page }) => {
  const problems = await open(page, '&level=test');
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'intro');
  const lives = (await state(page))?.lives ?? 0;
  expect((await hud(page))?.intro.length).toBeGreaterThan(0);
  await openPause(page);
  await pick(page, 'RESTART LEVEL');
  await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
  await frames(page, 10);
  expect(await state(page)).toMatchObject({ mode: 'running', phase: 'ready', lives: lives - 1 });
  expect((await hud(page))?.intro).toEqual([]);
  // RESUME from a pause on the card still goes back to the card (it is not the restart's business).
  expect(problems).toEqual([]);
});

test('RESUME from a pause opened on the intro card goes back to the card', async ({ page }) => {
  const problems = await open(page, '&level=test');
  await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'intro');
  await openPause(page);
  await pick(page, 'RESUME');
  await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
  expect((await state(page))?.mode).toBe('intro');
  expect((await hud(page))?.intro.length).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

test.describe('the HUD stands still under the pause menu', () => {
  test('the COG FOUND toast is still up after a long pause, and runs out only after RESUME', async ({ page }) => {
    const problems = await open(page, '&level=test');
    await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
    const script = readScript('test');
    await playUntil(page, script.runs, script.trophyTick + 3);
    expect((await state(page))?.hasTrophy).toBe(true);
    expect((await hud(page))?.toast).toBe('COG FOUND! AIRLOCK OPEN');
    await page.evaluate(() => {
      window.__E2E__?.freeze(false);
    });
    await openPause(page);
    expect((await hud(page))?.held).toBe(true);
    await frames(page, 150); // longer than the toast's whole time (TUNING.effects.toastFrames, 90)
    expect((await hud(page))?.toast).toBe('COG FOUND! AIRLOCK OPEN');
    await page.keyboard.press('Escape');
    await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
    expect((await hud(page))?.toast).toBe('COG FOUND! AIRLOCK OPEN');
    expect((await hud(page))?.held).toBe(false);
    // ...and it goes on running out once the game runs again.
    await expect.poll(async () => (await hud(page))?.toast ?? null, { timeout: 5000 }).toBeNull();
    expect(problems).toEqual([]);
  });

  test('the LEVEL CLEAR banner stays for as long as the hero stands in the airlock, a pause included', async ({ page }) => {
    const problems = await open(page, '&level=test');
    await page.waitForFunction(() => window.__E2E__?.state()?.mode === 'running');
    const script = readScript('test');
    await playUntil(page, script.runs, script.winTick + 5);
    expect((await state(page))?.phase).toBe('exiting');
    expect((await hud(page))?.banner).toMatch(/^LEVEL CLEAR/);
    await page.evaluate(() => {
      window.__E2E__?.freeze(false);
    });
    await openPause(page);
    await frames(page, 120); // longer than the whole exiting phase (TUNING.timing.exitFrames, 60)
    await page.keyboard.press('Escape');
    await expect.poll(() => scenes(page)).toContain('Hud');
    const after = await state(page);
    expect(after?.phase).toBe('exiting');
    expect((await hud(page))?.banner).toMatch(/^LEVEL CLEAR/);
    expect(problems).toEqual([]);
  });
});

test('visiting every scene again and again leaves no listener behind on any of them', async ({ page }) => {
  const problems = await open(page);
  const round = async (): Promise<void> => {
    // Title -> Play (Enter starts or continues) -> Pause -> RESTART x3 (the last one, GIVE UP, is the game over) -> End -> Title.
    await page.keyboard.press('Enter');
    await expect.poll(() => scenes(page)).toContain('Hud');
    for (let i = 0; i < 3; i++) {
      await expect.poll(async () => (await state(page))?.mode).toMatch(/^(intro|running)$/);
      await openPause(page);
      await pick(page, i < 2 ? 'RESTART LEVEL' : 'GIVE UP');
      await expect.poll(async () => (await scenes(page)).includes('Pause')).toBe(false);
    }
    await expect.poll(() => scenes(page)).toEqual(['End']);
    await pick(page, 'TITLE');
    await expect.poll(() => scenes(page)).toEqual(['Title']);
    await frames(page, 3);
  };
  await round();
  const first = await page.evaluate(() => window.__E2E__?.listeners() ?? {});
  for (let i = 0; i < 3; i++) await round();
  const after = await page.evaluate(() => window.__E2E__?.listeners() ?? {});
  expect(Object.keys(first).sort()).toEqual(['Boot', 'End', 'Hud', 'Pause', 'Play', 'Title']);
  expect(after).toEqual(first);
  expect(problems).toEqual([]);
});
