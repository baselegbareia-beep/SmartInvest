# Architecture

The reference for how the game is put together. `src/core/types.ts` is the same contract in code: where the two disagree, that is a bug in one of them.

Topics owned by other documents: Phaser 4 API usage and the verified boot, scaling and rendering recipes are in `docs/PHASER4-NOTES.md`; palette, sprites, font, HUD layout, screens and sound recipes are in `docs/ART-AND-SOUND.md`; level design rules, the curriculum and review checklists are in `docs/LEVELS.md`.

## 1. Layers

| Layer | Folder | May import | Holds |
|---|---|---|---|
| Core | `src/core/**` | `src/core/**`, `src/tuning.ts` (tests also `vitest`, `node:`) | Every game rule. Pure, deterministic, integers only. No Phaser, DOM, clock or randomness |
| Tuning | `src/tuning.ts` | `src/core/types.ts` (types only) | Every feel number, owner-facing, in px and frames |
| Shell | `src/shell/**`, `src/input/**`, `src/audio/**`, `src/art/**`, `src/main.ts` | core, tuning, Phaser, DOM | Presentation only: draws the state, plays events, feeds input. Never decides a rule |

The ESLint rule `core/imports` (in `eslint.config.js`) enforces the first row, together with bans on `window`, `document`, `performance`, `Math.random` and `Date.now` inside `src/core`.

Determinism rules for `src/core`:
- State and `Phys` hold integers and booleans only. Allowed arithmetic: `+ - *`, comparisons, shifts, masks, `Math.min/max/abs/sign/floor/trunc/imul`, and division only as `Math.trunc(a / b)` or `Math.floor(a / b)` on integers.
- Fractional numbers and `Math.round` appear only in `compileTuning.ts` and `validate/handicap.ts`.
- Forbidden everywhere in the core: every transcendental `Math.*`, `**`, `%`, `for...in`, `sort()` without a comparator, any frame delta, any module-level mutable state that outlives a call.
- The core never reads `TUNING` directly: `compileTuning(tuning)` is called by the shell and the tests, and `Phys` is passed in. That is what makes the handicapped comfort proof possible.

Who enforces them. Lint enforces only the five bans named above. The rest is enforced by **`src/core/purity.test.ts`**, written with the first core module in Phase 1: it reads the text of every file under `src/core` that is not a test and fails, naming file and line, on:
- `**`; `for (... in ...)`;
- `Math` used other than as `Math.<allowed function>`; `Math.round` outside `compileTuning.ts` and `validate/handicap.ts`;
- a division (`/`, `/=`) that does not sit directly inside the parentheses of `Math.trunc(` or `Math.floor(`, and `%` (`%=`), both outside those two files;
- `globalThis`, `self`, `window`, `global`, `eval` and `Function`, the ways round every other rule (`globalThis.Math.sqrt`, text run as code);
- `.sort()` or `.toSorted()` with no argument or with `undefined`, and either method used any other way than `.sort(comparator)` (`['sort']`, `.sort.call`, a variable named `sort`);
- module-level state: a top-level `let` or `var`, and a top-level array literal, object literal or `new` that is not read-only (`as const`, a `readonly` / `Readonly…<>` type, or `Object.freeze`);
- an import of `tuning` in a file that is neither a test nor `testkit.ts` (found by `from`, `import(` and `require(` with a quoted or backquoted name), and a module name built from a template with `${ }`, which the test cannot follow.

It also fails when any non-test file under `src/` imports `testkit.ts`. The scanner reads text, not types: a module-level object built by a function call, or a module name held in a variable, is beyond it. `determinism.test.ts` adds the run-time half (state stays integral, same input gives same state, a clone tracks its original), which is what catches state that leaks from one call into the next. The same bans should also be added to the `src/core` block of `eslint.config.js` (`no-restricted-properties` for the `Math` functions, `no-restricted-syntax` for `**`, `%`, `for...in`, `ImportExpression > TemplateLiteral` and a computed `sort` member, `no-restricted-globals` for `globalThis`) so that an editor shows them while typing; the test is the gate either way.

## 2. Module map

### src/core (binding: several agents implement these files in parallel)

| File | Exports | Responsibility |
|---|---|---|
| `types.ts` | all types, unit constants | The contract. No logic |
| `compileTuning.ts` | `compileTuning`, `TuningError` | `Tuning` (px, frames) to integer `Phys`; rejects unsafe values (section 3) |
| `level.ts` | `parseLevel`, `withoutItem`, `LevelError` | Level text to `LevelData` with exact error messages (section 8) |
| `tiles.ts` | `tileAt`, `isSolid(level, col, row)`, `boxHitsSolid(level, x, y, w, h)` | Tile lookup, the out-of-grid policy, box-against-solid test in sub-pixels |
| `player.ts` | `stepPlayer(game, input, events?)` | Steps 4 to 11: presses, timers, run, jump, thrust, gravity, move and collide |
| `enemies.ts` | `stepEnemies(game)` | Step 12: Cinderpeg and Arc Moth patrol |
| `bolt.ts` | `stepBolt(game, events?)` | Step 13: fire, fly, hit walls and enemies, pay score |
| `contact.ts` | `resolveContacts(game, events?)` | Steps 14 to 17: pickups, trophy, door, hazards, falling out, enemy touch |
| `run.ts` | `createRun(level, phys)`, `respawnRun(run, level, phys, readyTicks)` | Build a fresh `RunState`; the partial reset after a death (section 6) |
| `testkit.ts` | `REFERENCE_TUNING`, `REFERENCE_PHYS`, small level builders | Test support only (section 12): the frozen numbers every golden value in this document was measured with. Never imported by game code |
| `game.ts` | `createSession`, `startLevel`, `step`, `restartLevel`, `holdReady`, `cloneGame`, `copyGame` | Phases, lives, score, level change; the one public step |
| `script.ts` | `inputFromBits`, `bitsFromInput`, `scriptTicks`, `inputAtTick` | Run-length input scripts |
| `save.ts` | `defaultSave`, `parseSave`, `applyEvents` | Pure save reducers; no storage access |
| `validate/options.ts` | `DEFAULT_OPTIONS`, `COMFORT_OPTIONS`, `REQUIRES_OPTIONS`, `LEVELS_STEP_BUDGET` | Search constants and budgets (not feel numbers) |
| `validate/handicap.ts` | `handicap` | The comfort proof's derated tuning |
| `validate/successors.ts` | internal | Manoeuvre generator: ground holds, jumps, flight, fire (9.2) |
| `validate/heuristic.ts` | internal | Flood-fill distance to the trophy and the door, in ticks (9.4) |
| `validate/map.ts` | internal | Exhaustive enemy-free map and cost-to-go (9.4) |
| `validate/search.ts` | internal | Quick pass and guided search with enemies; builds the script |
| `validate/index.ts` | `validateLevel`, `replayScript` | Orchestration, verdicts, replay |

Unit tests sit beside their module as `*.test.ts` (list in section 12).

### Shell (planned layout; the Phase 0 `src/scenes/` folder moves to `src/shell/scenes/`)

| File | Responsibility |
|---|---|
| `src/main.ts` | Entry: first layout, `new Phaser.Game`, installs viewport watcher, lifecycle, audio unlock, test hook |
| `src/meta.ts` | `GAME_TITLE`, `GAME_ID`: the only place the name is spelled |
| `src/levels.ts` | Imports `levels/*.txt?raw`, parses them; exports `CAMPAIGN` (level-01 to level-10 in order) and `DEV_LEVELS` (`test`, `debug`) |
| `src/shell/config.ts` | The Phaser game config (see `docs/PHASER4-NOTES.md`) |
| `src/shell/singletons.ts` | The shell's module-level singletons shared by `main.ts` and the scenes: `app`, `safeProbe`, `controls`, `sfx`, `pad`, `onPadPause` (`docs/PHASER4-NOTES.md`, section 3) |
| `src/shell/chooseView.ts` | Pure: window size, device pixel ratio, safe insets and `TUNING.view` to `{ zoom, viewW, viewH, cssLeft, cssTop }` |
| `src/shell/menuLayout.ts` | Pure: view size and CSS px per art px to menu row heights and hit areas of at least 44 CSS px (11.5) |
| `src/shell/applyLayout.ts` | DOM: canvas CSS transform `scale(zoom / dpr)`, `game.scale.resize`, pillarbox offsets; viewport watcher |
| `src/shell/FixedStepper.ts` | Pure fixed-timestep accumulator (11.1) |
| `src/shell/camera.ts` | Pure `snapCamera` and `stepCamera` (11.4) |
| `src/shell/interpolation.ts` | Pure: the 'auto' on/off decision from measured frame intervals; lerp and teleport snap |
| `src/shell/frames.ts` | Pure: state to frame name for hero, enemies, door, pickups |
| `src/shell/WorldView.ts` | State to Phaser objects: tile layer, Images by id, overlays, mini fuel bar |
| `src/shell/TileLayer.ts` | `LevelData` to tilemap data: wall variants, hazards, decoration; built on `levelStarted` |
| `src/shell/Effects.ts` | The one particle emitter, flashes, shake, score pop-ups |
| `src/shell/EventRouter.ts` | Drains `GameEvent[]` each tick into audio, effects, HUD, storage and scene changes (11.3) |
| `src/shell/storage.ts` | `loadJson` / `saveJson` that never throw; the two storage keys |
| `src/shell/lifecycle.ts` | `installTouchMode` and `installRotateGuard` only (`docs/PHASER4-NOTES.md`, section 17). The blur, hidden and pagehide listeners live in `PlayScene.create` (same document, section 11), because they call the scene's `pauseGame` and must be removed with the scene |
| `src/shell/pwa.ts` | Phase 5: guarded service worker registration (11.7) |
| `src/shell/e2eHook.ts` | The `window.__E2E__` test hook (11.6) |
| `src/shell/scenes/BootScene.ts` | Builds textures and the font, then starts Title |
| `src/shell/scenes/TitleScene.ts` | Title, Continue / New game, sound toggle; the first tap unlocks audio and asks for fullscreen (11.5) |
| `src/shell/scenes/PlayScene.ts` | Owns the `GameState`, the stepper, the world view and the camera |
| `src/shell/scenes/HudScene.ts` | Lives, level, score, cog, items, fuel pips, toasts, level intro and clear banners |
| `src/shell/scenes/PauseScene.ts` | Resume, Restart level, Quit, Sound, Vibration |
| `src/shell/scenes/EndScene.ts` | Game over and win screens |
| `src/input/Controls.ts` | Pure: held state per source, press latch, last-pressed-wins for left and right; `consume()` gives one `Input` per tick |
| `src/input/keyboard.ts` | Phaser keys to `Controls` |
| `src/input/touchLayout.ts` | Pure `layoutControls` and `hitTest` in CSS px from `TUNING.touch` |
| `src/input/TouchPad.ts` | DOM overlay with Pointer Events to `Controls`; shows FIRE and THRUST only while the item is held |
| `src/input/haptics.ts` | `navigator.vibrate` wrapper honouring the setting |
| `src/audio/Sfx.ts` | Private `AudioContext`, unlock, master gain, mute, voice cap, thrust loop |
| `src/audio/recipes.ts` | Effect recipes as data |
| `src/audio/synth.ts` | `(ctx: BaseAudioContext, dest, at, recipe)` schedules one effect; renders offline in tests |
| `src/art/palette.ts`, `src/art/sprites/*.ts`, `src/art/font.ts` | Palette-indexed text grids |
| `src/art/makeSheet.ts` | Grids to one canvas texture with named frames |
| `index.html` | The page skeleton: `#app` holding `#game` (canvas parent), the touch pad overlay and the rotate message |
| `src/pwa/sw.template.js`, `src/pwa/manifest.template.json`, a build step in `vite.config.ts`, `scripts/make-icons.mjs` | Phase 5: hand-written service worker and web app manifest, completed at build time (11.7); icons rendered from the `icon` grid |

### Tests and levels

| Path | Responsibility |
|---|---|
| `levels/level-01.txt` to `level-10.txt` | The game, in that order |
| `levels/test.txt`, `levels/debug.txt` | Movement room and all-items room; opened with `?level=test` or `?level=debug` |
| `tests/levels.test.ts` | Reads every file in `levels/` with `node:fs`; the three required validator suites and the style checks of the game's own levels (9.6) |
| `e2e/smoke.spec.ts` | Phase 0: boot on WebGL, title, no console errors; saves `e2e/screenshots/title.png` |
| `e2e/touch.spec.ts` | Phase 1: slide LEFT to RIGHT, hold RIGHT and tap JUMP, cancel and blur release everything |
| `e2e/frame.spec.ts` | Phase 1: inside a tall frame on a phone held sideways there is no rotate message and the game runs; inside a sandboxed frame the game boots with no error (storage and, later, the service worker are guarded) |
| `e2e/rooms.spec.ts`, `e2e/scripts/*.json` | Phases 2 and 3, before the validator exists: replays an input script kept beside the test through `window.__E2E__.replay` and expects a win. Phase 2: `test.txt`, start to cog to airlock. Phase 3: `debug.txt` (blaster, thruster, both enemies). The scripts are written by hand or found with a throwaway search; a core unit test replays the same files in Node |
| `e2e/replay.spec.ts` | Phase 4: replays level 1's validator script in the browser; same `winTick` as Node (11.6) |
| `e2e/level1.spec.ts` | Phase 4, kept through Phase 5: loads the game, starts level 1 from the title the way a player does, waits for the ready gate and saves `e2e/screenshots/level-01.png` |
| `e2e/offline.spec.ts`, `e2e/subpath.spec.ts` | Phase 5: second load with the network off; the build served from a sub-folder (11.7) |

## 3. Units and compiled tuning

1 art px = 256 sub-pixels (`SUB`), 1 tile = 16 px = 4096 sub-pixels (`TILE = 1 << TILE_SHIFT`, shift 12), 1 tick = 1/60 s. Positions are top-left corners; +y is down. The tile of a coordinate is `v >> TILE_SHIFT` (correct for negatives). The shell draws at `v >> SUB_SHIFT`.

`compileTuning(t)` conversions: `sub(px) = Math.round(px * 256)`; frame counts are copied and must be whole.

| `Phys` field | From `Tuning` |
|---|---|
| `heroW`, `heroH` | `sub(hero.heroHitboxW)`, `sub(hero.heroHitboxH)` |
| `runMax`, `groundAccel`, `groundDecel`, `groundTurn`, `airAccel`, `airDecel`, `airTurn` | `sub` of `run.runMaxSpeed`, `groundAccel`, `groundDecel`, `groundTurnAccel`, `airAccel`, `airDecel`, `airTurnAccel` |
| `jumpVel`, `jumpCutVel` | `sub(jump.jumpVelocity)`, `sub(jump.jumpCutVelocity)` |
| `gravRise`, `gravFall`, `apexHangSpeed`, `maxFall` | `sub` of `gravity.gravityRise`, `gravityFall`, `apexHangSpeed`, `maxFallSpeed` |
| `gravRiseHang`, `gravFallHang` | `sub(gravityRise * apexHangScale)`, `sub(gravityFall * apexHangScale)` |
| `coyoteTicks`, `jumpBufferTicks` | `forgiveness.coyoteFrames`, `jumpBufferFrames` |
| `cornerNudge`, `ledgeCatch`, `hurtInsetSide/Top/Bottom`, `spikeInsetSide/Top`, `fireInsetSide/Top`, `coolantInsetTop`, `enemyTouchInset`, `pickupOutset`, `doorInsetSide` | `sub` of the `forgiveness.*Px` field of the same name |
| `thrustAccel`, `thrustMaxRise`, `thrustCutVel`, `fuelTicks` | `sub(thruster.jetAccel)`, `sub(jetMaxRiseSpeed)`, `sub(jetCutSpeed)`, `jetFuelFrames` |
| `boltSpeed`, `boltRange`, `boltW`, `boltH`, `fireBufferTicks` | `sub` of `blaster.boltSpeed`, `boltRangePx`, `boltHitboxW`, `boltHitboxH`; `fireBufferFrames` |
| `cinderpegSpeed`, `mothSpeed` | `sub(enemies.cinderpegSpeed)`, `sub(enemies.mothSpeed)` |
| `dyingTicks` | `timing.hitStopFrames + deathAnimFrames + fadeFrames` (52) |
| `respawnReadyTicks` | `timing.fadeFrames + readyMinFrames` (22) |
| `readyMinTicks`, `exitTicks` | `timing.readyMinFrames` (12), `timing.exitFrames` (60) |
| `startLives`, `maxLives`, `livesPerLevelClear` | `lives.*` |
| `scoreCrystal`, `scoreCog`, `scoreCinderpeg`, `scoreMoth`, `scoreLevelClear`, `scoreLifeLeft` | `score.crystal`, `cog`, `cinderpeg`, `arcMoth`, `levelClear`, `lifeLeft` |

The groups `camera`, `view`, `touch`, `effects` and `pacing` are shell-only and ignored. With the shipped numbers every px value is an exact multiple of 1/256 px, so nothing is lost to rounding. (The comfort handicap is not exact: its run speed is 364.8 sub-pixels per tick and rounds to 365.)

`compileTuning` throws `TuningError` (one message listing every problem) when: a value is negative or not finite; a frame count, a lives value or a score is not a whole number; any speed (`runMaxSpeed`, `jumpVelocity`, `maxFallSpeed`, `jetMaxRiseSpeed`, `boltSpeed`, `cinderpegSpeed`, `mothSpeed`) is 0, or is 8 px per frame or more (half a tile); the hero box is not a whole number of px, is larger than a tile, or `16 - heroHitboxW` is odd; the hurt box, the enemy touch box, a hazard kill box, the door box or the bolt box has no size (judged after rounding); the bolt box is wider or taller than the hero box (`boltHitboxW > heroHitboxW` or `boltHitboxH > heroHitboxH`: section 5.7 needs the bolt to start inside the hero); `jumpCutVelocity >= jumpVelocity`; `jetCutSpeed > jetMaxRiseSpeed`; `apexHangScale` is outside (0, 1]; `boltSpeed + cinderpegSpeed >= boltHitboxW + 16` or the same with `mothSpeed`; `startLives` is below 1 or above `maxLives`.

