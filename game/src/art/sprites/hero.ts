/**
 * Hero and tools: hero_*, ovl_*, thrust_flame, bolt (docs/ART-AND-SOUND.md, section 4).
 *
 * Sprue is a tapered crucible with a wide rim, one off-centre lamp eye, a bent aerial
 * and two peg legs. No arms, no head-and-body split (look rule 6). Lime belongs to
 * him and his tools alone.
 *
 * The aerial is a lamp on a wire: a light-steel wire that rises from the back of the
 * rim and bends back at a knee, and a 2 x 2 lime bulb with a white core on its upper
 * left. It stands up in the idle, trails behind in the run, is swept down in the jump
 * and up in the fall. (A lime bulb shaded dark green on a diagonal stalk read as a
 * leaf, and Sprue as a walking flowerpot with a seedling.)
 *
 * Drawn facing right; the game mirrors the frame to face left. The 16 x 16 sprite is
 * centred on the 10 x 14 collision box with the feet flush to the bottom row: the box
 * is columns 3 to 12, rows 2 to 15. The body stays inside it in every pose but the
 * death; only the rim (1 px each side, 2 px ahead in the thrust lean) and the aerial
 * stick out.
 *
 * Where the body sits in each pose (the overlays are laid at fixed offsets, so this
 * decides how they sit):
 *   idle, run 0 and 2, fall     rim on rows 3 and 4, body down to row 12, legs 13 to 15
 *   run 1 and 3, jump           the same, one row higher (the bob of the run; the tuck of the jump)
 *   thrust                      the rim 1 px forward, rows 10 to 12 1 px back: the lean
 * The eye never comes lower than rows 6 to 9, so the blaster (rows 9 to 11, mostly in
 * front of the body) never hides the lamp.
 *
 * To see your work:  node src/art/tools/preview.ts strip hero_run <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

/** Standing. The seed of the guide (section 5), refined: bent aerial, round lamp socket, near leg lit. */
const IDLE_0: Frame = [
  '..7g............',
  '..gg5...........',
  '....5...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....54..65.....',
  '.....54..65.....',
  '.....544.655....',
];

/** The blink: the lid drops over the lamp and the aerial bulb dips 1 px as the wire sags. */
const IDLE_1: Frame = [
  '................',
  '..7g............',
  '..gg5...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bbbb0...',
  '...08889bhhb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....54..65.....',
  '.....54..65.....',
  '.....544.655....',
];

/** Run, contact: legs wide apart, the lit leg in front. */
const RUN_0: Frame = [
  '7g..............',
  'gg555...........',
  '....5...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....54..65.....',
  '....54....65....',
  '...54......65...',
];

/** Run, passing: the body 1 px up on the straight lit leg, the dark leg swinging through. */
const RUN_1: Frame = [
  '7g..............',
  'gg555...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....5465.......',
  '....54.65.......',
  '.......65.......',
  '.......655......',
];

/** Run, contact: the dark leg in front. */
const RUN_2: Frame = [
  '7g..............',
  'gg555...........',
  '....5...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....65..54.....',
  '....65....54....',
  '...65......54...',
];

/** Run, passing: the body 1 px up on the straight dark leg, the lit leg swinging through. */
const RUN_3: Frame = [
  '7g..............',
  'gg555...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....6554.......',
  '....65.54.......',
  '.......54.......',
  '.......544......',
];

/** Going up: one row higher, legs tucked short behind, the aerial swept down. */
const JUMP_0: Frame = [
  '................',
  '..555...........',
  '7g.0000000000...',
  'gg077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....54.65......',
  '....54.65.......',
  '................',
  '................',
];

/** Coming down: legs dangling, the aerial swept straight up, the eye wide. */
const FALL_0: Frame = [
  '...7g...........',
  '...gg...........',
  '....5...........',
  '...0000000000...',
  '..077888888990..',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...08899bggb0...',
  '....0899abb0....',
  '....09adddd0....',
  '....00000000....',
  '.....54..65.....',
  '....54....65....',
  '....5......5....',
];

/**
 * Thrusting: the crucible tilts forward. The rim goes 1 px ahead and the narrow foot
 * 1 px back, so it leans without leaving the collision box; the legs trail behind.
 */
