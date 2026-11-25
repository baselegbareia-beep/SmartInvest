import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { compileTuning } from '../src/core/compileTuning.ts';
import { parseLevel } from '../src/core/level.ts';
import type { InputScript } from '../src/core/types.ts';
import { POPUP_TOP, POPUP_TOP_UNDER_TOAST, STRIP_H } from '../src/shell/hudModel.ts';
import { measureRoute, shippedCamera, shippedPopups } from '../src/shell/routeMeasure.ts';
import { TUNING } from '../src/tuning.ts';

/**
 * What the route watch of 24 November 2026 found, seen again in the built game on the smallest phone of the
 * device table (568 x 320 at 2, touch): each level's validator proof (`e2e/scripts/level-NN.json`) replayed
 * through `window.__E2E__.replay` at one tick per frame, frozen on the tick that showed the fault.
 *
 * - THRUST was drawn on the hero's own row, 8 to 10 tiles ahead: level 8's packs lay behind it before the take-offs.
 * - At a level clear the hero hovered on the airlock's lintel for the whole banner.
 * - A death by falling played out below the screen.
 * - Score pop-ups rose into the top bar and through the cog's toast.
 * - No airlock pointer while the airlock lay exactly at the view's bottom edge (level 7 after the cog).
 *
 * And what its re-check found (the same day), after the camera's standing framing and the pop-up board:
 * - The bottom pass drew level 9 so low that the deck-2 pack sat dimmed in the top bar's row, read as a HUD icon.
 * - Pop-ups held under the cog's toast were drawn in one row and across the hero ('1+100', levels 1 and 2).
 *
 * And its second re-check (25 November 2026):
 * - Pop-ups hopped round a moving hero from frame to frame, '+50' left and right of him on alternate frames (level 5).
 * - On a 120 Hz display slivers of pop-ups lay on the hero as drawn between two ticks; under reduced motion a still
 *   pop-up stayed on him once he walked into it.
 * - No test saw the framing use the pad's buttons (the Play scene could have passed none).
 * - Stepping a frozen replay one tick at a time took two round trips, and a busy machine let a tick slip by.
 */

test.use({ viewport: { width: 568, height: 320 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LookNow {
  camX: number;
  camY: number;
  popups: number;
  popupRise: number;
  popupTop: number | null;
  popupBoxes: (Box & { id: number })[];
  pointer: string | null;
  hero: { frame: string; visible: boolean; filled: boolean } | null;
  heroBox?: Box | null;
}

interface Hook {
  state(): { tick: number; phase: string; mode: string; player: { x: number; y: number } } | null;
  replay(id: string, script: InputScript, ticksPerFrame?: number, options?: { stopAtTick?: number; until?: 'levelCompleted' | 'sessionEnd'; realTime?: boolean }): Promise<unknown>;
  freezeAtTick(tick: number): Promise<number>;
  freeze(on: boolean): void;
  heroOnPage(): Box | null;
  cellOnPage(col: number, row: number): Box | null;
  look(): LookNow | null;
  hud(): { toast: string | null; banner: string | null; drawn: { kind: string; x: number; y: number; w: number; h: number }[] } | null;
}

type HookWindow = Window & { __E2E__?: Hook; __GAME_READY__?: boolean };

interface LevelScript extends InputScript {
  readonly winTick: number;
}

const readScript = (id: string): LevelScript => JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as LevelScript;

/** The cell of the first `ch` in a level file's grid (0-based column and row). */
function cellOf(levelFile: string, ch: string): { col: number; row: number } {
  const grid = readFileSync(path.join(import.meta.dirname, '..', 'levels', levelFile), 'utf8')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !line.startsWith('@') && !line.startsWith(';'));
  const row = grid.findIndex((line) => line.includes(ch));
  if (row < 0) throw new Error(`no ${ch} in ${levelFile}`);
  return { col: grid[row]?.indexOf(ch) ?? -1, row };
}

async function open(page: Page): Promise<void> {
  await page.goto('./?e2e=1&touch=1');
  await page.waitForFunction(() => (window as HookWindow).__E2E__ !== undefined && (window as HookWindow).__GAME_READY__ === true);
}

/**
 * Starts `id`'s proof (with `extra` runs after it) at one tick per frame and freezes the game on `tick`: in one round
 * trip, the freeze asked for before the first frame can run.
 */
async function replayTo(page: Page, id: string, runs: InputScript['runs'], tick: number): Promise<void> {
  const at = await page.evaluate(
    ([i, r, t]) => {
      const hook = (window as HookWindow).__E2E__;
      void hook?.replay(i, { runs: r }, 1, { until: 'sessionEnd' });
      return hook?.freezeAtTick(t);
    },
    [id, runs, tick] as const,
  );
  expect(at).toBe(tick);
}

/**
 * From a frozen game, runs on to `tick` and freezes there, in one round trip: the freeze is asked for before the game
 * is let go. (Two calls, `freeze(false)` and then `freezeAtTick`, let a frame or more go by between them on a busy
 * machine, and the replay, at one tick per frame, could pass the tick asked for: "Expected 610, Received 611".)
 */
async function stepTo(page: Page, tick: number): Promise<number | undefined> {
  return page.evaluate((t) => {
    const hook = (window as HookWindow).__E2E__;
    const at = hook?.freezeAtTick(t);
    hook?.freeze(false);
    return at;
  }, tick);
}

/** The pad's drawn buttons now (FIRE and THRUST only while shown), page CSS px. */
const drawnButtons = (page: Page): Promise<(Box & { id: string })[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.touchpad.is-visible [data-btn]')]
      .filter((el) => !el.classList.contains('touchpad__btn--item') || el.classList.contains('is-shown'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.btn ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
      }),
  );

/** The buttons a rectangle lies under by more than a quarter of its area. */
const under = (r: Box, buttons: (Box & { id: string })[]): string[] =>
  buttons
    .filter((b) => Math.max(0, Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x)) * Math.max(0, Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y)) > (r.w * r.h) / 4)
    .map((b) => b.id);

