/**
 * The screens as numbers (docs/ART-AND-SOUND.md section 9): the shutter wipe, the lines of the end
 * screens and when each appears, the intro card and the level-clear banner, and where the title's
 * scenery goes. The scenes (src/shell/scenes) only draw what these functions return.
 *
 * Pure: no Phaser, no DOM. Positions are art px in view coordinates; times are 60 Hz frames.
 */
import type { ColorName } from '../art/palette';

import { LIFE_STEP, livesRowPx } from './hudModel';
import type { IntroCard } from './hudModel';
import { LARGE_TEXT_BELOW, textLinePx, textPx } from './menuLayout';
import type { Rect } from './menuLayout';
import { TEXT, bestLine } from './scenes/strings';

// ---------------------------------------------------------------------------------------
// Shutter wipe
// ---------------------------------------------------------------------------------------

/** "Screens change with a 12-tick shutter wipe" (section 9). */
export const SHUTTER_FRAMES = 12;

/** The two blades of the shutter: one hangs from the top, one stands on the bottom. Heights 0 = open. */
export interface ShutterBlades {
  readonly topH: number;
  readonly bottomY: number;
  readonly bottomH: number;
}

/**
 * The shutter `frame` frames after it began to open: closed at 0 (the blades meet in the middle, the
 * view is all void), open from `frames` on. The blades slow down as they open (ease out) and always
 * stand on whole pixels.
 */
export function shutterBlades(frame: number, viewH: number, frames = SHUTTER_FRAMES): ShutterBlades {
  const t = frames <= 0 ? 1 : Math.min(1, Math.max(0, frame / frames));
  const closed = (1 - t) * (1 - t); // 1 when shut, 0 when open
  const topH = Math.ceil((viewH / 2) * closed);
  const bottomH = Math.ceil((viewH - Math.floor(viewH / 2)) * closed);
  return { topH, bottomY: viewH - bottomH, bottomH };
}

// ---------------------------------------------------------------------------------------
// Lines of text
// ---------------------------------------------------------------------------------------

/** One line of a screen: its words, size, colour, and when it appears. */
export interface ScreenLine {
  readonly text: string;
  readonly scale: 1 | 2 | 3;
  readonly colour: ColorName;
  /** Frames after the screen opened before the line is shown (0: at once). */
  readonly showAt: number;
  /** A line that blinks once shown (`NEW BEST!`). */
  readonly blink: boolean;
}

/** How the session ended, as the End screen is told (the EventRouter's `SessionEnd`). */
export interface EndFacts {
  readonly outcome: 'gameOver' | 'won';
  /** Final score, with the life bonus on a win. */
  readonly score: number;
  readonly lives: number;
  readonly lifeBonus: number;
  /** The best score when the session began; null for a session that is never saved (no best line). */
  readonly previousBest: number | null;
}

/** On the win screen the lines after the heading appear this many frames apart, each with a tick sound (section 9). */
export const WIN_LINE_FRAMES = 30;

/** `NEW BEST!` blinks: shown for this many frames of every BEST_BLINK_PERIOD. */
export const BEST_BLINK_ON = 20;
export const BEST_BLINK_PERIOD = 30;

/** Whether a blinking line is drawn `age` frames after it appeared; `steady` (reduced motion): always, once it has appeared. */
export function blinkShown(age: number, steady = false): boolean {
  if (age < 0) return false;
  return steady || age % BEST_BLINK_PERIOD < BEST_BLINK_ON;
}

/**
 * The lines of the game-over or win screen, top to bottom (section 9). `lifePoints` is the score for
 * each life left (`TUNING.score.lifeLeft`).
 *
 * - Game over: `GAME OVER` (2x, amber: crimson reads at only 1.87 on void), `SCORE 04250`, and the
 *   best line, all at once.
 * - Win: `THE FOUNDRY IS LIT!` (2x, gold) at once, then 30 frames apart `SCORE 06400` (before the
 *   bonus), `LIVES LEFT 3 X 500`, `TOTAL 07900` and the best line.
 * The best line is `NEW BEST!` (blinking) when the score beats the best score as it was when the
 * session began, otherwise `BEST` with the larger of the two; none for an unsaved session.
 */
