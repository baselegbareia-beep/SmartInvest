/**
 * TEST SUPPORT ONLY: level fixtures for the validator's tests and the Phase 4
 * gate (docs/ARCHITECTURE.md, sections 9.6 and 12). No game code imports
 * this file. It lives outside a *.test.ts file so that several test files
 * can share it; that also means it follows the core's source rules and may
 * not import testkit.ts (purity.test.ts checks both).
 *
 * The three large rooms are the ones behind the measured costs of section
 * 9.6, drawn by the same rules as the reference fixtures they copy:
 * - threeDecks: 64 x 24, three decks joined by two lifts, 2 packs, 6 enemies,
 *   coolant set into the deck floors (the shape planned for level 9);
 * - openHall: 64 x 24, one open hall with 4 packs, the cog high in a corner,
 *   the airlock beside the start ("there and back"), up to 16 enemies;
 * - capRoom: the open hall at every cap (16 enemies) with 32 crystals more,
 *   loaded like a campaign level, for measuring the cost of step().
 */
import { parseLevel } from '../level';
import type { LevelData } from '../types';

const WIDTH = 64;
const HEIGHT = 24;

type Grid = string[][];

/** A 64 x 24 grid of empty cells framed by walls on the left, the right and the top. */
function framedHall(): Grid {
  return Array.from({ length: HEIGHT }, (_, row) =>
    Array.from({ length: WIDTH }, (_, col) => (row === 0 || col === 0 || col === WIDTH - 1 ? '#' : '.')),
  );
}

function put(grid: Grid, row: number, col: number, char: string): void {
  const line = grid[row];
  if (line === undefined || col < 0 || col >= line.length) throw new RangeError(`fixture: cell ${col},${row} is outside the grid`);
  line[col] = char;
}

function fillRow(grid: Grid, row: number, fromCol: number, toCol: number, char = '#'): void {
  for (let col = fromCol; col <= toCol; col++) put(grid, row, col, char);
}

function levelOf(grid: Grid, id: string, headers: readonly string[] = []): LevelData {
  return parseLevel([...headers, ...grid.map((line) => line.join(''))].join('\n'), id);
}

/**
 * Three decks, snaking: deck 1 east along the floor past spikes and two
 * Cinderpegs, lift A (a 6-tile climb at the east end, a pack at its foot),
 * deck 2 west over two coolant gaps set into its floor under two Arc Moths,
 * lift B (a 6-tile climb at the west end, a pack at its foot), deck 3 east
 * to the cog and the airlock past a sideways moth. With `enemies` false the
 * same room without any enemy.
 */
export function threeDecks(enemies = true): LevelData {
  const g = framedHall();
  fillRow(g, 23, 0, WIDTH - 1);
  fillRow(g, 17, 1, WIDTH - 2);
  fillRow(g, 11, 1, WIDTH - 2);
  // The two lifts: holes in the deck floors.
  fillRow(g, 17, 60, 61, '.');
  fillRow(g, 11, 2, 3, '.');
  put(g, 22, 2, 'P');
  put(g, 22, 5, 'B');
  for (const col of [14, 28, 42]) put(g, 22, col, 'S');
  if (enemies) {
    put(g, 22, 20, 'C');
    put(g, 22, 35, 'C');
  }
  for (const col of [9, 10, 24, 25, 38, 39, 50]) put(g, 21, col, 'G');
  put(g, 22, 58, 'J');
  // Deck 2: coolant set into its floor.
  fillRow(g, 17, 40, 42, 'W');
  fillRow(g, 17, 25, 27, 'W');
  if (enemies) {
    put(g, 13, 41, 'M');
    put(g, 13, 26, 'M');
    put(g, 16, 12, 'C');
  }
  for (const col of [50, 33, 18]) put(g, 15, col, 'G');
  put(g, 16, 5, 'J');
  // Deck 3: two hanging blocks close the sideways moth's lane.
  if (enemies) put(g, 5, 30, 'H');
  put(g, 5, 19, '#');
  put(g, 5, 41, '#');
  put(g, 10, 44, 'T');
  put(g, 10, 52, 'D');
  for (const col of [12, 20, 28, 36]) put(g, 9, col, 'G');
  return levelOf(g, enemies ? 'three-decks' : 'three-decks-no-enemies', ['@requires thruster']);
}

/** Where the open hall's enemies stand, in the order they are added: [row, col, letter]. */
const HALL_ENEMIES = Object.freeze([
  [20, 20, 'M'],
  [10, 34, 'H'],
  [22, 52, 'C'],
  [22, 26, 'C'],
  [12, 18, 'M'],
  [6, 30, 'H'],
  [20, 42, 'M'],
  [22, 36, 'C'],
  [17, 12, 'C'],
  [13, 23, 'C'],
  [15, 37, 'C'],
  [3, 44, 'H'],
  [20, 54, 'M'],
  [12, 54, 'M'],
  [22, 58, 'C'],
  [19, 6, 'H'],
] as const);

function hallGrid(enemyCount: number): Grid {
  const g = framedHall();
  fillRow(g, 23, 0, WIDTH - 1);
  put(g, 22, 2, 'P');
  put(g, 22, 4, 'D');
  // Five floating platforms rising toward the cog in the top right corner.
  fillRow(g, 18, 10, 14);
  fillRow(g, 14, 22, 26);
  fillRow(g, 16, 36, 40);
  fillRow(g, 9, 46, 50);
  fillRow(g, 5, 56, 62);
  put(g, 4, 60, 'T');
  put(g, 22, 8, 'J');
  put(g, 13, 24, 'J');
  put(g, 15, 38, 'J');
  put(g, 8, 48, 'J');
  for (const col of [16, 17, 30, 31, 44]) put(g, 22, col, 'F');
  put(g, 22, 6, 'B');
  for (const [row, col, letter] of HALL_ENEMIES.slice(0, enemyCount)) put(g, row, col, letter);
  return g;
}

/** One open 64 x 24 hall with 4 packs and the first `enemyCount` (0 to 16) enemies of HALL_ENEMIES. */
export function openHall(enemyCount = 4): LevelData {
  return levelOf(hallGrid(enemyCount), `open-hall-${enemyCount}`);
}

/**
 * The open hall at the caps, loaded like a full campaign level: 16 enemies,
 * 4 packs, the blaster and 32 crystals (37 pickups), for measuring step().
 */
export function capRoom(): LevelData {
  const g = hallGrid(HALL_ENEMIES.length);
  let placed = 0;
  // Crystals in empty cells of two rows that no enemy or platform uses.
  for (const row of [2, 21]) {
    for (let col = 3; col < WIDTH - 3 && placed < 32; col += 2) {
      if (g[row]?.[col] === '.') {
        put(g, row, col, 'G');
        placed += 1;
      }
    }
  }
  return levelOf(g, 'cap-room');
}

/**
 * No pack, the blaster required: Cinderpegs in tunnels 1 tile high on the
 * only route (the shape planned for level 5). Proven with the blaster;
 * without it the enemy-free map wins and the search with enemies cannot.
 */
export function tunnels(): LevelData {
  return parseLevel(
    [
      '@requires blaster',
      '########################################################',
      '#...................########............########.......#',
      '#...................########............########.......#',
      '#.P..B.....G........C.......G....G......C.......T....D.#',
      '#################...########...######...########...#####',
      '########################################################',
    ].join('\n'),
    'tunnels',
  );
}
