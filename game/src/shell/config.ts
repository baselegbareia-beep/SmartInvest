/**
 * The Phaser game config (docs/PHASER4-NOTES.md section 3, with the reason for every key there).
 */
import * as Phaser from 'phaser';

import { codeToHex } from '../art/palette';
import { GAME_TITLE } from '../meta';

import type { View } from './chooseView';
import { BootScene } from './scenes/BootScene';
import { EndScene } from './scenes/EndScene';
import { HudScene } from './scenes/HudScene';
import { PauseScene } from './scenes/PauseScene';
import { PlayScene } from './scenes/PlayScene';
import { TitleScene } from './scenes/TitleScene';

/** Palette colour 0, "void": the canvas background. index.html paints the page the same colour. */
export const BACKDROP = codeToHex('0');

/** The config for a first view. `parent` is #game; `fullscreenTarget` is #app, so the pad goes fullscreen too. */
export function gameConfig(first: View): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO, // WebGL wherever it exists; the Canvas fallback runs the game but ignores tints
    title: GAME_TITLE,
    parent: 'game',
    backgroundColor: BACKDROP,
    pixelArt: true, // nearest filtering, antialias off, roundPixels on, canvas image-rendering: pixelated
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true }, // sound is hand-written Web Audio on a private AudioContext (src/audio/Sfx.ts)
    fps: { panicMax: 0 }, // no 120-frame capped-delta cool-down after boot, focus or becoming visible
    input: { activePointers: 2, windowEvents: false }, // Phaser listens on the canvas only; the DOM pad owns the rest
    scale: {
      mode: Phaser.Scale.NONE,
      width: first.viewW,
      height: first.viewH,
      zoom: 1,
      autoCenter: Phaser.Scale.NO_CENTER,
      fullscreenTarget: 'app',
    },
    // The first starts by itself. Array order is draw order (later on top) and never changes.
    scene: [BootScene, TitleScene, PlayScene, HudScene, PauseScene, EndScene],
  };
}
