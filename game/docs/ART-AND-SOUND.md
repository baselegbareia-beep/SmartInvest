# Art and sound

How the game looks and sounds: palette, sprites, tiles, font, top bar, screens, touch buttons, app icon, sound effects. Everything here is original and is authored in code: pictures are text grids turned into textures at boot, sounds are synthesised with WebAudio. No image, font or sound file is downloaded.

Names of states, fields and events are the ones in `src/core/types.ts`; `player` is short for `run.player`. How the shell reads the state is in `docs/ARCHITECTURE.md` (section 11); the Phaser calls that were verified to work are in `docs/PHASER4-NOTES.md`. Units here: px = one art pixel, tick = one simulation step (1/60 s).

**Numbers.** Anything that changes how the game plays or handles is a feel number and lives in `src/tuning.ts` only; this document names the field (`TUNING.touch.jumpButtonSize`) and does not repeat the value. That covers sizes and opacities of the touch buttons, vibration lengths, hit stop, shake, and how long the intro and the toast stay. What is written here as a number is art: sprite sizes, frames per picture, colours, positions in the top bar, sound recipes. Those live with the art and sound data in `src/art` and `src/audio`.

## 1. The look in six rules

1. **Hue lanes.** One hue means one thing and is never reused. Lime is Sprue and his tools (eye, bolts, thruster flame, fuel pips, menu focus). Gold is the cog and the score. Violet and rose are ore. Red and amber are fire, enemies and spike tips. Ice cyan is coolant. Blue-greys are structure.
2. **Two lights.** Every sprite has a cold highlight on its upper left (Earthlight) and a warm one-pixel row on its underside (furnace glow).
3. **No black, no hard outlines.** The darkest colour is an indigo-black; outlines use it only where a sprite meets the backdrop, so shapes read by brightness, not by lines.
4. **A ruin open to space.** Dark wall panels are drawn only in empty cells that touch structure. Everywhere else the stars, a crescent Earth and a crater ridge show through.
5. **Stamped metal.** The font and the menu panels have every outer corner cut by one pixel, like plate lettering and cog teeth.
6. **The hero's shape.** A tapered crucible with a wide rim, one off-centre lamp eye, a bent aerial and two peg legs. No arms, no head-and-body split.

## 2. Palette

24 colours. Each has a one-character code used in the sprite grids; `.` is transparent.

| Code | Hex | Name | Role |
|---|---|---|---|
| `0` | #0b0d1a | void | Space, the bars beside the picture, the page background, outlines, text shadow |
| `1` | #151a36 | night | Far wall panels, button fill |
| `2` | #232a54 | indigo | Panel seams, far machinery |
| `3` | #37426e | slate | Wall shade, pipes, disabled text, empty fuel pips |
| `4` | #53628c | steel | Wall body |
| `5` | #8090b4 | light steel | Wall edge, moth wing shade, button rims |
| `6` | #bfcbe0 | earthlight | Walkable top edge, spike body, stars, moth wings |
| `7` | #f5f8fc | white | Highlights, text, coolant froth |
| `8` | #f1e2c3 | cream | Sprue, light side |
| `9` | #c4a073 | tan | Sprue, mid tone |
| `a` | #8a5a44 | rust | Sprue shade, Cinderpeg body |
| `b` | #3b2a30 | char | Cinderpeg shade, scorch marks |
| `c` | #ffd65c | gold | Cog, score, fire core |
| `d` | #f4972a | amber | Fire, warnings, game-over text, cog shade, under-glow |
| `e` | #d8442a | furnace red | Fire edge, spike tips, enemy cracks |
| `f` | #8a1c38 | crimson | Fire base |
| `g` | #b4f04a | lime | Sprue's eye, bolt, thruster flame, focus |
| `h` | #4f9e3a | green | Lime shade |
| `i` | #7fe6ff | ice | Coolant surface |
| `j` | #1e9bd8 | coolant | Coolant body |
| `k` | #135a9e | deep coolant | Coolant depth |
| `l` | #a56bff | violet | Ore |
| `m` | #ff6fb5 | rose | Ore highlight, second ore |
| `n` | #5b2f8f | plum | Ore shade |

