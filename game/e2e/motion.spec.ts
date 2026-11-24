import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { InputScript } from '../src/core/types.ts';

/**
 * Reduced motion (docs/ART-AND-SOUND.md section 13): a phone that asks for it (`prefers-reduced-motion:
 * reduce`, Playwright's `reducedMotion` context option) gets no shake, no screen flash and no particles, score
 * pop-ups that stay where they appear, a title prompt that does not blink, the hero does not blink in the ready
 * gate, and a death still reads: the hero's fill, his break-apart frames and the fade. The same runs without the
 * setting show each of those, so the measurements can see them.
 *
 * What it relies on in the game: `window.__E2E__.replay` (docs/ARCHITECTURE.md 11.6) and `look()`, what the
 * last frame drew: the scroll with and without the shake, particles alive, the screen flash and the fade, the
 * score pop-ups and their rise, the hero's frame; and `menuText()`, whether the title's prompt is drawn. Each is
 * sampled once per animation frame.
 */

interface Sampled {
  frames: number;
  particles: number;
  flash: number;
  fade: number;
  /** Largest distance between the scroll Phaser drew with and the camera's own: the shake. */
  shake: number;
  /** Frames with a score pop-up on screen, and the most any of them had risen from where it appeared. */
  popupFrames: number;
  popupRise: number;
  /** Hero frames seen while dying, and whether he was seen filled (a death's flash). */
  dyingFrames: string[];
  filled: boolean;
  /** Ready-gate frames on which the hero was hidden (the blink). */
  readyHidden: number;
  readyFrames: number;
}

