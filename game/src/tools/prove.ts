/**
 * prove: the level validator on one level file, for level designers. Node only;
 * never part of the game.
 *
 * HOW TO RUN (from the game/ folder; no build step and no extra package; Node
 * 22.18 or newer, the same as src/art/tools/scene.ts):
 *
 *   node src/tools/prove.ts <levels/name.txt> [options]
 *
 * It runs on the owner's live numbers (src/tuning.ts), as tests/levels.test.ts
 * does, and prints in seconds:
 *   - a parse error, with the file's line, and stops there;
 *   - the normal proof and the comfort proof: verdict, the stage that decided
 *     it (safe-start, quick, map, guided), step calls, nodes, the tick the cog
 *     is taken (trophyTick) and the airlock entered (winTick), or on a failure
 *     the cell of the closest approach (stuckAt). A level without packs that
 *     fails always names the reason (its pipeline goes on to the map); one with
 *     packs says 'no-route' or 'budget-exceeded' (--map-first names a reason);
 *   - each "@requires" line: the verdict without that item (it must not be
 *     'proven'; 'budget-exceeded' decides nothing);
 *   - on request, the crystals no state of the enemy-free map collected.
 * The exit code is 0 when everything that ran holds (the comfort proof only
 * counts for level-01 to level-10), 1 otherwise, 2 on a usage error.
 *
 * OPTIONS
 *   --no-comfort          skip the comfort proof
 *   --no-requires         skip the @requires runs
 *   --map-first           run the normal and comfort proofs map first (alwaysMap)
 *   --crystals            also list unreachable crystals (map first, up to 400 M
 *                         step calls: slow on a level with thruster packs)
 *   --script FILE.json    write the winning script, in the shape of e2e/scripts/*.json
 *                         ({ levelId, trophyTick, winTick, runs })
 *   --route FILE.png      draw the route over the whole level (a scene.ts render):
 *                         the centre of the hero tick by tick, white on the ground,
 *                         yellow in the air, cyan while thrusting; a green box at the
 *                         start, gold where the cog is taken, magenta at the airlock,
 *                         red lines for bolts, orange ticks at jumps, the tick number
 *                         every 60 ticks. Without a proof: a red box at stuckAt
 *   --use normal|comfort  which proof --script and --route take (default normal)
 *   --zoom N              screen pixels per art pixel of the route picture (default 2)
 *   --in-project          allow an output path inside game/ (pictures and scripts
 *                         belong in a scratch folder; e2e/scripts/ is the exception)
 *
 * EXAMPLES
 *   node src/tools/prove.ts levels/debug.txt
 *   node src/tools/prove.ts levels/debug.txt --route /tmp/prove/debug-route.png --zoom 3
 *   node src/tools/prove.ts levels/level-01.txt --script e2e/scripts/level-01.json --in-project
 *
 * Why the resolve hook below: the core imports its own files without a file
 * extension, as Vite and TypeScript allow; Node does not. The hook adds ".ts"
 * to such a relative import. It must be installed before the core is loaded,
 * so everything that reaches the core is imported dynamically after it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import type { Cell, GameEvent, InputScript, LevelData, LevelProof, Phys, ValidateOptions } from '../core/types';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript file of ours: resolve it as written.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { compileTuning } = await import('../core/compileTuning.ts');
const { createSession, step } = await import('../core/game.ts');
const { LevelError, parseLevel, withoutItem } = await import('../core/level.ts');
const { inputFromBits } = await import('../core/script.ts');
const { handicap } = await import('../core/validate/handicap.ts');
const { replayScript, validateLevel } = await import('../core/validate/index.ts');
const { COMFORT_OPTIONS, DEFAULT_OPTIONS, REQUIRES_OPTIONS } = await import('../core/validate/options.ts');
const { TUNING } = await import('../tuning.ts');
const scene = await import('../art/tools/scene.ts');
const { levelSeed } = await import('../art/tilePick.ts');
const { encodePng } = await import('../art/tools/png.ts');
const { glyphOf, FONT_ADVANCE } = await import('../art/font.ts');

const USAGE = `usage: node src/tools/prove.ts <levels/name.txt> [options]
  options: --no-comfort  --no-requires  --map-first  --crystals  --script FILE.json  --route FILE.png
           --use normal|comfort  --zoom N  --in-project
The top of src/tools/prove.ts has the full description and examples.`;

const SUB_SHIFT = 8;
const TILE_PX = 16;
const CRYSTALS_MAX_STEP_CALLS = 400_000_000;

function fail(message: string, code = 2): never {
  console.error(`prove: ${message}`);
  process.exit(code);
}

// ---------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------

interface Args {
  readonly file: string;
  readonly comfort: boolean;
  readonly requires: boolean;
  readonly mapFirst: boolean;
  readonly crystals: boolean;
  readonly script: string | null;
  readonly route: string | null;
  readonly use: 'normal' | 'comfort';
  readonly zoom: number;
  readonly inProject: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let file: string | null = null;
  let comfort = true;
  let requires = true;
  let mapFirst = false;
  let crystals = false;
  let script: string | null = null;
  let route: string | null = null;
  let use: 'normal' | 'comfort' = 'normal';
  let zoom = 2;
  let inProject = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = (): string => {
      i += 1;
      return argv[i] ?? fail(`${arg} needs a value\n${USAGE}`);
    };
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--no-comfort') comfort = false;
    else if (arg === '--no-requires') requires = false;
    else if (arg === '--map-first') mapFirst = true;
    else if (arg === '--crystals') crystals = true;
    else if (arg === '--script') script = value();
    else if (arg === '--route') route = value();
    else if (arg === '--in-project') inProject = true;
    else if (arg === '--use') {
      const which = value();
      if (which !== 'normal' && which !== 'comfort') fail(`--use wants normal or comfort, not '${which}'`);
      use = which;
    } else if (arg === '--zoom') {
      const text = value();
      zoom = Number(text);
      if (!Number.isInteger(zoom) || zoom < 1 || zoom > 8) fail(`--zoom wants a whole number from 1 to 8, not '${text}'`);
    } else if (arg.startsWith('--')) fail(`unknown option ${arg}\n${USAGE}`);
    else if (file === null) file = arg;
    else fail(`one level file at a time: '${file}' and '${arg}'\n${USAGE}`);
  }
  if (file === null) fail(`no level file given\n${USAGE}`);
  return { file, comfort, requires, mapFirst, crystals, script, route, use, zoom, inProject };
}

/** An output path, refused inside game/ unless --in-project was given. */
function outputPath(file: string, inProject: boolean): string {
  const resolved = path.resolve(file);
  const projectRoot = path.resolve(import.meta.dirname, '..', '..');
  if (!inProject && !path.relative(projectRoot, resolved).startsWith('..')) {
    fail(`${resolved} is inside the project. Outputs go in a scratch folder; pass --in-project if you really mean it.`);
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

// ---------------------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------------------

const cellText = (cell: Cell | null): string => (cell === null ? 'none' : `col ${cell.col}, row ${cell.row}`);
const millions = (calls: number): string => `${(calls / 1_000_000).toFixed(2)} M`;

function prove(label: string, level: LevelData, phys: Phys, options: Partial<ValidateOptions>): LevelProof {
  const started = performance.now();
  const proof = validateLevel(level, phys, options);
  const ms = Math.round(performance.now() - started);
  const nodes = `${proof.stats.searchNodes} search + ${proof.stats.groundNodes + proof.stats.flightNodes} map nodes`;
  const outcome = proof.verdict === 'proven' ? `trophyTick ${proof.trophyTick}, winTick ${proof.winTick}` : `stuckAt ${cellText(proof.stuckAt)}`;
  console.log(
    `  ${label.padEnd(20)} ${proof.verdict.padEnd(19)} stage ${proof.stage.padEnd(10)} ${millions(proof.stats.stepCalls).padStart(9)} step calls  ${nodes}  ${outcome}  (${ms} ms)`,
  );
  if (proof.verdict === 'proven' && proof.script !== null) {
    const replay = replayScript(level, phys, proof.script);
    if (!replay.won || replay.trophyTick !== proof.trophyTick || replay.winTick !== proof.winTick) {
      console.log(`  ${''.padEnd(20)} THE REPLAY DIFFERS: ${JSON.stringify(replay)}`);
    }
  }
  return proof;
}


// ---------------------------------------------------------------------------------------
// The route picture
// ---------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const YELLOW: Rgb = [255, 222, 64];
const CYAN: Rgb = [64, 224, 255];
const GREEN: Rgb = [64, 255, 96];
const GOLD: Rgb = [255, 186, 0];
const MAGENTA: Rgb = [255, 64, 255];
const RED: Rgb = [255, 56, 56];
const ORANGE: Rgb = [255, 140, 32];
const INK: Rgb = [8, 10, 20];

interface Picture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function plot(pic: Picture, x: number, y: number, color: Rgb): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= pic.width || py >= pic.height) return;
  const at = (py * pic.width + px) * 4;
  pic.data[at] = color[0];
  pic.data[at + 1] = color[1];
  pic.data[at + 2] = color[2];
  pic.data[at + 3] = 255;
}