const THRUST_0: Frame = [
  '..7g............',
  '..gg5...........',
  '.....5..........',
  '....0000000000..',
  '...077888888990.',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '...08999aa0.....',
  '...09adddd0.....',
  '...00000000.....',
  '.....54.65......',
  '....54.65.......',
  '....5..6........',
];

const THRUST_1: Frame = [
  '................',
  '.7g.............',
  '.gg555..........',
  '....0000000000..',
  '...077888888990.',
  '...0aaaaaaaa0...',
  '...078888bb90...',
  '...08888bg7b0...',
  '...08889bggb0...',
  '...088999bba0...',
  '...08999aa0.....',
  '...09adddd0.....',
  '...00000000.....',
  '.....54.65......',
  '.....54.65......',
  '....54.65.......',
];

/** The crucible breaks, 1: the rim pops up, the legs buckle. */
const DIE_0: Frame = [
  '.7g.............',
  '.gg5............',
  '...0000000000...',
  '..077888888990..',
  '...0000000000...',
  '.....7....7.....',
  '...0bbbbbbbb0...',
  '...08888bggb0...',
  '...08889bggb0...',
  '...088999bba0...',
  '....08999aa0....',
  '....09adddd0....',
  '....00000000....',
  '.....54..65.....',
  '....54....65....',
  '...544....655...',
];

/** 2: the rim flies, the body cracks down the middle, the lamp dims. */
const DIE_1: Frame = [
  '..0000000.......',
  '.07788888000000.',
  '..0000008889990.',
  '........000000..',
  '................',
  '..0bbb..bbbbb0..',
  '..0788a.88bb90..',
  '..0888.a8bhhb0..',
  '..0888a.9bhhb0..',
  '..0889..99bba0..',
  '...089a.99aa0...',
  '...09a..dddd0...',
  '...000..00000...',
  '....54....65....',
  '...54......65...',
  '..544......655..',
];

/** 3: the halves tip apart, the lamp is dark, the rim comes down. */
const DIE_2: Frame = [
  '................',
  '................',
  '........000000..',
  '..0000008889990.',
  '.07788888000000.',
  '..0000000.......',
  '................',
  '0bbb......bbbbb0',
  '0788a.....88bb90',
  '0888.....a8b43b0',
  '.0888a...9b33b0.',
  '.0889...a99bba0.',
  '..089a...99aa0..',
  '...09a..dddd0...',
  '...000..00000...',
  '544..........655',
];

/** 4: a heap: two shards, the rim across them, the socket dark. */
const DIE_3: Frame = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..0000000.......',
  '.07788888000000.',
  '..0000008889990.',
  '..0888a.000000..',
  '.08889a.a9b33b0.',
  '.088999.99bbba0.',
  '.09adda.adddd0..',
  '.000000.000000..',
];

export const HERO: SpriteGrids<'hero'> = {
  hero_idle: [IDLE_0, IDLE_1],
  hero_run: [RUN_0, RUN_1, RUN_2, RUN_3],
  hero_jump: [JUMP_0],
  hero_fall: [FALL_0],
  hero_thrust: [THRUST_0, THRUST_1],
  hero_die: [DIE_0, DIE_1, DIE_2, DIE_3],
  // The blaster, clamped low on the front: the top three rows stay clear of the lamp.
  ovl_blaster: [
    [
      '........',
      '........',
      '.....g..',
      '...56g66',
      '...45h50',
      '...34...',
    ],
  ],
  // One bottle of the twin pack, seen from the side, hung under the back of the rim.
  ovl_pack: [
    [
      '.66..',
      '66530',
      '65g3.',
      '65g3.',
      '65530',
      '6553.',
      '.543.',
      '.3.3.',
    ],
  ],
  // The exhaust under the pack: a white core in lime, flickering long and short.
  thrust_flame: [
    [
      'g77g..',
      'g77g..',
      '.g7g..',
      '.gg...',
      '.hg...',
      '..h...',
      '......',
      '......',
    ],
    [
      'g77g..',
      'gg7g..',
      '.gg...',
      '.h.g..',
      '......',
      '.h....',
      '......',
      '......',
    ],
  ],
  // A lime dash with a white core, flying right.
  bolt: [
    [
      '........',
      '..hgggg.',
      'hgg7777g',
      'hgg7777g',
      '..hgggg.',
      '........',
    ],
    [
      '........',
      '.h.gggg.',
      '..hg777g',
      'h.gg777g',
      '...gggg.',
      '........',
    ],
  ],
};
