import * as Phaser from 'phaser';

import { GAME_TITLE } from '../meta';

export class TitleScene extends Phaser.Scene {
  private title: Phaser.GameObjects.Text | undefined;

  constructor() {
    super('Title');
  }

  create(): void {
    this.title = this.add
      .text(0, 0, GAME_TITLE, {
        fontFamily: 'ui-monospace, Menlo, Consolas, "Courier New", monospace',
        fontStyle: 'bold',
        color: '#ffc857',
        align: 'center',
      })
      .setOrigin(0.5);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
    });

    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      window.__GAME_READY__ = true;
    });
  }

  /** Centres the title and sizes it to the screen. An arrow function, so it can be passed as an event handler. */
  private readonly layout = (): void => {
    const { width, height } = this.scale;
    const size = Math.max(12, Math.floor(Math.min(height * 0.12, (width * 0.9) / (GAME_TITLE.length * 0.62))));
    this.title?.setFontSize(size).setPosition(Math.round(width / 2), Math.round(height / 2));
  };
}
