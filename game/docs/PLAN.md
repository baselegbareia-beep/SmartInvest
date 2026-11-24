# Build plan

The game is built in seven phases. A phase is finished only when its exit check passes. Two commands are part of every exit check: `npm run check` (types, lint, unit tests, build) and `npm run e2e` (the built game in a headless browser).

Machines cannot judge how a game feels in the hand. Six of the seven phases therefore end with a playtest by the owner on their own phone, listed in the last column. Until that playtest is done the phase is "built", not "accepted".

## Status

| Phase | What the player gets | Status | Owner's playtest on a phone |
|---|---|---|---|
| 0. Design and skeleton | A title screen, and the game described on paper | built (the GitHub check has not run yet, see below) | Not needed. The owner reads `docs/SPEC.md` and answers two questions |
| 1. Movement | Sprue runs and jumps in the movement room | built (exit check below passes; owner's playtest still to do) | Yes: does the jump feel right |
| 2. Core loop | Crystals, the cog, the airlock, hazards, lives, score, all screens | built (exit check below passes; owner's playtest still to do) | Yes: is dying and coming back fair and clear |
| 3. Items and enemies | The bolt blaster, the thruster pack, Cinderpegs and Arc Moths | built (exit check below passes; owner's playtest still to do) | Yes: does flying and firing work under the thumbs |
| 4. Validator and levels | The ten levels, each proven winnable | in progress (validator and all ten levels built, reviewed as a campaign and proven, levels test inside its budget; the browser replay of level 1's proof is still to write, see below) | Yes: play all ten levels |
| 5. Polish and installable app | Final pictures and sound; installs and plays offline | not started | Yes: install it, play offline |
| 6. Review and release | A link to the finished game | not started | Yes: final sign-off from the link |

Statuses used: not started, in progress, built (the automated exit check passes), accepted (the owner's playtest is done).

## Phase 0. Design and skeleton
- **Builds:** the project in `game/` (TypeScript strict, Phaser 4.2 pinned, Vite, Vitest, ESLint, Playwright); a title screen that boots; a build that runs from any sub-folder address (relative asset paths); the contract of the simulation (`src/core/types.ts`, `docs/ARCHITECTURE.md`); every feel number (`src/tuning.ts`); the spec, this plan, `docs/ART-AND-SOUND.md` and `docs/LEVELS.md`; a copy of the Phaser 4 skill files (`docs/phaser-skills`) and the verified Phaser 4 recipes (`docs/PHASER4-NOTES.md`); the two development levels as files; the workflow `.github/workflows/game.yml`, which checks every pull request and, on the main branch, publishes the existing site with the built game under `/game/`.
- **Exit check:** `npm run check` and `npm run e2e` pass. The e2e test shows that the title boots on WebGL with no console errors and that the page title comes from `src/meta.ts`.
- **Still open:** the workflow has been written and read, but it has never run on GitHub: no pull request exists yet. The first pull request from the work branch runs its `check` job; until that run is green the workflow counts as untested.
- **Owner, no phone needed:**
  1. Read `docs/SPEC.md` and say whether this is the game you want: the name, the theme, the rules.
  2. **Before the game branch is merged into the main branch:** in the repository on GitHub open Settings, Pages, and set Source to "GitHub Actions". Today the site is published straight from the branch. If the merge happens first, GitHub publishes the game's unbuilt source under `/game/` (a blank page), and the workflow's own publishing step either fails or competes with it. After the switch, every change to the main branch, also one that only touches the finance chart, waits a few minutes for the game's checks before the site is published, and is not published if they fail.

## Phase 1. Movement
- **Builds:** the hero's movement in the core (run, jump height by hold time, coyote time, jump buffer, corner nudge, ledge catch); the level reader; the fixed 60-steps-per-second loop; whole-number scaling and the camera; the picture builder that turns text grids into textures, the pixel font and placeholder pictures (so no screen ever uses the browser's own soft text); keyboard and the LEFT, RIGHT, JUMP and PAUSE touch buttons; the "Rotate your phone" message, and full screen on the first tap where the phone allows it. `?level=test` opens the movement room.
- **Exit check:** unit tests reproduce the movement numbers of `docs/ARCHITECTURE.md` (jump heights, timings, stopping distances) on a frozen copy of the feel numbers, and the whole-tile limits (3-tile step, 4-tile gap) on the live ones; a test scans the simulation's source for the forbidden kinds of arithmetic; tests of the view size, the menu sizes, the camera and the touch layout pass; an e2e test slides a finger from LEFT to RIGHT, holds RIGHT while tapping JUMP, and shows that nothing sticks after a cancelled touch; an e2e test shows that the game runs inside a preview frame (no rotate message in a tall frame on a phone held sideways, no error in a locked-down frame).
- **Status: built** (24 November 2026). After the shell review round below, `npm run check` passes (59 unit test files: 1588 tests passed, 12 skipped: the opt-in `LEVELS_CRYSTALS=1` suite of `tests/levels.test.ts`) and `npm run e2e` passes (60 tests, none skipped, built with `levels/level-01.txt` to `level-10.txt` in place; with fewer campaign levels the save tests that need them are skipped). What proves each part of the exit check:
  - the movement numbers on the frozen copy: `src/core/movement.test.ts` and `src/core/jump.test.ts`; the whole-tile limits on the live numbers: `src/core/limits.test.ts`; the scan of the simulation's source: `src/core/purity.test.ts`;
  - view size, menu sizes, camera and touch layout: `src/shell/chooseView.test.ts`, `src/shell/menuLayout.test.ts`, `src/shell/camera.test.ts`, `src/input/touchLayout.test.ts`;
  - the finger slid from LEFT to RIGHT, RIGHT held while JUMP is tapped, nothing stuck after a cancelled touch or a blur: `e2e/touch.spec.ts`;
  - the game inside a preview frame (no rotate message in a tall frame on a phone held sideways, no error in a sandboxed frame): `e2e/frame.spec.ts`.
  Also built and tested in the browser: `?level=test` opens the movement room; the movement room is won with real key presses on the same tick as in Node (`e2e/rooms.spec.ts`); whole-pixel drawing at 844 x 390 and 568 x 320 (`e2e/look.spec.ts`); fullscreen asked for on the first tap of a touch device, never inside a frame (`e2e/screens.spec.ts`); menu rows of at least 44 CSS px (`e2e/screens.spec.ts`).
  Not yet: the "Rotate your phone" message is the words alone, in the pixel font; the turning phone outline is still to come. Nothing has run on a real phone, in Safari or in Firefox: only headless Chromium.
  Shell review round (24 November 2026), 21 findings settled, each with a test that fails without its fix: scene restarts no longer leave a listener behind (`src/shell/sceneEnd.ts`); a key held through the pause, auto-repeating, no longer starts the world after RESUME, RESTART LEVEL or a blur, and a held Esc no longer flickers the menu (`src/input/keyboard.ts`); RESTART LEVEL from the intro card takes the card down; the HUD's toast, blink and count stand still under the menu, and the LEVEL CLEAR banner follows the exiting phase (`e2e/pause.spec.ts`); on a touch screen the view passes a side wall rather than hold the hero under a button; the first touch after a key press presses its button; the pad's glyphs sit on whole device pixels at 2.75 and 2.625; the rotate message fits narrow windows; menus and the intro card draw 2x text where one art pixel is under 1.5 CSS px (the owner's question of 11.5, decided for readability); the top bar keeps 16 CSS px from a rounded corner; the low-fuel beep repeats (twice per shipped tank). For the owner's playtest: is the space shown beyond a side wall on a phone acceptable, and is 2x text in a short browser tab right?
- **Owner's phone playtest (the most important one):** open the movement room and try every case in it. Is the jump the right height and weight? Can you make a small hop and a full jump on purpose? Do you slide off edges? Are the buttons under your thumbs? Is the picture sharp and big enough, also in an ordinary browser tab with its bars showing (the picture is smaller there than in full screen)? Every answer maps to a number in `src/tuning.ts` (the list at the top of that file says which).

## Phase 2. Core loop
- **Builds:** crystals, the golden cog, the airlock, fire, coolant, spikes and falling out; death, respawn and the frozen start that waits for a fresh press; lives, score, level change, game over and win; the top bar; title, level intro, pause, game over and win screens, drawn with the pixel font from Phase 1; pausing when the phone is locked or turned (turning back lands in the pause menu); saving progress.
- **Exit check:** unit tests of pickups, hazards (a graze is safe, one pixel more kills), the frozen start (a thumb left on a button does not start the world), the death timeline, what a respawn keeps and resets, lives, scoring and saving; a test that the same inputs always give the same result; an e2e test that plays the movement room from start to cog to airlock by replaying a list of button presses kept beside the test (written by hand or found by a throwaway search; the validator of Phase 4 replaces it).
- **Status: built** (24 November 2026), with the same two commands passing. What proves each part of the exit check:
  - pickups, hazards (a graze is safe, one pixel more kills), the frozen start, the death timeline, what a respawn keeps and resets, lives and scoring: `src/core/contact.test.ts`, `src/core/flow.test.ts`, `src/core/run.test.ts`; saving: `src/core/save.test.ts`; the same inputs give the same result: `src/core/determinism.test.ts`;
  - the movement room from start to cog to airlock by its list of button presses (`e2e/scripts/test.json`): `e2e/rooms.spec.ts`, through the test hook at 1 and 20 ticks per frame and again with real key presses, each on the tick Node finds (cog 722, airlock 791; `src/core/rooms.test.ts` replays the same file in Node).
  Also proven in the browser: every screen (title, level intro, top bar with the cog toast and the clear banner, pause, game over, win) and pausing on Esc, P, blur, a hidden page and a phone turned upright, turning back landing in the pause menu (`e2e/screens.spec.ts`); the save rules (continue, quit costs no life, game over, best score, new game; `e2e/save.spec.ts`, which needs at least one campaign level and runs in full against a build with two); level 1 started from the title as a player does (`e2e/level1.spec.ts`, which saves `e2e/screenshots/level-01.png`).
- **Owner's phone playtest:** finish the movement room; die on purpose in the debug room (its first obstacles are spikes, fire and a coolant pool); pause, lock the phone, turn it upright, come back. Is it clear why the level waits at the start? Does a death feel fair and quick? Does anything keep moving that should not?

## Phase 3. Items and enemies
- **Builds:** the blaster and its bolts; the thruster pack, fuel, and packs reappearing on an empty tank; the Cinderpeg and the Arc Moth; the FIRE and THRUST buttons that appear with their item. `?level=debug` opens the room with everything in it.
- **Exit check:** unit tests of the thruster (fuel use, no tapping trick beats holding), the blaster (one bolt, range, the fire buffer), both enemies (turning, touching kills from every side, score paid once); the debug room can be finished: the same kind of e2e test as in Phase 2 replays a list of button presses through it, using the blaster and the thruster.
- **Status: built** (24 November 2026), with the same two commands passing. What proves each part of the exit check:
  - the thruster (fuel, no tapping trick beats holding, packs reappearing), the blaster (one bolt, range, fire buffer) and both enemies (turning, touching kills from every side, score paid once): `src/core/thruster.test.ts`, `src/core/bolt.test.ts`, `src/core/enemies.test.ts`;
  - the debug room finished with the blaster and the thruster by its list of button presses (`e2e/scripts/debug.json`): `e2e/rooms.spec.ts` through the test hook, and `e2e/touch.spec.ts` with real touches on the pad, FIRE and THRUST included, both on the tick Node finds (cog 472, airlock 668).
- **Owner's phone playtest:** play the debug room. Is flying easy to steer? Is the tank too small or too large? Can you reach FIRE and THRUST without looking?

## Phase 4. Validator and the ten levels
- **Builds:** the validator, which proves by search over the real game rules that each level's cog and then its airlock can be reached; the levels test (normal proof for every level file, comfort proof with clumsy-thumb numbers for levels 1 to 10, and proof that a required item is really required); levels 1 to 10, built one at a time and each reviewed against the checklist in `docs/LEVELS.md`.
- **Gate before the first level is built:** the validator must prove two full-size trial levels (three roofed decks; one open hall with four thruster packs) inside its budget, and its speed on this machine is measured (`docs/ARCHITECTURE.md`, section 9.6). A trial model of the validator managed both, but the open hall alone used a quarter of the budget. If the real one cannot, levels with thruster packs get a smaller size limit and the level plan is adjusted before any level is drawn.
- **Exit check:** every proof passes and the levels test stays inside its step budget, which is about a minute on this machine; an e2e test replays level 1's proof in the browser and gets the same result as the test did; an e2e test starts level 1 from the title the way a player does and saves the picture `e2e/screenshots/level-01.png`.
- **What the proofs do not show:** how much time a jump leaves the player. That is judged from the tables in `docs/LEVELS.md` by the reviewer of each level, and finally by the playtest below.
- **Status: in progress** (24 November 2026). Built:
  - the validator (`src/core/validate`, `docs/ARCHITECTURE.md` section 9) and the designer's tool `src/tools/prove.ts`;
  - the gate, which passes (`src/core/validate/gate.test.ts`): three decks proven in 0.04 M / 0.03 M step calls, the open hall in 1.77 M / 20.56 M, both `@requires` lines of `debug.txt` decided, and `LEVELS_STEP_BUDGET` set to 90 M from the measured rate. So the size and pack caps stand;
  - `levels/level-01.txt` to `level-10.txt`, built one at a time against the checklist in `docs/LEVELS.md`, then reviewed as one campaign. The review's findings were settled the same day: levels 5, 6 and 8 got longer (the cog is fetched from a branch or past the airlock), level 10 was rebuilt (its hardest jump moved onto the way out, two shafts and a loop in the Heart, about 170 tiles, the longest route), level 2's pits were reordered under a slag heap, level 7's and level 8's first packs moved to the hazard's edge, and two hints were polished. Section 8 there records them as built: contents, costs, clear times, the ramp, and every change to the plan with its reason.

  The exit check, part by part:
  - **Every proof passes, inside the budget.** `npx vitest run tests/levels.test.ts`: 73 tests passed, 12 skipped (the opt-in crystal suite). It spent 16.35 M of the 90 M step calls, 4.7 s of validator time, and about 5 s for the file. No `@requires` run ended `budget-exceeded`.
  - **The ten levels chain.** The ten normal proofs, played one after another in one session, win the game with no death in 10,266 ticks (suite (d) of that file).
  - **Crystals.** `LEVELS_CRYSTALS=1` finds no unreachable crystal in any level (the twelve crystal runs pass in 21 s; level 10's map-first run is the largest, 27.7 M step calls).
  - **The rest of the core.** `npx vitest run src/core tests`: 26 files, 853 tests passed, 12 skipped (22.5 s).
  - **Level 1 started from the title.** `e2e/level1.spec.ts` starts it as a player does and saves `e2e/screenshots/level-01.png` (Phase 2).
  - **The whole project, with the ten levels in place.** `npm run check`: 59 files, 1590 tests passed, 12 skipped; `npm run e2e`: 60 passed, none skipped.

  Not yet:
  - **The browser replay of level 1's proof.** It needs `e2e/scripts/level-01.json`, written with `node src/tools/prove.ts levels/level-01.txt --script e2e/scripts/level-01.json --in-project` (cog tick 622, airlock tick 679), and a spec that replays it the way `e2e/rooms.spec.ts` replays `test.json`.
  - **The browser watch of each route**, one line of the `docs/LEVELS.md` checklist. It is still open for all ten levels.

  For the playtest:
  - The routes are still a little shorter than the plan's. A clean run by a person comes to about 5.4 to 6.5 minutes plus the waits for enemies, against the 7.3 planned; levels 2 and 3 come to 20 to 26 s, at the floor of `docs/SPEC.md`.
  - Level 9's tight gap is that tight only with an empty tank; level 10's 4-tile gap comes before any pack (`docs/LEVELS.md`, section 8).
  - With level 6's sixth Arc Moth the levels pay at most 6,500 points, 8,000 with three lives left; `docs/SPEC.md` still says 7,900.
- **Owner's phone playtest:** play all ten levels in order. For each, note: too hard, too easy, unclear, or unfair, and where. One round of level fixes follows.

## Phase 5. Polish and installable app
- **Builds:** the final pixel art (pictures and letter shapes), top bar and screens of `docs/ART-AND-SOUND.md`; the sound effects and the sound switch; particles, shake and flashes (off for players who ask their phone for reduced motion); smoother drawing on 90 and 120 Hz screens; the web app manifest, the offline cache and the app icons.
- **Exit check:** tests of the art grids and the font; every sound renders and is not silent; e2e tests that the game runs from a sub-folder address and loads a second time with the network off; the level 1 picture test of Phase 4 still passes, and `e2e/screenshots/level-01.png` now shows the final art.
- **Owner's phone playtest:** add the game to the home screen. Play it in aeroplane mode. Switch sound off and on. Check that nothing sits under the notch or the rounded corners. On an iPhone, also note: the home-screen game starts with its own empty save, and the ring/silent switch mutes it.

## Phase 6. Review and release
- **Builds:** a full review (code, levels, originality of every name and picture, checked against the list in `docs/LEVELS.md`, rule 11), the fixes it asks for, and the published link.
- **Exit check:** `npm run check` and `npm run e2e` pass on the released build; the `check` job has passed on GitHub for the pull request; the Pages source is "GitHub Actions" (Phase 0, owner's step 2); the link opens the game and the finance chart at the site's root still opens.
- **Owner's phone playtest:** the final sign-off. Play the whole game from the published link.

## Later (not in version 1)
Ideas that came up and were set aside. None is promised.
- A level-select screen for cleared levels.
- More halls: a second set of ten levels.
- Music.
- A third enemy, a boss in the Heart Furnace.
- Moving platforms, checkpoints in long levels.
- An easier mode (more lives, a larger tank) and a harder one.
- A timer and best times per level.
- Game controller support; changing the keys.
- Other languages.
- Online scores, accounts and a level editor (the owner has ruled these out of version 1, together with ads).
