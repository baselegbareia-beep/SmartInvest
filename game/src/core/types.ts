/**
 * THE CORE CONTRACT.
 *
 * Every type and unit constant of the simulation lives in this file, and no
 * logic. The modules of src/core implement the function signatures at the end
 * of this file exactly; the shell (Phaser), the validator and the tests are
 * written against them. docs/ARCHITECTURE.md is the companion text: it gives
 * the step order, the collision rules and the state machine in full. Where
 * this file and that document disagree, that is a bug: fix both.
 *
 * Units used by every state field and every Phys field:
 * - positions and sizes: sub-pixels, 256 per art pixel (SUB), integers
 * - velocities: sub-pixels per tick, integers; +x is right, +y is DOWN
 * - time: ticks; one tick is one call of step(), 1/60 s (TICK_HZ)
 * - cells: whole tiles, 0-based, col counted from the left, row from the top
 *
 * Simulation state holds integers and booleans only. Floats exist in exactly
 * two places: src/tuning.ts (owner-facing px and frames) and compileTuning,
 * which rounds them to integers once.
 */

// ---------------------------------------------------------------------------
// Unit constants
// ---------------------------------------------------------------------------

/** Simulation ticks per second. Every "frame" in src/tuning.ts is one tick. */
export const TICK_HZ = 60;

/** log2 of SUB. An art-pixel coordinate is `subPixels >> SUB_SHIFT`. */
export const SUB_SHIFT = 8;
/** Sub-pixel units per art pixel. */
export const SUB = 256;

/** Tile edge in art pixels. */
export const TILE_PX = 16;
/** log2 of TILE. The tile index of a sub-pixel coordinate is `v >> TILE_SHIFT` (also correct for negatives). */
export const TILE_SHIFT = 12;
/** Tile edge in sub-pixels (16 px * 256). */
export const TILE = 4096;

/**
 * Every enemy's body is exactly one tile square (the 16 px sprite). Bolts are
 * tested against this body; the hero is tested against it shrunk by
 * Phys.enemyTouchInset on all four sides.
 */
export const ENEMY_SIZE = TILE;

/** Level size and content caps enforced by parseLevel (ruling R9). */
export const LEVEL_MAX_WIDTH = 64;
export const LEVEL_MAX_HEIGHT = 24;
export const LEVEL_MAX_ENEMIES = 16;
export const LEVEL_MAX_THRUSTERS = 4;

/** Every character allowed in a level grid, in the order the parser lists them in its error message. */
export const LEVEL_CHARS = '#.PTDGFWSBJCMH';

// ---------------------------------------------------------------------------
// Tuning: the owner-facing numbers (src/tuning.ts exports the one value)
// ---------------------------------------------------------------------------

/**
 * The owner-facing feel numbers, in art pixels (px), pixels per frame (px/f),
 * pixels per frame squared (px/f2) and frames at 60 Hz. Decimals are fine:
 * compileTuning rounds every px value to the nearest 1/256 px.
 *
 * The groups hero..score are read by the core through compileTuning. The
 * groups camera, view, touch, effects and pacing are read by the shell only
 * and are ignored by compileTuning.
 */
export interface Tuning {
  readonly hero: HeroTuning;
  readonly run: RunTuning;
  readonly jump: JumpTuning;
  readonly gravity: GravityTuning;
  readonly forgiveness: ForgivenessTuning;
  readonly thruster: ThrusterTuning;
  readonly blaster: BlasterTuning;
  readonly enemies: EnemyTuning;
  readonly timing: TimingTuning;
  readonly lives: LivesTuning;
  readonly score: ScoreTuning;
  readonly camera: CameraTuning;
  readonly view: ViewTuning;
  readonly touch: TouchTuning;
  readonly effects: EffectsTuning;
  readonly pacing: PacingTuning;
}

/** The hero's collision box. The 16 px sprite is drawn centred on it horizontally with the feet flush. */
export interface HeroTuning {
  /** Collision box width, px. Must be a whole number of pixels, at most 16 and of the same parity as 16 (so it centres in a tile). */
  readonly heroHitboxW: number;
  /** Collision box height, px. At most 16. */
  readonly heroHitboxH: number;
}

/** Horizontal movement. Speeds in px/f, accelerations in px/f2. */
export interface RunTuning {
  readonly runMaxSpeed: number;
  /** Speeding up on the ground, from rest or in the current direction. */
  readonly groundAccel: number;
  /** Slowing down on the ground with no direction held. */
  readonly groundDecel: number;
  /** Slowing down on the ground while the opposite direction is held. */
  readonly groundTurnAccel: number;
  readonly airAccel: number;
  readonly airDecel: number;
  readonly airTurnAccel: number;
}

export interface JumpTuning {
  /** Upward launch speed, px/f. */
  readonly jumpVelocity: number;
  /** Upward speed kept when jump is released early, px/f (variable jump height). */
  readonly jumpCutVelocity: number;
}

export interface GravityTuning {
  /** Gravity while rising inside a jump arc with jump held, px/f2. */
  readonly gravityRise: number;
  /** Gravity in every other case, px/f2. */
  readonly gravityFall: number;
  /** Inside a jump arc with jump held, gravity is scaled while |vy| is below this speed, px/f. */
  readonly apexHangSpeed: number;
  /** The scale applied to gravity during the apex hang (1 switches the hang off). */
  readonly apexHangScale: number;
  /** Terminal fall speed, px/f. */
  readonly maxFallSpeed: number;
}

/** Aids that forgive imprecise thumbs. Frames are ticks; Px are art pixels. */
export interface ForgivenessTuning {
  /** A jump may still start this many ticks after walking off a ledge. */
  readonly coyoteFrames: number;
  /** A jump press is remembered for this many further ticks. */
  readonly jumpBufferFrames: number;
  /** A rising hero whose head clips a ceiling corner by at most this much is shifted sideways and keeps rising. */
  readonly cornerNudgePx: number;
  /** A falling hero blocked sideways by a ledge whose top is at most this far above the feet is lifted onto it. */
  readonly ledgeCatchPx: number;
  /** The hurt box (used for hazards and enemies only) is the collision box shrunk by these amounts. */
  readonly hurtInsetSidePx: number;
  readonly hurtInsetTopPx: number;
  readonly hurtInsetBottomPx: number;
  /** Spikes kill box: the cell shrunk by this on the left and right, with this much removed from the top. */
  readonly spikeInsetSidePx: number;
  readonly spikeInsetTopPx: number;
  /** Furnace fire kill box, same scheme. */
  readonly fireInsetSidePx: number;
  readonly fireInsetTopPx: number;
  /** Coolant kill box: full cell width, with this much removed from the top. */
  readonly coolantInsetTopPx: number;
  /** The enemy touch box is the one-tile enemy body shrunk by this on all four sides. */
  readonly enemyTouchInsetPx: number;
  /** A pickup's (and the trophy's) box is its cell grown by this on all four sides. */
  readonly pickupOutsetPx: number;
  /** The door box is its cell shrunk by this on the left and right. */
  readonly doorInsetSidePx: number;
}

