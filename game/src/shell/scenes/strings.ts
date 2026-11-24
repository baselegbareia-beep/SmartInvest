/**
 * Every fixed text the shell draws on screen, in one place (docs/ART-AND-SOUND.md sections 8 and 9),
 * so that one test can prove each is drawable by the pixel font and no longer than a line may be
 * (`strings.test.ts`). Level names and hints come from the level files and are checked by
 * `tests/levels.test.ts`; the game's name comes from src/meta.ts and is checked by src/meta.test.ts.
 *
 * The font has capitals only; every string here is already upper case. Pure: no Phaser.
 */

/** A score as the game shows it: five digits, leading zeros (`00420`). Larger scores show all their digits. */
export function scoreDigits(score: number): string {
  return String(Math.max(0, Math.floor(score))).padStart(5, '0');
}

export const TEXT = {
  // Title
  tapToStart: 'TAP TO START',
  pressToStart: 'PRESS SPACE TO START',
  continueLevel: (levelNumber: number): string => `CONTINUE - LEVEL ${levelNumber}`,
  newGame: 'NEW GAME',
  /** Shown under the title when the build has no campaign level yet (NEW GAME then plays the two test rooms). */
  noCampaign: 'NO LEVELS YET: PLAYING THE TEST ROOMS',
  best: (score: number): string => `BEST ${scoreDigits(score)}`,
  newBest: 'NEW BEST!',

  // Top bar and banners
  level: (levelNumber: number): string => `LEVEL ${levelNumber}`,
  cogFound: 'COG FOUND! AIRLOCK OPEN',
  levelClear: (bonus: number): string => `LEVEL CLEAR +${bonus}`,

  // Pause
  paused: 'PAUSED',
  resume: 'RESUME',
  restartLevel: 'RESTART LEVEL -1 LIFE',
  quitToTitle: 'QUIT TO TITLE',
  sound: (on: boolean): string => (on ? 'SOUND ON' : 'SOUND OFF'),
  buzz: (on: boolean): string => (on ? 'BUZZ ON' : 'BUZZ OFF'),

  // End screens
  gameOver: 'GAME OVER',
  won: 'THE FOUNDRY IS LIT!',
  score: (score: number): string => `SCORE ${scoreDigits(score)}`,
  livesLeft: (lives: number, each: number): string => `LIVES LEFT ${lives} X ${each}`,
  total: (score: number): string => `TOTAL ${scoreDigits(score)}`,
  tryAgain: (levelNumber: number): string => `TRY AGAIN - LEVEL ${levelNumber}`,
  playAgain: 'PLAY AGAIN',
  title: 'TITLE',

  // The page's own message (drawn into a canvas with the same glyphs: lifecycle.ts)
  rotate: 'ROTATE YOUR PHONE',
} as const;

/**
 * The best-score line of an end screen (docs/ARCHITECTURE.md 11.3): `NEW BEST!` when the final score
 * beats the best score as it was when the session began, otherwise `BEST` with the larger of the two.
 * Never compare with the saved best score: the save has already been raised by then.
 */
export function bestLine(score: number, previousBest: number): string {
  return score > previousBest ? TEXT.newBest : TEXT.best(Math.max(previousBest, score));
}
