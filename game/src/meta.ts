/**
 * The game's identity. This is the only file in the code base that spells the
 * game's name: everything else (page title, title screen, storage keys) reads
 * it from here, so a rename is a one-line change.
 */

/**
 * The name shown to players. The first word is the hero's name: the title
 * screen draws it large and the rest of the title small underneath, in
 * capitals (the pixel font has no lower case).
 */
export const GAME_TITLE = 'Sprue and the Moon Foundry';

/**
 * Short, stable id used as the prefix of every storage key (for example
 * `${GAME_ID}:progress`). Do not change it once players have saved games,
 * even if the title changes: saved progress is found by this id.
 */
export const GAME_ID = 'moon-foundry';