function dot(pic: Picture, x: number, y: number, size: number, color: Rgb): void {
  const half = size >> 1;
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) plot(pic, x - half + dx, y - half + dy, color);
}

function line(pic: Picture, x0: number, y0: number, x1: number, y1: number, size: number, color: Rgb): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let s = 0; s <= steps; s++) dot(pic, x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, size, color);
}

function box(pic: Picture, x: number, y: number, w: number, h: number, color: Rgb): void {
  line(pic, x, y, x + w - 1, y, 2, color);
  line(pic, x, y + h - 1, x + w - 1, y + h - 1, 2, color);
  line(pic, x, y, x, y + h - 1, 2, color);
  line(pic, x + w - 1, y, x + w - 1, y + h - 1, 2, color);
}

/**
 * Text in the game's pixel font with a dark outline, so it reads on any tile. `scale` screen pixels per
 * font pixel: half the zoom, so labels grow with the picture without hiding it.
 */
function label(pic: Picture, text: string, x: number, y: number, color: Rgb, scale: number): void {
  for (const pass of [0, 1]) {
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const glyph = glyphOf(ch) ?? [];
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          if (row.charAt(gx) !== '#') continue;
          const px = cx + gx * scale;
          const py = y + gy * scale;
          if (pass === 0) {
            for (let oy = -1; oy <= scale; oy++) for (let ox = -1; ox <= scale; ox++) plot(pic, px + ox, py + oy, INK);
          } else {
            for (let oy = 0; oy < scale; oy++) for (let ox = 0; ox < scale; ox++) plot(pic, px + ox, py + oy, color);
          }
        }
      });
      cx += FONT_ADVANCE * scale;
    }
  }
}

