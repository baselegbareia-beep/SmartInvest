import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

import type { InputScript } from '../src/core/types.ts';

/**
 * The touch pad in the real game, driven with real touches (docs/ARCHITECTURE.md section 2:
 * "slide LEFT to RIGHT, hold RIGHT and tap JUMP, cancel and blur release everything"), and the pause
 * menu worked by touch on the canvas.
 *
 * The pad itself (src/input/TouchPad.ts) is unit-tested alone; the unit tests cover the layout and the
 * press latch. This file proves the wiring in the built game: fingers reach the game's `Controls`, the
 * hero moves, and the pad gives way to the canvas menus.
 *
 * What it relies on in the game:
 * 1. `./?level=test&touch=1&e2e=1` opens the movement room by itself (no tap on the title), with touch
 *    mode forced on and the test hook installed (docs/ARCHITECTURE.md 11.6).
 * 2. While the level is played the pad is on screen (`.touchpad.is-visible`), also under the level's
 *    intro card, so a tap can skip it.
 * 3. `window.__E2E__.held()`: `controls.held()` of the one `Controls` the pad and the keyboard write to.
 * 4. `window.__E2E__.state()`: `tick` stands still while the intro card is up and grows while the core
 *    is stepped; `player.x` grows while RIGHT is held (sub-pixels).
 * 5. A window blur pauses the game: `PlayScene.pauseGame()` calls `pad.hide()` and
 *    `controls.releaseAll()` and opens the pause menu (docs/PHASER4-NOTES.md section 16).
 * 6. `window.__E2E__.menu()`: the buttons of the menu on screen and where they are, in CSS px.
 * Buttons of the pad are found by their own `[data-btn="..."]` attributes, a pressed one by `is-on`.
 */

interface Held {
  left: boolean;
  right: boolean;
  jump: boolean;
  fire: boolean;
  thrust: boolean;
}

/** The fields of `window.__E2E__` this file uses. */
interface TouchHook {
  held(): Held;
  state(): { tick: number; mode: string; phase: string; player: { x: number } };
  scenes(): string[];
  menu(): { label: string; x: number; y: number; w: number; h: number }[];
  freeze(on: boolean): void;
  pace(framesPerRender: number | null): void;
  freezeAtTick(tick: number): Promise<number>;
  heroOnPage(): { x: number; y: number; w: number; h: number } | null;
}
interface HookWindow {
  __E2E__?: TouchHook;
}

interface Finger {
  x: number;
  y: number;
  id: number;
}

const NOTHING: Held = { left: false, right: false, jump: false, fire: false, thrust: false };

// A phone: real touch events, no mouse.
test.use({ hasTouch: true, isMobile: true });

/**
 * One real touch event through the DevTools protocol (docs/PHASER4-NOTES.md section 20).
 * touchStart and touchMove list every finger that is down; touchEnd lists the fingers being
 * lifted (an empty list lifts all); touchCancel with an empty list cancels all.
 */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', fingers: Finger[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: fingers.map((f) => ({ x: f.x, y: f.y, id: f.id, radiusX: 8, radiusY: 8, force: 1 })),
  });
}

const held = (page: Page): Promise<Held> =>
  page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook) throw new Error('window.__E2E__ is missing');
    return hook.held();
  });

const state = (page: Page): Promise<{ tick: number; x: number }> =>
  page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook) throw new Error('window.__E2E__ is missing');
    const now = hook.state();
    return { tick: now.tick, x: now.player.x };
  });
const playerX = async (page: Page): Promise<number> => (await state(page)).x;
const tick = async (page: Page): Promise<number> => (await state(page)).tick;

/** The buttons that are drawn pressed, in alphabetical order. */
const lit = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.touchpad [data-btn].is-on')].map((el) => el.dataset.btn ?? '').sort(),
  );

/** The middle of a pad button, in CSS px. */
async function centre(page: Page, button: string, id: number): Promise<Finger> {
  const box = await page.locator(`.touchpad [data-btn="${button}"]`).boundingBox();
  if (!box) throw new Error(`the ${button} button is not on the page`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id };
}

