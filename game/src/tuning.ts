/**
 * Every feel number of the game lives in this file and nowhere else.
 *
 * HOW TO READ IT
 * - px    = one art pixel. A tile is 16 px; the hero's sprite is 16 px square.
 * - frame = one simulation tick. The game always runs 60 frames per second,
 *           so 6 frames = 0.1 s.
 * - px/f  = pixels per frame (a speed). 1.5 px/f = 90 px per second.
 * - px/f2 = pixels per frame, per frame (an acceleration).
 * Decimals are fine anywhere a px value is asked for: the game rounds each to
 * the nearest 1/256 px. Frame counts must be whole numbers.
 *
 * AFTER ANY CHANGE run `npm run check`. Three things can then fail, and each
 * says what to do:
 * - a number is unsafe (for example a speed of 8 px/f or more): the message
 *   names the number;
 * - a level can no longer be finished with the new numbers: it fails by name;
 * - a change moved one of the whole-tile limits the levels are built on (the
 *   3-tile step, the 4-tile gap, 6 tiles of climb or 8 of flight per tank):
 *   the limits test names the limit. The levels and docs/LEVELS.md then need
 *   a developer.
 * The other unit tests do not read this file: they run on a frozen copy of
 * the numbers (src/core/testkit.ts), so a tweak here never breaks them.
 *
 * PLAYTEST FEEDBACK -> WHAT TO CHANGE
 * - "The jump is floaty"        raise gravity.gravityFall first. If still floaty, raise
 *                               gravity.gravityRise and jump.jumpVelocity together (that keeps
 *                               the height), or set gravity.apexHangScale to 1.
 * - "The jump is too low/high"  jump.jumpVelocity. Levels are built for a 3-tile step and a
 *                               4-tile gap, so expect level failures if it goes down.
 * - "I can't do small hops"     lower jump.jumpCutVelocity.
 * - "I slide off edges"         raise run.groundDecel and run.airDecel; add 2 to
 *                               forgiveness.coyoteFrames.
 * - "It ignores my jump"        add 2 to forgiveness.jumpBufferFrames and coyoteFrames.
 * - "Too fast" or "twitchy"     lower run.runMaxSpeed by 0.125.
 * - "That didn't touch me"      add 1 to the hurt, spike, fire or enemy insets in forgiveness.
 * - "The thruster runs out"     raise thruster.jetFuelFrames (80 = 1.33 s of thrust).
 * - "I miss the buttons"        raise the touch button sizes and zone sizes by 8.
 * - "The camera swings around"  lower camera.camLookShiftSpeed or raise camDeadzoneHalfW.
 *
 * The limits these numbers produce (jump height, longest gap and so on) are
 * tabulated in docs/ARCHITECTURE.md, "Derived limits". Where a comment below
 * quotes such a result ("as shipped: ...") it describes the numbers as first
 * shipped and does not update itself: the editable number is the one before
 * the comment.
 */
import type { Tuning } from './core/types';

export type { Tuning } from './core/types';