export function endLines(end: EndFacts, lifePoints: number): ScreenLine[] {
  const line = (text: string, colour: ColorName, showAt = 0, scale: 1 | 2 = 1, blink = false): ScreenLine => ({
    text,
    scale,
    colour,
    showAt,
    blink,
  });
  const lines: ScreenLine[] = [];
  let next = 0;
  if (end.outcome === 'won') {
    lines.push(line(TEXT.won, 'gold', 0, 2));
    next = WIN_LINE_FRAMES;
    lines.push(line(TEXT.score(end.score - end.lifeBonus), 'gold', next));
    next += WIN_LINE_FRAMES;
    lines.push(line(TEXT.livesLeft(end.lives, lifePoints), 'white', next));
    next += WIN_LINE_FRAMES;
    lines.push(line(TEXT.total(end.score), 'gold', next));
    next += WIN_LINE_FRAMES;
  } else {
    lines.push(line(TEXT.gameOver, 'amber', 0, 2));
    lines.push(line(TEXT.score(end.score), 'gold'));
  }
  if (end.previousBest !== null) {
    const best = bestLine(end.score, end.previousBest);
    lines.push(line(best, 'gold', next, 1, best === TEXT.newBest));
  }
  return lines;
}

/** The words of a screen in one string, for the canvas's accessible name (and the browser tests). */
export function screenLabel(lines: readonly string[]): string {
  return lines.filter((l) => l.trim().length > 0).join('. ');
}

// ---------------------------------------------------------------------------------------
// Intro card and level-clear banner (drawn by the HUD scene)
// ---------------------------------------------------------------------------------------

/** A line placed on the view: top-left corner on whole pixels. */
export interface PlacedLine {
  readonly text: string;
  readonly scale: 1 | 2 | 3;
  readonly colour: ColorName;
  readonly x: number;
  readonly y: number;
}

/** Space between the lines of a card. */
export const CARD_LINE_GAP = 5;
/** A card's plate keeps this much room round its contents. */
export const CARD_PAD_X = 12;
export const CARD_PAD_Y = 9;
/** A card's plate is never narrower than this (the pause panel's width). */
export const CARD_MIN_W = 160;

export interface IntroLayout {
  /** The plate behind the card (ui_panel nine-slice). */
  readonly plate: Rect;
  readonly lines: readonly PlacedLine[];
  /** x of each life icon, on the row `livesY`; lit while `i < card.lives`. */
  readonly lives: readonly number[];
  readonly livesY: number;
}

/**
 * The level intro card (section 9), centred in the view: `LEVEL 3` (2x, white), the level's name
 * (lime), its hint (white), and the life icons, on a plate.
 *
 * Where one art px is under LARGE_TEXT_BELOW CSS px (`cssPerArt`; a browser tab with toolbars), the name
 * and the hint are drawn at 2x each if it fits across the view, as the menus' labels are, and `LEVEL 3`
 * at 3x, so the heading keeps its lead, provided the whole card still fits the view. Where the heading
 * cannot grow (too narrow, or the card too tall) the card stays as elsewhere: heading 2x, name and hint 1x.
 */
