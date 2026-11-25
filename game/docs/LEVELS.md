# Levels

How to design, write and review a level, and the plan for the ten levels of version 1. All ten are built (`levels/level-01.txt` to `level-10.txt`); section 8 records them as built, with every change to the plan and why.

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

**Caps:** at most 64 columns and 24 rows; at most 16 enemies (`C`, `M` and `H` together); at most 4 thruster packs. Every row has the same length. These caps were provisional for levels with thruster packs until the real validator passed the gate in `docs/ARCHITECTURE.md` (section 9.6). Had it failed, the size cap for thruster levels would have been lowered (48 x 16 first), then the pack cap. It passed on 24 November 2026, so the caps stand, and the ten levels as built fit the test's step budget with room to spare (section 8).

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

**The comfort proof does not check these classes.** It shows that a route exists without coyote time and jump buffer, with weaker run, jump and fuel. It does not measure how much time the player has: the search finds jumps whose window is 2 frames. So a tight or hardest jump passes the test like any other. The classes are kept by the person who builds the level and checked by the person who reviews it, jump by jump, from these tables. The one hardest jump of the plan, the level 4-tile gap in level 10, was lowered to the tight class before the owner's playtest (section 8); whether it comes back is decided there.

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
3. **Jumps follow the classes above.** Levels 1 to 8 use ordinary jumps only. Every landing pad on the required route is at least 2 tiles wide. The test does not check this rule (see "Jump classes"); the builder and the reviewer do. The window tables assume open sky. Under a low ceiling a jump may need jump held for some length between a tap and the whole arc, or a press in coyote time after walking off; the validator tries neither and rejects such a jump even when a person can make it (`docs/ARCHITECTURE.md`, section 9.2). Give required jumps headroom, or try a jump under a ceiling with the designer's tool (`node src/tools/prove.ts levels/<name>.txt`) before building the rest of the level around it.
4. **The hardest jump is in the middle.** Never the first obstacle and never the last one before the airlock. Mark it with `@hardest`. Where a death sends Sprue back a long way, put it where a miss is cheap to retry: in level 10 a death on the way home costs the whole way out, so its hardest jump comes a sixth of the way along the way out, and nothing on the way home is tighter than ordinary.
5. **Sprue can see where he lands.** The landing of every required jump is within 5 tiles ahead, 4 tiles above or 3 tiles below the take-off. A longer drop needs a column of crystals to show it is meant.
6. **Crystals show the way.** They trace the arc of the intended jump or flight. About a third sit off the route as an optional risk. None is out of reach.
7. **No dead ends that do not kill.** Every pocket Sprue can get into has a way out by plain jumping, or holds a hazard. After the cog is taken, the airlock is reachable from everywhere Sprue can be. The validator does not check this; the reviewer does, by eye. The last resorts are the packs that reappear on an empty tank and "Restart level".
8. **Every thruster section starts at a pack**, and asks for at most 6 tiles of climb or 8 tiles of level flight before the next pack or solid ground (9 tiles of flight only with at least 4 clear tiles above the take-off). These limits are for a player who simply holds THRUST with one thumb. Never require JUMP and THRUST, or THRUST and FIRE, at the same moment: both pairs sit under the same thumb.
9. **Items are honest.** If the level cannot be won without an item, say so with `@requires`. To make the blaster truly required, put a Cinderpeg in a passage 1 tile high that the route must go through. A passage 2 tiles high works in practice, but if the `@requires` test finds the frame-perfect hop, lower it to 1 tile. On a level with thruster packs, put that passage **before the first pack**: without the blaster the test must search everything the hero can reach, and past a pack that is all the thruster air (on a stand-in for level 9, with the Cinderpeg after both packs, deciding it took about 130 to 140 million steps, more than the whole test's budget, so the test ends `budget-exceeded` and decides nothing; with the passage before the first pack, as in level 10's plan, it decides `no-route` in about 1 million). **Every shot the route needs can be made standing on the ground in the enemy's own row**, with the enemy within 10 tiles and nothing solid between: give Sprue a ledge or a porch level with the enemy. The validator never fires in the air, and a thumb cannot hold THRUST and FIRE together.
10. **Length fits the time.** The route from start to cog to airlock is 80 to 100 tiles for a 30-second level, 150 to 180 for 60 seconds, at most 250 for 90 seconds.
11. **Original layouts only.** Every layout is invented for this game from these limits. None follows a level of another game. The rule set the owner asked for (ten levels, a trophy that opens the exit, a gun, a fuel-limited jetpack) is shared with at least one platformer of the late 1980s, *Dangerous Dave*, so the builder and the Phase 6 reviewer keep clear of everything that game is recognised by: no layout modelled on one of its rooms; no status bar along the bottom of the screen and no message there telling the player to go to the door; no walk-through corridor screen between levels; no jetpack that is switched on and off (ours is held, and its packs reappear); no enemies that shoot. If a level, a screen or a text reminds a reviewer of an existing game, it is changed.
12. **Keep thruster air small.** The cost of proving a level grows with the air a fuelled Sprue can reach and with the number of packs. Put a roof over long flights and walls beside shafts; do not build one open hall with several packs in it. Measured on the reference validator: three roofed decks with two lifts and 2 packs, proven in 0.05 million steps; one open 64 x 24 hall with 4 packs and 4 enemies, 13 to 28 million, a quarter of the whole test's budget (2 and 21 million on the real validator). **A hole in a deck floor is a way up for a fuelled Sprue**, and the deck below it becomes thruster air on the route: on a stand-in for level 9, the 4-tile gap of deck 2 left open above deck 1 let a full tank be carried along deck 1 and flown up through the gap, and the two proofs cost 8.4 and 5.2 million steps (the validator's own route went that way, past half of deck 2); with coolant in the gap, 0.06 and 0.04 million. Put a hazard in such a gap, or a floor under it that leads nowhere upward, unless the second route is meant.

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
- [ ] The validator's own route was watched once in the browser at normal speed, and it looks like something a person would do. (Levels 1 to 10, 24 November 2026: watched, by replaying each proof in the built game at one tick per frame on seven windows and looking at its screenshots; the routes do not look like a person's, so that half is left to the owner's playtest. How it was done, what it found and where the results are: section 8, "The browser watch". To watch a route again, see there too.)
- [ ] The layout is original and keeps clear of the list in rule 11.
- [ ] Thruster air is small (rule 12): the level's two proofs together cost under 10 million steps in the test's printout.

