# Levels

How to design, write and review a level, and the plan for the ten levels of version 1. The levels themselves are built later, one at a time.

The exact file grammar and every parser error message are in `docs/ARCHITECTURE.md` (section 8); the validator is in its section 9; the numbers behind the limits below are in its section 13. Where this document and that one disagree about a number, that one is right and this one needs fixing.

## 1. The level file

A level is a text file in `levels/`. Header lines first, then the grid: one character per tile, 16 px per tile.

```
@name Format Example
@teaches Every letter of the legend, once
@hardest 12,3 the two-tile coolant pool
@requires thruster
; a free comment
########################################
#......................................#
#.P..G..B..J....C...S..F....M...H..T.D.#
############WW##########################
```

| Header | Meaning |
|---|---|
| `@name text` | The level's name. Shown on the level intro, in capitals |
| `@teaches text` | The one-line hint shown under the name on the level intro, in capitals. Written for the player, not for developers |
| `@hardest col,row note` | The cell where the level's hardest moment is, with a note for reviewers. Columns and rows count from 0 |
| `@requires blaster` or `@requires thruster` | A promise that the level cannot be won without that item. A test tries to win without it and must fail. One line per item |
| `; text` | A comment. Only before the grid |

`@name` and `@teaches` hold at most 42 characters each, from the pixel font's set: letters, digits, space and `. , ! ? : - + / ' %`. Levels 1 to 10 must have `@name`, `@teaches` and `@hardest`.

| Char | Meaning | Notes |
|---|---|---|
| `#` | Wall | The only thing that blocks movement |
| `.` | Empty | |
| `P` | Sprue's start | Exactly one. The cell below must be `#` |
| `T` | Golden cog trophy | Exactly one |
| `D` | Airlock door | Exactly one. Does nothing until the cog is taken |
| `G` | Ore crystal | 10 points, never needed |
| `F` | Furnace fire | Kills. Not solid |
| `W` | Coolant | Kills. Not solid: a pool is a pit that kills sooner |
| `S` | Spikes | Kills. Not solid. Stand them on a floor |
| `B` | Bolt blaster | |
| `J` | Thruster pack | Fills the tank |
| `C` | Cinderpeg | The cell below must be `#`. Starts walking left |
| `M` | Arc Moth, up and down | Starts upward |
| `H` | Arc Moth, left and right | Starts leftward |

**Caps:** at most 64 columns and 24 rows; at most 16 enemies (`C`, `M` and `H` together); at most 4 thruster packs. Every row has the same length. These caps are provisional for levels with thruster packs: before the first campaign level is built, the real validator must pass the gate in `docs/ARCHITECTURE.md` (section 9.6). If it does not, the size cap for thruster levels is lowered (48 x 16 first), then the pack cap, the new numbers are recorded here, and the plan in section 5 is changed to fit.

**Edges:** outside the grid is solid on the left, the right and the top, and open below: falling out of the bottom row kills. The top row and both side columns must be `#` all the same, so the picture has a frame; the bottom row may have holes. The level reader does not insist on the frame; `tests/levels.test.ts` does, for every file in `levels/`. A level should be at least 30 x 14 so that it fills the largest view.

The files `level-01.txt` to `level-10.txt` are the game, in that order. `test.txt` and `debug.txt` are development levels (section 6). Every file in `levels/`, development levels included, must pass the validator.

## 2. What Sprue can do

Measured with the numbers in `src/tuning.ts` as shipped (the "reference tuning" of `docs/ARCHITECTURE.md`, section 12). A test (`src/core/limits.test.ts`) asserts the whole-tile limits on the live numbers, so a change of feel numbers that moves one fails by name; the same test keeps the tables below as snapshots.

