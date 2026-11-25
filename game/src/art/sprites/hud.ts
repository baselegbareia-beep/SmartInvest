/**
 * Top bar: hud_* (docs/ART-AND-SOUND.md, sections 4 and 8).
 *
 * The frames of these sprites are states, not animations:
 * hud_life 0 lit, 1 dark; hud_cog 0 outline, 1 gold, 2 unlit (rust); hud_pip 0 lime, 1 slate.
 * The bar is one row at y = 3 to 11, so everything is at most 8 px tall. It lies over
 * the game, often over the steel of the top wall, so every icon must read on steel as
 * well as on space: the cog still to be found is an earthlight outline with an open
 * middle, and nothing has a void middle (look rule 3).
 *
 * To see your work:  node src/art/tools/preview.ts sheet hud --zoom 8 <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

/** Sprue's rim and lamp eye: a life in hand. The lamp sits in a char socket, as on the hero. */
const LIFE_LIT: Frame = [
  '........',
  '78888889',
  '.aaaaaa.',
  '.88bbb0.',
  '.88bg70.',
  '.89bgg0.',
  '..899a..',
  '..9add..',
];

/** The same, burnt out: a life lost. */
const LIFE_DARK: Frame = [
  '........',
  '33333332',
  '.222222.',
  '.331110.',
  '.331220.',
  '.321220.',
  '..3222..',
  '..2222..',
];

/**
 * The cog still to be found: the gold cog's outline in earthlight, open in the middle,
 * with a little slate on the lower right. It reads over steel (3.7) and over space (10.4).
 * (A slate ring round a void middle was a black square over the ceiling.)
 */
const COG_OUTLINE: Frame = [
  '6..66..6',
  '.666666.',
  '.6....6.',
  '66....66',
  '66....63',
  '.6....6.',
  '.666663.',
  '6..63..6',
];

/** The golden cog, found. */
const COG_GOLD: Frame = [
  'c..cc..c',
  '.7ccccc.',
  '.cccccd.',
  'ccc00ccd',
  'ccc00cdd',
  '.cccccd.',
  '.cddddd.',
  'd..dd..d',
];

/**
 * The cog still to be found, as the bar shows it: the gold cog's own filled shape, unlit, all `rust` (the gold lane
 * darkened). A frame of its own, not a tint of COG_GOLD: Phaser's Canvas renderer ignores tints, and there the slot
 * showed the gold cog all through the level, as if taken.
 */
const COG_UNLIT: Frame = COG_GOLD.map((row) => row.replace(/[^.]/g, 'a'));

/** The bolt blaster: steel with a lime coil. */
const BLASTER: Frame = [
  '........',
  '..g.g...',
  '76g6g667',
  '65h5h650',
  '.65.....',
  '.54.....',
  '.54.....',
  '........',
];

/**
 * The thruster pack, as pickup_thruster draws it: one steel tank with two lime bands, two small fins and one nozzle, a
 * lime pilot flame under it. (It was twin bottles, the THRUST button's glyph, until the pickup became one tank: the
 * bar then showed a pack unlike the one he had picked up; the route watch's second re-check.)
 */
const THRUSTER: Frame = [
  '...66...',
  '..6775..',
  '..gggh..',
  '..6754..',
  '..gggh..',
  '.465543.',
  '.4.53.3.',
  '...gg...',
];

/** A fuel pip, full. */
const PIP_LIME: Frame = [
  'gg',
  'gg',
  'gg',
  'gg',
  'gg',
  'hh',
];

/** A fuel pip, spent. */
const PIP_SLATE: Frame = [
  '33',
  '33',
  '33',
  '33',
  '33',
  '22',
];

export const HUD: SpriteGrids<'hud'> = {
  hud_life: [LIFE_LIT, LIFE_DARK],
  hud_cog: [COG_OUTLINE, COG_GOLD, COG_UNLIT],
  hud_blaster: [BLASTER],
  hud_thruster: [THRUSTER],
  hud_pip: [PIP_LIME, PIP_SLATE],
};
