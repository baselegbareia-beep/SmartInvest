/**
 * A level's tiles on screen (docs/ARCHITECTURE.md 11.2, docs/ART-AND-SOUND.md section 6,
 * docs/PHASER4-NOTES.md section 5): three CPU TilemapLayers built from `LevelData` once per level.
 *
 *   panels  depth -3  far-wall panels (decorate)
 *   decor   depth -2  chains, vents, pipes, braces, portholes over the panels (decorate)
 *   solid   depth  0  walls, with the variant and side trims of wallPick baked into one tile picture,
 *                      and the hazards, animated by swapping tile pictures (hazardPick, hazardFrame)
 *
 * Every choice comes from src/art/tilePick.ts, the same functions as the art's scene tool, so a level
 * looks the same in both. Tile numbers are positions on the tile sheet (`tileIndex`); -1 is empty.
 */
import * as Phaser from 'phaser';

import { TEXTURE_KEY, TILE_SIZE } from '../art/manifest';
import { tileIndex, wallFrameName } from '../art/pixels';
import { decorate, hazardFrameIndex, hazardPick, levelSeed, occupiedCells, wallPick } from '../art/tilePick';
import type { HazardPick } from '../art/tilePick';
import type { LevelData } from '../core/types';

/** Draw depths of the three layers (the backdrop is below them, things and the hero above). */
export const TILE_DEPTH = { panels: -3, decor: -2, solid: 0 } as const;

interface AnimatedCell {
  readonly col: number;
  readonly row: number;
  readonly pick: HazardPick;
  /** The tile number of each frame of the hazard's sprite. */
  readonly tiles: readonly number[];
  /** The frame index on screen now. */
  shown: number;
}

export class TileLayer {
  private readonly maps: Phaser.Tilemaps.Tilemap[] = [];
  private readonly solid: Phaser.Tilemaps.TilemapLayer;
  private readonly animated: AnimatedCell[] = [];

  constructor(scene: Phaser.Scene, level: LevelData) {
    const { width, height } = level;
    const empty = (): number[][] => Array.from({ length: height }, () => Array.from({ length: width }, () => -1));
    const panels = empty();
    const decor = empty();
    const solid = empty();

    const decoration = decorate(level, levelSeed(level.id), occupiedCells(level));
    for (let row = 0; row < height; row++) {
      const panelRow = panels[row];
      const decorRow = decor[row];
      const solidRow = solid[row];
      if (!panelRow || !decorRow || !solidRow) continue;
      for (let col = 0; col < width; col++) {
        const wall = wallPick(level, col, row);
        if (wall) {
          solidRow[col] = tileIndex(wallFrameName(wall.sprite, wall.trimLeft, wall.trimRight));
          continue;
        }
        const pick = decoration.at(col, row);
        if (pick.panel) panelRow[col] = tileIndex(pick.panel);
        if (pick.over) decorRow[col] = tileIndex(pick.over.frame, pick.over.cellX, pick.over.cellY);
        const hazard = hazardPick(level, col, row);
        if (hazard) {
          const tiles = Array.from({ length: hazard.frames }, (_, i) => tileIndex(`${hazard.sprite}_${i}`));
          const shown = hazardFrameIndex(hazard, 0);
          solidRow[col] = tiles[shown] ?? -1;
          this.animated.push({ col, row, pick: hazard, tiles, shown });
        }
      }
    }

    this.layer(scene, panels, TILE_DEPTH.panels);
    this.layer(scene, decor, TILE_DEPTH.decor);
    this.solid = this.layer(scene, solid, TILE_DEPTH.solid);
  }

  /** Swaps the hazards' pictures to their frame at `tick` (run.tick). Cheap: only cells whose frame changed are touched. */
  update(tick: number): void {
    for (const cell of this.animated) {
      const index = hazardFrameIndex(cell.pick, tick);
      if (index === cell.shown) continue;
      cell.shown = index;
      // false: skip the collision-face update the game does not use (docs/PHASER4-NOTES.md section 5).
      this.solid.putTileAt(cell.tiles[index] ?? -1, cell.col, cell.row, false);
    }
  }

  destroy(): void {
    for (const map of this.maps) map.destroy();
    this.maps.length = 0;
    this.animated.length = 0;
  }

  private layer(scene: Phaser.Scene, data: number[][], depth: number): Phaser.Tilemaps.TilemapLayer {
    const map = scene.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    this.maps.push(map);
    const tileset = map.addTilesetImage(TEXTURE_KEY.tiles, TEXTURE_KEY.tiles, TILE_SIZE, TILE_SIZE, 0, 0);
    if (!tileset) throw new Error('TileLayer: the tile sheet is missing (BootScene builds it)');
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!(layer instanceof Phaser.Tilemaps.TilemapLayer)) throw new Error('TileLayer: no CPU tilemap layer');
    layer.setDepth(depth);
    return layer;
  }
}