test("level 8: the packs the hero flies for are clear of THRUST (and every button) at the take-offs (they lay behind THRUST)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-08');
  // The take-offs toward the pack before flight 2 (thruster at 28,9) and toward the floating pack (38,9) on the
  // game's longest flight, as the route watch's probe found them on this phone.
  const packs = [
    { tick: 237, cell: { col: 28, row: 9 } },
    { tick: 241, cell: { col: 28, row: 9 } },
    { tick: 391, cell: { col: 38, row: 9 } },
  ];
  await page.evaluate((r) => {
    void (window as HookWindow).__E2E__?.replay('level-08', { runs: r }, 1, { until: 'sessionEnd' });
  }, script.runs);
  for (const p of packs) {
    expect(await stepTo(page, p.tick)).toBe(p.tick);
    const cell = await page.evaluate((c) => (window as HookWindow).__E2E__?.cellOnPage(c.col, c.row) ?? null, p.cell);
    if (!cell) throw new Error('no level drawn');
    const buttons = await drawnButtons(page);
    expect(buttons.map((b) => b.id).sort(), 'the pack is worn: THRUST is on the pad').toContain('thrust');
    expect(cell.x + cell.w > 0 && cell.x < 568 && cell.y + cell.h > 0 && cell.y < 320, `the pack at tick ${p.tick} is on screen`).toBe(true);
    expect(under(cell, buttons), `the pack at ${p.cell.col},${p.cell.row} on tick ${p.tick}: ${JSON.stringify(cell)}`).toEqual([]);
  }
});

test('level 1: at the level clear the hero stands in the airlock, centred, feet on its floor, under the banner', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-01');
  const door = cellOf('level-01.txt', 'D');
  await replayTo(page, 'level-01', [...script.runs, [0, 120]], script.winTick + 20);
  const at = await page.evaluate((d) => {
    const hook = (window as HookWindow).__E2E__;
    return { hero: hook?.heroOnPage() ?? null, door: hook?.cellOnPage(d.col, d.row) ?? null, phase: hook?.state()?.phase, banner: hook?.hud()?.banner ?? null };
  }, door);
  await page.screenshot({ path: test.info().outputPath('level-01-clear.png') });
  expect(at.phase).toBe('exiting');
  expect(at.banner).toMatch(/^LEVEL CLEAR/);
  // He fell onto the airlock: the core froze him on its lintel, 15 px above its floor.
  expect(at.hero).toEqual(at.door);
});

