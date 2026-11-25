/**
 * The top bar as numbers (docs/ART-AND-SOUND.md section 8): what it shows, where each part goes for a
 * view width, and the small clocks of its animations (the score counting up, the lost life blinking,
 * the low-fuel pips blinking). HudScene.ts only draws what these functions say.
 *
 * Pure: no Phaser, no DOM. Positions are art px in view coordinates; clocks count 60 Hz frames.
 */
import { textWidth } from '../art/font';
import { spriteSpec } from '../art/manifest';

/** The level intro card (docs/ART-AND-SOUND.md section 9). */
export interface IntroCard {
  readonly levelNumber: number;
  readonly name: string;
  readonly teaches: string;
  readonly lives: number;
  readonly maxLives: number;
}

/** What the top bar shows. The Play scene keeps one and refills it every frame. */
export interface HudModel {
  lives: number;
  maxLives: number;
  /** 1-based. */
  levelNumber: number;
  score: number;
  hasTrophy: boolean;
  hasBlaster: boolean;
  hasThruster: boolean;
  /** Lit fuel pips, 0 to FUEL_PIPS: the tank rounded up to tenths. */
  fuelPips: number;
  /** The level intro card while it is up, else null. */
  intro: IntroCard | null;
  /**
   * The hero stands in the open airlock (run.phase 'exiting'). The LEVEL CLEAR banner shows for exactly
   * as long as this is true (docs/ART-AND-SOUND.md section 9): from the state, not from a clock, so a
   * pause during the exit cannot let the banner run out before the hero has left.
   */
  exiting: boolean;
}

/** Ten fuel pips (section 8). */
export const FUEL_PIPS = 10;

export function newHudModel(): HudModel {
  return {
    lives: 0,
    maxLives: 0,
    levelNumber: 1,
    score: 0,
    hasTrophy: false,
    hasBlaster: false,
    hasThruster: false,
    fuelPips: 0,
    intro: null,
    exiting: false,
  };
}

/** Lit pips for a tank: `fuel` out of `fuelTicks`, rounded UP to tenths (one tick of fuel still lights a pip). */
export function fuelPips(fuel: number, fuelTicks: number): number {
  if (fuel <= 0 || fuelTicks <= 0) return 0;
  return Math.min(FUEL_PIPS, Math.ceil((fuel * FUEL_PIPS) / fuelTicks));
}

// ---------------------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------------------

const FRAME_MS = 1000 / 60;

/**
 * Whole 60 Hz frames out of the rendered frames' deltas, for the HUD's own clocks (the toast, the
 * life blink, the score count, the pips, the intro shutter). While `held` (the pause menu is up) no
 * frame passes and none is banked, so nothing runs on under the menu or catches up after it: the
 * HUD stands still with the world, as the particles do (Effects.setPaused).
 */
export class FrameClock {
  private carry = 0;

  /** Frames for a rendered frame `deltaMs` long; 0 while `held`, which also drops the part frame carried. */
  advance(deltaMs: number, held: boolean): number {
    if (held || !(deltaMs > 0)) {
      if (held) this.carry = 0;
      return 0;
    }
    this.carry += deltaMs / FRAME_MS;
    const whole = Math.floor(this.carry);
    this.carry -= whole;
    return whole;
  }

  reset(): void {
    this.carry = 0;
  }
}

/** The shown score climbs this much per frame towards the real one (section 8: "counts up 10 per tick"). */
export const SCORE_COUNT_STEP = 10;

/**
 * The score to show after `frames` more frames: up by SCORE_COUNT_STEP a frame, never past the real
 * score. A real score below the shown one (a new session) is shown at once: the bar never counts down; so is
 * the score at a level's start (`levelStart`: its intro card comes up), which no event of this level earned.
 */
export function countScore(shown: number, target: number, frames: number, levelStart = false): number {
  // A level's start (its intro card) shows the score carried into it at once: counting up from 00000 under the
  // card and the ready gate of a CONTINUE (1230 points) looked like points being earned (the route watch).
  if (levelStart || target <= shown) return target;
  return Math.min(target, shown + SCORE_COUNT_STEP * Math.max(0, frames));
}

/** The icon of the life just lost blinks five times (section 8): dark and lit for this many frames each. */
export const LIFE_BLINKS = 5;
export const LIFE_BLINK_FRAMES = 6;
/** Frames the whole blink lasts. */
export const LIFE_BLINK_TOTAL = LIFE_BLINKS * 2 * LIFE_BLINK_FRAMES;

/** A running blink: which icon, and how many frames are left. */
export interface LifeBlink {
  readonly index: number;
  readonly left: number;
}

/** No icon blinking. */
export const NO_BLINK: LifeBlink = { index: -1, left: 0 };

/** The blink that starts when the hero is back with `livesNow` lives: the icon just past the lit ones. */
export function lifeBlink(livesNow: number): LifeBlink {
  return { index: Math.max(0, livesNow), left: LIFE_BLINK_TOTAL };
}