## 5. The ten levels

Ten halls of the foundry, from the cold outer dock to the Heart Furnace. Columns and rows count from 0. Positions in the descriptions are targets for the builder, not law; the built level's `@hardest` header carries the real cell. "Clean" is a run without a death; "first" is the expected time of a first clear. This is the plan as it was written before building; section 8 records what was built and where it differs.

| # | Name | Size | The one new idea | Tightest window | Crystals | Items | Enemies | Requires | Clean / first |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Cold Start | 40 x 14 | The golden cog opens the airlock. | 33 | 12 | - | - | - | 25 s / 25 s |
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
- **Hint:** `The golden cog opens the airlock.`
- **Layout:** a hook. The locked airlock is at column 7 beside the start, with the cog in view on a catwalk above it. Run east past two 1-tile crates, climb a stair (steps of 1, 1 and 2 tiles) at columns 31 to 38, return west along the catwalk 4 tiles up, over two 2-tile gaps (falling through lands on the floor), take the cog, step off and land beside the airlock.
- **Hardest:** column 35, the 2-tile step up (jump held for 7 frames).
- **Can kill:** nothing. No hazard, no pit, no enemy.

### 2. Slag Gaps
- **Hint:** `Mind the gaps. Spikes bite.`
- **Layout:** one run east over a broken floor. Open pits of 2, 2 and 3 tiles; then three 2-tile spike beds, each between two 1-tile crates so that the jump is from crate to crate; a 2-tile pit landing 1 tile up on a raised deck; a last 3-tile pit in that deck at columns 40 to 42. The cog is on a shelf 2 tiles above the deck at column 46; it can be run under, and then the airlock at column 56 stays shut, 10 safe tiles away.
- **Hardest:** column 40, the 3-tile pit with a level landing (22 / 13).

### 3. Quench Hall
- **Hint:** `Coolant freezes robots. Stop on the pads.`
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

Both rooms were put through a reference implementation of the validator, written from `docs/ARCHITECTURE.md` (sections 3 to 6 and 9) on a throwaway model of the rules. The movement room is proven in 0.05 million steps (0.04 with the clumsy-thumb numbers), the debug room in 0.49 million (0.01). The debug room without its thruster packs comes back `trophy-unreachable`, and without its blaster the search runs out of things to try (`no-route`), so both `@requires` lines hold. That is a strong sanity check, not the test: the real validator has the last word. It agrees: 0.05 million steps for the movement room and 0.49 million for the debug room, and the same two `@requires` verdicts (`docs/ARCHITECTURE.md`, section 9.6).

## 7. Building a level, step by step

1. Read the level's entry in section 5 and the rules in section 3.
2. Sketch the route as a list of beats with the class of every jump, looked up in section 2.
3. Write the grid. Keep rows the same length; an editor that shows column numbers helps.
4. Fill in the headers.
5. Run `npm run check`. A level that fails names its file and says why, with the cell where the search got closest: `unsafe-start`; `trophy-unreachable` or `door-unreachable` (the layout is at fault, even with no enemies); `blocked-by-enemies` (the layout is fine, an enemy is in the way); `no-route` (the search tried everything and did not look into the reason: levels with thruster packs get this instead of the three before); `budget-exceeded` (the search gave up: the level is probably too open, rule 12).
6. Open the level in the browser and play it. Then watch the validator's route.
7. Go through the checklist in section 4.

## 8. The ten levels as built