export function introLayout(viewW: number, viewH: number, card: IntroCard, cssPerArt = 2): IntroLayout {
  const small = cssPerArt > 0 && cssPerArt < LARGE_TEXT_BELOW;
  const fitsAt = (text: string, scale: number): boolean => textPx(text, scale) + 2 * CARD_PAD_X <= viewW;
  const heading = TEXT.level(card.levelNumber);
  const name = card.name.toUpperCase();
  const hint = card.teaches.toUpperCase();
  const large = small && fitsAt(heading, 3);
  const plain: { text: string; scale: 1 | 2 | 3; colour: ColorName }[] = [
    { text: heading, scale: 2, colour: 'white' },
    { text: name, scale: 1, colour: 'lime' },
    { text: hint, scale: 1, colour: 'white' },
  ];
  // A name or hint too wide for one 2x line is wrapped onto two 2x lines at a word boundary (the plate has the room),
  // rather than left at 1x under a 3x heading: level 3's hint was a millimetre tall on a 568 x 232 tab.
  const grown = plain.flatMap((t, i) => {
    if (i === 0) return [t];
    if (fitsAt(t.text, 2)) return [{ ...t, scale: 2 as const }];
    const two = wrapInTwo(t.text, (line) => fitsAt(line, 2));
    return two ? two.map((line) => ({ ...t, text: line, scale: 2 as const })) : [t];
  });
  // The heading grows to 3x only over 2x text: over a 1x name and hint it leads them at 2x already.
  const big = grown.map((t, i) => (i === 0 && grown.some((g, j) => j > 0 && g.scale === 2 && g.text.length > 0) ? { ...t, scale: 3 as const } : t));
  const iconH = 8;
  const heightOf = (lines: readonly { scale: number }[]): number =>
    lines.reduce((h, t) => h + textLinePx(t.scale) + CARD_LINE_GAP, 0) + (card.maxLives > 0 ? iconH : -CARD_LINE_GAP) + 2 * CARD_PAD_Y;
  const nonEmpty = (lines: typeof plain): typeof plain => lines.filter((t) => t.text.length > 0); // a level file may leave out its name or hint
  // Large text only where the heading can lead it and the whole card fits; else the card of a phone in full screen.
  const texts = large && heightOf(nonEmpty(big)) <= viewH ? nonEmpty(big) : nonEmpty(plain);
  const rowW = livesRowPx(card.maxLives);
  const contentW = Math.max(rowW, ...texts.map((t) => textPx(t.text, t.scale)));
  const contentH = texts.reduce((h, t) => h + textLinePx(t.scale) + CARD_LINE_GAP, 0) + (card.maxLives > 0 ? iconH : -CARD_LINE_GAP);
  const plateW = Math.min(viewW, Math.max(CARD_MIN_W, contentW + 2 * CARD_PAD_X));
  const plateH = Math.min(viewH, contentH + 2 * CARD_PAD_Y);
  const plate: Rect = { x: Math.floor((viewW - plateW) / 2), y: Math.floor((viewH - plateH) / 2), w: plateW, h: plateH };
  let y = plate.y + Math.floor((plateH - contentH) / 2);
  const lines: PlacedLine[] = [];
  for (const t of texts) {
    lines.push({ ...t, x: Math.floor((viewW - textPx(t.text, t.scale)) / 2), y });
    y += textLinePx(t.scale) + CARD_LINE_GAP;
  }
  const livesX = Math.floor((viewW - rowW) / 2);
  return { plate, lines, lives: Array.from({ length: Math.max(0, card.maxLives) }, (_, i) => livesX + i * LIFE_STEP), livesY: y };
}

/**
 * `text` split at one space into two lines that both pass `fits`, the longer of the two as short as can be;
 * null when no split fits (or there is no space).
 */
export function wrapInTwo(text: string, fits: (line: string) => boolean): [string, string] | null {
  let best: [string, string] | null = null;
  for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
    const a = text.slice(0, i);
    const b = text.slice(i + 1);
    if (!fits(a) || !fits(b)) continue;
    if (!best || Math.max(a.length, b.length) < Math.max(best[0].length, best[1].length)) best = [a, b];
  }
  return best;
}

/** The level-clear banner's top edge: under the top bar and the toast's row, clear of the hero in the airlock. */
export const BANNER_Y = 26;

