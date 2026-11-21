/**
 * The game's identity. This is the only file in the code base that spells the
 * game's name: everything else (page title, title screen, storage keys) reads
 * it from here, so a rename is a one-line change.
 */

/** The name shown to players. */
export const GAME_TITLE = 'Pip and the Moon Foundry';

/**
 * Short, stable id used as the prefix of every storage key (for example
 * `${GAME_ID}:progress`). Do not change it once players have saved games,
 * even if the title changes: saved progress is found by this id.
 */
export const GAME_ID = 'moon-foundry';