Built one at a time and reviewed against the checklist of section 4, then put together and measured as one campaign on 24 November 2026, on the live numbers. A review of the whole campaign followed the same day, and levels 2, 5, 6, 7, 8 and 10 were changed after it (the last list of this section). A second review found a way to leave level 10's cog behind, deaths a player could not see coming in levels 6, 8 and 10, two crystals no jump reached and levels 6 and 8 ending alike, and levels 6, 8 and 10 were changed again (marked "second review" in that list). The Phase 6 review then found level 8's second flight landing on a tight window and widened the pillar it lands on (marked "Phase 6 review"). Each file's `;` comments hold the detail: every required jump with its measured window, the three beats, and each difference from section 5 with its reason. This section is the summary. The checklist line that has the validator's route watched in the browser was done last, for all ten levels at once, after the second review ("The browser watch", below); it changed the shell, not the levels.

### What is in them

| # | Name | Size | Crystals | Items | Enemies | Requires | `@hardest` | Tightest window |
|---|---|---|---|---|---|---|---|---|
| 1 | Cold Start | 40 x 14 | 12 | - | - | - | 32,7: the 2-tile step up onto the catwalk's end (35 / 33) | 33 (the catwalk gaps) |
| 2 | Slag Gaps | 60 x 14 | 16 | - | - | - | 43,11: the 3-tile pit in the slag floor (22 / 13) | 22 |
| 3 | Quench Hall | 56 x 14 | 18 | - | - | - | 40,9: the 3-tile gap onto the 2-tile cog pad (22 / 13) | 22 |
| 4 | The Stack | 30 x 24 | 20 | - | - | - | 9,11: a 3-tile gap rising 1, off the fire catwalk (18 / 9) | 18 |
| 5 | Blaster Bay | 56 x 14 | 14 | B | 4 Cinderpegs | blaster | 28,10: the 3-tile pit onto the Cinderpeg's island (22 / 13) | 22 |
| 6 | Moth Shafts | 60 x 16 | 16 | B | 6 Arc Moths (M), 1 Cinderpeg | - | 36,12: the 3-tile vent swept by a moth (22 / 13) | 22 |
| 7 | Thruster Loft | 44 x 24 | 18 | 3 J | - | thruster | 21,16: the 7-tile flight over the coolant pond, from the pack at its edge (85 / 89) | 22 (the loft trench) |
| 8 | Crucible Run | 64 x 16 | 18 | 4 J | - | thruster | 39,9: the 15-tile crossing, 8 tiles to the floating pack and 7 more (44 / 31) | 18 (the first plain jump) |
| 9 | Sorting Line | 56 x 24 | 22 | B, 2 J | 4 Cinderpegs, 3 Arc Moths (2 M, 1 H) | blaster, thruster | 26,15: the 4-tile coolant gap landing 1 tile lower (15 / 6, tight) | 15 |
| 10 | Heart Furnace | 64 x 24 | 26 | B, 4 J | 3 Cinderpegs, 3 Arc Moths (3 M) | blaster, thruster | 29,21: the 4-tile gap on the way out, dropping 1 tile (15 / 6, tight) | 15 |