test('level 2: a death by falling into a pit is drawn at the bottom edge of the view, not below it', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  // Run east from the start and fall into the first open pit (columns 9 and 10): he dies on tick 108.
  const runs: InputScript['runs'] = [
    [0, 12],
    [6, 41],
    [0, 1],
    [2, 54],
    [0, 200],
  ];
  for (const tick of [108, 130]) {
    if (tick === 108) await replayTo(page, 'level-02', runs, tick);
    else expect(await stepTo(page, tick)).toBe(tick);
    const at = await page.evaluate(() => {
      const hook = (window as HookWindow).__E2E__;
      const canvas = document.querySelector('#game canvas')?.getBoundingClientRect();
      return { hero: hook?.heroOnPage() ?? null, look: hook?.look() ?? null, phase: hook?.state()?.phase, bottom: canvas ? canvas.y + canvas.height : 0 };
    });
    expect(at.phase).toBe('dying');
    if (!at.hero) throw new Error('no hero');
    expect(at.hero.y + at.hero.h, `tick ${tick}: the whole sprite is in the picture`).toBeLessThanOrEqual(at.bottom + 0.01);
    expect(at.look?.hero?.visible).toBe(true);
  }
});

test("level 10: score pop-ups never rise into the top bar, nor through the cog's toast while it shows", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const script = readScript('level-10');
  // Every rendered frame (two ticks each): the highest pop-up's top, in view px, and whether the toast shows.
  await page.evaluate(() => {
    const w = window as HookWindow & { __seen?: { tick: number; top: number; toast: boolean }[]; __watch?: boolean };
    w.__seen = [];
    w.__watch = true;
    const loop = (): void => {
      const hook = w.__E2E__;
      const look = hook?.look();
      const tick = hook?.state()?.tick ?? -1;
      if (look && typeof look.popupTop === 'number') w.__seen?.push({ tick, top: look.popupTop, toast: hook?.hud()?.toast !== null && hook?.hud()?.toast !== undefined });
      if (w.__watch) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.evaluate((r) => (window as HookWindow).__E2E__?.replay('level-10', { runs: r }, 2), script.runs);
  const seen = await page.evaluate(() => {
    const w = window as HookWindow & { __seen?: { tick: number; top: number; toast: boolean }[]; __watch?: boolean };
    w.__watch = false;
    return w.__seen ?? [];
  });
  expect(seen.length, 'frames with a pop-up').toBeGreaterThan(50);
  expect(seen.some((s) => s.toast), 'a pop-up while the toast shows (the cog\'s +100)').toBe(true);
  expect(seen.filter((s) => s.top < POPUP_TOP)).toEqual([]);
  expect(seen.filter((s) => s.toast && s.top < POPUP_TOP_UNDER_TOAST)).toEqual([]);
});

test('level 7: with the cog taken, the airlock pointer shows while the airlock lies just below the view (it did not)', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-07');
  await replayTo(page, 'level-07', script.runs, 861);
  const at = await page.evaluate(() => {
    const hook = (window as HookWindow).__E2E__;
    return { look: hook?.look() ?? null, toast: hook?.hud()?.toast ?? null, drawn: hook?.hud()?.drawn ?? [] };
  });
  expect(at.toast).toBe('COG FOUND! AIRLOCK OPEN');
  expect(at.look?.pointer).toBe('down');
  // The toast is on a dark band hanging from the top bar's strip (y 14 to 26), not gold words on the level's art.
  expect(at.drawn.some((d) => d.kind === 'Rectangle' && d.y === POPUP_TOP - 2 && d.y + d.h === POPUP_TOP_UNDER_TOAST - 2 && d.w > 140), JSON.stringify(at.drawn.filter((d) => d.kind === 'Rectangle'))).toBe(true);
});

test('the ready gate: the hero is never hidden by its blink, and a chevron over him asks for a press once he has waited', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await page.evaluate(() => {
    (window as HookWindow & { __E2E__?: { startLevel(id: string): void } }).__E2E__?.startLevel('level-03');
  });
  await page.waitForFunction(() => (window as HookWindow).__E2E__?.state()?.mode === 'running');
  // One tick per rendered frame, so that freezeAtTick stops on exactly the tick asked for.
  await page.evaluate(() => {
    (window as HookWindow & { __E2E__?: { pace(n: number | null): void } }).__E2E__?.pace(1);
  });
  const start = await page.evaluate(() => (window as HookWindow).__E2E__?.state()?.tick ?? 0);
  // Every tick of the next 130: the hero shown, dimmed on alternate 8-tick spans, the chevron after 90 ticks of waiting.
  const seen: { tick: number; visible: boolean; dim: boolean; prompt: boolean }[] = [];
  for (let t = start + 2; t <= start + 130; t += 4) {
    expect(await stepTo(page, t)).toBe(t);
    const at = await page.evaluate(() => {
      const hook = (window as HookWindow).__E2E__;
      const hero = hook?.look()?.hero as { visible: boolean; dim: boolean; prompt: boolean } | null | undefined;
      return { phase: hook?.state()?.phase, hero };
    });
    expect(at.phase).toBe('ready');
    seen.push({ tick: t, visible: at.hero?.visible === true, dim: at.hero?.dim === true, prompt: at.hero?.prompt === true });
    if (t === start + 122) await page.screenshot({ path: test.info().outputPath('gate.png') });
  }
  expect(seen.filter((s) => !s.visible)).toEqual([]);
  expect(seen.some((s) => s.dim) && seen.some((s) => !s.dim), 'he blinks: dimmed, then bright').toBe(true);
  expect(seen.filter((s) => s.prompt && s.tick < start + 90)).toEqual([]);
  expect(seen.some((s) => s.prompt), 'the chevron after waiting').toBe(true);
});

