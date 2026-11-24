/**
 * The game's levels, read from `levels/*.txt` at build time (docs/ARCHITECTURE.md, section 2).
 *
 * - CAMPAIGN: every `levels/level-NN.txt` that exists when the game is built, parsed, in number
 *   order. The campaign files are being written one by one, so the game must run with none, some or
 *   all ten of them: nothing here assumes a count.
 * - DEV_LEVELS: the movement room (`test`) and the all-items room (`debug`), opened with
 *   `?level=test` and `?level=debug`. They are committed and unit-tested, so a broken one stops the
 *   build of this module with the parser's message.
 *
 * A campaign file that does not parse is left out and named in CAMPAIGN_PROBLEMS (main.ts prints
 * them as warnings) instead of stopping the whole game: the files arrive while the game is being
 * played and tried, and `tests/levels.test.ts` is the gate that keeps a broken level out of a commit.
 */
import { LevelError, parseLevel } from './core/level';
import type { LevelData } from './core/types';

import debugText from '../levels/debug.txt?raw';
import testText from '../levels/test.txt?raw';

/** `.../level-07.txt` → id `level-07`, number 7. Anything else (`level-07-draft.txt`, `notes.txt`) is not a campaign level. */
const CAMPAIGN_FILE = /(?:^|\/)(level-(\d+))\.txt$/;

export interface Campaign {
  /** The levels in play order. */
  readonly levels: readonly LevelData[];
  /** One sentence per campaign file that was left out because it does not parse. */
  readonly problems: readonly string[];
}

/**
 * Pure: file path → file text (as `import.meta.glob` gives it) to the campaign. Only `level-<digits>.txt`
 * files count; they are ordered by their number (so `level-10` follows `level-09`), and a file that
 * does not parse is left out with its parser message.
 */
export function buildCampaign(files: Readonly<Record<string, string>>): Campaign {
  const found: { id: string; n: number; text: string }[] = [];
  for (const [path, text] of Object.entries(files)) {
    const match = CAMPAIGN_FILE.exec(path);
    const id = match?.[1];
    const digits = match?.[2];
    if (id !== undefined && digits !== undefined) found.push({ id, n: Number(digits), text });
  }
  found.sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const levels: LevelData[] = [];
  const problems: string[] = [];
  for (const file of found) {
    try {
      levels.push(parseLevel(file.text, file.id));
    } catch (error) {
      if (!(error instanceof LevelError)) throw error; // a bug in the parser, not in the level
      problems.push(`left out of the campaign: ${error.message}`);
    }
  }
  return { levels, problems };
}

// Vite reads the files at build time; adding a level file needs a rebuild (or the dev server's reload).
const campaignFiles = import.meta.glob<string>('../levels/level-*.txt', { query: '?raw', import: 'default', eager: true });
const campaign = buildCampaign(campaignFiles);

/** The campaign in play order: whatever `levels/level-NN.txt` files existed at build time. May be empty. */
export const CAMPAIGN: readonly LevelData[] = campaign.levels;

/** Why a campaign file was left out (empty when every file parsed). */
export const CAMPAIGN_PROBLEMS: readonly string[] = campaign.problems;

/** The two development rooms. Never saved; opened with `?level=test` and `?level=debug`. */
export const DEV_LEVELS = {
  test: parseLevel(testText, 'test'),
  debug: parseLevel(debugText, 'debug'),
} as const satisfies Readonly<Record<string, LevelData>>;

/**
 * A level by its id (`test`, `debug`, `level-03`), from the development rooms or the campaign, or
 * undefined. For `?level=` and the test hook.
 */
export function findLevel(id: string): LevelData | undefined {
  if (id === 'test' || id === 'debug') return DEV_LEVELS[id];
  return CAMPAIGN.find((level) => level.id === id);
}
