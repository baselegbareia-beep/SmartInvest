import { describe, expect, it } from 'vitest';

import { TUNING } from '../tuning';
import { compileTuning } from './compileTuning';
import { cloneGame, copyGame, step } from './game';
import { IN, levelFromRows, NONE, playingGame, REFERENCE_PHYS, REFERENCE_TUNING } from './testkit';
import { SUB, TILE } from './types';
import type { GameEvent, GameState, Input, LevelData, Phys, PlayerState, Tuning } from './types';
import { handicap } from './validate/handicap';

/**
 * docs/ARCHITECTURE.md, section 13 ("Derived limits"), through the real core.
 *
 * Part 1 reads the live TUNING. It asserts the whole-tile limits the levels
 * are built on, and fails with a message that names the limit and the rule of
 * docs/LEVELS.md that depends on it. It also prints, without failing, every
 * number in which TUNING differs from REFERENCE_TUNING.
 *
 * Part 2 runs on REFERENCE_PHYS (and its handicap) and reproduces the tables
 * of section 13 cell for cell. The documents quote these tables: a change
 * here is a change to docs/ARCHITECTURE.md section 13 and docs/LEVELS.md
 * section 2, made together, on purpose.
 *
 * The measuring protocols are those of the throwaway models that first
 * produced the tables (section 13 says how each was measured). The jump and
 * pad windows use an exact shortcut that gives the same numbers, explained at
 * `runner` below.
 */

// ---------------------------------------------------------------------------
// Tunings
// ---------------------------------------------------------------------------

const LIVE = compileTuning(TUNING);
const LIVE_HANDICAP = compileTuning(handicap(TUNING));
const REF = REFERENCE_PHYS;
const REF_HANDICAP = compileTuning(handicap(REFERENCE_TUNING));

/** The two columns of every section 13 table: reference tuning, then its handicap. */
const BOTH: readonly (readonly [string, Phys])[] = [
  ['shipped', REF],
  ['handicap', REF_HANDICAP],
];

const R = IN('R');
const RJ = IN('RJ');
const RT = IN('RT');
const RJT = IN('RJT');
const J = IN('J');
const T = IN('T');
const JT = IN('JT');

const px = (sub: number): number => sub / SUB;
const tiles = (sub: number): number => sub / TILE;
/** A number as section 13 prints it, with a fixed number of decimals. */
const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

// ---------------------------------------------------------------------------
// Level builders
// ---------------------------------------------------------------------------

function put(rows: string[], row: number, col: number, char: string): void {
  const line = rows[row] ?? '';
  rows[row] = line.slice(0, col) + char + line.slice(col + 1);
}

/** Take-off ledge length, landing ledge length, row of the take-off ledge's top, grid height. */
const A_LEN = 8;
const B_LEN = 10;
const A_ROW = 12;
const GAP_ROWS = 24;
/** x of the take-off ledge's end: the gap starts here. */
const EDGE = (1 + A_LEN) * TILE;

/**
 * The jump-window room: a take-off ledge 8 tiles long, a gap of `gap` tiles
 * and a landing ledge `rise` tiles higher (negative: lower). The gap is a
 * bottomless pit, or with `bed` a floor carrying spikes or fire at the
 * take-off height.
 */
function gapLevel(gap: number, rise: number, bed: 'S' | 'F' | null = null): LevelData {
  const width = 1 + A_LEN + gap + B_LEN + 1;
  const rows: string[] = [];
  for (let r = 0; r < GAP_ROWS; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      let char: string;
      if (c === 0 || c === width - 1 || r === 0) char = '#';
      else if (c <= A_LEN) char = r >= A_ROW ? '#' : '.';
      else if (c <= A_LEN + gap) char = bed === null ? '.' : r === A_ROW - 1 ? bed : r >= A_ROW ? '#' : '.';
      else char = r >= A_ROW - rise ? '#' : '.';
      line += char;
    }
    rows.push(line);
  }
  put(rows, A_ROW - 1, 1, 'P');
  put(rows, A_ROW - rise - 1, width - 3, 'T');
  put(rows, A_ROW - rise - 1, width - 2, 'D');
  return levelFromRows(rows);
}

/** A closed shaft 10 tiles wide and 22 high with the hero on its floor: climbs, hover, falls. */
function shaft(): LevelData {
  const rows = ['#'.repeat(12)];
  for (let r = 1; r < 23; r++) rows.push(`#${'.'.repeat(10)}#`);
  rows.push('#'.repeat(12));
  rows[22] = '#.P.....TD.#';
  return levelFromRows(rows);
}

// ---------------------------------------------------------------------------
// The runner: an exact shortcut for "every sub-pixel alignment of a run-up"
// ---------------------------------------------------------------------------

/** Ticks from rest to full speed on the ground, and the distance covered meanwhile. */
function runUp(phys: Phys): { readonly ticks: number; readonly distance: number } {
  let v = 0;
  let distance = 0;
  let ticks = 0;
  while (v < phys.runMax) {
    v = Math.min(v + phys.groundAccel, phys.runMax);
    distance += v;
    ticks++;
  }
  return { ticks, distance };
}

/**
 * A hero who runs right at full speed with RIGHT held is, at the end of every
 * tick, in a state that depends on nothing but his x: on the ledge it is
 * x, vx = runMax and full coyote time; past the edge it is the same walk-off
 * seen a fixed number of ticks later, which x also tells. So a press made on
 * the tick that starts at x = X has one outcome, f(X), whatever the run-up
 * before it was.
 *
 * The protocol of section 13 starts the run 4 tiles before the edge at every
 * sub-pixel offset a (0 to runMax - 1) and presses on tick k. Once the hero is
 * at full speed (k > runUp.ticks) that press is f(X) with
 * X = EDGE - 4 tiles - a + runUp.distance + (k - runUp.ticks - 1) * runMax,
 * so every (a, k) is one sub-pixel X, each exactly once. Presses made while
 * still speeding up land back on the take-off ledge; the brute-force protocol
 * over all 384 alignments (50 s) gave the same tables as this shortcut (2 s).
 *
 * The returned function puts a fresh copy of the game in the state at X.
 */
