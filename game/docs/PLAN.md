# Build plan

The game is built in seven phases. A phase is finished only when its exit check passes. Two commands are part of every exit check: `npm run check` (types, lint, unit tests, build) and `npm run e2e` (the built game in a headless browser).

Machines cannot judge how a game feels in the hand. Six of the seven phases therefore end with a playtest by the owner on their own phone, listed in the last column. Until that playtest is done the phase is "built", not "accepted".

## Status

| Phase | What the player gets | Status | Owner's playtest on a phone |
|---|---|---|---|
| 0. Design and skeleton | A title screen, and the game described on paper | built (the GitHub check has not run yet, see below) | Not needed. The owner reads `docs/SPEC.md` and answers two questions |
| 1. Movement | Sprue runs and jumps in the movement room | not started | Yes: does the jump feel right |
| 2. Core loop | Crystals, the cog, the airlock, hazards, lives, score, all screens | not started | Yes: is dying and coming back fair and clear |
| 3. Items and enemies | The bolt blaster, the thruster pack, Cinderpegs and Arc Moths | not started | Yes: does flying and firing work under the thumbs |
| 4. Validator and levels | The ten levels, each proven winnable | not started | Yes: play all ten levels |
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
- **Owner's phone playtest (the most important one):** open the movement room and try every case in it. Is the jump the right height and weight? Can you make a small hop and a full jump on purpose? Do you slide off edges? Are the buttons under your thumbs? Is the picture sharp and big enough, also in an ordinary browser tab with its bars showing (the picture is smaller there than in full screen)? Every answer maps to a number in `src/tuning.ts` (the list at the top of that file says which).

## Phase 2. Core loop
- **Builds:** crystals, the golden cog, the airlock, fire, coolant, spikes and falling out; death, respawn and the frozen start that waits for a fresh press; lives, score, level change, game over and win; the top bar; title, level intro, pause, game over and win screens, drawn with the pixel font from Phase 1; pausing when the phone is locked or turned (turning back lands in the pause menu); saving progress.
- **Exit check:** unit tests of pickups, hazards (a graze is safe, one pixel more kills), the frozen start (a thumb left on a button does not start the world), the death timeline, what a respawn keeps and resets, lives, scoring and saving; a test that the same inputs always give the same result; an e2e test that plays the movement room from start to cog to airlock by replaying a list of button presses kept beside the test (written by hand or found by a throwaway search; the validator of Phase 4 replaces it).
- **Owner's phone playtest:** finish the movement room; die on purpose in the debug room (its first obstacles are spikes, fire and a coolant pool); pause, lock the phone, turn it upright, come back. Is it clear why the level waits at the start? Does a death feel fair and quick? Does anything keep moving that should not?

## Phase 3. Items and enemies
- **Builds:** the blaster and its bolts; the thruster pack, fuel, and packs reappearing on an empty tank; the Cinderpeg and the Arc Moth; the FIRE and THRUST buttons that appear with their item. `?level=debug` opens the room with everything in it.
- **Exit check:** unit tests of the thruster (fuel use, no tapping trick beats holding), the blaster (one bolt, range, the fire buffer), both enemies (turning, touching kills from every side, score paid once); the debug room can be finished: the same kind of e2e test as in Phase 2 replays a list of button presses through it, using the blaster and the thruster.
- **Owner's phone playtest:** play the debug room. Is flying easy to steer? Is the tank too small or too large? Can you reach FIRE and THRUST without looking?

## Phase 4. Validator and the ten levels
- **Builds:** the validator, which proves by search over the real game rules that each level's cog and then its airlock can be reached; the levels test (normal proof for every level file, comfort proof with clumsy-thumb numbers for levels 1 to 10, and proof that a required item is really required); levels 1 to 10, built one at a time and each reviewed against the checklist in `docs/LEVELS.md`.
- **Gate before the first level is built:** the validator must prove two full-size trial levels (three roofed decks; one open hall with four thruster packs) inside its budget, and its speed on this machine is measured (`docs/ARCHITECTURE.md`, section 9.6). A trial model of the validator managed both, but the open hall alone used a quarter of the budget. If the real one cannot, levels with thruster packs get a smaller size limit and the level plan is adjusted before any level is drawn.
- **Exit check:** every proof passes and the levels test stays inside its step budget, which is about a minute on this machine; an e2e test replays level 1's proof in the browser and gets the same result as the test did; an e2e test starts level 1 from the title the way a player does and saves the picture `e2e/screenshots/level-01.png`.
- **What the proofs do not show:** how much time a jump leaves the player. That is judged from the tables in `docs/LEVELS.md` by the reviewer of each level, and finally by the playtest below.
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
