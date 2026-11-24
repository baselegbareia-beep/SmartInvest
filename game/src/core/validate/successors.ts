/**
 * The manoeuvre generator of the level validator (docs/ARCHITECTURE.md,
 * sections 9.1 to 9.3), and the machinery every stage shares: the counted
 * step(), a pool of game states, the state keys and the input runs of a
 * manoeuvre.
 *
 * Every state the search holds is made by the real step() from the search's
 * root. The search never models the rules; it only decides which buttons to
 * hold for how long, and drops a state whose phase became 'dying'. A
 * validator bug can therefore only reject a good level, never accept an
 * impossible one: the script it returns is replayed through step() again.
 *
 * Speed matters here: a proof is millions of step() calls. So the core's
 * functions are bound to local constants (under Vitest every call through an
 * import is a getter call, which made step() about three times slower), and
 * no GameState is allocated per manoeuvre: the generator works in a few
 * scratch states and hands each result to `emit`, which copies the ones it
 * keeps into states taken from a pool.
 */
import * as gameModule from '../game';
import * as levelModule from '../level';
import * as scriptModule from '../script';
import * as units from '../types';
import type { GameState, LevelData, Phys, ValidateOptions } from '../types';
import { MAX_AIR_TICKS } from './options';

const { cloneGame, copyGame, createSession, step } = gameModule;
const { parseLevel } = levelModule;
const { inputFromBits } = scriptModule;
const { InputBit, SUB, TILE, TILE_SHIFT } = units;

const LEFT = InputBit.Left;
const RIGHT = InputBit.Right;
const JUMP = InputBit.Jump;
const FIRE = InputBit.Fire;
const THRUST = InputBit.Thrust;

/** The three directions of every manoeuvre: none, left, right. */
const DIRECTIONS = Object.freeze([0, LEFT, RIGHT]);

/** How a jump manoeuvre holds the jump button: not at all (a fall), the whole arc, or the first tapTicks ticks. */
const NO_JUMP = 0;
const FULL_JUMP = 1;
const TAP_JUMP = 2;
type JumpHold = typeof NO_JUMP | typeof FULL_JUMP | typeof TAP_JUMP;

/** The phase that ends a manoeuvre: a death drops the branch, an exit is the win. */
export const isDead = (game: GameState): boolean => game.run.phase === 'dying';
export const isWon = (game: GameState): boolean => game.run.phase === 'exiting';
const isOver = (game: GameState): boolean => game.run.phase === 'dying' || game.run.phase === 'exiting';
/** Fuel the hero can use now. */
const fuelOf = (game: GameState): number => (game.run.player.hasThruster ? game.run.player.fuel : 0);

/**
 * Idle ticks before the first manoeuvre: the ready gate's minimum, and never
 * fewer than one. The gate opens only on a control pressed after a tick with
 * nothing held (section 6); with readyMinFrames 0 (compileTuning allows it)
 * a root without that idle tick would never leave the ready phase, and every
 * level would come back 'no-route'.
 */
export const readyTicks = (phys: Phys): number => Math.max(1, phys.readyMinTicks);

/**
 * A room 10 tiles wide and 14 high, open above the start: room for the
 * highest plain jump any tuning gives, with the cog and the airlock out of
 * the way of a hero that only jumps straight up.
 */
const CLIMB_ROOM = Object.freeze([
  '############',
  ...Array.from({ length: 14 }, () => '#..........#'),
  '#P.......TD#',
  '############',
]);
/** Longest jump followed in the climb room, in ticks: a guard, gravity ends every jump long before. */
const CLIMB_TICKS = 400;

// ---------------------------------------------------------------------------
// The counted step() and the pool of states
// ---------------------------------------------------------------------------

/**
 * One level, one tuning, one set of options: the step() that counts its
 * calls, and a pool of spare GameStates of this level (all share the same
 * LevelData object, so copyGame copies in place without allocating).
 */
export class Sim {
  readonly level: LevelData;
  readonly phys: Phys;
  readonly options: ValidateOptions;
  /** step() calls so far, by every stage of this validateLevel call. */
  stepCalls = 0;
  private readonly spare: GameState[] = [];

  constructor(level: LevelData, phys: Phys, options: ValidateOptions) {
    this.level = level;
    this.phys = phys;
    this.options = options;
  }