/** One tick of the replay: the hero's centre in art pixels, how it moved, and what happened. */
interface RouteTick {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly mode: 'ground' | 'air' | 'thrust';
  readonly events: readonly GameEvent[];
}

function replayRoute(level: LevelData, phys: Phys, script: InputScript): RouteTick[] {
  const game = createSession([level], phys);
  const route: RouteTick[] = [];
  for (const [bits, count] of script.runs) {
    for (let i = 0; i < count; i++) {
      const events: GameEvent[] = [];
      step(game, inputFromBits(bits), events);
      const player = game.run.player;
      route.push({
        tick: game.run.tick,
        x: (player.x + (phys.heroW >> 1)) / 256,
        y: (player.y + (phys.heroH >> 1)) / 256,
        mode: player.thrusting ? 'thrust' : player.onGround ? 'ground' : 'air',
        events,
      });
      if (events.some((event) => event.type === 'levelCompleted' || event.type === 'playerDied')) return route;
    }
  }
  return route;
}

function drawRoute(file: string, level: LevelData, phys: Phys, proof: LevelProof, out: string, zoom: number): void {
  const sceneLevel = scene.readLevel(file);
  const art = scene.renderScene(sceneLevel, {
    tick: 0,
    seed: levelSeed(sceneLevel.id),
    viewW: level.width * TILE_PX,
    viewH: level.height * TILE_PX,
    camX: 0,
    camY: 0,
    ridgeLift: 0,
    things: true,
    decoration: true,
  });
  const pic: Picture = scene.enlarge(art, zoom);
  const z = zoom;
  const textScale = Math.max(1, Math.floor(zoom / 2));
  const say = (text: string, x: number, y: number, color: Rgb): void => {
    label(pic, text, x, y, color, textScale);
  };
  const heroW = (phys.heroW >> SUB_SHIFT) * z;
  const heroH = (phys.heroH >> SUB_SHIFT) * z;
  const heroBox = (x: number, y: number, color: Rgb): void => {
    box(pic, x * z - heroW / 2, y * z - heroH / 2, heroW, heroH, color);
  };

  if (proof.script === null) {
    const stuck = proof.stuckAt;
    if (stuck !== null) {
      box(pic, stuck.col * TILE_PX * z, stuck.row * TILE_PX * z, TILE_PX * z, TILE_PX * z, RED);
      say(`STUCK ${stuck.col},${stuck.row}`, stuck.col * TILE_PX * z, stuck.row * TILE_PX * z - 10 * textScale, RED);
    }
  } else {
    const route = replayRoute(level, phys, proof.script);
    const first = route[0];
    if (first !== undefined) heroBox(first.x, first.y, GREEN);
    const dotSize = Math.max(1, z - 1);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (a === undefined || b === undefined) continue;
      const color = b.mode === 'thrust' ? CYAN : b.mode === 'air' ? YELLOW : WHITE;
      line(pic, a.x * z, a.y * z, b.x * z, b.y * z, dotSize, color);
    }
    for (const point of route) {
      for (const event of point.events) {
        if (event.type === 'jumped') dot(pic, point.x * z, point.y * z + heroH / 2, z + 2, ORANGE);
        else if (event.type === 'boltFired') {
          const reach = (phys.boltRange >> SUB_SHIFT) * z * event.dir;
          line(pic, (event.x >> SUB_SHIFT) * z, (event.y >> SUB_SHIFT) * z, (event.x >> SUB_SHIFT) * z + reach, (event.y >> SUB_SHIFT) * z, 1, RED);
        } else if (event.type === 'enemyKilled') {
          const ex = (event.x >> SUB_SHIFT) * z;
          const ey = (event.y >> SUB_SHIFT) * z;
          line(pic, ex - 4 * z, ey - 4 * z, ex + 4 * z, ey + 4 * z, 2, RED);
          line(pic, ex - 4 * z, ey + 4 * z, ex + 4 * z, ey - 4 * z, 2, RED);
        } else if (event.type === 'trophyCollected') {
          heroBox(point.x, point.y, GOLD);
          say(`COG ${point.tick}`, point.x * z + heroW, point.y * z - heroH, GOLD);
        } else if (event.type === 'levelCompleted') {
          heroBox(point.x, point.y, MAGENTA);
          say(`WIN ${point.tick}`, point.x * z + heroW, point.y * z - heroH, MAGENTA);
        }
      }
      if (point.tick % 60 === 0) {
        dot(pic, point.x * z, point.y * z, z + 2, INK);
        say(String(point.tick), point.x * z + 3, point.y * z + 3, WHITE);
      }
    }
  }
  writeFileSync(out, encodePng(pic.width, pic.height, pic.data));
  console.log(`  route picture: ${out}  ${pic.width} x ${pic.height}`);
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function main(args: Args): number {
  const id = path.basename(args.file).replace(/\.txt$/, '');
  let text: string;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch {
    return fail(`cannot read ${args.file}`);
  }
  let level: LevelData;
  try {
    level = parseLevel(text, id);
  } catch (error) {
    if (error instanceof LevelError) {
      console.log(`PARSE ERROR in ${args.file}\n  ${error.message}`);
      return 1;
    }
    throw error;
  }

  // Refused paths are refused now, not after the proofs have run.
  const scriptOut = args.script === null ? null : outputPath(args.script, args.inProject);
  const routeOut = args.route === null ? null : outputPath(args.route, args.inProject);

  const campaign = /^level-(?:0[1-9]|10)$/.test(id);
  const packs = level.pickups.filter((pickup) => pickup.kind === 'thruster').length;
  console.log(
    `levels/${id}.txt  "${level.name}"  ${level.width} x ${level.height}, ${level.pickups.length} pickups (${packs} packs), ` +
      `${level.enemies.length} enemies, requires: ${level.requires.length === 0 ? 'nothing' : level.requires.join(' and ')}`,
  );

  const phys = compileTuning(TUNING);
  const comfortPhys = compileTuning(handicap(TUNING));
  let ok = true;

  const normal = prove('normal', level, phys, { ...DEFAULT_OPTIONS, alwaysMap: args.mapFirst });
  if (normal.verdict !== 'proven') ok = false;
  let comfort: LevelProof | null = null;
  if (args.comfort) {
    comfort = prove('comfort', level, comfortPhys, { ...COMFORT_OPTIONS, alwaysMap: args.mapFirst });
    if (campaign && comfort.verdict !== 'proven') ok = false;
  }

  if (args.requires) {
    for (const item of level.requires) {
      const without = withoutItem(level, item);
      // As suite (c) of tests/levels.test.ts runs it: with no pack left, the pipeline tries both searches.
      const proof = prove(`without ${item}`, without, phys, REQUIRES_OPTIONS);
      if (proof.verdict === 'proven') {
        ok = false;
        console.log(`  ${''.padEnd(20)} the level says @requires ${item}, but it can be won without it`);
      } else if (proof.verdict === 'budget-exceeded') {
        console.log(`  ${''.padEnd(20)} not decided: the search gave up before it could say`);
      }
    }
  }

  if (args.crystals) {
    const proof = prove('crystals, map first', level, phys, { ...DEFAULT_OPTIONS, alwaysMap: true, maxStepCalls: CRYSTALS_MAX_STEP_CALLS });
    const cells = proof.unreachableCrystals;
    console.log(
      `  unreachable crystals: ${cells === null ? 'not known (the map did not finish)' : cells.length === 0 ? 'none' : cells.map((cell) => `${cell.col},${cell.row}`).join('  ')}`,
    );
  }

  const chosen = args.use === 'comfort' ? comfort : normal;
  const chosenPhys = args.use === 'comfort' ? comfortPhys : phys;
  if (scriptOut !== null) {
    if (chosen === null || chosen.script === null) {
      console.log(`  no script to write: the ${args.use} proof is ${chosen === null ? 'not run' : chosen.verdict}`);
    } else {
      const out = scriptOut;
      const runs = chosen.script.runs.map(([bits, ticks]) => `[${bits},${ticks}]`);
      const rows: string[] = [];
      for (let i = 0; i < runs.length; i += 8) rows.push(`    ${runs.slice(i, i + 8).join(', ')}`);
      const json = `{\n  "levelId": ${JSON.stringify(id)},\n  "trophyTick": ${chosen.trophyTick},\n  "winTick": ${chosen.winTick},\n  "runs": [\n${rows.join(',\n')}\n  ]\n}\n`;
      writeFileSync(out, json);
      console.log(`  script: ${out}  (${chosen.script.runs.length} runs, ${chosen.winTick} ticks)`);
    }
  }
  if (routeOut !== null) {
    if (chosen === null) console.log('  no route to draw: the comfort proof was not run');
    else drawRoute(args.file, level, chosenPhys, chosen, routeOut, args.zoom);
  }
  return ok ? 0 : 1;
}

process.exitCode = main(parseArgs(process.argv.slice(2)));
