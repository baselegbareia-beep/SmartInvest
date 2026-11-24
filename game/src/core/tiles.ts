/**
 * Tile lookup and the box-against-solid test (docs/ARCHITECTURE.md, section 5.1).
 *
 * The out-of-grid policy lives here and nowhere else: a level is walled on
 * the left, on the right and above, and open below, whatever its file draws.
 */
import * as units from './types';
import type { BoxHitsSolidFn, IsSolidFn, TileAtFn, TileKind } from './types';

// Local copies, read once when the module loads. Under Vitest, where the level proofs
// call step() millions of times, every use of an imported name is a getter call, and
// that made step() about three times slower (docs/ARCHITECTURE.md, section 9.6).
const { Tile, TILE_SHIFT } = units;

export const tileAt: TileAtFn = (level, col, row) => {
  if (col < 0 || col >= level.width || row < 0) return Tile.Solid;
  if (row >= level.height) return Tile.Empty;
  // parseLevel writes only Tile values, and the index is inside the grid after the two checks above.
  return level.tiles[row * level.width + col] as TileKind;
};

export const isSolid: IsSolidFn = (level, col, row) => tileAt(level, col, row) === Tile.Solid;

/**
 * Called several times per tick by everything that moves, so it does not go
 * through tileAt cell by cell: the three solid sides are decided once for the
 * whole box, and the rows below the grid (always empty) are skipped.
 */
export const boxHitsSolid: BoxHitsSolidFn = (level, x, y, w, h) => {
  const colFirst = x >> TILE_SHIFT;
  const colLast = (x + w - 1) >> TILE_SHIFT;
  const rowFirst = y >> TILE_SHIFT;
  const rowLast = (y + h - 1) >> TILE_SHIFT;
  const width = level.width;

  // A box that reaches past the left, right or top edge overlaps a cell that tileAt calls Solid.
  if (colFirst < 0 || colLast >= width || rowFirst < 0) return true;

  const tiles = level.tiles;
  const rowEnd = rowLast < level.height ? rowLast : level.height - 1;
  for (let row = rowFirst; row <= rowEnd; row++) {
    const base = row * width;
    for (let col = colFirst; col <= colLast; col++) {
      if (tiles[base + col] === Tile.Solid) return true;
    }
  }
  return false;
};
