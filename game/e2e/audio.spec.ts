import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { LOOP_HOLD, SILENCE, compare, pitchEnds } from '../src/audio/offline.ts';
import type { EffectRender } from '../src/audio/offline.ts';
import { EFFECT_NAMES, GEM_LADDER, GEM_RECIPES, RECIPES, THRUST_LOOP, effectLength } from '../src/audio/recipes.ts';
import type { EffectName, Recipe } from '../src/audio/recipes.ts';

/**
 * Every sound of the game, rendered in a real browser and checked by numbers
 * (Node has no Web Audio): not silent, not clipping, as long and as loud as
 * its recipe says, and sounding the way docs/ART-AND-SOUND.md section 12
 * describes it (rising for pickups, falling for the death, every step of the
 * crystal ladder on its own note, and so on). And, in the real game, the
 * audio starting on the first tap and the M key.
 *
 * THE HOOK THIS TEST NEEDS. `window.__E2E__.renderEffect`, installed by the
 * shell's test hook (src/shell/e2eHook.ts) when the page is opened with
 * `?e2e=1`: `renderEffect` from src/audio/offline.ts, handed through
 * unchanged (it is loaded as its own chunk on first use, so the game's
 * bundle does not carry it).
 *
 * It takes one name or a list of names (rendered together, all starting at
 * the same moment) and resolves to an `EffectRender`: plain numbers. A name is
 * an effect of RECIPES or a step of the crystal ladder, `gem:0` to `gem:5`
 * (GEM_RECIPES; RECIPES holds only the first step). It renders through an
 * OfflineAudioContext with the game's own `scheduleEffect` and master chain,
 * so it needs no tap, makes no sound and does not touch the game's
 * AudioContext or its state.
 */

interface HookWindow {
  __E2E__?: {
    renderEffect?: (what: string | readonly string[]) => Promise<EffectRender>;
    sound?: () => { state: string; muted: boolean; plays: number };
    scenes?: () => string[];
    state?: () => { mode: string } | null;
  };
}

async function openGame(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?e2e=1');
  const installed = await page
    .waitForFunction(() => typeof (window as unknown as HookWindow).__E2E__?.renderEffect === 'function', undefined, {
      timeout: 15_000,
    })
    .then(
      () => true,
      () => false,
    );
  expect(
    installed,
    'window.__E2E__.renderEffect is not installed: with ?e2e=1 the test hook must expose renderEffect from src/audio/offline.ts',
  ).toBe(true);
  return problems;
}

function render(page: Page, what: string | readonly string[]): Promise<EffectRender> {
  return page.evaluate(async (names) => {
    const hook = (window as unknown as HookWindow).__E2E__;
    if (!hook?.renderEffect) throw new Error('window.__E2E__.renderEffect is missing');
    return hook.renderEffect(names);
  }, what);
}

async function renderAll(page: Page): Promise<Record<EffectName, EffectRender>> {
  const all = {} as Record<EffectName, EffectRender>;
  for (const name of EFFECT_NAMES) all[name] = await render(page, name);
  return all;
}

const ms = (seconds: number): string => `${(seconds * 1000).toFixed(1)} ms`;
const hz = (value: number): string => `${value.toFixed(0)} Hz`;

/**
 * Every recipe the game can play: each effect of RECIPES by its name, and each
 * step of the crystal ladder (GEM_RECIPES) as renderEffect knows it, `gem:0`
 * (D5) to `gem:5` (D6).
 */
const EVERY_RECIPE: readonly { readonly name: string; readonly recipe: Recipe }[] = [
  ...EFFECT_NAMES.map((name) => ({ name, recipe: RECIPES[name] })),
  ...GEM_RECIPES.map((recipe, step) => ({ name: `gem:${step}`, recipe })),
];