/** Opens the movement room and waits until it is being played, with the pad on screen. Collects page errors as it goes. */
async function openRoom(page: Page): Promise<{ cdp: CDPSession; problems: string[] }> {
  const problems: string[] = [];
  page.on('console', (message) => {
    // Phaser cancels a touchcancel that cannot be cancelled and Chromium reports it as an error
    // (docs/PHASER4-NOTES.md section 14). It is harmless and not the pad's.
    if (message.type() === 'error' && !message.text().includes('touchcancel')) problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?level=test&touch=1&e2e=1');
  await page.waitForFunction(() => (window as unknown as HookWindow).__E2E__ !== undefined);
  await page.locator('.touchpad.is-visible').waitFor({ state: 'visible' });
  // The intro card may still be up. The core is stepped only once it is gone: wait for a tick,
  // so that a press made by a test is a press in the level and not the one that skips the card.
  const firstTick = await tick(page);
  await expect.poll(() => tick(page)).toBeGreaterThan(firstTick);
  const cdp = await page.context().newCDPSession(page);
  return { cdp, problems };
}

test('hold RIGHT and tap JUMP with a second finger', async ({ page }) => {
  const { cdp, problems } = await openRoom(page);
  const right = await centre(page, 'right', 0);
  const jump = await centre(page, 'jump', 1);
  const startX = await playerX(page);

  await touch(cdp, 'touchStart', [right]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true });

  await touch(cdp, 'touchStart', [right, jump]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true, jump: true });
  expect(await lit(page)).toEqual(['jump', 'right']);

  await touch(cdp, 'touchEnd', [jump]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true });
  // The first press also opened the level's ready gate: the hero is running right.
  await expect.poll(() => playerX(page)).toBeGreaterThan(startX);

  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => held(page)).toEqual(NOTHING);
  expect(await lit(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('slide a thumb from LEFT to RIGHT without lifting, then off the pad', async ({ page }) => {
  const { cdp, problems } = await openRoom(page);
  const left = await centre(page, 'left', 0);
  const right = await centre(page, 'right', 0);

  await touch(cdp, 'touchStart', [left]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, left: true });

  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', [{ x: Math.round(left.x + ((right.x - left.x) * i) / steps), y: left.y, id: 0 }]);
    const now = await held(page);
    expect(now.left !== now.right, `step ${i}: exactly one of LEFT and RIGHT is held`).toBe(true);
  }
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true });
  expect(await lit(page)).toEqual(['right']);

  // Sliding off every button lets go, although the finger is still down.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await touch(cdp, 'touchMove', [{ x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2), id: 0 }]);
  await expect.poll(() => held(page)).toEqual(NOTHING);

  await touch(cdp, 'touchEnd', []);
  expect(problems).toEqual([]);
});

test('a cancelled touch and a window blur release everything', async ({ page }) => {
  const { cdp, problems } = await openRoom(page);
  const right = await centre(page, 'right', 0);
  const jump = await centre(page, 'jump', 1);

  // The browser takes the touches away (a system gesture, an incoming call).
  await touch(cdp, 'touchStart', [right]);
  await touch(cdp, 'touchStart', [right, jump]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true, jump: true });
  await touch(cdp, 'touchCancel', []);
  await expect.poll(() => held(page)).toEqual(NOTHING);
  expect(await lit(page)).toEqual([]);

  // The window loses focus while a finger is down: the game pauses, which hides the pad.
  await touch(cdp, 'touchStart', [right]);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => held(page)).toEqual(NOTHING);
  await expect(page.locator('.touchpad.is-visible')).toHaveCount(0);
  await expect.poll(() => scenes(page)).toContain('Pause');
  // The finger that is still down is forgotten: moving it holds nothing.
  await touch(cdp, 'touchMove', [{ x: right.x + 4, y: right.y, id: 0 }]);
  expect(await held(page)).toEqual(NOTHING);

  await touch(cdp, 'touchEnd', []);
  expect(problems).toEqual([]);
});

const scenes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook) throw new Error('window.__E2E__ is missing');
    return hook.scenes();
  });

const phase = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook) throw new Error('window.__E2E__ is missing');
    return hook.state().phase;
  });

const mode = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook) throw new Error('window.__E2E__ is missing');
    return hook.state().mode;
  });

