/**
 * Enemies: cinderpeg, moth (docs/ART-AND-SOUND.md, section 4).
 *
 * Red and amber mean danger. Nothing that can kill may be mostly `char` (it has a
 * contrast of 1.3 against the backdrop): the Cinderpeg's body is rust with amber and
 * red cracks, the moth's wings are earthlight.
 *
 * Both fill their cell: a bolt hits the whole tile, and the touch box is the middle of
 * it (TUNING.forgiveness.enemyTouchInsetPx), so the edges may be thin but not empty.
 *
 * Drawn facing right; the game mirrors the frame when `dir < 0`.
 *
 * To see your work:  node src/art/tools/preview.ts strip cinderpeg <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

/**
 * A lump of fused slag on four peg legs, wedge-shaped, taller in front. A cold glint of
 * Earthlight on the upper-left slopes, tan on the crests, rust below; two molten seams
 * run slantwise from its back down towards its front foot, and a flat amber glow lights
 * its underside. Gold is for the two ember eyes alone. The seams pulse (mid, bright with
 * a white core, mid, dim red) and the legs step in pairs. Rust is the main colour and
 * char only a tenth, so it never sinks into the backdrop. (A jagged band of cracks under
 * the eyes was tried first: with a dark brow over the eyes it read as a toothy grin.)
 */
const CINDERPEG_0: Frame = [
  '................',
  '..........59....',
  '....69...9aa9...',
  '...6aa9.9aaaa9..',
  '..5eaaa9aaaaaab.',
  '.9aadeaaaaaaaab0',
  '.9aaaddaacaaacb0',
  '9eaaaaddaccaccb0',
  '9adeaaadeaaaabb0',
  'aaaddaaaaaaaaab0',
  'aabadddaaaaaaab0',
  '0abbbaddeaaaaab0',
  '.0bdddddddddb00.',
  '..00000000000...',
  '..54.54..54.54..',
  '.....54.....54..',
];

const CINDERPEG_1: Frame = [
  '................',
  '..........59....',
  '....69...9aa9...',
  '...6aa9.9aaaa9..',
  '..5daaa9aaaaaab.',
  '.9aaddaaaaaaaab0',
  '.9aaa7daacaaacb0',
  '9daaaa7daccaccb0',
  '9addaaaddaaaabb0',
  'aaa7daaaaaaaaab0',
  'aaba77daaaaaaab0',
  '0abbba7ddaaaaab0',
  '.0bdddddddddb00.',
  '..00000000000...',
  '..54.54..54.54..',
  '..54.54..54.54..',
];

const CINDERPEG_2: Frame = [
  '................',
  '..........59....',
  '....69...9aa9...',
  '...6aa9.9aaaa9..',
  '..5eaaa9aaaaaab.',
  '.9aadeaaaaaaaab0',
  '.9aaaddaacaaacb0',
  '9eaaaaddaccaccb0',
  '9adeaaadeaaaabb0',
  'aaaddaaaaaaaaab0',
  'aabadddaaaaaaab0',
  '0abbbaddeaaaaab0',
  '.0bdddddddddb00.',
  '..00000000000...',
  '..54.54..54.54..',
  '..54.....54.....',
];

const CINDERPEG_3: Frame = [
  '................',
  '..........59....',
  '....69...9aa9...',
  '...6aa9.9aaaa9..',
  '..5faaa9aaaaaab.',
  '.9aaefaaaaaaaab0',
  '.9aaaeeaacaaacb0',
  '9faaaaeeaccaccb0',
  '9aefaaaefaaaabb0',
  'aaaeeaaaaaaaaab0',
  'aabaeeeaaaaaaab0',
  '0abbbaeefaaaaab0',
  '.0bdddddddddb00.',
  '..00000000000...',
  '..54.54..54.54..',
  '..54.54..54.54..',
];

/**
 * A feral welding drone, shaped like a moth: two earthlight plate wings, each cut into
 * a fore and a hind lobe, every tip dipped in furnace red (the same red as the spike
 * tips: red tips kill); a thin dark body of slate and indigo edged in char, with one
 * red sensor facing forward; a crackling amber arc under its torch, with white sparks
 * and red at both ends. Earthlight falls on the left wing; the right one is a shade
 * darker. The wings beat up, spread, down, spread; the arc is different in every frame.
 * No gold (the cog's colour) and no tan or rust (Sprue's): the only warm part is the arc.
 */
const MOTH_0: Frame = [
  'e7............6e',
  'e66..........66e',
  '5666........6665',
  '56666..22..66665',
  '.56666b32b66665.',
  '.55666b3eb66655.',
  '..5556b32b6555..',
  '...355b32b553...',
  '...e65b32b56e...',
  '....33b22b33....',
  '.......55.......',
  '.......7d.......',
  '......ddd.......',
  '.......d7d......',
  '......ddd.......',
  '....e..d...e....',
];

const MOTH_1: Frame = [
  '................',
  '................',
  '.e766......666e.',
  'e76666.22.66666e',
  '566666b32b666665',
  '.55556b3eb65555.',
  '..3556b32b6553..',
  '..5665b32b5665..',
  '.e665.b32b.566e.',
  '..e33.b22b.33e..',
  '.......55.......',
  '.......d7.......',
  '.......ddd......',
  '......d7d.......',
  '.......ddd......',
  '.....e..d..e....',
];

const MOTH_2: Frame = [
  '................',
  '................',
  '................',
  '.......22.......',
  '......b32b......',
  '....66b3eb66....',
  '..6666b32b6666..',
  '.66555b32b55566.',
  '6665..b32b..5666',
  '665...b22b...566',
  'e55....55....55e',
  'e3.....77.....3e',
  '......dddd......',
  '.....dd..dd.....',
  '.....d....d.....',
  '....e......e....',
];

const MOTH_3: Frame = [
  '................',
  '................',
  '.e766......666e.',
  'e76666.22.66666e',
  '566666b32b666665',
  '.55556b3eb65555.',
  '..3556b32b6553..',
  '..5665b32b5665..',
  '.e665.b32b.566e.',
  '..e33.b22b.33e..',
  '.......55.......',
  '.......d7.......',
  '......ddd.......',
  '.......d7d......',
  '......d.dd......',
  '...e.....d.e....',
];

export const ENEMIES: SpriteGrids<'enemies'> = {
  cinderpeg: [CINDERPEG_0, CINDERPEG_1, CINDERPEG_2, CINDERPEG_3],
  moth: [MOTH_0, MOTH_1, MOTH_2, MOTH_3],
};