/** The view's scroll on `tick` of `id`'s proof as Node's camera gives it on this phone, touch: the same framing as the game's. */
function nodeScrollY(id: string, tick: number): number {
  const level = parseLevel(readFileSync(path.join(import.meta.dirname, '..', 'levels', `${id}.txt`), 'utf8'), id);
  const script = readScript(id);
  const stop = { runs: [] as [number, number][] };
  let left = tick;
  for (const [bits, n] of script.runs) {
    if (left <= 0) break;
    stop.runs.push([bits, Math.min(n, left)]);
    left -= n;
  }
  let scrollY = Number.NaN;
  const camera = shippedCamera(TUNING);
  const watched = { ...camera, step: (...a: Parameters<typeof camera.step>) => {
    const next = camera.step(...a);
    scrollY = next.scrollY;
    return next;
  } };
  measureRoute(level, stop, compileTuning(TUNING), TUNING, { name: 'se', w: 568, h: 320, dpr: 2, touch: true }, watched, shippedPopups());
  return scrollY;
}

test("level 9: the deck-2 pack is drawn below the top bar's strip, where Node's camera frames it (it sat dimmed in the bar's row, read as a HUD icon)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-09');
  const pack = cellOf('level-09.txt', 'J');
  await page.evaluate((r) => {
    void (window as HookWindow).__E2E__?.replay('level-09', { runs: r }, 1, { until: 'sessionEnd' });
  }, script.runs);
  // At the ready gate's end, on the first hops along deck 1, and once he has walked under deck 2 (the re-check's t50).
  for (const tick of [14, 50, 90]) {
    expect(await stepTo(page, tick)).toBe(tick);
    const look = await page.evaluate(() => (window as HookWindow).__E2E__?.look() ?? null);
    if (!look) throw new Error('no look');
    expect(look.camY, `tick ${tick}: the scroll Node's camera gives`).toBe(nodeScrollY('level-09', tick));
    const top = pack.row * 16 - look.camY;
    expect(top, `tick ${tick}: the pack's top, view px`).toBeGreaterThanOrEqual(STRIP_H);
  }
});

for (const { id, from, to } of [
  { id: 'level-02', from: 596, to: 614 },
  { id: 'level-01', from: 640, to: 658 },
]) {
  test(`${id}: at the cog, the pop-ups under the toast's band are drawn apart and off the hero (they read '1+100', across him)`, async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const script = readScript(id);
    await page.evaluate(
      ([i, r]) => {
        void (window as HookWindow).__E2E__?.replay(i, { runs: r }, 1, { until: 'sessionEnd' });
      },
      [id, script.runs] as const,
    );
    let withTwo = 0;
    for (let tick = from; tick <= to; tick++) {
      expect(await stepTo(page, tick)).toBe(tick);
      const at = await page.evaluate(() => {
        const hook = (window as HookWindow).__E2E__;
        return { look: hook?.look() ?? null, state: hook?.state() ?? null, toast: hook?.hud()?.toast ?? null };
      });
      const boxes = at.look?.popupBoxes;
      if (!at.look || !at.state || !boxes) throw new Error(`tick ${tick}: no pop-up boxes from the hook`);
      // The hero's 16 px sprite in view px (the box is 10 x 14 at the sprite's foot, centred).
      const hero = { x: (at.state.player.x >> 8) - 3 - at.look.camX, y: (at.state.player.y >> 8) - 2 - at.look.camY, w: 16, h: 16 };
      const meet = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (boxes.length >= 2) withTwo += 1;
      boxes.forEach((a, n) => {
        expect(meet(a, hero), `tick ${tick}: ${JSON.stringify(a)} on the hero ${JSON.stringify(hero)}`).toBe(false);
        if (at.toast) expect(a.y, `tick ${tick}: under the toast's band`).toBeGreaterThanOrEqual(POPUP_TOP_UNDER_TOAST);
        for (const b of boxes.slice(n + 1)) expect(meet(a, b), `tick ${tick}: ${JSON.stringify(a)} on ${JSON.stringify(b)}`).toBe(false);
      });
      if (tick === from + 8) await page.screenshot({ path: test.info().outputPath(`${id}-cog.png`) });
    }
    expect(withTwo, 'two pop-ups at once (the +10 and the +100)').toBeGreaterThan(0);
  });
}

