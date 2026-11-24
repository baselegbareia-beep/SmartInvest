/**
 * Things in the level: trophy, door_*, gem_*, pickup_* (docs/ART-AND-SOUND.md, section 4).
 *
 * Hue lanes: gold is the cog alone; violet and rose are ore; the blaster and the
 * thruster pack are steel with lime, because they are Sprue's tools; the airlock is
 * steel and turns lime when it opens.
 * Two lights: Earthlight (white) on the upper left of everything here; the cog's stand
 * and the airlock carry the warm amber glow on their undersides (under the airlock it is
 * the light that spills from under the door). The ore and the tools
 * do not: a lone amber pixel under them read as a separate spark or a flame.
 * Pickups bob 1 px in the view code, not in their frames. Every glint frame (frame 1)
 * puts the same small white twinkle on the upper left, so all pickups shine alike.
 *
 * To see your work:  node src/art/tools/preview.ts strip trophy <out.png>
 */
import type { Frame } from '../grid.ts';
import type { SpriteGrids } from '../manifest.ts';

// ---------------------------------------------------------------------------------------
// The golden cog on its stand: the brightest thing in a room. Eight teeth round a real
// hole (the backdrop shows through), a white arc of Earthlight on the upper left of the
// hub, amber on the lower right. It is mounted on a steel trestle, two splayed legs on a
// foot plate with the amber glow under it, so gold stays on the cog alone. (A gold stem
// and flared foot were tried first: the outline was a trophy cup, or a flower on a stem.)
// A white glint goes round the teeth clockwise, with one flare pixel off the tooth tip.
// ---------------------------------------------------------------------------------------

const TROPHY_0: Frame = [
  '..7....cc.......',
  '...77..cc..cc...',
  '...7ccccccccdd..',
  '....c7cccccd....',
  '....7cc00ccd....',
  '..cc7c0..0ccdd..',
  '..cccc0..0cddd..',
  '....ccc00cdd....',
  '....cccccddd....',
  '...cccccddddd...',
  '...cc..cd..dd...',
  '......65.54.....',
  '.....65...54....',
  '....65.....54...',
  '...6555555554...',
  '....dddddddd....',
];

const TROPHY_1: Frame = [
  '.......cc....7..',
  '...cc..cc..77...',
  '...ccccccccc7d..',
  '....c7cccccd....',
  '....7cc00ccd....',
  '..cc7c0..0ccdd..',
  '..cccc0..0cddd..',
  '....ccc00cdd....',
  '....cccccddd....',
  '...cccccddddd...',
  '...cc..cd..dd...',
  '......65.54.....',
  '.....65...54....',
  '....65.....54...',
  '...6555555554...',
  '....dddddddd....',
];

const TROPHY_2: Frame = [
  '.......cc.......',
  '...cc..cc..cc...',
  '...cccccccccdd..',
  '....c7cccccd....',
  '....7cc00ccd....',
  '..cc7c0..0ccdd..',
  '..cccc0..0cddd..',
  '....ccc00cdd....',
  '....cccccddd....',
  '...cccccdddd7...',
  '...cc..cd..77...',
  '......65.54..7..',
  '.....65...54....',
  '....65.....54...',
  '...6555555554...',
  '....dddddddd....',
];

const TROPHY_3: Frame = [
  '.......cc.......',
  '...cc..cc..cc...',
  '...cccccccccdd..',
  '....c7cccccd....',
  '....7cc00ccd....',
  '..cc7c0..0ccdd..',
  '..cccc0..0cddd..',
  '....ccc00cdd....',
  '....cccccddd....',
  '...7ccccddddd...',
  '...77..cd..dd...',
  '..7...65.54.....',
  '.....65...54....',
  '....65.....54...',
  '...6555555554...',
  '....dddddddd....',
];

// ---------------------------------------------------------------------------------------
// The airlock: a doorway first, so that "where is the exit" has an answer before the cog
// is found. A steel frame (a lintel lit on top, the left jamb lit, the right one shaded)
// stands on the floor with no sill, light spills from under it (the warm row), and a
// lamp sits in the middle of the lintel: amber while locked, lime once open. In the dark
// recess hangs the round hatch: a rim lit on the upper left and a windmill of four iris
// blades round a cog-shaped indigo socket. (A round hatch alone, with spokes round a void
// hub, read as a wheel or a valve lying on the floor.)
// Opening: lime light breaks through the socket and the hole widens as the blades draw
// back into the rim. Open: a lime ring, green inside, a dark heart; frame 1 pulses the
// lamp and the upper-left of the ring white. Only the hatch and the lamp change: the
// frame, the recess and the glow are the same in all six frames.
// ---------------------------------------------------------------------------------------