export interface ThrusterTuning {
  /** Upward acceleration while thrusting, px/f2. Gravity is off while thrusting. */
  readonly jetAccel: number;
  /** Fastest climb under thrust, px/f. While rising faster than this the engine idles and burns nothing. */
  readonly jetMaxRiseSpeed: number;
  /** Upward speed kept when thrust stops, px/f. */
  readonly jetCutSpeed: number;
  /** Tank size: ticks of thrust in a full tank. */
  readonly jetFuelFrames: number;
}

export interface BlasterTuning {
  /** Bolt speed, px/f. */
  readonly boltSpeed: number;
  /** Distance a bolt flies before it fizzles, px. */
  readonly boltRangePx: number;
  /** Bolt hit box, px. */
  readonly boltHitboxW: number;
  readonly boltHitboxH: number;
  /** A fire press is remembered for this many further ticks (so a press just before the old bolt dies still fires). */
  readonly fireBufferFrames: number;
}

export interface EnemyTuning {
  /** Cinderpeg walking speed, px/f. */
  readonly cinderpegSpeed: number;
  /** Arc Moth flying speed, px/f. */
  readonly mothSpeed: number;
}

/** Lengths, in ticks, of the frozen stages around a death, a respawn and a level clear. */
export interface TimingTuning {
  /** World frozen, hero flashes. */
  readonly hitStopFrames: number;
  /** Break-apart animation, world frozen. */
  readonly deathAnimFrames: number;
  /** Length of the fade out after the animation, and again of the fade in after the respawn. */
  readonly fadeFrames: number;
  /** Shortest time the ready gate stays shut. After it, the next control that is pressed opens the gate. */
  readonly readyMinFrames: number;
  /** World frozen with the hero inside the airlock before the next level loads. */
  readonly exitFrames: number;
}

export interface LivesTuning {
  /** Lives at the start of a run (new game, or Continue after a game over). */
  readonly startLives: number;
  /** Lives never rise above this. */
  readonly maxLives: number;
  /** Lives returned on every level clear. */
  readonly livesPerLevelClear: number;
}

export interface ScoreTuning {
  readonly crystal: number;
  readonly cog: number;
  readonly cinderpeg: number;
  readonly arcMoth: number;
  readonly levelClear: number;
  /** Paid for each life left when the last level is cleared. */
  readonly lifeLeft: number;
}

/** Shell only. Numbers for the pure stepCamera helper (ruling R12). Px are art pixels. */
export interface CameraTuning {
  /** The hero sits this far behind the view centre, on the side opposite to travel. */
  readonly camLookAheadPx: number;
  /** How fast the look-ahead slides to the other side after a turn, px/f, only while the hero moves. */
  readonly camLookShiftSpeed: number;
  /** Half width of the horizontal dead zone around the anchor. */
  readonly camDeadzoneHalfW: number;
  /** Where the feet line rests while grounded, as a fraction of the view height from the top. */
  readonly camAnchorY: number;
  /** Fraction of the remaining vertical distance covered per tick while grounded. */
  readonly camVerticalEase: number;
  /** While airborne the camera holds still unless the hero leaves this band (fractions of the view height). */
  readonly camAirBandTop: number;
  readonly camAirBandBottom: number;
  /** Touch mode back on: how fast the view may glide out past a side wall to make room for the buttons, px/f, in a running world. */
  readonly camPassGlideSpeed: number;
  /** On a touch screen the feet line rests at least this far above the top of the bottom row of buttons, px. */
  readonly camPadClearPx: number;
  /** While the hero thrusts, the air band's top line slides down to this fraction of the view under the top bar. */
  readonly camRiseBandTop: number;
  /** How fast that line slides down while thrusting, and back up after, px/f. */
  readonly camRiseLookSpeed: number;
  /** The vertical ease never moves the view more than this per tick, px/f. */
  readonly camVerticalMaxStep: number;
  /** While the hero stands, his feet may rest up to this far below the anchor on screen to bring things above out from under the top bar, px. */
  readonly camFrameDownPx: number;
  /** ...or up to this far above it to bring things below out from under the touch buttons, px. */
  readonly camFrameUpPx: number;
}

/** Shell only. Integer scaling policy (ruling R11), in tiles. */
export interface ViewTuning {
  /** The zoom is the largest whole number that still shows at least this many tiles. */
  readonly viewMinCols: number;
  readonly viewMinRows: number;
  /** The view never shows more than this many tiles; a larger window is letterboxed. */
  readonly viewMaxCols: number;
  readonly viewMaxRows: number;
}

/**
 * Shell only. Touch control layout (ruling R14), in CSS pixels, measured from
 * the safe-area edges. The pure layout function in src/input turns these
 * numbers into rectangles.
 */
