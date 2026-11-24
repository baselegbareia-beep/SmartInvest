/**
 * The game loop: the session, the four phases of a level visit, lives, level
 * change, and step(), the one function that advances time
 * (docs/ARCHITECTURE.md, sections 4 and 6).
 *
 * A tick is always the same 17 steps in the same order. This file does steps
 * 1 to 3 (is anything running, count the tick, which phase) and then calls
 * the four stages of a playing tick:
 *
 *   stepPlayer       steps 4 to 11   presses, run, jump, thrust, move
 *   stepEnemies      step 12         patrols
 *   stepBolt         step 13         the blaster
 *   resolveContacts  steps 14 to 17  pickups, cog, airlock, deaths
 *
 * resolveContacts starts the dying and the exiting phase; this file ends them.
 */
import * as boltModule from './bolt';
import * as contactModule from './contact';
import * as enemiesModule from './enemies';
import * as playerModule from './player';
import { createRun, respawnRun } from './run';
import type {
  BoltState,
  CloneGameFn,
  CopyGameFn,
  CreateSessionFn,
  GameEvent,
  GameState,
  HoldReadyFn,
  LevelData,
  PlayerState,
  RestartLevelFn,
  RunState,
  SessionState,
  StartLevelFn,
  StepFn,
} from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { stepBolt } = boltModule;
const { resolveContacts } = contactModule;
const { stepEnemies } = enemiesModule;
const { stepPlayer } = playerModule;

/** The level to load, or a RangeError that says which index was asked for. */
function levelAt(levels: readonly LevelData[], levelIndex: number): LevelData {
  const level = levels[levelIndex];
  if (level === undefined) {
    throw new RangeError(
      levels.length === 0
        ? 'cannot start a level: the list of levels is empty'
        : `cannot start level index ${levelIndex}: the list holds indexes 0 to ${levels.length - 1}`,
    );
  }
  return level;
}

export const createSession: CreateSessionFn = (levels, phys, start, events) => {
  const levelIndex = start?.levelIndex ?? 0;
  const level = levelAt(levels, levelIndex);
  const session: SessionState = {
    status: 'playing',
    levelIndex,
    score: start?.score ?? 0,
    // A resume point comes from storage, where it may have been edited by hand, and parseSave
    // cannot know maxLives. Above it, the next clear would take lives away instead of giving one.
    lives: Math.min(Math.max(start?.lives ?? phys.startLives, 1), phys.maxLives),
    // A level being played is by definition one the player may start.
    highestUnlocked: Math.max(start?.highestUnlocked ?? levelIndex, levelIndex),
  };
  const game: GameState = { phys, levels, level, session, run: createRun(level, phys) };
  events?.push({ type: 'levelStarted', levelIndex, score: session.score, lives: session.lives });
  return game;
};

export const startLevel: StartLevelFn = (game, levelIndex, events) => {
  // Looked up before anything changes, so a bad index leaves the game as it was.
  const level = levelAt(game.levels, levelIndex);
  const session = game.session;
  session.levelIndex = levelIndex;
  session.status = 'playing';
  game.level = level;
  // A brand-new visit: nothing taken, no cog, no items, every enemy unpaid, tick 0.
  game.run = createRun(level, game.phys);
  events?.push({ type: 'levelStarted', levelIndex, score: session.score, lives: session.lives });
};

/**
 * A life is spent, by a death or by "Restart level". With none left the run
 * is over; otherwise the hero goes back to the start of the level, behind the
 * ready gate.
 */
function loseLife(
  game: GameState,
  readyTicks: number,
  reason: 'death' | 'restart',
  events: GameEvent[] | undefined,
): void {
  const session = game.session;
  session.lives -= 1;
  if (session.lives <= 0) {
    session.status = 'gameOver';
    events?.push({ type: 'gameOver', score: session.score });
    return;
  }
  respawnRun(game.run, game.level, game.phys, readyTicks);
  events?.push({ type: 'respawned', lives: session.lives, reason });
}

/** The exiting phase is over: the next level, or the win after the last one. */
function finishExit(game: GameState, events: GameEvent[] | undefined): void {
  const session = game.session;
  if (session.levelIndex < game.levels.length - 1) {
    startLevel(game, session.levelIndex + 1, events);
    return;
  }
  // The life returned for clearing this level is already counted (step 16).
  const lifeBonus = session.lives * game.phys.scoreLifeLeft;
  session.score += lifeBonus;
  session.status = 'won';
  events?.push({ type: 'gameWon', score: session.score, lives: session.lives, lifeBonus });
}

export const step: StepFn = (game, input, events) => {
  // Step 1: a finished run does not move.
  if (game.session.status !== 'playing') return;

  // Step 2.
  const run = game.run;
  run.tick += 1;

  // Step 3: the phase decides whether the world runs on this tick.
  const player = run.player;
  const phase = run.phase;

  if (phase === 'dying' || phase === 'exiting') {
    // Frozen. Jump and fire are still followed, in every phase, so that a
    // button held through the freeze is not taken for a new press afterwards.
    run.phaseTicks += 1;
    player.prevJump = input.jump;
    player.prevFire = input.fire;
    if (run.phaseTicks >= run.phaseLength) {
      // The life is taken now, not at the moment of death; the dying phase is the animation.
      if (phase === 'dying') loseLife(game, game.phys.respawnReadyTicks, 'death', events);
      else finishExit(game, events);
    }
    return;
  }

  if (phase === 'ready') {
    // The gate opens on a press, never on a control that is merely still
    // down: a thumb resting on RIGHT through a death must not walk the hero
    // into the same hazard again. So the gate must first see one tick with
    // nothing held (also during the minimum wait); only then does a held
    // control open it.
    const held = input.left || input.right || input.jump || input.fire || input.thrust;
    if (!held) run.readyArmed = true;

    const waiting = run.phaseTicks < run.phaseLength;
    if (waiting || !(run.readyArmed && held)) {
      if (waiting) run.phaseTicks += 1;
      player.prevJump = input.jump;
      player.prevFire = input.fire;
      return;
    }

    run.phase = 'playing';
    run.phaseTicks = 0;
    run.phaseLength = 0;
    events?.push({ type: 'readyEnded' });
    // No return: the tick that opens the gate is played in full, so the
    // control that opened it acts at once.
  }

  run.phaseTicks += 1;

  // Steps 4 to 17. Enemies and the bolt come before the contacts, so a
  // point-blank bolt destroys an enemy before that enemy can kill.
  stepPlayer(game, input, events);
  stepEnemies(game);
  stepBolt(game, events);
  resolveContacts(game, events);
};

