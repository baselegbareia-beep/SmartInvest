/**
 * The shell's module-level singletons, shared by main.ts, the scenes and the test hook
 * (docs/PHASER4-NOTES.md section 3, docs/ARCHITECTURE.md section 2): the page elements, the one
 * `Controls` that the keyboard and the touch pad write to, the sound, the vibration, the touch pad,
 * the compiled physics, the saved progress and settings, and the view currently applied.
 *
 * Importing this module touches the DOM (it finds #app and builds the pad), so only browser code
 * imports it: never a unit test.
 */
import { GLYPHS, GLYPH_H, GLYPH_W, FONT_ADVANCE } from '../art/font';
import type { Frame } from '../art/grid';
import { mirrorFrame } from '../art/grid';
import { codeToHex } from '../art/palette';
import { SPRITES } from '../art/sprites/index';
import { Sfx } from '../audio/Sfx';
import { compileTuning } from '../core/compileTuning';
import type { Phys, SaveData, SettingsData } from '../core/types';
import { Controls } from '../input/Controls';
import { createHaptics } from '../input/haptics';
import { createTouchPad } from '../input/TouchPad';
import type { ControlId } from '../input/touchLayout';
import { CAMPAIGN } from '../levels';
import { TUNING } from '../tuning';

import { padReach } from './camera';
import type { PadReach } from './camera';
import type { View } from './chooseView';
import { cssPerArtPx } from './chooseView';
import type { SaveStore } from './EventRouter';
import { loadProgress, loadSettings, saveProgress, saveSettings } from './storage';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html: missing #${id}`);
  return el;
};

/** `#app`: the fullscreen target; holds the canvas parent, the touch pad and the rotate message. */
export const app = byId('app');
/** Carries the safe-area insets as padding (readSafeInsets). */
export const safeProbe = byId('safe-probe');

/** The live tuning compiled once for the core. */
export const phys: Phys = compileTuning(TUNING);

/** The one set of buttons: the keyboard and the touch pad write here, the Play scene reads one Input per tick. */
export const controls = new Controls();

/** The game's sound. main.ts calls `sfx.install()` before anything else. */
export const sfx = new Sfx();

// ---------------------------------------------------------------------------------------
// Settings and progress
// ---------------------------------------------------------------------------------------

/** The sound and vibration switches (`${GAME_ID}:settings`). Changing one applies it and saves it. */
class SettingsStore {
  private data: SettingsData = loadSettings();

  get current(): SettingsData {
    return this.data;
  }

  setSound(on: boolean): void {
    this.data = { ...this.data, sound: on };
    sfx.setMuted(!on);
    saveSettings(this.data);
  }

  toggleSound(): void {
    this.setSound(!this.data.sound);
  }

  setVibration(on: boolean): void {
    this.data = { ...this.data, vibration: on };
    haptics.setEnabled(on);
    saveSettings(this.data);
  }
}

/** The campaign's progress (`${GAME_ID}:progress`), read once at boot (ARCHITECTURE 10) and written when it changes. */
class ProgressStore implements SaveStore {
  private data: SaveData = loadProgress(CAMPAIGN.length);

  get current(): SaveData {
    return this.data;
  }

  write(next: SaveData): void {
    this.data = next;
    saveProgress(next); // false where the browser keeps nothing: the copy in memory still lasts the visit
  }
}

export const settings = new SettingsStore();
export const progress = new ProgressStore();

/** Vibration on deaths, the cog and an empty tank, honouring the BUZZ switch. */
export const haptics = createHaptics(TUNING.touch, settings.current.vibration);
sfx.setMuted(!settings.current.sound);

// ---------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------

let appliedView: View | null = null;
let appliedDpr = 1;

/** main.ts records every view it applies, so scenes can size menus for fingers (menuLayout). */
export function setAppliedView(view: View, dpr: number): void {
  appliedView = view;
  appliedDpr = dpr;
}

/** CSS px per art px on the glass now: `zoom / devicePixelRatio` (2 before the first layout). */
export function cssPerArt(): number {
  return appliedView ? cssPerArtPx(appliedView, appliedDpr) : 2;
}

/**
 * How far the canvas starts in from the window's left and right edges, CSS px (the notch's inset and any
 * bars beside it). The top bar and the title's corner switch keep off a rounded corner with it.
 */
export function canvasEdgeGapsCss(): { left: number; right: number } {
  if (!appliedView) return { left: 0, right: 0 };
  const w = appliedView.viewW * cssPerArtPx(appliedView, appliedDpr);
  return { left: appliedView.cssLeft, right: Math.max(0, window.innerWidth - appliedView.cssLeft - w) };
}

// Reused by padReachNow every frame: no allocation in the play loop.
const canvasRect = { x: 0, y: 0, w: 0, h: 0 };
const NO_RECT = { x: 0, y: 0, w: 0, h: 0 };
const moveButtons = [NO_RECT, NO_RECT];
const actionButtons = [NO_RECT, NO_RECT, NO_RECT];