  /** One tick with the buttons of `bits` held. */
  advance(game: GameState, bits: number): void {
    this.stepCalls += 1;
    step(game, inputFromBits(bits));
  }

  /** A state of this level with the contents of `source`: from the pool when it has one. */
  copyOf(source: GameState): GameState {
    const game = this.spare.pop();
    if (game === undefined) return cloneGame(source);
    copyGame(game, source);
    return game;
  }

  /** Gives a state back to the pool. The caller must not touch it afterwards. */
  recycle(game: GameState): void {
    this.spare.push(game);
  }

  /**
   * The search root (section 9.1): a fresh one-level session stepped
   * readyTicks(phys) times with nothing held. Those idle ticks are the ready
   * gate's minimum and arm it, so the first control any manoeuvre holds
   * opens the gate and acts on the same tick. With `enemiesOff` every enemy
   * is dead from the start: the enemy-free map.
   */
  root(enemiesOff: boolean): GameState {
    const game = createSession([this.level], this.phys);
    const idle = readyTicks(this.phys);
    for (let i = 0; i < idle; i++) this.advance(game, 0);
    if (enemiesOff) {
      for (const enemy of game.run.enemies) enemy.alive = false;
    }
    return game;
  }

  /**
   * How many tiles a plain jump climbs on this tuning, for the flood
   * estimate (section 9.4): the highest point of the hero's box over its
   * take-off, with jump held from standing in an open room, plus the ledge
   * catch, rounded up to whole tiles. Measured with the real step() (and
   * counted, like every call of the proof), so it follows any tuning.
   */
  climbTiles(): number {
    const game = createSession([parseLevel(CLIMB_ROOM.join('\n'), 'climb-room')], this.phys);
    const idle = readyTicks(this.phys);
    for (let i = 0; i < idle; i++) this.advance(game, 0);
    const player = game.run.player;
    const startY = player.y;
    let topY = startY;
    for (let t = 0; t < CLIMB_TICKS; t++) {
      this.advance(game, JUMP);
      topY = Math.min(topY, player.y);
      if (player.onGround && t > 0) break;
    }
    // Rounded up: an estimate that allows a little too much climbing only searches a little more.
    return Math.trunc((startY - topY + this.phys.ledgeCatch + TILE - 1) / TILE);
  }
}

// ---------------------------------------------------------------------------
// Input runs of one manoeuvre
// ---------------------------------------------------------------------------

/** More than any manoeuvre needs: a release tick, a hold, a jump and its tap, one change of direction. */
const RUN_CAPACITY = 16;

/**
 * The input of the manoeuvre being built, as run-length pairs (held bits,
 * ticks), with the total in ticks. The generator writes it; `emit` reads it
 * and copies it when it keeps the state.
 */
export class RunBuffer {
  readonly bits = new Int32Array(RUN_CAPACITY);
  readonly ticks = new Int32Array(RUN_CAPACITY);
  length = 0;
  total = 0;

  clear(): void {
    this.length = 0;
    this.total = 0;
  }

  /** `n` more ticks of `bits`, joined to the last run when it holds the same bits. */
  add(bits: number, n: number): void {
    if (n <= 0) return;
    const last = this.length - 1;
    if (last >= 0 && this.bits[last] === bits) {
      this.ticks[last] = (this.ticks[last] ?? 0) + n;
    } else {
      if (this.length >= RUN_CAPACITY) throw new Error('validator: a manoeuvre needs more input runs than RunBuffer holds');
      this.bits[this.length] = bits;
      this.ticks[this.length] = n;
      this.length += 1;
    }
    this.total += n;
  }

  /** Ticks of the last run (0 when empty): with length and total, all a restore needs. */
  lastTicks(): number {
    return this.length > 0 ? (this.ticks[this.length - 1] ?? 0) : 0;
  }

  /** Back to an earlier point of the same manoeuvre: the runs before it were never rewritten, only the last one grew. */
  restore(length: number, lastTicks: number, total: number): void {
    this.length = length;
    this.total = total;
    if (length > 0) this.ticks[length - 1] = lastTicks;
  }
}

// ---------------------------------------------------------------------------
// State keys (section 9.3) and the merge rule (section 9.2)
// ---------------------------------------------------------------------------

/** Ground vx buckets: stopped, part speed right, full right, part left, full left. */
const GROUND_VX_BUCKETS = 5;
/** Flight vx buckets: the sign. */
const FLIGHT_VX_BUCKETS = 3;

