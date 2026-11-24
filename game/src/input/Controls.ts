/**
 * Device-independent button state (docs/ARCHITECTURE.md 11.1, docs/PHASER4-NOTES.md section 14).
 *
 * The keyboard and the touch pad each report which buttons they hold; the scene takes exactly one
 * core `Input` per simulation tick with `consume()`. Three rules live here and nowhere else:
 *
 * - A press is never lost. A press that begins and ends between two ticks (a quick tap, a key hit
 *   and released inside one frame) is latched and reported for exactly one tick.
 * - The core gets at most one of left and right: the one pressed most recently.
 * - `releaseAll` lets go of everything at once (window blur, touch cancel, pause).
 *
 * Pure: no Phaser, no DOM, no clock.
 */
import type { Input } from '../core/types';

/** The five buttons the core knows. */
export const BUTTONS = ['left', 'right', 'jump', 'fire', 'thrust'] as const;
export type Button = (typeof BUTTONS)[number];

/** Who is holding a button. Each source has its own set of held buttons. */
export const SOURCES = ['keys', 'touch'] as const;
export type Source = (typeof SOURCES)[number];

type Flags = Record<Button, boolean>;

const blank = (): Flags => ({ left: false, right: false, jump: false, fire: false, thrust: false });

export class Controls {
  private readonly heldBy: Record<Source, Flags> = { keys: blank(), touch: blank() };
  private readonly latched: Flags = blank();
  private lastDirection: 'left' | 'right' = 'right';

  /**
   * The level-triggered state of one button from one source: call it whenever the state is known
   * (every frame for polled keys, on every pointer event for the pad). A change from up to down
   * counts as a press and is latched until the next tick.
   */
  set(source: Source, button: Button, down: boolean): void {
    if (down && !this.heldBy[source][button]) this.latch(button);
    this.heldBy[source][button] = down;
  }

  /** Records a press that may already be over: it is reported by the next `consume()` only. */
  latch(button: Button): void {
    this.latched[button] = true;
    if (button === 'left' || button === 'right') this.lastDirection = button;
  }

  /**
   * The input for one simulation tick: everything held now plus every press since the last call.
   * Call it exactly once per tick, and only for ticks that are simulated.
   */
  consume(): Input {
    const out = blank();
    for (const b of BUTTONS) {
      out[b] = this.heldBy.keys[b] || this.heldBy.touch[b] || this.latched[b];
      this.latched[b] = false;
    }
    return this.oneDirection(out);
  }

  /** What is held right now, without the latches and without using them up (pad highlights, the test hook). */
  held(): Input {
    const out = blank();
    for (const b of BUTTONS) out[b] = this.isDown(b);
    return this.oneDirection(out);
  }

  /** True while any source holds the button. Does not look at the latches. */
  isDown(button: Button): boolean {
    return this.heldBy.keys[button] || this.heldBy.touch[button];
  }

  /** True while any source holds any button. */
  anyDown(): boolean {
    return BUTTONS.some((b) => this.isDown(b));
  }

  /**
   * Lets go of every button of one source, or of both when no source is named, and forgets every
   * press that has not been consumed yet. For window blur, touch cancel, pause and resume.
   */
  releaseAll(source?: Source): void {
    for (const s of source ? [source] : SOURCES) {
      for (const b of BUTTONS) this.heldBy[s][b] = false;
    }
    for (const b of BUTTONS) this.latched[b] = false;
  }

  /** The core wants at most one of left and right: the most recently pressed wins. */
  private oneDirection(out: Flags): Input {
    if (out.left && out.right) {
      if (this.lastDirection === 'left') out.right = false;
      else out.left = false;
    }
    return out;
  }
}