| Ability | Limit |
|---|---|
| Run | 5.6 tiles per second. Real progress through a level averages 2.5 to 3 tiles per second |
| Jump height | 3.3 tiles with jump held; a quick tap is a 1-tile hop |
| Step up | 1, 2 or 3 tiles (jump held for 3, 7 or 12 frames at least). 4 tiles is impossible |
| Gap | 4 tiles at most on the level; see the table below |
| Fall | Any height, unharmed. Walking off a ledge at full speed carries Sprue 0.8 tiles sideways in the first tile of fall, 1.5 tiles after 3, 2.3 tiles after 5 |
| Passages | Sprue fits through a passage 1 tile high or 1 tile wide. Under a ceiling he can still climb a step as long as 1 tile of headroom is left above it, and he can jump into a hole 1 tile high in a wall |
| Holes | A hole 1 tile wide always swallows a walking Sprue. It is the smallest real pit |
| Thruster | On a full tank, with THRUST simply held and no jump: 8.5 tiles straight up from standing; 11.9 tiles across a level gap under open sky, 10.5 under a roof 2 tiles above the ledge (10.4 and 9.2 with the clumsy-thumb numbers). Ask for no more than **6 tiles of climb or 8 tiles of level flight per tank**; 9 tiles of flight only with at least 4 clear tiles above the take-off. A thumb cannot hold JUMP and THRUST together, so the higher keyboard figures (11.7 up, 14.8 across) are never needed by a level |
| Blaster | A bolt flies 10 tiles, level with Sprue's body. It hits only what stands in, or crosses, the row Sprue is in. After a miss the next shot is 0.67 s away |
| View | The smallest screen shows 17 x 10 tiles, the largest 30 x 14 |

### Jump windows

The window of a jump is the number of frames in a row in which pressing jump clears it, in the worst case, for a Sprue running at full speed with the direction held. A bigger window is an easier jump. Each cell shows two numbers: the window with the shipped numbers, and the window under the comfort proof's clumsy-thumb numbers (no coyote time, no jump buffer, run and jump 5 % weaker). "any" means that simply running off the edge also lands; `-` means impossible.

| Landing is | Gap of 1 tile | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 3 tiles up | 29 / 21 | 19 / 10 | 8 / - | - | - | - |
| 2 tiles up | 35 / 27 | 25 / 16 | 14 / 5 | 1 / - | - | - |
| 1 tile up | 39 / 31 | 29 / 20 | 18 / 9 | 7 / - | - | - |
| level | 43 / 35 | 33 / 24 | 22 / 13 | 11 / 2 | - | - |
| 1 tile down | any | 37 / 28 | 26 / 17 | 15 / 6 | 5 / - | - |
| 2 tiles down | any | 41 / 32 | 30 / 21 | 19 / 10 | 9 / - | - |
| 3 tiles down | any | any | 34 / 25 | 23 / 14 | 13 / 2 | - |
| 4 tiles down | any | any | 38 / 29 | 27 / 18 | 17 / 6 | 6 / - |

Hazards on level ground are tighter than pits of the same width, because Sprue must be in the air over the whole bed and cannot take off late:

| Bed on level ground | 1 tile wide | 2 | 3 |
|---|---|---|---|
| Spikes | 27 / 24 | 16 / 13 | 6 / 2 |
| Furnace fire | 25 / 22 | 14 / 11 | 4 / - |

A coolant pool behaves as a pit of the same width. To make a hazard jump as easy as a pit, sink the bed one tile below the floor, or stand a 1-tile crate on each side of it.

The tables assume there is room to land. A small pad with a drop behind it is harder, because Sprue must also stop. Windows when everything is let go 0, 4 or 8 frames after touching down:

| Gap, then a level pad, then a deadly gap | At once | After 4 frames | After 8 frames |
|---|---|---|---|
| 2-tile gap, pad 1 tile wide | 16 / 17 | 12 / 13 | 8 / 9 |
| 2-tile gap, pad 2 tiles wide | 27 / 24 | 23 / 24 | 19 / 21 |
| 3-tile gap, pad 2 tiles wide | 22 / 13 | 22 / 13 | 20 / 13 |
| 3-tile gap, pad 3 tiles wide | 22 / 13 | 22 / 13 | 22 / 13 |