Contrast against the `night` backdrop: cream 13.3, lime 12.6, gold 12.2, ice 11.9, earthlight 10.4, amber 7.6, rose 6.7, light steel 5.3, violet 5.0, furnace red 3.9, steel 2.8, char 1.3. Two rules follow: nothing that can kill may be mostly `char` (the Cinderpeg's body is rust with amber cracks), and anything the player must see sits at 5.0 or above.

The page background and the bars beside the picture are `void`, so the picture has no visible edge.

`GAME OVER` is drawn in amber with the `void` shadow, not in crimson: crimson reads at only 1.87 against `void` (amber 7.6), so crimson is never used for text (section 7). The Role column above is checked against `src/art/palette.ts` by `src/art/art.test.ts`; the two were changed together.

## 3. Sprite format

- A frame is a list of text rows of equal length. Each character is one pixel: a palette code or `.` for transparent.
- A sprite is a list of frames of the same size. It is drawn facing right; facing left is a mirror flip, never a second drawing.
- Frame names are the sprite name, an underscore and the frame number counted from 0: `hero_run_0` to `hero_run_3`. A sprite with one frame is still `_0`.
- Grids live in `src/art/sprites/*.ts`, the palette in `src/art/palette.ts`, the font in `src/art/font.ts`. `src/art/makeSheet.ts` turns them into textures in the boot scene.
- Wall, hazard and decoration tiles are 16 x 16 and go on one sheet of equal cells, because the tile layer addresses tiles by number (the porthole is four of them). Everything else, the two backdrop pictures included, is packed onto a second sheet with named frames. All of it together, font included, is under half the area of one 256 x 256 texture.
- Sprites are placed by their top-left corner on whole pixels. The hero's 16 px sprite is centred on the collision box with the feet flush: `(player.x >> 8) - (16 - heroW) / 2`, `(player.y >> 8) - (16 - heroH)`, with `heroW` and `heroH` the box size in px from `TUNING.hero` (`docs/ARCHITECTURE.md`, 11.2).
- Pickups bob 1 px up and down in the view code (not in their frames). Animation clocks count `run.tick`, so pictures stop when the game is paused.

## 4. Sprite manifest

62 sprites, 111 frames. "Shown when" names the state or the event that puts the sprite on screen.

### Hero and tools

| Sprite | Size | Frames | Description | Shown when |
|---|---|---|---|---|
| `hero_idle` | 16x16 | 2 | Standing; the aerial bulb bobs. Frame 1 is a blink, shown for 6 ticks every 180 | `player.onGround` and `player.vx === 0`. Also the pose inside the airlock (`run.phase === 'exiting'`) |
| `hero_run` | 16x16 | 4 | Legs scissor, body bobs 1 px, aerial trails. 6 ticks per frame | `player.onGround` and `player.vx !== 0` |
| `hero_jump` | 16x16 | 1 | Legs tucked, aerial swept down | Not on the ground, `player.vy < 0`, not thrusting |
| `hero_fall` | 16x16 | 1 | Legs dangling, aerial swept up, eye wide | Not on the ground, `player.vy >= 0`, not thrusting |
| `hero_thrust` | 16x16 | 2 | Leaning 1 px forward, legs trailing. 4 ticks per frame | `player.thrusting` |
| `hero_die` | 16x16 | 4 | The rim pops off, the body splits, the eye goes dark | `run.phase === 'dying'`, after the first `hitStopFrames` ticks: the four frames spread evenly over `deathAnimFrames`, then the fade |
| `ovl_blaster` | 8x6 | 1 | The blaster, drawn over the hero's front at sprite offset (8, 6) | `player.hasBlaster` |
| `ovl_pack` | 5x8 | 1 | The thruster pack, drawn on the hero's back at sprite offset (0, 5) | `player.hasThruster` |
| `thrust_flame` | 6x8 | 2 | Lime and white exhaust under the pack, at sprite offset (0, 13). 3 ticks per frame | `player.thrusting` |
| `bolt` | 8x6 | 2 | A lime dash with a white core. 3 ticks per frame | `run.bolt.active`; flipped when `bolt.dir < 0` |

When several rows match, the first of these wins: dying, thrusting, in the air, running, idle. In the ready gate (`run.phase === 'ready'`) the hero blinks: hidden while `(run.tick >> 3) & 1` is 1. During the first `hitStopFrames` ticks of `dying` the hero keeps its last pose, filled white.

### Things in the level

| Sprite | Size | Frames | Description | Shown when |
|---|---|---|---|---|
| `trophy` | 16x16 | 4 | The golden cog mounted on a steel trestle (two splayed legs on a foot plate); a glint travels round the teeth. 8 ticks per frame | At `level.trophy` until `run.hasTrophy` |
| `door_locked` | 16x16 | 1 | A round hatch, iris shut round a cog-shaped socket, hanging in a steel door frame with an amber lamp on its lintel | At `level.door` while `run.hasTrophy` is false |
| `door_opening` | 16x16 | 3 | The iris blades retract. 6 ticks per frame | For 18 ticks after the event `doorOpened` |
| `door_open` | 16x16 | 2 | Open iris, lime-lit inside; the lamp pulses every 30 ticks | `run.hasTrophy`, once the opening has played |
| `gem_a`, `gem_b`, `gem_c` | 16x16 | 2 each | Violet shard, rose cluster, twin crystal: three looks, one value. Frame 1 is a glint | Pickup of kind `crystal` while `run.taken[i]` is false. Look = `(col + 2 * row) % 3` |
| `pickup_blaster` | 16x16 | 2 | A stubby steel blaster with a lime coil; glint | Pickup of kind `blaster` while not taken |
| `pickup_thruster` | 16x16 | 2 | One finned tank (the pack Sprue wears), two lime bands, one nozzle with a lime pilot flame; glint. Not two bottles: that is the THRUST button's glyph, and a pack beside the button read as part of it (`src/art/art.test.ts` keeps their outlines apart) | Pickup of kind `thruster` while not taken (it comes back on `pickupRestored` and after a respawn) |
| `cinderpeg` | 16x16 | 4 | Enemy 1: a wedge of fused slag on four peg legs; rust body, two molten seams that pulse, an amber glow underneath, two gold ember eyes. 10 ticks per frame | `run.enemies[i]` of kind `cinderpeg` while `alive`; flipped when `dir < 0` |
| `moth` | 16x16 | 4 | Enemy 2: a feral welding drone; two earthlight plate wings in a V, a thin dark body, a crackling amber arc under it. 5 ticks per frame | `run.enemies[i]` of kind `moth` while `alive`, either axis; flipped when `axis === 'h'` and `dir < 0` |

### Effects (two particle emitters, at most 48 alive between them)

The tinted particles (`fx_spark`, `fx_sparkle`) come from pure white copies of their frames, made at start, so a tint is the palette colour itself: tinted over the art's own white (`#f5f8fc`) they came out about 4 % darker than the palette (amber `#ea932a` for `#f4972a`), the only off-palette pixels of the canvas. Dust and scrap keep their own colours on the other emitter (`src/shell/Effects.ts`).

| Sprite | Size | Frames | Description | Shown when |
|---|---|---|---|---|
| `fx_poof` | 16x16 | 4 | A burst | Event `enemyKilled`, at its x and y |
| `fx_sparkle` | 5x5 | 3 | A twinkle | Events `pickup` (four for a crystal), `trophyCollected`, `pickupRestored` |
| `fx_dust` | 4x4 | 2 | A puff | Event `landed` (two), event `jumped` (one), every 10 ticks while running on the ground |
| `fx_spark` | 2x2 | 1 | A white square, tinted in use | Lime: every 2 ticks while `player.thrusting`. White: four at `boltEnded`. Ice: six at `playerDied` with cause `coolant`. Amber: one ember per visible fire tile every 20 ticks |
| `fx_scrap` | 4x4 | 4 | Four debris bits: rim shard, leg, plate, eye | `enemyKilled` (six bits), `playerDied` (the hero's four pieces) |

### Tiles and background (section 6 says which goes where)

| Sprite | Size | Frames | Description |
|---|---|---|---|
| `wall_fill`, `wall_fill_b` | 16x16 | 1 each | Plain plate; riveted plate |
| `wall_top`, `wall_bottom`, `wall_beam` | 16x16 | 1 each | Lit walkway cap; dark underside lip with an amber glow; thin girder (cap and lip together) |
| `trim_left`, `trim_right` | 16x16 | 1 each | A 2 px edge laid over a wall tile whose side is exposed; the rest is transparent |
| `fire` | 16x16 | 4 | A flame on a floor grate: crimson base, amber body, gold core. Tile `Fire`. 8 ticks per frame. The solid part of the flame is 12 px wide and 13 px tall; only flickering tips reach the top of the cell |
| `coolant_top` | 16x16 | 4 | Ice-cyan surface with white froth and drifting frost. Tile `Coolant` with no coolant above it. 15 ticks per frame |
| `coolant_body` | 16x16 | 2 | Deep coolant with slow bubbles. Tile `Coolant` under another coolant tile. 30 ticks per frame |
| `spikes` | 16x16 | 1 | Three earthlight spikes with red tips, standing on the floor: 12 px wide, 9 px tall. Tile `Spikes` |
| `bg_panel` | 16x16 | 2 | Far wall plate: plain, seamed |
| `bg_pipe_h`, `bg_pipe_v`, `bg_vent`, `bg_brace` | 16x16 | 1 each | Pipe runs, a louvred vent, an X cross-brace |
| `bg_chain`, `bg_hook` | 16x16 | 1 each | A hanging chain link; the ladle hook that ends a chain |
| `bg_porthole` | 32x32 | 1 | A riveted round window with a clear centre (four tiles) |
| `backdrop_earth` | 48x48 | 1 | A crescent Earth, placed once per level |
| `backdrop_ridge` | 64x24 | 1 | A crater ridge silhouette, repeated along the bottom of the backdrop |

### Top bar, buttons and menus

| Sprite | Size | Frames | Description | Shown when |
|---|---|---|---|---|
| `hud_life` | 8x8 | 2 | Sprue's rim and eye: lit, dark | `phys.maxLives` icons; lit ones = `session.lives` |
| `hud_cog` | 8x8 | 2 | Cog outline, gold cog | Outline until `run.hasTrophy` |
| `hud_blaster`, `hud_thruster` | 8x8 | 1 each | Icons of the held items | `player.hasBlaster`, `player.hasThruster` |
| `hud_pip` | 2x6 | 2 | Fuel pip: lime, slate | Ten pips; lit = `player.fuel` out of `phys.fuelTicks`, rounded up to tenths |
| `btn_arrow` | 16x16 | 1 | A chevron, flipped for LEFT | Touch buttons (section 10) |
| `btn_jump`, `btn_fire`, `btn_thrust` | 16x16 | 1 each | An up chevron over a bar; a bolt dash; a flame under each of two bottles | Touch buttons |
| `btn_pause` | 12x12 | 1 | Two bars | PAUSE button |
| `btn_sound`, `btn_vibe` | 12x12 | 2 each | On and off | Switches on the title and pause screens |
| `ui_panel` | 24x24 | 1 | A steel plate with cut corners, stretched as a nine-slice with 8 px corners | Menu panels and menu buttons |
| `logo_cog` | 32x32 | 1 | A large cog behind the title. The title draws it at 2x as a flat `indigo` shape: in its own gold at 1x it sat behind the R of the gold name and the R could not be read | Title screen |
| `icon` | 32x32 | 1 | Sprue's rim and lime eye inside a gold cog on `night` | App icon (section 11) |
| font | 5x7 | 47 glyphs | Section 7 | All text |

## 5. Seed grids

These six grids and three glyphs set the style. Every other sprite is drawn to match them. They are starting points: the artist may refine them, keeping the silhouette.

```
hero_idle_0         cinderpeg_0           moth_0
..gg............    ................    ................
..gg............    ................    .66..........66.
...5............    ................    .656........656.
...0000000000...    .....00..000....    .6556......6556.
..077888888990..    ...00aa00aab0...    ..6556.00.6556..
...0aaaaaaaa0...    ..0aaa9aabbab0..    ..65550aa05556..
...0888800000...    ..0a9aaeabbbb0..    ...6550ab0556...
...078880g700...    .0aacaadabcab0..    ....650cb056....
...088890gg00...    .0abccaeabccbb0.    .....00ab00.....
...0889900000...    .0aabbadebbbbb0.    ......0bb0......
....08999aa0....    .0abbbdebbbabb0.    ......0bb0......
....0a9aadd0....    .0bbbdebbbbbbb0.    .......00.......
....00000000....    ..0bddbbbbbbb0..    .......d........
.....45..45.....    ..000000000000..    ......dcd.......
.....45..45.....    ...04.04.04.04..    .......e........
.....445.445....    ...05.05.05.05..    ................
```

```
trophy_0            gem_a_0             wall_top_0
................    ................    6666666666666666
......c..c......    ................    5555555555555555
...c.0cccc0.c...    ................    4444444444444443
...cc7ccccdcc...    .......7........    4444444444444443
....7cc00ccd....    ......7ml.......    4444444444444443
..cc7c0..0cdcc..    .....7mlll......    4454444444445443
..ccccc..0cddc..    ....7mmllln.....    4444444444444443
....ccc00cdd....    ....mmllllnn....    4444444444444443
...ccdccccddc...    ....mllllnnn....    4444444444444443
...c.0cdddd0.c..    .....lllnnn.....    4444444444444443
......c..d......    ......llnn......    4454444444445443
.......dd.......    .......ln.......    4444444444444443
.......cd.......    ................    4444444444444443
.....0cccd0.....    ................    4444444444444443
....0cccddd0....    ................    4444444444444443
....00000000....    ................    3333333333333333
```

```
font: S      0      R        (# = white pixel)
.####  .###.  ####.
#....  #...#  #...#
#....  #..##  #...#
.###.  #.#.#  ####.
....#  ##..#  #.#..
....#  #...#  #..#.
####.  .###.  #...#
```

## 6. Tiles, decoration and backdrop

Drawn back to front: backdrop, decoration, tiles, pickups, enemies, hero, effects.

### Wall variant

"Wall" means a `#` cell, or any cell outside the grid on the left, right and top. For every wall cell:

```
base = (cell above is wall ? 0 : 1) + (cell below is wall ? 0 : 2)    // 0 fill, 1 top, 2 bottom, 3 beam
if base == 0 and hash(col, row) % 5 == 0: use wall_fill_b
lay trim_left over it if the cell to the left is not wall; trim_right likewise
```

Below the bottom row counts as wall for this rule (the picture ends there). The tile builder may bake the trims into extra tile pictures so that walls stay on one layer.

### Hazards

`F`, `W` and `S` cells use the `fire`, `coolant_top` or `coolant_body`, and `spikes` tiles. They animate by swapping the tile picture on the tick counts given in the manifest. The part that kills is smaller than the cell: the kill boxes of `docs/ARCHITECTURE.md` (5.4), set by the `spikeInset*`, `fireInset*` and `coolantInsetTopPx` fields of `TUNING.forgiveness`. The art is drawn 1 px larger than the kill box on each side, so a near miss looks like a near miss and the froth of a pool can be waded through. If those insets change, the hazard pictures are redrawn to match.

### Decoration

Only in empty cells, never colliding, never animated, chosen by `h = hash(level, col, row)` so a level always looks the same:

| Rule | Tile |
|---|---|
| Any of the 8 neighbours is wall | `bg_panel` (the seamed frame when `h % 4 == 0`) |
| The cell above is wall and `h % 9 == 0` | `bg_chain` down 1 to 3 empty cells, ending in `bg_hook` |
| Panel cell with wall on its left or right, `h % 11 == 0` | `bg_vent` |
| Panel cell with a panel cell to its right, `h % 7 == 0` | `bg_pipe_h` across the run |
| Panel cell with a panel cell below, `h % 13 == 0` | `bg_pipe_v` down the run |
| Panel cell directly under a wall, `h % 6 == 0` | `bg_brace` |
| A 2 x 2 block of panel cells, `h % 23 == 0` | `bg_porthole` |

The panel is drawn first; of the other rules the first that matches wins. Cells holding a pickup, the cog, the airlock or a hazard get the panel only. `hash` is any fixed integer mix of its arguments; it lives in the shell, not in the core.

### Backdrop

Fill `void`. About 40 stars per screen: single pixels in `earthlight` and `slate`, placed by a generator seeded with the level number. `backdrop_earth` once per level in the upper half. `backdrop_ridge` repeated along the bottom. Stars scroll at 0.2 of the camera's speed, the Earth and the ridge at 0.1, always on whole pixels. The Earth is drawn only while at least 45 % of its disc lies over cells where space shows (no wall, far-wall panel or porthole), and hidden again below 35 %: seen through a small window in the panels its crescent was a loose light-steel fragment, beside an Arc Moth a third wing (`openShare` in `src/shell/viewModel.ts`).

## 7. Pixel font

One font, capitals only.

- Glyph 5 x 7 px. Advance 6 px. Line height 9 px. Digits are all the same width.
- 47 glyphs, in this order on the sheet: space, `A` to `Z`, `0` to `9`, then `. , ! ? : - + / ' %`.
- On the sheet each glyph sits in a 6 x 8 cell (one empty column on the right, one empty row below), white on transparent, so a tint colours it. Text is drawn as bitmap text built from that sheet.
- Colours: white for normal text, lime for the focused menu item and level names, gold for score values (the score, `BEST`, `NEW BEST!`, the end screens' totals), amber for warnings and for `GAME OVER` (crimson reads at only 1.87 against `void`; amber 7.6), slate for disabled items. Every text has a 1 px `void` shadow down and to the right.
- Sizes: 1x, 2x for headings, 3x for the first word of the title. A heading always leads: where the large text of section 9 draws a screen's 1x lines at 2x, its 2x heading (`PAUSED`, `GAME OVER`, `THE FOUNDRY IS LIT!`, the intro card's `LEVEL 3`) is drawn at 3x; where a 3x heading does not fit, the whole screen stays at 1x with its heading at 2x. Text always sits on whole pixels.
- A 1x glyph is 5 x 7 art px. On glass that is `zoom / dpr` CSS px per art px: 10 x 14 CSS px (2.2 mm tall) on the smallest phone with the full screen height, and less in a browser tab whose toolbars take height (7.3 x 10.2 CSS px in a 740 x 280 window). `docs/ARCHITECTURE.md` (11.5) has the cases and what the shell does about them.
- No line may be longer than 42 characters (252 px; the narrowest view is 272 px).
- The game's name is never typed into a screen. The title screen takes `GAME_TITLE` from `src/meta.ts`, turns it to capitals, and draws the first word at 3x and the rest at 1x.

## 8. Top bar (HUD)

A single row along the top, y = 3 to 11 px, drawn by its own scene above the game. It is a band over the world, not words floating on it: behind the row lies a `void` strip at 85 % from the top of the view down to y = 13 (70 % until the route watch of 24 November 2026, which still read crystals and trusses behind the words as icons of the bar) (`STRIP_H` and `STRIP_ALPHA` in `src/shell/hudModel.ts`). Without it the level's own crystals and wall tops sat in the bar's row beside the score and the cog and read as part of the bar; under the strip they stay visible, dimmed. The hero never goes under it: the camera's air band is measured from the strip's lower edge, so a hero rising to the top of the view, with the fuel bar over his head, is drawn below it with as much undimmed level above him as before the strip (`docs/ARCHITECTURE.md` 11.4). The lower corners belong to the thumbs: on a touch screen the camera lets the view pass a side wall by the whole width the buttons on that side reach into it, so the airlock, a crystal or the hero by a wall is not held under a drawn button; space shows beyond the wall. When the buttons come back after keyboard play, the view glides out past the wall in under half a second, even while the hero stands (`docs/ARCHITECTURE.md` 11.4). And while the hero stands, the camera frames him so that what is near him (enemies, the cog, the airlock, packs, crystals, hazards) lies below the strip and clear of the buttons where a height up to two tiles off his usual one allows it, never bringing anything new under either: level 9's deck-2 pack, which the bottom pass had drawn dimmed in the bar's row where it read as an icon of the bar, now stands below the strip (`docs/ARCHITECTURE.md` 11.4, "Standing framing"). `W` is the view width.

| Element | Position | Reads | Notes |
|---|---|---|---|
| Lives | x = 4 (further in on a rounded corner, below); `phys.maxLives` icons (three) of `hud_life`, 9 px apart | `session.lives` | On `respawned` the icon of the life just lost blinks five times, then stays dark |
| Level | x = 36 (moves with the lives); `LEVEL 3` | `session.levelIndex + 1` (a one-level session of a campaign level, `?level=level-07` or the test hook, carries that level's own number) | Ends at x = 83 for `LEVEL 10` |
| Score | Centred on `W / 2`; five digits, gold | `session.score` | Counts up 10 per tick towards the real score; the score a level starts with is shown at once on its intro card (a CONTINUE with 1230 points counted up from 00000 under the card) |
| Cog, blaster, thruster, ten fuel pips | Right-aligned block 61 px wide, ending 4 px left of the pause button | `run.hasTrophy`, `player.hasBlaster`, `player.hasThruster`, `player.fuel` | The cog is always shown: its filled shape unlit in `rust` until it is taken, then gold (the light toothed ring of `hud_cog_0` read as a settings gear). Blaster and thruster only while held. Pips blink when two or fewer are lit |
| Pause button | Top right | | A DOM button (section 10); the bar leaves the last 24 px free on the smallest phone |
| Toast | Centred, y = 16 | Event `trophyCollected` | `COG FOUND! AIRLOCK OPEN` for `TUNING.effects.toastFrames`, on a band of the strip's dark hanging under it, as wide as the words and 4 px more each side, down to y = 25 (`TOAST_BAND_BOTTOM`): gold words straight on a truss or a crystal were garbled by the score pop-ups, which now stay below the band |
| Mini fuel bar | 12 x 2 px, 3 px above the hero | `player.fuel` while `player.thrusting` | Lime on `void`; the eyes are on the hero, not on the bar |

On the smallest phone (view 284 x 160) the gaps between the four groups are 6, 44 and 39 px; at the 272 px minimum they are 6, 38 and 33 px.

- Rounded corners: phones round the glass's corners, and Android reports a safe-area inset only for a cutout. Where the canvas starts less than 16 CSS px from the glass's side edge, the lives and the level move in so that nothing of the bar is closer than 16 CSS px to it, and the block of the right likewise (`SCREEN_CORNER_CSS` in `src/shell/hudModel.ts`); the title's sound switch keeps the same distance. Where a notch's inset or the bars beside a wide picture already keep it clear, nothing moves.
- The bar's own clocks (the toast, the life blink, the score count, the pips' blink, the intro's shutter) stand still while the pause menu is up, as the world and its particles do, and go on after RESUME: a toast or a blink is never used up under the menu.

## 9. Screens

| Screen | When | Content |
|---|---|---|
| Title | At boot, after Quit, after `TITLE` | Stars, the Earth in the upper left, the ridge along the bottom; Sprue idling on a girder that juts in from the left edge over the ridge; `logo_cog` behind the first word of the title (3x, gold) over the rest of it (1x, white); `TAP TO START` blinking once a second (`PRESS SPACE TO START` when a keyboard was used last); `BEST 07900` in gold once there is a best score; the sound switch top right (also the M key; saved in the settings). With saved progress, two buttons instead of the prompt: `CONTINUE - LEVEL 7` and `NEW GAME`. A tap anywhere but the switch, or Space, Enter, Up, W, X or Z, starts. The first tap also asks for fullscreen on touch devices, outside frames. The `start` jingle plays on the first start of a visit only |
| Level intro | Event `levelStarted` | A shutter wipe, then, over the dimmed level (top bar included), a `ui_panel` plate with `LEVEL 3` (2x), the level's `@name` in lime, its `@teaches` line as the hint, the life icons. It stays for `TUNING.effects.introFrames`; a press after `introSkipAfterFrames` skips it. The core is not stepped meanwhile. Then the ready gate. `RESTART LEVEL` from a pause opened on the card ends the card: the restarted level waits at its ready gate (`RESUME` goes back to the card) |
| Ready gate | `run.phase === 'ready'` | The level, still. The hero blinks by dimming to 35 % every other 8 ticks (he used to be hidden then, and a picture taken then showed no hero); after 90 ticks of waiting a small white chevron blinks over his head. No text and no countdown: the first control pressed starts the world (a control still held from before must be let go first) |
| Pause | PAUSE, Esc or P; the page hidden or blurred; a phone turned upright | The game dimmed under a 160 x 130 panel: `PAUSED` (2x); buttons `RESUME`, `RESTART LEVEL -1 LIFE`, `QUIT TO TITLE`, each 144 x 22 px; switches `SOUND ON` and `BUZZ ON` side by side. Everything under it stands still, the top bar's clocks included. A key held through the menu does not start the world after it: its auto-repeats are not presses |
| Level clear | Event `levelCompleted` | Banner `LEVEL CLEAR +200` (2x, white; the number is the event's `bonus`) on a `ui_panel` plate under the top bar (y = 26, clear of the hero in the airlock), with the tally `SCORE 01230` in gold under it, counting up with the top bar's score; for as long as the hero stands in the airlock (the exiting phase, `phys.exitTicks`): shown from that phase itself, not from a clock, so a pause in the airlock cannot take it down early. The core ends the level as soon as his box touches the airlock, often in mid-fall on its lintel: the picture eases him into the cell over 6 ticks, centred, feet on its floor |
| Game over | Event `gameOver` | Stars, Earth and ridge, and Sprue's girder, empty. `GAME OVER` (2x, amber with the `void` shadow); `SCORE 04250`; `BEST 06100`, or a blinking `NEW BEST!` when the score beats the best score as it was when this run began (gold; no best line in a development room, which is never saved); buttons `TRY AGAIN - LEVEL 7` and `TITLE` |
| Win | Event `gameWon` | `THE FOUNDRY IS LIT!` (2x, gold); the backdrop glows amber (the lower half in six stepped amber strips, strongest at the ridge, breathing slowly; still under reduced motion); Sprue back on his girder; lines appear 30 ticks apart, each with the `uiOk` tick: `SCORE 06400` (before the bonus), `LIVES LEFT 3 X 500`, `TOTAL 07900`, `NEW BEST!` (or `BEST`); buttons `PLAY AGAIN` and `TITLE`, there from the start |
| Rotate | A touch device held upright | A phone outline turning, and `ROTATE YOUR PHONE` under it. Turning back shows the pause screen; the game never resumes by itself. The words are in the pixel font (src/main.ts draws them into a canvas at up to 3 CSS px per art px, smaller where a narrow window needs it, keeping 8 CSS px from each side: `rotateDevicePerArt` in `src/shell/screenText.ts`). The phone (`src/shell/rotateArt.ts`, 16 x 16, drawn at twice the words' size, so never wider than they are) has a `light steel` rim round a `steel` case, an `indigo` screen with an `earthlight` glint and cut corners; it is shown upright, then sideways, 800 ms each (`src/shell/rotate.css`). Under reduced motion it stands still, sideways |

- Menus work by touch, mouse and keyboard (arrows move the lime focus, Space or Enter confirms).
- Menu rows are at least 44 CSS px tall wherever the view is tall enough for the whole menu. The sizes above (22 px rows, a 160 x 130 panel) are the smallest; where one art pixel is less than 2 CSS px (a browser tab with toolbars) the rows and the panel grow, as `menuLayout` in `docs/ARCHITECTURE.md` (11.5) says. The 12 px switches (`btn_sound`, `btn_vibe`) have an invisible hit area of at least 44 CSS px.
- Large text: where one art pixel is under 1.5 CSS px, a 1x letter would be about a millimetre tall on the glass. There every 1x line of a menu, its button labels and its switch labels are drawn at 2x, and its 2x heading at 3x so that it still leads, provided the whole menu, heading included, still fits the view with 44 CSS px rows (else everything stays 1x, the heading 2x); the intro card's name and hint likewise at 2x, each where it fits across the view (a line too wide for one 2x line is wrapped onto two at a word boundary, rather than left at 1x: level 3's hint was a millimetre tall on a 568 x 232 tab), with `LEVEL 3` at 3x over them. The top bar stays 1x.
- `NEW BEST!` on the game-over and win screens compares the final score with the best score remembered when the run began, never with the saved best score, which has already been raised by then (`docs/ARCHITECTURE.md`, 11.3).
- Screens change with a 12-tick shutter wipe: the new screen (the title, an end screen, a level's intro card) starts covered by two `void` blades with a 1 px `slate` edge, which open from the middle, slowing as they go. The pause menu opens at once, over the still game. Under reduced motion there is no wipe.
- Every screen also names the canvas with its words (`aria-label`, never drawn), for screen readers and the browser tests: the pixel font cannot be read by either.
- The level number in `CONTINUE` and `TRY AGAIN` is the level that will start: the saved run's level, or after a game over the highest level reached.
- The ten hint lines are the `@teaches` headers of the level files; they are listed in `docs/LEVELS.md`.

## 10. Touch buttons

The buttons are DOM elements over the canvas, laid out in CSS pixels by `src/input/touchLayout.ts` from the `touch` group of `src/tuning.ts`. Every size, margin, opacity and time below is a field of that group; the values are not repeated here.

| Button | Shape | Size field | Glyph | Shown |
|---|---|---|---|---|
| LEFT, RIGHT | Rounded squares, corner radius 12 | `moveButtonSize` | `btn_arrow` (flipped for LEFT), white | Always on touch devices |
| JUMP | Circle | `jumpButtonSize` | `btn_jump`, white | Always |
| FIRE | Circle | `fireButtonSize` | `btn_fire`, lime | Only while `player.hasBlaster` |
| THRUST | Circle | `thrustButtonSize` | `btn_thrust`, lime | Only while `player.hasThruster` |
| PAUSE | Rounded square | `pauseButtonSize` | `btn_pause`, white | Always |

- Fill `night`, a 2 px rim in `light steel` (`#8090b4`). The glyph is the sprite grid drawn onto a small canvas inside the button at a whole number of device px per art px (as near as can be to 3 CSS px for JUMP, 2 for the others), with `image-rendering: pixelated`. The buttons, their rims (an inset shadow, rounded to whole device pixels) and the glyphs sit on whole device pixels, also at ratios such as 2.75; each glyph has a transparent art pixel round it, so no lit pixel of the art is ever at the canvas's edge, where the browser blends.
- The whole button has opacity `opacityIdle` when idle and `opacityPressed` when pressed, and a pressed button is drawn at `pressedScale`.
- FIRE drops to `opacityDimmed` while a bolt is in flight (`run.bolt.active`); THRUST drops to it when the tank is empty (`player.fuel === 0`).
- FIRE and THRUST fade in over `appearMs` with one pulse when their item is picked up (no pulse under reduced motion), always in the same place for the whole level, and vanish when the item is lost.
- Every action button sits on the bottom row, below the hero's feet line: THRUST just left of JUMP (a thumb slides from JUMP onto it for a flight), FIRE left of THRUST; in a level without a thruster pack FIRE takes THRUST's place beside JUMP (`ItemSlots` in `src/input/touchLayout.ts`, set by the Play scene when a level starts). Until 24 November 2026 THRUST sat above JUMP, on the hero's own row 8 to 10 tiles ahead on the 568 x 320 phone: where a long flight lands and where level 8's mid-air pack floats, so the pack lay behind a button whose glyph looks like it (`src/shell/routeView.test.ts` now replays the ten proofs on the device table and checks every take-off).
- One finger holds one button. JUMP, FIRE and THRUST all belong to the right thumb, so no moment of the game needs two of them at once (`docs/LEVELS.md`, rules 8 and 9).
- No labels: the glyphs are the labels. Each button carries an `aria-label`.

## 11. App icon

The `icon` grid (32 x 32): Sprue's rim and lime eye inside a gold cog on `night`. The build draws the PNG files from it each time (the `offline-app` plugin in `vite.config.ts`, with `src/pwa/build.ts`; written by `src/art/tools/png.ts` with Node's own `zlib`), enlarging by whole numbers only so the pixels stay square. No PNG file is kept in the project: redraw the grid and the next build has the new icons. (Planned as a separate script, `scripts/make-icons.mjs`; built into the build step instead, so the grid is the only source.)

| File | Size | Art |
|---|---|---|
| `icon-192.png` | 192 | 6x, edge to edge |
| `icon-512.png` | 512 | 16x, edge to edge |
| `icon-maskable-512.png` | 512 | 12x (384 px) centred on `night`, so a round mask cuts nothing off |
| `apple-touch-icon.png` | 180 | 5x (160 px) centred on `night` |

These four files are the only images in the built game. The browser tab icon reuses `icon-192.png`.

Checked by `src/pwa/build.test.ts`: each file decodes to its size, every pixel is an opaque palette colour, and every pixel is exactly the grid's pixel it falls in (or `night` around the art). On the maskable icon nothing but `night` lies outside the centred circle of 40% of the width, the zone a round mask keeps. Looked at on 24 November 2026, all four at full size: the cog and the eye are crisp, and the maskable and apple-touch icons have their border of `night`. The full Chromium also accepts them as install icons with the game served from a sub-folder (`e2e/subpath.spec.ts`, no installability errors). The same check fails with `no-acceptable-icon` when the manifest's icon addresses start with `/`.

## 12. Sound

### How sounds are made

- One private `AudioContext`. Every effect is one to three voices: an oscillator or filtered noise, into a gain envelope, into a master gain (0.6), into a compressor.
- Noise comes from one buffer of 1 s of white noise, built at boot from a seeded generator.
- All pitched effects are built on the note D (D major for the fanfares, D minor pentatonic for the crystal ladder), so effects that overlap stay in tune.
- "A to B" below is an exponential frequency slide. Gains are peak values. Unless a recipe says otherwise the attack is 5 ms and the sound fades to silence at its end.
- At most 6 voices at once; the oldest is dropped.
- Recipes are data (`src/audio/recipes.ts`). The function that plays one takes `(ctx, destination, startTime, recipe)`, so a browser test can render every effect offline and check that it is not silent.
- Audio starts on the first tap or key press on the title screen (browsers allow sound only after a touch has ended). Nothing is queued before that.

### Effects

| Id | Played on | Recipe |
|---|---|---|
| `jump` | Event `jumped` | Square, 196 to 392 Hz in 90 ms; gain 0.16; silent at 110 ms |
| `land` | Event `landed` with `speed` of 768 or more (3 px per tick) | Noise through a 500 Hz low-pass, 50 ms, gain 0.10 |
| `gem` | Event `pickup` with kind `crystal` | Square, one note of the ladder D5 F5 G5 A5 C6 D6 (587, 698, 784, 880, 1047, 1175 Hz), 90 ms, gain 0.12. The ladder climbs one step when the last crystal was less than `TUNING.effects.crystalLadderFrames` ago, otherwise it starts again |
| `item` | Event `pickup` with kind `blaster` or `thruster` | Sawtooth 220 to 880 Hz in 180 ms through a 2 kHz low-pass, gain 0.14; then square A5 (880 Hz), 60 ms |
| `cog` | Event `trophyCollected` | Triangle and square together: D5, F#5, A5 (587, 740, 880 Hz) at 80 ms each, then D6 (1175 Hz) for 320 ms; gain 0.18 |
| `airlock` | Event `doorOpened`, delayed 320 ms so it follows `cog` | Noise through a 1.8 kHz high-pass, 450 ms, gain 0.12 falling to 0; plus a sine 110 to 73 Hz, 250 ms |
| `clear` | Event `levelCompleted` | Square run D5 E5 F#5 A5 (587, 659, 740, 880 Hz) at 70 ms each, then A5 and D6 together for 300 ms; gain 0.16 |
| `bolt` | Event `boltFired` | Square 1320 to 330 Hz in 110 ms, gain 0.12 |
| `boltHit` | Event `boltEnded` with hit `wall` | Noise through a 3 kHz band-pass (Q 2), 35 ms, gain 0.08 |
| `enemyDown` | Event `enemyKilled` | Noise through a low-pass sliding 2000 to 200 Hz, 200 ms, gain 0.20; plus square 147 to 55 Hz, 160 ms |
| `thrust` | State, not an event: a loop while `run.phase === 'playing'` and `player.thrusting` | Noise through a 320 Hz band-pass (Q 0.7) plus a 55 Hz sawtooth at 0.05; fades in over 30 ms and out over 80 ms; gain 0.10 |
| `fuelLow` | State: every 8 ticks while thrusting with `player.fuel` at 20 % of `phys.fuelTicks` or less (twice with the shipped tank of 80 ticks: 16 and 8 ticks before it is dry; a warning repeats) | Square 880 Hz, 35 ms, gain 0.08 |
| `fuelEmpty` | Event `fuelEmptied` | Triangle 440 to 110 Hz in 220 ms, gain 0.14 |
| `death` | Event `playerDied` | Sawtooth 440 to 55 Hz in 420 ms, plus noise through an 800 Hz low-pass for 300 ms; gain 0.22 |
| `gameOver` | Event `gameOver` | Triangle D4, C4, A3 (294, 262, 220 Hz) at 180 ms each, then D3 (147 Hz) for 500 ms; gain 0.18 |
| `win` | Event `gameWon` | Square and triangle: D4 A4 D5 F#5 A5 D6 (294, 440, 587, 740, 880, 1175 Hz) at 100 ms each, then D5, F#5 and A5 together for 700 ms; gain 0.18 |
| `uiMove` | Menu focus moves (shell only) | Square 660 Hz, 25 ms, gain 0.08 |
| `uiOk` | Menu item confirmed; each line of the win screen (shell only) | Square 660 to 990 Hz, 60 ms, gain 0.08 |
| `start` | The first tap on the title, once (optional) | 2.0 s jingle. Square lead D4 A4 F4 C5 B4 G4 A4 (294, 440, 349, 523, 494, 392, 440 Hz) at 200 ms each, then D5 (587 Hz) for 600 ms; triangle bass D3 (147 Hz) under the first four notes and G3 (196 Hz) under the rest; gain 0.14 |

Events with no sound of their own: `levelStarted`, `readyEnded`, `bonked`, `thrustStarted` and `thrustStopped` (the loop follows the state, so it can never be left running), `pickupRestored` (it comes with `fuelEmptied`), `respawned`, and `boltEnded` with hit `enemy` (covered by `enemyDown`) or `range`.

On the last level `clear` plays at `levelCompleted` and `win` at `gameWon`, when the exiting phase ends. On the last death `death` plays at `playerDied` and `gameOver` when the dying phase ends.

### Sound switch

A switch on the title and pause screens, and the M key. Off slides the master gain to 0 in 30 ms, stops the thrust loop and starts no new voices. The choice is saved in the settings (`sound`). Sound is on by default. Every sound fades out when the game pauses (the menu's own `uiMove` and `uiOk` still play); the audio is suspended while the page is hidden or the window loses focus.

## 13. Feedback: shake, flashes, vibration

All of it is presentation: none of it changes what happens in the game. When the device asks for reduced motion much of it is off or still: see "Reduced motion" below. Strengths and lengths that the owner may want to tune are fields of `TUNING.effects` and `TUNING.touch`; the table names them.

| Effect | On | Detail |
|---|---|---|
| Screen shake | `playerDied` | `shakeDeathPx` for `shakeDeathFrames` |
| | `enemyKilled` | `shakeKillPx` for `shakeKillFrames` |
| | `landed` after a fall of `shakeLandMinFallTiles` or more | `shakeLandPx` for `shakeLandFrames`. The shell remembers the hero's highest point since it left the ground |
| Hit stop | `enemyKilled` | The shell does not step for `killHitStopFrames` (never during a replay). The stop on death (`TUNING.timing.hitStopFrames`) is part of the core's dying phase |
| Hero flash | `playerDied` | Filled white during the hit stop; for cause `fire` amber and for `coolant` ice after its first 3 ticks (white first, so the silhouette stands out from flames of the same amber). A death by falling out of the level is drawn at the view's bottom edge, the whole sprite showing, with its debris from there (the core kills him below the bottom row, out of sight) |
| Enemy flash | `enemyKilled` | Filled white for 2 ticks, then `fx_poof` |
| Screen flash | `trophyCollected` | Gold at 20 % for 4 ticks |
| Score pop-up | `pickup` and `enemyKilled` with a `score` above 0, `trophyCollected` | `+10` in gold, rising 12 px over 30 ticks; beside what scored, on the side away from his travel, when the hero rises through it. Never above y = 16 (under the top bar), nor above y = 28 while the cog's toast shows; never on another pop-up, nor on the hero's sprite or his fuel bar: where its own place breaks a rule it takes the nearest free one, pushed down under the pop-ups above it or beside, above or below him (`PopupBoard`, `src/shell/fxModel.ts`). Held under the toast's band, the cog's `+100` and a crystal's `+10` used to share one row across the hero ("1+100", levels 1 and 2) |
| Airlock pointer | `doorOpened`, when the airlock is off screen | A lime chevron at the screen edge pointing to it: nudging for 180 ticks, then still and at 55 % for as long as the cog is held and the airlock is off screen. A cell flush with an edge, or wholly under the top bar's strip, counts as off screen |
| Fade | `playerDied`, `respawned` | Out during the last `fadeFrames` ticks of dying; in during the first `fadeFrames` ticks after `respawned` |
| Vibration | `playerDied` | `vibrateDeathMs` |
| | `trophyCollected` | Two pulses of `vibrateCogPulseMs`, `vibrateCogGapMs` apart |
| | `fuelEmptied` | `vibrateEmptyTankMs` |

Vibration works only where the phone allows it (not on iPhones), never on ordinary button presses, and is switched off by `BUZZ OFF` (saved in the settings as `vibration`). One named exception: switching `BUZZ ON` gives one sample buzz (the cog's two pulses), so the player feels what was switched on, as switching the sound on plays `uiOk`.

### Reduced motion

When the device asks for reduced motion (`prefers-reduced-motion: reduce`; read once as each screen is built, `src/shell/motion.ts`):

- **Off:** the screen shake, the cog's screen flash, the shutter wipe, and every particle (dust, sparks, sparkles, the hero's and the enemies' scrap, embers, the thruster's exhaust).
- **Still instead of moving:** score pop-ups appear where they would rise from and stay there; the airlock pointer does not nudge; the win screen's glow does not breathe; the rotate message's phone shows sideways and does not turn; FIRE and THRUST appear without their pulse.
- **Steady instead of blinking:** `TAP TO START`, `NEW BEST!`, the low fuel pips (they stay lit), the hero in the ready gate (shown at full strength) and its waiting chevron, and the icon of a life just lost (dark at once).
- **Kept,** because each is the event itself, happens once and covers one sprite: the hero's fill when he dies (white, amber or ice) and his break-apart frames, the enemy's white fill and its `fx_poof`, and the fades of a death and a respawn. So a death still reads. Sprite animation (fire, coolant, glints, walking) and the backdrop's parallax stay: they are the picture, not effects.

`e2e/motion.spec.ts` plays the debug room and a death with the setting on and off and checks each of these that moves the view or the screen.

## 14. Checks

Tests that keep this document true (they arrive with the art and the sound):

- Every sprite of the manifest exists with the listed size and number of frames; every row of a frame has the same length; every character is a palette code or `.`.
- The font has all 47 glyphs at 5 x 7.
- Every fixed text the game shows is at most 42 characters and uses only the font's characters. `src/meta.test.ts` checks the title and `tests/levels.test.ts` checks level names and hints. `src/shell/screenText.test.ts` checks every fixed line of the screens at the size it is drawn (2x and 3x included) against the narrowest view, with 4 px to spare on each side.
- Every sound recipe renders to something that is not silent and does not clip (a browser test, because Node has no WebAudio).
- No file in `src/art` or `src/audio` is imported by `src/core`.

## 15. How to look at the art

The art is text, so nobody sees it by reading the grids. Two tools in `src/art/tools` turn it into PNG files; both run with plain `node` from `game/` and need no build:

- `src/art/tools/preview.ts` draws sprites: a labelled sheet, an animation strip (frames, mirrored, and at 1x, 2x and 3x), a stage of sprites on wall tiles beside the hazards, the font, the packed textures, the palette, or the whole contact sheet.
- `src/art/tools/scene.ts` draws a level file as the game shows it: backdrop, decoration, tiles, pickups, the cog, the airlock, enemies and Sprue, from the same tile choices as the game (`src/art/tilePick.ts`). `--window C,R --view 30x14` shows one phone screen with the backdrop's parallax.

Three pictures in `docs/art` show the art as it stands. Open them before and after changing a sprite:

| Picture | What it shows | Made by |
|---|---|---|
| `docs/art/contact-sheet.png` | Every sprite and frame, labelled with its size, frame count and ticks, then the 47 glyphs and the text colours; all at 3x on `night` | `node src/art/tools/preview.ts contact --width 1400 --in-project docs/art/contact-sheet.png` |
| `docs/art/room-test.png` | `levels/test.txt`, the whole level at 2x | `node src/art/tools/scene.ts levels/test.txt --zoom 2 --in-project docs/art/room-test.png` |
| `docs/art/room-debug.png` | `levels/debug.txt`, the whole level at 2x | `node src/art/tools/scene.ts levels/debug.txt --zoom 2 --in-project docs/art/room-debug.png` |

Judge a sprite at the size a player sees it: one art pixel is 2 to 4 screen pixels on a phone, so look at the 2x and 3x rows of a strip or a stage, and at a phone window of a level, as well as at a large zoom for the pixel work. Other pictures belong in a scratch folder: the tools refuse to write inside `game/` without `--in-project`.
