/**
 * Tiles: wall_*, trim_*, fire, coolant_*, spikes (docs/ART-AND-SOUND.md, sections 4 and 6).
 *
 * These go on the tile sheet: every frame is one 16 x 16 cell and the tile layer
 * addresses it by number, in the order of src/art/manifest.ts. src/art/tilePick.ts
 * says which tile goes in which cell.
 *
 * - Blue-greys are structure. A walkable top edge is earthlight; the underside
 *   carries a one-pixel amber glow.
 * - trim_left and trim_right are a 2 px edge laid over a wall tile whose side is
 *   exposed; everything else in them is transparent.
 * - Hazard art is 1 px larger than the kill box on each side: the solid part of the
 *   flame is 12 px wide and 13 px tall (columns 2 to 13, rows 3 to 15: flame down to
 *   row 13, then the grate it burns on), the spikes are 12 px wide and 9 px tall
 *   (columns 2 to 13, rows 7 to 15), and the top 6 rows of coolant_top are harmless
 *   froth. src/art/art.test.ts checks the first two.
 *
 * To see your work:  node src/art/tools/preview.ts stage <out.png>
 *                    node src/art/tools/scene.ts levels/debug.txt --zoom 2 <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

// ---------------------------------------------------------------------------------------
// Walls: one stamped plate per cell, with its seam on the right and at the bottom
// ---------------------------------------------------------------------------------------

/** Seed grid from the guide (section 5): the lit walkway cap. The style reference for walls. */
const WALL_TOP_0: Frame = [
  '6666666666666666',
  '5555555555555555',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4454444444445443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4454444444445443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '3333333333333333',
];

/** Plain plate. */
const WALL_FILL_0: Frame = [
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '3333333333333333',
];

/** Riveted plate: one in five of the plain ones. */
const WALL_FILL_B_0: Frame = [
  '4444444444444443',
  '4444444444444443',
  '4454444444445443',
  '4443444444444343',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4454444444445443',
  '4443444444444343',
  '4444444444444443',
  '3333333333333333',
];

/** Underside: a dark lip and the furnace glow on the last row. */
const WALL_BOTTOM_0: Frame = [
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4454444444445443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '4444444444444443',
  '3333333333333333',
  '3333333333333333',
  '2222222222222222',
  'dddddddddddddddd',
];

/**
 * Thin girder: the lit cap, a truss web and the lip with its glow, in one cell. The web
 * is a zigzag of four diagonals (down, up, down, up) that runs from one edge of the cell
 * to the other, so a run of girders is one continuous truss and a lone girder is a piece
 * of it, never a centred sign. (Two punched holes read as a face, a single V as an
 * envelope, and two diagonals meeting on a centre post as an A on a framed sign.)
 */
const WALL_BEAM_0: Frame = [
  '6666666666666666',
  '5555555555555555',
  '4444444444444443',
  '3333333333333333',
  '5422224554222245',
  '5422245254222452',
  '2542245225422452',
  '2542452225424522',
  '2254452222544522',
  '2254522222545222',
  '2225422222254222',
  '4444444444444443',
  '4444444444444443',
  '3333333333333333',
  '2222222222222222',
  'dddddddddddddddd',
];

/** The lit side face. Row 15 stays clear so that plate seams run to the edge. */
const TRIM_LEFT_0: Frame = [
  '5...............',
  '5...............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '54..............',
  '................',
];

/** The shaded side face. */
const TRIM_RIGHT_0: Frame = [
  '...............5',
  '...............3',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '..............32',
  '................',
];

// ---------------------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------------------

/**
 * Furnace fire on a floor grate: crimson base, amber body, gold core. The solid flame is
 * 12 px wide and 13 px tall, columns 2 to 13 and rows 3 to 15: rows 5 to 13 are flame
 * from edge to edge, row 4 has at most one gap and row 3 at most four, and the grate
 * (rows 14 and 15, as wide as the flame) is the foot it burns on. Only the tongues of rows 0 to 2 stand above
 * the box. The body keeps its place; the crown (rows 0 to 4) changes from frame to frame.
 */
const FIRE: readonly Frame[] = [
  [
    '................',
    '.......d........',
    '...e..dd....e...',
    '..ed..ddd..edd..',
    '..edd.edcddedd..',
    '..eddedccdedde..',
    '..edddccccddde..',
    '..eddcccccccde..',
    '..edccccccccde..',
    '..edccccccccde..',
    '..eedccccccdee..',
    '..feddccccddef..',
    '..ffeddddddeff..',
    '..fffeeddeefff..',
    '..f3e3d33d3e3f..',
    '..333333333333..',
  ],
  [
    '........d.......',
    '.......dd.......',
    '...e...dd..e....',
    '..ed..dddd.ed...',
    '..eddedccdedd...',
    '..eddddccdddde..',
    '..edddccccddde..',
    '..eddccccccdde..',
    '..edcccccccdde..',
    '..edccccccccde..',
    '..eedccccccdee..',
    '..feddccccddef..',
    '..ffeddddddeff..',
    '..fffeeddeefff..',
    '..f3e3d33d3e3f..',
    '..333333333333..',
  ],
  [
    '................',
    '........d.......',
    '...e....dd..e...',
    '...d..dddd.ede..',
    '..dde.ddcdedde..',
    '..eddedccdedde..',
    '..edddccccddde..',
    '..edcccccccdde..',
    '..edccccccccde..',
    '..edccccccccde..',
    '..eedccccccdee..',
    '..feddccccddef..',
    '..ffeddddddeff..',
    '..fffeeddeefff..',
    '..f3e3d33d3e3f..',
    '..333333333333..',
  ],
  [
    '................',
    '.....e....d.....',
    '....ed...dd.e...',
    '..e.edd.ddd.ed..',
    '..e.dddedcddde..',
    '..edddddccdddd..',
    '..edddccccddde..',
    '..eddccccccdde..',
    '..edccccccccde..',
    '..edccccccccde..',
    '..eedccccccdee..',
    '..feddccccddef..',
    '..ffeddddddeff..',
    '..fffeeddeefff..',
    '..f3e3d33d3e3f..',
    '..333333333333..',
  ],
];