- **Totals:** 180 crystals, 12 Cinderpegs and 4 blasters, as planned; 13 thruster packs, one more than planned (level 10's two shafts); 12 Arc Moths, two more than planned (level 6's sealed first moth and its fifth vent). Every level has its planned size.
- **Points:** level 6's first moth is sealed in its slot, so no bolt reaches it and it never pays. Every other enemy can be shot: from the ground in its row, and level 9's H moth in the air (walking or hopping off the lift's lip and pressing FIRE, measured by the campaign review). So the levels pay at most 6,500 points, and 8,000 with three lives left, as `docs/SPEC.md` now says. The plan's totals (section 5) say 6,400 and 7,900: the 100 is level 6's moth in vent 5.
- **Window classes:** levels 1 to 8 use ordinary jumps only. Levels 9 and 10 have one tight jump each. Level 8's second flight landed on a tight window (17 frames when everything is let go 8 frames after touchdown) until the Phase 6 review widened its pillar (28 now; `tests/levels.test.ts` measures it). No jump in the game is of the hardest class: level 10's 4-tile gap was one (11 / 2) until the second review raised the bank before it by 1 tile, so that it drops 1.
- **Level 8's 18:** the 3-tile gap rising 1 that the plan chose. It reads 17 from a standstill at the pillar's very edge, which is not how the tables measure.

### What the proofs cost, and how long the routes take

Step calls in millions, from `tests/levels.test.ts` and `LEVELS_CRYSTALS=1`. Every normal and comfort proof was decided by the quick pass.

How the time columns are measured:
- **Route** is the length of the validator's normal route: the tiles it moves across (the distance Sprue moves sideways, added up tick by tick), plus every change of the row Sprue stands on. It counts from the first tick up to and including the win tick, the tick he enters the airlock; nothing moves in the clear pause after it. A jump that lands where it started adds nothing. Level 8's last tile is its landing on pillar 3 in the win tick itself (`step()` moves him before it checks the airlock), so a count that stops one tick early gives 72, not 73.
- **A person, clean** divides the route by 2.5 to 3 tiles per second (section 2, rule 10). It leaves out waiting for enemies.
- The validator crosses 4.5 to 5.4 tiles per second, about twice a person's pace, and never waits longer than it must.

| # | Normal | Comfort | `@requires` runs | Crystal run, map first | Validator, normal: cog / win tick | Comfort win tick | Route | A person, clean | Plan, clean |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.27 | 0.20 | | 1.38 | 622 / 679 (11.3 s) | 720 (12.0 s) | 65 tiles | 22 to 26 s | 25 s |
| 2 | 0.02 | 0.01 | | 1.46 | 597 / 659 (11.0 s) | 701 (11.7 s) | 64 | 21 to 26 s | 25 s |
| 3 | 0.02 | 0.01 | | 1.09 | 481 / 612 (10.2 s) | 632 (10.5 s) | 60 | 20 to 24 s | 29 s |
| 4 | 0.12 | 0.07 | | 2.43 | 1076 / 1169 (19.5 s) | 1212 (20.2 s) | 110 | 37 to 44 s | 50 s |
| 5 | 0.03 | 0.03 | No blaster: `blocked-by-enemies` (guided), 2.55 | 1.22 | 614 / 866 (14.4 s) | 966 (16.1 s) | 86 | 29 to 34 s | 32 s |
| 6 | 0.02 | 0.02 | | 1.40 | 666 / 879 (14.7 s) | 906 (15.1 s) | 76 | 25 to 30 s, plus the moths | 39 s |
| 7 | 0.02 | 0.07 | No thruster: `trophy-unreachable` (map), 0.35 | 12.30 | 849 / 939 (15.7 s) | 961 (16.0 s) | 94 | 31 to 37 s | 41 s |
| 8 | 0.07 | 0.02 | No thruster: `trophy-unreachable` (map), 0.17 | 6.58 | 812 / 963 (16.1 s) | 955 (15.9 s) | 73 | 24 to 29 s | 42 s |
| 9 | 0.05 | 0.03 | No blaster: `no-route` (quick), 0.45. No thruster: `trophy-unreachable` (map), 2.50 | 14.29 | 1652 / 1736 (28.9 s) | 1847 (30.8 s) | 167 | 56 to 67 s | 71 s |
| 10 | 0.06 | 0.04 | No blaster: `no-route` (quick), 0.80. No thruster: `trophy-unreachable` (map), 2.55 | 15.04 | 963 / 1772 (29.5 s) | 1862 (31.0 s) | 173 | 58 to 69 s | 85 s |

What the cost columns show:
- **Rule 12:** a level's two proofs cost 0.03 M to 0.47 M. The alarm is at 10 M.
- **All twenty proofs:** 1.16 M together (the exact step calls, summed, then rounded).
- **The seven `@requires` runs:** 9.36 M. Each one ended in a real verdict; none ended `budget-exceeded`.
- **The whole levels test** (with `test.txt` and `debug.txt`): 16.25 M of the 90 M budget, in about 4 s of validator time.
- **The crystal runs:** they found no unreachable crystal in any file. On the four levels with packs, a map-first run costs 6.6 M to 15.0 M (level 8 the least; level 10, with four packs, the most, and 27.7 M before the second review moved its cog and pack 3). They are not counted against the budget.

**The campaign as one game.** Suite (d) of the levels test plays the ten normal proofs one after another in one session, the way the game chains the levels:
- It wins the game with no death in 10,274 ticks of play: 2.9 minutes at the validator's pace.
- The score is 4,860 points in the levels (the route takes only the crystals on its way and shoots only what it must) and 1,500 for three lives left.

**Clear times against the plan.**
- **Total:** the ten routes add up to about 968 tiles. That makes a person's clean run about 5.4 to 6.5 minutes, plus the waits for enemies. The plan says 7.3 minutes; `docs/SPEC.md` now says about 6.
- **By level:** levels 1, 2 and 5 come close to their planned times; the others come to 57 to 94 % of theirs before the waits (level 6 has seven moth crossings to wait for, level 8 three flights to line up, level 10 both).
- **The order:** the three shortest routes are levels 1 to 3, and level 10's is the longest, by route (173 tiles against level 9's 167) and by the validator's time (1,772 ticks against 1,736). The saw-tooth of section 5 shows in the lengths too: 65, 64, 60, then 110 for level 4, 86, 76, 94 and 73 for levels 5 to 8, then 167 and 173.
- **`docs/SPEC.md`:** it said "25 to 90 seconds" a level and "about 7 minutes" for all ten, the plan's numbers. Levels 2 and 3 come to 20 to 26 s by this measure and level 10 to 58 to 69 s, so it now says 20 to 70 seconds and about 6 minutes. A person stopping on level 3's pads, as its hint asks, takes longer; the owner's playtest decides.
- **Not measurable by proofs:** a first clear (18.5 minutes in the plan) and the expected deaths. The proofs never die.

### The ramp

The table counts the moments on the required route where a miss costs a life. The counts are a reading of each file's comments, not a measurement.