export const restartLevel: RestartLevelFn = (game, events) => {
  const run = game.run;
  if (game.session.status !== 'playing') return;
  if (run.phase !== 'ready' && run.phase !== 'playing') return;

  // Cleared here as well as by the respawn: with the last life gone there is
  // no respawn, and the thrust sound follows this flag.
  if (run.player.thrusting) {
    run.player.thrusting = false;
    events?.push({ type: 'thrustStopped' });
  }
  loseLife(game, game.phys.readyMinTicks, 'restart', events);
};

export const holdReady: HoldReadyFn = (game) => {
  const run = game.run;
  if (run.phase !== 'playing') return;
  // Only the gate shuts. The hero hangs where it was, with its speed, and
  // goes on from there when a control is pressed.
  run.phase = 'ready';
  run.phaseTicks = 0;
  run.phaseLength = game.phys.readyMinTicks;
  run.readyArmed = false;
};

// ---------------------------------------------------------------------------
// Copies. The validator keeps many states and jumps between them: cloneGame
// makes one, copyGame overwrites one without allocating.
// ---------------------------------------------------------------------------

/** Every property is written out, so the compiler refuses a RunState field that is missing here. */
function cloneRun(run: RunState): RunState {
  return {
    tick: run.tick,
    phase: run.phase,
    phaseTicks: run.phaseTicks,
    phaseLength: run.phaseLength,
    readyArmed: run.readyArmed,
    player: { ...run.player },
    enemies: run.enemies.map((enemy) => ({ ...enemy })),
    enemyPaid: run.enemyPaid.slice(),
    bolt: { ...run.bolt },
    taken: run.taken.slice(),
    hasTrophy: run.hasTrophy,
    deathCause: run.deathCause,
  };
}

export const cloneGame: CloneGameFn = (source) => ({
  phys: source.phys,
  levels: source.levels,
  level: source.level,
  session: { ...source.session },
  run: cloneRun(source.run),
});

function copySession(target: SessionState, source: SessionState): void {
  target.status = source.status;
  target.levelIndex = source.levelIndex;
  target.score = source.score;
  target.lives = source.lives;
  target.highestUnlocked = source.highestUnlocked;
}

function copyPlayer(target: PlayerState, source: PlayerState): void {
  target.x = source.x;
  target.y = source.y;
  target.vx = source.vx;
  target.vy = source.vy;
  target.facing = source.facing;
  target.onGround = source.onGround;
  target.coyote = source.coyote;
  target.jumpBuffer = source.jumpBuffer;
  target.fireBuffer = source.fireBuffer;
  target.jumpArc = source.jumpArc;
  target.thrusting = source.thrusting;
  target.hasBlaster = source.hasBlaster;
  target.hasThruster = source.hasThruster;
  target.fuel = source.fuel;
  target.prevJump = source.prevJump;
  target.prevFire = source.prevFire;
}

function copyBolt(target: BoltState, source: BoltState): void {
  target.active = source.active;
  target.x = source.x;
  target.y = source.y;
  target.dir = source.dir;
  target.rangeLeft = source.rangeLeft;
}

function copyFlags(target: boolean[], source: readonly boolean[]): void {
  for (let i = 0; i < source.length; i++) target[i] = source[i] === true;
}

/**
 * The same level on both sides means the same number of enemies and pickups
 * in the same order, so everything can be copied in place, slot by slot.
 */
function copyRun(target: RunState, source: RunState): void {
  target.tick = source.tick;
  target.phase = source.phase;
  target.phaseTicks = source.phaseTicks;
  target.phaseLength = source.phaseLength;
  target.readyArmed = source.readyArmed;
  copyPlayer(target.player, source.player);

  const enemies = source.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const from = enemies[i];
    const to = target.enemies[i];
    if (from === undefined || to === undefined) continue;
    // kind and axis belong to the level, which both sides share.
    to.x = from.x;
    to.y = from.y;
    to.dir = from.dir;
    to.alive = from.alive;
  }
  copyFlags(target.enemyPaid, source.enemyPaid);
  copyBolt(target.bolt, source.bolt);
  copyFlags(target.taken, source.taken);
  target.hasTrophy = source.hasTrophy;
  target.deathCause = source.deathCause;
}

export const copyGame: CopyGameFn = (target, source) => {
  copySession(target.session, source.session);
  if (target.level === source.level) {
    copyRun(target.run, source.run);
    return;
  }
  // Outside the contract (the two are on different levels, so their arrays
  // do not line up): still end with an exact copy, at the price of new objects.
  target.level = source.level;
  target.run = cloneRun(source.run);
};