export interface BannerLayout {
  readonly plate: Rect;
  /** `LEVEL CLEAR +200` (2x, white). */
  readonly heading: PlacedLine;
  /** `SCORE 01230` (gold), counting up with the top bar: the tally. */
  readonly tally: PlacedLine;
}

/**
 * The level-clear banner (section 9) with the score tally under it: the heading names the bonus, and
 * the tally shows the score as the top bar counts it up (`shownScore`).
 */
export function bannerLayout(viewW: number, viewH: number, bonus: number, shownScore: number): BannerLayout {
  const headingText = TEXT.levelClear(bonus);
  const tallyText = TEXT.score(shownScore);
  const contentW = Math.max(textPx(headingText, 2), textPx(tallyText));
  const contentH = textLinePx(2) + CARD_LINE_GAP + textLinePx(1);
  const plateW = Math.min(viewW, Math.max(CARD_MIN_W, contentW + 2 * CARD_PAD_X));
  const plateH = contentH + 2 * CARD_PAD_Y;
  const y = Math.max(0, Math.min(BANNER_Y, viewH - plateH));
  const plate: Rect = { x: Math.floor((viewW - plateW) / 2), y, w: plateW, h: plateH };
  const top = y + CARD_PAD_Y;
  return {
    plate,
    heading: { text: headingText, scale: 2, colour: 'white', x: Math.floor((viewW - textPx(headingText, 2)) / 2), y: top },
    tally: { text: tallyText, scale: 1, colour: 'gold', x: Math.floor((viewW - textPx(tallyText)) / 2), y: top + textLinePx(2) + CARD_LINE_GAP },
  };
}

// ---------------------------------------------------------------------------------------
// Scenery of the title and the end screens
// ---------------------------------------------------------------------------------------

/** Tile and sprite sizes the scenery is built from (docs/ART-AND-SOUND.md section 4). */
const TILE = 16;
const HERO = 16;
const EARTH = 48;
const RIDGE_W = 64;
const RIDGE_H = 24;
/** The Earth keeps this far from the view's top-left corner; the sound switch has the top right. */
const EARTH_MARGIN = 10;
/** Tiles in Sprue's girder. */
export const GIRDER_TILES = 3;
/** The girder floats this far above the bottom of the view, over the crater ridge. */
const GIRDER_LIFT = 14;
/** Nothing of the scenery comes closer than this to a menu item. */
const CLEARANCE = 3;

export interface Scenery {
  /** Top-left of `backdrop_earth`, or null when the view has no room for it beside the menu. */
  readonly earth: { readonly x: number; readonly y: number } | null;
  /** Top-left of each `backdrop_ridge` copy along the bottom. */
  readonly ridges: readonly { readonly x: number; readonly y: number }[];
  /** The girder's tiles, left to right, or empty when there is no room; Sprue stands on the middle one. */
  readonly girder: readonly { readonly x: number; readonly y: number; readonly frame: string }[];
  /** Sprue's top-left, or null with the girder. */
  readonly hero: { readonly x: number; readonly y: number } | null;
}

/** A menu item as menuLayout knows it: a line of text at a scale, or a tappable row. */
export type InkItem = { readonly kind: 'text'; readonly text: string; readonly scale?: 1 | 2 | 3 } | { readonly kind: 'button' | 'switches' };

/**
 * The part of a menu item's rectangle that is really drawn on: menuLayout gives a text line the whole
 * column's width, but its letters are only `textPx` wide, centred (as `textOrigin` places them).
 * A blank line has no ink: null.
 */
