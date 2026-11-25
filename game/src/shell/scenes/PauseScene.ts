/**
 * The pause menu (docs/ART-AND-SOUND.md section 9): the game dimmed under a panel with `PAUSED` (2x),
 * `RESUME`, `RESTART LEVEL -1 LIFE`, `QUIT TO TITLE`, and the SOUND and BUZZ switches side by side,
 * laid out by `menuLayout` for fingers (docs/ARCHITECTURE.md 11.5): rows of at least 44 CSS px.
 *
 * Launched by `PlayScene.pauseGame()` (Esc, P, PAUSE on the pad, blur, hidden, pagehide, a lost WebGL
 * context, the phone held upright). It never resumes by itself: RESUME, Esc or P call
 * `PlayScene.resumeGame()`, which shuts the core's ready gate again (`holdReady`), resets the stepper and
 * lets go of every control. RESTART LEVEL costs a life (`PlayScene.restartLevel`, which keeps what the
 * core keeps); QUIT TO TITLE costs nothing
 * (`PlayScene.quitToTitle`: the save already holds the level's starting point).
 *
 * - On the last life RESTART LEVEL would end the game (it costs a life, like a death), so there it reads
 *   `GIVE UP - GAME OVER`: a player who restarts because Sprue is stuck sees what it does (QUIT TO TITLE, then
 *   CONTINUE, restarts the level for free).
 * - In keyboard play (touch mode off) a line under the switches names the keys no screen names otherwise:
 *   `SPACE JUMP  X FIRE  Z THRUST`. A touch screen shows its own FIRE and THRUST buttons.
 * - The panel keeps off the top bar (STRIP_H) where the view has room under it: with the key line it is 141 px
 *   tall, and centred in the smallest view (160 px) its top edge cut across the bar's LEVEL 1 and score. Where the
 *   room under the bar is shorter (a phone's browser tab), its gaps and padding give way first (menuLayout), and its
 *   items keep inside the plate's frame.
 * - The switches follow their settings while the menu is up (M toggles the sound from the Play scene's keys, and
 *   another tab may change them): the menu draws them again and the canvas is named again.
 */
import * as Phaser from 'phaser';

import { COLOR } from '../../art/palette';
import { STRIP_H } from '../hudModel';
import { app, haptics, settings } from '../singletons';

import { Menu } from './menu';
import { PlayScene } from './PlayScene';
import { TEXT } from './strings';
import { screenLabelOf, setScreenLabel } from './TitleScene';

export class PauseScene extends Phaser.Scene {
  private closing = false;
  /** The restart button's words: RESTART LEVEL -1 LIFE, or GIVE UP - GAME OVER on the last life. */
  private restartText: string = TEXT.restartLevel;
  /** The key line is shown (keyboard play). */
  private keysShown = false;

  constructor() {
    super('Pause');
  }

  init(): void {
    this.closing = false;
    this.restartText = TEXT.restartLevel;
    this.keysShown = false;
  }

  create(): void {
    const play = this.scene.get('Play');
    const sim = play instanceof PlayScene ? play.session : null;
    // The core's restartLevel acts only while the level is played (ready or playing): then it costs a life.
    const lastLife = sim !== null && sim.session.lives <= 1 && (sim.run.phase === 'ready' || sim.run.phase === 'playing');
    this.restartText = lastLife ? TEXT.giveUp : TEXT.restartLevel;
    this.keysShown = !app.classList.contains('touch');
    const leave = (then: (scene: PlayScene) => void): void => {
      if (this.closing) return;
      this.closing = true;
      menu.close();
      if (play instanceof PlayScene) then(play);
      this.scene.stop();
    };

    const menu = new Menu(
      this,
      [
        { kind: 'text', text: TEXT.paused, scale: 2 },
        { kind: 'button', text: TEXT.resume, onPick: () => { leave((p) => { p.resumeGame(); }); } },
        { kind: 'button', text: this.restartText, onPick: () => { leave((p) => { p.restartLevel(); }); } },
        { kind: 'button', text: TEXT.quitToTitle, onPick: () => { leave((p) => { p.quitToTitle(); }); } },
        {
          kind: 'switches',
          switches: [
            {
              icon: 'btn_sound',
              label: TEXT.sound,
              get: () => settings.current.sound,
              set: (on) => {
                settings.setSound(on);
                this.name();
              },
            },
            {
              icon: 'btn_vibe',
              label: TEXT.buzz,
              get: () => settings.current.vibration,
              set: (on) => {
                settings.setVibration(on);
                if (on) haptics.cog(); // a sample buzz, so the player feels what was switched on
                this.name();
              },
            },
          ],
        },
        ...(this.keysShown ? [{ kind: 'text', text: TEXT.keys, colour: COLOR.lightSteel } as const] : []),
      ],
      {
        panel: true,
        dim: true,
        clearTop: STRIP_H, // off the top bar where the view has room (see the header)
        onSwitchesChanged: () => {
          this.name();
        },
        onBack: () => {
          leave((p) => {
            p.resumeGame();
          });
        },
      },
    );

    // The canvas is named for screen readers (and the browser tests) while the menu is up, then given back its name.
    const before = screenLabelOf(this);
    this.name();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Quit and the end of the session name the next screen themselves; only a resume needs the old name back.
      if (screenLabelOf(this) === this.label()) setScreenLabel(this, [before]);
    });
  }

  private label(): string {
    const lines = [TEXT.paused, TEXT.resume, this.restartText, TEXT.quitToTitle, TEXT.sound(settings.current.sound), TEXT.buzz(settings.current.vibration)];
    if (this.keysShown) lines.push(TEXT.keys);
    return lines.join('. ');
  }

  private name(): void {
    setScreenLabel(this, [this.label()]);
  }
}