function runner(level: LevelData, phys: Phys, kit?: (p: PlayerState) => void): (x: number) => GameState {
  const template = playingGame(level, phys);
  const game = cloneGame(template);
  const groundY = template.run.player.y;
  return (x) => {
    copyGame(game, template);
    const p = game.run.player;
    // Past the edge: start on the ledge and let the hero walk off, so the fall is the real one.
    const behind = x < EDGE ? 0 : Math.floor((x - EDGE) / phys.runMax) + 1;
    p.x = x - behind * phys.runMax;
    p.y = groundY;
    p.vx = phys.runMax;
    p.onGround = true;
    p.coyote = phys.coyoteTicks + 1;
    kit?.(p);
    for (let i = 0; i < behind; i++) step(game, R);
    return game;
  };
}

/** Coarse sampling stride of `successSet`, sub-pixels. */
const COARSE = 32;

/**
 * Every X in [lo, hi] at which `ok` holds. Sampled every COARSE sub-pixels;
 * around every success found, every single sub-pixel within `margin` is
 * tried, because single sub-pixel holes do occur (a corner met exactly) and
 * decide the worst alignment. A success run narrower than COARSE far from
 * any other would be missed; none exists in these rooms (the brute-force
 * protocol agrees).
 */
function successSet(lo: number, hi: number, margin: number, ok: (x: number) => boolean): (x: number) => boolean {
  const ranges: (readonly [number, number])[] = [];
  for (let x = lo; x <= hi; x += COARSE) {
    if (!ok(x)) continue;
    const from = Math.max(lo, x - COARSE - margin);
    const to = Math.min(hi, x + COARSE + margin);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && from <= last[1] + 1) ranges[ranges.length - 1] = [last[0], to];
    else ranges.push([from, to]);
  }
  const exact = ranges.map(([from, to]) => {
    const values = new Uint8Array(to - from + 1);
    for (let x = from; x <= to; x++) values[x - from] = ok(x) ? 1 : 0;
    return { from, to, values };
  });
  return (x) => {
    for (const range of exact) {
      if (x >= range.from && x <= range.to) return range.values[x - range.from] === 1;
    }
    return false;
  };
}

/** `any` when a plain walk off the edge (no press) succeeds at every alignment; otherwise the worst window. */
interface Window {
  readonly any: boolean;
  readonly frames: number;
}

/** A table cell as section 13 prints it. */
const cell = (w: Window): string => (w.any ? 'any' : w.frames === 0 ? '-' : String(w.frames));

/**
 * The press window of a manoeuvre started from a full-speed run: for each
 * sub-pixel alignment of a 4-tile run-up, the longest run of consecutive
 * press ticks (1 to `lastTick`) whose attempt succeeds; the worst alignment
 * counts. `attempt(game, press)` plays from the state at the start of the
 * press tick, holding the press from that tick on when `press` is true.
 * Presses later than `zoneTicks` after the edge do nothing a plain walk
 * does not, so they take the walk's outcome.
 */
function pressWindow(
  level: LevelData,
  phys: Phys,
  attempt: (game: GameState, press: boolean) => boolean,
  options: { readonly lastTick: number; readonly zoneTicks: number; readonly kit?: (p: PlayerState) => void },
): Window {
  const at = runner(level, phys, options.kit);
  const stride = phys.runMax;
  const residue = (x: number): number => ((x % stride) + stride) % stride;

  const walk = new Uint8Array(stride);
  let any = true;
  for (let x = EDGE - stride; x < EDGE; x++) {
    const ok = attempt(at(x), false);
    walk[residue(x)] = ok ? 1 : 0;
    if (!ok) any = false;
  }
  if (any) return { any, frames: 0 };

  const { ticks: speedTicks, distance } = runUp(phys);
  const lo = EDGE - 4 * TILE - (stride - 1) + distance;
  const hi = EDGE + options.zoneTicks * stride;
  const pressed = successSet(lo, hi, stride, (x) => attempt(at(x), true));
  let worst = Infinity;
  for (let a = 0; a < stride; a++) {
    let current = 0;
    let best = 0;
    for (let k = speedTicks + 1; k <= options.lastTick; k++) {
      const x = EDGE - 4 * TILE - a + distance + (k - speedTicks - 1) * stride;
      const ok = x <= hi ? pressed(x) : walk[residue(x)] === 1;
      current = ok ? current + 1 : 0;
      best = Math.max(best, current);
    }
    worst = Math.min(worst, best);
  }
  return { any, frames: worst };
}

// ---------------------------------------------------------------------------
// Jump windows, hazard beds, small pads
// ---------------------------------------------------------------------------

/** Run right with jump pressed and held; success is standing on the landing ledge (or the airlock). */
function jumpWindow(phys: Phys, gap: number, rise: number, bed: 'S' | 'F' | null = null): Window {
  const level = gapLevel(gap, rise, bed);
  const landX = (1 + A_LEN + gap) * TILE;
  const landY = (A_ROW - rise) * TILE;
  const attempt = (game: GameState, press: boolean): boolean => {
    const p = game.run.player;
    const input = press ? RJ : R;
    for (let t = 1; t <= 400; t++) {
      step(game, input);
      if (game.run.phase === 'dying') return false;
      if (game.run.phase === 'exiting') return true;
      if (p.onGround && p.x + phys.heroW > landX && p.y + phys.heroH === landY) return true;
      if (p.y > (GAP_ROWS + 2) * TILE) return false;
    }
    return false;
  };
  return pressWindow(level, phys, attempt, { lastTick: 120, zoneTicks: phys.coyoteTicks + 3 });
}