So a pad on the required route is at least 2 tiles wide. A 1-tile pad with a drop behind it is in the forbidden class for anyone who reacts in 8 frames.

### Jump classes

| Class | Shipped window | Which jumps | Where allowed |
|---|---|---|---|
| Ordinary | 18 frames or more | Up 3: gap 1 or 2. Up 2: gap 1 or 2. Up 1, level, down 1: gap up to 3. Down 2, 3 or 4: gap up to 4. A 1-tile bed of spikes or fire | Everywhere |
| Tight | 14 to 17 | 3-tile gap rising 2. 4-tile gap dropping 1. 5-tile gap dropping 4. A 2-tile bed of spikes or fire on level ground | At most one per level, and only in levels 9 and 10 |
| Hardest | 10 to 13 | The level 4-tile gap. 5-tile gap dropping 3 | Once in the whole game, in level 10 |
| Forbidden | Under 10, or impossible | Everything else, and any landing pad 1 tile wide with a drop behind it | Never on the required route. Fine for an optional crystal if failing costs nothing |

**The comfort proof does not check these classes.** It shows that a route exists without coyote time and jump buffer, with weaker run, jump and fuel. It does not measure how much time the player has: the search finds jumps whose window is 2 frames. So a tight or hardest jump passes the test like any other. The classes are kept by the person who builds the level and checked by the person who reviews it, jump by jump, from these tables. Whether the one hardest jump of the game stays is decided at the owner's playtest of level 10.

One dependency to know: with the clumsy-thumb numbers the jump is 2.98 tiles high, so every 3-tile step is climbed only thanks to the 3 px ledge catch (`ledgeCatchPx`), and needs jump held for 14 frames instead of 12.

### Enemies

| | Cinderpeg `C` | Arc Moth `M` / `H` |
|---|---|---|
| Moves | Along the floor, 1.9 tiles per second (32 frames per tile) | In a straight line, 2.8 tiles per second (21.3 frames per tile) |
| Turns at | A wall, a hazard, the grid edge, the end of its floor | A wall, a hazard, the grid edge |
| Lane | From turn to turn. Give it a floor with a clear end on both sides | Must be closed at both ends. A lane of 5 cells takes 85 or 86 frames one way, depending on the cell the moth starts in |
| Getting past without the blaster | With 3 tiles of headroom or more it can be jumped. In a passage 1 tile high it cannot be passed at all. In one 2 tiles high only a frame-perfect hop passes, so treat it as blocked | Wait until it is at the far end of its lane, then go |
| Worth | 50 | 100 |

A Cinderpeg one tile above or below Sprue's row cannot be shot: the bolt passes over or under it. Neither enemy reacts to Sprue, so their timing is fixed from the moment the level starts moving.

The numbers in this section come from `docs/ARCHITECTURE.md`, section 13, where it is also said how they were measured. Three facts were measured for this document only, with a throwaway model of the rules, and still need the real core's tests behind them: the Cinderpeg row "getting past", climbing a step under a ceiling, and jumping into a hole 1 tile high.

## 3. Design rules