/**
 * Keys under which states are merged: one representative stands for each
 * key. A key is a whole number below 2^53, exact, so two different keys
 * never collide.
 *
 * Hero part (`hero`): kind (ground or flight); on the ground the x bucket of
 * groundBucketPx, the row and the signed vx bucket; in flight the square cell
 * of flightCellPx and the sign of vx; then hasTrophy and which thruster packs
 * are taken. The enemy-free map uses the hero part alone.
 *
 * The search with enemies (`full`) adds hasBlaster, facing while armed, the
 * mask of live enemies, and for each live enemy within enemyKeyRadiusTiles
 * its position in enemyBucketPx buckets along its axis and its direction.
 * Far enemies are not in the key, so the search can wait beside an enemy but
 * cannot stall anywhere else. Crystals are never in a key.
 */
export class StateKeys {
  private readonly groundQ: number;
  private readonly flightQ: number;
  private readonly runMax: number;
  private readonly groundRows: number;
  private readonly flightRows: number;
  private readonly groundPlaces: number;
  private readonly packIndex: Int32Array;
  private readonly maskCount: number;
  /** How many hero keys there are: the multiplier of the world part of a full key. */
  private readonly heroKeys: number;
  private readonly nearDistance: number;
  private readonly enemyQ: number;
  private readonly maxRise: number;
  private readonly thrustAccel: number;
  /** World parts seen so far, numbered in the order they were met: deterministic. */
  private readonly plainWorlds = new Map<number, number>();
  private readonly nearWorlds = new Map<string, number>();
  private worldCount = 0;

  constructor(level: LevelData, phys: Phys, options: ValidateOptions) {
    this.groundQ = options.groundBucketPx * SUB;
    this.flightQ = options.flightCellPx * SUB;
    this.runMax = phys.runMax;
    const widthSub = level.width * TILE;
    const heightSub = level.height * TILE;
    // One spare row and column: a key field never reaches past its count.
    this.groundRows = level.height + 1;
    this.flightRows = Math.trunc(heightSub / this.flightQ) + 2;
    const groundCols = Math.trunc(widthSub / this.groundQ) + 2;
    const flightCols = Math.trunc(widthSub / this.flightQ) + 2;
    this.groundPlaces = groundCols * this.groundRows * GROUND_VX_BUCKETS;
    const places = this.groundPlaces + flightCols * this.flightRows * FLIGHT_VX_BUCKETS;
    const packs: number[] = [];
    level.pickups.forEach((pickup, index) => {
      if (pickup.kind === 'thruster') packs.push(index);
    });
    this.packIndex = Int32Array.from(packs);
    let maskCount = 1;
    for (let i = 0; i < packs.length; i++) maskCount *= 2;
    this.maskCount = maskCount;
    this.heroKeys = places * 2 * maskCount;
    this.nearDistance = options.enemyKeyRadiusTiles * TILE;
    this.enemyQ = options.enemyBucketPx * SUB;
    this.maxRise = phys.thrustMaxRise;
    this.thrustAccel = phys.thrustAccel;
    // The world part multiplies the hero part; with 2^53 exact, about a million worlds fit even at the caps.
    if (this.heroKeys > 0x7fffffff) {
      throw new RangeError(`validator: ${level.width}x${level.height} with ${packs.length} packs needs ${this.heroKeys} hero keys; too many for an exact key`);
    }
  }

  /** The hero part of the key: all the enemy-free map merges on. */
  hero(game: GameState): number {
    const run = game.run;
    const player = run.player;
    const vx = player.vx;
    let place: number;
    if (player.onGround) {
      const max = this.runMax;
      const v = vx === 0 ? 0 : vx > 0 ? (vx >= max ? 2 : 1) : vx <= -max ? 4 : 3;
      const row = Math.min(player.y >> TILE_SHIFT, this.groundRows - 1);
      place = (Math.trunc(player.x / this.groundQ) * this.groundRows + row) * GROUND_VX_BUCKETS + v;
    } else {
      const v = vx === 0 ? 0 : vx > 0 ? 1 : 2;
      const row = Math.min(Math.max(Math.trunc(player.y / this.flightQ), 0), this.flightRows - 1);
      place = this.groundPlaces + (Math.trunc(player.x / this.flightQ) * this.flightRows + row) * FLIGHT_VX_BUCKETS + v;
    }
    let mask = 0;
    const packs = this.packIndex;
    const taken = run.taken;
    for (let j = 0; j < packs.length; j++) {
      if (taken[packs[j] ?? 0] === true) mask |= 1 << j;
    }
    return (place * 2 + (run.hasTrophy ? 1 : 0)) * this.maskCount + mask;
  }

