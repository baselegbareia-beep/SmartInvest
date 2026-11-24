/**
 * Effects: fx_* (docs/ART-AND-SOUND.md, section 4). All of them are particles of the
 * one emitter, at most 48 alive.
 *
 * To see your work:  node src/art/tools/preview.ts strip fx_poof <out.png>
 */
import type { SpriteGrids } from '../manifest.ts';

export const FX: SpriteGrids<'fx'> = {
  // A burst where an enemy was: a white flash, an amber ring with red embers, then a broken
  // amber ring round three lopsided puffs of smoke, which drift apart and fade to slate.
  // The puffs are kept off any symmetric pattern, which read as a face inside the ring.
  // No gold: a gold ring read as a coin or a score.
  fx_poof: [
    [
      '................',
      '................',
      '................',
      '.......7........',
      '....d..7..d.....',
      '.....d777d......',
      '......7777......',
      '...77777777d....',
      '....d7777777....',
      '......7777......',
      '.....d777d......',
      '....d..7..d.....',
      '.......7........',
      '................',
      '................',
      '................',
    ],
    [
      '................',
      '......e..e......',
      '...e..dddd..e...',
      '....dd7777dd....',
      '...d77....77d...',
      '..ed7......7de..',
      '..d7........7d..',
      '.ed7........7de.',
      '..d7........7d..',
      '..ed7......7de..',
      '...d77....77d...',
      '....dd7777dd....',
      '...e..dddd..e...',
      '......e..e......',
      '................',
      '................',
    ],
    [
      '.....e....e.....',
      '..e..dd..dd..e..',
      '...dd......dd...',
      '..d..........d..',
      '.ed...........de',
      '.d...55........d',
      '....5553........',
      'e....33....55..e',
      '.d........5553d.',
      '...........33...',
      '.d.............d',
      '.ed...55......de',
      '..d..5553....d..',
      '...dd.33...dd...',
      '..e..dd..dd..e..',
      '.....e....e.....',
    ],
    [
      '.f............e.',
      '................',
      '................',
      '....33..........',
      '...3333.........',
      '....33..........',
      '............33..',
      'e..........3333.',
      '............33..',
      '................',
      '................',
      '................',
      '.....33.........',
      '....3333........',
      '.....33.........',
      'f.............f.',
    ],
  ],
  // A twinkle: it opens, peaks and breaks up. White, so a tint colours it.
  fx_sparkle: [
    ['.....', '..7..', '.777.', '..7..', '.....'],
    ['..7..', '..7..', '77777', '..7..', '..7..'],
    ['..7..', '.....', '7...7', '.....', '..7..'],
  ],
  // A puff of floor dust: whole, then drifting apart.
  fx_dust: [
    ['.66.', '6665', '6655', '.55.'],
    ['.6.5', '6...', '...5', '.5..'],
  ],
  // A white square, tinted in use (lime, white, ice or amber). This one is final.
  fx_spark: [['77', '77']],
  // Four different bits, not an animation: rim shard, leg, plate, eye. The rim shard and
  // the lamp eye are Sprue's (cream, lime) and fly only when he breaks; the leg (steel)
  // and the plate (tan, rust, char, an amber edge) also do for enemies. FX_SCRAP_FRAMES in
  // ../manifest.ts says which bits each event throws.
  fx_scrap: [
    ['7889', '89a.', '9...', '....'],
    ['.65.', '.65.', '.65.', '.655'],
    ['99a.', '9aab', 'aabd', '.bd.'],
    ['.bb.', 'bg7b', 'bggb', '.bb.'],
  ],
};