1. **One new idea per level.** Teach, test, twist: the idea appears first where a mistake costs nothing, then where it costs a life, then together with one older idea.
2. **A safe start.** No enemy lane within 6 tiles of `P`, no hazard within 3. Standing still at the start must never kill.
3. **Jumps follow the classes above.** Levels 1 to 8 use ordinary jumps only. Every landing pad on the required route is at least 2 tiles wide. The test does not check this rule (see "Jump classes"); the builder and the reviewer do.
4. **The hardest jump is in the middle.** Never the first obstacle and never the last one before the airlock. Mark it with `@hardest`.
5. **Sprue can see where he lands.** The landing of every required jump is within 5 tiles ahead, 4 tiles above or 3 tiles below the take-off. A longer drop needs a column of crystals to show it is meant.
6. **Crystals show the way.** They trace the arc of the intended jump or flight. About a third sit off the route as an optional risk. None is out of reach.
7. **No dead ends that do not kill.** Every pocket Sprue can get into has a way out by plain jumping, or holds a hazard. After the cog is taken, the airlock is reachable from everywhere Sprue can be. The validator does not check this; the reviewer does, by eye. The last resorts are the packs that reappear on an empty tank and "Restart level".
8. **Every thruster section starts at a pack**, and asks for at most 6 tiles of climb or 8 tiles of level flight before the next pack or solid ground (9 tiles of flight only with at least 4 clear tiles above the take-off). These limits are for a player who simply holds THRUST with one thumb. Never require JUMP and THRUST, or THRUST and FIRE, at the same moment: both pairs sit under the same thumb.
9. **Items are honest.** If the level cannot be won without an item, say so with `@requires`. To make the blaster truly required, put a Cinderpeg in a passage 1 tile high that the route must go through. A passage 2 tiles high works in practice, but if the `@requires` test finds the frame-perfect hop, lower it to 1 tile. **Every shot the route needs can be made standing on the ground in the enemy's own row**, with the enemy within 10 tiles and nothing solid between: give Sprue a ledge or a porch level with the enemy. The validator never fires in the air, and a thumb cannot hold THRUST and FIRE together.
10. **Length fits the time.** The route from start to cog to airlock is 80 to 100 tiles for a 30-second level, 150 to 180 for 60 seconds, at most 250 for 90 seconds.
11. **Original layouts only.** Every layout is invented for this game from these limits. None follows a level of another game. The rule set the owner asked for (ten levels, a trophy that opens the exit, a gun, a fuel-limited jetpack) is shared with at least one platformer of the late 1980s, *Dangerous Dave*, so the builder and the Phase 6 reviewer keep clear of everything that game is recognised by: no layout modelled on one of its rooms; no status bar along the bottom of the screen and no message there telling the player to go to the door; no walk-through corridor screen between levels; no jetpack that is switched on and off (ours is held, and its packs reappear); no enemies that shoot. If a level, a screen or a text reminds a reviewer of an existing game, it is changed.
12. **Keep thruster air small.** The cost of proving a level grows with the air a fuelled Sprue can reach and with the number of packs. Put a roof over long flights and walls beside shafts; do not build one open hall with several packs in it. Measured on the reference validator: three roofed decks with two lifts and 2 packs, proven in 0.05 million steps; one open 64 x 24 hall with 4 packs and 4 enemies, 13 to 28 million, a quarter of the whole test's budget.

## 4. Review checklist

A level is done when every line is ticked.

- [ ] `npm run check` passes: the normal proof, the comfort proof and every `@requires` test for this level, with the whole levels test still inside its step budget (about 60 seconds on the build machine). The `@requires` lines the test prints for this level end in a real verdict, not `budget-exceeded`.
- [ ] The headers are filled in: `@name`, `@teaches` (the hint from section 5, at most 42 characters), `@hardest` pointing at the real cell, one `@requires` line per item the level cannot be won without.
- [ ] Size and counts are inside the caps, and match the plan in section 5 or the difference is explained in a `;` comment.
- [ ] The level teaches its one new idea in three beats: free, costly, combined.
- [ ] The start is safe (rule 2).
- [ ] Every required jump was looked up in the tables by the reviewer, not left to the test: ordinary, except where the plan allows one tight or hardest jump. Every required landing pad is at least 2 tiles wide.
- [ ] The hardest jump is neither the first nor the last obstacle.
- [ ] Every landing is visible from its take-off (rule 5), judged on a 17 x 10 view.
- [ ] No dead end without a hazard; the airlock is reachable from everywhere after the cog (rule 7). Checked by eye, pocket by pocket.
- [ ] Every Cinderpeg has a floor with two clear ends; every Arc Moth lane is closed at both ends; no enemy lane crosses the start area.
- [ ] Every thruster section starts at a pack and stays inside 6 tiles of climb or 8 of level flight (9 with 4 clear tiles above the take-off). Nothing on the route needs two buttons of the right thumb at once.
- [ ] Every shot the route needs can be made from the ground in the enemy's row (rule 9).
- [ ] No crystal is out of reach: `LEVELS_CRYSTALS=1 npx vitest run tests/levels.test.ts` prints the crystals the search could not collect, and prints none for this level. About a third of the crystals are off the route.
- [ ] The validator's own route was watched once in the browser at normal speed, and it looks like something a person would do.
- [ ] The layout is original and keeps clear of the list in rule 11.
- [ ] Thruster air is small (rule 12): the level's two proofs together cost under 10 million steps in the test's printout.