| # | The one new idea (`@teaches`) | What can kill | Moments that cost a life | Tightest window |
|---|---|---|---|---|
| 1 | The golden cog opens the airlock. | Nothing | 0 | 33 |
| 2 | Mind the gaps. Spikes bite. | Pits, spikes | 7: four pits, three spike beds | 22 |
| 3 | Coolant freezes robots. Stop on the pads. | Coolant | 7: the coolant gaps | 22 |
| 4 | The way is up. Falling is free. | Fire only | 3: the fire beds (a missed jump lands one flight down) | 18 |
| 5 | Grab the blaster. One bolt at a time. | Cinderpegs, one pit | 4: the pit, the island's Cinderpeg, the pen's two (the cog's roof is free) | 22 |
| 6 | Arc Moths bob. Wait, then go. | Arc Moths, vents, a Cinderpeg | 8: five vents out, two of them back, the Cinderpeg | 22 |
| 7 | Hold thrust to fly. Watch the fuel. | One coolant pond | 1: the pond (the first flight falls back into the start room; the shaft cannot be missed) | 22 |
| 8 | Fly far. Refuel in the air. | A floor of fire | 7: three flights, two plain jumps out and the same two back | 18 |
| 9 | Clear the way, then fly. | Spikes, coolant, fire, both enemies (no open pit) | About 9: the first Cinderpeg on deck 1 and its two spike beds, the moth in lift A, two moth gaps, the tight gap, the last platform's Cinderpeg, the fire bed on deck 3 | 15 |
| 10 | Relight the Heart. Then get home. | Everything | About 12: a spike bed, two pad gaps, the 4-tile gap, two corridor Cinderpegs, two moth vents, the fire pit in the Heart, the flight over the flue, the moth gap, the tunnel's Cinderpeg | 15 |

This is the saw-tooth of section 5:
- The pressure rises through levels 2 and 3.
- It drops in level 4, where falls are free, and in level 7, where the thruster arrives with one deadly moment.
- It climbs again from level 8 to level 10.

Each level brings its own idea, and no two look alike. Rendered whole and side by side (`node src/art/tools/scene.ts`, zoom 1), they are:

| # | Shape |
|---|---|
| 1 | A hook-shaped hall under a catwalk |
| 2 | A broken floor that climbs a slag heap at its end |
| 3 | Pillar tops over a channel |
| 4 | A zig-zag chimney |
| 5 | A low corridor, an island and a roofed pen, with the cog up on the roof |
| 6 | A row of vents under ducts, the last two crossed there and back to a block under a beam |
| 7 | Stations rising to a loft |
| 8 | A roofed tunnel over fire, the last two jumps there and back to a flat bank |
| 9 | Three snaking decks |
| 10 | A there-and-back: a low hall out, two shafts, a loop in the Heart, a flue and a catwalk home |

Levels 2 and 3 share the most: both are 14 rows high and run east. But level 2 has open pits and spike beds and ends by climbing a heap, while level 3 has evenly spaced pillar tops over coolant.

Where the cog is: on the way, near the end, in levels 2, 3, 7 and 9; a place to go to and come back from in levels 1 and 4 (the hook, the chimney); fetched from a branch in levels 5 (a step on the pen's roof), 6 (a block under a beam, past the airlock) and 8 (the floor of the bank's corner, past the airlock); and hanging in a well at the far end of a loop in level 10.

Levels 6 and 8 still share a plan: the airlock right after the hardest obstacle, then two more obstacles to the cog in the east, crossed there and back. Until the second review both cogs also sat on a block 2 tiles high in the east corner; level 8's now lies on the floor. The obstacles differ (moth vents against plain jumps over fire), and so do the levels' ideas.

### Changes to the plan, and why

- **Level 1.**
  - The stair turns: two 1-tile steps east, then the 2-tile step west onto the catwalk's end. A catwalk that returns west cannot pass over a stair that climbs east beneath it.
  - The catwalk's end covers step 1, so the 2-tile step is the only way up. With step 1 open, a 3-tile jump straight up skipped step 2.
  - The drop's crystals hang above the drop (column 7, rows 4 to 6), so they are not taken from the floor at the start.
  - The hardest cell moves from column 35 to 32.
  - The hint ends with a full stop, as the other nine do.
- **Level 2.**
  - The first 2-tile pit is a dry trench, so the idea is met once where a miss costs nothing.
  - The first spike bed is sunk 1 tile into the floor.
  - The take-off crates are 3 tiles wide. From a 1-wide crate the hop had 5 frames.
  - The pits come in the other order: the level 3-tile pit (the hardest) first, then the 2-tile pit rising 1. Built in the plan's order, the hardest pit was the last deadly obstacle (rule 4).
  - The plan's shelf became a slag heap, two 2-tile steps high, with the cog 2 tiles above its top: it can still be passed under, and the level climbs at its end instead of looking like level 3.
  - So the hardest pit is at columns 42 to 44, the cog at column 55 and the airlock at column 58.
- **Level 3.**
  - The free beat is a dry pad 2 tiles wide between two dry gaps. The plan's dry trench landed on a wide bank, so stopping on a small pad was first met over coolant.
  - The channel moves to columns 15 to 46, and the far bank is 8 tiles long, not 11.
  - The hint says "Stop on the pads", not "Land small", which read as jargon.
- **Level 4.**
  - The climbing tiers are 6 tiles apart, not 3. A floor 3 tiles above a jump leaves 2 tiles of headroom, and the jump bumps its head.
  - The flue is a walled shaft 1 tile wide by the east wall, so a missed jump lands one flight down, not on the floor. The drop is 19 tiles.
  - Three tiles of floor follow the two fires of the hardest tier. Two tiles of floor between the fires were tried and dropped.
- **Level 5.**
  - The corridor is 1 tile high, not 2. In a corridor 2 tiles high, a hop held for exactly 3 frames passed the Cinderpeg without the blaster.
  - The pen's roof runs on to the east wall, so the airlock's alcove opens only into the pen.
  - The pen's porch is in the Cinderpegs' row, behind a dip where they turn, so every shot is taken from out of their reach.
  - The cog is not in the pen but on a step at the east end of the pen's roof, climbed to from the porch and fetched back. With the cog in the pen the route was about 52 tiles, the shortest in the game; now it is about 86.
  - The airlock is at column 53.
- **Level 6.**
  - A fifth Arc Moth, sealed in a slot that Sprue walks under, so the first meeting costs nothing.
  - A fifth vent, with a sixth moth, and the cog on a block at the east end past it. The airlock stands at column 41, right after the hardest vent, so the cog is fetched and vents 4 and 5 are crossed back from their east lips, the unsafe ones (the twist). The route went from about 54 tiles to about 77 (76 as the level stands after the second review).
  - So the cog no longer floats over vent 4, where a short hop crossed under it.
  - Vent 4 is 2 tiles wide, not 3, so the last jump is easier than the hardest one.
  - Second review: a beam hangs 1 tile above the cog's block (row 8, cols 56-58), so every jump off it west is a short arc onto the 2-tile floor before vent 5. Without it a jump held 7 frames or more hit the east face of vent 5's duct and dropped into the vent; with the moths, LEFT and JUMP held off the block died in all 300 phases of vent 5's moth, and now lands safely in all 300.
- **Level 7.**
  - The pond is 7 tiles wide, not 8. The plan's 40 / 25 frames was measured over an open pit, where a late press still flies out. Over coolant those presses die: 8 tiles gave 23 / 11, and 7 give 34 / 22.
  - Pack 2 hangs over the pond's edge, not 3 tiles before it. From there, RIGHT and THRUST held from pack 1 on, the input station 1 teaches, ran the tank dry over the pond. Now any press from the cliff top on crosses (85 / 89), and the fuel lesson is the shaft's, where running dry is free.
  - The hardest moment is the pond, not the shaft. With LEFT and THRUST held from its foot, the shaft cannot be missed.
- **Level 8.**
  - The long crossing is 15 tiles (8 + 7), not 16. Eight tiles for the second leg left the comfort tank dry over the fire.
  - A second lintel hangs after the floating pack. Without it, THRUST from the middle of pillar 2 carried Sprue over the pack, and pulsed thrust crossed without it.
  - Pillar 1 is 6 tiles wide, so a flight stopped by the first lintel lands 3 tiles from the fire (RIGHT may stay held 33 frames after touchdown).
  - Second review: the first lintel ends over pillar 1 (cols 18-20), and its tip hangs to 1 tile above the pillar's last tile, which is one tile further east; flight 2 is 7 tiles, not 8. The first build's lintel was 5 tiles long (cols 18-22), 3 of them over the fire, and 2 tiles above the pillar: a THRUST pressed a tile or two before it lifted Sprue a little, held him under it while the tank burned, and dropped him into the fire short of pillar 2, between the safe early presses and the winning ones (17 deadly frames from the pillar's west end, 31 with clumsy thumbs). Now an early press lifts him against the lintel's face and sets him back on the pillar, and every later press up to just after the edge wins: 27 / 30 frames, 26 / 30 when everything is let go at touchdown on pillar 2, 19 / 30 when let go 8 frames after. (Those landing figures were measured one frame short of the protocol of section 2; by it they were 25 / 30 and 17 / 30 from the worst place on pillar 1, so the Phase 6 review changed the level again, below.)
  - The plain jumps come rising first, so the tightest window is not the last obstacle.
  - Pack 2 hovers over pillar 1, so the idea is first met where a miss is free.
  - Pack 1 hangs over the fire's edge, not 4 tiles before it: THRUST held from the pack crossed into the fire's middle and no further.
  - The airlock is on pillar 3, where the crossing lands, and the cog in the far corner, past the plain jumps, which are crossed there and back. The route went from about 61 tiles to about 78.
  - Second review: the cog lies on the bank's floor, not on a block 2 tiles high, so level 8 does not end like level 6. The route is about 74 tiles.
  - Phase 6 review: pillar 2 is 4 tiles wide (cols 28-31), not 3. Flight 2 runs along the roof until the tank is dry and lands far along pillar 2; on 3 tiles a player who let go 8 frames after touchdown had 17 frames from a run along pillar 1, the tight class, which rule 3 keeps out of level 8. Now 28 / 30 (`tests/levels.test.ts` measures it from every standing pixel). The tile came from the bank (now cols 59-62): everything from the crossing east moved one column, so the floating pack is at 39,9 (`@hardest`) and the airlock at 49,9. The crossing keeps its 15 tiles and its window (44 to 46 / 31 to 33 from anywhere on pillar 2); the cost is that from pillar 2's west end THRUST must now come at least 12 frames after RIGHT, not 2 (27 with clumsy thumbs, not 16), or the tank runs dry short of the floating pack. The route is about 73 tiles.
- **Level 9.**
  - The Cinderpeg that makes the blaster necessary walks a tunnel 1 tile high on deck 1, before the first pack (rule 9). That is why its `@requires blaster` run decides in 0.45 M.
  - The combined beat's Cinderpeg walks a tunnel 1 tile high behind a porch at the top of lift B. On the plan's open lip, a fuelled Sprue flew past it.
  - The hardest gap is at columns 24 to 27.
  - Deck 2's coolant lies flush with the floor, about a frame tighter than a pit.
- **Level 10.**
  - The airlock is in a room over the start, reached at the very end by a drop off the top catwalk. A death keeps the cog and puts Sprue back on the start, so an airlock the start can reach lets a death skip the whole way home.
  - The level's hardest jump, the 4-tile gap, is on the way out, a sixth of the way along the route: a miss costs about 30 tiles. The first build had it on the catwalk home at three quarters of the route, where each miss re-ran the whole way out. The catwalk's gap is now an ordinary 3-tile gap with a moth over it.
  - Second review: the 4-tile gap drops 1 tile (15 / 6, tight), not level (11 / 2, the game's one jump of the hardest class). A death keeps the cog and puts Sprue back on the start, so every death after the gap (8 of the level's 12 deadly moments) means jumping it again, with a 2-frame window for clumsy thumbs. The run-up bank (cols 23-27) is raised 1 tile for it, which is section 5's fallback, made where the gap now is; the hop onto the bank from the coolant pad now rises 1 (29 / 20). Emptying row 21 at cols 23-27 restores the level gap.
  - Two shafts, each with a pack at its foot, and the cog at the far end of a loop in the Heart (out along a lower path, up a well through the cog, back along a crawlway). The plan's one shaft with a moth sweeping its lip was level 9's lift A again; the H moth went with it, and the third moth bobs over the catwalk gap. Four packs, not three.
  - Second review: the cog hangs at the top of the well (59,4), level with the block's top, so every way from the lower path onto the block and the crawlway passes through it. At the well's foot (59,7), as first built, a running jump east pressed a tile or so before it cleared it and landed on the block (9 of 41 press frames), and the way home without it ended in the airlock room, shut, with no hazard and no way out (rule 7). With fire in the new cell and the cog moved to the tunnel, the map of everything Sprue can reach finds no route.
  - Second review: pack 3 hangs over the flue's first column, under the lintel (44,7), not on the lip where the drop lands (48,7). From there THRUST had to be pressed while Sprue was under the lintel; a later press dropped him in the fire, and with clumsy thumbs so did 6 earlier ones. Now any press before walking off the lip wins (50 / 52 frames from the drop's landing with an empty tank; with fuel left from shaft 2 an early press sets him back on the lip, then 24 / 25 win), and no press dies early.
  - The corridor's first lane is 1 tile high, not 2. In a lane 2 tiles high a hop held exactly 3 frames slipped past its Cinderpeg (47 of 66,000 tries).
  - The catwalk's Cinderpeg walks a tunnel 1 tile high and must be shot, from the tunnel's mouth, after waiting on a ledge 1 tile above its row where it cannot reach and no bolt can hit it. Every other shot in the game is taken from a porch in the enemy's row.
  - The route is about 173 tiles, the longest in the game; the first build's was 124, shorter than level 9's.
  - Second review: the two crystals over the low hall hang 3 tiles above its floor (19,17 and 24,17), where a full jump takes them: from the bank, and from the pad with the shipped numbers (4.6 px to spare; not with clumsy thumbs). One row higher, no jump in the hall reached them, only a fuelled Sprue flown back from shaft 1.
  - The start platform stands 4 tiles above the low hall, so the way out cannot be walked back.
  - The second corridor Cinderpeg's lane runs on to the edge of vent 1, so vent 1 is jumped from a run, not from a 1-tile pillar.

### The browser watch

The checklist line "watched once in the browser at normal speed" was done for all ten levels on 24 November 2026, after the second review, by the agents that build the game, not by a person.

- **How.** Each level's normal proof, the file `e2e/scripts/level-NN.json` that `e2e/levels.spec.ts` replays, was played in a scratch build through the test hook (`window.__E2E__.replay`) at one tick per frame, the game's own speed. It was frozen for a screenshot at the intro card, the ready gate, every 60 ticks, 10 ticks before and after every jump and flight, the cog, the airlock opening and the level clear; then once more for one death per level and its respawn. Seven windows: three phones on touch (568 x 320 at 2, 844 x 390 at 3 with a notch and a home bar, 915 x 412 at 2.625) and four on keys (1280 x 720, 844 x 390, 740 x 360 at 2.75, and a 568 x 232 browser tab at 2), plus a shorter run on touch. Several thousand pictures were looked at, beside the hook's readings for each tick (camera, buttons, top bar).
- **What it found.** 29 findings from the two passes (some found by both), all met in the shell: no level file was changed for them. The worst: THRUST, then drawn above JUMP, covered level 8's packs before its take-offs. Others: things ahead hidden under the buttons or the top bar, the camera, the cog's toast garbled by pop-ups, the hero hovering on the airlock at a clear, deaths by falling drawn below the screen, the airlock pointer, `?level=` showing LEVEL 1, off-palette particles, and no cue at the ready gate.
- **What was changed.** Every action button now sits on the bottom row; on touch the camera passes a level's bottom by the buttons' reach; the ground ease moves at most 4 px a tick, and the view looks further up while THRUST is held; the hero is drawn inside the airlock at a clear and at the view's edge when he falls out; the toast has a band of its own and pop-ups keep out of the top bar; and more (`docs/ART-AND-SOUND.md` sections 8 to 10 and 13, `docs/ARCHITECTURE.md` 11.4 and 11.8). Tests hold them: `e2e/routewatch.spec.ts` sees each fault again in the built game, on the tick where the watch found it, and `src/shell/routeView.test.ts` plays the ten proofs through the shipped camera and pad on 14 touch windows and finds nothing a take-off aims for under a thumb button.
- **Left as it was,** by the fix round's own list: the thruster pack and the THRUST glyph still look alike (they no longer overlap); sideways camera steps of 4 to 6 px; the toast over a hero high in the view; level 6's Cinderpeg still walks past the airlock on its floor (column 41) and is drawn in front of it.
- **The re-check** of the fixes, done the same way, found three faults: on touch phones the bottom pass put parts of level 9 under the top bar's strip; pop-ups piled up on each other and on the hero at the cog of levels 1 and 2; level 9's pool moth sat under FIRE and THRUST for longer. Two fixes did not hold either (level 9's lift-B Cinderpeg under the strip on the 568 x 320 phone; level 5 at 844 x 390 on touch). The shell's re-check fixes (commit 3c1db1b) fixed the first two: counted with the shell's route probe on 25 November 2026, level 9's deck-2 pack is under the strip on no tick, and no pop-up lands on another or on the hero in levels 1, 2, 5 and 9. Still open: the pool moth, the two fixes that did not hold, and level 2's cog not clearly seen on the hops to its heap. `docs/PLAN.md`, Phase 4, lists them with what was measured.
- **"Looks like something a person would do": no.** The validator jumps every 2.5 to 5 tiles of its route, 15 to 55 times a level (25 times in level 1's 65 tiles), far more often than the gaps and steps on the way ask for: it shows that a level can be crossed, not how a person would cross it. That half of the line is left to the owner's playtest.
- **Where the results are.** The screenshots and probes were working files of the session that made them; they are not in the repository. What they showed is kept as the two tests above, the changes in the docs named there, and this list. To watch a route again: open the built game with `?e2e=1` and, in the browser's console, run `await window.__E2E__.replay('level-03', script, 1)` with `script` the contents of `e2e/scripts/level-03.json`; or draw it over the whole level with `node src/tools/prove.ts levels/level-03.txt --route <scratch>/level-03.png`.

### Left to the owner's playtest

- **Fuel at level 9's tight gap.** Level 9's tight gap (15 / 6) is that tight only for a Sprue with an empty tank. Fuel left over from lift A turns it into a choice: by the file's own copy, a jump with a short thrust at the apex crosses even a 5-tile gap. Level 10's 4-tile gap (15 / 6) comes before any pack, so it is always jumped with an empty tank.
- **Level 10's gap as the game's hardest jump.** The plan made it level (11 / 2) and left it to this playtest; the second review lowered it to tight before the playtest, because every later death in level 10 means jumping it again. Emptying row 21 at cols 23-27 of `levels/level-10.txt` puts the level gap back.
- **The clear times** (above).
- **Level 8's flights.** Flight 2 and the crossing have windows of 24 to 46 frames (30 to 33 with clumsy thumbs), depending on where on the pillar THRUST is pressed and how soon everything is let go after landing. Flight 2 lands far along pillar 2, so a player who keeps RIGHT held after landing has less time there: 28 frames when everything is let go 8 frames after touchdown, 24 after 12 (4-tile pillar since the Phase 6 review). THRUST pressed before RIGHT burns the tank where Sprue stands, and only the fuel bar shows it: standing under the first lintel's tip, where he cannot rise, a lead of more than 14 to 21 frames drops him in the fire short of pillar 2, and at pillar 2's east end, where he rises to the roof before the crossing, a lead of more than 23 frames drops him in the fire too (3 to 10 frames under the tip and 10 at the east end with clumsy thumbs). Further west on pillar 1 such a press is free: the lintel's face holds him and he is set back on the pillar. From pillar 2's west end, THRUST pressed less than 12 frames after RIGHT (27 with clumsy thumbs) runs the tank dry short of the floating pack. Whether players read these is for the playtest.
- **Level 10's tunnel.** Stepping down from the ledge and tapping FIRE wins for 558 of 660 phases of the Cinderpeg's patrol; the rest are the phases when it is right at the mouth. Whether a player reads the ledge as the place to wait is for the playtest.
- **How a person crosses each level.** The browser watch (above) could not judge whether the validator's route looks like a person's: it does not, it hops all the way. Whether a player takes the way the crystals show is for this playtest.