const RISES = [3, 2, 1, 0, -1, -2, -3, -4] as const;
const riseName = (rise: number): string => (rise > 0 ? `${rise} up` : rise === 0 ? 'level' : `${-rise} down`);

/** One row of the jump-window table, printed as in section 13. */
function jumpWindowRow(rise: number): string {
  const cells = [1, 2, 3, 4, 5, 6].map((gap) => {
    const shipped = cell(jumpWindow(REF, gap, rise));
    const weak = cell(jumpWindow(REF_HANDICAP, gap, rise));
    return shipped === '-' && weak === '-' ? '-' : `${shipped} / ${weak}`;
  });
  return `| ${riseName(rise)} | ${cells.join(' | ')} |`;
}

/** The small-pad room: a gap, a level pad, then a deadly gap 6 tiles wide. */
function padLevel(gap: number, pad: number): { level: LevelData; padLeft: number; padRight: number; top: number } {
  const height = 16;
  const floor = 10;
  const width = 1 + A_LEN + gap + pad + 6 + 4 + 1;
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      let char: string;
      if (c === 0 || c === width - 1 || r === 0) char = '#';
      else if (c <= A_LEN) char = r >= floor ? '#' : '.';
      else if (c <= A_LEN + gap) char = '.';
      else if (c <= A_LEN + gap + pad) char = r >= floor ? '#' : '.';
      else if (c <= A_LEN + gap + pad + 6) char = '.';
      else char = r >= floor ? '#' : '.';
      line += char;
    }
    rows.push(line);
  }
  put(rows, floor - 1, 1, 'P');
  put(rows, floor - 1, width - 3, 'T');
  put(rows, floor - 1, width - 2, 'D');
  return {
    level: levelFromRows(rows),
    padLeft: (1 + A_LEN + gap) * TILE,
    padRight: (1 + A_LEN + gap + pad) * TILE,
    top: floor * TILE,
  };
}

/**
 * Run right, press and hold jump, and let go of everything `react` ticks
 * after touching down on the pad. Success: the hero comes to rest on the pad.
 */
function padWindow(phys: Phys, gap: number, pad: number, react: number): number {
  const room = padLevel(gap, pad);
  const events: GameEvent[] = [];
  const attempt = (game: GameState, press: boolean): boolean => {
    const p = game.run.player;
    let landedAt = 0;
    let jumped = false;
    for (let t = 1; t <= 300; t++) {
      const input = landedAt > 0 && t > landedAt + react ? NONE : press ? RJ : R;
      events.length = 0;
      step(game, input, events);
      if (events.some((e) => e.type === 'jumped')) jumped = true;
      if (game.run.phase !== 'playing') return false;
      const onPad = p.x + phys.heroW > room.padLeft && p.x < room.padRight;
      if (jumped && landedAt === 0 && p.onGround) {
        // Landing anywhere but on the pad (back on the take-off ledge) fails.
        if (!(onPad && p.y + phys.heroH === room.top)) return false;
        landedAt = t;
      }
      if (landedAt > 0 && p.vx === 0 && p.onGround && t > landedAt + react + 6) return onPad;
    }
    return false;
  };
  return pressWindow(room.level, phys, attempt, { lastTick: 110, zoneTicks: phys.coyoteTicks + 3 }).frames;
}

// ---------------------------------------------------------------------------
// Thruster
// ---------------------------------------------------------------------------

const withFullTank =
  (phys: Phys) =>
  (p: PlayerState): void => {
    p.hasThruster = true;
    p.fuel = phys.fuelTicks;
  };

/**
 * The flight-window room: a take-off ledge 8 tiles long, a level gap and a
 * landing ledge, with `headroom` clear tiles above the ledges. Open sky is
 * 16 tiles: twice what any flight here rises.
 */
function flightWindowRoom(headroom: number, gap: number): { level: LevelData; far: number; top: number; floor: number } {
  const width = 1 + 8 + gap + 10 + 1;
  const height = headroom + 8;
  const top = headroom + 1;
  const rows = ['#'.repeat(width)];
  for (let r = 1; r < height; r++) rows.push(`#${'.'.repeat(width - 2)}#`);
  for (let r = top; r < height; r++) rows[r] = `#${'#'.repeat(8)}${'.'.repeat(gap)}${'#'.repeat(10)}#`;
  put(rows, top - 1, 2, 'P');
  put(rows, top - 1, width - 3, 'T');
  put(rows, top - 1, width - 2, 'D');
  return { level: levelFromRows(rows), far: (9 + gap) * TILE, top: top * TILE, floor: (height + 2) * TILE };
}

/**
 * Press window for crossing a level gap with THRUST simply held from tick k,
 * no jump: worst of 16 sub-pixel alignments of a 7-tile run-up, press ticks
 * 1 to 160, played out one by one as section 13 defines the table. The run-up
 * is 7 tiles because the thruster also saves a hero who has already walked
 * off the edge: the window reaches so far back that a 4-tile run-up cut the
 * 7-tile open-sky window off at its first tick.
 */
function flightWindow(phys: Phys, headroom: number, gap: number): number {
  const room = flightWindowRoom(headroom, gap);
  const template = playingGame(room.level, phys);
  const game = cloneGame(template);
  let worst = Infinity;
  for (let a = 0; a < 16; a++) {
    const offset = Math.round((a * phys.runMax) / 16);
    let current = 0;
    let best = 0;
    for (let k = 1; k <= 160; k++) {
      copyGame(game, template);
      const p = game.run.player;
      withFullTank(phys)(p);
      p.x = EDGE - 7 * TILE - offset;
      let ok = false;
      for (let t = 1; t <= 900; t++) {
        step(game, t >= k ? RT : R);
        if (game.run.phase !== 'playing') break;
        if (p.onGround && p.x + phys.heroW > room.far && p.y + phys.heroH === room.top) {
          ok = true;
          break;
        }
        if (p.y > room.floor) break;
      }
      current = ok ? current + 1 : 0;
      best = Math.max(best, current);
    }
    worst = Math.min(worst, best);
  }
  return worst;
}