export interface TouchTuning {
  /** LEFT and RIGHT: rounded squares in the bottom-left corner. */
  readonly moveButtonSize: number;
  readonly moveMarginSide: number;
  readonly moveMarginBottom: number;
  readonly moveButtonGap: number;
  /** The invisible move zone: this wide from the left safe edge, this tall from the bottom. */
  readonly moveZoneWidth: number;
  readonly moveZoneHeight: number;
  /** A thumb resting on the split between LEFT and RIGHT must cross it by this much to switch. */
  readonly moveSplitHysteresis: number;
  /** JUMP: a circle in the bottom-right corner. */
  readonly jumpButtonSize: number;
  readonly jumpMarginSide: number;
  readonly jumpMarginBottom: number;
  /** FIRE: a circle to the left of JUMP, shown only while the blaster is held. */
  readonly fireButtonSize: number;
  readonly fireMarginSide: number;
  readonly fireMarginBottom: number;
  /** THRUST: a circle above JUMP, shown only while the thruster pack is worn. */
  readonly thrustButtonSize: number;
  readonly thrustMarginSide: number;
  readonly thrustMarginBottom: number;
  /** The invisible action zone: a square of this size in the bottom-right corner. */
  readonly actionZoneSize: number;
  /** PAUSE: drawn at pauseButtonSize, touchable over pauseHitSize, in the top-right corner. */
  readonly pauseButtonSize: number;
  readonly pauseHitSize: number;
  readonly pauseMarginTop: number;
  readonly pauseMarginSide: number;
  /** Button opacity when idle, when pressed, and when unusable (bolt in flight, tank empty). */
  readonly opacityIdle: number;
  readonly opacityPressed: number;
  readonly opacityDimmed: number;
  /** A pressed button is drawn at this scale. */
  readonly pressedScale: number;
  /** Fade-in time of FIRE and THRUST when the item is picked up, milliseconds. */
  readonly appearMs: number;
  /** Vibration lengths, milliseconds (ignored where the device cannot vibrate). */
  readonly vibrateDeathMs: number;
  /** The golden cog buzzes twice: two pulses of vibrateCogPulseMs with vibrateCogGapMs between them. */
  readonly vibrateCogPulseMs: number;
  readonly vibrateCogGapMs: number;
  readonly vibrateEmptyTankMs: number;
}

/**
 * Shell only. Timings and strengths of the feedback the shell adds on top of
 * the simulation. None of them changes what happens in the game. Frames are
 * 1/60 s, counted by the shell (also while the core is not being stepped).
 * Pure animation speeds (frames per sprite picture) and sound recipes are art
 * data in src/art and src/audio, not tuning.
 */
export interface EffectsTuning {
  /** Frames the picture is held when an enemy is destroyed. The shell skips stepping; never during a replay. */
  readonly killHitStopFrames: number;
  /** Screen shake on a death: strength in px, length in frames. */
  readonly shakeDeathPx: number;
  readonly shakeDeathFrames: number;
  /** Screen shake when an enemy is destroyed. */
  readonly shakeKillPx: number;
  readonly shakeKillFrames: number;
  /** Screen shake on a hard landing, and the fall (in tiles) from which a landing counts as hard. */
  readonly shakeLandPx: number;
  readonly shakeLandFrames: number;
  readonly shakeLandMinFallTiles: number;
  /** The level intro card stays this long, and may be skipped by a press after introSkipAfterFrames. */
  readonly introFrames: number;
  readonly introSkipAfterFrames: number;
  /** How long the "cog found" toast stays. */
  readonly toastFrames: number;
  /** A crystal taken within this many frames of the last one plays the next note up the ladder. */
  readonly crystalLadderFrames: number;
}

/** Shell only. Frame pacing of the fixed-step loop. */
export interface PacingTuning {
  /** Most simulation ticks run in one rendered frame; a longer backlog is dropped (the game slows down instead of spiralling). */
  readonly maxStepsPerFrame: number;
  /** Render interpolation in 'auto' mode switches on when the measured display interval is below this, milliseconds. */
  readonly interpolateBelowMs: number;
}

// ---------------------------------------------------------------------------
// Phys: Tuning compiled to integers. The only numbers the core reads.
// ---------------------------------------------------------------------------

/**
 * Built once by compileTuning. Lengths in sub-pixels, speeds in sub-pixels per
 * tick, accelerations in sub-pixels per tick squared, times in ticks. Every
 * field is an integer. Immutable; shared by reference between all clones.
 *
 * Conversion: a px value becomes `Math.round(px * SUB)`; a frame count must
 * already be a whole number (compileTuning throws otherwise).
 */
export interface Phys {
  // hero
  readonly heroW: number;
  readonly heroH: number;

  // run
  readonly runMax: number;
  readonly groundAccel: number;
  readonly groundDecel: number;
  readonly groundTurn: number;
  readonly airAccel: number;
  readonly airDecel: number;
  readonly airTurn: number;

  // jump and gravity
  readonly jumpVel: number;
  readonly jumpCutVel: number;
  readonly gravRise: number;
  readonly gravFall: number;
  /** round(gravityRise * apexHangScale * SUB): gravity while rising inside the apex hang. */
  readonly gravRiseHang: number;
  /** round(gravityFall * apexHangScale * SUB): gravity while falling inside the apex hang. */
  readonly gravFallHang: number;
  readonly apexHangSpeed: number;
  readonly maxFall: number;

  // forgiveness
  readonly coyoteTicks: number;
  readonly jumpBufferTicks: number;
  readonly cornerNudge: number;
  readonly ledgeCatch: number;
  readonly hurtInsetSide: number;
  readonly hurtInsetTop: number;
  readonly hurtInsetBottom: number;
  readonly spikeInsetSide: number;
  readonly spikeInsetTop: number;
  readonly fireInsetSide: number;
  readonly fireInsetTop: number;
  readonly coolantInsetTop: number;
  readonly enemyTouchInset: number;
  readonly pickupOutset: number;
  readonly doorInsetSide: number;

  // thruster
  readonly thrustAccel: number;
  readonly thrustMaxRise: number;
  readonly thrustCutVel: number;
  readonly fuelTicks: number;

  // blaster
  readonly boltSpeed: number;
  readonly boltRange: number;
  readonly boltW: number;
  readonly boltH: number;
  readonly fireBufferTicks: number;

  // enemies
  readonly cinderpegSpeed: number;
  readonly mothSpeed: number;

  // timing
  /** hitStopFrames + deathAnimFrames + fadeFrames: length of the 'dying' phase. */
  readonly dyingTicks: number;
  /** fadeFrames + readyMinFrames: shortest 'ready' phase after a death. */
  readonly respawnReadyTicks: number;
  /** readyMinFrames: shortest 'ready' phase at a level start, after Restart level and after a resume. */
  readonly readyMinTicks: number;
  /** exitFrames: length of the 'exiting' phase. */
  readonly exitTicks: number;

  // lives and score
  readonly startLives: number;
  readonly maxLives: number;
  readonly livesPerLevelClear: number;
  readonly scoreCrystal: number;
  readonly scoreCog: number;
  readonly scoreCinderpeg: number;
  readonly scoreMoth: number;
  readonly scoreLevelClear: number;
  readonly scoreLifeLeft: number;
}

// ---------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------

/**
 * What a tile is made of. Only Solid blocks movement. Fire, Coolant and Spikes
 * are not solid: each kills through its own kill box (see ForgivenessTuning).
 * Every other level character (P T D G B J C M H) leaves an Empty tile and is
 * recorded in LevelData as a cell.
 */
