import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileTuning } from '../src/core/compileTuning';
import { cloneGame, createSession, step } from '../src/core/game';
import { parseLevel, withoutItem } from '../src/core/level';
import { inputFromBits } from '../src/core/script';
import type { Cell, DeathCause, GameEvent, GameState, InputScript, LevelData, LevelProof, Phys, ValidateOptions } from '../src/core/types';
import { InputBit, SUB, Tile, TILE, TILE_PX } from '../src/core/types';
import { handicap } from '../src/core/validate/handicap';
import { replayScript, validateLevel } from '../src/core/validate/index';
import { COMFORT_OPTIONS, DEFAULT_OPTIONS, LEVELS_STEP_BUDGET, REQUIRES_OPTIONS } from '../src/core/validate/options';
import { TUNING } from '../src/tuning';

/**
 * Every file in levels/, on the owner's live TUNING (docs/ARCHITECTURE.md,
 * section 9.6):
 *
 *   (a) normal proof   every file: parseLevel succeeds, validateLevel with
 *                      DEFAULT_OPTIONS is 'proven', and the script replays to
 *                      a win on the same trophyTick and winTick
 *   (b) comfort proof  level-01 to level-10: the same on the handicapped
 *                      tuning with COMFORT_OPTIONS
 *   (c) @requires      each "@requires X": the level without X is anything
 *                      but 'proven' (REQUIRES_OPTIONS: when no pack is left
 *                      the pipeline itself goes on from the quick pass to the
 *                      map, so a failure is the verdict of both searches and
 *                      names its reason). 'budget-exceeded' passes but decides
 *                      nothing, so it is listed at the end
 *   (d) the campaign   level-01 to level-10 are all there, in order; and the
 *                      ten normal proofs of suite (a), played one after another
 *                      in one session from level 1, as the game plays them
 *                      (each airlock leads into the next level), win the game
 *                      with no death, every level on its own proof's ticks
 *
 * The file prints one line per proof (verdict, deciding stage, step calls,
 * nodes, wall time) and asserts the sum of step calls against
 * LEVELS_STEP_BUDGET: calls, not seconds, because CI machines are slower
 * than the build machine and the core has no clock. Wall time is printed,
 * never asserted. Every proof has an explicit timeout of 120 s. Suite (d)
 * calls step() about ten thousand times and runs no search, so it is not
 * counted.
 *
 * The reviewer's command for the crystal check of docs/LEVELS.md:
 *
 *   LEVELS_CRYSTALS=1 npx vitest run tests/levels.test.ts
 *
 * runs every level once more, map first with a budget of 400 M step calls,
 * and prints the crystals no state of the map collected. Those runs are
 * expensive on thruster levels, are not part of npm run check, and do not
 * count against the budget.
 *
 * Style rules of this game's own levels that parseLevel does NOT check
 * (unit-test fixtures may break them) are checked here as well: names and
 * hints the pixel font can show, the picture frame, and the headers
 * level-01 to level-10 must carry.
 */