/** The level-flight room: a take-off ledge 8 tiles long and open air beyond it, `headroom` tiles above the ledge. */
function flightRoom(headroom: number): { level: LevelData; top: number } {
  const width = 64;
  const height = headroom + 6;
  const top = headroom + 1;
  const rows = ['#'.repeat(width)];
  for (let r = 1; r < height; r++) rows.push(`#${'.'.repeat(width - 2)}#`);
  for (let r = top; r < height; r++) rows[r] = `#${'#'.repeat(8)}${'.'.repeat(width - 10)}#`;
  rows[top - 1] = `#.P${'.'.repeat(width - 6)}TD#`;
  return { level: levelFromRows(rows), top: top * TILE };
}

type Policy = (t: number, k: number, p: PlayerState, hold: number) => Input;

/**
 * Widest level gap a flight policy crosses, in sub-pixels: the furthest the
 * hero's right side gets past the ledge's edge at a moment a landing at the
 * ledge's height is possible (ledge catch included). Best over the tick k on
 * which the manoeuvre starts (20 to 62, from a 4-tile run-up) and over
 * `holds` when the policy has a jump hold length.
 */
function flightReach(phys: Phys, headroom: number, policy: Policy, holds: readonly number[] = [0]): number {
  const room = flightRoom(headroom);
  const template = playingGame(room.level, phys);
  const game = cloneGame(template);
  let best = 0;
  for (const hold of holds) {
    for (let k = 20; k <= 62; k++) {
      copyGame(game, template);
      const p = game.run.player;
      withFullTank(phys)(p);
      p.x = EDGE - 4 * TILE;
      let prevFeet = p.y + phys.heroH;
      let left = false;
      for (let t = 1; t <= 900; t++) {
        step(game, policy(t, k, p, hold));
        const feet = p.y + phys.heroH;
        if (!p.onGround) left = true;
        if (left && p.vy >= 0 && prevFeet <= room.top + phys.ledgeCatch && feet > room.top - 1) {
          best = Math.max(best, p.x + phys.heroW - EDGE);
        }
        prevFeet = feet;
        if (game.run.phase !== 'playing' || (left && p.onGround)) break;
      }
    }
  }
  return best;
}

const thrustHeld: Policy = (t, k) => (t >= k ? RT : R);
const thrustFeathered: Policy = (t, k, p) => (t < k ? R : t === k || p.vy >= 0 ? RT : R);
const chordHeld: Policy = (t, k) => (t >= k ? RJT : R);
const chordFeathered: Policy = (t, k, p) => (t < k ? R : p.vy >= 0 ? RJT : RJ);

/** Highest climb from standing in the shaft, sub-pixels, best over `holds`, and the hold that gave it. */
function climb(phys: Phys, policy: (t: number, hold: number) => Input, holds: readonly number[] = [0]): {
  readonly height: number;
  readonly hold: number;
  readonly firstBurn: number;
} {
  let best = { height: 0, hold: 0, firstBurn: 0 };
  for (const hold of holds) {
    const game = playingGame(shaft(), phys);
    const p = game.run.player;
    withFullTank(phys)(p);
    const y0 = p.y;
    let height = 0;
    let firstBurn = 0;
    for (let t = 1; t <= 400; t++) {
      const fuel = p.fuel;
      step(game, policy(t, hold));
      if (firstBurn === 0 && p.fuel < fuel) firstBurn = t;
      height = Math.max(height, y0 - p.y);
    }
    if (height > best.height) best = { height, hold, firstBurn };
  }
  return best;
}

/** One thumb: JUMP held for `hold` ticks, 6 ticks with nothing (the thumb moves), then THRUST held. */
const oneThumb = (t: number, hold: number): Input => (t <= hold ? J : t <= hold + 6 ? NONE : T);
const HOLDS = Array.from({ length: 30 }, (_, i) => i + 1);

/**
 * The best climb from standing over EVERY pattern of THRUST on and off (no
 * jump), through the real step(): tick by tick, for each (vy, fuel,
 * thrusting, onGround) only the highest hero is kept, because open air is
 * the same at every height.
 */