/** The middle of a menu button on the canvas, by its words, in CSS px. */
async function menuButton(page: Page, label: string, id: number): Promise<Finger> {
  const items = await page.evaluate(() => (window as unknown as HookWindow).__E2E__?.menu() ?? []);
  const item = items.find((i) => i.label === label);
  if (!item) throw new Error(`no menu item "${label}" in ${JSON.stringify(items.map((i) => i.label))}`);
  return { x: Math.round(item.x + item.w / 2), y: Math.round(item.y + item.h / 2), id };
}

test('PAUSE on the pad opens the menu over the canvas, and a tap on RESUME closes it', async ({ page }) => {
  const { cdp, problems } = await openRoom(page);
  const pause = await centre(page, 'pause', 0);
  // The world is running when PAUSE is touched: RIGHT opened the ready gate (and is let go again).
  const run = await centre(page, 'right', 3);
  await touch(cdp, 'touchStart', [run]);
  await expect.poll(() => phase(page)).toBe('playing');
  await touch(cdp, 'touchEnd', []);

  await touch(cdp, 'touchStart', [pause]);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => scenes(page)).toContain('Pause');
  expect(await mode(page)).toBe('paused');
  // The pad gives way: the menu underneath must get the taps.
  await expect(page.locator('.touchpad.is-visible')).toHaveCount(0);
  const pausedTick = await tick(page);
  await page.waitForTimeout(200);
  expect(await tick(page)).toBe(pausedTick);

  const resume = await menuButton(page, 'RESUME', 1);
  await touch(cdp, 'touchStart', [resume]);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => mode(page)).toBe('running');
  await expect.poll(() => scenes(page)).toEqual(['Play', 'Hud']);
  await page.locator('.touchpad.is-visible').waitFor({ state: 'visible' });
  // Back behind the ready gate: nothing is held, and the world waits for a fresh press however long...
  expect(await phase(page)).toBe('ready');
  expect(await held(page)).toEqual(NOTHING);
  await expect.poll(() => tick(page)).toBeGreaterThan(pausedTick);
  const x = await playerX(page);
  await page.waitForTimeout(300);
  expect(await phase(page)).toBe('ready');
  expect(await playerX(page)).toBe(x);
  // ...then RIGHT opens it and runs again.
  const right = await centre(page, 'right', 2);
  await touch(cdp, 'touchStart', [right]);
  await expect.poll(() => phase(page)).toBe('playing');
  await expect.poll(() => playerX(page)).toBeGreaterThan(x);
  await touch(cdp, 'touchEnd', []);
  expect(problems).toEqual([]);
});

test('a key press hides the pad; the next touch on a button brings it back AND presses that button', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  // No ?touch=1: touch mode comes from the coarse pointer of this emulated phone, and a key press can end it.
  await page.goto('./?level=test&e2e=1');
  await page.waitForFunction(() => (window as unknown as HookWindow).__E2E__?.state().mode === 'running');
  await page.locator('.touchpad.is-visible').waitFor({ state: 'visible' });
  const right = await centre(page, 'right', 0);
  const cdp = await page.context().newCDPSession(page);

  // Cmd or Ctrl alone (a tablet keyboard's app switcher) is not keyboard play: the pad stays.
  await page.keyboard.press('Meta');
  await page.keyboard.press('Control');
  await expect(page.locator('.touchpad.is-visible')).toHaveCount(1);
  // A game key is: the pad goes.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.touchpad.is-visible')).toHaveCount(0);

  // One touch on RIGHT: the pad is back and RIGHT is held by that very touch, not by a second one.
  await touch(cdp, 'touchStart', [right]);
  await expect(page.locator('.touchpad.is-visible')).toHaveCount(1);
  await expect.poll(() => held(page)).toEqual({ ...NOTHING, right: true });
  expect(await lit(page)).toEqual(['right']);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => held(page)).toEqual(NOTHING);
  expect(problems).toEqual([]);
});