/** Replays `runs` in the debug room, `ticksPerFrame` ticks a frame, sampling `look()` on every animation frame. */
async function sampleReplay(page: Page, runs: InputScript['runs'], ticksPerFrame: number, untilSessionEnd: boolean): Promise<Sampled> {
  return page.evaluate(
    async ({ runs, ticksPerFrame, untilSessionEnd }) => {
      const hook = window.__E2E__;
      if (!hook) throw new Error('window.__E2E__ is missing');
      const s = { frames: 0, particles: 0, flash: 0, fade: 0, shake: 0, popupFrames: 0, popupRise: 0, dyingFrames: [] as string[], filled: false, readyHidden: 0, readyFrames: 0 };
      let done = false;
      const replay = hook.replay('debug', { runs }, ticksPerFrame, untilSessionEnd ? { until: 'sessionEnd' } : {}).then(() => {
        done = true;
      });
      const sample = (): void => {
        const look = hook.look();
        const state = hook.state();
        if (!look || !state) return;
        s.frames += 1;
        s.particles = Math.max(s.particles, look.particles);
        s.flash = Math.max(s.flash, look.flash);
        s.fade = Math.max(s.fade, look.fade);
        s.shake = Math.max(s.shake, Math.abs(look.scrollX - look.camX) + Math.abs(look.scrollY - look.camY));
        if (look.popups > 0) s.popupFrames += 1;
        s.popupRise = Math.max(s.popupRise, look.popupRise);
        if (state.phase === 'dying' && look.hero) {
          if (!s.dyingFrames.includes(look.hero.frame)) s.dyingFrames.push(look.hero.frame);
          if (look.hero.filled) s.filled = true;
        }
        if (state.phase === 'ready' && state.tick > 0 && look.hero) {
          s.readyFrames += 1;
          if (look.hero.dim) s.readyHidden += 1; // dimmed: the blink no longer hides him
        }
      };
      await new Promise<void>((resolve) => {
        const tick = (): void => {
          sample();
          if (done) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await replay;
      return s;
    },
    { runs, ticksPerFrame, untilSessionEnd },
  );
}

/** The title's prompt (`TAP TO START` or `PRESS SPACE TO START`), sampled on every animation frame for `ms`: frames on which it was not drawn. */
async function samplePrompt(page: Page, ms: number): Promise<{ text: string; frames: number; hidden: number }> {
  return page.evaluate(
    async (ms) =>
      new Promise<{ text: string; frames: number; hidden: number }>((resolve) => {
        const s = { text: '', frames: 0, hidden: 0 };
        const until = performance.now() + ms;
        const tick = (): void => {
          const prompt = window.__E2E__?.menuText().find((t) => t.text.includes('START'));
          if (prompt) {
            s.text = prompt.text;
            s.frames += 1;
            if (!prompt.shown) s.hidden += 1;
          }
          if (performance.now() < until) requestAnimationFrame(tick);
          else resolve(s);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

const debugRuns = (): InputScript['runs'] =>
  (JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', 'debug.json'), 'utf8')) as InputScript).runs;
/** The debug room walked into its first spikes, then nothing pressed: a death, the respawn and the ready gate. */
const DIE_ONCE: InputScript['runs'] = [
  [0, 15],
  [2, 100],
  [0, 160],
];

async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  await page.goto('./?e2e=1');
  await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true);
  return problems;
}

test.describe('a phone that asks for reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the debug room played through: no shake (the scroll is the camera\'s own), no screen flash, no particles, pop-ups that do not rise', async ({ page }) => {
    const problems = await open(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const s = await sampleReplay(page, debugRuns(), 2, false);
    expect(s.frames, 'frames sampled').toBeGreaterThan(100);
    expect({ shake: s.shake, flash: s.flash, particles: s.particles }).toEqual({ shake: 0, flash: 0, particles: 0 });
    // The score pop-ups still show, where they appeared: they do not rise.
    expect(s.popupFrames, 'frames with a score pop-up').toBeGreaterThan(10);
    expect(s.popupRise, 'how far a pop-up rose').toBe(0);
    expect(problems).toEqual([]);
  });

  test('the title prompt does not blink', async ({ page }) => {
    const problems = await open(page);
    const prompt = await samplePrompt(page, 1500);
    expect(prompt.text).toContain('START');
    expect(prompt.frames, 'frames sampled').toBeGreaterThan(40);
    expect(prompt.hidden, 'frames with the prompt hidden').toBe(0);
    expect(problems).toEqual([]);
  });

  test('a death still reads: the hero filled, then breaking apart, then the fade; no shake, no debris; he does not blink after', async ({ page }) => {
    const problems = await open(page);
    const s = await sampleReplay(page, DIE_ONCE, 1, true);
    expect(s.filled, 'the hero filled at the moment of death').toBe(true);
    expect(s.dyingFrames.filter((f) => f.startsWith('hero_die_')).length, `break-apart frames seen: ${s.dyingFrames.join(', ')}`).toBeGreaterThanOrEqual(3);
    expect(s.fade, 'the screen fades out').toBeGreaterThan(0.5);
    expect({ shake: s.shake, particles: s.particles }).toEqual({ shake: 0, particles: 0 });
    expect(s.readyFrames, 'frames of the ready gate after the respawn').toBeGreaterThan(30);
    expect(s.readyHidden, 'ready-gate frames with the hero dimmed by the blink').toBe(0);
    expect(problems).toEqual([]);
  });

  test("the rotate message's phone stands still, sideways", async ({ page, browser }) => {
    await page.close();
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const tab = await phone.newPage();
    await tab.goto('./?e2e=1&touch=1');
    await expect(tab.locator('#rotate .rotate__phone')).toBeVisible();
    for (let i = 0; i < 6; i++) {
      const shown = await tab.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#rotate .rotate__phone canvas')].map((c) => `${c.className}:${getComputedStyle(c).opacity}:${c.getAnimations().length}`),
      );
      expect(shown).toEqual(['rotate__upright:0:0', 'rotate__sideways:1:0']);
      await tab.waitForTimeout(250);
    }
    await phone.close();
  });
});

test.describe('the same runs without the setting', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('shake, the cog\'s flash and particles are all there, and the ready-gate hero blinks: the measurements can see them', async ({ page }) => {
    const problems = await open(page);
    const room = await sampleReplay(page, debugRuns(), 2, false);
    expect(room.shake, 'the shake moves the scroll off the camera').toBeGreaterThan(0);
    expect(room.flash, "the cog's screen flash").toBeGreaterThan(0);
    expect(room.particles, 'particles alive').toBeGreaterThan(0);
    expect(room.popupRise, 'the score pop-ups rise').toBeGreaterThan(4);
    const death = await sampleReplay(page, DIE_ONCE, 1, true);
    expect(death.particles, "the hero's debris").toBeGreaterThan(0);
    expect(death.readyHidden, 'the ready-gate blink').toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('the title prompt blinks', async ({ page }) => {
    const problems = await open(page);
    const prompt = await samplePrompt(page, 1500);
    expect(prompt.text).toContain('START');
    expect(prompt.hidden, 'frames with the prompt hidden').toBeGreaterThan(5);
    expect(prompt.frames - prompt.hidden, 'frames with the prompt shown').toBeGreaterThan(5);
    expect(problems).toEqual([]);
  });
});
