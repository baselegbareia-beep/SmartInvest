import * as Phaser from 'phaser';

import { GAME_TITLE } from './meta';
import { TitleScene } from './scenes/TitleScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  title: GAME_TITLE,
  backgroundColor: '#0b0d16',
  pixelArt: true,
  scale: {
    parent: 'game',
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [TitleScene],
};

new Phaser.Game(config);
