/**
 * The game-over and win screens (docs/ART-AND-SOUND.md section 9).
 *
 * Started by the Play scene, through the EventRouter, once per session, with `EndData`:
 * - game over: `GAME OVER` (2x, amber with a void shadow: crimson reads at only 1.87 on void),
 *   `SCORE 04250`, the best line, and `TRY AGAIN - LEVEL n` and `TITLE`; under it the stars, the ridge
 *   and Sprue's girder, empty;
 * - win: `THE FOUNDRY IS LIT!` (2x, gold) over a backdrop that glows amber, Sprue back on his girder,
 *   then 30 frames apart, each with a tick: `SCORE`, `LIVES LEFT n X 500`, `TOTAL` and the best line;
 *   `PLAY AGAIN` and `TITLE`.
 * The best line is `NEW BEST!` (blinking) when the score beats the best score as it was when the
 * session began (`previousBest`), otherwise `BEST` with the larger of the two (ARCHITECTURE 11.3). A
 * session that is never saved (a development room) has no best line. The lines are src/shell/screens.ts.
 *
 * The game-over and win jingles started by the router ring on over this screen; it opens with the
 * shutter wipe.
 */
import * as Phaser from 'phaser';

import { COLOR } from '../../art/palette';
import { TUNING } from '../../tuning';
import type { SessionEnd } from '../EventRouter';
import type { Rect } from '../menuLayout';
import { onSceneEnd } from '../sceneEnd';
import { blinkShown, endLines, glowBands } from '../screens';
import type { ScreenLine } from '../screens';
import { controls, pad, sfx } from '../singletons';

import { Menu } from './menu';
import type { MenuEntry } from './menu';
import type { NumberedStart } from './sessions';
import { TEXT } from './strings';
import { Backdrop, Shutter, prefersReducedMotion, setScreenLabel } from './TitleScene';

export interface EndData {
  /** How the session ended (from the EventRouter). */
  readonly end: SessionEnd;
  /** What `TRY AGAIN` / `PLAY AGAIN` starts (sessions.ts `againStart`). */
  readonly again: NumberedStart;
}

const FRAME_MS = 1000 / 60;
/** The win's amber glow breathes once every this many frames, between GLOW_LOW and full strength. */
const GLOW_PERIOD = 180;
const GLOW_LOW = 0.7;

export class EndScene extends Phaser.Scene {
  private menu: Menu | null = null;
  private lines: ScreenLine[] = [];
  /** How many entries the menu has, to keep the scenery off their ink (Menu.inkOf). */
  private entryCount = 0;
  private backdrop: Backdrop | null = null;
  private shutter: Shutter | null = null;
  private glow: Phaser.GameObjects.Rectangle[] = [];
  private won = false;
  private leaving = false;
  private frames = 0;
  private age = 0;
  /** Lines already revealed (their tick sound played). */
  private revealed = 0;
  /** The device asks for reduced motion: the glow holds still. */
  private still = false;

  constructor() {
    super('End');
  }

  init(): void {
    this.menu = null;
    this.lines = [];
    this.entryCount = 0;
    this.backdrop = null;
    this.shutter = null;
    this.glow = [];
    this.won = false;
    this.leaving = false;
    this.frames = 0;
    this.age = 0;
    this.revealed = 0;
    this.still = prefersReducedMotion();
  }

  create(data: EndData): void {
    pad.hide();
    controls.releaseAll();
    const { end, again } = data;
    this.won = end.outcome === 'won';
    this.lines = endLines(end, TUNING.score.lifeLeft);

    const entries: MenuEntry[] = this.lines.map((line) => ({ kind: 'text', text: line.text, scale: line.scale, colour: COLOR[line.colour] }));
    entries.push({ kind: 'text', text: ' ' }); // air between the lines and the buttons
    const againText = this.won ? TEXT.playAgain : TEXT.tryAgain(again.levelNumber);
    entries.push({ kind: 'button', text: againText, onPick: () => { this.leave('Play', again.play); } });
    entries.push({ kind: 'button', text: TEXT.title, onPick: () => { this.leave('Title'); } });
    this.entryCount = entries.length;

    this.backdrop = new Backdrop(this, { depth: -10, girder: true, hero: this.won });
    if (this.won) {
      // The furnace light rises behind the ridge: stepped amber strips, drawn over the stars and under the ridge.
      this.glow = glowBands(this.scale.height).map(() => this.add.rectangle(0, 0, 1, 1, COLOR.amber, 0).setOrigin(0, 0).setDepth(-9.5));
    }
    this.menu = new Menu(this, entries, { panel: false, dim: false });
    this.shutter = new Shutter(this, 100);
    this.layout();
    this.reveal();
    this.shutter.open();
    setScreenLabel(this, [...this.lines.map((l) => l.text), againText, TEXT.title]);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
    onSceneEnd(this.events, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
    });
  }

  override update(_time: number, delta: number): void {
    this.frames += delta / FRAME_MS;
    const whole = Math.floor(this.frames);
    if (whole <= 0) return;
    this.frames -= whole;
    this.age += whole;
    this.shutter?.advance(whole);
    this.backdrop?.advance(whole);
    this.reveal();
    if (this.won) this.drawGlow();
  }

  /** Shows the lines whose time has come (a tick for each new one), and blinks NEW BEST!. */
  private reveal(): void {
    const menu = this.menu;
    if (!menu) return;
    this.lines.forEach((line, i) => {
      const shown = this.age >= line.showAt;
      if (shown && i >= this.revealed && line.showAt > 0) sfx.play('uiOk'); // "each with a tick sound"
      if (shown) this.revealed = Math.max(this.revealed, i + 1);
      menu.setTextVisible(i, shown && (!line.blink || blinkShown(this.age - line.showAt)));
    });
  }

  private drawGlow(): void {
    const { width, height } = this.scale;
    const phase = (this.age % GLOW_PERIOD) / GLOW_PERIOD;
    // Under reduced motion the glow holds still at full strength.
    const pulse = this.still ? 1 : GLOW_LOW + (1 - GLOW_LOW) * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI));
    const bands = glowBands(height, pulse);
    this.glow.forEach((rect, i) => {
      const band = bands[i];
      if (band) rect.setPosition(0, band.y).setSize(width, band.h).setFillStyle(COLOR.amber, band.alpha);
    });
  }

  private leave(key: 'Play' | 'Title', data?: object): void {
    if (this.leaving) return;
    this.leaving = true;
    this.menu?.close();
    this.scene.start(key, data);
  }

  private readonly layout = (): void => {
    const menu = this.menu;
    if (!menu) return;
    const taken: Rect[] = [];
    for (let i = 0; i < this.entryCount; i++) {
      const ink = menu.inkOf(i); // at the scale drawn: 2x text where the pixels are small
      if (ink) taken.push(ink);
    }
    this.backdrop?.layout(taken);
    if (this.won) {
      const bands = glowBands(this.scale.height);
      while (this.glow.length < bands.length) this.glow.push(this.add.rectangle(0, 0, 1, 1, COLOR.amber, 0).setOrigin(0, 0).setDepth(-9.5));
      this.drawGlow();
    }
    this.shutter?.draw();
  };
}