/**
 * How far the touch pad's drawn buttons reach into the canvas now, art px, written into `out`: zeros
 * unless touch mode is on (the pad is used, even while a menu hides it). The camera keeps the hero
 * clear of them at the level's side walls. Allocates nothing; the Play scene asks once per frame.
 */
export function padReachNow(out: PadReach): PadReach {
  const buttons = pad.buttonsOnPage();
  if (!appliedView || !buttons || !app.classList.contains('touch')) {
    out.left = 0;
    out.right = 0;
    return out;
  }
  const k = cssPerArtPx(appliedView, appliedDpr);
  canvasRect.x = appliedView.cssLeft;
  canvasRect.y = appliedView.cssTop;
  canvasRect.w = appliedView.viewW * k;
  canvasRect.h = appliedView.viewH * k;
  moveButtons[0] = buttons.left;
  moveButtons[1] = buttons.right;
  actionButtons[0] = buttons.jump;
  actionButtons[1] = buttons.fire;
  actionButtons[2] = buttons.thrust;
  return padReach(moveButtons, actionButtons, canvasRect, k, out);
}

// ---------------------------------------------------------------------------------------
// Pixel art in the DOM: the pad's glyphs and the rotate message
// ---------------------------------------------------------------------------------------

/**
 * A grid of palette codes drawn onto a canvas at a whole number of DEVICE pixels per art pixel, as
 * close as possible to `cssPerArt` CSS px per art px, so it is as sharp as the canvas game.
 *
 * `margin` art px of transparency go round it. At ratios such as 2.75 a CSS size of n / 2.75 px cannot
 * be laid out exactly (the browser keeps 1/64 px), so the canvas is drawn a hundredth of a device pixel
 * small and its outermost device pixels are blended with what is under it: the lime of the FIRE glyph
 * showed a darker line along its edge. With a margin only transparent pixels are at the edge.
 */
export function pixelCanvas(grid: Frame, cssPerArtWanted: number, colour?: string, margin = 0): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(cssPerArtWanted * dpr));
  const m = Math.max(0, Math.floor(margin));
  const w = Math.max(0, ...grid.map((row) => row.length)) + 2 * m;
  const h = grid.length + 2 * m;
  const canvas = document.createElement('canvas');
  canvas.width = w * k;
  canvas.height = h * k;
  canvas.style.width = `${(w * k) / dpr}px`;
  canvas.style.height = `${(h * k) / dpr}px`;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch === '.') continue;
      ctx.fillStyle = colour ?? codeToHex(ch);
      ctx.fillRect((x + m) * k, (y + m) * k, k, k);
    }
  });
  return canvas;
}

/** One line of text in the game's pixel font, as a grid of '7' (white) on '.', 5 x 7 glyphs at an advance of 6. */
export function textGrid(text: string): Frame {
  const width = text.length === 0 ? 0 : text.length * FONT_ADVANCE - (FONT_ADVANCE - GLYPH_W);
  const rows: string[][] = Array.from({ length: GLYPH_H }, () => Array.from({ length: width }, () => '.'));
  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPHS.get(text.charAt(i)); // the font is plain ASCII capitals: one character, one glyph
    glyph?.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        const row = rows[y];
        if (row && line.charAt(x) === '#') row[i * FONT_ADVANCE + x] = '7';
      }
    });
  }
  return rows.map((row) => row.join(''));
}

/** CSS px per art px of each pad glyph (docs/ART-AND-SOUND.md section 10): 3 for JUMP, 2 for the others. */
const GLYPH_SCALE: Readonly<Record<ControlId, number>> = { left: 2, right: 2, jump: 3, fire: 2, thrust: 2, pause: 2 };

function padGlyph(id: ControlId): HTMLElement | null {
  const first = (frames: readonly Frame[]): Frame => frames[0] ?? [];
  const grid: Frame =
    id === 'left'
      ? mirrorFrame(first(SPRITES.btn_arrow))
      : id === 'right'
        ? first(SPRITES.btn_arrow)
        : id === 'jump'
          ? first(SPRITES.btn_jump)
          : id === 'fire'
            ? first(SPRITES.btn_fire)
            : id === 'thrust'
              ? first(SPRITES.btn_thrust)
              : first(SPRITES.btn_pause);
  return pixelCanvas(grid, GLYPH_SCALE[id], undefined, 1); // a transparent art px round it: see pixelCanvas
}

// ---------------------------------------------------------------------------------------
// The touch pad
// ---------------------------------------------------------------------------------------

let pauseHandler: () => void = () => undefined;

/** PAUSE on the touch pad calls whatever the running Play scene registered here. */
export function onPadPause(handler: () => void): void {
  pauseHandler = handler;
}

/** The DOM touch pad over the canvas: hidden until touch mode is on and a level is being played. */
export const pad = createTouchPad(app, controls, TUNING.touch, {
  onPause: () => {
    pauseHandler();
  },
  glyph: padGlyph,
});
