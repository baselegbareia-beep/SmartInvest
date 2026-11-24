# Sprue and the Moon Foundry: the game in plain words

An original retro platformer for phones, played in the browser with the phone held sideways. Version 1 is ten short levels. This is the agreed description of the game. `docs/PLAN.md` says when each part is built. The numbers here describe the game as first shipped; the working values live in `src/tuning.ts`.

## The story
Sprue is a small robot that the moon foundry built from its own casting scrap, and forgot when the crews went home. The furnaces died when the golden cogs that drive them were scattered through ten halls. Sprue gathers them, one airlock at a time, to relight the Heart Furnace and show a light to Earth.

## How a level works
1. Every level starts frozen. Nothing moves until you press a control, so your thumbs can settle first. A thumb that is already resting on a button does not count: lift it and press.
2. Find the golden cog. Taking it opens the level's airlock.
3. Walk into the open airlock. The next level loads. After level 10 the game is won.
4. Ore crystals along the way are worth points. None of them is needed to finish.
5. One touch of anything dangerous costs a life.

A level takes 25 to 90 seconds without mistakes. All ten take about 7 minutes without mistakes and under 20 minutes on a first try.

## Controls
| Action | Keyboard | Touch |
|---|---|---|
| Move | Arrow keys, or A and D | LEFT and RIGHT buttons, bottom left |
| Jump | Space, Up or W | JUMP button, bottom right |
| Fire the blaster | X | FIRE button, left of JUMP. Shown only while Sprue holds the blaster |
| Thrust | Z or Shift | THRUST button, above JUMP. Shown only while Sprue wears the pack |
| Pause | Esc or P | PAUSE button, top right |
| Sound on or off | M | A switch on the title and pause screens |

- Hold jump longer to jump higher (up to a little over 3 tiles); a quick tap is a small hop. Sprue can steer in the air.
- The game forgives thumbs: a jump pressed a moment after running off a ledge, or a moment before landing, still counts.
- There is no double jump, no wall jump and no damage from falling.

## Items
Each item lasts until Sprue dies or the level ends. Every level starts with empty hands.
- **Bolt blaster.** Fires one bolt at a time, level, in the direction Sprue faces. A bolt flies 10 tiles. Shots are unlimited.
- **Thruster pack.** Hold thrust to fly. A full tank is 1.3 seconds of thrust (about 8 tiles straight up, or about 11 tiles across) and does not refill by itself. No level asks for more than 6 tiles up or 9 tiles across on one tank. Another pack fills the tank. If the tank runs dry, the level's packs reappear where they were, so Sprue is never stranded without fuel.

## Enemies
Neither enemy notices Sprue: each keeps to its own path. Touching one from any side costs a life, and jumping on them does not work. One bolt destroys either.
- **Cinderpeg.** A lump of furnace slag on legs. Crawls along the floor and turns round at walls, ledges and hazards.
- **Arc Moth.** A feral welding drone. Flies back and forth in a straight line, either up and down or left and right.

## Hazards
Furnace fire, coolant pools, spikes, and falling out of the bottom of a level. Each costs a life.

## Lives, death and coming back
- A run starts with 3 lives. Clearing a level gives one life back, never above 3. At 0 lives the run is over.
- A death takes about 1.2 seconds. Sprue returns to the start of the level, which waits for a button press again.
- **Kept after a death:** the score, the crystals already collected, the golden cog and the open airlock.
- **Lost after a death:** the blaster, the pack and its fuel. Those pickups reappear, and so do all enemies.
- There is no moment of invulnerability. The frozen start replaces it.
- "Restart level" in the pause menu costs a life, the same as a death, and keeps what a death keeps. It is the way out if Sprue is ever stuck.
- "Quit to title" costs no life. Continuing later starts that level afresh: the lives are as they were, but the points, crystals and cog gathered in that level are gone. (So quitting just before a death saves the life and loses the level's work. Closing the browser does the same and cannot be prevented.)

## Score
| For | Points |
|---|---|
| Ore crystal | 10 |
| Golden cog | 100 |
| Cinderpeg destroyed | 50 |
| Arc Moth destroyed | 100 |
| Level cleared | 200 |
| Each life left when the game is won | 500 |

An enemy pays only the first time it is destroyed in a level, so dying on purpose earns nothing. With the planned levels the highest possible score is 7,900.

## Screens
- **Title.** The name, "Tap to start", the best score and a sound switch. With saved progress: "Continue" and "New game". The first tap also asks the phone for full screen, where the browser allows it (iPhones do not; there, add the game to the home screen).
- **Level intro.** The level number, its name and a one-line hint.
- **Play.** Along the top: lives, level, score, the cog (an outline until found), the items held and the fuel left.
- **Pause.** Resume, Restart level, Quit to title, and switches for sound and vibration. The game also pauses by itself when the phone is locked, the browser is hidden or the phone is turned upright. Resuming always goes through the frozen start.
- **Level clear**, **Game over** (score, best score, "Try again") and **Win** (score, bonus for lives left, total).
- **Rotate your phone.** Shown when a phone is held upright. The game is played sideways only.

## What is saved on the device
- The highest level reached, the best score, and the run in progress (level, score and lives), so a closed game can be continued. Continuing restarts the current level with the score it began with and the lives left now.
- A cleared level is saved the moment Sprue enters the airlock, so closing the game during the clear banner loses nothing. Entering the last airlock wins the game there and then; only the bonus for lives left needs the banner to finish before it counts towards the best score.
- After a game over, "Continue" starts at the highest level reached with 3 lives and a score of 0. "New game" starts at level 1 and keeps the best score.
- The sound and vibration switches.

Nothing is sent anywhere. There are no accounts, and the game uses no network once it has loaded. It can be added to the home screen and played offline.

Three things to know on iPhones: the game on the home screen keeps its own save, separate from the same game opened in Safari; Safari itself may forget a site's saved progress if the site is not opened for a week; and the sound follows the ring/silent switch. Phones that cannot vibrate from a web page (all iPhones) simply ignore the vibration switch.

## Deliberately not in version 1
A level editor, online scores, accounts, ads, music (there are sound effects only), more than two kinds of enemy, bosses, checkpoints inside a level, moving platforms, a level-select screen, difficulty settings, game controllers, upright play, and languages other than English. Ideas for later are listed at the end of `docs/PLAN.md`.

## Originality
This is a new game in a classic genre. Every name, character, picture, sound and level layout is made for this game. Nothing is taken from an existing game.

Two things the owner should know, found when the names and rules were searched:
- **The rules have a well-known ancestor.** Ten levels, a trophy that opens the exit, a gun and a jetpack with limited fuel are also the rules of *Dangerous Dave*, a platformer from the late 1980s. Those rules are what was asked for and are common to the genre. Everything else is kept different on purpose: the look, the screens, the level layouts, a thruster that is held instead of switched on, enemies that never shoot, the frozen start. `docs/LEVELS.md` (rule 11) lists what level builders and the final review must stay clear of.
- **The names are our own.** The floor enemy was first called by the ordinary word for furnace slag, but another game uses that word for its targets, so it was renamed "Cinderpeg" (a cinder on peg legs) before any of the game was built. A web search found no game using the title, Sprue, Cinderpeg, Arc Moth or the level names.
