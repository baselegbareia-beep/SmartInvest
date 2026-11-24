/**
 * Touch mode and the rotate guard (docs/PHASER4-NOTES.md section 17, docs/ARCHITECTURE.md 2).
 *
 * The blur, hidden and pagehide listeners do NOT live here: they call the Play scene's `pauseGame` and
 * must be removed with that scene, so PlayScene.create adds them.
 */
import type * as Phaser from 'phaser';

/** The keys that are no sign of keyboard play: the system's own (Cmd, Ctrl, Alt, and shortcuts made with them). */
const SYSTEM_KEYS: ReadonlySet<string> = new Set(['Meta', 'OS', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'FnLock']);

/**
 * Whether a keydown turns touch mode off: a key the game could be played with. Cmd, Ctrl and Alt (alone or in a
 * shortcut, such as switching apps on a tablet's keyboard) leave the pad where it is. Shift is THRUST, so it counts.
 */
export function keyEndsTouchMode(e: { readonly key: string; readonly metaKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean }): boolean {
  return !(SYSTEM_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey);
}

/**
 * Touch mode: the pad and the rotate message exist only on touch devices.
 * On at boot when any pointer is coarse; on at the first real touch; off again at a key press
 * (`keyEndsTouchMode`). `forced` (?touch=1) keeps it on and lets the mouse drive the pad, for tests.
 * `onChange(on, firstTouch)` runs whenever it flips (and once at boot when it starts on); `firstTouch`
 * is the pointerdown that turned it on, still being dispatched (the pad takes it: TouchPad.takeFirstTouch).
 */
export function installTouchMode(app: HTMLElement, forced: boolean, onChange: (on: boolean, firstTouch?: PointerEvent) => void): void {
  const set = (on: boolean, firstTouch?: PointerEvent): void => {
    if (app.classList.contains('touch') === on) return;
    app.classList.toggle('touch', on);
    onChange(on, firstTouch);
  };
  let coarse = false;
  try {
    coarse = window.matchMedia('(any-pointer: coarse)').matches;
  } catch {
    // no media queries: wait for the first touch
  }
  if (forced || coarse) set(true);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') set(true, e);
    },
    { capture: true },
  );
  if (!forced) {
    window.addEventListener('keydown', (e) => {
      if (keyEndsTouchMode(e)) set(false);
    });
  }
}

/**
 * True when the DEVICE is held upright. A wide window is never upright. A tall window is upright only if the
 * screen is: inside a frame (a preview pane) the window's shape says nothing about how the phone is held.
 */
export function deviceIsUpright(portrait: MediaQueryList): boolean {
  if (!portrait.matches) return false;
  try {
    // Typed as always present; missing on older iPhones (before iOS 16.4).
    const type = (window.screen as { orientation?: { type?: string } }).orientation?.type;
    if (typeof type === 'string') return type.startsWith('portrait');
    const angle = (window as { orientation?: unknown }).orientation; // the old iPhone property: 0 or 180 is upright
    if (typeof angle === 'number') return angle % 180 === 0;
  } catch {
    // fall through to the window's own shape
  }
  return true;
}

/**
 * Rotate guard. Sets the class "upright" on #app (the CSS in index.html shows the message for
 * #app.touch.upright) and stops the game underneath it: `pauseGame` opens the pause menu (so turning
 * back never resumes by itself) and `game.pause()` stops updates and drawing while the message is up.
 * Returns a function to call again whenever touch mode changes.
 */
export function installRotateGuard(game: Phaser.Game, app: HTMLElement, pauseGame: () => void): () => void {
  const portrait = window.matchMedia('(orientation: portrait)');
  let shown: boolean | null = null;
  const apply = (): void => {
    const upright = app.classList.contains('touch') && deviceIsUpright(portrait);
    if (upright === shown) return; // one turn of the phone fires both listeners below
    shown = upright;
    app.classList.toggle('upright', upright);
    if (upright) {
      pauseGame();
      game.pause();
    } else {
      game.resume();
    }
  };
  portrait.addEventListener('change', apply);
  try {
    (window.screen as { orientation?: EventTarget }).orientation?.addEventListener('change', apply);
  } catch {
    // no screen-orientation events here: the media query still fires
  }
  apply(); // also right when the page opens with the phone upright
  return apply;
}