  /** The full key of the search with enemies. */
  full(game: GameState): number {
    const run = game.run;
    const player = run.player;
    const armed = player.hasBlaster ? (player.facing > 0 ? 2 : 1) : 0;
    const enemies = run.enemies;
    const near = this.nearDistance;
    const q = this.enemyQ;
    let alive = 0;
    let close = '';
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      // Doubling, not a shift: exact for any number of enemies below 53.
      alive *= 2;
      if (enemy === undefined || !enemy.alive) continue;
      alive += 1;
      if (Math.abs(enemy.x - player.x) < near && Math.abs(enemy.y - player.y) < near) {
        const along = enemy.kind === 'moth' && enemy.axis === 'v' ? enemy.y : enemy.x;
        close += `${i}:${Math.floor(along / q)}${enemy.dir > 0 ? '+' : '-'} `;
      }
    }
    const code = alive * 3 + armed;
    let world: number | undefined;
    if (close === '') {
      world = this.plainWorlds.get(code);
      if (world === undefined) {
        world = this.worldCount++;
        this.plainWorlds.set(code, world);
      }
    } else {
      const text = `${code} ${close}`;
      world = this.nearWorlds.get(text);
      if (world === undefined) {
        world = this.worldCount++;
        this.nearWorlds.set(text, world);
      }
    }
    return world * this.heroKeys + this.hero(game);
  }

  /**
   * Effective fuel, the merge order of section 9.2: of two states with one
   * key, the one with more wins. On the ground the fuel. In flight the fuel,
   * less the ticks of thrust needed to turn the present speed into the
   * fastest climb, plus the ticks of climb the state is ahead by inside its
   * cell (integer division, as the contract writes it).
   */
  potential(game: GameState): number {
    const player = game.run.player;
    const fuel = player.hasThruster ? player.fuel : 0;
    if (player.onGround) return fuel;
    const q = this.flightQ;
    const belowInCell = (Math.trunc(player.y / q) + 1) * q - player.y;
    const toClimb = Math.max(0, Math.trunc((player.vy + this.maxRise) / this.thrustAccel));
    return fuel - toClimb + Math.trunc(belowInCell / this.maxRise);
  }
}

// ---------------------------------------------------------------------------
// Manoeuvres (section 9.2)
// ---------------------------------------------------------------------------

/**
 * Receives one result of a manoeuvre: a ground state, a flight state or a
 * win, with the runs that led to it from the expanded state. `state` is a
 * scratch state of the generator: copy it (Sim.copyOf) to keep it.
 */
export type Emit = (state: GameState, runs: RunBuffer) => void;

/**
 * Expands a stored state into its successors.
 *
 * Ground state: hold none / left / right for K = decisionTicks ticks; the 42
 * jump arcs (full hold or a tapTicks tap, times three directions, times at
 * most one change of direction at an arc tick of airSwitchTicks); with fuel,
 * thrust lift-off in three directions; with the blaster (search with enemies
 * only), one shot at a live enemy ahead.
 *
 * Flight state (airborne with fuel): thrust or coast, each in three
 * directions, for K ticks.
 *
 * An input that leaves the state's key unchanged is held for up to
 * maxHoldDecisions x K ticks. Ballistic flight (airborne, no usable fuel) is
 * never stored: it is followed tick by tick to its landing, death or win.
 */
export class Expander {
  private readonly sim: Sim;
  private readonly keyOf: (game: GameState) => number;
  private readonly allowFire: boolean;
  private readonly runs = new RunBuffer();
  // Scratch states, one per role, so no manoeuvre allocates.
  private readonly holdState: GameState;
  private readonly jumpBase: GameState;
  private readonly arcState: GameState;
  private readonly branchState: GameState;
  private readonly snaps: GameState[];
  private readonly snapTick: Int32Array;
  private readonly snapLength: Int32Array;
  private readonly snapLast: Int32Array;
  private readonly snapTotal: Int32Array;
  private readonly switchAt: Uint8Array;
  private readonly fireCap: number;
  private readonly fireReach: number;