test('every recipe renders, the crystal ladder too: not silent, not clipping, as loud and as long as it says', async ({ page }) => {
  const problems = await openGame(page);

  for (const { name, recipe } of EVERY_RECIPE) {
    const sound = await render(page, name);
    expect.soft(sound.name, 'the render names what it rendered').toBe(name);

    // Not silent, before and after the master chain.
    expect.soft(sound.dryPeak, `${name}: peak before the master gain`).toBeGreaterThan(0.02);
    expect.soft(sound.dryRms, `${name}: loudness before the master gain`).toBeGreaterThan(0.004);
    expect.soft(sound.peak, `${name}: peak at the output`).toBeGreaterThan(0.02);
    expect.soft(sound.rms, `${name}: loudness at the output`).toBeGreaterThan(0.004);

    // No clipping: 1.0 is full scale. One effect alone stays far below it.
    expect.soft(sound.peak, `${name}: peak at the output`).toBeLessThan(1);
    expect.soft(sound.peak, `${name}: peak at the output`).toBeLessThanOrEqual(0.5);

    // "Gains are peak values": the rendered peak is the guide's gain or a little under it, never above.
    expect.soft(sound.dryPeak, `${name}: peak against the recipe's gain of ${recipe.gain}`).toBeLessThanOrEqual(recipe.gain * 1.02);
    expect.soft(sound.dryPeak, `${name}: peak against the recipe's gain of ${recipe.gain}`).toBeGreaterThanOrEqual(recipe.gain * 0.5);

    // As long as the recipe says, and silent afterwards. The last of a fade is
    // quieter than SILENCE, so a sound is heard a little shorter than its
    // recipe: measured, 0.3 ms (uiMove) to 14.7 ms (enemyDown, whose noise
    // closes down to 200 Hz as it fades). 20 ms is the most any recipe may
    // lose, however long it is: one that goes quiet earlier has lost part of
    // what its recipe plays.
    const wanted = recipe.kind === 'shot' ? effectLength(recipe) : LOOP_HOLD + recipe.fadeOut;
    expect.soft(sound.recipeLength, `${name}: the length the render was told`).toBeCloseTo(wanted, 9);
    expect.soft(sound.length, `${name}: heard for ${ms(sound.length)}, recipe ${ms(wanted)}`).toBeLessThanOrEqual(wanted + 0.012);
    expect.soft(sound.length, `${name}: heard for ${ms(sound.length)}, recipe ${ms(wanted)}`).toBeGreaterThanOrEqual(wanted - 0.02);
    expect.soft(sound.tailPeak, `${name}: sound after its end`).toBeLessThan(SILENCE);
  }

  expect(problems).toEqual([]);
});

test('the loudest moments the game can produce stay below full scale', async ({ page }) => {
  const problems = await openGame(page);

  // Each list starts together, which is the worst case: the attacks coincide.
  const mixes: readonly (readonly EffectName[])[] = [
    ['cog', 'thrust', 'land'], // the cog taken while flying, landing in the same moment
    ['death', 'enemyDown', 'thrust'], // shot an enemy and flew into the next one
    ['win', 'cog', 'thrust'],
    ['gem', 'jump', 'bolt', 'boltHit', 'land', 'thrust'], // six voices of busy play
    ['death', 'enemyDown', 'cog'], // six voices of the three loudest recipes
  ];
  for (const mix of mixes) {
    const sound = await render(page, mix);
    const label = mix.join(' + ');
    expect.soft(sound.name, label).toBe(mix.join('+'));
    expect.soft(sound.peak, `${label}: peak at the output`).toBeLessThan(1);
    expect.soft(sound.peak, `${label}: peak at the output`).toBeLessThanOrEqual(0.8);
    expect.soft(sound.peak, `${label}: peak at the output`).toBeGreaterThan(0.05);
    // A mix is louder than its loudest part alone, so it really was mixed.
    const loudestGain = Math.max(...mix.map((name) => RECIPES[name].gain));
    expect.soft(sound.dryPeak, `${label}: peak before the master gain`).toBeGreaterThan(loudestGain * 0.8);
  }

  expect(problems).toEqual([]);
});

test('effects that must be told apart differ measurably', async ({ page }) => {
  const problems = await openGame(page);
  const heard = await renderAll(page);

  // A crystal, an item, the cog, a death, the airlock and a destroyed enemy: the sounds that tell the player what just happened.
  const distinct: readonly EffectName[] = ['gem', 'item', 'cog', 'death', 'airlock', 'enemyDown'];
  for (const a of distinct) {
    for (const b of distinct) {
      if (a >= b) continue;
      const difference = compare(heard[a], heard[b]);
      expect
        .soft(difference.total, `${a} against ${b}: ${JSON.stringify(difference)}`)
        .toBeGreaterThanOrEqual(0.3);
    }
  }

  // And no two of the nineteen are the same sound.
  for (const a of EFFECT_NAMES) {
    for (const b of EFFECT_NAMES) {
      if (a >= b) continue;
      const difference = compare(heard[a], heard[b]);
      expect
        .soft(difference.total, `${a} against ${b}: ${JSON.stringify(difference)}`)
        .toBeGreaterThanOrEqual(0.15);
    }
  }

  expect(problems).toEqual([]);
});