## 5. The ten levels

Ten halls of the foundry, from the cold outer dock to the Heart Furnace. Columns and rows count from 0. Positions in the descriptions are targets for the builder, not law; the built level's `@hardest` header carries the real cell. "Clean" is a run without a death; "first" is the expected time of a first clear.

| # | Name | Size | The one new idea | Tightest window | Crystals | Items | Enemies | Requires | Clean / first |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Cold Start | 40 x 14 | The golden cog opens the airlock | 33 | 12 | - | - | - | 25 s / 25 s |
| 2 | Slag Gaps | 60 x 14 | Pits and spikes cost a life | 22 | 16 | - | - | - | 25 s / 41 s |
| 3 | Quench Hall | 56 x 14 | Landing on small pads | 22 | 18 | - | - | - | 29 s / 66 s |
| 4 | The Stack | 30 x 24 | The way is up, and falling is free | 18 | 20 | - | - | - | 50 s / 81 s |
| 5 | Blaster Bay | 56 x 14 | The bolt blaster and the Cinderpeg | 22 | 14 | B | 4 Cinderpegs | blaster | 32 s / 53 s |
| 6 | Moth Shafts | 60 x 16 | A moving hazard in the air: wait, then go | 22 | 16 | B | 4 Arc Moths (M), 1 Cinderpeg | - | 39 s / 87 s |
| 7 | Thruster Loft | 44 x 24 | The thruster pack and its fuel | 22 | 18 | 3 J | - | thruster | 41 s / 92 s |
| 8 | Crucible Run | 64 x 16 | Refuelling in the air | 18 | 18 | 4 J | - | thruster | 42 s / 122 s |
| 9 | Sorting Line | 56 x 24 | Both tools together: clear the way, then fly | 15 | 22 | B, 2 J | 4 Cinderpegs, 3 Arc Moths (2 M, 1 H) | blaster, thruster | 71 s / 201 s |
| 10 | Heart Furnace | 64 x 24 | There and back: everything, in order | 11 | 26 | B, 3 J | 3 Cinderpegs, 3 Arc Moths (2 M, 1 H) | blaster, thruster | 85 s / 344 s |

Totals: 180 crystals, 12 Cinderpegs, 10 Arc Moths; 7.3 minutes clean, about 18.5 minutes for a first clear. Points in the levels: 6,400; with three lives left at the end, 7,900. That is why the score shows five digits.

The ramp is a saw-tooth: each new tool arrives in a forgiving level (4 and 7), and the pressure returns in the next one.

| Level | What can kill | Expected deaths on a first clear |
|---|---|---|
| 1 | Nothing | 0 |
| 2 | Pits, spikes | 1 |
| 3 | Coolant | 2 |
| 4 | Fire only; falls are safe | 1 |
| 5 | Cinderpegs, one pit | 1 |
| 6 | Arc Moths, vents | 2 |
| 7 | One coolant pond | 2 |
| 8 | A floor of fire | 3 |
| 9 | Everything | 3 |
| 10 | Everything | 5 |