export const Tile = { Empty: 0, Solid: 1, Fire: 2, Coolant: 3, Spikes: 4 } as const;
export type TileKind = (typeof Tile)[keyof typeof Tile];

/** A tile position: 0-based, col from the left, row from the top. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** The two items the hero can hold. */
export type ItemKind = 'blaster' | 'thruster';
/** Everything collected by touch except the trophy. 'crystal' is the level letter G. */
export type PickupKind = 'crystal' | ItemKind;

export interface PickupDef extends Cell {
  readonly kind: PickupKind;
}

/** 'cinderpeg' is the level letter C; 'moth' is M (vertical) or H (horizontal). */
export type EnemyKind = 'cinderpeg' | 'moth';
/** The axis an Arc Moth bounces along: 'v' = up and down (letter M), 'h' = left and right (letter H). */
export type MothAxis = 'h' | 'v';

export type EnemySpawn =
  | (Cell & { readonly kind: 'cinderpeg' })
  | (Cell & { readonly kind: 'moth'; readonly axis: MothAxis });

/** The `@hardest col,row note` header: where the level's hardest moment is, for reviewers. */
export interface HardestNote extends Cell {
  readonly note: string;
}

/**
 * One parsed level. Immutable after parseLevel; shared by reference between
 * every clone of the game state.
 */