/**
 * The top of a coolant pool. Rows 0 to 5 are harmless: vapour and froth. The liquid
 * starts on row 6. The froth drifts 4 px per frame and wraps, so a pool of any width
 * joins up. Along the froth line stands a broken rim of ice crystals that never moves,
 * and white vapour wisps rise from it and fade: the pool is deadly cold, not water to
 * wade in.
 */
const COOLANT_TOP: readonly Frame[] = [
  [
    '...6............',
    '................',
    '...........7....',
    '.7.....7..7...i.',
    '.i77..i7i.77i.7.',
    '7777ii7777777ii7',
    'iiiiiiiiiiiiiiii',
    'iijiiiijiiijiiii',
    'jjjjijjjjjjjijjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjkjjjjjjjjj',
    'jkjjjjjjjjkjjjjj',
    'jjjjkjjjjjjjjkjj',
    'kjkjkjkjkjkjkjkj',
    'kkkkkkkkkkkkkkkk',
  ],
  [
    '................',
    '...........7....',
    '..........6.....',
    '.7.....7......i.',
    '.i....i7i...i.77',
    'ii777777ii777777',
    'iiiiiiiiiiiiiiii',
    'iiiiiijiiiijiiij',
    'ijjjjjjjijjjjjjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjkjjjjjjjjj',
    'jkjjjjjjjjkjjjjj',
    'jjjjkjjjjjjjjkjj',
    'kjkjkjkjkjkjkjkj',
    'kkkkkkkkkkkkkkkk',
  ],
  [
    '..........6.....',
    '................',
    '....7...........',
    '.7.7...7......i.',
    '7i....i7i...i.7.',
    '777777ii777777ii',
    'iiiiiiiiiiiiiiii',
    'iiijiijiiijiiiij',
    'jjjjijjjjjjjijjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjkjjjjjjjjj',
    'jkjjjjjjjjkjjjjj',
    'jjjjkjjjjjjjjkjj',
    'kjkjkjkjkjkjkjkj',
    'kkkkkkkkkkkkkkkk',
  ],
  [
    '................',
    '....7...........',
    '...6............',
    '.7.....7......i.',
    '.i..77i7i...i77.',
    '7777777ii777777i',
    'iiiiiiiiiiiiiiii',
    'iijiiiiiijiiijii',
    'jjjjjjijjjjjjjij',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjjjjjjjjjjj',
    'jjjjjjkjjjjjjjjj',
    'jkjjjjjjjjkjjjjj',
    'jjjjkjjjjjjjjkjj',
    'kjkjkjkjkjkjkjkj',
    'kkkkkkkkkkkkkkkk',
  ],
];

/** Deep coolant under the surface tile: slow bubbles. */
const COOLANT_BODY: readonly Frame[] = [
  [
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkjkkk',
    'kkkjkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkikkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkjkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkjkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkjkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
  ],
  [
    'kkkjkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkikkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkjkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkjkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkjkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkjkkk',
  ],
];

/**
 * Three spikes, 12 px wide and 9 px tall (columns 2 to 13, rows 7 to 15). Each is a
 * pyramid that widens every two rows (1, 2, 3, 3, 4 px) and is split down its middle:
 * the left face lit (white, then earthlight), the right face in shade (steel, then
 * slate), so it reads as a point and not as a post. The top three rows are furnace red
 * with a crimson shade: a red-hot cap of 6 px, not a wick. The bases merge on a slate
 * foot. No warm row under them: they stand on a floor, and red specks on the foot read
 * as blood. (Three straight-sided white columns with a 1 px red tip were tried first:
 * at 2x they read as candles, a cake or a crown.)
 */
const SPIKES_0: Frame = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...e...e...e....',
  '...ef..ef..ef...',
  '..7ef.7ef.7ef...',
  '..764.764.764...',
  '..764.764.764...',
  '..764476447644..',
  '..764476447644..',
  '..664366436643..',
  '..333333333333..',
];

export const TILES: SpriteGrids<'tiles'> = {
  wall_fill: [WALL_FILL_0],
  wall_fill_b: [WALL_FILL_B_0],
  wall_top: [WALL_TOP_0],
  wall_bottom: [WALL_BOTTOM_0],
  wall_beam: [WALL_BEAM_0],
  trim_left: [TRIM_LEFT_0],
  trim_right: [TRIM_RIGHT_0],
  fire: FIRE,
  coolant_top: COOLANT_TOP,
  coolant_body: COOLANT_BODY,
  spikes: [SPIKES_0],
};