### 1. Cold Start
- **Hint:** `The golden cog opens the airlock`
- **Layout:** a hook. The locked airlock is at column 7 beside the start, with the cog in view on a catwalk above it. Run east past two 1-tile crates, climb a stair (steps of 1, 1 and 2 tiles) at columns 31 to 38, return west along the catwalk 4 tiles up, over two 2-tile gaps (falling through lands on the floor), take the cog, step off and land beside the airlock.
- **Hardest:** column 35, the 2-tile step up (jump held for 7 frames).
- **Can kill:** nothing. No hazard, no pit, no enemy.

### 2. Slag Gaps
- **Hint:** `Mind the gaps. Spikes bite.`
- **Layout:** one run east over a broken floor. Open pits of 2, 2 and 3 tiles; then three 2-tile spike beds, each between two 1-tile crates so that the jump is from crate to crate; a 2-tile pit landing 1 tile up on a raised deck; a last 3-tile pit in that deck at columns 40 to 42. The cog is on a shelf 2 tiles above the deck at column 46; it can be run under, and then the airlock at column 56 stays shut, 10 safe tiles away.
- **Hardest:** column 40, the 3-tile pit with a level landing (22 / 13).

### 3. Quench Hall
- **Hint:** `Coolant freezes robots. Land small.`
- **Layout:** a dry trench 1 tile deep (columns 6 to 8) rehearses a 3-tile gap for free. Then a coolant channel 32 tiles long (columns 12 to 43) crossed on six pillar tops: pads 3, 2, 2, 3, 2 and 2 tiles wide, gaps of 2, 3, 2, 3, 2, 3 and 3 tiles, pads stepping 1 tile up or down. A 3-tile gap never rises. The cog is on the last pad; the airlock on the far bank at column 52.
- **Hardest:** column 36, the 3-tile gap onto the 2-tile cog pad (22 / 13).

### 4. The Stack
- **Hint:** `The way is up. Falling is free.`
- **Layout:** a chimney. The floor is the bottom row. Six ledge tiers zig-zag upward, 3 tiles apart, joined at alternate ends by steps of 2 and 3 tiles. A flue 4 tiles wide runs down the middle; ledges bridge it with gaps of 2 and 3 tiles, and a miss lands one tier down. Single fire tiles sit on the ledges from tier 2; tier 4 has two, with a tile of floor between them. The cog is at the top. The airlock is on the floor by the start, reached by dropping 18 tiles down the flue through a column of crystals.
- **Hardest:** tier 4, column 12, a 3-tile gap rising 1 tile, with fire 2 tiles before the take-off (18 / 9).
- **Note:** the design asked for 26 rows; the cap is 24. Six tiers 3 tiles apart fit exactly, with 3 tiles of headroom over the top tier.

### 5. Blaster Bay
- **Hint:** `Grab the blaster. One bolt at a time.`
- **Layout:** the blaster sits in a doorway 1 tile wide at column 6 and cannot be missed. Beat 1: a corridor 12 tiles long and 2 tiles high with a Cinderpeg walking toward Sprue. Beat 2: a Cinderpeg on an island across a 3-tile pit; shoot, then jump. Beat 3: two Cinderpegs in a pen guard the cog; one bolt at a time. Airlock at column 52.
- **Hardest:** column 30, the 3-tile pit onto the island (22 / 13).
- **Requires:** blaster (the corridor of beat 1 is on the only route; see rule 9 if the `@requires` test finds a way past the Cinderpeg).

