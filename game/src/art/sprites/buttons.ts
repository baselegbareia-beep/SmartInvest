/**
 * Touch buttons: btn_* (docs/ART-AND-SOUND.md, sections 4 and 10).
 *
 * These are the glyphs inside the round and square DOM buttons, drawn onto a small
 * canvas at 2 or 3 CSS px per art px on a `night` fill. There are no labels: the
 * glyph is the label, so each must be readable on its own, large and half
 * transparent over the game. Hence flat, bold shapes with strokes 3 or 4 px thick.
 * White: btn_arrow (flipped for LEFT), btn_jump, btn_pause. Lime: btn_fire, btn_thrust.
 * btn_sound and btn_vibe: frame 0 is on (white), frame 1 is off (light steel).
 *
 * To see your work:  node src/art/tools/preview.ts sheet buttons --zoom 6 <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

/** A chevron pointing right; mirrored for LEFT. */
const ARROW: Frame = [
  '................',
  '....777.........',
  '....7777........',
  '.....7777.......',
  '......7777......',
  '.......7777.....',
  '........7777....',
  '.........7777...',
  '.........7777...',
  '........7777....',
  '.......7777.....',
  '......7777......',
  '.....7777.......',
  '....7777........',
  '....777.........',
  '................',
];

/**
 * An up chevron over a thin bar: off the ground. The bar is short and two rows thin, with
 * a wide gap above it, so it is the ground being left. (A bar as wide as the chevron and
 * four rows thick made the Eject symbol.)
 */
const JUMP: Frame = [
  '................',
  '................',
  '.......77.......',
  '......7777......',
  '.....777777.....',
  '....77777777....',
  '...7777..7777...',
  '..7777....7777..',
  '.7777......7777.',
  '.777........777.',
  '................',
  '................',
  '................',
  '...7777777777...',
  '...7777777777...',
  '................',
];

/** A bolt in flight: a lime dash with a white core and three streaks behind it. */
const FIRE: Frame = [
  '................',
  '................',
  '................',
  '................',
  '......gggggggg..',
  '.gg..gggggggggg.',
  '....ggg7777777gg',
  '.ggggg777777777g',
  '.ggggg777777777g',
  '....ggg7777777gg',
  '.gg..gggggggggg.',
  '......gggggggg..',
  '................',
  '................',
  '................',
  '................',
];

/**
 * A flame under a bottle, twice: the twin bottles of the pack (pickup_thruster and
 * hud_thruster) joined by their strap, each lit down its left side, and under each
 * nozzle a long flame with a white core that tapers to a point. (A single bottle with a
 * T valve read as a helicopter, a bell or a little robot; a single bottle with a
 * teardrop flame read as a carrot; one wide plume under the pair read as a face.)
 */
const THRUST: Frame = [
  '...ggg....ggg...',
  '..g7ggg..g7ggg..',
  '..g7gggggg7ggg..',
  '..g7gggggg7ggg..',
  '..g7ggg..g7ggg..',
  '..ggggg..ggggg..',
  '...ggg....ggg...',
  '................',
  '..g777g..g777g..',
  '..g777g..g777g..',
  '..g777g..g777g..',
  '..gg7gg..gg7gg..',
  '...g7g....g7g...',
  '...g7g....g7g...',
  '....g......g....',
  '....g......g....',
];

/** Two bars. */
const PAUSE: Frame = [
  '............',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '..777..777..',
  '............',
];

/** A horn with two sound waves. */
const SOUND_ON: Frame = [
  '............',
  '.....7...7..',
  '....77....7.',
  '...777.7...7',
  '777777..7..7',
  '777777..7..7',
  '777777..7..7',
  '777777..7..7',
  '...777.7...7',
  '....77....7.',
  '.....7...7..',
  '............',
];

/** The horn dimmed, with a cross where the waves were. */
const SOUND_OFF: Frame = [
  '............',
  '.....5......',
  '....55......',
  '...555......',
  '555555.6..6.',
  '555555..66..',
  '555555..66..',
  '555555.6..6.',
  '...555......',
  '....55......',
  '.....5......',
  '............',
];

/** A phone shaking. */
const VIBE_ON: Frame = [
  '............',
  '...777777...',
  '...7....7...',
  '.7.7....7.7.',
  '7..7....7..7',
  '.7.7....7.7.',
  '7..7....7..7',
  '.7.7....7.7.',
  '7..7....7..7',
  '...7.77.7...',
  '...777777...',
  '............',
];

/** The phone dimmed and still. */
const VIBE_OFF: Frame = [
  '............',
  '...555555...',
  '...5....5...',
  '...5....5...',
  '...5....5...',
  '...5....5...',
  '...5....5...',
  '...5....5...',
  '...5....5...',
  '...5.55.5...',
  '...555555...',
  '............',
];

export const BUTTONS: SpriteGrids<'buttons'> = {
  btn_arrow: [ARROW],
  btn_jump: [JUMP],
  btn_fire: [FIRE],
  btn_thrust: [THRUST],
  btn_pause: [PAUSE],
  btn_sound: [SOUND_ON, SOUND_OFF],
  btn_vibe: [VIBE_ON, VIBE_OFF],
};
