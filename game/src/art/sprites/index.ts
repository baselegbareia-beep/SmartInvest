/**
 * Every sprite grid of the game, gathered from the group files of this folder.
 *
 * One file per group, each exporting its grids keyed by sprite name:
 *   hero.ts        hero_*, ovl_*, thrust_flame, bolt
 *   things.ts      trophy, door_*, gem_*, pickup_*
 *   enemies.ts     cinderpeg, moth
 *   fx.ts          fx_*
 *   tiles.ts       wall_*, trim_*, fire, coolant_*, spikes
 *   background.ts  bg_*, backdrop_*
 *   hud.ts         hud_*
 *   buttons.ts     btn_*
 *   ui.ts          ui_panel, logo_cog, icon
 *
 * Sizes and frame counts are fixed by src/art/manifest.ts; src/art/art.test.ts checks
 * every grid against it. Artists edit only the group files: this file needs no change
 * when a placeholder is replaced by a drawing.
 *
 * HOW TO DRAW A SPRITE. In its group file, replace the `placeholder(...)` or
 * `seedOnly(...)` call by the frames: a list of frames, each a list of text rows, each
 * character one pixel (a palette code from ../palette.ts, or '.' for transparent).
 *
 *   fx_dust: [
 *     ['.66.', '6666', '6666', '.66.'],   // frame 0: fx_dust_0
 *     ['6..6', '....', '....', '6..6'],   // frame 1: fx_dust_1
 *   ],
 *
 * Draw facing right. Then look at it, at the size the player sees it:
 *
 *   node src/art/tools/preview.ts strip fx_dust /some/scratch/folder/dust.png
 *   node src/art/tools/preview.ts stage hero_idle cinderpeg /some/scratch/folder/stage.png
 *
 * and check it:  npx vitest run src/art   (the test "no placeholder is left" keeps
 * failing until the last placeholder is gone; every other test must pass).
 */
import type { Frame, Sprite } from '../grid.ts';
import { SPRITE_SPECS, findSpriteSpec } from '../manifest.ts';
import type { SpriteName } from '../manifest.ts';

import { BACKGROUND } from './background.ts';
import { BUTTONS } from './buttons.ts';
import { ENEMIES } from './enemies.ts';
import { FX } from './fx.ts';
import { HERO } from './hero.ts';
import { HUD } from './hud.ts';
import { isPlaceholder } from './placeholder.ts';
import { THINGS } from './things.ts';
import { TILES } from './tiles.ts';
import { UI } from './ui.ts';

/** Every sprite by name. A sprite missing from its group file is a compile error here. */
export const SPRITES: Readonly<Record<SpriteName, Sprite>> = {
  ...HERO,
  ...THINGS,
  ...ENEMIES,
  ...FX,
  ...TILES,
  ...BACKGROUND,
  ...HUD,
  ...BUTTONS,
  ...UI,
};

/**
 * The sprites that have no finished drawing yet: flat boxes made by `placeholder()`,
 * and seeds made by `seedOnly()` whose later frames repeat frame 0. Empty when the
 * art is done; the test "no placeholder is left" fails until then.
 */
export const PLACEHOLDERS: ReadonlySet<SpriteName> = new Set(
  SPRITE_SPECS.map((spec) => spec.name).filter((name) => isPlaceholder(SPRITES[name])),
);

/**
 * The grid of one frame by its frame name (`hero_run_2`), or undefined when there is
 * no such frame.
 */
export function frameGrid(frame: string): Frame | undefined {
  const cut = frame.lastIndexOf('_');
  if (cut <= 0) return undefined;
  const spec = findSpriteSpec(frame.slice(0, cut));
  const index = Number(frame.slice(cut + 1));
  if (!spec || !Number.isInteger(index)) return undefined;
  return SPRITES[spec.name][index];
}