  constructor(sim: Sim, template: GameState, keyOf: (game: GameState) => number, allowFire: boolean) {
    this.sim = sim;
    this.keyOf = keyOf;
    this.allowFire = allowFire;
    this.holdState = cloneGame(template);
    this.jumpBase = cloneGame(template);
    this.arcState = cloneGame(template);
    this.branchState = cloneGame(template);
    const switches = sim.options.airSwitchTicks;
    this.snaps = switches.map(() => cloneGame(template));
    this.snapTick = new Int32Array(switches.length);
    this.snapLength = new Int32Array(switches.length);
    this.snapLast = new Int32Array(switches.length);
    this.snapTotal = new Int32Array(switches.length);
    // A lookup by arc tick instead of a search through the list on every tick.
    this.switchAt = new Uint8Array(MAX_AIR_TICKS + 1);
    for (const tick of switches) {
      if (tick <= MAX_AIR_TICKS) this.switchAt[tick] = 1;
    }
    const phys = sim.phys;
    // A bolt lives at most range / speed ticks (rounded up), plus the spawn tick.
    this.fireCap = Math.trunc((phys.boltRange + phys.boltSpeed - 1) / phys.boltSpeed) + 2;
    this.fireReach = phys.boltRange + 2 * TILE;
  }

  expand(state: GameState, emit: Emit): void {
    const sim = this.sim;
    const runs = this.runs;
    const parentKey = this.keyOf(state);
    const player = state.run.player;

    if (!player.onGround) {
      // Flight: thrust or coast, three directions each.
      for (const dir of DIRECTIONS) {
        this.holdAndSettle(state, dir | THRUST, dir, parentKey, emit);
        this.holdAndSettle(state, dir, dir, parentKey, emit);
      }
      return;
    }

    // Ground: walk or stand, and walking off an edge falls as a ballistic arc.
    for (const dir of DIRECTIONS) {
      runs.clear();
      const after = this.hold(state, dir, parentKey);
      if (isDead(after)) continue;
      if (isWon(after) || after.run.player.onGround) {
        emit(after, runs);
      } else {
        // Walked off with fuel: a flight state, and also the plain fall.
        if (fuelOf(after) > 0) emit(after, runs);
        this.arc(after, dir, NO_JUMP, false, emit);
      }
    }

    // Jumps. A jump needs a press: after a landing with jump still held, let go for one tick first.
    runs.clear();
    let base: GameState | null = state;
    if (player.prevJump) {
      base = this.jumpBase;
      copyGame(base, state);
      sim.advance(base, 0);
      runs.add(0, 1);
      if (isOver(base) || !base.run.player.onGround) base = null;
    }
    if (base !== null) {
      for (const dir of DIRECTIONS) {
        this.arc(base, dir, FULL_JUMP, true, emit);
        this.arc(base, dir, TAP_JUMP, false, emit);
      }
    }

    // Thrust lift-off.
    if (fuelOf(state) > 0) {
      for (const dir of DIRECTIONS) this.holdAndSettle(state, dir | THRUST, dir, parentKey, emit);
    }

    // One shot, standing, at the first live enemy ahead within reach.
    if (this.allowFire && player.hasBlaster && !state.run.bolt.active) this.fire(state, emit);
  }

  /**
   * Holds `bits` from `from` for K ticks, and K more while the key stays
   * that of the parent, up to maxHoldDecisions times K. Stops early at a
   * death, a win, or on leaving the ground with no fuel (the rest is a
   * ballistic arc, which the caller follows). The result is in holdState,
   * its input added to the run buffer.
   */
  private hold(from: GameState, bits: number, parentKey: number): GameState {
    const sim = this.sim;
    const options = sim.options;
    const k = options.decisionTicks;
    const game = this.holdState;
    copyGame(game, from);
    let n = 0;
    let falling = false;
    for (let chunk = 0; chunk < options.maxHoldDecisions; chunk++) {
      for (let i = 0; i < k; i++) {
        sim.advance(game, bits);
        n += 1;
        if (isOver(game)) break;
        if (!game.run.player.onGround && fuelOf(game) === 0) {
          falling = true;
          break;
        }
      }
      if (falling || isOver(game) || this.keyOf(game) !== parentKey) break;
    }
    this.runs.add(bits, n);
    return game;
  }