function bestThrustPatternClimb(phys: Phys): number {
  const root = playingGame(shaft(), phys);
  withFullTank(phys)(root.run.player);
  const y0 = root.run.player.y;
  let frontier = new Map<string, GameState>([['root', root]]);
  let best = 0;
  for (let t = 0; t < 400 && frontier.size > 0; t++) {
    const next = new Map<string, GameState>();
    for (const state of frontier.values()) {
      for (const input of [T, NONE]) {
        const game = cloneGame(state);
        step(game, input);
        const p = game.run.player;
        best = Math.max(best, y0 - p.y);
        // Falling with an empty tank only goes down; standing idle again is the start with less fuel.
        if (p.fuel === 0 && p.vy >= 0) continue;
        if (p.onGround && input === NONE) continue;
        const key = `${p.vy},${p.fuel},${p.thrusting},${p.onGround}`;
        const kept = next.get(key);
        if (kept === undefined || kept.run.player.y > p.y) next.set(key, game);
      }
    }
    frontier = next;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** An open room 22 tiles wide with the hero on the floor. */
function openRoom(): LevelData {
  const rows = ['#'.repeat(24)];
  for (let r = 1; r < 8; r++) rows.push(`#${'.'.repeat(22)}#`);
  rows.push('#'.repeat(24));
  rows[7] = `#.P${'.'.repeat(18)}TD#`;
  return levelFromRows(rows);
}

/** Highest point (sub-pixels above the start) of a jump with JUMP held for `hold` ticks from standing, its tick, and the landing tick. */
function standingJump(phys: Phys, hold: number): { apex: number; apexTick: number; landTick: number; nearApex: number } {
  const game = playingGame(openRoom(), phys);
  const p = game.run.player;
  const y0 = p.y;
  const heights: number[] = [];
  let apex = 0;
  let apexTick = 0;
  let landTick = 0;
  for (let t = 1; t <= 80; t++) {
    step(game, t <= hold ? J : NONE);
    const height = y0 - p.y;
    heights.push(height);
    if (height > apex) {
      apex = height;
      apexTick = t;
    }
    if (landTick === 0 && p.onGround) landTick = t;
  }
  const nearApex = heights.filter((h) => h > 0 && apex - h <= 4 * SUB).length;
  return { apex, apexTick, landTick, nearApex };
}

/** A wall `height` tiles high at column 10; the hero stands flush against it. */
function stepLevel(height: number): LevelData {
  const width = 24;
  const floor = 12;
  const rows: string[] = [];
  for (let r = 0; r < 14; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const wall = c === 0 || c === width - 1 || r === 0 || r >= floor || (c >= 10 && r >= floor - height);
      line += wall ? '#' : '.';
    }
    rows.push(line);
  }
  put(rows, floor - 1, 2, 'P');
  put(rows, floor - height - 1, width - 3, 'T');
  put(rows, floor - height - 1, width - 2, 'D');
  return levelFromRows(rows);
}

/** Shortest JUMP hold (with RIGHT held) that climbs a step of `height` tiles from standing flush, or null. */
function minStepHold(phys: Phys, height: number): number | null {
  const level = stepLevel(height);
  const top = (12 - height) * TILE;
  for (let hold = 1; hold <= 60; hold++) {
    const game = playingGame(level, phys);
    const p = game.run.player;
    p.x = 10 * TILE - phys.heroW;
    for (let t = 1; t <= 200; t++) {
      step(game, t <= hold ? RJ : R);
      if (p.onGround && p.y + phys.heroH === top) return hold;
      if (p.onGround && t > hold + 2) break;
    }
  }
  return null;
}

/**
 * Longest level gap (section 13, Movement): the furthest the hero's right
 * side gets past the edge at a moment a landing at the take-off height is
 * possible, best over every press X of a full-speed run (see `runner`).
 */
function longestGap(phys: Phys): number {
  const level = gapLevel(12, -8);
  const top = A_ROW * TILE;
  const at = runner(level, phys);
  const events: GameEvent[] = [];
  const { distance } = runUp(phys);
  let best = -Infinity;
  for (let x = EDGE - 4 * TILE - (phys.runMax - 1) + distance; x <= EDGE + (phys.coyoteTicks + 2) * phys.runMax; x++) {
    const game = at(x);
    const p = game.run.player;
    let prevFeet = p.y + phys.heroH;
    let jumped = false;
    for (let t = 1; t <= 200; t++) {
      events.length = 0;
      step(game, RJ, events);
      const feet = p.y + phys.heroH;
      if (jumped && p.vy >= 0 && prevFeet <= top + phys.ledgeCatch && feet > top - 1) {
        best = Math.max(best, p.x + phys.heroW - EDGE);
      }
      if (events.some((e) => e.type === 'jumped')) jumped = true;
      prevFeet = feet;
      if (!jumped || p.y > 20 * TILE) break;
    }
  }
  return best;
}

/** The same from a standing start at `x`, jump and RIGHT held. */
function standingGap(phys: Phys, x: number): number {
  const game = playingGame(gapLevel(12, -8), phys);
  const p = game.run.player;
  const top = A_ROW * TILE;
  p.x = x;
  let prevFeet = p.y + phys.heroH;
  let best = -Infinity;
  for (let t = 1; t <= 200; t++) {
    step(game, RJ);
    const feet = p.y + phys.heroH;
    if (t > 1 && p.vy >= 0 && prevFeet <= top + phys.ledgeCatch && feet > top - 1) best = Math.max(best, p.x + phys.heroW - EDGE);
    prevFeet = feet;
    if (p.y > 20 * TILE) break;
  }
  return best;
}

/** True when a hero walking right at full speed falls into a hole 1 tile wide at every alignment. */
function holeSwallowsWalker(phys: Phys): boolean {
  const at = runner(gapLevel(1, 0), phys);
  const farSide = (1 + A_LEN + 1) * TILE;
  for (let x = EDGE - phys.runMax; x < EDGE; x++) {
    const game = at(x);
    const p = game.run.player;
    for (let t = 1; t <= 300 && game.run.phase === 'playing'; t++) {
      step(game, R);
      if (p.onGround && p.x > farSide) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Part 1: the live TUNING
// ---------------------------------------------------------------------------

/** What to do when a limit moves; every Part 1 message ends with it. */
const MOVED =
  'A tuning change moved a whole-tile limit the levels are built on. Undo the change, or rebuild the levels and ' +
  'docs/LEVELS.md for the new limit (a developer job).';

describe('Part 1, live TUNING: the whole-tile limits the levels are built on', () => {
  it('prints the numbers in which TUNING differs from REFERENCE_TUNING (never fails)', () => {
    const differences: string[] = [];
    const groups = Object.keys(REFERENCE_TUNING) as (keyof Tuning)[];
    for (const group of groups) {
      if (['camera', 'view', 'touch', 'effects', 'pacing'].includes(group)) continue;
      const live = TUNING[group] as unknown as Readonly<Record<string, number>>;
      const reference = REFERENCE_TUNING[group] as unknown as Readonly<Record<string, number>>;
      for (const name of Object.keys(reference)) {
        if (live[name] !== reference[name]) differences.push(`${group}.${name}: ${reference[name]} -> ${live[name]}`);
      }
    }
    console.log(
      differences.length === 0
        ? 'limits: TUNING equals REFERENCE_TUNING in every core number'
        : `limits: TUNING differs from REFERENCE_TUNING (section 13 was measured on the reference):\n  ${differences.join('\n  ')}`,
    );
  });

  it('a 3-tile step can be climbed and a 4-tile step cannot', () => {
    expect(
      minStepHold(LIVE, 3),
      `LIMIT MOVED: the hero can no longer climb a 3-tile step (docs/LEVELS.md section 2 "Step up", rule 3). ${MOVED}`,
    ).not.toBeNull();
    expect(
      minStepHold(LIVE, 4),
      `LIMIT MOVED: the hero can now climb a 4-tile step, which every level treats as a wall (docs/LEVELS.md section 2 "Step up", rule 7). ${MOVED}`,
    ).toBeNull();
    // A run at the 4-tile wall jumps no higher (vy does not depend on vx), but try every press tick of a run-in too.
    const level = stepLevel(4);
    for (let k = 1; k <= 40; k++) {
      const game = playingGame(level, LIVE);
      const p = game.run.player;
      p.x = 6 * TILE;
      for (let t = 1; t <= 200; t++) step(game, t >= k ? RJ : R);
      expect(p.y + LIVE.heroH, `LIMIT MOVED: a running jump climbs a 4-tile step (press tick ${k}). ${MOVED}`).toBe(12 * TILE);
    }
  });

  it('a level 4-tile gap can be jumped and a 5-tile gap cannot', () => {
    expect(
      jumpWindow(LIVE, 4, 0).frames,
      `LIMIT MOVED: a level 4-tile gap can no longer be jumped from a run at every alignment (docs/LEVELS.md section 2 "Gap" and "Jump windows"). ${MOVED}`,
    ).toBeGreaterThan(0);
    // "Cannot" is checked at every single sub-pixel of the run, not just sampled.
    expect(
      longestGap(LIVE),
      `LIMIT MOVED: the longest level gap reaches 5 tiles (80 px), so a 5-tile gap can be jumped (docs/LEVELS.md section 2 "Gap"). ${MOVED}`,
    ).toBeLessThan(5 * TILE);
  });

  it('a walking hero falls into a hole 1 tile wide', () => {
    expect(
      holeSwallowsWalker(LIVE),
      `LIMIT MOVED: a walking hero now crosses a hole 1 tile wide at some alignment, so such holes are no longer pits (docs/LEVELS.md section 2 "Holes"). ${MOVED}`,
    ).toBe(true);
  });

  it.each([
    ['shipped', LIVE],
    ['handicap', LIVE_HANDICAP],
  ] as const)(
    'THRUST held climbs at least 6 tiles and crosses a level 8-tile gap under a roof 2 tiles up (%s)',
    (name, phys) => {
      expect(
        tiles(climb(phys, () => T).height),
        `LIMIT MOVED (${name}): THRUST held from standing climbs less than 6 tiles (docs/LEVELS.md rule 8). ${MOVED}`,
      ).toBeGreaterThanOrEqual(6);
      expect(
        flightWindow(phys, 2, 8),
        `LIMIT MOVED (${name}): THRUST held no longer crosses a level 8-tile gap under a roof 2 tiles above the ledge at every alignment (docs/LEVELS.md rule 8). ${MOVED}`,
      ).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// Part 2: the tables of section 13 on REFERENCE_PHYS
// ---------------------------------------------------------------------------

describe('Part 2, REFERENCE_PHYS: section 13 "Movement"', () => {
  it('full jump: apex 52.625 px (3.29 tiles) on tick 21, back on the ground on tick 41, 13 ticks within 4 px of the apex; handicap apex 47.625 px', () => {
    expect(standingJump(REF, 99)).toEqual({ apex: 13472, apexTick: 21, landTick: 41, nearApex: 13 });
    expect(fixed(tiles(13472), 2)).toBe('3.29');
    expect(px(standingJump(REF_HANDICAP, 99).apex)).toBe(47.625);
  });

  it('jump by hold, frames: apex in tiles', () => {
    const row = [1, 2, 3, 4, 6, 8, 10, 12, 14, 18].map((hold) => `${hold}: ${fixed(tiles(standingJump(REF, hold).apex), 2)}`);
    row.push(`held: ${fixed(tiles(standingJump(REF, 99).apex), 2)}`);
    expect(row.join(', ')).toBe('1: 0.43, 2: 0.73, 3: 1.01, 4: 1.27, 6: 1.76, 8: 2.18, 10: 2.54, 12: 2.84, 14: 3.07, 18: 3.25, held: 3.29');
  });

  it('largest step-up: 3 tiles with holds of 3, 7 and 12 f, never 4; handicap 3 tiles at 14 f, and only through the ledge catch', () => {
    expect([1, 2, 3, 4].map((h) => minStepHold(REF, h))).toEqual([3, 7, 12, null]);
    expect([1, 2, 3, 4].map((h) => minStepHold(REF_HANDICAP, h))).toEqual([3, 7, 14, null]);
    expect(minStepHold({ ...REF_HANDICAP, ledgeCatch: 0 }, 3)).toBeNull();
    // The handicap apex is 0.375 px short of 3 tiles.
    expect(3 * 16 - px(standingJump(REF_HANDICAP, 99).apex)).toBe(0.375);
  });

  it(
    'longest level gap: 79.0 px with coyote time, 73.0 without, 71.5 without the ledge catch too; handicap 67.0',
    () => {
      expect(fixed(px(longestGap(REF)), 1)).toBe('79.0');
      expect(fixed(px(longestGap({ ...REF, coyoteTicks: 0 })), 1)).toBe('73.0');
      expect(fixed(px(longestGap({ ...REF, coyoteTicks: 0, ledgeCatch: 0 })), 1)).toBe('71.5');
      expect(fixed(px(longestGap(REF_HANDICAP)), 1)).toBe('67.0');
    },
    30_000,
  );

  it('the same from a standing start: 68.2 px hanging over the edge, 58.2 px toes on the edge; handicap 62.7 and 52.7', () => {
    const row = BOTH.map(([, phys]) => [standingGap(phys, EDGE - 1), standingGap(phys, EDGE - phys.heroW)].map((v) => fixed(px(v), 1)));
    expect(row).toEqual([
      ['68.2', '58.2'],
      ['62.7', '52.7'],
    ]);
  });

  it('a hole 1 tile wide always swallows a walking hero (every alignment, both tunings)', () => {
    expect(BOTH.map(([, phys]) => holeSwallowsWalker(phys))).toEqual([true, true]);
  });

  it('fall: terminal 4 px/f after 10 f; walking off at full speed drifts 12.75, 18.75, 24.75 and 36.75 px while dropping 1, 2, 3 and 5 tiles', () => {
    const rows = [];
    for (let r = 0; r < 24; r++) {
      let line = '';
      for (let c = 0; c < 64; c++) line += c === 0 || c === 63 || r === 0 || (r >= 4 && c < 20) || r === 23 ? '#' : '.';
      rows.push(line);
    }
    put(rows, 3, 2, 'P');
    put(rows, 3, 60, 'T');
    put(rows, 3, 61, 'D');
    const level = levelFromRows(rows);

    const game = playingGame(level, REF);
    const p = game.run.player;
    // From rest 60 px before the edge, RIGHT held: full speed long before the edge.
    p.x = 20 * TILE - 60 * SUB;
    while (p.onGround) step(game, R);
    const y0 = p.y;
    const drifts: number[] = [];
    for (const drop of [1, 2, 3, 5]) {
      while (p.y - y0 < drop * TILE) step(game, R);
      drifts.push(px(p.x - 20 * TILE));
    }
    expect(drifts).toEqual([12.75, 18.75, 24.75, 36.75]);

    const faller = playingGame(level, REF);
    const q = faller.run.player;
    q.x = 30 * TILE;
    q.y = TILE;
    q.onGround = false;
    let ticks = 0;
    while (q.vy < REF.maxFall) {
      step(faller, NONE);
      ticks++;
    }
    expect([px(REF.maxFall), ticks]).toEqual([4, 10]);
  });
});

describe('Part 2, REFERENCE_PHYS: section 13 "Jump timing windows" (worst of every sub-pixel alignment)', () => {
  const TABLE: Readonly<Record<number, string>> = {
    3: '| 3 up | 29 / 21 | 19 / 10 | 8 / - | - | - | - |',
    2: '| 2 up | 35 / 27 | 25 / 16 | 14 / 5 | 1 / - | - | - |',
    1: '| 1 up | 39 / 31 | 29 / 20 | 18 / 9 | 7 / - | - | - |',
    0: '| level | 43 / 35 | 33 / 24 | 22 / 13 | 11 / 2 | - | - |',
    [-1]: '| 1 down | any / any | 37 / 28 | 26 / 17 | 15 / 6 | 5 / - | - |',
    [-2]: '| 2 down | any / any | 41 / 32 | 30 / 21 | 19 / 10 | 9 / - | - |',
    [-3]: '| 3 down | any / any | any / any | 34 / 25 | 23 / 14 | 13 / 2 | - |',
    [-4]: '| 4 down | any / any | any / any | 38 / 29 | 27 / 18 | 17 / 6 | 6 / - |',
  };
  it.each(RISES)('landing %i tiles up (negative: down), gaps of 1 to 6 tiles', (rise) => {
    expect(jumpWindowRow(rise)).toBe(TABLE[rise]);
  }, 30_000);
});

describe('Part 2, REFERENCE_PHYS: section 13 "Hazards and forgiveness" (running jump over a bed on level ground)', () => {
  const bedRow = (bed: 'S' | 'F'): string[] =>
    [1, 2, 3, 4].map((width) => BOTH.map(([, phys]) => cell(jumpWindow(phys, width, 0, bed))).join(' / '));

  it('spike bed: 1 tile 27 / 24, 2 tiles 16 / 13, 3 tiles 6 / 2, 4 tiles impossible', () => {
    expect(bedRow('S')).toEqual(['27 / 24', '16 / 13', '6 / 2', '- / -']);
  }, 30_000);

  it('fire bed: 1 tile 25 / 22, 2 tiles 14 / 11, 3 tiles 4 / impossible', () => {
    expect(bedRow('F')).toEqual(['25 / 22', '14 / 11', '4 / -', '- / -']);
  }, 30_000);
});

describe('Part 2, REFERENCE_PHYS: section 13 small landing pads (worst of every sub-pixel alignment)', () => {
  it.each([
    [2, 1, '| 2-tile gap, pad 1 tile wide | 16 / 17 | 12 / 13 | 8 / 9 |'],
    [2, 2, '| 2-tile gap, pad 2 tiles wide | 27 / 24 | 23 / 24 | 19 / 21 |'],
    [3, 2, '| 3-tile gap, pad 2 tiles wide | 22 / 13 | 22 / 13 | 20 / 13 |'],
    [3, 3, '| 3-tile gap, pad 3 tiles wide | 22 / 13 | 22 / 13 | 22 / 13 |'],
  ] as const)(
    '%i-tile gap, pad %i: let go at once, after 4 f, after 8 f',
    (gap, pad, expected) => {
      const cells = [0, 4, 8].map((react) => BOTH.map(([, phys]) => padWindow(phys, gap, pad, react)).join(' / '));
      expect(`| ${gap}-tile gap, pad ${pad} tile${pad > 1 ? 's' : ''} wide | ${cells.join(' | ')} |`).toBe(expected);
    },
    30_000,
  );
});

describe('Part 2, REFERENCE_PHYS: section 13 "Thruster"', () => {
  it('climb with THRUST held from standing: 136.8 px = 8.55 tiles; handicap 7.68 tiles', () => {
    expect(px(climb(REF, () => T).height)).toBe(136.8125);
    expect(BOTH.map(([, phys]) => fixed(tiles(climb(phys, () => T).height), 2))).toEqual(['8.55', '7.68']);
  });

  it('climb with one thumb (JUMP held 15 f, handicap 14 f, 6 f to move the thumb, THRUST held): 179.0 px = 11.19 tiles; handicap 10.00', () => {
    const shipped = climb(REF, oneThumb, HOLDS);
    const weak = climb(REF_HANDICAP, oneThumb, HOLDS);
    expect([px(shipped.height), shipped.hold, fixed(tiles(shipped.height), 2)]).toEqual([179, 15, '11.19']);
    expect([weak.hold, fixed(tiles(weak.height), 2)]).toEqual([14, '10.00']);
  });

  it('climb with JUMP and THRUST held together (keyboard): 187.3 px = 11.71 tiles, fuel burning from tick 15; handicap 10.52', () => {
    const shipped = climb(REF, () => JT);
    expect([fixed(px(shipped.height), 1), fixed(tiles(shipped.height), 2), shipped.firstBurn]).toEqual(['187.3', '11.71', 15]);
    expect(fixed(tiles(climb(REF_HANDICAP, () => JT).height), 2)).toBe('10.52');
  });

  it(
    'best climb from standing over every thrust pattern, no jump: holding is optimal (8.55 tiles; handicap 7.68)',
    () => {
      for (const [, phys] of BOTH) expect(bestThrustPatternClimb(phys)).toBe(climb(phys, () => T).height);
    },
    30_000,
  );

  it(
    'level flight: THRUST held 11.95 / 10.40 tiles; under a roof 2 tiles up 10.55 / 9.16; THRUST feathered 14.95 / 12.90',
    () => {
      const row = (policy: Policy, headroom: number): string =>
        BOTH.map(([, phys]) => fixed(tiles(flightReach(phys, headroom, policy)), 2)).join(' / ');
      expect([row(thrustHeld, 18), row(thrustHeld, 2), row(thrustFeathered, 18)]).toEqual([
        '11.95 / 10.40',
        '10.55 / 9.16',
        '14.95 / 12.90',
      ]);
    },
    30_000,
  );

  it(
    'level flight, keyboard: JUMP and THRUST held 14.77 / 12.54 tiles; under a roof 8 / 6 / 4 tiles up 13.17 / 11.21, 12.42 / 10.49, 11.67 / 9.87; JUMP held with THRUST feathered 18.70 / 15.93',
    () => {
      const row = (policy: Policy, headroom: number): string =>
        BOTH.map(([, phys]) => fixed(tiles(flightReach(phys, headroom, policy)), 2)).join(' / ');
      expect([row(chordHeld, 18), row(chordHeld, 8), row(chordHeld, 6), row(chordHeld, 4), row(chordFeathered, 18)]).toEqual([
        '14.77 / 12.54',
        '13.17 / 11.21',
        '12.42 / 10.49',
        '11.67 / 9.87',
        '18.70 / 15.93',
      ]);
    },
    30_000,
  );

  it('stopping a terminal-speed fall: the fall stops on the 11th tick of THRUST, 19.375 px lower (19.25 px net on that tick)', () => {
    const level = shaft();
    const game = playingGame(level, REF);
    const p = game.run.player;
    withFullTank(REF)(p);
    p.y = 2 * TILE;
    p.onGround = false;
    while (p.vy < REF.maxFall) step(game, NONE);
    const y0 = p.y;
    let ticks = 0;
    let lowest = 0;
    while (p.vy > 0) {
      step(game, T);
      ticks++;
      lowest = Math.max(lowest, p.y - y0);
    }
    expect([ticks, px(lowest), px(p.y - y0)]).toEqual([11, 19.375, 19.25]);
  });

  it('hover on a full tank, THRUST whenever not rising: 148 f = 2.47 s at 54 % duty; handicap 133 f = 2.22 s', () => {
    const hover = (phys: Phys): number => {
      const game = playingGame(shaft(), phys);
      const p = game.run.player;
      withFullTank(phys)(p);
      p.y -= 10 * TILE;
      p.onGround = false;
      let ticks = 0;
      while (p.fuel > 0 && ticks < 5000) {
        step(game, p.vy >= 0 ? T : NONE);
        ticks++;
      }
      return ticks;
    };
    const [shipped, weak] = BOTH.map(([, phys]) => hover(phys)) as [number, number];
    expect([shipped, fixed(shipped / 60, 2), fixed((REF.fuelTicks / shipped) * 100, 0)]).toEqual([148, '2.47', '54']);
    expect([weak, fixed(weak / 60, 2)]).toEqual([133, '2.22']);
  });

  it.each([
    [7, '| 7 tiles | 82 / 63 | 59 / 44 | 51 / 36 |'],
    [8, '| 8 tiles | 71 / 52 | 48 / 33 | 40 / 25 |'],
    [9, '| 9 tiles | 60 / 41 | 37 / 22 | 29 / 14 |'],
    [10, '| 10 tiles | 50 / 10 | 27 / - | 19 / - |'],
    [11, '| 11 tiles | 39 / - | 16 / - | 8 / - |'],
    [12, '| 12 tiles | - | - | - |'],
  ] as const)(
    'press windows for a level gap of %i tiles with THRUST simply held (open sky, roof 4 and roof 2 tiles above the ledge)',
    (gap, expected) => {
      const frames = (n: number): string => (n === 0 ? '-' : String(n));
      const cells = [16, 4, 2].map((headroom) => {
        const shipped = frames(flightWindow(REF, headroom, gap));
        const weak = frames(flightWindow(REF_HANDICAP, headroom, gap));
        return shipped === '-' && weak === '-' ? '-' : `${shipped} / ${weak}`;
      });
      expect(`| ${gap} tiles | ${cells.join(' | ')} |`).toBe(expected);
    },
    30_000,
  );
});