## 4. Step order

`step(game, input, events?)` advances one tick. Names without a prefix are fields of `game.run.player`; `P` is `game.phys`.

1. **Status.** If `session.status !== 'playing'`, return.
2. **Tick.** `run.tick += 1`.
3. **Phase.**
   - `dying` or `exiting`: `phaseTicks += 1`; `prevJump = input.jump`; `prevFire = input.fire`; if `phaseTicks >= phaseLength`, finish the death or the exit (section 6). Return. The world is frozen.
   - `ready`: `held` = any of the five inputs is held. If `!held`: `readyArmed = true` (on every ready tick, also during the minimum). Then, if `phaseTicks < phaseLength`: `phaseTicks += 1`, update `prevJump` and `prevFire`, return. Otherwise, if `!(readyArmed && held)`: update `prevJump` and `prevFire`, return. Otherwise the gate opens: `phase = 'playing'`, `phaseTicks = 0`, `phaseLength = 0`, emit `readyEnded`, and continue with this same tick.
   - `playing`: `phaseTicks += 1` (also on the tick the gate opened), continue.
4. **Presses and timers.** `jumpPressed = input.jump && !prevJump`; `firePressed = input.fire && !prevFire`; then store the new `prevJump`, `prevFire`. `wasOnGround = onGround`. Coyote: if `onGround` then `coyote = P.coyoteTicks + 1`, else if `coyote > 0` then `coyote -= 1`. Jump buffer: if `jumpBuffer > 0` then `jumpBuffer -= 1`; then if `jumpPressed`, `jumpBuffer = P.jumpBufferTicks + 1`. Fire buffer: the same with `firePressed` and `P.fireBufferTicks`.
5. **Run.** `dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)` (both held is 0). If `dir !== 0`: `turning = vx !== 0 && sign(vx) !== dir`; pick `groundTurn` or `groundAccel` when `onGround`, `airTurn` or `airAccel` otherwise; `vx = approach(vx, dir * runMax, a)`; `facing = dir`. If `dir === 0`: `vx = approach(vx, 0, onGround ? groundDecel : airDecel)`. `approach(v, target, a)` moves `v` toward `target` by at most `a` without passing it.
6. **Jump start.** If `jumpBuffer > 0 && coyote > 0`: `vy = -jumpVel`, `jumpArc = true`, `coyote = 0`, `jumpBuffer = 0`, `onGround = false`, `jumped = true`, emit `jumped`.
7. **Jump cut.** If `jumpArc && !input.jump && vy < -jumpCutVel`: `vy = -jumpCutVel`.
8. **Thrust or gravity.**
   - `engaged = input.thrust && hasThruster && fuel > 0`; `burning = engaged && vy >= -thrustMaxRise`.
   - Thrust cut: if `!engaged && thrusting && !jumped && vy < -thrustCutVel`: `vy = -thrustCutVel`. (`thrusting` still holds last tick's value here.)
   - If `burning`: `vy = max(vy - thrustAccel, -thrustMaxRise)`, `fuel -= 1`, `jumpArc = false`. If `fuel` is now 0: emit `fuelEmptied`, then for every thruster pickup `i` with `taken[i]`: `taken[i] = false`, emit `pickupRestored`.
   - Else if `!jumped` (no gravity on the launch tick): `hang = jumpArc && input.jump && abs(vy) < apexHangSpeed`; `rising = jumpArc && input.jump && vy < 0`; gravity is `gravRise` when rising, else `gravFall`, each replaced by its `Hang` variant when `hang`; `vy = min(vy + gravity, maxFall)`.
   - If `vy >= apexHangSpeed`: `jumpArc = false`.
   - If `burning !== thrusting`: `thrusting = burning`, emit `thrustStarted` or `thrustStopped`.
   - `impact = vy` (kept for the `landed` event).
9. **Move X.** Section 5.2.
10. **Move Y.** Section 5.3.
11. **Ground.** `onGround = vy >= 0 && boxHitsSolid(x, y + heroH, heroW, 1)`. If `onGround`: `vy = 0`, `jumpArc = false`, and if `!wasOnGround` emit `landed` with `speed = impact`.
12. **Enemies** move (section 5.6).
13. **Bolt** (section 5.7): spawn if `fireBuffer > 0 && hasBlaster && !bolt.active`; then move and test walls, enemies, range.
14. **Pickups** in index order (section 5.5).
15. **Trophy.**
16. **Door.** If `hasTrophy` and the hero box overlaps the door box: start the exit (section 6) and return.
17. **Deaths**, first match wins: hazard tiles, then falling out, then enemy touch (section 5.4). A match starts the dying phase.

Why this order:
- 6 before 9: a press acts on the tick it arrives. 9 before 10: no snagging on a ledge corner at foot height.
- 4 reads `onGround` from the end of the previous tick. Coyote: a tick is "airborne tick n" when it is the n-th tick that starts with `onGround` false after walking off a ledge; a press on airborne ticks 1 to `coyoteFrames` still jumps, and one on tick `coyoteFrames + 1` does not. Buffer: the first tick on which a landed hero can jump is the tick after the touchdown tick (the tick whose step 11 sets `onGround`); a press up to `jumpBufferFrames` ticks before that tick is honoured, which is up to `jumpBufferFrames - 1` ticks before the touchdown tick (7 and 6 with the shipped number), and the jump starts on the tick after touchdown. With both at 0 a press on the ground still jumps on its own tick.
- 12 and 13 before 17: a point-blank bolt destroys an enemy before it can kill. 14 to 16 before 17: on a tie the player keeps the crystal, the cog and the win.
- The thrust cut ignores the launch tick and an idling engine, so a jump is never cut by the thruster; holding thrust is the best possible climb (section 13).

Golden numbers for tests, from the reference tuning (`REFERENCE_PHYS`, section 12; equal to the shipped numbers at the time of writing): a held jump rises 1280, 2496, 3648, 4736 sub-pixels after ticks 1 to 4; `vy` on ticks 18 to 28 is `-192 -128 -64 -32 0 56 112 168 280 392 504`; apex 13472 sub-pixels on tick 21; back on the ground on tick 41. Thrust for 7 ticks from standing, then release: `vy/fuel` per tick is `-96/79 -192/78 -288/77 -384/76 -448/75 -448/74 -448/73 -16/73 96/73 208/73`.

## 5. Collision rules

### 5.1 Boxes and tiles

- Hero box: `[x, x + heroW)` by `[y, y + heroH)`, 10 by 14 px. Two half-open boxes overlap when each starts before the other ends on both axes.
- `tileAt(level, col, row)`: `col < 0`, `col >= width` or `row < 0` is `Solid`; `row >= height` is `Empty`; otherwise `tiles[row * width + col]`. So the level is walled on the left, right and top, and open below.
- `boxHitsSolid(level, x, y, w, h)` (the level argument is left out in the text below): true when any tile from column `x >> 12` to `(x + w - 1) >> 12` and row `y >> 12` to `(y + h - 1) >> 12` is `Solid`. Only `Solid` blocks movement; hazards are not solid.
- Hero start: `x = start.col * TILE + ((TILE - heroW) >> 1)`, `y = (start.row + 1) * TILE - heroH`, `facing = 1`, `onGround = true`.

### 5.2 Move X (step 9)

If `vx === 0` nothing happens. `nx = x + vx`. If `!boxHitsSolid(nx, y, heroW, heroH)`: `x = nx`. Otherwise:
- **Ledge catch.** `rowTop = ((y + heroH - 1) >> 12) << 12` (top of the lowest row the box overlaps); `lift = y + heroH - rowTop`. If `!onGround && vy >= 0 && lift <= ledgeCatch && !boxHitsSolid(nx, rowTop - heroH, heroW, heroH)`: `x = nx`, `y = rowTop - heroH`, `vy = 0`. Step 11 then finds the ground. (`onGround` is still the value from the end of the previous tick, cleared by a jump start in step 6.)
- **Wall.** Otherwise snap flush and stop: moving right `x = (((nx + heroW - 1) >> 12) << 12) - heroW`; moving left `x = ((nx >> 12) + 1) << 12`; `vx = 0`.

### 5.3 Move Y (step 10)

If `vy === 0` nothing happens. `ny = y + vy`. If `!boxHitsSolid(x, ny, heroW, heroH)`: `y = ny`. Otherwise:
- **Landing** (`vy > 0`): `y = (((ny + heroH - 1) >> 12) << 12) - heroH`, `vy = 0`.
- **Corner nudge** (`vy < 0`): `dR = (((x >> 12) + 1) << 12) - x` (shift that puts the left edge on the next column line); `dL = (x + heroW) - (((x + heroW - 1) >> 12) << 12)` (shift that puts the right edge on its column line). Try right then left when `vx >= 0`, left then right otherwise. A shift `d` is taken when `d <= cornerNudge` and the box at the shifted `x` and `ny` hits no solid: move `x` by it, `y = ny`, keep `vy`.
- **Bonk** (no shift taken): `y = ((ny >> 12) + 1) << 12`, `vy = 0`, `jumpArc = false`, emit `bonked`.

All speeds are below half a tile per tick (enforced by `compileTuning`), so a move can enter at most one new row or column and the snaps above are exact.

### 5.4 Deaths (step 17)

Hurt box: `[x + hurtInsetSide, x + heroW - hurtInsetSide)` by `[y + hurtInsetTop, y + heroH - hurtInsetBottom)`, 6 by 11 px.

1. **Hazard tiles.** For each tile the hurt box overlaps, rows top to bottom, columns left to right: if the hurt box overlaps the tile's kill box, die with that cause.

   | Tile | Kill box inside cell `(c, r)` | Cause |
   |---|---|---|
   | `Spikes` | `[c*TILE + spikeInsetSide, (c+1)*TILE - spikeInsetSide)` by `[r*TILE + spikeInsetTop, (r+1)*TILE)` | `spikes` |
   | `Fire` | the same with `fireInsetSide`, `fireInsetTop` | `fire` |
   | `Coolant` | `[c*TILE, (c+1)*TILE)` by `[r*TILE + coolantInsetTop, (r+1)*TILE)` | `coolant` |
2. **Falling out.** `y >= level.height * TILE`: cause `fell`.
3. **Enemy touch.** For each live enemy in index order: touch box `[ex + enemyTouchInset, ex + TILE - enemyTouchInset)` by the same in y. Overlap with the hurt box: cause `enemy`. No stomping: every side kills.

### 5.5 Pickups, trophy, door (steps 14 to 16)

All three test against the full hero box.
- Pickup or trophy box for cell `(c, r)`: `[c*TILE - pickupOutset, (c+1)*TILE + pickupOutset)` on both axes.
- Pickup `i` with `!taken[i]` and overlap: `taken[i] = true`; crystal: `score += scoreCrystal`; blaster: `hasBlaster = true`; thruster: `hasThruster = true`, `fuel = fuelTicks` (a pack is always consumed, also with a full tank). Emit `pickup` (score 0 for items).
- Trophy with `!hasTrophy` and overlap: `hasTrophy = true`, `score += scoreCog`, emit `trophyCollected` then `doorOpened`.
- Door box: `[c*TILE + doorInsetSide, (c+1)*TILE - doorInsetSide)` by `[r*TILE, (r+1)*TILE)`. It does nothing while `hasTrophy` is false.

### 5.6 Enemies (step 12)

An enemy's body is one tile square at `(x, y)`; it starts on its cell with `dir = -1` (left, or up for a vertical moth). Enemies ignore the hero, gravity and each other. Dead enemies do not move.

- **Cinderpeg** (`C`), `row = y >> 12` never changes. `nx = x + dir * cinderpegSpeed`; `lead = dir > 0 ? nx + TILE - 1 : nx`; `c = lead >> 12`. Blocked when `tileAt(c, row) !== Empty` (wall, hazard, level edge) or `tileAt(c, row + 1) !== Solid` (no floor under the leading foot). Blocked: `dir = -dir` and no move this tick. Otherwise `x = nx`.
- **Arc Moth** (`M` axis `v`, `H` axis `h`): the same along its axis with `mothSpeed`; blocked when the leading cell is outside the grid on any side or is not `Empty`.

### 5.7 Bolt (step 13)

- **Spawn** when `fireBuffer > 0 && hasBlaster && !bolt.active`: `bolt.dir = facing`; `bolt.x = facing > 0 ? x + heroW - boltW : x`; `bolt.y = y + ((heroH - boltH) >> 1)`; `rangeLeft = boltRange`; `active = true`; `fireBuffer = 0`; emit `boltFired`. The bolt starts inside the hero's box (`compileTuning` keeps the bolt box no larger than the hero box), so it can never start inside a wall; and it has a size on both axes, so it always covers at least one column and one row.
- **Move** (also on the spawn tick): `bolt.x += dir * boltSpeed`; `rangeLeft -= boltSpeed`. Then, first match ends the bolt (`active = false`, emit `boltEnded`):
  1. `boxHitsSolid(bolt box)`: hit `wall`.
  2. The first live enemy in index order whose full one-tile body overlaps the bolt box: `alive = false`; `points = enemyPaid[i] ? 0 : value`; `enemyPaid[i] = true`; `score += points`; emit `enemyKilled`, then `boltEnded` with hit `enemy`.
  3. `rangeLeft <= 0`: hit `range`.
- Bolts pass through hazards, pickups, the trophy and the door. With the shipped numbers a bolt lives 40 ticks and reaches 160 px.

## 6. State machine: ready, death, exit, level change

```
createSession / startLevel ──► ready ──(minimum elapsed and a control pressed)──► playing
playing ──(step 17)──► dying ──(dyingTicks)──► lives -= 1 ──► lives > 0: respawn ──► ready
                                                          └─► lives = 0: status 'gameOver'
playing ──(step 16)──► exiting ──(exitTicks)──► next level ──► ready
                                             └─► after the last level: status 'won'
playing ──holdReady()──► ready           (after a pause; nothing else changes)
ready | playing ──restartLevel()──► lives -= 1 ──► respawn ──► ready, or 'gameOver'
```

**Ready gate.** The world is frozen. `phaseLength` is `readyMinTicks` (12) at a level start, after `restartLevel` and after `holdReady`, and `respawnReadyTicks` (22: fade in, then the minimum) after a death. The gate opens on a **press** (ruling R4), never on a control that is merely still down:

- `readyArmed` is false whenever the gate shuts. It becomes true on the first ready tick on which none of left, right, jump, fire and thrust is held, and stays true.
- The first `phaseLength` ticks never open the gate (they do arm it).
- From then on, the first tick on which `readyArmed` is true and any control is held opens the gate, and that tick is simulated in full: a direction or thrust acts at once.

Consequences, each covered by `flow.test.ts`: a thumb kept on RIGHT through a death (or through the airlock into the next level) does not start the world, however long it is held; it must lift and press again. A control that was let go and pressed again during the minimum counts: the gate opens on the first tick after the minimum. A jump or fire pressed before the gate opened is not replayed when it opens, because `prevJump` and `prevFire` are tracked in every phase: the hero starts with whatever is held, and needs a fresh press to jump or fire. The validator is unaffected: its root idles through the minimum, which arms the gate.

**Death** (step 17): `phase = 'dying'`, `phaseTicks = 0`, `phaseLength = dyingTicks`, `deathCause = cause`; if `thrusting`: clear it and emit `thrustStopped`; emit `playerDied` with `livesAfter = lives - 1`. When the phase ends: `lives -= 1`. At 0: `status = 'gameOver'`, emit `gameOver`. Otherwise `respawnRun(run, level, phys, respawnReadyTicks)` and emit `respawned` with reason `death`. From the death tick, at least 74 frozen ticks pass before a control can act again.

**What a respawn keeps and resets** (`respawnRun`, used by deaths and by `restartLevel`):

| Kept | Reset |
|---|---|
| `session.score`, `session.lives` (after the decrement), `highestUnlocked` | Hero: start position, zero velocity, `facing = 1`, `onGround = true`, all timers 0, `jumpArc`, `thrusting`, `prevJump`, `prevFire` false |
| `taken[i]` of every crystal | `hasBlaster`, `hasThruster` false, `fuel = 0` |
| `hasTrophy` (the door stays open) | `taken[i] = false` for every blaster and thruster pack |
| `enemyPaid[i]` (a respawned enemy is worth 0) | Every enemy: spawn cell, `dir = -1`, `alive = true` |
| `run.tick` (keeps counting) | `bolt.active = false`; `deathCause = null`; `phase = 'ready'`, `phaseTicks = 0`, `phaseLength = readyTicks`, `readyArmed = false` |

After a respawn the level is its start state plus harmless collectibles, so one death-free proof covers every life.

**Exit** (step 16): `score += scoreLevelClear`; `lives = min(lives + livesPerLevelClear, maxLives)`; `highestUnlocked = max(highestUnlocked, last ? levelIndex : levelIndex + 1)`; `phase = 'exiting'`, `phaseTicks = 0`, `phaseLength = exitTicks`; clear `thrusting` (emit `thrustStopped` if it was set); emit `levelCompleted`. When the phase ends: on the last level `lifeBonus = lives * scoreLifeLeft`, `score += lifeBonus`, `status = 'won'`, emit `gameWon`; otherwise `startLevel(game, levelIndex + 1, events)`.

**`startLevel`** builds a new `RunState` with `createRun`: nothing taken, no trophy, `enemyPaid` all false, `tick = 0`, hero and enemies at their cells, `phase = 'ready'` with `phaseLength = readyMinTicks` and `readyArmed = false`. Items never carry over. It emits `levelStarted`.

**`restartLevel`** (pause menu): only when status is `playing` and the phase is `ready` or `playing`. If `thrusting`: clear it and emit `thrustStopped` (on the last life no respawn follows to clear it, and the thrust loop sound follows the flag). `lives -= 1`; at 0 `status = 'gameOver'` and `gameOver`; otherwise `respawnRun(..., readyMinTicks)` and `respawned` with reason `restart`. It is the way out of any dead end; together with the thruster packs reappearing when the tank runs dry (step 8) it is the whole soft-lock policy. The validator does not look for inescapable pits.

**`holdReady`** (resume after a pause): `playing` becomes `ready` with `phaseTicks = 0`, `phaseLength = readyMinTicks` and `readyArmed = false`; position, speed and items are untouched. The shell releases every control when the pause overlay closes, so the gate is armed again on the next tick.

**Scoring.** Crystal 10, golden cog 100, Cinderpeg 50, Arc Moth 100 (each enemy pays once per level visit), level clear 200, each life left at the win 500. Lives: 3 at the start of a run, plus 1 per level cleared (also the last, before the life bonus is counted), never above 3.

## 7. Events

The `GameEvent` union in `types.ts` documents every payload. Order within one tick follows the step order. Coordinates are sub-pixels.

| Event | Emitted by | Typical use (see `docs/ART-AND-SOUND.md`) |
|---|---|---|
| `levelStarted` | `createSession`, `startLevel` | Rebuild tile layer and sprites, snap camera, intro, save `resume` |
| `readyEnded` | step 3 | Hide the ready blink |
| `jumped`, `landed`, `bonked` | steps 6, 11, 10 | `jump`, `land` (by `speed`), dust |
| `thrustStarted`, `thrustStopped` | step 8; `thrustStopped` also by a death, the exit and `restartLevel` | One-shot ignition effects. The loop sound follows state (11.3) |
| `fuelEmptied`, `pickupRestored` | step 8 | `fuelEmpty`, vibration, sparkle on the returning pack |
| `pickup` | step 14 | `gem` ladder or `item`, sparkles, `+10` pop-up |
| `trophyCollected`, `doorOpened` | step 15 | `cog`, toast, gold flash; `airlock` 320 ms later, iris animation |
| `boltFired`, `boltEnded` | step 13 | `bolt`; `boltHit` and sparks for `wall` |
| `enemyKilled` | step 13 | `enemyDown`, scrap, hit stop, pop-up when `score > 0` |
| `playerDied` | step 17 | `death`, flash by cause, shake, vibration; save lives |
| `respawned` | end of dying, `restartLevel` | Snap camera and interpolation, fade in, HUD life blink |
| `levelCompleted` | step 16 | `clear`, banner with `bonus`, save `unlocked` |
| `gameOver` | end of dying, `restartLevel` on the last life | `gameOver`, end screen, save best score |
| `gameWon` | end of exiting | `win`, end screen, save best score |

## 8. Level file format

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

- Before the grid: blank lines, comment lines starting with `;`, and header lines starting with `@`. All four headers are optional to the parser; `tests/levels.test.ts` requires `@name`, `@teaches` and `@hardest` in level-01 to level-10.
- `@name text`, `@teaches text`, `@hardest col,row note` (at most one each) and `@requires blaster` or `@requires thruster` (at most one of each). Keywords are lower case; one or more spaces separate keyword and value.
- The first line that is not blank, a comment or a header starts the grid. Every grid row has the same length. Blank lines after the last row are ignored.
- Each line loses a trailing `\r` and trailing spaces and tabs before anything else; a byte-order mark at the start of the file is dropped.
- **All coordinates are 0-based**: `col` counts from the left edge of the grid, `row` from its first row. This holds for `@hardest`, for error messages and for validator reports. Error messages that concern one line also carry the 1-based line number of the file, as editors show it.

| Char | Meaning | Tile | Recorded as |
|---|---|---|---|
| `#` | wall | `Solid` | |
| `.` | empty | `Empty` | |
| `F` `W` `S` | furnace fire, coolant, spikes | `Fire`, `Coolant`, `Spikes` | |
| `P` | hero start | `Empty` | `start` |
| `T` | golden cog trophy | `Empty` | `trophy` |
| `D` | airlock door | `Empty` | `door` |
| `G` | ore crystal | `Empty` | `pickups` kind `crystal` |
| `B` | bolt blaster | `Empty` | `pickups` kind `blaster` |
| `J` | thruster pack | `Empty` | `pickups` kind `thruster` |
| `C` | Cinderpeg | `Empty` | `enemies` kind `cinderpeg` |
| `M` | Arc Moth, vertical | `Empty` | `enemies` kind `moth`, axis `v` |
| `H` | Arc Moth, horizontal | `Empty` | `enemies` kind `moth`, axis `h` |

Rules: exactly one `P`, one `T`, one `D`; the cell below `P` and below every `C` is `#`; at most 64 columns, 24 rows, 16 enemies (C + M + H) and 4 `J`. `pickups` and `enemies` are in reading order and their index is their id.

Not a parser rule: `docs/LEVELS.md` asks every file in `levels/` to have its top row and both side columns made of `#`, so the picture has a frame. The simulation does not need it (cells outside the grid are solid on those three sides), and unit-test fixtures may be open grids, so `parseLevel` does not check it. `tests/levels.test.ts` does, for every file in `levels/` (9.6).

**Errors.** `parseLevel` throws `LevelError` (`extends Error`, with `levelId: string` and `line: number | null`) for the first problem found. The message is `levels/<id>.txt: <text>`, or `levels/<id>.txt:<line>: <text>` when a line is named. Checks run in this order: line-level checks in file order while reading (rows are checked for width, then characters left to right, as they are read); then the whole-file checks in the order listed.

| When | Line | Text |
|---|---|---|
| Header keyword not known | yes | `unknown header "@title" (allowed: @name, @teaches, @hardest, @requires)` |
| Header repeated | yes | `duplicate @name` (also `@teaches`, `@hardest`, `@requires blaster`, `@requires thruster`) |
| `@name` or `@teaches` with no text | yes | `@name needs a value` |
| `@hardest` malformed | yes | `@hardest must look like "col,row note", for example "@hardest 35,9 the two-tile step"` |
| `@requires` value wrong | yes | `@requires must be "blaster" or "thruster", found "jetpack"` |
| `@` or `;` line after the first grid row | yes | `header line after the grid has started` |
| Non-blank line after a blank line that follows the grid | yes, of the blank line | `blank line inside the grid` |
| Row length differs from row 0 | yes | `row 5 has 59 columns, expected 60 (the width of row 0)` |
| Character not in the legend | yes | `unknown character "x" at col 16, row 3 (allowed: # . P T D G F W S B J C M H)` |
| No grid row at all | no | `no grid rows found` |
| Too large | no | `grid is 70x18; the limit is 64x24` |
| Wrong count of P, T, D (checked in that order) | no | `expected exactly one P (player start), found 0` (also `T (trophy)`, `D (door)`) |
| `P`, then each `C` in reading order, not above `#` | yes | `P at col 2, row 9 must stand on a wall (#)` (also `C`) |
| Too many enemies | no | `too many enemies (17, limit 16)` |
| Too many packs | no | `too many J (5, limit 4)` |
| `@hardest` cell outside the grid | yes, of the header | `@hardest 70,3 is outside the 60x14 grid` |
| `@requires` without the item | yes, of the header | `@requires blaster, but the grid has no B` (also `thruster` and `J`) |

## 9. Validator

### 9.1 Contract

`validateLevel(level, phys, options?)` returns a `LevelProof`: a verdict and, when `proven`, a concrete `InputScript`. Every state the search holds was produced by the real `step()`. The test then replays the script through `step()` from a fresh `createSession([level], phys)` (`replayScript`) and asserts `trophyCollected` at `trophyTick`, `levelCompleted` at `winTick` and no `playerDied`. A validator bug can therefore only reject a good level, never accept an impossible one.

A script starts at the first tick after `startLevel`. The search root is the fresh session stepped `max(1, readyMinTicks)` times with nothing held (the gate's minimum, and never fewer than one tick: those idle ticks arm the gate, section 6, which opens only on a control pressed after a tick with nothing held; `compileTuning` accepts `readyMinFrames` 0, and a root without an idle tick would never leave the ready phase), and every script begins with the run `[0, max(1, readyMinTicks)]`. The first manoeuvre's first held control opens the gate and acts on the same tick. A state whose phase becomes `dying` is dropped; `exiting` is the win. The core has no clock: budgets are counted in `step()` calls, so verdicts are reproducible.

The proof also names the stage that decided it: `LevelProof.stage` is `safe-start`, `quick`, `map` or `guided` (added to the contract with the validator, so that the levels test and the designer's tool can print it). Before a proven proof is returned, `validateLevel` replays its script once through `replayScript` and takes `trophyTick` and `winTick` from that replay; those ticks count in `stats.stepCalls`. A script that does not win there throws an `Error` naming the level: only a validator bug (a field `copyGame` forgets, a root that differs from `createSession`) can cause it. `ProofStats`: `groundNodes` and `flightNodes` are the states the enemy-free map stored, `searchNodes` the states the searches with enemies stored, `stepCalls` every `step()` call of the call (the jump measured for the flood estimate of 9.4 and the closing replay included; `validate/accounting.test.ts` counts the calls of the real `step()` and checks the two agree).

### 9.2 Manoeuvres, not frames

| State kind | Stored and merged on | Actions |
|---|---|---|
| **Ground** (`onGround`) | x bucket (`groundBucketPx`), row, signed `vx` bucket (stopped, part, full) | Hold left / none / right for K = `decisionTicks`; jumps; thrust lift-off when fuel is left; fire |
| **Ballistic** (airborne, no usable fuel) | never stored, never merged | None: it is the inside of a manoeuvre |
| **Flight** (airborne, `hasThruster && fuel > 0`) | cell of `flightCellPx`, `vx` sign | Thrust or coast, each with left / none / right, for K ticks |

- A **jump** is one atomic manoeuvre, simulated tick by tick until it lands, dies or wins: hold {full, `tapTicks` tap} x direction {left, none, right} x at most one change of direction at an arc tick from `airSwitchTicks`. That is 42 arcs at most with the defaults (on open ground 21 full arcs and 15 taps: a tap's hop lands before the third switch tick). Walking off a ledge resolves the same way, as a fall with no jump.
- What the jump set leaves out: jump is pressed only from the ground, never during coyote time after walking off a ledge; and it is held either `tapTicks` ticks or the whole arc, never for a length in between. A jump that exists only with a coyote press, or only with a middle-length hold (common under a low ceiling, where the full hold bumps the head and the tap is too short), is not found, and its level is rejected. Measured by a reviewer: under open sky every cell of the jump tables of `docs/LEVELS.md` that has a press before the walk-off is proven, normal and comfort; the three cells won only by coyote presses (2 up over 4 tiles, 1 down over 5, 3 down over 6, all in the forbidden class) are not. Under a slab 2 tiles above a landing 1 tile up across a 2-tile gap, an 11-frame jump whose winning holds are 5 to 7 ticks is rejected, and so is a 2-tile pit in a corridor 2 tiles high (7 frames, a 3-tick hold). The window tables assume open sky; a required jump under a low ceiling needs headroom, or an early try with the designer's tool (9.6) before the rest of the level is built around it.
- An input that leaves the state's key unchanged is held for up to `maxHoldDecisions` x K ticks, so slow moves inside one bucket are not discarded as duplicates of their own parent.
- With fuel, each of the three straight full jumps (left, none, right) also hands off a flight node at its apex (jump, then thrust, is the fuel-optimal climb). The 18 turned full jumps do not: a climb that starts after a turn in the air is left out, to keep the cost of a fuelled ground state down. A flight that runs dry ends as a ballistic fall.
- **Fire** is offered only from a ground state, when the blaster is held and a live enemy is ahead within range; it runs until the bolt is gone, so no stored state has a bolt in flight. The search never fires during a jump or in flight. A level whose only way past an enemy is a shot from the air therefore comes back `blocked-by-enemies` or `no-route`; `docs/LEVELS.md` (rule 9) forbids such levels, also because a thumb cannot hold THRUST and FIRE together.
- **Merging.** One representative stands for its key. The state with more effective fuel wins: on the ground `fuel`; in flight `fuel - max(0, (vy + thrustMaxRise) / thrustAccel) + (cellBottom - y) / thrustMaxRise` (integer division).
- Ballistic states are never merged: two arcs crossing in one bucket may differ in which one survives (the prototype returned false "unreachable" verdicts when they were merged).

How the real validator (`validate/successors.ts`) fills in what the table leaves open:
- The fire manoeuvre aims at the first live enemy, in index order, that is ahead of the hero in the direction it faces, nearer than `boltRange` plus 2 tiles (it may walk into the bolt) and within 2 tiles of height. One shot per ground state; the wait after it ends with the bolt, at most `boltRange / boltSpeed` (rounded up) plus 2 ticks.
- A ballistic arc is followed for at most 400 ticks (`MAX_AIR_TICKS`, a guard: gravity ends every arc long before).
- The merge compares the integer potentials of the formula above; a later state replaces the representative only with a strictly larger one. A replaced representative still queued is skipped when it comes up. On a level without packs every potential is 0, so the first state met keeps the key: which exact position and speed inside a bucket the search holds depends on the order it met them in. That is why an exhausted search proves nothing by itself (9.4).
- No `GameState` is allocated per manoeuvre: the generator works in a few scratch states, and only the results a stage keeps are copied (`copyGame`) into states from a pool, which take them back once expanded. Memory follows the frontier, not every state seen: the largest map measured (the open hall, 600 000 states) ran in about 320 MB.
- In the map, edges point at keys, not states: an edge into a key whose representative is replaced later leads on through the new one.

### 9.3 State key

Hero part: kind, x bucket, row or flight cell, `vx` bucket, `hasTrophy`, which `J` pickups are taken. The search with enemies adds `hasBlaster`, `facing` when armed, the alive mask, and for each live enemy within `enemyKeyRadiusTiles` its position in `enemyBucketPx` buckets and its direction. Far enemies are not in the key, so the search can wait beside an enemy but cannot stall elsewhere. Crystals are never in the key; reachable crystals are the union of `taken` over explored states.

Keys are exact integers below 2^53: the hero part is below 2^31 at the caps, and each enemy configuration gets a number in the order it is first met, so two different keys never collide. The ground row is the row of the top of the hero's box; "within `enemyKeyRadiusTiles`" means less than that many tiles apart on both axes, measured between the top-left corners.

### 9.4 Pipeline

Every search merges states on a key and keeps one representative per key (9.2), so an exhausted search means "no win among the states it kept", not "no win". The quick pass, the map and the guided search merge on different keys, in different orders, and each can miss a win another one finds (a reviewer's fuzzing found such levels for each of them; they are fixtures in `validate/index.test.ts`). So a failure is returned only after every stage that applies has run, and a win of any stage is `proven`.

0. **Safe start.** From the root: one tick of fire alone (opens the gate; harmless without a blaster), then `safeStartTicks` idle ticks. A death is `unsafe-start`.
1. **Quick pass** (skipped when `alwaysMap`). Weighted A* with enemies on, ordered by `f = ticks so far + heuristicWeight * h`, `h` the flood estimate below.
   - Its budget in `step()` calls depends on whether the level holds a thruster pack. **No pack:** `quickStepCalls`; the map of such a level is small, so it is a cheap second opinion. **With packs:** all of `maxStepCalls`; the map of such a level costs more than the quick pass ever does (9.6), so stages 2 and 3 are not run.
   - A win ends the pipeline: `proven`.
   - With packs: an empty frontier is **`no-route`**, a spent budget `budget-exceeded`; the pipeline stops (`alwaysMap` names a reason).
   - Without packs, an empty frontier and a spent budget both go on to the map.
2. **Map.** Enemies removed (`alive = false` at the root), exhaustive, most effective fuel first, every edge recorded; a backward shortest-path pass from the win gives the cost-to-go of every stored state. No state with the trophy: `trophy-unreachable`. Trophy but no win: `door-unreachable`. Both set `stuckAt` to the closest approach. The total budget spent before the map is complete: `budget-exceeded`.
3. **Guided search.** Enemies on, `h` = the map's cost-to-go (unknown keys penalised, never pruned). A win: `proven`. Exhausted: `blocked-by-enemies` on a level with enemies; on a level without any, `no-route` (merging lost the win, not an enemy). Out of budget: `budget-exceeded`.

`alwaysMap` means map first, for any level: stages 0, 2, 3, and when they end in `trophy-unreachable`, `door-unreachable`, `blocked-by-enemies` or `no-route`, stage 1 on what is left of `maxStepCalls` (its usual budget, capped by what is left). A win there is `proven` (stage `quick`); otherwise the map-first verdict stands. Whenever the map finishes inside `maxStepCalls` it names the reason of a failure and fills `unreachableCrystals`. Without packs it costs about 1 to 2 M step calls; with packs 12 M to 85 M (9.6), so it is for a person asking a question, not for every test run.

`stuckAt` is the closest approach of the stage that named the verdict: the cell holding the centre of the hero's box, for the stored state closest to the goal. Closeness in the quick pass and in the map is the flood estimate; where the flood cannot reach, 100 000 plus the straight distance in tiles (across plus up) to the trophy and on to the door, or to the door once the trophy is held, so a goal no flood reaches still gets a useful cell. In the guided search it is the map's cost to go. For `unsafe-start` it is the cell in which the hero died. The guided search's estimate for a key the map never stored, or stored without a way to win, is the map's cost from the root plus 600 ticks (`UNKNOWN_KEY_PENALTY_TICKS`).

**The flood estimate** (`validate/heuristic.ts`). `h` is in **ticks**: a distance in tiles from the hero's cell to the trophy plus the trophy-to-door distance (to the door cell once the trophy is held), multiplied by `TILE / phys.runMax` (10.7 ticks per tile with the shipped run speed) and rounded down. The distances come from breadth-first floods from each goal cell (4 neighbours, inside the grid) that pass through **`Tile.Empty` cells only**: `Solid`, `Fire`, `Coolant` and `Spikes` all block them. A cell no flood reaches gets a large constant (100 000 ticks); it is penalised, never pruned. Two floods, because what the hero can climb depends on its fuel:
- the **free flood** moves any way: a hero with usable fuel (`hasThruster && fuel > 0`) is estimated on it;
- the **climb flood** lets the hero rise at most `climbTiles` tiles since it last stood on a wall: moving up uses a tile of climb, sideways keeps it (so a jump may rise in one column and go on rising in the next), down leaves none, and a cell with a wall below gives it all back. `climbTiles` is measured once per call with the real `step()` (`Sim.climbTiles`): the rise of a jump held from standing in an open room, plus `ledgeCatch`, rounded up to whole tiles (4 on the shipped numbers and on the comfort numbers). A hero without fuel is estimated on the climb flood to the goal, or by way of a thruster pack (the climb flood to the pack plus the free flood from the pack), whichever is shorter; packs are always there for a hero without fuel, because taken packs come back when the tank runs dry. The trophy-to-door leg is taken the same way, so taking a pack never makes the estimate rise.

Why hazards block the flood fill: with hazard tiles passable, the shortest "path" to a goal on the far side of a deck runs through the coolant set into the floor, and the search queues up under it. Measured on a 64 x 24 level of three decks with coolant gaps in the deck floors (2 packs, 6 enemies): hazards passable, no win in 300 000 nodes and 72 M step calls; hazards blocking, proven in 1 996 nodes and 0.05 M step calls (comfort: 1 418 nodes). Why ticks: `ticks so far` is in ticks, so a distance in tiles would weigh a tenth of what it should and the search would be close to uniform-cost.

Why a climb flood: with the free flood alone, a hole in a deck floor above an empty lower deck is the shortest "path" for a hero on the lower deck, which it cannot climb without fuel; the quick pass piled up under the hole among the walking Cinderpegs. On a stand-in for level 9 (56 x 24, 2 packs, 7 enemies, the 4-tile gap of deck 2 open to deck 1 below, live tuning) the normal proof ended `budget-exceeded` after all 40 M step calls without ever reaching the pack (proven with a 300 M budget in 40.3 M), the comfort proof cost 31.5 M. With the climb flood the hero without fuel heads for the pack: proven in 8.4 M and 5.2 M. That is still a lot: the hole is a real second route (the validator's own route carries a full tank west along deck 1 and flies up through it), and the air of deck 1 under it is thruster air (`docs/LEVELS.md`, rule 12). With coolant in the gap: 0.06 M and 0.04 M.

Start-to-trophy and trophy-to-door are one search because `hasTrophy` is in the key: the second leg starts from every way of holding the trophy. Hazards and enemies need no model: `step()` kills and the branch is dropped. Fuel is exact per state. The rule that packs reappear on an empty tank is simply part of `step()`.

### 9.5 Options (`validate/options.ts`)

| Option | `DEFAULT_OPTIONS` | `COMFORT_OPTIONS` | `REQUIRES_OPTIONS` |
|---|---|---|---|
| `decisionTicks` (K) | 6 | 8 | 6 |
| `maxHoldDecisions` | 3 | 3 | 3 |
| `groundBucketPx` / `flightCellPx` | 4 / 8 | 4 / 8 | 4 / 8 |
| `tapTicks` | 4 | 4 | 4 |
| `airSwitchTicks` | 8, 16, 24 | 12, 24 | 8, 16, 24 |
| `enemyKeyRadiusTiles` / `enemyBucketPx` | 4 / 8 | 4 / 8 | 4 / 8 |
| `heuristicWeight` | 2 | 2 | 2 |
| `quickStepCalls` | 2 000 000 | 2 000 000 | 2 000 000 |
| `maxStepCalls` | 40 000 000 | 40 000 000 | 6 000 000 |
| `safeStartTicks` | 120 | 120 | 120 |
| `alwaysMap` | false | false | false |

These are starting values, measured on a reference implementation (9.6), and may be tuned by the validator's implementer; they are not feel numbers. The real validator keeps them unchanged: the Phase 4 gate passes with them. One thing worth trying there: the set of taken packs is part of every key, which multiplies the flight cells of the map by up to 16 (it matters only to a map-first run of a level with packs).

### 9.6 Required tests (`tests/levels.test.ts`)

| Suite | Levels | Passes when |
|---|---|---|
| (a) Normal proof | every file in `levels/`, including `test` and `debug` | `parseLevel` succeeds; verdict `proven` with `compileTuning(TUNING)` and `DEFAULT_OPTIONS`; `replayScript` wins with the same `trophyTick` and `winTick` |
| (b) Comfort proof | level-01 to level-10 | `proven` with `compileTuning(handicap(TUNING))` and `COMFORT_OPTIONS`, and its replay wins. `handicap`: coyote 0, buffer 0, run speed and jump velocity x 0.95, fuel x 0.9 rounded down |
| (c) Requires | each `@requires X` line | `validateLevel(withoutItem(level, X), phys, REQUIRES_OPTIONS)` is anything but `proven`. When the level without the item holds no thruster pack (always so for a removed thruster) the pipeline runs the quick pass and then the map and the guided search (9.4), so the line holds only when no search wins, and the verdict names the reason. With packs left, the quick pass alone decides |
| (d) Campaign | level-01 to level-10 as one game | All ten files are there, in order. The ten normal proofs of (a), played one after another in one `createSession(levels, phys)` from level 1 (nothing held through each `exiting` phase), win the game (`status 'won'`) with no `playerDied`, and every level's `trophyCollected` and `levelCompleted` fall on its own proof's ticks. About ten thousand `step()` calls and no search, so not counted against the budget. It is the proof that a level started by the airlock of the one before behaves as the same level started by `createSession`, and that the levels chain to the end |

What the comfort proof shows, and what it does not: a route exists that needs no coyote time and no jump buffer, with run speed and jump 5 % weaker and a tenth less fuel. It certifies **no timing margin**. The search shifts its take-off point in 4 px steps, so under open sky it can find a jump whose press window is as small as 2 frames, as long as a press on the ground wins (measured: the level 4-tile gap, comfort window 2, is proven in 0.02 M step calls). That is a measurement, not a guarantee: a jump that needs a coyote press or a middle-length hold is never tried (9.2), and the take-off a jump needs may be merged away in one stage and found in another (9.4). Timing margins are enforced by people, with the window classes of `docs/LEVELS.md`.

`budget-exceeded` in suite (c) counts as a pass ("as far as the search can decide", ruling R10), but it decides nothing: the file prints one line per `@requires` run with its verdict, and a final line listing the runs that ended `budget-exceeded`, so a reviewer sees which promises were not checked.

The same file also:
- asserts that level-01 to level-10 carry `@name`, `@teaches` and `@hardest`, with texts the pixel font can show;
- asserts the picture frame of every file: the top row and both side columns are `#` (section 8);
- prints the campaign's contents (size, crystals, items, enemies, `@requires` and `@hardest` per level, and the totals) and, in suite (d), each level's ticks, score and lives as the campaign is played;
- prints one line per level with verdict, the stage that decided, and step calls; a failure names its reason by itself, because a level without packs always reaches the map when the quick pass fails (9.4), and a level with packs has no affordable map;
- with the environment variable `LEVELS_CRYSTALS=1` (`LEVELS_CRYSTALS=1 npx vitest run tests/levels.test.ts`), runs every level once more with `alwaysMap` and a `maxStepCalls` of 400 M and prints `unreachableCrystals`. This is the reviewer's command for the checklist in `docs/LEVELS.md`; it is not part of `npm run check`, because the map of a thruster level is expensive.

**Budget.** Ruling R10: the whole file runs in about 60 s or less on the 4-core build machine. Because CI machines are slower and the core has no clock, the file asserts **step calls, not seconds**: the sum of `stats.stepCalls` over all proofs must stay below `LEVELS_STEP_BUDGET` (exported by `validate/options.ts`; 90 000 000, set by item 4 of the gate below: a proof of a room loaded like a full campaign level spends 0.54 to 0.69 microseconds of wall time per call, so 90 M is 49 s to 62 s; real rooms run 1.5 to 2.5 times faster. The first estimate, 150 000 000, assumed 0.4 microseconds for `step()` alone). Wall time is printed, never asserted. Every proof test passes an explicit timeout of 120 s (`it(name, fn, 120_000)`): Vitest's default of 5 s would fail any proof that takes a slow path.

Measured costs, in step calls, on a reference implementation of this section (a throwaway model of sections 3 to 6 and of 9.1 to 9.5; two independent models of the rules agreed tick for tick over a million random ticks). They are the evidence behind the option values, not a promise about the real validator:

| Level | Quick pass, normal / comfort | Map first, normal / comfort | Suite (c) |
|---|---|---|---|
| `levels/test.txt` (64 x 16, no pack, no enemy) | 0.05 M / 0.04 M | 2.0 M / 1.4 M | |
| Two Cinderpegs in tunnels 1 tile high, 56 x 6, no pack (the shape of level 5) | 0.02 M / 0.01 M | | Without blaster, map first: `blocked-by-enemies` in 1.0 M |
| `levels/debug.txt` (64 x 14, 2 packs, 3 enemies) | 0.49 M / 0.01 M | 12.5 M / 8.8 M | Without thruster, map first: `trophy-unreachable` in 0.40 M. Without blaster: `no-route` after 2.78 M |
| Three decks, 64 x 24, 2 packs, 6 enemies, coolant in the deck floors | 0.05 M / 0.03 M | 27.8 M / 20.3 M | Without thruster: `trophy-unreachable` in 0.82 M |
| Open hall, 64 x 24, 4 packs, no enemy | 2.9 M / 3.7 M | 85.6 M / 60.1 M | |
| Open hall, 64 x 24, 4 packs, 4 enemies | 13.5 M / 27.6 M | 85.6 M / 60.6 M | Without thruster: `trophy-unreachable` in 0.77 M |

So: an ordinary level is proven by the quick pass in well under 1 M step calls; the map of a level with thruster packs costs 12 M to 85 M, which is why it is not a fallback; and one open hall at the size cap can use a quarter of the whole file's budget by itself. The earlier figure of 1.7 to 4.6 M for the full path came from 60 x 14 levels under different physics and does not hold.

The real validator (`src/core/validate`, on `REFERENCE_PHYS`; the fixtures are in `validate/fixtures.ts`), after the review fixes (climb flood, every stage tried before a failure), on 2026-11-24. The map-first column is that of the first build: the map and the guided search do not use the flood estimate, and these rooms are all proven there.

| Level | Quick pass, normal / comfort | Map first, normal / comfort | Suite (c), `REQUIRES_OPTIONS` |
|---|---|---|---|
| `levels/test.txt` | 0.05 M / 0.04 M | 2.01 M / 1.37 M | |
| `tunnels` (two Cinderpegs in tunnels 1 tile high, 56 x 6, no pack) | 0.02 M / 0.01 M | 0.55 M / 0.44 M | Without blaster: the quick pass runs dry, then `blocked-by-enemies` from the guided search, 1.54 M in all |
| `levels/debug.txt` | 0.49 M / 0.01 M | 12.47 M / 8.79 M | Without thruster: the quick pass spends its 2 M, then `trophy-unreachable` from the map, 2.40 M in all. Without blaster (packs left, so the quick pass alone): `no-route` after 2.78 M |
| `threeDecks` | 0.04 M / 0.03 M | 27.82 M / 20.31 M | Without thruster: `trophy-unreachable`, 2.82 M in all |
| `openHall(0)` (no enemy) | 2.43 M / 2.96 M | | |
| `openHall(4)` | 1.77 M / 20.56 M | 84.53 M / 59.63 M | Without thruster: `trophy-unreachable`, 2.78 M in all |

Before the fixes the quick passes of the open hall cost 3.44 M / 3.57 M (no enemy) and 13.13 M / 26.01 M (4 enemies), and a removed thruster was decided map first in 0.40 M to 0.82 M: the extra 2 M on such a line is the quick pass that now checks the map's verdict (9.4). Wall time under Vitest: the open hall's two quick passes take 0.4 s and 5.5 s; in plain Node its normal map takes 15 s.

Stand-ins for levels 6 to 10 of the plan, written by a reviewer from `docs/LEVELS.md` (section 5), on the live tuning; normal / comfort, then the `@requires` lines:

| Stand-in | Normal / comfort | Without blaster | Without thruster |
|---|---|---|---|
| Level 6 (moth shafts, no pack) | 0.01 M / 0.01 M | | |
| Level 7 (thruster loft, 3 packs) | 0.02 M / 0.04 M | | `trophy-unreachable`, 0.10 M |
| Level 8 (crucible run, 4 packs) | 0.03 M / 0.03 M | | `trophy-unreachable`, 0.17 M |
| Level 9 (three decks, 2 packs, 7 enemies), the 4-tile gap of deck 2 open to deck 1 | 8.36 M / 5.18 M | `budget-exceeded` at 6 M | `trophy-unreachable`, 2.65 M |
| The same with coolant in that gap | 0.06 M / 0.04 M | `budget-exceeded` at 6 M | `trophy-unreachable`, 2.62 M |
| Level 10 (heart furnace, 3 packs) | 0.10 M / 0.23 M | `no-route`, 1.12 M | `trophy-unreachable`, 2.40 M |

Level 9's open gap is the hole of 9.4 (before the climb flood: `budget-exceeded` at 40 M, comfort 31.5 M). Its `@requires blaster` cannot be decided inside `REQUIRES_OPTIONS`: the Cinderpeg that needs the blaster stands at the top of lift B, after both packs, so the quick pass must search all the thruster air of decks 1 and 2 before it can say `no-route`; with a budget of 160 M it does, after 137.4 M step calls and 51 s (the first build: 140.9 M; map first, `blocked-by-enemies` after 128.5 M). Level 10's corridor comes before any pack, and its line is decided in 1.12 M. Hence rule 9 of `docs/LEVELS.md`: on a level with packs, the passage that makes the blaster necessary comes before the first pack.

**The designer's tool.** `node src/tools/prove.ts levels/<name>.txt` runs the same proofs on one file in about a second (parse error; normal and comfort verdicts with stage, step calls, nodes, `trophyTick` and `winTick`, or `stuckAt`; each `@requires` run; unreachable crystals with `--crystals`). `--script FILE.json` writes the winning script in the shape of `e2e/scripts/*.json`, and `--route FILE.png` replays it and draws the hero's path, tick by tick, over a `scene.ts` render of the level. The options are listed at the top of the file.

**Phase 4 gate, before the first campaign level is built.** The real validator must show, in `src/core/validate/*.test.ts`:
1. the three-deck fixture above proven, normal and comfort, in under 1 M step calls each (and not proven when its flood fill is allowed through hazards: the fixture exists to catch that mistake);
2. the open-hall fixture (64 x 24, 4 packs, 4 enemies) proven, normal and comfort, inside `maxStepCalls`;
3. `debug.txt` without its thruster packs decided (`trophy-unreachable`) and without its blaster decided (`no-route`), each inside `REQUIRES_OPTIONS`;
4. the measured rate of the real `step()` on the build machine, from which `LEVELS_STEP_BUDGET` is set to 60 s worth of calls. Measure it under Vitest (where the proofs run) on a cap-size room loaded like a campaign level (64 x 24, 16 enemies, 30 or more crystals), never on `debug.txt` alone: `step()` looks at every pickup and every live enemy on every tick, so its cost grows with them. Measured after the two speed-ups below, median of 5 runs of 2 M calls each with random input: `debug.txt` (3 enemies, 11 pickups) 0.26 µs; 64 x 24 with 6 enemies and 23 pickups 0.34 µs; with 16 enemies and 5 pickups 0.47 µs; with 16 enemies and 35 pickups 0.55 µs. That is above the 0.4 µs behind the starting budget, so a campaign of full rooms needs either a smaller budget in calls or more than 60 s. The two speed-ups: `parseLevel` leaves the pickups array unfrozen (its objects stay frozen; V8 reads a frozen array about 2.5 times slower), and both enemy kinds share the layout of their first five fields (the moth's `axis` comes last); together they took the full room from 0.76 to 0.55 µs. A further one would change the contract: pickups indexed by cell, so step 14 looks only at the cells in reach.

If 2 fails, or if the ten planned levels cannot fit the step budget, the caps are lowered as ruling R10 allows, in this order: `LEVEL_MAX_WIDTH` / `LEVEL_MAX_HEIGHT` in `types.ts` for levels that hold a thruster pack (48 x 16 is the first step), then `LEVEL_MAX_THRUSTERS`. The new caps are recorded in `docs/LEVELS.md` and the level plan there is changed to fit. Until the gate has run, the caps of ruling R9 stand and `docs/LEVELS.md` (rule 12) keeps thruster airspace small by design.

**Gate result** (`src/core/validate/gate.test.ts`, first run on 2026-11-24 on the shared 4-core build machine, run again after the review fixes the same day; about 19 s). All four items pass, so the caps of ruling R9 stand and `docs/LEVELS.md` is unchanged:
1. three decks proven in 0.04 M step calls (normal, 1 920 search nodes) and 0.03 M (comfort, 1 351); with hazards passable in the flood fill the quick pass has no win after 2 M step calls (16 589 nodes). First run: 0.05 M (2 010) and 0.03 M (1 418);
2. open hall proven in 1.77 M (normal) and 20.56 M (comfort) of the 40 M of `maxStepCalls`. First run: 13.13 M and 26.01 M;
3. `debug.txt` without its packs: `trophy-unreachable` in 2.40 M (the quick pass, then the map; first run, map first alone: 0.40 M); without its blaster: `no-route` in 2.78 M; both inside the 6 M of `REQUIRES_OPTIONS`;
4. a proof of `capRoom` (64 x 24, 16 enemies, 37 pickups: 32 crystals, the blaster, 4 packs), timed directly for 6 M step calls under Vitest: 0.54 µs per call (the reviewer's runs) to 0.60 µs (mine, with other agents on the machine). `step()` alone there costs 0.49 to 0.55 µs (median of 5 runs of 2 M calls with random input). The first run estimated the proof instead, as bare `step()` on the cap room times the validator's overhead over bare `step()` on the gate's own rooms; that ratio was 1.33 to 1.36 then, 1.13 for a reviewer and 0.94 in my last run (the gate's rooms are lighter than the open hall it was compared with), so it is no basis for a budget: the gate now prints both and the budget follows the larger. At 0.54 to 0.69 µs a call, 60 s is 87 M to 111 M calls: `LEVELS_STEP_BUDGET` stays 90 000 000 (49 s to 62 s). On the rooms of a real campaign a proof costs 0.21 to 0.36 µs a call (the stand-ins above: level 9 0.32 to 0.35), so 90 M is about 20 s to 32 s there. With only `test.txt` and `debug.txt` (suites (a) and (c)) `tests/levels.test.ts` spent 5.72 M of it in 1.6 s of validator time (the file: 1.9 s; before the fixes 3.72 M). With the ten campaign levels it spends 16.35 M in about 4.7 s of validator time, the file about 5 s (below).

The plan of `docs/LEVELS.md` (section 5) fits that budget only with care. By the stand-ins above: an ordinary level spends well under 1 M on its two proofs; a roofed thruster level a few tenths of a million; each removed-thruster line 0.1 M to 2.7 M (up to 2 M of it is the quick pass, before the map decides); each `@requires blaster` line of a level with packs up to the 6 M of `REQUIRES_OPTIONS`, and that line decides nothing when the blaster is needed after a pack. With level 9's gap open the plan comes to about 36 M, `test.txt` and `debug.txt` included; with coolant in it, about 22 M; on the first build level 9 alone took 78 M and its normal proof failed. The checklist's ceiling (the level's two proofs under 10 M) is an alarm for one level, not its share: ten levels at that ceiling would not fit. What makes a level expensive: thruster air (air a fuelled hero can reach, multiplied by the packs taken), enemies walking near that air (each enemy within 4 tiles of the hero puts its position in the key), and a hole in a deck floor over such air (9.4). As built and revised after the campaign review, the ten levels came to 16.35 M with both development levels, a fifth of the budget (the next paragraphs).

**The real campaign** (`levels/level-01.txt` to `level-10.txt` as built and then revised after the campaign review of `docs/LEVELS.md`, section 8: levels 2, 5, 6, 7, 8 and 10 changed; measured on 2026-11-24 with `tests/levels.test.ts` on the live tuning, on the shared 4-core build machine). Step calls in millions; every normal and comfort proof was decided by the quick pass. The map-first column is the `LEVELS_CRYSTALS=1` run (`alwaysMap`, 400 M budget, not counted), which proved every level at the guided stage and left no crystal unreachable.

| Level | Packs, enemies | Normal / comfort | Suite (c), `REQUIRES_OPTIONS` | Map first (crystals) | Validator time, normal / comfort |
|---|---|---|---|---|---|
| `level-01` Cold Start, 40 x 14 | 0, 0 | 0.27 / 0.20 | | 1.38 | 65 / 40 ms |
| `level-02` Slag Gaps, 60 x 14 | 0, 0 | 0.02 / 0.01 | | 1.46 | 11 / 3 ms |
| `level-03` Quench Hall, 56 x 14 | 0, 0 | 0.02 / 0.01 | | 1.09 | 7 / 3 ms |
| `level-04` The Stack, 30 x 24 | 0, 0 | 0.12 / 0.07 | | 2.43 | 29 / 17 ms |
| `level-05` Blaster Bay, 56 x 14 | 0, 4 | 0.03 / 0.03 | Without blaster: neither the quick pass nor the guided search wins, the map finds the enemy-free route, so `blocked-by-enemies` (guided); 2.55 in all | 1.22 | 18 / 9 ms |
| `level-06` Moth Shafts, 60 x 16 | 0, 7 | 0.02 / 0.02 | | 1.45 | 26 / 7 ms |
| `level-07` Thruster Loft, 44 x 24 | 3, 0 | 0.02 / 0.07 | Without thruster: `trophy-unreachable` (map), 0.35 | 12.30 | 20 / 21 ms |
| `level-08` Crucible Run, 64 x 16 | 4, 0 | 0.10 / 0.08 | Without thruster: `trophy-unreachable` (map), 0.17 | 8.56 | 42 / 24 ms |
| `level-09` Sorting Line, 56 x 24 | 2, 7 | 0.05 / 0.03 | Without blaster: `no-route` (quick), 0.45. Without thruster: `trophy-unreachable` (map), 2.50 | 14.29 | 22 / 13 ms |
| `level-10` Heart Furnace, 64 x 24 | 4, 6 | 0.06 / 0.05 | Without blaster: `no-route` (quick), 0.80. Without thruster: `trophy-unreachable` (map), 2.55 | 27.68 | 37 / 21 ms |

Sums: the twenty campaign proofs 1.26 M, the seven campaign `@requires` runs 9.37 M (none `budget-exceeded`), `test.txt` and `debug.txt` 5.72 M; the file 16.35 M of `LEVELS_STEP_BUDGET`, 4.7 s of validator time, about 5 s for the whole file under Vitest. The crystal run of all twelve files: 21 s. Before the review's changes the file spent 16.26 M; the longer routes of levels 5, 6, 8 and 10 added 0.1 M, because the new length is ground and roofed shafts, not open thruster air. What kept it cheap, against the stand-ins above:
- the levels with packs are roofed and walled (`docs/LEVELS.md`, rule 12), and level 9's deck-2 gap holds coolant: its proofs cost 0.05 M / 0.03 M, not the 8.36 M / 5.18 M of the open stand-in;
- the Cinderpeg that makes the blaster necessary walks a passage before the first pack (1 tile high in both levels 9 and 10), so both `@requires blaster` lines of the pack levels are decided by the quick pass in under 1 M (`no-route`), not left `budget-exceeded` at 6 M;
- a removed thruster still costs up to 2 M of quick pass before the map decides (levels 9 and 10: 2.50 M and 2.55 M), the campaign's largest lines; on levels 7 and 8 the quick pass ends sooner (0.35 M and 0.17 M in all).

A map-first run of a real level with packs costs 8.6 M to 27.7 M (level 10's four packs the most), at the low end of the 12 M to 85 M that 9.4 quotes from the fixtures, because the air is roofed. The budget left, about 74 M, is room for the owner's level fixes after the Phase 4 playtest, not a target.

## 10. Session and save

Storage is the shell's (`src/shell/storage.ts`, never throws, memory fallback). Two keys: `${GAME_ID}:progress` holds `SaveData`, `${GAME_ID}:settings` holds `SettingsData` (`sound`, `vibration`; both default true). The reducers in `src/core/save.ts` are pure.

| Moment | Shell does |
|---|---|
| Boot | `save = parseSave(loadJson(progressKey), CAMPAIGN.length)` |
| After every tick's events | `next = applyEvents(save, events)`; when `next !== save`, write it |
| Title, `save.resume` set | `CONTINUE - LEVEL n`: `createSession(CAMPAIGN, phys, { ...save.resume, highestUnlocked: save.unlocked })` (`createSession` clamps the stored lives to 1 to `maxLives`: `parseSave` cannot check them against `Phys`) |
| Title, no resume, `save.unlocked > 0` | Continue: `createSession(CAMPAIGN, phys, { levelIndex: save.unlocked, highestUnlocked: save.unlocked })` (3 lives, score 0) |
| `NEW GAME` | `createSession(CAMPAIGN, phys, { highestUnlocked: save.unlocked })`; unlocked levels and best score are kept |
| Quit to title from pause | Nothing is written; `resume` already holds the level's starting score and the current lives. Quitting costs no life: it throws away the level visit (see below) |
| `?level=test`, `?level=debug`, the e2e hook | `createSession([level], phys)`; never read or write the save |

What `applyEvents` does per event is listed on `ApplySaveEventsFn` in `types.ts`. Consequences:
- Quitting (or closing the page) and continuing restarts the level as a fresh visit: the score it began with, the lives as they are now (deaths are not undone), nothing collected, no cog. This is deliberately different from `Restart level`, which keeps the score, the crystals and the cog and costs a life. A player can therefore dodge a death that has not happened yet by quitting in mid-air, and pays for it with everything gathered in that level. Charging a life for leaving would also punish a phone call or a closed tab, so version 1 accepts this (`docs/SPEC.md` says so in plain words).
- A cleared level moves `resume` to the next level at once, so closing the page during the clear banner loses nothing. Clearing the **last** level saves the win at once (`finished = true`, `resume = null`, `bestScore` raised to the score so far): nothing but a closed page can stop the exiting phase, and a closed page must not send the player back to the start of the last level. Only the life bonus waits for `gameWon`. A game over or a win clears `resume`.
- `bestScore` updates on game over and on the win, and earlier where the page could close first: at the last death (during the dying animation) and at the last level's clear (during the exiting phase). That is why an end screen cannot find out from the save whether the score is a new best: see 11.3.

## 11. Shell interface

Boot, scaling and rendering follow the verified recipes in `docs/PHASER4-NOTES.md`: `Scale.NONE` with the canvas in game pixels and a CSS `transform: scale(zoom / devicePixelRatio)`, camera zoom always 1, integer draw positions, CPU `TilemapLayer`, `Image` objects, `BitmapText` through `RetroFont`, the HUD as its own scene, one reusable particle emitter, a private `AudioContext` with Phaser audio off, `fps: { panicMax: 0 }`, `input: { windowEvents: false }`.

### 11.1 Fixed-step loop (`PlayScene.update`)

As built (`src/shell/scenes/PlayScene.ts`, slightly condensed):

```ts
override update(_time: number, deltaMs: number): void {
  if (this.mode !== 'running' && this.mode !== 'intro') return;    // paused, ended: nothing is stepped
  this.gate.sample(this.game.loop.rawDelta);
  const n = this.replay ? this.replay.spec.ticksPerFrame : (this.pace ?? this.stepper.advance(deltaMs));   // whole 60 Hz frames (pace: test hook only, 11.6)
  for (let i = 0; i < n; i++) {
    if (this.mode === 'intro') { this.introFrame(); continue; }     // the level's intro card: the core waits
    if (this.mode !== 'running') break;                             // the session ended inside this frame
    if (this.hitStopLeft > 0) { this.hitStopLeft -= 1; continue; }  // a kill holds the picture
    this.tickEvents.length = 0;
    const input = this.replay ? this.replay.next() : controls.consume();   // exactly one sample per tick
    step(sim, input, this.tickEvents);
    this.router.drain(this.tickEvents, sim);   // sfx.tick() first, then sound, effects, HUD, save, scene changes
    this.cam = stepCamera(this.cam, cameraTarget(sim), this.viewSize, this.levelPx, TUNING.camera);
    this.view.capture(sim, this.cam);          // prevDraw = curDraw; curDraw = whole-pixel positions of sprites AND camera
  }
  this.effects.update(n, sim);   // effect timers, the shake, the screen fade
  this.pushFrame(sim);           // sfx.update(sim) while running, pad.setItems(...), hud.show(model)
  this.draw(sim);                // view.render(sim, gate.alpha(stepper), shake): alpha is 1 when interpolation is off
}
```

- The keyboard is not polled here: `installKeyboard` (src/input/keyboard.ts) writes the held keys to `Controls` on the scene's own `update` event, just before this method. Esc, P and M are not given to `installKeyboard`: the scene listens for them through `onFreshKey` (src/shell/freshKey.ts), as the menus and the title do, which acts once per keyboard event. Phaser 4.2.1 hands a key's `down` over a second time when another key event arrives before the frame ends; through plain `onKeyDown` that toggled the sound twice, and the Esc that had just closed the pause menu opened it again from the Play scene's own handler.
- The router drains a tick **before** the camera and the capture: a `levelStarted` rebuilds the world view inside `drain` (the next level's sprites, tiles and position arrays), so the capture that follows works on the new level; a snap asked for by `levelStarted` or `respawned` is applied right after that capture (`prev = cur`).
- **Modes** of the Play scene: `intro` (the level's intro card, `TUNING.effects.introFrames`; a fresh press after `introSkipAfterFrames` skips it), `running`, `paused` (the pause menu; the rotate guard also stops Phaser), `ended` (the End screen or the title is starting; a finished replay also stops stepping). During the intro the controls are consumed once per 60 Hz frame although no tick is simulated: that is how a fresh press is seen, and it swallows the press that skips the card, so it is not also the first press of the level. A replay has no intro card.
- `FixedStepper(1000 / TICK_HZ, TUNING.pacing.maxStepsPerFrame)`: `advance(deltaMs)` returns 0 to 5 whole ticks; a longer backlog is dropped. It is fed Phaser's smoothed `delta`. `reset()` on every pause, resume, scene start and level start.
- `Controls.consume()` returns held states and latches presses: a tap that starts and ends between two ticks is still reported for one tick. It sends at most one of left and right (the most recently pressed).
- Pausing means not calling `step`. On closing the pause overlay the shell calls `holdReady(game)`, `stepper.reset()` and `controls.releaseAll()`. `pauseGame` also calls `sfx.silence()`, hides the touch pad and stands the particles still; the HUD's own clocks (toast, life blink, score count, shutter) stand still too, through the `held` predicate the Play scene hands the HUD at launch (`HudData`), and none of the frames under the menu is banked to catch up afterwards. Restart level runs the core's `restartLevel` through the same router, then resumes into the ready gate; opened on the intro card, it ends the card first (the core's restart brings no `levelStarted`, so nothing else would take it down), while RESUME goes back to the card.
- **A key held through a reset is not a press.** The pause, the resume and a blur reset Phaser's keys (`resetKeys`); a key still held then reads up, and its next auto-repeat (`keydown` with `repeat: true`) made Phaser's Key go down again and emit `down`, which opened the ready gate after RESUME without a fresh press (ruling R4). `src/input/keyboard.ts` ignores every `down` that is an auto-repeat and reads such a key as up until its `keyup`; the same holds for a key already held when a scene starts. `e2e/pause.spec.ts` holds keys with repeats through Esc, RESUME, RESTART LEVEL and a blur.
- **Scene listeners.** Every cleanup a scene or a menu registers for its end goes through `onSceneEnd` (src/shell/sceneEnd.ts): once on `shutdown` or `destroy`, whichever comes first, removing the other. `destroy` comes only from `game.destroy()`, so a plain `once('destroy')` stayed behind on every visit. `e2e/pause.spec.ts` checks that every scene's listener count is the same after four rounds as after one.
- The HUD scene updates before the Play scene in Phaser's order, so `EventRouter` pushes HUD changes instead of the HUD polling.
- **Hit stop on a kill** is the shell's: after a tick whose events hold `enemyKilled`, `update` steps nothing for `TUNING.effects.killHitStopFrames` rendered-at-60 frames (it still draws). Never during a replay, so replays stay tick-exact. The freeze at a death is different: it is part of the core's dying phase.
- **Interpolation** (last shell feature to build): mode `'auto'` switches it on only when the measured display interval is below `TUNING.pacing.interpolateBelowMs` (90 and 120 Hz screens); at 60 Hz it is off and `render` draws the current state. The method is the verified one in `docs/PHASER4-NOTES.md`, section 12, and nothing else: after every tick the view stores the **whole-pixel draw position** of each sprite and of the camera (the values it would draw with interpolation off); `render` blends the previous and the current whole-pixel positions with `lerpPx(prev, cur, alpha)`, sprites and camera alike. Blending sub-pixels and flooring afterwards is wrong: it made the hero wobble across three screen pixels at 144 Hz. A draw position snaps to the current one (`prev = cur`) on `levelStarted` and `respawned`; when it moved more than 16 px in one tick (inside `lerpPx`); and for **anything that was not drawn on the previous tick**: a bolt that became `active` this tick (its x and y are meaningless while inactive), an enemy that came back to life, a pickup that reappeared.

### 11.2 State to sprites, by id

Arrays in `RunState` are never reordered during a level, so `kind:index` is a stable id. `WorldView` keeps `Map<string, Image>`; all sprites are rebuilt on `levelStarted`.

| Id | Source | Rule |
|---|---|---|
| tile layer | `level.tiles` | Built once per level; hazards animate by swapping tile frames |
| `hero` | `run.player`, `run.phase`, `run.phaseTicks` | Sprite 16 x 16 at `(x >> 8) - (16 - heroW_px) / 2`, `(y >> 8) - (16 - heroH_px)`; flip when `facing < 0`; frame from `frames.ts` (idle, run, jump, fall, thrust, die) |
| `hero.blaster`, `hero.pack`, `hero.flame`, `hero.fuelbar` | `hasBlaster`, `hasThruster`, `thrusting`, `fuel` | Overlays that follow the hero |
| `enemy:<i>` | `run.enemies[i]` | At `x >> 8`, `y >> 8`; visible while `alive`; flip by `dir` |
| `pickup:<i>` | `level.pickups[i]`, `run.taken[i]` | At its cell; visible while not taken; bobs 1 px in the view |
| `trophy` | `level.trophy`, `run.hasTrophy` | Visible until collected |
| `door` | `level.door`, `run.hasTrophy` | Locked frame, then the opening animation started by `doorOpened`, then open |
| `bolt` | `run.bolt` | Visible while `active` |
| HUD | `session.score`, `lives`, `levelIndex`, `hasTrophy`, `hasBlaster`, `hasThruster`, `fuel / phys.fuelTicks` | Pushed by the router after each tick |

Dying stages for the hero frame come from `run.phaseTicks` and `TUNING.timing`: hit stop for the first `hitStopFrames`, the break-apart animation for `deathAnimFrames`, then the fade out; the fade in runs during the first `fadeFrames` of the ready phase that follows `respawned`.

### 11.3 Event consumption

`EventRouter.drain(events, game)` (src/shell/EventRouter.ts) runs once per simulated tick. It calls `sfx.tick()` once, before that tick's sounds, and `effects.tick(game)` once; then it handles each event once, in order: one sound per event type (table in section 7), vibration (`playerDied`, `trophyCollected`, `fuelEmptied`), particles and flashes through `Effects`, HUD pushes, and what the Play scene itself must do (rebuild on `levelStarted`, snap on `respawned`, the hit stop on `enemyKilled`, the airlock's animation on `doorOpened`); then `applyEvents` for the save, written only when it changed; last, the scene change on `gameOver` or `gameWon`, at most once per router and after the save was written. Every target is an interface, so the routing is unit-tested in Node (`EventRouter.test.ts`). **New best.** When a session is created the router remembers `previousBest = save.bestScore`. `EndScene` is started with `{ score, previousBest }` and shows `NEW BEST!` when `score > previousBest`, otherwise `BEST` with `max(previousBest, score)`. It must not compare with `save.bestScore`: `applyEvents` has already raised it (at the last death, 52 ticks before `gameOver`; at the last level's `levelCompleted`, 60 ticks before `gameWon`, and again at `gameWon` before the win screen is built). A session that is never saved (a development room, the test hook) has `previousBest = null` and its end screen shows no best line.

Things that last are read from state every frame instead of from events: the thrust loop plays while `run.phase === 'playing' && player.thrusting`; the low-fuel beep while thrusting at 20 % fuel or less; FIRE and THRUST buttons are shown while `hasBlaster` / `hasThruster`, FIRE dimmed while `bolt.active`, THRUST dimmed while `fuel === 0`.

### 11.4 Camera

`stepCamera(prev, target, view, level, TUNING.camera)` is pure, in art pixels, stepped once per simulation tick; `snapCamera` gives the resting position and is used on `levelStarted` and `respawned`. The scroll set on Phaser's camera is the rounded result; `startFollow` is never used.

- Horizontal: the hero sits `camLookAheadPx` behind the view centre on the side opposite to `facing`. The look-ahead slides toward the facing side at `camLookShiftSpeed` px per tick only while `vx !== 0`. Around that anchor is a dead zone of `camDeadzoneHalfW` px each way; beyond it the camera moves by exactly the overshoot (no smoothing).
- Vertical: while `onGround` the feet line eases toward `camAnchorY` of the view height by `camVerticalEase` of the remaining distance per tick. While airborne the camera holds unless the hero leaves the band from `camAirBandTop` to `camAirBandBottom`, then it follows rigidly.
- Bounds: clamped to the level; a level smaller than the view on an axis is centred on that axis. On a touch screen (touch mode on) the horizontal bound is widened by just enough to draw the hero's sprite clear of the pad's drawn buttons (`PadReach`: how far LEFT and RIGHT, and JUMP, FIRE and THRUST, reach into the view, in art px, measured from the pad's layout each frame; FIRE and THRUST count whether or not held, so a pickup never moves the view). The bound only lets the camera past a side wall, never pushes it: away from the walls nothing changes, and the widened bound moves with the hero's whole pixels, so the view never jumps and the hero never shimmers. Space and stars show beyond the wall (`docs/ART-AND-SOUND.md` section 8: "the lower corners belong to the thumbs"). Without it a hero who starts one to three tiles from a wall stood under RIGHT on most phones, and the airlock by a right wall lay under JUMP.

### 11.5 View size

`chooseView(cssW, cssH, dpr, safe, TUNING.view)`: `dw = floor((cssW - safe.left - safe.right) * dpr)`, `dh = floor(cssH * dpr)`; `zoom = max(1, min(floor(dw / (viewMinCols * 16)), floor(dh / (viewMinRows * 16))))`; `viewW = min(floor(dw / zoom), viewMaxCols * 16)`, `viewH = min(floor(dh / zoom), viewMaxRows * 16)`. The canvas is `viewW` by `viewH` game pixels, shown at `zoom / dpr`, centred inside the horizontal safe area; the page background is the palette's darkest colour. Recomputed on resize, rotation and pixel-ratio change.

**Size on the glass.** One art pixel is `zoom / dpr` CSS px. With the whole screen height that is 2 CSS px or more on phones (568 x 320 at ratio 2: zoom 4, 2.0; 740 x 360 at 2.75: zoom 6, 2.18). In a browser tab the toolbars take height and the whole-number zoom drops a step: 740 x 304 gives zoom 5 (1.82), 740 x 280 gives zoom 4 (1.45), 568 x 232 gives zoom 2 (1.0, and the view grows to its 30 x 14 cap). Ruling R11 fixes the zoom rule, so the shell does three things about it:
- **Fullscreen.** The first tap on the title (the same `pointerup` that unlocks audio) calls `game.scale.startFullscreen()` when touch mode is on, `game.scale.fullscreen.available` is true and the page is not inside a frame (`window.self === window.top`). A refusal is ignored. iPhones have no fullscreen for web pages: there the full height comes from adding the game to the home screen.
- **Menus are sized in CSS px.** `menuLayout(viewW, viewH, zoom / dpr)` (pure, `src/shell/menuLayout.ts`) makes every tappable menu row `max(22, ceil(44 * dpr / zoom))` art px tall, so a row is at least 44 CSS px; the panel grows with its rows and is centred. If the rows do not fit the view height, the spacing gives way first (the gaps between items, then the panel's padding above and below, down to 1 px each); only then do the rows share the height evenly, never below 22 px: that happens only in the most extreme window computed (568 x 232 at ratio 2, zoom 2, where the pause menu's rows come out about 43 CSS px). Small switches drawn as 12 px sprites (sound on the title, sound and buzz in the pause menu) get an invisible hit area of at least 44 CSS px, centred on the sprite.
- **Large text where the pixels are small.** A glyph is 5 x 7 art px, so 10 x 14 CSS px at 2.0 but only 5 x 7 CSS px (about a millimetre on the glass) at 1.0, inside buttons 44 CSS px tall. Where one art px is under `LARGE_TEXT_BELOW` (1.5) CSS px, `menuLayout` draws every 1x line, button label and switch label at 2x (`MenuLayout.textScale`) if the whole menu still fits the view with 44 CSS px rows, else 1x; `introLayout` does the same for the card's name and hint, line by line where each fits across. The top bar stays 1x (it must fit the narrowest view). Decided here, where the owner's playtest question was left open: SPEC asks for a game played on a phone, and a millimetre-high label in a short browser tab is not readable. Above 1.5 CSS px nothing changes.
- **Corners and edges.** The top bar's outer items and the title's sound switch keep 16 CSS px from the glass's side edges where the canvas starts closer than that (Android reports no inset for rounded corners; `cornerClearPx` in hudModel.ts). The rotate message is drawn at up to 3 CSS px per art px, smaller in a narrow portrait window, 8 CSS px from each side (`rotateDevicePerArt`), redrawn on resize.

The device table of the `chooseView` test holds the rows of `docs/PHASER4-NOTES.md`, section 6, including the three short windows above.

### 11.6 Test hook

Installed only when the URL has `?e2e=1` or in a dev build (src/shell/e2eHook.ts, loaded as its own chunk, so a normal visit does not download it):

```ts
interface E2EHook {
  /** null before the first level is played. Positions in sub-pixels; mode is the Play scene's (11.1). */
  state(): { status: SessionStatus; levelId: string; levelIndex: number; phase: RunPhase; tick: number;
             score: number; lives: number; player: { x: number; y: number; vx: number; vy: number; onGround: boolean };
             hasTrophy: boolean; mode: 'intro' | 'running' | 'paused' | 'ended' } | null;
  /** The buttons held now: controls.held() of the one Controls the keyboard and the pad write to. */
  held(): Input;
  /** Starts a one-level session that is never saved. id: 'level-01' ... 'level-10', 'test', 'debug'. */
  startLevel(id: string): void;
  /**
   * Starts the level fresh and feeds the script through the same step(), ticksPerFrame ticks per rendered frame.
   * A list of ids plays those levels as one session. Options: stopAtTick (stop once run.tick reaches it, for a
   * picture), until: 'sessionEnd' (go on through deaths, level changes and the End screen).
   */
  replay(id: string | readonly string[], script: InputScript, ticksPerFrame?: number,
         options?: { stopAtTick?: number; until?: 'levelCompleted' | 'sessionEnd' }): Promise<ReplayResult>;
  /** src/audio/offline.ts's renderEffect, unchanged. */
  renderEffect(what: string | readonly string[]): Promise<EffectRender>;
  /** game.pause() / game.resume(), for a screenshot that must not move. */
  freeze(on: boolean): void;
  /** The Play scene steps exactly this many frames per rendered frame from the controls; null: the real stepper. */
  pace(framesPerRender: number | null): void;
  /** Resolves with run.tick once it reaches `tick`, the game frozen at that moment (checked on every POST_RENDER). */
  freezeAtTick(tick: number): Promise<number>;
  /** The running scenes' keys, in draw order. */
  scenes(): string[];
  /** The buttons and switches of the menu on screen, with where to tap them in page CSS px. */
  menu(): { label: string; focused: boolean; x: number; y: number; w: number; h: number }[];
  /** The audio's state: 'none' before the first gesture, then the context's; muted; effects started. */
  sound(): { state: string; muted: boolean; plays: number; thrusting: boolean };
  /** What the HUD shows: the intro card's lines, the toast, the banner's heading, whether its clocks are held (paused). */
  hud(): { intro: readonly string[]; toast: string | null; banner: string | null; held: boolean } | null;
  /** Listeners on each scene's own `sys.events`, by scene key: the same after many visits as after one. */
  listeners(): Record<string, number>;
  /** The hero's 16 px sprite as last drawn, in page CSS px: clear of the pad's buttons at a side wall (11.4). */
  heroOnPage(): { x: number; y: number; w: number; h: number } | null;
}
declare global { interface Window { __E2E__?: E2EHook } }
```

**Real input on given ticks.** `e2e/rooms.spec.ts` and `e2e/touch.spec.ts` also win the two rooms with real key presses and real touches on the pad, on the same ticks as Node. A key or a touch sent by the test reaches the page a few milliseconds after the test decides to send it, and a loaded machine runs several ticks in one frame, so neither can be aimed at a tick by timing alone. The tests therefore set `pace(1)` (one tick per rendered frame, the input still from `Controls`) and, for every run of the script, `freezeAtTick(t)`, change the keys or fingers while the game stands still, and `freeze(false)`. Nothing else differs from a player's input: the keys go through Phaser's keyboard plugin and `installKeyboard`, the touches through the pad's Pointer Events. The game itself never uses either member.

During a replay the scene takes its input from the script (`inputAtTick`) instead of `Controls`, bypasses the stepper (a fixed number of ticks per frame, so timing cannot change the result), shows no intro card and holds no hit stop, and still draws, plays and routes events normally. By default it stops as `replayScript` does in Node: at `levelCompleted`, at the first death, or at the end of the script. `e2e/rooms.spec.ts` replays the two rooms' scripts this way and gets the same `trophyTick` and `winTick` as `src/core/rooms.test.ts` in Node; `e2e/replay.spec.ts` (Phase 4) does the same with level 1's validator script. Other URL switches: `?level=test`, `?level=debug` (any level id: that room at once, never saved), `?touch=1` (force the touch pad and let the mouse drive it).

### 11.7 Offline app (Phase 5)

Ruling R18: a hand-written manifest and service worker, no library. **As built** (24 November 2026). Built and run in Phase 5 on a scratch build (Vite 8.3.8, the headless Chromium of Playwright 1.63). Where the build differs from the design, the difference and its reason are marked "Differs" in place.

**Build step.** Two things cannot be written by hand in advance: the bundle's file name carries a hash (`assets/index-<hash>.js`), and the game's name and id may be spelled only in `src/meta.ts`. So the `offline-app` plugin in `vite.config.ts` (no dependency) adds the app's files to the bundle. Its `generateBundle` hook is ordered `post` and the plugin is `enforce: 'post'`, so it sees every file as it will be written (`index.html` included). The work is done by the Node-only helpers of `src/pwa/build.ts`; the unit test and the browser test call the same helpers, so they check exactly what the build makes. The plugin emits:
- `manifest.webmanifest` from `src/pwa/manifest.template.json`: `name` = `GAME_TITLE`, `short_name` = its first word, `id` = `GAME_ID`, `start_url` and `scope` = `./`, `display` = `fullscreen` with `display_override: ["fullscreen", "standalone"]`, `orientation` = `landscape`, `background_color` and `theme_color` = the palette's `void` (`#0b0d1a`), and the four icons of `docs/ART-AND-SOUND.md` section 11, with relative URLs. **Differs:** the design said `id` = `./`. A browser resolves `id` against the start URL's *origin*, not against the manifest's folder. Chromium's own reading (CDP `Page.getAppManifest`) of a build served at `/deep/sub/` gave the id `http://127.0.0.1:<port>/`. On GitHub Pages that would be `https://<owner>.github.io/`: the same identity as any other app on the owner's shared origin that writes `./` or `/`. `GAME_ID` resolves to `https://<owner>.github.io/moon-foundry`, which belongs to this game alone. It is also as permanent as the save keys, and both must never change once players have the game.
- The four icons, drawn at build time from the `icon` grid of `src/art` (enlarged by a whole number and centred on `night`) and written by `src/art/tools/png.ts` with Node's own `zlib`. **Differs:** the design planned `scripts/make-icons.mjs` and committed PNG files. Drawing them in the plugin keeps one source, the grid: no binary is committed and none can drift from the art. The row for `src/pwa/` in section 2 still names the script.
- `sw.js` from `src/pwa/sw.template.js`, with three quoted placeholders filled in (each must appear exactly once, or the build fails). `CACHE_PREFIX` = `` `${GAME_ID}-` ``. `PRECACHE` = `./` plus the path of every emitted file except `sw.js`, sorted. `VERSION` = 16 hex digits of a SHA-256 of the worker template, that list and every listed file's bytes. **Differs:** the design had two placeholders. The cache prefix is the third, so that `GAME_ID` is still spelled only in `src/meta.ts`. The template is hashed too, so a change to the worker alone also gets a fresh cache.
In the dev server the plugin also serves the manifest and the icons, so the page's links resolve; there is no worker in development.
A build emits `index.html`, `assets/index-<hash>.js` and `.css`, the lazy chunks (the test hook and the offline sound renderer), `manifest.webmanifest`, the four icons and `sw.js`. In the build of 24 November that made 11 `PRECACHE` entries counting `./`, 1.64 MB in all, nearly all of it Phaser.
`index.html` has `<link rel="manifest" href="./manifest.webmanifest">`, `<link rel="icon" type="image/png" sizes="192x192" href="./icon-192.png">` (the tab icon) and `<link rel="apple-touch-icon" href="./apple-touch-icon.png">`, all relative, beside the `theme-color` meta.

**The worker** (`sw.template.js`, plain JavaScript, no imports; JSDoc types describe the few worker-scope members it uses, so the project's type check and lint cover it):
- `install`: open the cache `${GAME_ID}-${VERSION}@<folder>` (the folder is the scope's path, such as `/SmartInvest/game/`; see `activate`), `cache.addAll` on the `PRECACHE` entries, check the stored page (below), then `skipWaiting()`. On a first visit the page's files are fetched before any worker controls the page. `addAll` fetches them again, which is what makes the second visit work offline without a reload in between. **Differs:** each request is made with `cache: 'no-cache'` rather than "normally from the HTTP cache". The browser asks the server whether each file is current, and an unchanged file costs only a 304. Without this, a stale `index.html` kept in the HTTP cache (GitHub Pages usually lets a browser keep files for 10 minutes; not checked here) could be stored beside a new build's files and name chunks that no longer exist. The update test serves the build with `max-age=600` and an ETag, as Pages does, so that dropping `'no-cache'` fails there too.
  **Added after review (24 November):** then each stored page (`./` and `index.html`) must name, in its `src="./…"` and `href="./…"` attributes, only `PRECACHE` entries. During a deploy a server, or a CDN in front of it, may still return the previous `index.html` beside the new `sw.js`. The first build stored that page, served it cache-first on every start, and its scripts were in no cache and no longer on the server: a probe showed the game blank, online and offline, until the next deploy. On any failure (that check, a file the server lacks, no network, no room left) the new cache is deleted and the install fails: the old version keeps running, and the browser tries the new worker again on a later start. A refill (see `fetch`) follows the same steps, with one difference **added after the re-check (24 November):** `cache.addAll` stores all or nothing, so when it fails the files already in the cache stay as they were. A failure therefore deletes the cache only if this install or refill created it, or if the page check failed (`addAll` had just stored that page over the cache's own). So the game's cache only ever holds files of its own build: complete after an install; if something deletes single entries, the files left still start the game offline, and the next start online completes it. **Differs:** the first refill deleted the cache on any failure, even the cache that very start was being served from. A probe deleted one icon from the cache and reloaded twice with the network off: the first start never became ready (the cache vanished before the main script was read) and the second did not load at all, where the build before refills started both times. After the change both offline starts work and the cache keeps its 10 other files. With a quota set 100 kB above the usage, the online refill also failed for want of room and the 10 files stayed, so the next offline start worked.
- `activate`: delete every cache whose name is `${GAME_ID}-`, hex digits only, then `@` and this folder, and is not the current one, then `clients.claim()`. Only its own caches: on GitHub Pages every project of one owner shares one origin, so caches of other sites live beside the game's. **Differs:** the design matched the prefix alone, which would also delete the caches of a site whose id merely starts with this one (`moon-foundry-ii-…`). **Added after review:** the folder ends the name so that a copy of the game in another folder of the same origin (a test copy, or the game after a move) keeps its cache. When the names had no folder, a probe showed a second copy's activation deleting the first copy's cache, which then failed offline.
- `fetch`: only `GET` requests for the build's own files, that is addresses that are a `PRECACHE` entry once the query is removed. Every other request gets no answer from the worker, so the browser handles it untouched, as without a worker: another address in the game's folder (a mistyped link gets the server's 404), the site's root, other projects. Cache first, from the game's own cache only: `caches.match` with `cacheName`, which neither searches the origin's other caches nor creates the cache when it is missing. The match uses `ignoreSearch: true`, so that `?level=test` and `?e2e=1` also work offline, and `ignoreVary: true`, because the cache holds one copy of each file whatever `Vary` the server sends (`vite preview` sends `Vary: Origin`). A miss goes to the network. A navigation also checks, in `waitUntil`, that the cache holds every `PRECACHE` entry; if not, it fills the cache again as `install` does (the page checked; when the refill fails, the files already in the cache stay, see `install`). Another site on the origin may delete the game's cache: many workers delete every cache but their own when they activate.
  **Differs (after review, 24 November):** the first build sent a navigation the cache missed to the cached `./`. From a deeper address (`/game/levels/3`) that page's relative URLs pointed into the wrong folder, so a probe showed a blank page with two 404s, online too, where the server's 404 would have been. A game served at an origin's root (as `vite preview` serves it) also answered every page served later on that host and port. And the fetch handler opened its cache with `caches.open`, which re-created a deleted cache empty, so the game ran online but never offline again until the next deploy.
- A new build has a new `VERSION`, so it installs beside the old cache and replaces it on activation. The browser looks for a new `sw.js` when the game is started. That start still runs the old build from the cache, and the start after it runs the new one. Version 1 shows no update prompt.
- **Rule: no script that players need may load later than the start** (a lazy chunk). The new worker takes over open pages (`skipWaiting`, `clients.claim`) and deletes the old cache, so a tab left open on the old build could no longer load such a chunk: it is in neither cache and no longer on the server. A probe showed exactly this for the old tab's import of the offline sound renderer. Today the only lazy chunks are the two test-only ones of 11.6, and `e2e/offline.spec.ts` fails if another appears. Splitting the game into chunks (the build warns that the main chunk is over 1,600 kB) needs this design changed first, for instance by keeping the previous cache for one more version.

**Registration** (`src/shell/pwa.ts`, called from `main.ts` on the line after `new Phaser.Game`), as designed: only in a production build (`import.meta.env.PROD`); never inside a frame (`window.self !== window.top`); the whole function is wrapped in `try / catch`, because in a sandboxed frame merely reading `navigator.serviceWorker` throws, as `localStorage` does; `navigator.serviceWorker.register('./sw.js')` with a relative URL, so the scope is the game's own folder and the worker never sees the root site's requests. A failed registration is ignored: the game then simply needs the network. Without service workers (a page that is not a secure context) it does nothing. `registerServiceWorker(host = window, production = import.meta.env.PROD)` returns which of these happened, for the unit test; `main.ts` ignores the answer.

**Shared origin.** Storage keys already start with `GAME_ID` (section 10). Cache names do too and end with the game's folder: only caches named `${GAME_ID}-<hex>@<this folder>` are ever deleted. The worker's scope is the game folder, and it answers only the build's own files. The game cannot stop another site on the origin from deleting its cache, but the next start online fills it again. Two things are shared by every copy of the game on one origin: the save (its keys are fixed by `GAME_ID`) and the manifest's `id` (`<origin>/moon-foundry`, see the build step), so a browser takes two copies in two folders for one app. One copy per origin is the intended case.

**Tests** (Phase 5 exit check), all passing on 24 November 2026 against a scratch build served on port 4511. The whole browser suite of that day (70 tests) also passed on a scratch build with the worker registered, so a worker in every production test page disturbs none of them. After the review fixes the same day, both specs (9 tests) and `e2e/smoke.spec.ts` passed again on a scratch build served on port 4531. After the re-check fix, both specs (10 tests, and 40 when run four times over in parallel) and `e2e/smoke.spec.ts` passed on a scratch build served on port 4533:
- `src/pwa/build.test.ts` (31 cases since the re-check fix) runs the plugin's `generateBundle` on a fake bundle. It checks every manifest field above and that the icons' stated sizes are the sizes their PNG files really have. It checks the worker's prefix, its `PRECACHE` (`./` and every emitted file but `sw.js`, nothing twice, all relative) and its `VERSION`: the same for the same files, and new when one file changes or one is added. It also runs the built `sw.js` in a stand-in worker scope (`node:vm`) with a stand-in network. Install: the cache named for the version and the folder, every request `'no-cache'`; a page of another build refused at `./` and at `index.html`, the new cache deleted, no takeover; a page naming its own files with a query accepted; no empty cache left when storing fails for want of room, for a missing file or with the network off. Activate: other sites' caches kept (among them `moon-foundry-ii-0123`), and so are other folders' copies of the game. Fetch: the build's own files from the cache, the query ignored; every other address left to the browser, deeper ones in the folder included; with the cache deleted, files come from the network without creating a cache, the next navigation fills it again, offline nothing is left behind, and a refill that meets a page of another build is dropped, also when the cache was there before. A cache that lost one file and cannot be refilled (network off, no room, a file missing on the server) keeps the files it has, and the next start comes from it. Finally it decodes each icon pixel by pixel, as in `docs/ART-AND-SOUND.md` section 11. `src/shell/pwa.test.ts` (6 cases) gives registration stand-ins for `window` and `navigator`.
- `e2e/offline.spec.ts`, on the configured server:
  - It waits for `navigator.serviceWorker.ready`, a scope of the game's folder, exactly one cache named `${GAME_ID}-${VERSION}@<folder>` holding every `PRECACHE` entry, and a controlled page. Every script of the build that the start did not load must be one of the two test-only chunks (the rule above). Then it switches the context offline, reloads and expects the title, every response from the worker and no failed request. It then opens `./?level=test&e2e=1` offline and the movement room runs: since the worker answers no other address, only `ignoreSearch` finds that page. Finally, `fetch` of a file outside the build fails, which proves the network really was off.
  - The update test serves `dist/` itself (`src/pwa/serveBuild.ts`) as GitHub Pages does, with `max-age=600` and an ETag. It first checks that the build's `sw.js` equals what `src/pwa/build.ts` makes from the files as written. The second build renames every file under `assets/` (as new hashes would) and marks the page. First the deploy is seen half-done: the second build's files and worker are live and the first build's assets are gone, but the server still returns the first build's `index.html`. The new worker fetches its files, refuses that page and leaves no cache, and the first build keeps running. Then the deploy completes. The next start still shows the first build while the new worker installs, after which only the new cache of the game is left, and three other sites' caches (`smartinvest-charts-v3`, `moon-foundry`, `moon-foundry-ii-0123`) keep their entries. With the server shut down, the start after that shows the second build, from its renamed script.
  - Another site at `/SmartInvest/` beside the game at `/SmartInvest/game/`. Addresses in the game's folder that are not its files (`levels/3`, `nested/page/`, `play`) get the server's 404, not from the worker. The root page deletes every cache but its own, the game's included. The next start online fills the game's cache again, and the start after that works offline.
  - A cache that lost one entry (`icon-512.png`, which a start does not load), with the game at `/SmartInvest/game/`: two starts with the network off both work, and the cache still holds its other 10 files after each; the next start online completes it.
  - Two copies of the game, different builds, at `/a/` and `/b/` of one origin: both caches stay, and each copy starts offline with its own build.
- `e2e/subpath.spec.ts` serves `dist/` under `/deep/sub/` on a free port (`src/pwa/serveBuild.ts` records every path asked for). The same boot follows on WebGL, the worker's scope is `/deep/sub/`, and no request of the page or of the worker leaves `/deep/sub/`. With the server shut down, the next visit starts. Inside a frame and inside a sandboxed frame (host page on the same origin) the game boots, `sw.js` is never even requested, no registration exists and nothing throws. Two more tests read the manifest there, at `/deep/sub/`, because at the origin's root (where the configured server serves the build) an address such as `/icon-192.png` would pass for `icon-192.png`:
  - The manifest test fetches the manifest and parses it, loads each icon and the tab and apple-touch icons, and decodes each at its stated size. It reads Chromium's own view through CDP `Page.getAppManifest`: no errors, and the name, `id`, start URL, scope, display, display override, orientation, colours and the four icons as written, all inside `/deep/sub/`.
  - The installability test asks the full Chromium (Playwright's `channel: 'chromium'`, installed with the headless shell by `playwright install chromium`) in a profile on disk, through CDP `Page.getInstallabilityErrors`. A page without a manifest gets `no-manifest`, which shows the answer is real; the game gets no errors.
- Both specs find the build in `GAME_DIST`, or by default in `game/dist`, which the project's own `npm run e2e` builds and serves.
- Each spec was also run against builds broken on purpose, and each failed where it should:
  - a worker that answers no fetch: the offline reload fails;
  - registration inside frames: the frame test lists a registration;
  - `/sw.js` instead of `./sw.js`: the sub-path test never gets a worker;
  - an `activate` that deletes every cache: the update test loses the other sites' caches.
- After the review fixes, each fix was undone on a scratch copy, one at a time, and a new test failed each time (the unit test as well, except for the lazy chunk):
  - no page check at install: the update test, at the half-done deploy (the new cache appears);
  - no refill on a navigation: the other-site test, which waits for the cache to be filled again;
  - the old fallback to `./` for a missed navigation, or answering every address in the folder: the other-site test, at `levels/3`;
  - caches of every folder deleted on activation: the two-copies test;
  - `ignoreSearch: false`: the first test, at `./?level=test&e2e=1` offline;
  - requests without `'no-cache'`: the update test, where the new build never installs (its page comes from the HTTP cache);
  - no deletion of a failed install's cache: the update test, at the half-done deploy;
  - absolute addresses in the manifest (`/`, `/icon-192.png`): the manifest test, and the installability test (`no-acceptable-icon`);
  - a script loaded on the first tap (a lazy chunk players need): the first test;
  - `caches.open` in place of `caches.match` with `cacheName` in fetch: only the unit test, because the refill hides the empty cache in a browser.
- After the re-check fix: a refill that deletes the cache on any failure (the worker from before the fix) fails the partial-cache test, run on the build from before the fix, at its first offline start, which never becomes ready; on a scratch copy with that one line restored, three unit cases fail. A refill that never deletes a cache that was there before fails the unit case of a page of another build.
- **Not verified:** nothing has run on a real phone, in Safari or in Firefox: no install prompt, no home-screen start, no aeroplane mode. Nor whether GitHub Pages' CDN can serve a new `sw.js` beside an old `index.html` during a deploy; the page check covers the case if it happens. (Before the review, this paragraph said `Page.getInstallabilityErrors` proves nothing. That is true only of the headless shell, which answers an empty list even for a page with no manifest; the full Chromium answers for real.)

**Known limits** (each seen in a probe on a scratch build, 24 November):
- An update needs room for the old cache and the new one together for a moment (about 3.3 MB today). With less room left for the origin (on GitHub Pages it is shared with every project of the owner), every start downloads the new build (1.6 MB), fails to store it and keeps the old build. A failed install deletes its new cache, so it leaves nothing behind. Probe with a quota of 2.6 MB: three starts, the old build each time, one cache, the new main script downloaded once per start.
- The address without its final slash (`/SmartInvest/game`) is outside the worker's scope. Online, GitHub Pages redirects it to `/SmartInvest/game/`; offline it does not open. A wider scope would need a `Service-Worker-Allowed` header, which GitHub Pages cannot send. The home-screen app and the link that `game.yml` prints both end with the slash.
- A game served at an origin's root (only `vite preview` and the tests do that) still answers that origin's `/` and `/index.html` with the game after another site is served there.
- A refill running when a new version activates could leave the old version's cache behind until the next update. Not seen; it needs the cache lost, a deploy and that timing together.
- If the game's folder disappears from the server (the game moved to another address, say), a returning visitor's browser keeps the worker: a 404 for `sw.js` does not remove a registration, so the old address keeps starting the old build from the cache, online too. A probe removed every file of the folder: the next three starts were all answered by the worker, the game became ready each time, and the registration was still active. Moving the game would need a last deploy at the old address whose `sw.js` deletes the game's caches there and unregisters itself; none is written or tried.

**Known limits on iPhones** (expected from the platform's documentation, not verified on a device; `docs/SPEC.md` tells the owner in plain words): a game added to the home screen has its own storage, separate from the same address opened in Safari, so progress does not carry over between the two. For the same reason its offline copy is its own: the home-screen game must be started once with the network on before it works offline. Safari may erase a site's stored data after seven days without a visit (home-screen apps are exempt); Web Audio is silenced by the ring/silent switch; there is no vibration, so the BUZZ switch does nothing there.

### 11.8 Shell modules as built

Section 2 lists the shell as it was planned. These modules were added while building it (all under `src/shell/` unless a path is given); pure ones have a `*.test.ts` beside them:

| File | Kind | Responsibility |
|---|---|---|
| `freshKey.ts` | Pure (fake keyboard in its test) | `onFreshKey`: a key acts once per keyboard event (Phaser replays a frame's queue; auto-repeat never counts) |
| `sceneEnd.ts` | Pure (Node emitter in its test) | `onSceneEnd`: a scene's cleanup once on `shutdown` or `destroy`, the other listener removed (11.1) |
| `fxModel.ts` | Pure | Effects as numbers: the shake, the fade, flashes, pop-ups and the airlock pointer, from events and ticks |
| `hitStop.ts` | Pure | The hold after a kill (`killHitStopFrames`); disabled in a replay |
| `hudModel.ts` | Pure | The top bar as numbers: what it shows, where (`topBarLayout`, the PAUSE reserve, the corner clearance), its clocks (`FrameClock`, held under the pause; score count, life blink, pip blink) |
| `viewModel.ts` | Pure | Draw positions in whole pixels: the hero's sprite and overlays, enemies, pickups, the mini fuel bar |
| `screens.ts` | Pure | Layouts of the intro card (2x name and hint where the pixels are small), the level-clear banner, the end screens' lines, the title's scenery, the shutter blades, the canvas's accessible name |
| `screenText.ts` | Pure | Every fixed line the screens draw at its scale, for one test of glyphs and widths; the rotate message's size (`rotateDevicePerArt`) |
| `scenes/menu.ts` | Phaser glue | The canvas menu of Title, Pause and End, drawn at `menuLayout`'s rectangles and text scale; touch, mouse and keyboard |
| `scenes/sessions.ts` | Pure | What the title offers (CONTINUE, NEW GAME, the test rooms when there is no campaign) and what TRY AGAIN starts |
| `scenes/strings.ts` | Pure | Every word the screens show (`TEXT`), shared with main.ts's rotate message |
| `lifecycle.ts` | DOM | Touch mode (`keyEndsTouchMode`: Cmd, Ctrl and Alt do not end it; the touch that turns it on is handed to the pad) and the rotate guard |

Browser specs beside those of section 2:

| Spec | What it proves |
|---|---|
| `e2e/screens.spec.ts` | Every screen and menu as a player drives it: title, intro card, top bar (nothing white or gold along the bottom: LEVELS.md rule 11), pause by every route, menu text shadows over the panel, the rotate message's width, end screens |
| `e2e/save.spec.ts` | The save rules of section 10 in the browser: CONTINUE, NEW GAME, the best score, TRY AGAIN's level |
| `e2e/look.spec.ts` | Screenshots of the debug room's replay, frozen with the hero in the air: not blank, pixel-exact (every art pixel a uniform block of device pixels), the hero on the whole pixel the core gives |
| `e2e/audio.spec.ts` | Every sound rendered offline in a real browser (`renderEffect`) and checked by numbers: not silent, not clipping, as long, as loud and sounding as section 12 of ART-AND-SOUND says; in the game, audio starting on the first tap and the M key |
| `e2e/pause.spec.ts` | Keys held through the pause (with auto-repeat) never open the ready gate; RESTART LEVEL from the intro card; the HUD's toast and banner outlast a pause; scene listener counts stay flat over visits |

## 12. Tests

**Which numbers a test runs on.** Decided once, here:

- **Rule tests run on the reference tuning.** `src/core/testkit.ts` exports `REFERENCE_TUNING`: a frozen copy of the eleven core groups (`hero` to `score`) as they were when the golden numbers of sections 4 and 13 were measured, with the shell-only groups taken from `TUNING` (`compileTuning` ignores them). `REFERENCE_PHYS = compileTuning(REFERENCE_TUNING)`. Every test of a rule (`movement`, `jump`, `thruster`, `enemies`, `bolt`, `contact`, `flow`, `determinism`, the validator's fixtures, the tables in `limits`) uses it. Golden numbers such as "apex 13472 on tick 21" or "52 + 22 ticks" therefore belong to the fixture, and an owner's change to `src/tuning.ts` cannot break them. Where a rule is about a tuning field the test is also written against the field (`phys.coyoteTicks`, not 6).
- **Four tests read the live `TUNING`**, and each fails with a message the owner can act on: `src/tuning.test.ts` and the last case of `compileTuning.test.ts` (a number is unsafe; it is named), the first part of `src/core/limits.test.ts` (a whole-tile limit the levels are built on has moved; it is named), and `tests/levels.test.ts` (a level can no longer be proven; it is named).
- **Twin fields.** At the reference numbers several `Phys` fields are equal (`airAccel` and `airDecel`, `thrustAccel` and `groundDecel`, the fire, spike and enemy-touch insets, `startLives` and `maxLives`, ...), so a test on `REFERENCE_PHYS` alone cannot show which of two twins the code reads. `testkit.ts` therefore also exports `DISTINCT_PHYS`, in which every field is at least 2 away from every other (`compileTuning.test.ts` checks that), and each rule that reads a `Phys` field has a case on it as well: the one-tick results of run, air, jump, gravity and thrust, the four-side grazes of every kill box, touch box and the door, the bolt's box, speed, range and pay, the enemies' speeds, and the lives and waits of the game loop.
- `REFERENCE_TUNING` is test data, not a second home for feel numbers: no game code may import `testkit.ts` (`purity.test.ts` checks that). It is refreshed on purpose, together with the snapshots and the tables of section 13 and of `docs/LEVELS.md`, once the owner has accepted a tuning change. Until then `limits.test.ts` prints, without failing, the fields in which `TUNING` differs from it.

| File | Proves |
|---|---|
| `src/tuning.test.ts` | The owner's numbers are sane (finite, whole frames, speeds below half a tile, boxes with size). Live `TUNING` |
| `src/core/compileTuning.test.ts` | The table in section 3; every `Phys` field an integer; each unsafe value rejected by name; the live `TUNING` compiles |
| `src/core/purity.test.ts` | The source rules of section 1 that lint does not enforce, by scanning the files of `src/core` |
| `src/core/level.test.ts` | Legend, header parsing, 0-based cells, every message in section 8 and the order of checks |
| `src/core/movement.test.ts` | Run-up 6 ticks and 5.25 px, stop 4 ticks and 2.25 px, reverse 9 ticks, air stop 8 ticks; flush wall snap; solid level edges |
| `src/core/jump.test.ts` | The golden numbers of section 4; cut on release; coyote: a press on airborne ticks 1 to `coyoteTicks` jumps, on tick `coyoteTicks + 1` it does not; buffer: a press `jumpBufferTicks - 1` ticks before the touchdown tick jumps on the tick after touchdown, a press `jumpBufferTicks` before it does not; both at 0 still jump; corner nudge up to `cornerNudge`, bonk beyond; ledge catch up to `ledgeCatch` |
| `src/core/thruster.test.ts` | One fuel per burning tick; idle above the cap; cut on release and on empty; no periodic tap pattern climbs higher than holding; refill; packs reappear at 0 |
| `src/core/enemies.test.ts` | Cinderpeg turns at wall, ledge, hazard, edge; moth bounces on both axes; touch kills from every side |
| `src/core/bolt.test.ts` | Both directions; one at a time; fire buffer; wall, range (`boltRange / boltSpeed` ticks: 40), kill; score paid once per visit |
| `src/core/contact.test.ts` | Pickup outset; hazard graze (inset is safe, one more sub-pixel kills; coolant kills only when the feet are more than `coolantInsetTop + hurtInsetBottom` below the surface); pickup beats hazard on a tie; door inert without the trophy |
| `src/core/flow.test.ts` | Ready gate: the minimum; a control held since before the gate shut never opens it, however long; lifting and pressing opens it; a press made during the minimum opens it on the first tick after the minimum; the opening tick is simulated; a jump or fire pressed before the gate opened is not replayed. Death timeline (`dyingTicks` + `respawnReadyTicks`: 52 + 22); the respawn table; lives, `restartLevel`, `holdReady`; exit, next level, win bonus |
| `src/core/determinism.test.ts` | Same script twice gives identical state; a `cloneGame` copy tracks its original over random input (catches a forgotten field in `copyGame`, `readyArmed` included); state stays integral; golden end-state hash |
| `src/core/limits.test.ts` | Part 1, live `TUNING`, named assertions with the limit and the `docs/LEVELS.md` rule in the message: a 3-tile step can be climbed and a 4-tile step cannot; a level 4-tile gap can be jumped and a 5-tile gap cannot; a walking hero falls into a 1-tile hole; THRUST held climbs at least 6 tiles and crosses a level 8-tile gap under a roof 2 tiles up, both also under the handicap. Part 2, `REFERENCE_PHYS`, snapshots: the jump-window, hazard-bed, small-pad and thruster tables of section 13 (about 10 s). The documents quote these snapshots |
| `src/core/save.test.ts`, `script.test.ts` | Reducers; corrupt input falls back; script packing round trip |
| `src/core/validate/*.test.ts` | Small fixtures: each verdict (`no-route` included), `stuckAt`, a tampered script fails replay, a pack-free level that needs the map and the guided search, and the gate fixtures of 9.6: three decks with coolant set into the deck floors (proven quickly; not proven if hazards are passable in the flood fill) and the open hall |
| `tests/levels.test.ts` | Section 9.6. Live `TUNING` |
| `src/shell/*.test.ts`, `src/input/*.test.ts` | `chooseView` over the device table (short browser-tab windows included), `menuLayout` (rows at least 44 CSS px on every device row where the menu fits the view, and never below 22 art px), `stepCamera`, `FixedStepper` (30, 60, 90, 120 Hz give the same tick count over time), `lerpPx` and the interpolation gate, `layoutControls` and `hitTest` properties, `Controls` latch |
| `src/pwa/build.test.ts` | The offline app's build step (11.7). The plugin's output for a fake bundle: the manifest's fields, icon sizes as the PNG files really are, the worker's prefix, precache list and version (unchanged for the same files, new when a file changes or is added). The built worker's install, activate and fetch in a stand-in worker scope and network: a page of another build refused and no cache left by a failed install; other folders' and other sites' caches kept; only the build's own files answered, the query ignored; a deleted cache filled again on the next navigation, never re-created empty; a cache that lost a file and cannot be refilled keeps the files it has. Each icon decoded pixel by pixel: palette colours only, whole-number blocks of the `icon` grid, the maskable one inside its safe circle |
| `src/shell/pwa.test.ts` | Registration (11.7) with stand-ins for `window` and `navigator`: `./sw.js` in production at the top level; nothing in development, in a frame (sandboxed or not), or without service workers; never throws (a throwing getter, a throwing or rejected `register`) |

The browser tests are listed in section 2.

## 13. Derived limits

Measured at the reference tuning (section 12) with throwaway integer models of sections 3 to 6. Two such models were written independently and agreed tick for tick over a million random ticks, and every number below was produced by one and checked on the other where a reviewer disputed it. `src/core/limits.test.ts` reproduces the tables through the real core; where the real core disagrees with a number here, one of the two is wrong and both get fixed. It reproduces every row of the Movement and Thruster tables, the jump-window, small-pad and thruster press-window tables and the hazard beds, cell for cell (the other rows of Hazards and of Blaster, enemies, timing are asserted by `contact`, `bolt`, `enemies` and `flow` tests); doing so fixed two entries (the thruster press window for 7 tiles under open sky, and the terminal-fall row, which said which of two figures it meant). "Handicap" is the comfort proof's tuning: no coyote time, no jump buffer, run and jump x 0.95, fuel x 0.9.

### Movement

| Quantity | Value |
|---|---|
| Run speed | 1.5 px/f = 5.6 tiles/s; full speed after 6 f (5.25 px) |
| Stop from full speed | 4 f, 2.25 px on the ground; 8 f, 5.25 px in the air; full reverse 9 f |
| Full jump | Apex 52.625 px = 3.29 tiles on tick 21; 41 ticks in the air; 13 ticks within 4 px of the apex. Handicap: apex 47.625 px = 2.98 tiles |
| Jump by hold, frames: apex in tiles | 1: 0.43, 2: 0.73, 3: 1.01, 4: 1.27, 6: 1.76, 8: 2.18, 10: 2.54, 12: 2.84, 14: 3.07, 18: 3.25, held: 3.29 |
| Largest step-up | 3 tiles (minimum hold 3 f for 1 tile, 7 f for 2, 12 f for 3); 4 tiles is impossible. Under the handicap the 3-tile step needs a 14 f hold and exists **only through the ledge catch**: the apex is 0.375 px short of 3 tiles, and with `ledgeCatchPx` 0 no hold climbs it |
| Longest level gap | How far the hero's right side is past the take-off edge at the last moment a landing at the same height is possible, best alignment, ledge catch included: 79.0 px with coyote time, 73.0 px without (71.5 px without the ledge catch too); handicap 67.0 px. So 4 whole tiles (64 px) at a run, never 5 (80 px) |
| The same from a standing start | 68.2 px with the body hanging over the edge as far as it can, 58.2 px with the toes on the edge (handicap 62.7 px and 52.7 px): 3 tiles without a run-up, 4 only by hanging over the edge |
| A hole 1 tile wide | Always swallows a walking hero; it is the smallest real pit |
| Fall | Terminal 4 px/f after 10 f. Walking off at full speed drifts 12.75 px while dropping 1 tile, 18.75 px for 2, 24.75 px for 3, 36.75 px for 5 |
| Headroom | The 14 px hero walks through a corridor 1 tile high; a ceiling corner clipped by 4 px or less is slid past |

### Jump timing windows

The hero runs at full speed toward the edge with the direction held; jump is pressed on one frame and held. The window is the number of consecutive press frames that end with the hero standing on the far side, for the worst of every sub-pixel alignment of the run-up. Coyote time, the jump buffer and the ledge catch count when the tuning has them. Left number: shipped tuning. Right number: handicap. `any` means that walking off the edge with the direction held also lands; `-` means impossible.

| Landing | 1-tile gap | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 3 up | 29 / 21 | 19 / 10 | 8 / - | - | - | - |
| 2 up | 35 / 27 | 25 / 16 | 14 / 5 | 1 / - | - | - |
| 1 up | 39 / 31 | 29 / 20 | 18 / 9 | 7 / - | - | - |
| level | 43 / 35 | 33 / 24 | 22 / 13 | 11 / 2 | - | - |
| 1 down | any / any | 37 / 28 | 26 / 17 | 15 / 6 | 5 / - | - |
| 2 down | any / any | 41 / 32 | 30 / 21 | 19 / 10 | 9 / - | - |
| 3 down | any / any | any / any | 34 / 25 | 23 / 14 | 13 / 2 | - |
| 4 down | any / any | any / any | 38 / 29 | 27 / 18 | 17 / 6 | 6 / - |

The table assumes an unlimited landing area. Landing on a small pad with a deadly gap behind it is harder, because the hero must also stop. Policy: run at full speed, hold jump, let go of everything some frames after touching down.

| Gap, then a level pad, then a deadly gap | Let go at once | After 4 f | After 8 f |
|---|---|---|---|
| 2-tile gap, pad 1 tile wide | 16 / 17 | 12 / 13 | 8 / 9 |
| 2-tile gap, pad 2 tiles wide | 27 / 24 | 23 / 24 | 19 / 21 |
| 3-tile gap, pad 2 tiles wide | 22 / 13 | 22 / 13 | 20 / 13 |
| 3-tile gap, pad 3 tiles wide | 22 / 13 | 22 / 13 | 22 / 13 |

Design rule: a required jump has a shipped window of at least 10 f; ordinary jumps 18 f or more; a required landing pad is at least 2 tiles wide. A `-` on the right means the comfort proof cannot pass through that jump at all. A small number on the right does **not** stop the comfort proof: it finds 2-frame windows (9.6). The windows are enforced by the level's reviewer with these tables, not by the validator.

### Hazards and forgiveness

| Quantity | Value |
|---|---|
| Hurt box | 6 x 11 px inside the 10 x 14 px body |
| Sideways grace against spikes and fire | 5 px (the body's front edge is 5.25 px inside the cell when a walking hero dies) |
| Spike bed on level ground, running jump window (shipped / handicap) | 1 tile 27 / 24, 2 tiles 16 / 13, 3 tiles 6 / 2, 4 tiles impossible |
| Fire bed on level ground | 1 tile 25 / 22, 2 tiles 14 / 11, 3 tiles 4 / impossible: at most 2 tiles in a campaign level |
| Coolant | Kills when the feet are more than 7 px below the surface (7 px exactly is still safe); a pool behaves as a pit of the same width |
| Enemy touch box | 10 px square inside the 16 px body |
| Pickups | Collected from 2 px outside their tile; never through a wall |

### Thruster

A thumb cannot hold JUMP and THRUST together: the touch pad gives each finger one control and both buttons belong to the right thumb. Rows marked "keyboard" need both held at once and are never required by a level.

| Quantity | Shipped (80 f tank) | Handicap (72 f) |
|---|---|---|
| Climb, THRUST held from standing | 136.8 px = 8.55 tiles | 7.68 tiles |
| Climb, one thumb: JUMP held 15 f (handicap 14 f), 6 f to move the thumb, THRUST held | 179.0 px = 11.19 tiles | 10.00 tiles |
| Climb, JUMP and THRUST held together (keyboard; fuel starts burning on tick 15) | 187.3 px = 11.71 tiles | 10.52 tiles |
| Best possible climb from standing over every thrust pattern, no jump | 8.55 tiles: holding is optimal | |
| Level flight, THRUST held from the ledge, no jump, open sky | 11.95 tiles of gap | 10.40 tiles |
| The same under a roof 2 tiles above the ledge | 10.55 tiles | 9.16 tiles |
| Level flight, THRUST feathered (on whenever not rising), no jump | 14.95 tiles | 12.90 tiles |
| Level flight, JUMP and THRUST held together (keyboard), open sky; the hero rises 11.7 tiles on the way | 14.77 tiles | 12.54 tiles |
| The same under a roof 8 / 6 / 4 tiles above the ledge | 13.17 / 12.42 / 11.67 tiles | 11.21 / 10.49 / 9.87 tiles |
| Level flight, JUMP held, THRUST feathered (keyboard), open sky | 18.70 tiles | 15.93 tiles |
| Stopping a terminal-speed fall | The fall stops on the 11th tick of THRUST; the hero sinks 19.375 px (lowest after 10 f) | |
| Hover on a full tank, thrust whenever not rising | 148 f = 2.47 s, 54 % duty | 133 f = 2.22 s |

Flight figures are the best over the frame on which the manoeuvre starts. No exhaustive search over thrust patterns was run for level flight; 18.70 is the best simple policy found. What a level may ask for is set by how forgiving the start is. Press windows, in frames, for crossing a level gap with THRUST simply held and no jump (shipped / handicap), from a run-up of 7 tiles at full speed, worst of 16 sub-pixel alignments; "open sky" is 16 clear tiles. The thruster also saves a hero who has already walked off the edge, so these windows reach far back into the run-up: measured from a 4-tile run-up, the 7-tile open-sky window was cut off at the run's first tick (75 instead of 82).

| Gap | Open sky | Roof 4 tiles above the ledge | Roof 2 tiles above |
|---|---|---|---|
| 7 tiles | 82 / 63 | 59 / 44 | 51 / 36 |
| 8 tiles | 71 / 52 | 48 / 33 | 40 / 25 |
| 9 tiles | 60 / 41 | 37 / 22 | 29 / 14 |
| 10 tiles | 50 / 10 | 27 / - | 19 / - |
| 11 tiles | 39 / - | 16 / - | 8 / - |
| 12 tiles | - | - | - |

Design rule: ask for at most **6 tiles of climb or 8 tiles of level flight per tank**; 9 tiles of flight only where at least 4 tiles are clear above the take-off. (The earlier rule of 12 tiles rested on the keyboard-only figure with open sky above.)

### Blaster, enemies, timing

| Quantity | Value |
|---|---|
| Bolt | 4 px/f, 160 px = 10 tiles, 40 f; after a miss the next shot is 0.67 s away |
| Cinderpeg | 0.5 px/f: 32 f per tile, 1.9 tiles/s |
| Arc Moth | 0.75 px/f: 21.3 f per tile, 2.8 tiles/s. In a closed lane of 5 cells (4 tiles of travel) it takes 85 or 86 f from one turn to the next, the turn tick included, depending on the cell it starts in; it stops up to 0.5 px short of each end, because 0.75 px does not divide a tile |
| Death to control | 52 f dying + 22 f ready minimum = 74 f (1.23 s), then a press |
| Level clear pause | 60 f |
| View | 17 x 10 tiles at least, 30 x 14 at most |
| Level caps | 64 x 24 tiles, 16 enemies, 4 thruster packs (subject to the Phase 4 gate, 9.6) |

## 14. Decisions where the designs differed or were silent

| Topic | Decision |
|---|---|
| Tuning units | Px and frames with the feel design's names; `boltRangePx` replaces a bolt lifetime, so range does not change with bolt speed |
| Left and right together | The input layer sends the most recent; the core treats both as neither (no direction memory in the state) |
| Ready gate | Opens on a press, as ruling R4 says, not on a control still held from before (the feel design said "held"): `readyArmed` needs one tick with nothing held. The opening tick is simulated; a jump or fire pressed earlier is not replayed |
| Thrust cut | Skipped on a tick a jump starts and while the engine only idles, so a jump right after thrusting is not cut |
| Thruster pack with a full tank | Always collected |
| Arc Moth | Bounces off hazard tiles as well as walls and the grid edge |
| Enemy body | Exactly one tile for both kinds; a structural constant, not a tuning value |
| Falling out | Death when the box top passes the bottom edge of the grid |
| Lives on the last clear | The life is returned before the win bonus is counted |
| Lives timing | Removed when the dying phase ends; `playerDied` already carries `livesAfter` so the save cannot be cheated by quitting |
| Coordinates | 0-based everywhere a person reads or writes them; file line numbers are 1-based |
| Level headers | All optional to the parser; `;` comment lines allowed before the grid; the campaign test requires name, teaches, hardest |
| Validator budgets | Counted and asserted in `step()` calls (the core has no clock, and CI machines are slower than the build machine); wall time is printed, never asserted |
| Validator stages | Quick pass first; the enemy-free map is a fallback only for levels without thruster packs, and first on request (`alwaysMap`); an exhausted quick pass is the verdict `no-route` |
| Comfort proof | Proves a route without forgiveness and with weaker numbers. It certifies no timing margin; reviewers enforce the window classes |
| Test numbers | Rule tests run on `REFERENCE_TUNING` (`src/core/testkit.ts`); only the tuning sanity test, the design-limit assertions and the level proofs read the live `TUNING` |
| Thruster limits for levels | Based on THRUST held with one thumb, no jump: 6 tiles of climb, 8 of level flight (9 with 4 clear tiles above). The jump-and-thrust chord is keyboard only |
| Required shots | Always possible from the ground in the enemy's row; the search never fires in the air |
| Quit and continue | Restarts the level as a fresh visit and costs no life; only `Restart level` keeps what was collected, and it costs a life |
| Fullscreen and menu sizes | The first title tap asks for fullscreen outside frames; menu rows and switches are sized to at least 44 CSS px from `zoom / dpr` |
| Rotate message | Shown when the device is upright (`screen.orientation`), not merely when the window is taller than wide, so a tall preview frame cannot lock the game |
| Offline app | Manifest and worker are hand-written templates completed by a build step, because of the hashed bundle name and the one-place rule for the title |
| Save | Two keys (progress, settings); `resume` written at level start and its lives updated on every death; the win saved at the last level's clear, the life bonus at `gameWon` |
| Frame pacing | Phaser's smoothed delta, at most 5 ticks per frame, backlog dropped (input spike), not a 250 ms rule |
