# Commands
- npm run check: typecheck, lint, unit tests and build. It must pass before any commit.
- npm run e2e: builds, then runs the Playwright smoke test in headless Chromium. Look at e2e/screenshots/title.png afterwards.
- Run every command from this folder (game/). Everything for the game lives here; the rest of the repository is an unrelated project.

# Stack
- Phaser 4.2.x (pinned), TypeScript strict, Vite.
- Phaser 4 is newer than most examples. Read docs/phaser-skills before writing Phaser code.

# Rules
- Game rules live in src/core as plain functions with unit tests. No Phaser imports there.
- Every feel number (gravity, jump, speeds) lives in src/tuning.ts and nowhere else.
- Levels are text grids in levels/*.txt. Every level must pass the validator test.
- Original content only: no names, sprites or level layouts from existing games.