test('each effect sounds the way the guide describes it', async ({ page }) => {
  const problems = await openGame(page);
  const heard = await renderAll(page);

  const pitch = (name: EffectName): { first: number; last: number } => pitchEnds(heard[name].pitch);
  const rises = (name: EffectName, by: number): void => {
    const { first, last } = pitch(name);
    expect.soft(first, `${name} has a pitch`).toBeGreaterThan(0);
    expect.soft(last, `${name} rises: ${hz(first)} to ${hz(last)}`).toBeGreaterThan(first * by);
  };
  const falls = (name: EffectName, ends: { first: number; last: number }, by: number): void => {
    expect.soft(ends.last, `${name} has a pitch`).toBeGreaterThan(0);
    expect.soft(ends.first, `${name} falls: ${hz(ends.first)} to ${hz(ends.last)}`).toBeGreaterThan(ends.last * by);
  };
  const near = (value: number, wanted: number, what: string, tolerance = 0.03): void => {
    expect.soft(Math.abs(value - wanted), `${what}: ${hz(value)}, wanted ${hz(wanted)}`).toBeLessThanOrEqual(wanted * tolerance);
  };

  // Good news rises.
  rises('jump', 1.4);
  rises('item', 2.5);
  rises('cog', 1.9);
  rises('clear', 1.4);
  rises('win', 1.9);
  rises('uiOk', 1.15);
  rises('start', 1.9);

  // Bad news, and things that end, fall.
  falls('bolt', pitch('bolt'), 1.8);
  falls('fuelEmpty', pitch('fuelEmpty'), 2.5);
  falls('gameOver', pitch('gameOver'), 1.9);
  falls('death', pitchEnds(heard.death.dominant), 3); // a sweep under rubble: read the strongest line, not the zero crossings
  falls('enemyDown', pitchEnds(heard.enemyDown.centroid), 1.5); // a crunch that closes down: its brightness falls

  // The notes the guide names.
  near(pitch('jump').first, 229, 'jump 20 ms in (196 Hz rising an octave in 90 ms)', 0.08);
  near(pitch('jump').last, 363, 'jump 80 ms in', 0.08);
  near(pitch('gem').first, 587, 'gem is D5');
  near(pitch('gem').last, 587, 'gem stays on D5');
  near(pitch('item').last, 880, 'item ends on A5');
  near(pitch('cog').first, 587, 'cog starts on D5');
  near(pitch('cog').last, 1175, 'cog ends on D6');
  near(pitch('clear').first, 587, 'clear starts on D5');
  near(pitch('fuelLow').first, 880, 'fuelLow is A5');
  near(pitch('uiMove').first, 660, 'uiMove is 660 Hz');
  near(pitch('gameOver').first, 294, 'gameOver starts on D4');
  near(pitch('gameOver').last, 147, 'gameOver ends on D3');
  near(pitch('win').first, 294, 'win starts on D4');
  near(pitch('start').first, 294, 'start starts on D4');
  near(pitch('start').last, 587, 'start ends on D5');

  // The airlock: a rumble falling from 110 Hz under a hiss that dies away.
  const airlock = heard.airlock;
  const rumbleStart = airlock.dominant[2] ?? 0;
  const rumbleEnd = airlock.dominant[20] ?? 0;
  expect.soft(rumbleStart, `airlock rumble starts near 110 Hz: ${hz(rumbleStart)}`).toBeLessThan(125);
  expect.soft(rumbleStart, `airlock rumble falls: ${hz(rumbleStart)} to ${hz(rumbleEnd)}`).toBeGreaterThan(rumbleEnd * 1.2);
  expect.soft(rumbleEnd, `airlock rumble ends near 73 Hz: ${hz(rumbleEnd)}`).toBeGreaterThan(60);
  expect.soft(airlock.level[5] ?? 0, 'airlock hiss dies away').toBeGreaterThan((airlock.level[30] ?? 0) * 1.5);
  expect.soft(airlock.level[30] ?? 0, 'airlock hiss dies away').toBeGreaterThan((airlock.level[42] ?? 0) * 1.5);
  expect.soft((airlock.bands[6] ?? 0) + (airlock.bands[7] ?? 0), 'airlock hiss is high: energy above 2.8 kHz').toBeGreaterThan(0.4);

  // One clean tone has regular zero crossings; noise has not.
  const tones: readonly EffectName[] = ['jump', 'gem', 'item', 'cog', 'bolt', 'fuelLow', 'fuelEmpty', 'gameOver', 'uiMove', 'uiOk'];
  const noises: readonly EffectName[] = ['land', 'airlock', 'boltHit', 'thrust'];
  for (const name of tones) expect.soft(heard[name].noisiness, `${name} is a tone`).toBeLessThan(0.15);
  for (const name of noises) expect.soft(heard[name].noisiness, `${name} is noise`).toBeGreaterThan(0.3);

  // The thud is low, the tick is high.
  const low = (name: EffectName): number => heard[name].bands.slice(0, 4).reduce((sum, share) => sum + share, 0);
  expect.soft(low('land'), 'land: energy below 707 Hz').toBeGreaterThan(0.8);
  expect.soft(low('boltHit'), 'boltHit: energy below 707 Hz').toBeLessThan(0.05);

  // The thrust loop: a 55 Hz hum under a roar, steady while held, fading in and out.
  const thrust = heard.thrust;
  const frames = thrust.level.length;
  const middle = thrust.level[Math.floor(frames / 2)] ?? 0;
  near(thrust.dominant[Math.floor(frames / 2)] ?? 0, 55, 'thrust hum', 0.08);
  expect.soft(thrust.recipeLength, 'thrust was held, then faded').toBeCloseTo(LOOP_HOLD + THRUST_LOOP.fadeOut, 9);
  for (const share of [0.2, 0.35, 0.65, 0.8]) {
    const level = thrust.level[Math.floor(frames * share)] ?? 0;
    expect.soft(level, `thrust is steady at ${share * 100} % of its hold`).toBeGreaterThan(middle * 0.6);
    expect.soft(level, `thrust is steady at ${share * 100} % of its hold`).toBeLessThan(middle * 1.6);
  }
  expect.soft(thrust.level[0] ?? 0, 'thrust fades in').toBeLessThan(middle * 0.6);
  expect.soft(thrust.level[frames - 1] ?? 0, 'thrust fades out').toBeLessThan(middle * 0.3);

  expect(problems).toEqual([]);
});

