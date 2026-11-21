# Commands
- npm run check: typecheck, lint, unit tests and build. It must pass before any commit.
- npm run e2e: builds, then runs the Playwright tests in headless Chromium. Look at e2e/screenshots/title.png afterwards (and level-01.png once level 1 exists).
- Run every command from this folder (game/). Everything for the game lives here; the rest of the repository is an unrelated project.

# Stack
- Phaser 4.2.x (pinned), TypeScript strict, Vite.
- Phaser 4 is newer than most examples. Shell code follows docs/PHASER4-NOTES.md first: recipes that were run, and a list of where docs/phaser-skills is wrong. docs/phaser-skills is background reading.

# Rules
- Game rules live in src/core as plain functions with unit tests. No Phaser imports there.
- Every feel number (gravity, jump, speeds, button sizes, shake, hit stop) lives in src/tuning.ts and nowhere else. Art data (frames per picture, sound recipes) lives in src/art and src/audio.
- Unit tests of rules run on the frozen numbers in src/core/testkit.ts, not on src/tuning.ts (docs/ARCHITECTURE.md, section 12).
- Levels are text grids in levels/*.txt. Every level must pass the validator test. The test proves a route exists; it does not judge how tight a jump is (docs/LEVELS.md does).
- Original content only: no names, sprites or level layouts from existing games.

# Docs
Read the one that fits the task before changing anything.
- docs/SPEC.md: what the game is, in plain words. docs/PLAN.md: the seven phases, their exit checks and status.
- docs/ARCHITECTURE.md: the simulation contract (step order, collisions, level file format, validator), the shell's interface and the test plan. src/core/types.ts is the same contract in code.
- docs/PHASER4-NOTES.md: how to do each shell job in Phaser 4.2.1 (boot, scaling, drawing, input, sound, pause, storage).
- docs/ART-AND-SOUND.md: palette, sprites, font, top bar, screens, sound recipes. docs/LEVELS.md: level rules, review checklist, the ten-level plan.