/** One frame's pop-ups and hero as drawn, view px, with the tick it showed. */
interface FrameSeen {
  tick: number;
  boxes: (Box & { id: number })[];
  hero: Box | null;
  camX: number;
  camY: number;
  rise: number;
}

type RecWindow = HookWindow & { __seen?: FrameSeen[]; __watch?: boolean };

/** Records every rendered frame's pop-ups and drawn hero (the page's own animation frames) until `stopWatching`. */
async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as RecWindow;
    w.__seen = [];
    w.__watch = true;
    const loop = (): void => {
      const hook = w.__E2E__;
      const look = hook?.look();
      const tick = hook?.state()?.tick ?? -1;
      if (look) w.__seen?.push({ tick, boxes: look.popupBoxes, hero: look.heroBox ?? null, camX: look.camX, camY: look.camY, rise: look.popupRise });
      if (w.__watch) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function stopWatching(page: Page): Promise<FrameSeen[]> {
  return page.evaluate(() => {
    const w = window as RecWindow;
    w.__watch = false;
    return w.__seen ?? [];
  });
}

const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Frames on which a pop-up lies on the hero as drawn on that frame. */
const onHero = (seen: FrameSeen[]): string[] =>
  seen.flatMap((f) => (f.hero ? f.boxes.filter((b) => meets(b, f.hero as Box)).map((b) => `tick ${f.tick}: ${JSON.stringify(b)} on ${JSON.stringify(f.hero)}`) : []));

test("level 5: a pop-up beside the hopping hero steps aside at most once and never flips round him ('+50' left and right of him on alternate frames, 36 px)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-05');
  await watchFrames(page);
  await page.evaluate((r) => (window as HookWindow).__E2E__?.replay('level-05', { runs: r }, 1), script.runs);
  const seen = (await stopWatching(page)).filter((f) => f.tick >= 760 && f.tick <= 845);
  expect(seen.filter((f) => f.boxes.length >= 2).length, 'frames with two pop-ups by him (a +10 and the +50)').toBeGreaterThan(10);
  // Each pop-up's move from one frame to the next, across plus up or down: in the world or on screen, whichever is less.
  const moves: string[] = [];
  const flips: string[] = [];
  const last = new Map<number, { x: number; y: number; camX: number; camY: number; vx: number; vy: number }>();
  for (const f of seen) {
    for (const b of f.boxes) {
      const q = last.get(b.id);
      let vx = 0;
      let vy = 0;
      if (q) {
        const sx = b.x - q.x;
        const sy = b.y - q.y;
        const wx = b.x + f.camX - (q.x + q.camX);
        const wy = b.y + f.camY - (q.y + q.camY);
        [vx, vy] = Math.abs(wx) + Math.abs(wy) <= Math.abs(sx) + Math.abs(sy) ? [wx, wy] : [sx, sy];
        if (Math.abs(vx) + Math.abs(vy) >= 3) moves.push(`tick ${f.tick}: #${b.id} ${vx},${vy}`);
        if (Math.abs(vx) + Math.abs(vy) >= 10 && Math.abs(q.vx) + Math.abs(q.vy) >= 10 && vx * q.vx + vy * q.vy < 0) flips.push(`tick ${f.tick}: #${b.id}`);
      }
      last.set(b.id, { x: b.x, y: b.y, camX: f.camX, camY: f.camY, vx, vy });
    }
  }
  expect(flips).toEqual([]);
  expect(moves.length, `steps of 3 px or more in one frame: ${moves.join('; ')}`).toBeLessThanOrEqual(4);
  expect(onHero(seen)).toEqual([]);
});