export const TUNING: Tuning = {
  // The hero's solid body. Smaller than the 16 px sprite on purpose.
  hero: {
    heroHitboxW: 10, // px wide. Narrower = slips through gaps more easily. Keep it even and at most 16.
    heroHitboxH: 14, // px tall. Leaves 2 px of headroom in a corridor one tile high.
  },

  // Running left and right.
  run: {
    runMaxSpeed: 1.5, // px/f. Top running speed (as shipped: 5.6 tiles per second). Lower = calmer, easier to read on a phone.
    groundAccel: 0.25, // px/f2. How quickly the hero gets up to speed on the ground (as shipped: 6 frames to full speed).
    groundDecel: 0.375, // px/f2. How quickly the hero stops when the thumb lifts (as shipped: 4 frames, 2.25 px). Raise if "I slide off edges".
    groundTurnAccel: 0.5, // px/f2. Braking when the opposite direction is pressed. Raise for snappier turns.
    airAccel: 0.1875, // px/f2. Steering strength in mid-air. Raise for more air control.
    airDecel: 0.1875, // px/f2. How quickly sideways drift stops in mid-air when the thumb lifts (as shipped: 8 frames, 5.25 px).
    airTurnAccel: 0.3125, // px/f2. Reversing direction in mid-air, for correcting an overshoot.
  },

  // Jumping.
  jump: {
    jumpVelocity: 5.0, // px/f. Launch speed. Sets the height (as shipped: 3.29 tiles). Raise for a higher jump. The levels' "clumsy thumbs" proof runs at 95 % of it (2.98 tiles) and then climbs a 3-tile step only thanks to ledgeCatchPx below.
    jumpCutVelocity: 1.5, // px/f. Upward speed kept when jump is let go early. Lower = smaller hops from a quick tap.
  },

  // Gravity.
  gravity: {
    gravityRise: 0.25, // px/f2. Pull while going up with jump held. Raise for a quicker, lower rise.
    gravityFall: 0.4375, // px/f2. Pull on the way down. Raise this first if "the jump is floaty".
    apexHangSpeed: 0.5, // px/f. Near the top of a held jump (slower than this) gravity is weakened...
    apexHangScale: 0.5, // ...to this fraction, giving a moment to aim the landing. 1 = no hang at all.
    maxFallSpeed: 4.0, // px/f. Fastest fall (as shipped: 15 tiles per second). Must stay below 8.
  },

  // Help for thumbs on glass. Bigger numbers = more forgiving.
  forgiveness: {
    coyoteFrames: 6, // frames. A jump still works this long after running off a ledge.
    jumpBufferFrames: 7, // frames. A jump pressed in the air is remembered this long: if the hero can jump again within it, he does. The jump happens on the frame after touchdown, so as shipped a press up to 6 frames before touchdown counts.
    cornerNudgePx: 4, // px. Clipping a ceiling corner by this much or less slides the hero past it instead of stopping the jump.
    ledgeCatchPx: 3, // px. Falling this little short of a ledge still lands on it. Do not set it to 0 without re-proving the levels: 3-tile steps rely on it under the "clumsy thumbs" proof.
    hurtInsetSidePx: 2, // px. Hazards and enemies must reach this far into the hero's sides to kill...
    hurtInsetTopPx: 2, // px. ...this far into the head...
    hurtInsetBottomPx: 1, // px. ...and this far into the feet. Raise any of the three if deaths look unfair.
    spikeInsetSidePx: 3, // px. The outer 3 px on each side of a spike tile are harmless.
    spikeInsetTopPx: 8, // px. Only the lower half of a spike tile kills.
    fireInsetSidePx: 3, // px. The outer 3 px on each side of a fire tile are harmless.
    fireInsetTopPx: 4, // px. The flame tips (top 4 px) are harmless.
    coolantInsetTopPx: 6, // px. The top 6 px of a coolant tile (the froth) are harmless. With the 1 px foot inset above, the feet can be 7 px under the surface before it kills.
    enemyTouchInsetPx: 3, // px. An enemy's outer 3 px on every side are harmless.
    pickupOutsetPx: 2, // px. Crystals, items and the cog are collected from this far outside their tile.
    doorInsetSidePx: 4, // px. The hero must be this far inside the airlock for it to count.
  },

  // The thruster pack.
  thruster: {
    jetAccel: 0.375, // px/f2. Lift. Raise to catch a fall sooner.
    jetMaxRiseSpeed: 1.75, // px/f. Fastest climb under thrust (as shipped: 6.6 tiles per second). Slower than a jump, so it is easy to steer.
    jetCutSpeed: 0.5, // px/f. Upward speed kept when thrust is let go. Low = the climb stops at once.
    jetFuelFrames: 80, // frames of thrust in a full tank (as shipped: 1.33 s; holding THRUST climbs 8.6 tiles or crosses 11.9). Levels ask for at most 6 tiles of climb or 8 tiles of flight per tank (9 under open sky).
  },

  // The bolt blaster. One bolt at a time.
  blaster: {
    boltSpeed: 4, // px/f. Bolt speed (as shipped: 15 tiles per second).
    boltRangePx: 160, // px. How far a bolt flies (10 tiles). Also sets the wait before the next shot after a miss (as shipped: 0.67 s).
    boltHitboxW: 8, // px. Bolt size...
    boltHitboxH: 6, // px. ...taller = easier to hit with.
    fireBufferFrames: 6, // frames. A fire press this early before the old bolt is gone still fires.
  },

  // Enemies. Neither reacts to the hero.
  enemies: {
    cinderpegSpeed: 0.5, // px/f. Cinderpeg walking speed (as shipped: a third of the hero's).
    mothSpeed: 0.75, // px/f. Arc Moth flying speed (as shipped: half of the hero's).
  },

  // Death, respawn and level-clear timing. The world is frozen during all of these.
  timing: {
    hitStopFrames: 6, // frames. Freeze at the moment of death.
    deathAnimFrames: 36, // frames. The hero falls apart.
    fadeFrames: 10, // frames. Fade out, and the same again to fade back in at the start.
    readyMinFrames: 12, // frames. Shortest wait at the start. After it, the next button PRESS sets the world going (a thumb still down from before must lift first).
    exitFrames: 60, // frames. Pause inside the airlock ("LEVEL CLEAR") before the next level.
  },

  // Lives.
  lives: {
    startLives: 3, // Lives at the start of a run.
    maxLives: 3, // Lives never go above this.
    livesPerLevelClear: 1, // Lives given back for clearing a level.
  },

  // Points.
  score: {
    crystal: 10, // per ore crystal.
    cog: 100, // for the golden cog.
    cinderpeg: 50, // per Cinderpeg destroyed (paid once per level visit).
    arcMoth: 100, // per Arc Moth destroyed (paid once per level visit).
    levelClear: 200, // for entering the airlock.
    lifeLeft: 500, // per life left when the last level is cleared.
  },

  // The camera. Px are art pixels; fractions are of the visible height, measured from the top.
  camera: {
    camLookAheadPx: 32, // px. The hero sits this far behind the middle of the screen, so more is visible ahead.
    camLookShiftSpeed: 0.75, // px/f. How fast the view swings round after a turn. Lower = calmer.
    camDeadzoneHalfW: 12, // px. The hero can move this far either way before the camera follows.
    camAnchorY: 0.6, // Where the hero's feet rest on screen while standing (0 = top, 1 = bottom).
    camVerticalEase: 0.12, // Share of the remaining distance the camera closes each frame when settling vertically. Higher = snappier.
    camAirBandTop: 0.15, // In mid-air the camera only moves if the hero rises above this line...
    camAirBandBottom: 0.78, // ...or drops below this one, so ordinary jumps do not shake the view.
    camPassGlideSpeed: 3, // px/f. When the touch buttons come back (a touch after a key press), the view glides out past a side wall at this pace to make room for them: 80 px in under half a second. Higher = quicker, but more of a jump.
    camPadClearPx: 16, // px. On a touch screen the hero's feet rest at least this far (a tile) above the buttons of the bottom row, so the floor beside him is never under a thumb. More shows a pit's depth, but hides as much above him.
    camRiseBandTop: 0.45, // While THRUST is held the top line of the air band slides down to this share of the view (under the top bar), so a flying hero sees 3 tiles above his head.
    camRiseLookSpeed: 1.5, // px/f. How fast that line slides down while thrusting, and back up afterwards. Lower = calmer.
    camVerticalMaxStep: 4, // px/f. The vertical ease never moves the view more than this in one frame (no lurch after a long climb).
  },

  // How much of the level is visible. In tiles.
  view: {
    viewMinCols: 17, // The picture is enlarged as far as possible while still showing at least this many tiles across...
    viewMinRows: 10, // ...and this many down. Lower = bigger pixels, less overview.
    viewMaxCols: 30, // Never show more than this many tiles across (large screens get borders instead)...
    viewMaxRows: 14, // ...or down.
  },

  // On-screen touch buttons. In CSS pixels, the browser's own unit (a phone held sideways is 320 to 430 of them tall),
  // measured from the screen's safe edges.
  touch: {
    moveButtonSize: 64, // LEFT and RIGHT squares.
    moveMarginSide: 20, // Gap between LEFT and the left screen edge.
    moveMarginBottom: 20, // Gap between both and the bottom edge.
    moveButtonGap: 12, // Gap between LEFT and RIGHT.
    moveZoneWidth: 196, // Touches this far in from the left edge...
    moveZoneHeight: 128, // ...and this far up from the bottom count as LEFT or RIGHT, even beside the buttons.
    moveSplitHysteresis: 6, // A thumb resting between LEFT and RIGHT must cross the middle by this much to switch.
    jumpButtonSize: 76, // JUMP circle.
    jumpMarginSide: 20, // Gap between JUMP and the right edge.
    jumpMarginBottom: 20, // Gap between JUMP and the bottom edge.
    fireButtonSize: 60, // FIRE circle (shown only while holding the blaster).
    fireMarginSide: 182, // FIRE sits this far from the right edge (left of THRUST, on the bottom row).
    fireMarginBottom: 20, // Gap between FIRE and the bottom edge.
    thrustButtonSize: 60, // THRUST circle (shown only while wearing the pack).
    thrustMarginSide: 110, // THRUST sits this far from the right edge (just left of JUMP, so a thumb slides from JUMP onto it).
    thrustMarginBottom: 20, // Gap between THRUST and the bottom edge. Every action button stays on the bottom row, below the hero's
    // feet line: above it (where THRUST sat until 24 Nov 2026, 110 up) a button covers the hero's own row 8 to 10 tiles ahead,
    // which is where a long flight lands and where its mid-air pack floats.
    actionZoneSize: 250, // Touches inside this bottom-right square go to the nearest shown action button.
    pauseButtonSize: 36, // PAUSE as drawn...
    pauseHitSize: 56, // ...and the larger area that counts as touching it.
    pauseMarginTop: 10, // Gap between PAUSE and the top edge.
    pauseMarginSide: 12, // Gap between PAUSE and the right edge.
    opacityIdle: 0.35, // How solid the buttons look when not pressed (0 = invisible, 1 = solid).
    opacityPressed: 0.6, // ...while pressed.
    opacityDimmed: 0.15, // ...when unusable right now (bolt still flying, tank empty).
    pressedScale: 0.94, // A pressed button shrinks to this size.
    appearMs: 150, // Milliseconds for FIRE and THRUST to fade in when the item is picked up.
    vibrateDeathMs: 60, // Milliseconds of vibration on death (phones that support it).
    vibrateCogPulseMs: 30, // Length of each of the two pulses for the golden cog...
    vibrateCogGapMs: 40, // ...and the pause between them.
    vibrateEmptyTankMs: 15, // Length of the tick when the tank runs dry.
  },

  // Feedback added on top of the game: shake, freeze frames, how long messages stay. None of it changes what happens
  // in the game. Frames are 1/60 s. Players who ask their phone for reduced motion get no shake at all.
  effects: {
    killHitStopFrames: 3, // frames. The picture freezes this long when an enemy is destroyed. 0 = no freeze.
    shakeDeathPx: 2, // px. How far the screen shakes on a death...
    shakeDeathFrames: 12, // frames. ...and for how long.
    shakeKillPx: 1, // px. Shake when an enemy is destroyed...
    shakeKillFrames: 6, // frames. ...and for how long.
    shakeLandPx: 1, // px. Shake on a hard landing...
    shakeLandFrames: 4, // frames. ...for how long...
    shakeLandMinFallTiles: 5, // tiles. ...and how far the fall must be to count as hard.
    introFrames: 90, // frames. How long the level's name and hint stay before play (1.5 s)...
    introSkipAfterFrames: 20, // frames. ...and how soon a press may skip them.
    toastFrames: 90, // frames. How long "COG FOUND! AIRLOCK OPEN" stays.
    crystalLadderFrames: 45, // frames. Crystals taken this close together play rising notes.
  },

  // Frame pacing. Rarely needs changing.
  pacing: {
    maxStepsPerFrame: 5, // On a slow phone the game may catch up this many frames at once; beyond that it slows down instead.
    interpolateBelowMs: 14, // Screens that refresh faster than this (90 and 120 Hz) get in-between frames drawn for smoothness.
  },
};