const LEVELS_DIR = new URL('../levels/', import.meta.url);
const CAMPAIGN_ID = /^level-(?:0[1-9]|10)$/;
const DEV_IDS = ['test', 'debug'];
/** The characters of the pixel font (docs/ART-AND-SOUND.md); the game shows names and hints in capitals. */
const FONT_TEXT = /^[A-Z0-9 .,!?:\-+/'%]+$/;
const MAX_TEXT_LENGTH = 42;
const PROOF_TIMEOUT_MS = 120_000;
const CRYSTALS_MODE = process.env.LEVELS_CRYSTALS === '1';
const CRYSTALS_MAX_STEP_CALLS = 400_000_000;
/** A map-first run with 400 M calls can take minutes on a thruster level. */
const CRYSTALS_TIMEOUT_MS = 900_000;

const PHYS = compileTuning(TUNING);
const COMFORT_PHYS = compileTuning(handicap(TUNING));

interface LevelFile {
  readonly id: string;
  readonly text: string;
  readonly level: LevelData | null;
  readonly parseError: string | null;
}

function readLevelFile(fileName: string): LevelFile {
  const id = fileName.replace(/\.txt$/, '');
  const text = readFileSync(new URL(fileName, LEVELS_DIR), 'utf8');
  try {
    return { id, text, level: parseLevel(text, id), parseError: null };
  } catch (error) {
    return { id, text, level: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

const files = readdirSync(LEVELS_DIR)
  .filter((name) => name.endsWith('.txt'))
  .sort()
  .map(readLevelFile);
const isCampaign = (file: LevelFile): boolean => CAMPAIGN_ID.test(file.id);
const campaign = files.filter(isCampaign);

/** The level of a file that parsed; a test of a file that did not parse fails with the parser's message. */
function levelOf(file: LevelFile): LevelData {
  if (file.level === null) throw new Error(`levels/${file.id}.txt does not parse: ${file.parseError ?? ''}`);
  return file.level;
}

/** The text after a header keyword, when the file has that header. The parser has already refused duplicates. */
function headerText(file: LevelFile, keyword: string): string | null {
  const match = new RegExp(`^${keyword}[ \\t]+(.*)$`, 'm').exec(file.text);
  return match === null ? null : (match[1] ?? '').trim();
}

const cellText = (cell: Cell | null): string => (cell === null ? 'none' : `col ${cell.col}, row ${cell.row}`);
const millions = (calls: number): string => `${(calls / 1_000_000).toFixed(2)} M`;

// ---------------------------------------------------------------------------
// The step budget: every proof run by suites (a) to (c) adds its calls here.
// ---------------------------------------------------------------------------

let budgetCalls = 0;
let budgetMs = 0;
const requiresRuns: { readonly label: string; readonly verdict: string }[] = [];

/** validateLevel, timed and counted, with its line printed. */
function proveAndPrint(label: string, level: LevelData, phys: Phys, options: Partial<ValidateOptions>, counted = true): LevelProof {
  const started = performance.now();
  const proof = validateLevel(level, phys, options);
  const ms = performance.now() - started;
  if (counted) {
    budgetCalls += proof.stats.stepCalls;
    budgetMs += ms;
  }
  const where = proof.verdict === 'proven' ? `cog ${proof.trophyTick}, win ${proof.winTick}` : `closest ${cellText(proof.stuckAt)}`;
  console.log(
    `levels/${level.id}.txt  ${label.padEnd(18)} ${proof.verdict.padEnd(19)} ${proof.stage.padEnd(10)} ` +
      `${millions(proof.stats.stepCalls).padStart(9)} step calls  ${String(proof.stats.searchNodes).padStart(7)} search nodes  ` +
      `${String(proof.stats.groundNodes + proof.stats.flightNodes).padStart(7)} map nodes  ${where}  ${Math.round(ms)} ms`,
  );
  return proof;
}

/**
 * A proof must be 'proven' and its script must replay to a win on the same ticks. On a failure the
 * message names the file, the verdict, the stage and the closest approach. A level without packs
 * needs no second run to name the reason: its pipeline goes on to the map whenever the quick pass
 * fails (docs/ARCHITECTURE.md, section 9.4).
 */
function expectProven(label: string, level: LevelData, phys: Phys, options: ValidateOptions): LevelProof {
  const proof = proveAndPrint(label, level, phys, options);
  expect(
    proof.verdict,
    `levels/${level.id}.txt, ${label}: ${proof.verdict} at the ${proof.stage} stage, closest ${cellText(proof.stuckAt)}`,
  ).toBe('proven');
  if (proof.script === null) throw new Error('a proven proof carries a script');
  const replay = replayScript(level, phys, proof.script);
  expect(replay, `levels/${level.id}.txt, ${label}: the replay of the proof's script`).toMatchObject({
    won: true,
    died: null,
    trophyTick: proof.trophyTick,
    winTick: proof.winTick,
  });
  return proof;
}

/** The normal proof of each campaign level, by id, kept by suite (a) for suite (d). */
const campaignProofs = new Map<string, LevelProof>();

// ---------------------------------------------------------------------------
// The files and their style
// ---------------------------------------------------------------------------

it('finds the two development levels, and no file but those and level-01 to level-10', () => {
  expect(files.map((file) => file.id)).toEqual(expect.arrayContaining(DEV_IDS));
  expect(files.filter((file) => !isCampaign(file) && !DEV_IDS.includes(file.id)).map((file) => file.id)).toEqual([]);
});

for (const file of files) {
  describe(`levels/${file.id}.txt`, () => {
    it('parses', () => {
      expect(file.parseError).toBeNull();
    });

    // A style rule of this game's levels, not a parser rule.
    it('is closed by walls on the left, the right and the top', () => {
      const level = levelOf(file);
      const solid = (col: number, row: number): boolean => level.tiles[row * level.width + col] === Tile.Solid;
      const open: string[] = [];
      for (let col = 0; col < level.width; col++) if (!solid(col, 0)) open.push(`col ${col}, row 0`);
      for (let row = 0; row < level.height; row++) {
        if (!solid(0, row)) open.push(`col 0, row ${row}`);
        if (!solid(level.width - 1, row)) open.push(`col ${level.width - 1}, row ${row}`);
      }
      expect(open, 'cells of the frame that are not #').toEqual([]);
    });

    it(`${isCampaign(file) ? 'carries @name, @teaches and @hardest, with' : 'has'} a name and a hint the pixel font can show`, () => {
      const level = levelOf(file);
      for (const keyword of ['@name', '@teaches']) {
        const text = headerText(file, keyword);
        if (isCampaign(file)) expect(text, `${keyword} is required in level-01 to level-10`).not.toBeNull();
        if (text === null) continue;
        expect(text.toUpperCase(), keyword).toMatch(FONT_TEXT);
        expect(text.length, `${keyword} length`).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
      }
      if (isCampaign(file)) expect(level.hardest, '@hardest is required in level-01 to level-10').not.toBeNull();
    });
  });
}

describe('the development levels', () => {
  const byId = (id: string): LevelData => {
    const file = files.find((candidate) => candidate.id === id);
    if (file === undefined) throw new Error(`levels/${id}.txt is missing`);
    return levelOf(file);
  };

  it('test.txt (movement room) has nothing that can kill: no hazard, no enemy, a solid bottom row', () => {
    const level = byId('test');
    const hazards = Array.from(level.tiles).filter((tile) => tile === Tile.Fire || tile === Tile.Coolant || tile === Tile.Spikes);
    expect(hazards).toEqual([]);
    expect(level.enemies).toEqual([]);
    const bottom = Array.from(level.tiles.slice((level.height - 1) * level.width));
    expect(bottom.every((tile) => tile === Tile.Solid)).toBe(true);
  });

  it('debug.txt holds every tile, item and enemy kind, and asks for both items', () => {
    const level = byId('debug');
    const tiles = new Set(level.tiles);
    for (const tile of Object.values(Tile)) expect(tiles.has(tile), `tile ${tile}`).toBe(true);
    const pickups = new Set(level.pickups.map((pickup) => pickup.kind));
    expect([...pickups].sort()).toEqual(['blaster', 'crystal', 'thruster']);
    const enemies = new Set(level.enemies.map((enemy) => (enemy.kind === 'moth' ? `moth-${enemy.axis}` : enemy.kind)));
    expect([...enemies].sort()).toEqual(['cinderpeg', 'moth-h', 'moth-v']);
    expect(level.requires).toEqual(['blaster', 'thruster']);
  });
});

// ---------------------------------------------------------------------------
// The three suites of section 9.6
// ---------------------------------------------------------------------------

describe('(a) normal proof, every file in levels/', () => {
  for (const file of files) {
    it(
      `levels/${file.id}.txt is proven on the live tuning, and its script replays to the same win`,
      () => {
        const proof = expectProven('normal', levelOf(file), PHYS, DEFAULT_OPTIONS);
        if (isCampaign(file)) campaignProofs.set(file.id, proof);
      },
      PROOF_TIMEOUT_MS,
    );
  }
});

describe('(b) comfort proof, level-01 to level-10', () => {
  if (campaign.length === 0) it.todo('no campaign level exists yet');
  for (const file of campaign) {
    it(
      `levels/${file.id}.txt is proven on the handicapped tuning, and its script replays to the same win`,
      () => {
        expectProven('comfort', levelOf(file), COMFORT_PHYS, COMFORT_OPTIONS);
      },
      PROOF_TIMEOUT_MS,
    );
  }
});

describe('(c) every @requires line holds', () => {
  const lines = files.flatMap((file) => (file.level === null ? [] : file.level.requires.map((item) => ({ file, item }))));
  if (lines.length === 0) it.todo('no level carries a @requires line');
  for (const { file, item } of lines) {
    it(
      `levels/${file.id}.txt cannot be won without the ${item}`,
      () => {
        const without = withoutItem(levelOf(file), item);
        // Not map first: when no pack is left the pipeline runs the quick pass and then the map anyway, and
        // only a level that neither search can win fails (each merges states its own way).
        const proof = proveAndPrint(`without ${item}`, without, PHYS, REQUIRES_OPTIONS);
        requiresRuns.push({ label: `levels/${file.id}.txt without ${item}`, verdict: proof.verdict });
        expect(proof.verdict, `levels/${file.id}.txt says @requires ${item}, but it can be won without it`).not.toBe('proven');
      },
      PROOF_TIMEOUT_MS,
    );
  }
});

// ---------------------------------------------------------------------------
// (d) The campaign as one game
// ---------------------------------------------------------------------------

const CAMPAIGN_IDS = Array.from({ length: 10 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`);
const NOTHING_HELD = inputFromBits(0);

interface Played {
  readonly trophyTick: number;
  readonly winTick: number;
  readonly died: DeathCause | null;
}

/**
 * One level's script, from the first tick after its level started, on a session that may hold the whole
 * campaign. Stops at the first death or at the win, as replayScript does (the exiting phase only waits).
 */
function playLevel(game: GameState, script: InputScript): Played {
  const events: GameEvent[] = [];
  let trophyTick = -1;
  let winTick = -1;
  for (const [bits, count] of script.runs) {
    for (let i = 0; i < count; i++) {
      events.length = 0;
      step(game, inputFromBits(bits), events);
      for (const event of events) {
        if (event.type === 'trophyCollected') trophyTick = game.run.tick;
        else if (event.type === 'levelCompleted') winTick = game.run.tick;
        else if (event.type === 'playerDied') return { trophyTick, winTick, died: event.cause };
      }
      if (winTick >= 0) return { trophyTick, winTick, died: null };
    }
  }
  return { trophyTick, winTick, died: null };
}

/** Steps with nothing held through the exiting phase, until the next level has started or the game is won. */
function walkThroughAirlock(game: GameState, last: boolean): GameEvent {
  const events: GameEvent[] = [];
  // exitTicks is the phase's length; the margin only guards against a loop that never ends.
  for (let waited = 0; waited <= game.phys.exitTicks + 2; waited++) {
    events.length = 0;
    step(game, NOTHING_HELD, events);
    const found = events.find((event) => event.type === (last ? 'gameWon' : 'levelStarted'));
    if (found !== undefined) return found;
  }
  throw new Error(`after level ${game.session.levelIndex + 1} the airlock led to no ${last ? 'win' : 'next level'}`);
}

describe('(d) the campaign, played as one game', () => {
  it('holds level-01 to level-10, all ten, in order', () => {
    expect(campaign.map((file) => file.id)).toEqual(CAMPAIGN_IDS);
    const totals = { crystals: 0, blasters: 0, packs: 0, cinderpegs: 0, moths: 0 };
    for (const file of campaign) {
      const level = levelOf(file);
      const pickups = (kind: string): number => level.pickups.filter((pickup) => pickup.kind === kind).length;
      const counts = {
        crystals: pickups('crystal'),
        blasters: pickups('blaster'),
        packs: pickups('thruster'),
        cinderpegs: level.enemies.filter((enemy) => enemy.kind === 'cinderpeg').length,
        moths: level.enemies.filter((enemy) => enemy.kind === 'moth').length,
      };
      totals.crystals += counts.crystals;
      totals.blasters += counts.blasters;
      totals.packs += counts.packs;
      totals.cinderpegs += counts.cinderpegs;
      totals.moths += counts.moths;
      console.log(
        `levels/${level.id}.txt  ${level.name.padEnd(14)} ${String(level.width).padStart(2)} x ${String(level.height).padStart(2)}  ` +
          `${String(counts.crystals).padStart(2)} crystals  ${counts.blasters} blaster  ${counts.packs} packs  ` +
          `${counts.cinderpegs} Cinderpegs  ${counts.moths} Arc Moths  requires ${level.requires.length === 0 ? '-' : level.requires.join(', ')}  ` +
          `hardest ${cellText(level.hardest)}`,
      );
    }
    console.log(
      `campaign: ${totals.crystals} crystals, ${totals.blasters} blasters, ${totals.packs} packs, ` +
        `${totals.cinderpegs} Cinderpegs, ${totals.moths} Arc Moths`,
    );
  });

  it('the ten normal proofs, played in turn in one session from level 1, win the game with no death, each level on its own ticks', () => {
    const levels = campaign.map(levelOf);
    const game = createSession(levels, PHYS);
    let playTicks = 0;
    let lifeBonus = -1;
    levels.forEach((level, index) => {
      const proof = campaignProofs.get(level.id);
      const script = proof?.script ?? null;
      if (proof === undefined || script === null) throw new Error(`levels/${level.id}.txt has no normal proof to play: suite (a) failed for it`);
      expect(game.session.levelIndex, `the session is on levels/${level.id}.txt`).toBe(index);
      const played = playLevel(game, script);
      expect(played, `levels/${level.id}.txt, played as level ${index + 1} of the campaign`).toEqual({
        trophyTick: proof.trophyTick,
        winTick: proof.winTick,
        died: null,
      });
      playTicks += played.winTick;
      const next = walkThroughAirlock(game, index === levels.length - 1);
      if (next.type === 'gameWon') lifeBonus = next.lifeBonus;
      console.log(
        `campaign  level ${String(index + 1).padStart(2)}  levels/${level.id}.txt  cog ${played.trophyTick}, win ${played.winTick} ` +
          `(${(played.winTick / 60).toFixed(1)} s)  score ${game.session.score}  lives ${game.session.lives}  then ${next.type}` +
          (next.type === 'gameWon' ? ` (life bonus ${next.lifeBonus} included)` : ''),
      );
    });
    expect(game.session.status).toBe('won');
    console.log(
      `campaign: won with no death in ${playTicks} ticks of play (${(playTicks / 60 / 60).toFixed(1)} minutes at 60 ticks a second, ` +
        `the validator's pace), final score ${game.session.score}: ${game.session.score - lifeBonus} in the levels and a life bonus of ` +
        `${lifeBonus} for ${game.session.lives} lives left`,
    );
  });
});

// ---------------------------------------------------------------------------
// A window a level file promises, measured on the level itself
// ---------------------------------------------------------------------------

/**
 * Level 8, flight 2 (the file's comments; docs/LEVELS.md, section 8): from pillar 1 (cols 15-20) under the
 * roof to pillar 2 (cols 28-31), with fire beyond it. The flight runs along the roof until the tank is dry
 * and lands far along pillar 2, so the window that counts is the small-pad one of docs/LEVELS.md, section 2:
 * everything let go 8 frames after touchdown. Measured as padWindow in src/core/limits.test.ts measures a
 * pad: Sprue at rest on a standing pixel of pillar 1, full tank, packs 1 and 2 taken; RIGHT held from the
 * first tick and THRUST from k ticks later (k < 0: THRUST first, RIGHT -k ticks later, which also flies from
 * under the lintel's tip); every input released on each tick after touchdown + 8; a success is Sprue at rest
 * on pillar 2 six ticks after that. The window is the longest run of winning k, and the worst standing pixel
 * counts. Rule 3: levels 1 to 8 use ordinary windows only, 18 frames or more with the shipped numbers. With
 * pillar 2 three tiles wide (cols 28-30, to 2026-11-25) it was 17, from a run along the pillar.
 */
const FLIGHT_2: {
  readonly row: number;
  readonly pillar1: readonly [number, number];
  readonly react: number;
  readonly kFrom: number;
  readonly kTo: number;
} = { row: 9, pillar1: [15, 20], react: 8, kFrom: -40, kTo: 110 };

/** The columns of the first pillar east of pillar 1, as the level's grid has it (its top is row FLIGHT_2.row + 1). */
function pillar2Of(level: LevelData): readonly [number, number] {
  const solid = (col: number): boolean => level.tiles[(FLIGHT_2.row + 1) * level.width + col] === Tile.Solid;
  let from = FLIGHT_2.pillar1[1] + 1;
  while (from < level.width && !solid(from)) from++;
  let to = from;
  while (to + 1 < level.width && solid(to + 1)) to++;
  return [from, to];
}

function flight2Window(level: LevelData, phys: Phys): { readonly frames: number; readonly worstX: number } {
  const { row, pillar1, react, kFrom, kTo } = FLIGHT_2;
  const pillar2 = pillar2Of(level);
  const top = (row + 1) * TILE;
  const base = createSession([level], phys);
  // Idle through the ready gate's minimum: the first held control then opens it and plays its tick in full.
  while (base.run.phase === 'ready' && base.run.phaseTicks < base.run.phaseLength) step(base, NOTHING_HELD);
  const packsTaken = level.pickups.flatMap((pickup, index) => (pickup.kind === 'thruster' && pickup.col <= pillar1[1] ? [index] : []));
  const attempt = (x: number, k: number): boolean => {
    const game = cloneGame(base);
    const p = game.run.player;
    p.x = x * SUB;
    p.y = top - phys.heroH;
    p.hasThruster = true;
    p.fuel = phys.fuelTicks;
    for (const index of packsTaken) game.run.taken[index] = true;
    const rightFrom = 1 + Math.max(0, -k);
    const thrustFrom = 1 + Math.max(0, k);
    let airborne = false;
    let landedAt = 0;
    for (let t = 1; t <= 600; t++) {
      const held = landedAt > 0 && t > landedAt + react ? 0 : (t >= rightFrom ? InputBit.Right : 0) | (t >= thrustFrom ? InputBit.Thrust : 0);
      step(game, inputFromBits(held));
      if (game.run.phase !== 'playing') return false;
      if (!p.onGround) airborne = true;
      const onPillar2 = p.onGround && p.y + phys.heroH === top && p.x + phys.heroW > pillar2[0] * TILE && p.x < (pillar2[1] + 1) * TILE;
      if (landedAt === 0 && airborne && onPillar2) landedAt = t;
      if (landedAt > 0 && t > landedAt + react + 6 && p.onGround && p.vx === 0) return onPillar2;
    }
    return false;
  };
  let frames = Infinity;
  let worstX = -1;
  const heroPx = phys.heroW / SUB;
  for (let x = pillar1[0] * TILE_PX; x <= (pillar1[1] + 1) * TILE_PX - heroPx; x++) {
    let best = 0;
    let run = 0;
    for (let k = kFrom; k <= kTo; k++) {
      run = attempt(x, k) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    if (best < frames) {
      frames = best;
      worstX = x;
    }
  }
  return { frames, worstX };
}

describe('level 8, flight 2: the landing on pillar 2 is an ordinary window', () => {
  it(
    'from every standing pixel of pillar 1, with everything let go 8 frames after touchdown: 18 frames or more on the live numbers',
    () => {
      const file = files.find((candidate) => candidate.id === 'level-08');
      if (file === undefined) throw new Error('levels/level-08.txt is missing');
      const level = levelOf(file);
      const [from, to] = pillar2Of(level);
      // The pillar the comments name: it starts at col 28, under pack 3.
      expect(from, `pillar 2 (cols ${from}-${to})`).toBe(28);
      const live = flight2Window(level, PHYS);
      const comfort = flight2Window(level, COMFORT_PHYS);
      console.log(
        `levels/level-08.txt  flight 2 onto pillar 2 (cols ${from}-${to}), let go 8 frames after touchdown: ${live.frames} / ${comfort.frames} frames ` +
          `(worst standing pixel x ${live.worstX} / ${comfort.worstX})`,
      );
      expect(live.frames, `the worst standing pixel, x ${live.worstX}`).toBeGreaterThanOrEqual(18);
    },
    60_000,
  );
});

describe.runIf(CRYSTALS_MODE)('LEVELS_CRYSTALS=1: crystals no state of the enemy-free map collected', () => {
  for (const file of files) {
    it(
      `levels/${file.id}.txt`,
      () => {
        const level = levelOf(file);
        const proof = proveAndPrint('crystals', level, PHYS, { ...DEFAULT_OPTIONS, alwaysMap: true, maxStepCalls: CRYSTALS_MAX_STEP_CALLS }, false);
        const cells = proof.unreachableCrystals;
        console.log(
          `levels/${level.id}.txt  unreachable crystals: ${
            cells === null ? 'not known (the map did not finish)' : cells.length === 0 ? 'none' : cells.map((cell) => `${cell.col},${cell.row}`).join('  ')
          }`,
        );
      },
      CRYSTALS_TIMEOUT_MS,
    );
  }
});

// Last in the file: Vitest runs a file's tests in order, so every proof above has been counted.
describe('the step budget', () => {
  it(`all proofs together stay under LEVELS_STEP_BUDGET (${millions(LEVELS_STEP_BUDGET)} step calls)`, () => {
    const undecided = requiresRuns.filter((run) => run.verdict === 'budget-exceeded').map((run) => run.label);
    console.log(`@requires runs that ended budget-exceeded (not decided): ${undecided.length === 0 ? 'none' : undecided.join('; ')}`);
    console.log(
      `levels test: ${millions(budgetCalls)} step calls of the ${millions(LEVELS_STEP_BUDGET)} budget, ` +
        `${(budgetMs / 1000).toFixed(1)} s of wall time in validateLevel`,
    );
    expect(budgetCalls).toBeLessThan(LEVELS_STEP_BUDGET);
  });
});
