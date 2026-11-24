import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileTuning } from '../src/core/compileTuning';
import { parseLevel } from '../src/core/level';
import { scriptTicks } from '../src/core/script';
import type { InputScript } from '../src/core/types';
import { replayScript } from '../src/core/validate/index';
import { TUNING } from '../src/tuning';

/**
 * The guard of the campaign's browser scripts: `e2e/scripts/level-01.json` to `level-10.json`, which
 * `e2e/levels.spec.ts` replays in the built game (docs/PLAN.md, Phase 4 exit check). Each file is the
 * level's normal validator proof as `src/tools/prove.ts --script` writes it: `{ levelId, trophyTick,
 * winTick, runs }`, the shape of `e2e/scripts/test.json`.
 *
 * Each file must replay through `replayScript` on the owner's live numbers (`src/tuning.ts`, the numbers
 * the browser plays with, as `tests/levels.test.ts` uses them; not the frozen REFERENCE_PHYS of the
 * rule tests) to a win with no death, the cog on exactly its `trophyTick` and the airlock on exactly
 * its `winTick`, the last tick of the script. A level or a tuning change that breaks a route fails here,
 * in `npx vitest run`, before the browser test would, and the message names the command that writes
 * the file again from the new proof:
 *
 *   node src/tools/prove.ts levels/level-NN.txt --no-comfort --no-requires --script e2e/scripts/level-NN.json --in-project
 *
 * A file whose replay still wins, but on other ticks, fails as well: the browser test compares the ticks.
 */

const LEVELS_DIR = new URL('../levels/', import.meta.url);
const SCRIPTS_DIR = new URL('../e2e/scripts/', import.meta.url);
const CAMPAIGN_ID = /^level-(?:0[1-9]|10)$/;
const CAMPAIGN_IDS = Array.from({ length: 10 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`);
const PHYS = compileTuning(TUNING);

interface LevelScript extends InputScript {
  readonly levelId: string;
  readonly trophyTick: number;
  readonly winTick: number;
}

/** The command that writes `id`'s script again from its normal proof. */
const rewrite = (id: string): string =>
  `node src/tools/prove.ts levels/${id}.txt --no-comfort --no-requires --script e2e/scripts/${id}.json --in-project`;

const idsIn = (dir: URL, extension: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length))
    .filter((id) => CAMPAIGN_ID.test(id))
    .sort();

/** The file as written, or the reason it cannot be read; never throws, so every test can name the fix. */
function readScript(id: string): LevelScript | string {
  try {
    return JSON.parse(readFileSync(new URL(`${id}.json`, SCRIPTS_DIR), 'utf8')) as LevelScript;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

it('there is one script for each of level-01 to level-10, and none for a level that does not exist', () => {
  expect(idsIn(LEVELS_DIR, '.txt'), 'the campaign in levels/').toEqual(CAMPAIGN_IDS);
  const missing = CAMPAIGN_IDS.filter((id) => !idsIn(SCRIPTS_DIR, '.json').includes(id));
  expect(missing, `campaign levels without a browser script; write each with:\n${missing.map(rewrite).join('\n')}`).toEqual([]);
  expect(idsIn(SCRIPTS_DIR, '.json'), 'e2e/scripts/level-*.json').toEqual(CAMPAIGN_IDS);
});

describe.each(CAMPAIGN_IDS)('e2e/scripts/%s.json', (id) => {
  const fix = `\nWrite it again from the level's normal proof, from the game/ folder:\n  ${rewrite(id)}`;
  const read = readScript(id);
  /** The script, or a failure that says why it is unusable and how to write it again. */
  const script = (): LevelScript => {
    if (typeof read === 'string') throw new Error(`e2e/scripts/${id}.json cannot be read: ${read}${fix}`);
    return read;
  };

  it('is a script for its own level in the shape prove.ts writes, idling through the ready gate first', () => {
    const s = script();
    expect(s.levelId, `levelId${fix}`).toBe(id);
    expect(Number.isInteger(s.trophyTick) && s.trophyTick > 0, `trophyTick ${s.trophyTick}${fix}`).toBe(true);
    expect(Number.isInteger(s.winTick) && s.winTick > s.trophyTick, `winTick ${s.winTick} after trophyTick ${s.trophyTick}${fix}`).toBe(true);
    expect(Array.isArray(s.runs) && s.runs.length > 0, `runs${fix}`).toBe(true);
    // Read as JSON, not trusted as typed: each run is exactly [bits, ticks].
    for (const run of s.runs as readonly (readonly unknown[])[]) {
      const [bits, ticks] = run;
      const ok =
        run.length === 2 && typeof bits === 'number' && typeof ticks === 'number' && Number.isInteger(bits) && bits >= 0 && bits < 32 && Number.isInteger(ticks) && ticks > 0;
      expect(ok, `run ${JSON.stringify(run)}: [bits 0 to 31, ticks above 0]${fix}`).toBe(true);
    }
    // The validator's root idles through the ready minimum, which arms the gate (docs/ARCHITECTURE.md, section 6).
    const first = s.runs[0];
    expect(first?.[0], `the first run holds nothing${fix}`).toBe(0);
    expect(first?.[1] ?? 0, `the first run lasts the ready minimum${fix}`).toBeGreaterThanOrEqual(PHYS.readyMinTicks);
    // prove.ts cuts the script at the win: the browser's replay steps exactly winTick ticks.
    expect(scriptTicks(s), `the script's length is its winTick${fix}`).toBe(s.winTick);
  });

  it('replays on the live tuning to a win with no death, the cog and the airlock on exactly its recorded ticks', () => {
    const s = script();
    const level = parseLevel(readFileSync(new URL(`${id}.txt`, LEVELS_DIR), 'utf8'), id);
    const replay = replayScript(level, PHYS, { runs: s.runs });
    expect(
      replay,
      `e2e/scripts/${id}.json no longer wins levels/${id}.txt as recorded (cog ${s.trophyTick}, airlock ${s.winTick}): ` +
        `the level or src/tuning.ts changed since it was written.${fix}`,
    ).toEqual({ won: true, trophyTick: s.trophyTick, winTick: s.winTick, died: null, ticks: s.winTick });
  });
});