### 6. Moth Shafts
- **Hint:** `Arc Moths bob. Wait, then go.`
- **Layout:** four vents cross the floor: pits open below, grates 5 tiles overhead, an Arc Moth (`M`) bobbing in each. Vents 1 and 2 are 2-tile gaps crossed by timing alone. The blaster is at column 28. Vent 3 is 3 tiles wide. A Cinderpeg walks the open floor before vent 4, where the cog sits on a 1-tile shelf in the vent mouth; it is taken in passing, on the jump across, and nobody has to land on the shelf. Airlock at column 56.
- **Hardest:** column 38, the 3-tile vent swept by a moth: a 22-frame jump inside a safe window of about 90 frames.
- **Requires:** nothing. The blaster helps but every moth can be waited out and the Cinderpeg can be jumped.

### 7. Thruster Loft
- **Hint:** `Hold thrust to fly. Watch the fuel.`
- **Layout:** three stations, rising. A pack at column 6, then a wall 5 tiles high to fly over. A pack on the bank of a coolant pond 8 tiles wide under a roof 2 tiles above the bank: hold THRUST and fly level (start window 40 / 25 frames). A pack at the foot of a shaft 2 tiles wide and 6 tiles deep, up into the loft, where the cog is. Walk off the loft's west end and drop 5 tiles to the airlock ledge.
- **Hardest:** column 36, the 6-tile shaft, which leaves about 2.5 tiles of fuel to step sideways at the top (1.7 with the clumsy-thumb numbers). Plain jumps: a 3-tile gap (22 / 13).
- **Requires:** thruster.

### 8. Crucible Run
- **Hint:** `Fly far. Refuel in the air.`
- **Layout:** the floor from column 8 to column 56 is furnace fire. A roof runs the whole length 4 tiles above the pillar tops, so the hall is a tunnel and not a cavern (rule 12). Three flights between pillar tops, a fresh pack before each: 7 tiles; 8 tiles, ducking under a hanging lintel; 16 tiles with a fourth pack floating at the 8-tile mark, level with the pillar tops, so the second leg starts like the first. The cog is on the third pillar. Two plain jumps over the last of the fire (3-tile gaps, the second rising 1 tile) reach the airlock bank.
- **Hardest:** columns 30 to 46, the 16-tile crossing in two 8-tile legs. Plain jump: column 57 (18 / 9).
- **Requires:** thruster.

### 9. Sorting Line
- **Hint:** `Clear the way, then fly.`
- **Layout:** three decks, snaking. Deck 1, east: the blaster at column 5, two Cinderpegs between spike beds. Lift A: a pack and a 6-tile climb past an Arc Moth that sweeps across the shaft (`H`, first seen here from a safe ledge). Deck 2, west: two Arc Moths (`M`) over 3-tile coolant gaps, then a 4-tile gap landing 1 tile lower, and a Cinderpeg on the last platform. Lift B: a pack and a 5-tile climb in a shaft with a Cinderpeg walking the lip of deck 3 at its top. On the other wall of the shaft, level with the lip, is a ledge 2 tiles wide: Sprue flies up, lands on the ledge, shoots the Cinderpeg from the ground and steps across (rule 9: no shot from the air). Deck 3, east: an easy run to the cog at column 44 and the airlock at column 52.
- **Hardest:** deck 2, column 22, the 4-tile coolant gap landing 1 tile lower (15 / 6): the level's one tight jump. The comfort proof will not object to it (it does not measure windows); if the owner's playtest does, land 2 tiles lower (19 / 10).
- **Requires:** blaster and thruster.