test('level 1 at 120 Hz, drawn between ticks: no pop-up ever lies on the hero as drawn (slivers of them did)', async ({ page }) => {
  test.setTimeout(180_000);
  // A display of 120 frames a second, on a clock of its own: two frames a tick, the second drawn half way between ticks.
  await page.addInitScript(() => {
    const queue: FrameRequestCallback[] = [];
    let now = -1;
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queue.push(cb);
      return queue.length;
    };
    window.cancelAnimationFrame = (): void => undefined;
    const frame = (): void => {
      now = now < 0 ? performance.now() : now + 1000 / 120;
      for (const cb of queue.splice(0)) cb(now);
      setTimeout(frame, 0);
    };
    setTimeout(frame, 0);
  });
  await open(page);
  const script = readScript('level-01');
  await watchFrames(page);
  const result = (await page.evaluate((r) => (window as HookWindow).__E2E__?.replay('level-01', { runs: r }, 1, { realTime: true }), script.runs)) as { won: boolean };
  const seen = await stopWatching(page);
  expect(result.won, 'the proof wins at 120 Hz too').toBe(true);
  // Frames drawn between ticks: two frames of one tick with the hero drawn in different places.
  let between = 0;
  for (let i = 1; i < seen.length; i++) {
    const a = seen[i - 1];
    const b = seen[i];
    if (a && b && a.tick === b.tick && a.hero && b.hero && (a.hero.x !== b.hero.x || a.hero.y !== b.hero.y)) between += 1;
  }
  expect(between, 'frames that show the hero between two ticks').toBeGreaterThan(100);
  expect(seen.filter((f) => f.boxes.length > 0).length, 'frames with a pop-up').toBeGreaterThan(200);
  expect(onHero(seen)).toEqual([]);
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const id of ['level-01', 'level-02']) {
    test(`${id}: a still pop-up the hero walks into is taken down, never drawn on him, and none rises`, async ({ page }) => {
      test.setTimeout(120_000);
      await open(page);
      const script = readScript(id);
      await watchFrames(page);
      await page.evaluate(([i, r]) => (window as HookWindow).__E2E__?.replay(i, { runs: r }, 1), [id, script.runs] as const);
      const seen = await stopWatching(page);
      expect(seen.filter((f) => f.boxes.length > 0).length, 'frames with a pop-up').toBeGreaterThan(50);
      expect(onHero(seen)).toEqual([]);
      expect(Math.max(...seen.map((f) => f.rise)), 'how far a pop-up rose').toBe(0);
    });
  }
});

/** The view's scroll on `tick` of `id`'s proof as Node's camera gives it on this phone, touch, with the pad's buttons or with none. */
function nodeScrollWith(id: string, tick: number, buttons: boolean): number {
  const level = parseLevel(readFileSync(path.join(import.meta.dirname, '..', 'levels', `${id}.txt`), 'utf8'), id);
  const script = readScript(id);
  const stop = { runs: [] as [number, number][] };
  let left = tick;
  for (const [bits, n] of script.runs) {
    if (left <= 0) break;
    stop.runs.push([bits, Math.min(n, left)]);
    left -= n;
  }
  let scrollY = Number.NaN;
  const camera = shippedCamera(TUNING);
  const watched: typeof camera = {
    snap: (g, v, l, p, b) => camera.snap(g, v, l, p, buttons ? b : null),
    step: (prev, g, v, l, p, b) => {
      const next = camera.step(prev, g, v, l, p, buttons ? b : null);
      scrollY = next.scrollY;
      return next;
    },
  };
  measureRoute(level, stop, compileTuning(TUNING), TUNING, { name: 'se', w: 568, h: 320, dpr: 2, touch: true }, watched, shippedPopups());
  return scrollY;
}

test("level 1: the framing weighs the pad's buttons as drawn: the scroll is Node's with them, not without them (no test saw them used)", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const script = readScript('level-01');
  // Ticks where the buttons change the framing on this phone (Node, both ways).
  const ticks = [150, 250, 620];
  for (const t of ticks) expect(nodeScrollWith('level-01', t, true), `tick ${t}: the buttons change the framing`).not.toBe(nodeScrollWith('level-01', t, false));
  await replayTo(page, 'level-01', script.runs, ticks[0] ?? 0);
  for (const tick of ticks) {
    if (tick !== ticks[0]) expect(await stepTo(page, tick)).toBe(tick);
    const look = await page.evaluate(() => (window as HookWindow).__E2E__?.look() ?? null);
    expect(look?.camY, `tick ${tick}: the scroll with the buttons`).toBe(nodeScrollWith('level-01', tick, true));
  }
});