  /** A thrust or coast hold, then, if it ran dry in the air, the fall to its end. */
  private holdAndSettle(from: GameState, bits: number, dir: number, parentKey: number, emit: Emit): void {
    this.runs.clear();
    const after = this.hold(from, bits, parentKey);
    if (isDead(after)) return;
    if (isWon(after) || after.run.player.onGround || fuelOf(after) > 0) {
      emit(after, this.runs);
      return;
    }
    this.arc(after, dir, NO_JUMP, false, emit);
  }

  /**
   * One atomic jump or fall, simulated tick by tick until it lands, dies or
   * wins, with direction `dir`; and the same arc changed once to each other
   * direction at every arc tick of airSwitchTicks. With `apexHandOff` and
   * fuel left, the arc also hands off a flight state at its apex (jump, then
   * thrust, is the fuel-optimal climb). The run buffer is left as it was
   * found.
   */
  private arc(from: GameState, dir: number, jump: JumpHold, apexHandOff: boolean, emit: Emit): void {
    const sim = this.sim;
    const runs = this.runs;
    const tap = sim.options.tapTicks;
    const length0 = runs.length;
    const last0 = runs.lastTicks();
    const total0 = runs.total;
    const game = this.arcState;
    copyGame(game, from);

    let snapCount = 0;
    let apexDone = !apexHandOff;
    let t = 0;
    for (;;) {
      if (t >= MAX_AIR_TICKS) break;
      const bits = dir | (jump === FULL_JUMP || (jump === TAP_JUMP && t < tap) ? JUMP : 0);
      sim.advance(game, bits);
      runs.add(bits, 1);
      t += 1;
      if (isOver(game) || game.run.player.onGround) break;
      if (this.switchAt[t] === 1) {
        const snap = this.snaps[snapCount];
        if (snap !== undefined) {
          copyGame(snap, game);
          this.snapTick[snapCount] = t;
          this.snapLength[snapCount] = runs.length;
          this.snapLast[snapCount] = runs.lastTicks();
          this.snapTotal[snapCount] = runs.total;
          snapCount += 1;
        }
      }
      if (!apexDone && game.run.player.vy >= 0 && fuelOf(game) > 0) {
        apexDone = true;
        emit(game, runs);
      }
    }
    if (!isDead(game) && t < MAX_AIR_TICKS) emit(game, runs);

    // The same arc, turned once.
    const branch = this.branchState;
    for (let s = 0; s < snapCount; s++) {
      const snap = this.snaps[s];
      if (snap === undefined) continue;
      for (const dir2 of DIRECTIONS) {
        if (dir2 === dir) continue;
        copyGame(branch, snap);
        runs.restore(this.snapLength[s] ?? 0, this.snapLast[s] ?? 0, this.snapTotal[s] ?? 0);
        let tt = this.snapTick[s] ?? 0;
        while (tt < MAX_AIR_TICKS) {
          const bits = dir2 | (jump === FULL_JUMP || (jump === TAP_JUMP && tt < tap) ? JUMP : 0);
          sim.advance(branch, bits);
          runs.add(bits, 1);
          tt += 1;
          if (isOver(branch) || branch.run.player.onGround) break;
        }
        if (!isDead(branch) && tt < MAX_AIR_TICKS) emit(branch, runs);
      }
    }
    runs.restore(length0, last0, total0);
  }

  /**
   * Fire, standing, at the first live enemy ahead within the bolt's reach
   * (plus two tiles, as it may walk into it) and within two tiles of height;
   * then wait with nothing held until the bolt is gone, so no stored state
   * has a bolt in flight. The search never fires in the air.
   */
  private fire(state: GameState, emit: Emit): void {
    const sim = this.sim;
    const player = state.run.player;
    for (const enemy of state.run.enemies) {
      if (!enemy.alive) continue;
      const ahead = (enemy.x - player.x) * player.facing;
      if (ahead <= 0 || ahead >= this.fireReach || Math.abs(enemy.y - player.y) >= 2 * TILE) continue;
      const runs = this.runs;
      runs.clear();
      const game = this.holdState;
      copyGame(game, state);
      sim.advance(game, FIRE);
      runs.add(FIRE, 1);
      let n = 0;
      while (game.run.bolt.active && !isOver(game) && n < this.fireCap) {
        sim.advance(game, 0);
        n += 1;
      }
      runs.add(0, n);
      if (!isDead(game)) emit(game, runs);
      return;
    }
  }
}