/** The blink `frames` frames later. */
export function advanceBlink(blink: LifeBlink, frames: number): LifeBlink {
  if (blink.left <= 0) return NO_BLINK;
  const left = blink.left - Math.max(0, frames);
  return left > 0 ? { index: blink.index, left } : NO_BLINK;
}

/**
 * Whether life icon `i` (0-based, left to right) is lit: the first `lives` are, except the one
 * blinking, which starts dark and is lit every other LIFE_BLINK_FRAMES, ending dark.
 */
export function lifeLit(i: number, lives: number, blink: LifeBlink): boolean {
  if (i === blink.index && blink.left > 0) {
    const elapsed = LIFE_BLINK_TOTAL - blink.left;
    return Math.floor(elapsed / LIFE_BLINK_FRAMES) % 2 === 1;
  }
  return i < lives;
}

/** The pips blink when this many or fewer are lit (section 8)... */
export const PIPS_LOW = 2;
/** ...shown and hidden for this many frames each. */
export const PIP_BLINK_FRAMES = 8;

/** Whether pip `i` is drawn lit (lime) rather than empty (slate), `clock` frames into the level. */
export function pipLit(i: number, lit: number, clock: number, steady = false): boolean {
  if (i >= lit) return false;
  if (!steady && lit <= PIPS_LOW && Math.floor(clock / PIP_BLINK_FRAMES) % 2 === 1) return false;
  return true;
}

// ---------------------------------------------------------------------------------------
// Layout (section 8)
// ---------------------------------------------------------------------------------------

/** Every part of the bar sits on this row: text and 8 px icons from y = 3 to 11. */
export const BAR_Y = 3;
/** The pips are 6 px tall: one lower, so they are centred on the 8 px icons. */
export const PIP_Y = 4;
export const LIVES_X = 4;
export const LIFE_STEP = 9;
export const LEVEL_X = 36;
/** The right-hand block (cog, blaster, thruster, pips) is this wide... */
export const BLOCK_W = 61;
/** ...and ends this far left of the space kept for the PAUSE button. */
export const BLOCK_GAP = 4;
/** Icons are 8 px, 3 px apart; the pips 2 px wide, 3 px apart. */
export const ICON_PX = 8;
export const ICON_STEP = 11;
export const PIP_W = 2;
export const PIP_STEP = 3;
/** The toast's row, under the bar (section 8). */
export const TOAST_Y = 16;
/**
 * The bar is a band over the world (section 8): a `void` strip from the top of the view down to this many
 * px (the bar's row, its 1 px shadow and a row of air), at STRIP_ALPHA. Without it the level's own crystals
 * and wall tops sat in the bar's row beside the score and the cog, and read as part of the bar.
 */
export const STRIP_H = 14;
/**
 * Half dark is not enough under white text on an earthlight wall top. At 0.7 the brightest art still read as
 * slate shapes behind the words (crystals beside `LEVEL 1`, a truss behind the score) and passed for icons of
 * the bar (the route watch, 24 November 2026); at 0.85 they fade to a hint.
 */
export const STRIP_ALPHA = 0.85;
/**
 * While the `COG FOUND! AIRLOCK OPEN` toast shows, a band of the same dark hangs under the strip behind it,
 * as wide as the words plus TOAST_PAD each side, down to this row: the toast is never gold on busy level art.
 */
export const TOAST_BAND_BOTTOM = 26;
export const TOAST_PAD = 4;
/** Score pop-ups never rise above this row (the strip and a row of air), nor above the toast's band while it shows. */
export const POPUP_TOP = STRIP_H + 2;
export const POPUP_TOP_UNDER_TOAST = TOAST_BAND_BOTTOM + 2;
/**
 * While the hero is drawn under the toast's band (level 10's cog is taken in flight, high in the view: the band and
 * the gold words covered most of him for half of the toast's 1.5 s), the band and its words are drawn at this
 * opacity: he shows through, and the words still read as a shadow of themselves.
 */
export const TOAST_SEE_THROUGH = 0.25;
/** ...and they stay so until he has been clear of it for this many frames, so a hero bobbing at its edge makes no flicker. */
export const TOAST_CLEAR_FRAMES = 12;

/**
 * Whether the toast is drawn see-through now (TOAST_SEE_THROUGH): from the frame the hero's drawn box meets its band
 * until he has been clear of it for TOAST_CLEAR_FRAMES frames. Fed by the HUD every rendered frame (`hero`) and
 * every whole 60 Hz frame of its clock (`advance`, which stands still under the pause menu).
 */
export class ToastFade {
  private clearFor = TOAST_CLEAR_FRAMES;

  /** The hero as drawn this frame (view px; null: not drawn) against the toast's band (null: no toast). */
  hero(hero: Rect | null, band: Rect | null): void {
    if (hero !== null && band !== null && rectsMeet(hero, band)) this.clearFor = 0;
  }

