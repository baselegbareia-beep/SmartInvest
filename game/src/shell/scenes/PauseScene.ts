/**
 * The pause menu (docs/ART-AND-SOUND.md section 9): the game dimmed under a panel with `PAUSED` (2x),
 * `RESUME`, `RESTART LEVEL -1 LIFE`, `QUIT TO TITLE`, and the SOUND and BUZZ switches side by side,
 * laid out by `menuLayout` for fingers (docs/ARCHITECTURE.md 11.5): rows of at least 44 CSS px.
 *
 * Launched by `PlayScene.pauseGame()` (Esc, P, PAUSE on the pad, blur, hidden, pagehide, the phone held
 * upright). It never resumes by itself: RESUME, Esc or P call `PlayScene.resumeGame()`, which shuts the
 * core's ready gate again (`holdReady`), resets the stepper and lets go of every control. RESTART LEVEL
 * costs a life (`PlayScene.restartLevel`, which keeps what the core keeps); QUIT TO TITLE costs nothing
 * (`PlayScene.quitToTitle`: the save already holds the level's starting point).
 */
import * as Phaser from 'phaser';

import { haptics, settings } from '../singletons';

import { Menu } from './menu';
import { PlayScene } from './PlayScene';
import { TEXT } from './strings';
import { screenLabelOf, setScreenLabel } from './TitleScene';

export class PauseScene extends Phaser.Scene {
  private closing = false;

  constructor() {
    super('Pause');
  }

  init(): void {
    this.closing = false;
  }

  create(): void {
    const play = this.scene.get('Play');
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
        { kind: 'button', text: TEXT.restartLevel, onPick: () => { leave((p) => { p.restartLevel(); }); } },
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
      ],
      {
        panel: true,
        dim: true,
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
    return [TEXT.paused, TEXT.resume, TEXT.restartLevel, TEXT.quitToTitle, TEXT.sound(settings.current.sound), TEXT.buzz(settings.current.vibration)].join('. ');
  }

  private name(): void {
    setScreenLabel(this, [this.label()]);
  }
}