const DOOR_LOCKED: Frame = [
  '.666666dd666665.',
  '.655555dd555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.65166555554143.',
  '.65165555544143.',
  '.65644322344343.',
  '.65644222244343.',
  '.65544222244343.',
  '.65544322344343.',
  '.65154333334143.',
  '.65144333344143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

const DOOR_OPENING_0: Frame = [
  '.666666gg666665.',
  '.655555hh555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.65166555554143.',
  '.65165555544143.',
  '.656443gg344343.',
  '.65644g77g44343.',
  '.65544g77g44343.',
  '.655443gg344343.',
  '.65154333334143.',
  '.65144333344143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

const DOOR_OPENING_1: Frame = [
  '.666666gg666665.',
  '.655555gg555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.65166555554143.',
  '.651655gg544143.',
  '.65644ghhg44343.',
  '.6564gh22hg4343.',
  '.6554gh22hg4343.',
  '.65544ghhg44343.',
  '.651543gg334143.',
  '.65144333344143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

const DOOR_OPENING_2: Frame = [
  '.666666gg666665.',
  '.655555gg555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.651665gg554143.',
  '.65165ghhg44143.',
  '.6564gh22hg4343.',
  '.656gh2112hg343.',
  '.655gh2112hg343.',
  '.6554gh22hg4343.',
  '.65154ghhg34143.',
  '.651443gg344143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

const DOOR_OPEN_0: Frame = [
  '.666666gg666665.',
  '.655555gg555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.65166gggg54143.',
  '.6516ghhhhg4143.',
  '.656gh2222hg343.',
  '.656gh2112hg343.',
  '.655gh2112hg343.',
  '.655gh2222hg343.',
  '.6515ghhhhg4143.',
  '.65144gggg44143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

const DOOR_OPEN_1: Frame = [
  '.66666677666665.',
  '.655555gg555554.',
  '.65222222222243.',
  '.65111666511143.',
  '.651667ggg54143.',
  '.65167ghhhg4143.',
  '.6567h2222hg343.',
  '.656gh2112hg343.',
  '.655gh2112hg343.',
  '.655gh2222hg343.',
  '.6515ghhhhg4143.',
  '.65144gggg44143.',
  '.65111444411143.',
  '.65111111111143.',
  '.65111111111143.',
  '.65dddddddddd43.',
];

// ---------------------------------------------------------------------------------------
// Ore: three looks, one value. Each is about 9 x 10 px and 50 to 65 pixels, with
// about the same mean brightness, so none looks richer:
//   gem_a  one violet shard (the guide's seed, a little taller)
//   gem_b  a rose cluster: three crystals stepping down from tall on the left to small
//          on the right, on one sloping plum root
//   gem_c  a twin: a tall violet prism and a short rose one on a shared root
// Raw crystals with pointed tips, never cut stones and never a crown: no cluster has its
// tallest crystal in the middle. (gem_b had one, between two shorter ones: at 2x it read
// as a pink crown or a claw.)
// ---------------------------------------------------------------------------------------

const GEM_A_0: Frame = [
  '................',
  '................',
  '.......7........',
  '......7ml.......',
  '.....7mmln......',
  '....7mmllln.....',
  '....mmmlllnn....',
  '....mmllllnn....',
  '....mlllllnn....',
  '.....mlllnnn....',
  '.....lllnnn.....',
  '......llnn......',
  '.......ln.......',
  '................',
  '................',
  '................',
];

const GEM_A_1: Frame = [
  '................',
  '....7...........',
  '...777.7........',
  '....7.7ml.......',
  '.....7mmln......',
  '....7m7llln.....',
  '....mmmlllnn....',
  '....mmllllnn....',
  '....mlllllnn....',
  '.....mlllnnn....',
  '.....lllnnn.....',
  '......llnn......',
  '.......ln.......',
  '................',
  '................',
  '................',
];

const GEM_B_0: Frame = [
  '................',
  '................',
  '....7...........',
  '...77m..........',
  '...7mmn.........',
  '...7mmn.........',
  '...mmmln.7......',
  '...mmlln7mn.....',
  '...mmlln7mmn....',
  '....mlln7mln.7..',
  '....mlnnmmln7mn.',
  '.....nnnmlnnmln.',
  '......nnnnnnnn..',
  '................',
  '................',
  '................',
];

const GEM_B_1: Frame = [
  '................',
  '..7.............',
  '.7777...........',
  '..777m..........',
  '...7mmn.........',
  '...7mmn.........',
  '...mmmln.7......',
  '...mmlln7mn.....',
  '...mmlln7mmn....',
  '....mlln7mln.7..',
  '....mlnnmmln7mn.',
  '.....nnnmlnnmln.',
  '......nnnnnnnn..',
  '................',
  '................',
  '................',
];

const GEM_C_0: Frame = [
  '................',
  '................',
  '................',
  '......7.........',
  '.....7ll........',
  '....7llln.......',
  '....mllln.......',
  '....mllln.7.....',
  '....mllln7mm....',
  '....mllnnmmmn...',
  '....mllnnmmmn...',
  '....mlnnnmmln...',
  '.....nnnnnnn....',
  '................',
  '................',
  '................',
];

const GEM_C_1: Frame = [
  '................',
  '................',
  '...7............',
  '..777.7.........',
  '...7.7ll........',
  '....7l7ln.......',
  '....mllln.......',
  '....mllln.7.....',
  '....mllln7mm....',
  '....mllnnmmmn...',
  '....mllnnmmmn...',
  '....mlnnnmmln...',
  '.....nnnnnnn....',
  '................',
  '................',
  '................',
];

// ---------------------------------------------------------------------------------------
// Sprue's tools, lying in the level: steel with lime, drawn like their top-bar icons
// (hud.ts) so the player knows what was picked up.
// ---------------------------------------------------------------------------------------

/** A stubby blaster: a lime coil wound twice round the barrel, a dark bore, a grip. */
const BLASTER_0: Frame = [
  '................',
  '................',
  '................',
  '................',
  '.......g.g......',
  '...5666g6g6667..',
  '..55555g5g55560.',
  '..44444h4h44450.',
  '...3444h3h333...',
  '...454..........',
  '...445..........',
  '...344..........',
  '................',
  '................',
  '................',
  '................',
];

const BLASTER_1: Frame = [
  '................',
  '................',
  '..7.............',
  '.777............',
  '..7....g.g......',
  '...5677g6g6667..',
  '..55557g5g55570.',
  '..44444h4h44450.',
  '...3444h3h333...',
  '...454..........',
  '...445..........',
  '...344..........',
  '................',
  '................',
  '................',
  '................',
];

/**
 * A jet pack: two domed bottles held by one lime strap with a white gauge needle in its
 * middle, two nozzles, and a lime pilot flame under each. About a fifth of it is lime,
 * so it reads as one of Sprue's tools and not as part of the building. (Two slate straps
 * and a 2 px gauge were tried first: at 2x it was a grey crate or a grille.)
 */
const THRUSTER_0: Frame = [
  '................',
  '................',
  '...656...656....',
  '..67554.67554...',
  '..67554.67554...',
  '..66554.66554...',
  '..ggggg7ggggh...',
  '..gggghhggggh...',
  '..66554.66554...',
  '..66554.66554...',
  '..65544.65544...',
  '..65544.65544...',
  '...343...343....',
  '...gh....gh.....',
  '....g.....g.....',
  '................',
];

const THRUSTER_1: Frame = [
  '................',
  '..7.............',
  '.77756...656....',
  '..77554.67554...',
  '..67554.67554...',
  '..66554.66554...',
  '..ggggg7ggggh...',
  '..gggghhggggh...',
  '..66554.66554...',
  '..66554.66554...',
  '..65544.65544...',
  '..65544.65544...',
  '...343...343....',
  '...gh....gh.....',
  '....g.....g.....',
  '................',
];

export const THINGS: SpriteGrids<'things'> = {
  trophy: [TROPHY_0, TROPHY_1, TROPHY_2, TROPHY_3],
  door_locked: [DOOR_LOCKED],
  door_opening: [DOOR_OPENING_0, DOOR_OPENING_1, DOOR_OPENING_2],
  door_open: [DOOR_OPEN_0, DOOR_OPEN_1],
  gem_a: [GEM_A_0, GEM_A_1],
  gem_b: [GEM_B_0, GEM_B_1],
  gem_c: [GEM_C_0, GEM_C_1],
  pickup_blaster: [BLASTER_0, BLASTER_1],
  pickup_thruster: [THRUSTER_0, THRUSTER_1],
};