test('the hero standing by a side wall is drawn clear of the pad buttons (the view passes the wall instead)', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  // The movement room starts its hero by the left wall, as several campaign levels do.
  await page.goto('./?level=test&touch=1&e2e=1');
  await page.waitForFunction(() => (window as unknown as HookWindow).__E2E__?.state().mode === 'running');
  await page.locator('.touchpad.is-visible').waitFor({ state: 'visible' });
  const right = await page.locator('.touchpad [data-btn="right"]').boundingBox();
  const hero = await page.evaluate(() => (window as unknown as HookWindow).__E2E__?.heroOnPage() ?? null);
  if (!right || !hero) throw new Error('no RIGHT button or no hero');
  // Left of the hero's sprite: everything of RIGHT (and LEFT) that lies at the hero's height.
  expect(hero.x, `hero sprite from ${hero.x} CSS px, RIGHT ends at ${right.x + right.width}`).toBeGreaterThanOrEqual(right.x + right.width - 0.5);
  expect(problems).toEqual([]);
});

test('the debug room is won with real touches on the pad, FIRE and THRUST included, on the tick Node finds', async ({ page }) => {
  const script = JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', 'debug.json'), 'utf8')) as InputScript & { winTick: number };
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?level=debug&touch=1&e2e=1');
  await page.waitForFunction(() => (window as unknown as HookWindow).__E2E__?.state().mode === 'running');
  const cdp = await page.context().newCDPSession(page);

  const BUTTONS = [['left', 1], ['right', 2], ['jump', 4], ['fire', 8], ['thrust', 16]] as const;
  const down = new Map<string, Finger>();
  // FIRE and THRUST come onto the pad with their items: each centre is looked up when first needed.
  const centres = new Map<string, Finger>();
  const setPad = async (bits: number): Promise<void> => {
    for (const [name, bit] of BUTTONS) {
      const on = (bits & bit) !== 0;
      const finger = down.get(name);
      if (on && !finger) {
        const at = centres.get(name) ?? (await centre(page, name, bit));
        centres.set(name, at);
        down.set(name, at);
        await touch(cdp, 'touchStart', [...down.values()]);
      } else if (!on && finger) {
        down.delete(name);
        await touch(cdp, 'touchEnd', [finger]);
      }
    }
  };
  // Each run's fingers change on the tick the script names: one tick per rendered frame, and the game frozen the
  // moment the tick is reached while the fingers change (as playRuns in rooms.spec.ts; the touches are real).
  await page.evaluate(() => {
    (window as unknown as HookWindow).__E2E__?.pace(1);
  });
  // The script starts on the tick the game is frozen at now.
  const base = (await page.evaluate(() => (window as unknown as HookWindow).__E2E__?.freezeAtTick(0))) ?? 0;
  let k = 0;
  let late = 0;
  const seen = new Set<string>();
  for (const [bits, length] of script.runs) {
    const at = await page.evaluate((t) => (window as unknown as HookWindow).__E2E__?.freezeAtTick(t), base + k);
    if (at !== base + k) late += 1;
    await setPad(bits);
    for (const name of await lit(page)) seen.add(name);
    await page.evaluate(() => {
      (window as unknown as HookWindow).__E2E__?.freeze(false);
    });
    k += length;
  }
  // The hero enters the airlock on the tick Node finds, not one earlier: the state frozen on each of the two ticks.
  const stateAt = async (t: number): Promise<ReturnType<TouchHook['state']> | undefined> => {
    await page.evaluate((at) => (window as unknown as HookWindow).__E2E__?.freezeAtTick(at), t);
    const state = await page.evaluate(() => (window as unknown as HookWindow).__E2E__?.state());
    await page.evaluate(() => {
      (window as unknown as HookWindow).__E2E__?.freeze(false);
    });
    return state;
  };
  const before = await stateAt(base + script.winTick - 1);
  const end = await stateAt(base + script.winTick);
  await setPad(0);
  await page.evaluate(() => {
    (window as unknown as HookWindow).__E2E__?.pace(null);
  });

  expect(late, 'runs whose fingers changed late').toBe(0);
  expect(before).toMatchObject({ phase: 'playing', tick: base + script.winTick - 1 });
  expect(end).toMatchObject({ phase: 'exiting', tick: base + script.winTick });
  // Every button of the pad was pressed on the way, FIRE and THRUST among them.
  expect([...seen].sort()).toEqual(['fire', 'jump', 'left', 'right', 'thrust']);
  expect(problems).toEqual([]);
});
