/**
 * Boot: builds every texture and the font (src/art/makeSheet.ts; there is nothing to load), then
 * opens the title, or with `?level=test` / `?level=debug` (any level id) that room straight away, as a
 * one-room session that is never saved (docs/ARCHITECTURE.md 10 and 11.6).
 */
import * as Phaser from 'phaser';

import { makeArt } from '../../art/makeSheet';
import { findLevel } from '../../levels';

import { devStart } from './sessions';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    makeArt(this);
    const id = new URLSearchParams(window.location.search).get('level');
    const level = id === null ? undefined : findLevel(id);
    if (level) this.scene.start('Play', devStart(level));
    else this.scene.start('Title');
  }
}
