/**
 * Every fixed line of text the screens draw, with the size it is drawn at, so that one test can prove
 * each is drawable by the pixel font and fits across the narrowest view (`screenText.test.ts`).
 *
 * The words themselves live in src/shell/scenes/strings.ts (`TEXT`, shared with main.ts's rotate
 * message); this module adds what that list cannot know: which line is drawn at 2x or 3x, and the
 * widest values each line can be given in play (level 10, a five-digit score, every life left). Level
 * names and hints come from the level files and are checked by tests/levels.test.ts; they are drawn at
 * 1x, so the 42-character rule there keeps them inside the view.
 *
 * Pure: no Phaser, no DOM.
 */
import { GAME_TITLE } from '../meta';
import { TUNING } from '../tuning';

import { textPx } from './menuLayout';
import { splitTitle } from './screens';
import { TEXT } from './scenes/strings';

/** A line as drawn: its words and its scale. */
export interface DrawnLine {
  readonly text: string;
  readonly scale: 1 | 2 | 3;
  /** Where it is drawn, for the test's messages. */
  readonly where: string;
}

/** The narrowest view the game ever has, art px (docs/ART-AND-SOUND.md section 7: 272 px). */
export const NARROWEST_VIEW_PX = TUNING.view.viewMinCols * 16;

/** Scores the game can show: none, a small one, the planned maximum, the most five digits hold. */
const SCORES = [0, 10, 7900, 99999] as const;
/** Level numbers: the first and the widest. */
const LEVELS = [1, 10] as const;

/** Every fixed line the shell draws on the canvas, with every value it can take at the edges. */
export function drawnLines(): DrawnLine[] {
  const out: DrawnLine[] = [];
  const add = (where: string, scale: 1 | 2 | 3, ...texts: string[]): void => {
    for (const text of texts) out.push({ text, scale, where });
  };
  const { first, rest } = splitTitle(GAME_TITLE);
  const lifePoints = TUNING.score.lifeLeft;
  const maxLives = TUNING.lives.maxLives;

  // Title
  add('title: first word of the name', 3, first);
  add('title: rest of the name', 1, rest);
  add('title: prompt', 1, TEXT.tapToStart, TEXT.pressToStart);
  add('title: buttons', 1, ...LEVELS.map((n) => TEXT.continueLevel(n)), TEXT.newGame);
  add('title: best score', 1, ...SCORES.map((s) => TEXT.best(s)));
  add('title: no campaign', 1, TEXT.noCampaign);
  // Top bar, toast, intro card, banner
  add('top bar: level', 1, ...LEVELS.map((n) => TEXT.level(n)));
  add('intro card: level', 2, ...LEVELS.map((n) => TEXT.level(n)));
  add('toast', 1, TEXT.cogFound);
  add('level-clear banner', 2, TEXT.levelClear(0), TEXT.levelClear(TUNING.score.levelClear), TEXT.levelClear(9999));
  add('level-clear tally', 1, ...SCORES.map((s) => TEXT.score(s)));
  // Pause
  add('pause: heading', 2, TEXT.paused);
  add('pause: buttons', 1, TEXT.resume, TEXT.restartLevel, TEXT.quitToTitle);
  add('pause: switches', 1, TEXT.sound(true), TEXT.sound(false), TEXT.buzz(true), TEXT.buzz(false));
  // End screens
  add('game over: heading', 2, TEXT.gameOver);
  add('win: heading', 2, TEXT.won);
  add('end: score lines', 1, ...SCORES.flatMap((s) => [TEXT.score(s), TEXT.total(s), TEXT.best(s)]), TEXT.newBest);
  add('win: lives left', 1, ...Array.from({ length: maxLives + 1 }, (_, n) => TEXT.livesLeft(n, lifePoints)));
  add('end: buttons', 1, ...LEVELS.map((n) => TEXT.tryAgain(n)), TEXT.playAgain, TEXT.title);
  // The page's own message, drawn by main.ts into a canvas at up to 3 CSS px per art px (rotateDevicePerArt).
  add('rotate message', 1, TEXT.rotate);
  return out;
}

/** Width of a line in art px at its scale. */
export function lineWidth(line: DrawnLine): number {
  return textPx(line.text, line.scale);
}

/** The rotate message is drawn this many CSS px per art px where the window is wide enough... */
export const ROTATE_CSS_PER_ART = 3;
/** ...and never closer than this to either side of the window, CSS px. */
export const ROTATE_SIDE_GAP_CSS = 8;

/**
 * Device px per art px for the rotate message (a line `textArtPx` art px wide) in a window `cssW` CSS px
 * wide: the whole number nearest ROTATE_CSS_PER_ART CSS px, made smaller until the line fits between the
 * side gaps, and never below 1 (one device pixel per art pixel is the smallest that is still sharp).
 * A fixed 3 CSS px made the 101 px line 337 CSS px wide, wider than a 320 px window.
 */
export function rotateDevicePerArt(cssW: number, dpr: number, textArtPx: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const wanted = Math.max(1, Math.round(ROTATE_CSS_PER_ART * d));
  if (!(textArtPx > 0)) return wanted;
  const fits = Math.floor(((cssW - 2 * ROTATE_SIDE_GAP_CSS) * d) / textArtPx);
  return Math.max(1, Math.min(wanted, fits));
}