export function inkRect(rect: Rect, item: InkItem): Rect | null {
  if (item.kind !== 'text') return rect;
  if (item.text.trim().length === 0) return null;
  const w = textPx(item.text, item.scale ?? 1);
  return { x: rect.x + Math.floor((rect.w - w) / 2), y: rect.y, w, h: rect.h };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const clearOf = (r: Rect, taken: readonly Rect[]): boolean => taken.every((t) => !overlaps(r, grow(t, CLEARANCE)));

/**
 * Where the title's scenery goes (section 9: stars, Earth, ridge, Sprue idling on a girder), around
 * the menu's items (`taken`, from menuLayout). The Earth sits in the upper left; the girder juts in
 * from the left edge over the ridge, with Sprue on it, facing the title. Either is left out where it
 * would touch a menu item (a very narrow or short view).
 */
export function titleScenery(viewW: number, viewH: number, taken: readonly Rect[]): Scenery {
  const ridgeY = viewH - RIDGE_H;
  const ridges = Array.from({ length: Math.ceil(viewW / RIDGE_W) }, (_, i) => ({ x: i * RIDGE_W, y: ridgeY }));

  const earthRect: Rect = { x: EARTH_MARGIN, y: EARTH_MARGIN, w: EARTH, h: EARTH };
  const earth = clearOf(earthRect, taken) ? { x: earthRect.x, y: earthRect.y } : null;

  // The girder juts in from the left; it slides down to stay clear of the menu, but not into the ridge's foot.
  const girderW = GIRDER_TILES * TILE;
  const girderY = viewH - GIRDER_LIFT - TILE;
  const heroX = TILE + Math.floor((TILE - HERO) / 2);
  const block: Rect = { x: 0, y: girderY - HERO, w: girderW, h: TILE + HERO };
  if (!clearOf(block, taken) || girderY - HERO < 0) return { earth, ridges, girder: [], hero: null };
  const girder = Array.from({ length: GIRDER_TILES }, (_, i) => ({
    x: i * TILE,
    y: girderY,
    // The left end runs off the screen; the right end has its exposed side trimmed.
    frame: i === GIRDER_TILES - 1 ? 'wall_beam_0+r' : 'wall_beam_0',
  }));
  return { earth, ridges, girder, hero: { x: heroX, y: girderY - HERO } };
}

/** The ridge along the bottom of any screen (the end screens have no girder and no Earth beside their lines). */
export function ridgeRow(viewW: number, viewH: number): { x: number; y: number }[] {
  return Array.from({ length: Math.ceil(viewW / RIDGE_W) }, (_, i) => ({ x: i * RIDGE_W, y: viewH - RIDGE_H }));
}

/** A band of the win screen's amber glow: a full-width strip at `alpha`. */
export interface GlowBand {
  readonly y: number;
  readonly h: number;
  readonly alpha: number;
}

/** The glow's strength at the bottom of the view, and the number of steps it fades in. */
const GLOW_ALPHA = 0.32;
const GLOW_BANDS = 6;

/**
 * "The backdrop glows amber" (section 9, win): the lower half of the view in GLOW_BANDS stepped
 * strips, strongest at the bottom, so the furnace light rises behind the ridge. `pulse` (0 to 1)
 * scales it for a slow breathing.
 */
export function glowBands(viewH: number, pulse = 1): GlowBand[] {
  const top = Math.floor(viewH / 2);
  const step = Math.ceil((viewH - top) / GLOW_BANDS);
  const bands: GlowBand[] = [];
  for (let i = 0; i < GLOW_BANDS; i++) {
    const y = top + i * step;
    if (y >= viewH) break;
    bands.push({ y, h: Math.min(step, viewH - y), alpha: (GLOW_ALPHA * (i + 1) * Math.max(0, Math.min(1, pulse))) / GLOW_BANDS });
  }
  return bands;
}

/** The title's name split as it is drawn: the first word at 3x, the rest at 1x (section 7). */
export function splitTitle(title: string): { first: string; rest: string } {
  const [first = '', ...rest] = title.toUpperCase().split(' ').filter((w) => w.length > 0);
  return { first, rest: rest.join(' ') };
}

/** `BEST 07900`: shown on the title once there is a best score. */
export function titleBest(bestScore: number): string | null {
  return bestScore > 0 ? TEXT.best(bestScore) : null;
}