test('every step of the crystal ladder plays its own note, for all of its length', async ({ page }) => {
  const problems = await openGame(page);

  // A note is one square tone that fades out over its last 85 ms, so it is
  // heard to within a millisecond of its recipe: measured, 89.2 ms of 90 on
  // all six. 5 ms catches a note that goes quiet early, which the 20 ms every
  // recipe is allowed in the first test would let through.
  const NOTE_SHORT_BY = 0.005;

  // The pitch is read two ways that share no method: the zero crossings of the
  // waveform (40 ms windows) and the strongest line of its spectrum (2048
  // samples, 46 ms). Each is read at both ends of the note: the median of its
  // first four and of its last four frames (pitchEnds; a 90 ms note has nine
  // frames, 10 ms apart). Measured on the six notes: every reading within
  // 0.1 % of its note. The tolerance, 1 %, is a sixth of a semitone: a note
  // one semitone off is 6 % off and fails.
  for (const [step, wanted] of GEM_LADDER.entries()) {
    const name = `gem:${step}`;
    const recipe = GEM_RECIPES[step];
    if (!recipe) throw new Error(`the crystal ladder has a note for step ${step} but no recipe`);
    const sound = await render(page, name);
    const length = effectLength(recipe);
    expect
      .soft(sound.length, `${name}: heard for ${ms(sound.length)}, recipe ${ms(length)}`)
      .toBeGreaterThanOrEqual(length - NOTE_SHORT_BY);
    const crossings = pitchEnds(sound.pitch);
    const strongest = pitchEnds(sound.dominant);
    const readings: readonly (readonly [string, number])[] = [
      ['zero crossings, start', crossings.first],
      ['zero crossings, end', crossings.last],
      ['strongest line, start', strongest.first],
      ['strongest line, end', strongest.last],
    ];
    for (const [how, value] of readings) {
      expect
        .soft(Math.abs(value - wanted), `${name} by ${how}: ${value.toFixed(1)} Hz, wanted ${hz(wanted)}`)
        .toBeLessThanOrEqual(wanted * 0.01);
    }
    expect.soft(sound.noisiness, `${name} is one clean tone`).toBeLessThan(0.15);
  }

  expect(problems).toEqual([]);
});

test('renderEffect refuses a name that is not an effect', async ({ page }) => {
  await openGame(page);
  await expect(render(page, 'kazoo')).rejects.toThrow(/no effect called "kazoo"/);
  // The ladder has six steps, gem:0 to gem:5.
  await expect(render(page, 'gem:6')).rejects.toThrow(/no effect called "gem:6"/);
});

const sound = (page: Page): Promise<{ state: string; muted: boolean; plays: number } | null> =>
  page.evaluate(() => (window as unknown as HookWindow).__E2E__?.sound?.() ?? null);

test('the first tap on the title starts the audio and the game; M mutes, and the choice is kept', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  await page.goto('./?e2e=1');
  // No page.evaluate or waitForFunction before the tap: both count as a user gesture (PHASER4-NOTES 20).
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await page.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height / 2));

  await expect.poll(async () => (await sound(page))?.state).toBe('running');
  await expect.poll(() => page.evaluate(() => (window as unknown as HookWindow).__E2E__?.scenes?.() ?? [])).toContain('Play');
  // The title's start jingle was asked for inside the tap that started the context, and played.
  await expect.poll(async () => (await sound(page))?.plays ?? 0).toBeGreaterThan(0);
  expect((await sound(page))?.muted).toBe(false);

  await page.keyboard.press('m');
  await expect.poll(async () => (await sound(page))?.muted).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as HookWindow).__E2E__?.sound !== undefined);
  expect((await sound(page))?.muted).toBe(true);
  expect(problems).toEqual([]);
});