  /** `frames` 60 Hz frames went by. */
  advance(frames: number): void {
    if (frames > 0) this.clearFor = Math.min(TOAST_CLEAR_FRAMES, this.clearFor + frames);
  }

  /** The opacity of the band and its words now: 1, or TOAST_SEE_THROUGH while the hero is (or just was) under it. */
  get alpha(): number {
    return this.clearFor < TOAST_CLEAR_FRAMES ? TOAST_SEE_THROUGH : 1;
  }

  reset(): void {
    this.clearFor = TOAST_CLEAR_FRAMES;
  }
}

/** A rectangle in view px (top-left corner and size). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const rectsMeet = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The toast's band for words `textW` px wide in a view `viewW` px wide: centred, from the strip down to TOAST_BAND_BOTTOM. */
export function toastBand(viewW: number, textW: number): Rect {
  const x = Math.floor((viewW - textW) / 2);
  return { x: x - TOAST_PAD, y: STRIP_H, w: textW + 2 * TOAST_PAD, h: TOAST_BAND_BOTTOM - STRIP_H };
}
/**
 * Nothing of the bar comes closer than this to the glass's side edges, CSS px. Phones round their
 * corners, and Android reports a safe-area inset only for a cutout, never for a rounded corner: on the
 * side without a cutout the canvas starts at the glass's edge, and the first life icon sat about 8 x 6
 * CSS px from the physical corner. Where the canvas already starts further in (a notch's inset, the
 * bars of a wide window) nothing moves.
 */
export const SCREEN_CORNER_CSS = 16;

/**
 * Art px to keep free at one side of the view so that the bar stays SCREEN_CORNER_CSS from the glass's
 * edge, when the canvas starts `edgeGapCss` CSS px in from that edge, at `cssPerArt` CSS px per art px.
 */
export function cornerClearPx(edgeGapCss: number, cssPerArt: number): number {
  const c = cssPerArt > 0 && Number.isFinite(cssPerArt) ? cssPerArt : 1;
  const gap = Number.isFinite(edgeGapCss) ? Math.max(0, edgeGapCss) : 0;
  return Math.max(0, Math.ceil((SCREEN_CORNER_CSS - gap) / c - 1e-9));
}

export interface TopBarLayout {
  readonly y: number;
  /** x of each life icon. */
  readonly lives: readonly number[];
  readonly levelX: number;
  /** x of the five score digits, centred on the view (as five digits always are, so it does not shift while counting). */
  readonly scoreX: number;
  readonly cogX: number;
  readonly blasterX: number;
  readonly thrusterX: number;
  /** x of each pip; their y is PIP_Y. */
  readonly pips: readonly number[];
  /** Where the block starts and ends (the space it holds). */
  readonly blockX: number;
  readonly blockEnd: number;
}

/**
 * The bar for a view `viewW` art px wide, keeping the last `reservePx` free for the PAUSE button.
 * On the smallest phone (284 px, 24 px kept) the gaps between the four groups are 6, 44 and 39 px.
 * `leftClearPx` and `rightClearPx` (cornerClearPx) keep the outer items off a rounded corner: the lives
 * and the level move right together, the block moves left, the score stays centred.
 */
export function topBarLayout(viewW: number, maxLives: number, reservePx: number, leftClearPx = 0, rightClearPx = 0): TopBarLayout {
  const livesX = Math.max(LIVES_X, leftClearPx);
  const lives = Array.from({ length: Math.max(0, maxLives) }, (_, i) => livesX + i * LIFE_STEP);
  const blockEnd = viewW - Math.max(0, reservePx, rightClearPx) - BLOCK_GAP;
  const blockX = blockEnd - BLOCK_W;
  const pipsX = blockEnd - (FUEL_PIPS - 1) * PIP_STEP - PIP_W;
  return {
    y: BAR_Y,
    lives,
    levelX: LEVEL_X + (livesX - LIVES_X),
    scoreX: Math.floor((viewW - textWidth('00000')) / 2),
    cogX: blockX,
    blasterX: blockX + ICON_STEP,
    thrusterX: blockX + 2 * ICON_STEP,
    pips: Array.from({ length: FUEL_PIPS }, (_, i) => pipsX + i * PIP_STEP),
    blockX,
    blockEnd,
  };
}

/**
 * Art px to keep free at the right for the DOM PAUSE button, which is laid out in CSS px from the
 * right edge: its margin and its size, at `cssPerArt` CSS px per art px, rounded up.
 */
export function pauseReservePx(cssPerArt: number, pauseMarginSide: number, pauseButtonSize: number): number {
  const c = cssPerArt > 0 && Number.isFinite(cssPerArt) ? cssPerArt : 1;
  return Math.ceil((pauseMarginSide + pauseButtonSize) / c - 1e-9);
}

/** Width of the life icons' row (for centring the row on the intro card). */
export function livesRowPx(maxLives: number): number {
  const icon = spriteSpec('hud_life').width;
  return maxLives <= 0 ? 0 : (maxLives - 1) * LIFE_STEP + icon;
}
