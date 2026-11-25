/**
 * Menus and icon: ui_panel, logo_cog, icon (docs/ART-AND-SOUND.md, sections 4, 9 and 11).
 *
 * - ui_panel is stretched as a nine-slice with 8 px corners: the middle 8 x 8 and the
 *   four 8 px edge strips repeat, so they are plain along their length. Its outer
 *   corners are cut by one pixel (look rule 5). The face is night, so white, lime,
 *   gold and slate text all read on it; the frame is steel, lit from the upper left,
 *   with the warm row underneath.
 * - logo_cog sits behind the first word of the title: frame 1, its shape stamped flat in `indigo` (frame 0 is the
 *   gold-rimmed cog). Drawn as a frame and not as a FILL tint of frame 0, so the Canvas renderer (no WebGL; it
 *   ignores tints) shows the plate too, not the gold cog through the white letters.
 * - icon is the app icon: Sprue's rim and lime eye inside a gold cog on `night`. It is
 *   enlarged by whole numbers (5x to 16x) and may be cut to a circle by the phone, so
 *   what matters sits inside the middle 26 px.
 *
 * To see your work:  node src/art/tools/preview.ts sheet ui --zoom 6 <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

/**
 * A steel-framed plate with riveted corner gussets. Rows 0 to 22 are the plate; row 23
 * is the furnace glow under it. The gussets (rows 3 to 6 and 16 to 19) lie wholly inside
 * the 8 px corners, so nothing of them is stretched: rows 7 to 15 are plain frame.
 */
const PANEL: Frame = [
  '.6666666666666666666666.',
  '655555555555555555555553',
  '653333333333333333333343',
  '653444431111111134444343',
  '653464311111111113464343',
  '653443111111111111344343',
  '653431111111111111134343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653111111111111111111343',
  '653431111111111111134343',
  '653443111111111111344343',
  '653464311111111113464343',
  '653444431111111134444343',
  '653333333333333333333343',
  '654444444444444444444443',
  '.3333333333333333333333.',
  '..dddddddddddddddddddd..',
];

/** The title cog: eight stamped teeth round a hub hole. A gold rim round an indigo face, so that white letters read over it. */
const LOGO_COG: Frame = [
  '................................',
  '..........777......777..........',
  '........77ccc......7cc7c........',
  '........7c22c7....7c22cc........',
  '........7c222c7777c222cc........',
  '.........7c222cccc222cc.........',
  '.........7c2222222222cc.........',
  '........7c222222222222cc........',
  '..777..7c22222222222222cc..ccc..',
  '..7cc77c2222222222222222cccccc..',
  '.7c22cc22222222dd22222222cc22cd.',
  '.7c2222222222dd..dd2222222222dd.',
  '.7cc22222222d......c22222222ddd.',
  '...7c222222d........c222222dd...',
  '....7c22222d........c22222dd....',
  '....7c2222d..........c2222dd....',
  '....7c2222d..........c2222dd....',
  '....7c22222d........c22222dd....',
  '...7c222222d........c222222dd...',
  '.77c22222222c......c22222222ddd.',
  '.7c2222222222cc..cc2222222222dd.',
  '.7c22cc22222222cc22222222dd22dd.',
  '..7ccccc2222222222222222dddddd..',
  '..ccc..cc22222222222222dd..ddd..',
  '........cc222222222222dd........',
  '.........cc2222222222dd.........',
  '.........cc222dddd222dd.........',
  '........cc222dddddd222dd........',
  '........cc22dd....dd22dd........',
  '........cccdd......ddddd........',
  '..........ddd......ddd..........',
  '................................',
];

/**
 * The app icon: Sprue's rim and lamp eye inside the golden cog, on night. The lamp sits
 * in a char socket as on the hero, with void only where the body meets the night.
 */
const ICON: Frame = [
  '11111111111111111111111111111111',
  '111111111177d11111177c1111111111',
  '1111111177cccc11117ccc7c11111111',
  '111111117ccccd11117ccccd11111111',
  '111111117ccccc7777cccccd11111111',
  '111111117ccccccccccccccd11111111',
  '111111117cccccddddcccccd11111111',
  '11111117ccccdd1111cdccccc1111111',
  '1177777cccdd11111111cdcccccccc11',
  '117ccccccd111111111111cccccccd11',
  '17ccccccd77888888888899cccccccc1',
  '17ccccccd1aaaaaaaaaaaa1cccccccd1',
  '1dcccccd11888888bbbbb011ccccccd1',
  '11cdcccd11788888bgg7b011ccccdd11',
  '11117cd111888889bgggb0111ccd1111',
  '11117cd111888899bgggb0111ccd1111',
  '11117cd111888999bbbbb0111ccd1111',
  '11117cd11118899999aa01111ccd1111',
  '1177cccc11189999aaad0111cccddd11',
  '17cccccd1111a999aadd1111ccddddd1',
  '17ccccccc1110adddddd011ccdddddd1',
  '1cccccccd11111111111111cddddddd1',
  '117ccccccc111111111111cddddddd11',
  '11cddddccccc11111111ccdddddddd11',
  '1111111ccccccc1111cccdddd1111111',
  '11111111ccccccccccccdddd11111111',
  '11111111cccccccccccddddd11111111',
  '11111111ccccccdddddddddd11111111',
  '11111111cccccd1111dddddd11111111',
  '11111111cdcccd1111dddddd11111111',
  '1111111111cdd111111ddd1111111111',
  '11111111111111111111111111111111',
];

export const UI: SpriteGrids<'ui'> = {
  ui_panel: [PANEL],
  logo_cog: [LOGO_COG, LOGO_COG.map((row) => row.replace(/[^.]/g, '2'))],
  icon: [ICON],
};