export interface LevelData {
  /** The file stem: "level-03", "test", "debug". */
  readonly id: string;
  /** `@name`, or the id when the header is absent. */
  readonly name: string;
  /** `@teaches`, or '' when absent. */
  readonly teaches: string;
  /** `@hardest`, or null when absent. */
  readonly hardest: HardestNote | null;
  /** Items named by `@requires` lines, without duplicates, 'blaster' before 'thruster'. Empty when there are none. */
  readonly requires: readonly ItemKind[];
  /** Grid size in tiles. */
  readonly width: number;
  readonly height: number;
  /** Row-major tile kinds: index = row * width + col. Use tileAt(), which also answers for cells outside the grid. */
  readonly tiles: Uint8Array;
  readonly start: Cell;
  readonly trophy: Cell;
  readonly door: Cell;
  /** In reading order (top row first, left to right). The index is the pickup's stable id. */
  readonly pickups: readonly PickupDef[];
  /** In reading order. The index is the enemy's stable id. */
  readonly enemies: readonly EnemySpawn[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The buttons held down during one tick. Held states only: the core finds
 * presses itself by comparing with the previous tick. The input layer must
 * send at most one of left and right (the most recently pressed); if the core
 * receives both it treats them as neither.
 */
export interface Input {
  readonly left: boolean;
  readonly right: boolean;
  readonly jump: boolean;
  readonly fire: boolean;
  readonly thrust: boolean;
}

/** Bit values of an Input packed into one number (used by InputScript). */
export const InputBit = { Left: 1, Right: 2, Jump: 4, Fire: 8, Thrust: 16 } as const;

/**
 * A run-length input script: each entry holds one packed Input for a number of
 * consecutive ticks. The first entry applies to the first step() call after
 * the level was started, so a script includes the ticks spent in the ready
 * gate. JSON-safe, so it can be handed to the browser by the e2e test.
 */
export interface InputScript {
  readonly runs: readonly (readonly [bits: number, ticks: number])[];
}

// ---------------------------------------------------------------------------
// Simulation state (mutable; integers and booleans only)
// ---------------------------------------------------------------------------

export type Facing = -1 | 1;

export interface PlayerState {
  /** Top-left corner of the collision box, sub-pixels. The box is [x, x + heroW) by [y, y + heroH). */
  x: number;
  y: number;
  /** Sub-pixels per tick. Positive vy is downward. */
  vx: number;
  vy: number;
  /** The last direction held. Bolts fly this way. Starts as 1 (right). */
  facing: Facing;
  /** True when, at the end of the last tick, vy >= 0 and a solid tile touched the feet. */
  onGround: boolean;
  /**
   * Ticks left in which a jump may start. At the start of every playing tick:
   * set to coyoteTicks + 1 when onGround, otherwise counted down to 0. Set to
   * 0 when a jump starts. A jump may start only while this is above 0.
   */
  coyote: number;
  /**
   * Remembered jump press. At the start of every playing tick: counted down to
   * 0, then set to jumpBufferTicks + 1 when jump was pressed this tick. Set to
   * 0 when a jump starts. A jump starts only while this is above 0.
   */
  jumpBuffer: number;
  /** Remembered fire press, same scheme with fireBufferTicks. Set to 0 when a bolt is fired. */
  fireBuffer: number;
  /**
   * True from a jump start until the arc ends: when vy reaches apexHangSpeed
   * downward, on landing, on a head bonk, or when the thruster burns. Only
   * inside the arc do the jump cut, gravRise and the apex hang apply.
   */
  jumpArc: boolean;
  /** True when the thruster burned fuel on the last tick. */
  thrusting: boolean;
  hasBlaster: boolean;
  /** True from picking up a pack until death or level end, also while the tank is empty. */
  hasThruster: boolean;
  /** Thrust ticks left in the tank, 0..fuelTicks. */
  fuel: number;
  /** The jump and fire inputs of the previous tick, for press detection. Updated on every tick in every phase. */
  prevJump: boolean;
  prevFire: boolean;
}

interface EnemyBase {
  /** Top-left corner of the one-tile body, sub-pixels. */
  x: number;
  y: number;
  /** Direction of travel along the enemy's axis: -1 is left or up, 1 is right or down. */
  dir: Facing;
  /** False once destroyed by a bolt; true again after the hero dies. */
  alive: boolean;
}
export interface CinderpegState extends EnemyBase {
  readonly kind: 'cinderpeg';
}
export interface MothState extends EnemyBase {
  readonly kind: 'moth';
  readonly axis: MothAxis;
}
export type EnemyState = CinderpegState | MothState;

/** The single bolt slot: at most one bolt exists at a time. */
export interface BoltState {
  active: boolean;
  /** Top-left corner of the bolt box (boltW by boltH), sub-pixels. Meaningless while inactive. */
  x: number;
  y: number;
  dir: Facing;
  /** Sub-pixels the bolt may still travel; it fizzles when this reaches 0 or less. */
  rangeLeft: number;
}

export type DeathCause = 'fire' | 'coolant' | 'spikes' | 'enemy' | 'fell';

/**
 * The phase of the current level attempt.
 * - 'ready':   the world is frozen until the minimum time has passed and a control is pressed
 *              (a control still held from before does not count: see RunState.readyArmed)
 * - 'playing': the world runs
 * - 'dying':   the hero has been killed; the world is frozen for dyingTicks
 * - 'exiting': the hero is inside the open airlock; the world is frozen for exitTicks
 */
export type RunPhase = 'ready' | 'playing' | 'dying' | 'exiting';

/**
 * The state of the current level. Created by startLevel; partly reset by a
 * respawn (see docs/ARCHITECTURE.md, "State machine").
 */
export interface RunState {
  /** step() calls since the level was started. Never reset by a respawn. */
  tick: number;
  phase: RunPhase;
  /** Ticks spent in the current phase: 0 on entry. In 'ready' it stops counting at phaseLength. */
  phaseTicks: number;
  /**
   * Length of the current phase in ticks: for 'ready' the minimum before the
   * gate may open, for 'dying' and 'exiting' the full length, for 'playing' 0.
   */
  phaseLength: number;
  /**
   * The ready gate opens on a PRESS, not on a control that is merely still
   * held. False whenever the gate shuts (level start, respawn, Restart level,
   * holdReady); set true on the first tick of the 'ready' phase on which none
   * of the five controls is held. The gate opens on the first tick on which
   * the minimum has passed, this is true and a control is held. Meaningless
   * outside 'ready'.
   */
  readyArmed: boolean;
  player: PlayerState;
  /** Index = LevelData.enemies index. Never reordered or resized during a level. */
  enemies: EnemyState[];
  /** Index = LevelData.enemies index. True once that enemy's score has been paid during this level visit; survives respawns. */
  enemyPaid: boolean[];
  bolt: BoltState;
  /**
   * Index = LevelData.pickups index. True while that pickup is gone from the
   * level. Crystals stay taken after a death; blasters and thruster packs are
   * put back by a respawn, and thruster packs also when the tank runs dry.
   */
  taken: boolean[];
  /** True once the golden cog is collected. The airlock is open exactly when this is true. Survives respawns. */
  hasTrophy: boolean;
  /** Why the hero is dying; null outside the 'dying' phase. */
  deathCause: DeathCause | null;
}

/** 'playing' also covers the ready gate and the dying and exiting phases. */
export type SessionStatus = 'playing' | 'gameOver' | 'won';

/** One run through the game: what the player carries from level to level. */
export interface SessionState {
  status: SessionStatus;
  /** Index into GameState.levels of the level being played. */
  levelIndex: number;
  score: number;
  lives: number;
  /** The highest level index the player may start from the title screen. Raised by level clears. */
  highestUnlocked: number;
}

/** Where a session starts. Every field is optional in createSession; see CreateSessionFn for the defaults. */
export interface SessionStart {
  readonly levelIndex: number;
  readonly score: number;
  readonly lives: number;
  readonly highestUnlocked: number;
}

/** Everything step() reads and writes. */
export interface GameState {
  /** Shared, immutable. */
  readonly phys: Phys;
  /** Shared, immutable. The campaign in play order, or a single development level. */
  readonly levels: readonly LevelData[];
  /** Always levels[session.levelIndex]; replaced when the next level loads. */
  level: LevelData;
  session: SessionState;
  run: RunState;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Everything momentary that the shell needs for sound, particles, the HUD,
 * saving and screen changes. step() appends events to the caller's array in
 * the order they happen within the tick.
 *
 * x and y are sub-pixel world coordinates of the point the effect belongs to:
 * - jumped, landed: the middle of the hero's feet
 * - bonked: the middle of the top of the hero's box
 * - fuelEmptied, playerDied: the centre of the hero's box
 * - pickup, pickupRestored, trophyCollected, doorOpened: the centre of the cell
 * - boltFired, boltEnded: the centre of the bolt box
 * - enemyKilled: the centre of the enemy's body
 */
export type GameEvent =
  /** A level was loaded (by createSession, startLevel, or after the exiting phase). The run is in the ready gate. */
  | { readonly type: 'levelStarted'; readonly levelIndex: number; readonly score: number; readonly lives: number }
  /** The ready gate opened; this same tick is simulated normally. */
  | { readonly type: 'readyEnded' }
  | { readonly type: 'jumped'; readonly x: number; readonly y: number }
  /** The hero touched ground after being airborne. speed is the downward speed just before the landing, sub-pixels per tick. */
  | { readonly type: 'landed'; readonly x: number; readonly y: number; readonly speed: number }
  /** The hero's head hit a ceiling (no corner nudge applied). */
  | { readonly type: 'bonked'; readonly x: number; readonly y: number }
  /**
   * PlayerState.thrusting changed from false to true. For one-shot ignition
   * effects only: the thrust loop sound follows the state (phase 'playing' and
   * PlayerState.thrusting), not this event, so it can never be left running.
   */
  | { readonly type: 'thrustStarted' }
  /** PlayerState.thrusting changed from true to false, for any reason including death, level end and Restart level. */
  | { readonly type: 'thrustStopped' }
  /** The tank reached 0 this tick. Followed by one pickupRestored per thruster pack put back. */
  | { readonly type: 'fuelEmptied'; readonly x: number; readonly y: number }
  /** A crystal, blaster or thruster pack was collected. score is the points added (0 for items). */
  | {
      readonly type: 'pickup';
      readonly kind: PickupKind;
      readonly index: number;
      readonly x: number;
      readonly y: number;
      readonly score: number;
    }
  /** A thruster pack reappeared because the tank ran dry. (Items put back by a respawn are not announced one by one.) */
  | { readonly type: 'pickupRestored'; readonly kind: ItemKind; readonly index: number; readonly x: number; readonly y: number }
  | { readonly type: 'trophyCollected'; readonly x: number; readonly y: number; readonly score: number }
  /** Emitted on the same tick as trophyCollected, right after it; x and y are the door cell. */
  | { readonly type: 'doorOpened'; readonly x: number; readonly y: number }
  | { readonly type: 'boltFired'; readonly x: number; readonly y: number; readonly dir: Facing }
  | { readonly type: 'boltEnded'; readonly x: number; readonly y: number; readonly hit: 'wall' | 'enemy' | 'range' }
  /** score is the points added: the enemy's value the first time during this level visit, then 0. */
  | {
      readonly type: 'enemyKilled';
      readonly index: number;
      readonly kind: EnemyKind;
      readonly x: number;
      readonly y: number;
      readonly score: number;
    }
  /**
   * The hero was killed; the dying phase starts. livesAfter is the number of
   * lives the session will have when the dying phase ends (0 means game over
   * follows). score is the session score, for saving.
   */
  | {
      readonly type: 'playerDied';
      readonly cause: DeathCause;
      readonly x: number;
      readonly y: number;
      readonly livesAfter: number;
      readonly score: number;
    }
  /** The hero is back at the start in the ready gate, after a death or after Restart level. lives is the count now. */
  | { readonly type: 'respawned'; readonly lives: number; readonly reason: 'death' | 'restart' }
  /**
   * The hero entered the open airlock; the exiting phase starts. bonus is the
   * level-clear score just added; score, lives and highestUnlocked are the
   * session values after the bonus and the returned life. last is true for
   * the final level of GameState.levels.
   */
  | {
      readonly type: 'levelCompleted';
      readonly levelIndex: number;
      readonly last: boolean;
      readonly bonus: number;
      readonly score: number;
      readonly lives: number;
      readonly highestUnlocked: number;
    }
  /** Lives reached 0. session.status is 'gameOver'; step() does nothing from now on. */
  | { readonly type: 'gameOver'; readonly score: number }
  /**
   * The last level's exiting phase ended. lifeBonus = lives * scoreLifeLeft has
   * been added; score is the final total. session.status is 'won'.
   */
  | { readonly type: 'gameWon'; readonly score: number; readonly lives: number; readonly lifeBonus: number };

/** The `type` strings of GameEvent, for switch statements and lookup tables. */
export type GameEventType = GameEvent['type'];

// ---------------------------------------------------------------------------
// Saved data (plain JSON; storage access itself is the shell's job)
// ---------------------------------------------------------------------------

/** A run that can be continued: the values the level was started with, with lives kept up to date after each death. */
export interface ResumePoint {
  readonly levelIndex: number;
  readonly score: number;
  readonly lives: number;
}

/** Stored under `${GAME_ID}:progress`. */
export interface SaveData {
  /** Format version. */
  readonly v: 1;
  /** Highest campaign level index that may be started (0-based). */
  readonly unlocked: number;
  readonly bestScore: number;
  /** True once the last level has been cleared. */
  readonly finished: boolean;
  /** The run in progress, or null when there is none (never started, game over, or won). */
  readonly resume: ResumePoint | null;
}

/** Stored under `${GAME_ID}:settings`. */
export interface SettingsData {
  readonly v: 1;
  readonly sound: boolean;
  readonly vibration: boolean;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Every search merges states on a key and keeps one representative per key, so a failure verdict means "no
 * win among the states the searches kept", never more (docs/ARCHITECTURE.md, section 9.4). A failure is
 * returned only after every search that applies has run and none won.
 * - 'proven':             a script exists and is returned
 * - 'unsafe-start':       the hero dies without touching a control (after the gate is opened by a harmless fire press)
 * - 'trophy-unreachable': with enemies removed, the map holds no state with the trophy (and the quick pass found no win)
 * - 'door-unreachable':   the map holds the trophy but no win (and the quick pass found no win)
 * - 'blocked-by-enemies': the map wins without enemies, but the searches with enemies ran out of states; only
 *                         for a level with enemies
 * - 'no-route':           a search ran out of states and no other stage could name a reason: on a level with
 *                         thruster packs the quick pass, its only search (the map costs too much; alwaysMap
 *                         names the reason); on a level without enemies the guided search
 * - 'budget-exceeded':    a step-call budget was spent before any of the verdicts above: nothing is decided
 */
export type Verdict =
  | 'proven'
  | 'unsafe-start'
  | 'trophy-unreachable'
  | 'door-unreachable'
  | 'blocked-by-enemies'
  | 'no-route'
  | 'budget-exceeded';

/**
 * Search constants. They are not feel numbers: the defaults live in
 * src/core/validate/options.ts (DEFAULT_OPTIONS, COMFORT_OPTIONS,
 * REQUIRES_OPTIONS). Budgets are counted in step() calls, because the core
 * has no clock.
 */
export interface ValidateOptions {
  /** K: ticks one ground or flight decision is held. */
  readonly decisionTicks: number;
  /** An input that does not change the state's key is held for up to this many decisions before it is dropped. */
  readonly maxHoldDecisions: number;
  /** Ground states merge when their x falls in the same bucket of this many px. */
  readonly groundBucketPx: number;
  /** Flight states merge inside a square cell of this many px. */
  readonly flightCellPx: number;
  /** Length of the short jump press tried beside the full hold, ticks. */
  readonly tapTicks: number;
  /** Arc ticks at which a jump manoeuvre may change direction once. */
  readonly airSwitchTicks: readonly number[];
  /** Enemies within this many tiles of the hero are part of the state key. */
  readonly enemyKeyRadiusTiles: number;
  /** Bucket size for an enemy's position in the state key, px. */
  readonly enemyBucketPx: number;
  /** Weight w of the search order f = ticks + w * estimate, where the estimate is in ticks too. */
  readonly heuristicWeight: number;
  /**
   * Budget of the quick pass, in step() calls, for a level without thruster packs; when it is spent, or the
   * quick pass runs out of states, the pipeline goes on to the map. A level with packs gives the quick pass
   * all of maxStepCalls instead and has no map stage, because its map costs more than the quick pass
   * (docs/ARCHITECTURE.md, section 9.4).
   */
  readonly quickStepCalls: number;
  /** Hard budget: total step() calls for one validateLevel call, all stages together. */
  readonly maxStepCalls: number;
  /** Idle ticks of the safe-start check. */
  readonly safeStartTicks: number;
  /**
   * Map first: build the exhaustive enemy-free map, then search with enemies guided by it; when those fail,
   * run the quick pass on what is left of the budget (a win there is 'proven'). When the map finishes inside
   * maxStepCalls it fills unreachableCrystals and names the reason of a failure. Cheap for a level without a
   * thruster pack, expensive for one with packs (docs/ARCHITECTURE.md, section 9.6).
   */
  readonly alwaysMap: boolean;
}

/**
 * The stage of the pipeline that gave the verdict (docs/ARCHITECTURE.md, section 9.4): stage 0 the safe
 * start, stage 1 the quick pass, stage 2 the enemy-free map, stage 3 the guided search.
 */
export type ProofStage = 'safe-start' | 'quick' | 'map' | 'guided';

/** Deterministic effort counters (the core has no clock; tests time the call themselves). */
export interface ProofStats {
  /** Ground and flight states stored by the enemy-free map (0 when it was not built). */
  readonly groundNodes: number;
  readonly flightNodes: number;
  /** States stored by the searches with enemies (the quick pass and the guided search together). */
  readonly searchNodes: number;
  /** Every step() call of this validateLevel call: all stages and the closing replay of the script. */
  readonly stepCalls: number;
}

/** The validator's answer for one level. */
export interface LevelProof {
  readonly levelId: string;
  readonly verdict: Verdict;
  /** The stage that decided the verdict. */
  readonly stage: ProofStage;
  /** The winning input script, starting at the first tick after startLevel; null unless proven. */
  readonly script: InputScript | null;
  /** RunState.tick at which trophyCollected is emitted when the script is replayed; -1 unless proven. */
  readonly trophyTick: number;
  /** RunState.tick at which levelCompleted is emitted when the script is replayed; -1 unless proven. */
  readonly winTick: number;
  /**
   * When not proven: the cell of the closest approach to the goal of the stage that named the verdict, to show
   * a level author where to look.
   */
  readonly stuckAt: Cell | null;
  /**
   * Crystals that no state of the exhaustive enemy-free map collected. Null when that map was not built or
   * not finished (it is built first with alwaysMap, and otherwise only for a level without thruster packs
   * whose quick pass did not win). A warning, never a failure.
   */
  readonly unreachableCrystals: readonly Cell[] | null;
  readonly stats: ProofStats;
}

/** What replaying a script through the real step() did. */
export interface ReplayResult {
  /** True when levelCompleted was emitted and the hero never died. */
  readonly won: boolean;
  /** RunState.tick of trophyCollected, or -1. */
  readonly trophyTick: number;
  /** RunState.tick of levelCompleted, or -1. */
  readonly winTick: number;
  /** The first death, or null. The replay stops there. */
  readonly died: DeathCause | null;
  /** Ticks actually stepped. */
  readonly ticks: number;
}

// ---------------------------------------------------------------------------
// Function signatures. Each alias names the module that exports the function
// and the exact export name; implementations must match the alias (declare
// them as `export const name: Alias = ...` or check with `satisfies`).
//
// First the internal seams between the core's own modules, then the public
// functions used by the shell, the validator and the tests.
// ---------------------------------------------------------------------------

/** src/core/tiles.ts: `isSolid`. `tileAt(level, col, row) === Tile.Solid`. */
export type IsSolidFn = (level: LevelData, col: number, row: number) => boolean;

/**
 * src/core/tiles.ts: `boxHitsSolid`.
 * True when the box [x, x + w) by [y, y + h), in sub-pixels, overlaps any
 * Solid tile (cells outside the grid count as tileAt says). w and h are at
 * least 1.
 */
export type BoxHitsSolidFn = (level: LevelData, x: number, y: number, w: number, h: number) => boolean;

/** src/core/run.ts: `createRun`. A fresh level visit in the ready gate (phaseLength = readyMinTicks, readyArmed false). */
export type CreateRunFn = (level: LevelData, phys: Phys) => RunState;

/**
 * src/core/run.ts: `respawnRun`.
 * The partial reset after a death or Restart level, in place, into the ready
 * gate with phaseLength = readyTicks and readyArmed false. What it keeps and
 * resets is tabulated in docs/ARCHITECTURE.md, "State machine".
 */
export type RespawnRunFn = (run: RunState, level: LevelData, phys: Phys, readyTicks: number) => void;

/** src/core/player.ts: `stepPlayer`. Steps 4 to 11 of the step order, for one playing tick. */
export type StepPlayerFn = (game: GameState, input: Input, events?: GameEvent[]) => void;

/** src/core/enemies.ts: `stepEnemies`. Step 12. */
export type StepEnemiesFn = (game: GameState) => void;

/** src/core/bolt.ts: `stepBolt`. Step 13. Reads player.fireBuffer, which stepPlayer has already updated this tick. */
export type StepBoltFn = (game: GameState, events?: GameEvent[]) => void;

/**
 * src/core/contact.ts: `resolveContacts`.
 * Steps 14 to 17. Starts the exiting or the dying phase itself (sets
 * run.phase and the session fields, emits the events); game.ts only has to
 * finish those phases when their time is up.
 */
export type ResolveContactsFn = (game: GameState, events?: GameEvent[]) => void;

/**
 * src/core/compileTuning.ts: `compileTuning`.
 * Rounds Tuning into Phys. Pure. Throws `TuningError` (exported by the same
 * module, `extends Error`) with one message listing every unsafe value, for
 * example a frame count that is not a whole number or a speed of 8 px per
 * frame or more (half a tile: the collision code relies on it). The full list
 * of checks is in docs/ARCHITECTURE.md, "Units and compiled tuning".
 */
export type CompileTuningFn = (tuning: Tuning) => Phys;

/**
 * src/core/level.ts: `parseLevel`.
 * `text` is the file content, `id` the file stem ("level-03"). Pure. Throws
 * `LevelError` (same module, `extends Error`) whose message starts with
 * `levels/<id>.txt` and is one of the exact messages listed in
 * docs/ARCHITECTURE.md, "Level file format".
 */
export type ParseLevelFn = (text: string, id: string) => LevelData;

/**
 * src/core/level.ts: `withoutItem`.
 * A copy of the level with every pickup of that kind removed and that kind
 * dropped from `requires`. Used by the "@requires" tests.
 */
export type WithoutItemFn = (level: LevelData, item: ItemKind) => LevelData;

/**
 * src/core/tiles.ts: `tileAt`.
 * The tile at a cell, including cells outside the grid: left of, right of and
 * above the grid is Solid; below the grid is Empty.
 */
export type TileAtFn = (level: LevelData, col: number, row: number) => TileKind;

/**
 * src/core/game.ts: `createSession`.
 * Builds a GameState and loads the starting level into the ready gate.
 * Defaults for missing `start` fields: levelIndex 0, score 0, lives
 * phys.startLives, highestUnlocked = levelIndex. highestUnlocked is raised to
 * levelIndex if it is lower. lives is clamped to [1, phys.maxLives]: it may
 * come from a stored save, which parseSave cannot check against Phys.
 * Appends `levelStarted`. Throws RangeError when `levels` is empty or
 * levelIndex is outside it.
 */
export type CreateSessionFn = (
  levels: readonly LevelData[],
  phys: Phys,
  start?: Partial<SessionStart>,
  events?: GameEvent[],
) => GameState;

/**
 * src/core/game.ts: `startLevel`.
 * Loads levels[levelIndex] into `game` as a brand-new level visit: fresh
 * RunState in the ready gate (phaseLength = readyMinTicks), nothing taken, no
 * trophy, tick 0. Score, lives and highestUnlocked are kept; status becomes
 * 'playing'. Appends `levelStarted`. Throws RangeError for a bad index.
 */
export type StartLevelFn = (game: GameState, levelIndex: number, events?: GameEvent[]) => void;

/**
 * src/core/game.ts: `step`.
 * Advances the game by exactly one tick (1/60 s), mutating `game` in place.
 * Deterministic: the same state and input always give the same state and
 * events. When `events` is given, events are appended to it and nothing else
 * is allocated; when omitted, no event objects are created. Does nothing once
 * session.status is not 'playing'. The order of operations is fixed by
 * docs/ARCHITECTURE.md, "Step order".
 */
export type StepFn = (game: GameState, input: Input, events?: GameEvent[]) => void;

/**
 * src/core/game.ts: `restartLevel`.
 * The pause menu's "Restart level": costs one life, with no dying phase. If
 * lives reach 0: status 'gameOver' and `gameOver`. Otherwise the same reset as
 * a respawn after a death, into the ready gate (phaseLength = readyMinTicks),
 * and `respawned` with reason 'restart'. Does nothing unless status is
 * 'playing' and the phase is 'ready' or 'playing'.
 */
export type RestartLevelFn = (game: GameState, events?: GameEvent[]) => void;

/**
 * src/core/game.ts: `holdReady`.
 * Shuts the ready gate after a pause: if the phase is 'playing' it becomes
 * 'ready' with phaseTicks 0, phaseLength = readyMinTicks and readyArmed
 * false; nothing else changes (the hero keeps its position and speed). No
 * effect in any other phase. The shell calls it when the pause overlay closes.
 */
export type HoldReadyFn = (game: GameState) => void;

/**
 * src/core/game.ts: `cloneGame`.
 * A deep copy of session and run (new objects and arrays). phys, levels and
 * level are shared by reference.
 */
export type CloneGameFn = (source: GameState) => GameState;

/**
 * src/core/game.ts: `copyGame`.
 * Copies every mutable field of `source` into `target` without allocating.
 * Both must hold the same level (target.level === source.level), as a clone
 * of the same game does. Hand-written field by field: a new state field must
 * be added here, and the determinism test catches a forgotten one.
 */
export type CopyGameFn = (target: GameState, source: GameState) => void;

/** src/core/script.ts: `inputFromBits`. Unpacks InputBit flags. Returns a shared frozen object per bit pattern (never mutate it). */
export type InputFromBitsFn = (bits: number) => Input;

/** src/core/script.ts: `bitsFromInput`. Packs an Input into InputBit flags. */
export type BitsFromInputFn = (input: Input) => number;

/** src/core/script.ts: `scriptTicks`. The total number of ticks in a script. */
export type ScriptTicksFn = (script: InputScript) => number;

/**
 * src/core/script.ts: `inputAtTick`.
 * The packed input of the script's n-th tick (0-based), or 0 (nothing held)
 * past its end. Used by the shell's replay hook.
 */
export type InputAtTickFn = (script: InputScript, tick: number) => number;

/** src/core/save.ts: `defaultSave`. `{ v: 1, unlocked: 0, bestScore: 0, finished: false, resume: null }`. */
export type DefaultSaveFn = () => SaveData;

/**
 * src/core/save.ts: `parseSave`.
 * Turns whatever JSON.parse returned into a valid SaveData. Never throws: any
 * missing, mistyped or out-of-range field falls back to its default, and
 * `levelCount` clamps unlocked and resume.levelIndex.
 */
export type ParseSaveFn = (json: unknown, levelCount: number) => SaveData;

/**
 * src/core/save.ts: `applyEvents`.
 * The pure save reducer. Returns the same object when nothing changed.
 * - levelStarted:   resume = { levelIndex, score, lives }
 * - playerDied:     resume.lives = livesAfter; when livesAfter is 0, resume = null and bestScore = max(bestScore, score)
 * - respawned:      resume.lives = lives
 * - levelCompleted: unlocked = max(unlocked, highestUnlocked); then, unless `last`, resume = { levelIndex + 1, score, lives };
 *                   when `last` (the win is certain: only a closed page can stop the exiting phase),
 *                   finished = true, resume = null and bestScore = max(bestScore, score)
 * - gameOver:       bestScore = max(bestScore, score); resume = null
 * - gameWon:        bestScore = max(bestScore, score) (now with the life bonus); finished = true; resume = null
 * Every other event is ignored.
 *
 * bestScore is therefore already raised by the time an end screen is built
 * (at the last death, 52 ticks before gameOver; at the last level's clear,
 * exitTicks before gameWon). "NEW BEST!" must not be
 * decided from the save at that moment: the shell remembers the best score as
 * it was when the session was created and compares the final score with that
 * (docs/ARCHITECTURE.md, section 11.3).
 */
export type ApplySaveEventsFn = (save: SaveData, events: readonly GameEvent[]) => SaveData;

/**
 * src/core/validate/handicap.ts: `handicap`.
 * The "clumsy thumbs" tuning of the comfort proof: coyoteFrames 0,
 * jumpBufferFrames 0, runMaxSpeed and jumpVelocity times 0.95, jetFuelFrames
 * times 0.9 rounded down. Everything else unchanged. Pure.
 */
export type HandicapFn = (tuning: Tuning) => Tuning;

/**
 * src/core/validate/index.ts: `validateLevel`.
 * Searches for a way to collect the trophy and then reach the door, using
 * only states produced by the real step(). Pure and deterministic. Missing
 * options take the values of DEFAULT_OPTIONS.
 */
export type ValidateLevelFn = (level: LevelData, phys: Phys, options?: Partial<ValidateOptions>) => LevelProof;

/**
 * src/core/validate/index.ts: `replayScript`.
 * Creates a fresh one-level session (`createSession([level], phys)`) and
 * feeds it the script tick by tick through step(), stopping at the first
 * death, at levelCompleted, or at the end of the script.
 */
export type ReplayScriptFn = (level: LevelData, phys: Phys, script: InputScript) => ReplayResult;
