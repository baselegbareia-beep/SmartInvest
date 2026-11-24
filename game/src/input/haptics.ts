/**
 * Vibration (docs/ART-AND-SOUND.md section 13): a short buzz on a death, two pulses for the golden
 * cog, a tick when the tank runs dry. Never on ordinary button presses.
 *
 * A thin wrapper round `navigator.vibrate` that
 * - honours the saved setting (`SettingsData.vibration`, the BUZZ switch): `setEnabled`;
 * - never throws and never logs where vibration is missing (every iPhone, most desktops) or not
 *   allowed yet (browsers refuse it until the player has touched the page);
 * - takes every length from the `touch` group of src/tuning.ts.
 *
 * Nothing here was felt on a real phone: headless Chromium accepts the calls and has no motor.
 */
import type { TouchTuning } from '../core/types';

/** The parts of `navigator` this module uses. */
export interface VibrationDevice {
  vibrate?: (pattern: number | number[]) => boolean;
  /** Browsers refuse to vibrate before the first touch or key press, and some log a warning for the attempt. */
  userActivation?: { hasBeenActive: boolean };
}

export interface Haptics {
  /** The saved setting. Switching off also stops a buzz that is running. */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** True where the browser offers vibration at all. Says nothing about the setting. */
  isSupported(): boolean;
  /** Event `playerDied`. Each of these returns true when the browser accepted the buzz. */
  death(): boolean;
  /** Event `trophyCollected`: two pulses. */
  cog(): boolean;
  /** Event `fuelEmptied`. */
  emptyTank(): boolean;
  /** Stops a buzz that is running (pause, page hidden). */
  stop(): void;
}

function browserDevice(): VibrationDevice | null {
  try {
    return (globalThis as { navigator?: VibrationDevice }).navigator ?? null;
  } catch {
    return null; // a locked-down frame may refuse even the read
  }
}

/**
 * @param t       `TUNING.touch`
 * @param enabled the saved setting (`SettingsData.vibration`); on by default, as the setting is
 * @param device  where to vibrate; tests pass a stand-in. Default: the browser's `navigator`
 */
export function createHaptics(t: TouchTuning, enabled = true, device: VibrationDevice | null = browserDevice()): Haptics {
  let on = enabled;

  const supported = (): boolean => {
    try {
      return device !== null && typeof device.vibrate === 'function';
    } catch {
      return false;
    }
  };

  /** Hands a pattern (buzz, pause, buzz, ... in ms) to the device. Never throws. */
  const send = (pattern: number[]): boolean => {
    try {
      if (device === null || typeof device.vibrate !== 'function') return false;
      if (device.userActivation?.hasBeenActive === false) return false;
      return device.vibrate(pattern);
    } catch {
      return false;
    }
  };

  const buzz = (pattern: number[]): boolean => {
    // A length of 0 in the tuning switches that buzz off.
    if (!on || !pattern.some((ms, i) => i % 2 === 0 && ms > 0)) return false;
    return send(pattern);
  };

  return {
    setEnabled(next) {
      if (on && !next) send([0]);
      on = next;
    },
    isEnabled: () => on,
    isSupported: supported,
    death: () => buzz([t.vibrateDeathMs]),
    cog: () => buzz([t.vibrateCogPulseMs, t.vibrateCogGapMs, t.vibrateCogPulseMs]),
    emptyTank: () => buzz([t.vibrateEmptyTankMs]),
    stop() {
      send([0]);
    },
  };
}