### 10. Heart Furnace
- **Hint:** `Relight the Heart. Then get home.`
- **Layout:** the airlock is beside the start, as in level 1. Out along the floor, east: a gauntlet of pits and spikes; coolant pads 2 tiles wide between 2-tile gaps (27 / 24; a 1-tile pad would be a second jump in the forbidden class); the blaster and a corridor 2 tiles high with two Cinderpegs; two moth vents (`M`); a pack and a 6-tile climb past a third moth (`H`) to the Heart, where the cog hangs over the furnace mouth at column 58. Home along the top catwalk, west: a 14-tile flight over the furnace mouth in two 7-tile legs with a pack in mid-air, a level 4-tile gap above the coolant, a Cinderpeg on the catwalk with a stretch of catwalk in its row to shoot it from, and a 5-tile drop to the airlock.
- **Hardest:** the catwalk, column 24, the level 4-tile gap (11 / 2), the only one in the game, about two thirds of the way along the route. With clumsy thumbs its window is 2 frames. The comfort proof passes such a jump all the same, so the test will not warn: this jump stays only if the owner's playtest of level 10 accepts it. Otherwise land 1 tile lower (15 / 6), or 2 tiles lower (19 / 10).
- **Requires:** blaster and thruster.

## 6. The two development levels

They are real level files with a cog and an airlock, and they must pass the normal proof like any level. They are not part of the game: the address `?level=test` or `?level=debug` opens one, and nothing is saved while playing it.

### `levels/test.txt`: the movement room (64 x 16)

The room in which the feel of the hero is judged, by tests and by the owner's thumbs. One of each case the movement numbers were measured on. Nothing in it can kill, and it can be walked in both directions, so every case can be tried again and again.

| Columns | Case |
|---|---|
| 6 to 15 | Steps up of 1, 2 and 3 tiles |
| 16 to 17 | The landing of a 5-tile drop |
| 18 to 19 | A pillar: the way back up to the top (a 2-tile gap, 3 tiles up) |
| 23 to 24, 28 to 30, 35 to 38 | Trenches 2, 3 and 4 tiles wide, each 2 tiles deep: falling in costs nothing |
| 43 | A hole 1 tile wide |
| 47 to 52 | A slab over a corridor 2 tiles high; its left end is the ceiling-corner case |
| 56 to 58, 60 to 62 | Two platforms, each 3 tiles up; the second across a 1-tile gap |

The cog is on the last platform; the airlock is on the floor at column 54.

### `levels/debug.txt`: the debug room (64 x 14)

Every character of the legend, in play order: crystals; spikes, fire and a coolant pool crossed by plain jumps; the blaster; an Arc Moth (`M`) bobbing under a grate; a Cinderpeg in a tunnel 1 tile high that can only be shot, from the 1-tile porch in front of it; a thruster pack at the foot of a shaft 5 tiles deep; the cog on top of the block; a second pack and an Arc Moth (`H`) between two hanging pillars for flying practice; the airlock and a last crystal.

It carries both `@requires` lines, so it is also the first fixture for those tests: the cog is only reachable up the shaft, the shaft only through the tunnel, and the tunnel is too low to jump over the Cinderpeg.

Both rooms were put through a reference implementation of the validator, written from `docs/ARCHITECTURE.md` (sections 3 to 6 and 9) on a throwaway model of the rules. The movement room is proven in 0.05 million steps (0.04 with the clumsy-thumb numbers), the debug room in 0.49 million (0.01). The debug room without its thruster packs comes back `trophy-unreachable`, and without its blaster the search runs out of things to try (`no-route`), so both `@requires` lines hold. That is a strong sanity check, not the test: the real validator has the last word once it exists.

## 7. Building a level, step by step

1. Read the level's entry in section 5 and the rules in section 3.
2. Sketch the route as a list of beats with the class of every jump, looked up in section 2.
3. Write the grid. Keep rows the same length; an editor that shows column numbers helps.
4. Fill in the headers.
5. Run `npm run check`. A level that fails names its file and says why, with the cell where the search got closest: `unsafe-start`; `trophy-unreachable` or `door-unreachable` (the layout is at fault, even with no enemies); `blocked-by-enemies` (the layout is fine, an enemy is in the way); `no-route` (the search tried everything and did not look into the reason: levels with thruster packs get this instead of the three before); `budget-exceeded` (the search gave up: the level is probably too open, rule 12).
6. Open the level in the browser and play it. Then watch the validator's route.
7. Go through the checklist in section 4.
