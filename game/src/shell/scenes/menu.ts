/**
 * A menu on the canvas: text lines, buttons and rows of small switches, drawn at the rectangles that
 * `menuLayout` returns and nowhere else (docs/ARCHITECTURE.md 11.5, docs/ART-AND-SOUND.md section 9).
 * Used by the Title, Pause and End scenes; the screens agent restyles it here once for all three.
 *
 * - Rows are sized for fingers in CSS px (menuLayout), re-laid out on every view resize. Where the
 *   pixels are small (under 1.5 CSS px), 1x lines and labels are drawn at 2x if the menu fits
 *   (`MenuLayout.textScale`).
 * - Touch and mouse: a button acts on release, and only if the press began on it (a scene can get a
 *   pointerup whose pointerdown it never saw).
 * - Keyboard: arrows move the lime focus, Space or Enter confirm, Esc (and P) call `onBack`; every key
 *   through `onFreshKey` (src/shell/freshKey.ts), so auto-repeat does not count and each key event acts once.
 * - Sounds: `uiMove` when the focus moves, `uiOk` on a confirm.
 *
 * Every object belongs to the scene, so Phaser removes them on shutdown; `destroy()` removes the one
 * listener this adds outside the display list (the scale manager's resize).
 */
import * as Phaser from 'phaser';

import { FONT_SIZE } from '../../art/font';
import { FONT_KEY, TEXTURE_KEY } from '../../art/manifest';
import { COLOR } from '../../art/palette';
import { onFreshKey } from '../freshKey';
import { contains, drawnScale, menuLayout, textOrigin } from '../menuLayout';
import type { MenuItem, Rect } from '../menuLayout';
import { onSceneEnd } from '../sceneEnd';
import { inkRect } from '../screens';
import { cssPerArt, sfx } from '../singletons';

/** A small on/off switch with its 12 px icon (frame 0 on, 1 off). */
export interface MenuSwitch {
  readonly icon: 'btn_sound' | 'btn_vibe';
  readonly label: (on: boolean) => string;
  readonly get: () => boolean;
  readonly set: (on: boolean) => void;
}

export type MenuEntry =
  | { readonly kind: 'text'; readonly text: string; readonly scale?: 1 | 2 | 3; readonly colour?: number }
  | { readonly kind: 'button'; readonly text: string; readonly onPick: () => void }
  | { readonly kind: 'switches'; readonly switches: readonly MenuSwitch[] };

export interface MenuOptions {
  /** Draw the `ui_panel` plate behind the menu. */
  readonly panel: boolean;
  /** Dim the game under the menu. */
  readonly dim: boolean;
  /** Esc or P (and the browser's back gesture, later): resume, or go back. */
  readonly onBack?: () => void;
  readonly depth?: number;
}

/** The `ui_panel` nine-slice: 24 x 24 with 8 px corners (docs/ART-AND-SOUND.md section 4). */
const PANEL_CORNER = 8;
/** Opacity of the dim layer under a menu. */
const DIM_ALPHA = 0.6;

interface Target {
  /** What the button or switch says now. */
  readonly label: () => string;
  /** Where a tap counts; set by layout. */
  hit: Rect;
  readonly activate: () => void;
  /** Draws the focus (or not). */
  readonly focus: (on: boolean) => void;
}

const longest = (a: string, b: string): string => (a.length >= b.length ? a : b);

/** A tappable item of an open menu, for the test hook: its words, whether it has the focus, where it is (art px). */
export interface MenuTargetInfo {
  readonly label: string;
  readonly focused: boolean;
  readonly hit: Rect;
}

/** Menus that are on screen, oldest first (the test hook reads the newest). */
const OPEN = new Set<Menu>();

/** The tappable items of the newest open menu, or an empty list. */
export function openMenuTargets(): MenuTargetInfo[] {
  let newest: Menu | null = null;
  for (const menu of OPEN) newest = menu;
  return newest ? newest.targetInfo() : [];
}

/** The words of the menu on screen (headings and prompts, not buttons), each with whether it is drawn now; for the test hook. */
export function openMenuTexts(): { readonly text: string; readonly shown: boolean }[] {
  let newest: Menu | null = null;
  for (const menu of OPEN) newest = menu;
  return newest ? newest.textInfo() : [];
}

export class Menu {
  private readonly scene: Phaser.Scene;
  private readonly entries: readonly MenuEntry[];
  private readonly items: MenuItem[];
  private readonly dim: Phaser.GameObjects.Rectangle | null;
  private readonly panel: Phaser.GameObjects.NineSlice | null;
  /** Per entry, its drawn objects. */
  private readonly drawn: (
    | { kind: 'text'; text: Phaser.GameObjects.BitmapText; scale: number }
    | { kind: 'button'; plate: Phaser.GameObjects.NineSlice; label: Phaser.GameObjects.BitmapText; target: Target }
    | {
        kind: 'switches';
        cells: { icon: Phaser.GameObjects.Image; label: Phaser.GameObjects.BitmapText; target: Target; sw: MenuSwitch }[];
      }
  )[] = [];
  private readonly targets: Target[] = [];
  private placed: readonly Rect[] = [];
  /** The scale 1x lines and labels are drawn at now (menuLayout's textScale). */
  private textScale: 1 | 2 = 1;
  private focused = 0;
  private armed: Target | null = null;
  private readonly removers: (() => void)[] = [];
  private closed = false;

  constructor(scene: Phaser.Scene, entries: readonly MenuEntry[], options: MenuOptions) {
    this.scene = scene;
    this.entries = entries;
    const depth = options.depth ?? 0;
    this.items = entries.map((entry): MenuItem => {
      if (entry.kind === 'text') return { kind: 'text', text: entry.text, scale: entry.scale ?? 1 };
      if (entry.kind === 'button') return { kind: 'button', text: entry.text };
      return { kind: 'switches', labels: entry.switches.map((s) => longest(s.label(true), s.label(false))) };
    });

    this.dim = options.dim ? scene.add.rectangle(0, 0, 1, 1, COLOR.void, DIM_ALPHA).setOrigin(0, 0).setDepth(depth) : null;
    this.panel = options.panel ? this.plate(depth + 1) : null;

    const text = (value: string, scale: number, colour: number): Phaser.GameObjects.BitmapText =>
      scene.add
        .bitmapText(0, 0, FONT_KEY, value, FONT_SIZE * scale)
        .setTint(colour)
        .setDropShadow(1, 1, COLOR.void, 1)
        .setDepth(depth + 3);

    for (const entry of entries) {
      if (entry.kind === 'text') {
        const scale = entry.scale ?? 1;
        this.drawn.push({ kind: 'text', text: text(entry.text, scale, entry.colour ?? COLOR.white), scale });
      } else if (entry.kind === 'button') {
        const plate = this.plate(depth + 2);
        const label = text(entry.text, 1, COLOR.white);
        const target: Target = {
          label: () => entry.text,
          hit: { x: 0, y: 0, w: 0, h: 0 },
          activate: entry.onPick,
          focus: (on) => {
            label.setTint(on ? COLOR.lime : COLOR.white);
          },
        };
        this.targets.push(target);
        this.drawn.push({ kind: 'button', plate, label, target });
      } else {
        const cells = entry.switches.map((sw) => {
          const icon = scene.add
            .image(0, 0, TEXTURE_KEY.sprites, `${sw.icon}_${sw.get() ? 0 : 1}`)
            .setOrigin(0, 0)
            .setDepth(depth + 3);
          const label = text(sw.label(sw.get()), 1, COLOR.white);
          const target: Target = {
            label: () => sw.label(sw.get()),
            hit: { x: 0, y: 0, w: 0, h: 0 },
            activate: () => {
              sw.set(!sw.get());
              icon.setFrame(`${sw.icon}_${sw.get() ? 0 : 1}`);
              label.setText(sw.label(sw.get()));
            },
            focus: (on) => {
              label.setTint(on ? COLOR.lime : COLOR.white);
            },
          };
          this.targets.push(target);
          return { icon, label, target, sw };
        });
        this.drawn.push({ kind: 'switches', cells });
      }
    }

    this.layout();
    this.setFocus(0, false);
    OPEN.add(this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout);

    // Pointer: arm on the press, act on the release over the same target.
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      this.armed = this.targetAt(pointer.x, pointer.y);
    };
    const onUp = (pointer: Phaser.Input.Pointer): void => {
      const target = this.targetAt(pointer.x, pointer.y);
      const armed = this.armed;
      this.armed = null;
      if (target && target === armed) {
        this.setFocus(this.targets.indexOf(target), false);
        this.pick(target);
      }
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.removers.push(() => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp);
    });

    // Keyboard.
    this.removers.push(
      onFreshKey(scene, ['UP', 'LEFT', 'W', 'A'], () => {
        this.move(-1);
      }),
      onFreshKey(scene, ['DOWN', 'RIGHT', 'S', 'D'], () => {
        this.move(1);
      }),
      onFreshKey(scene, ['SPACE', 'ENTER'], () => {
        const target = this.targets[this.focused];
        if (target) this.pick(target);
      }),
    );
    if (options.onBack) {
      const back = options.onBack;
      this.removers.push(
        onFreshKey(scene, ['ESC', 'P'], () => {
          if (!this.closed) back();
        }),
      );
    }

    // Whichever of the scene's shutdown and destroy comes first; the other listener goes too (sceneEnd.ts).
    onSceneEnd(scene.events, () => {
      this.destroy();
    });
  }

  /** Stops reacting (the scene is closing); the objects go with the scene. */
  close(): void {
    this.closed = true;
    OPEN.delete(this);
  }

  /** The tappable items as they are now (the test hook). */
  /** Its text entries (headings, prompts) and whether each is drawn now (the title's prompt blinks). */
  textInfo(): { text: string; shown: boolean }[] {
    return this.drawn.flatMap((d) => (d.kind === 'text' ? [{ text: d.text.text, shown: d.text.visible }] : []));
  }

  targetInfo(): MenuTargetInfo[] {
    return this.targets.map((t, i) => ({ label: t.label(), focused: i === this.focused, hit: t.hit }));
  }

  /** Changes the text of a text entry (by its index among the entries). */
  setText(entryIndex: number, value: string): void {
    const drawn = this.drawn[entryIndex];
    if (drawn?.kind !== 'text') return;
    drawn.text.setText(value);
    this.layout();
  }

  /** Shows or hides a text entry without moving the others (a blinking `NEW BEST!`). */
  setTextVisible(entryIndex: number, visible: boolean): void {
    const drawn = this.drawn[entryIndex];
    if (drawn?.kind === 'text') drawn.text.setVisible(visible);
  }

  /** Where an entry was put by the last layout (art px, view coordinates), to place art around it. */
  rectOf(entryIndex: number): Rect | undefined {
    return this.placed[entryIndex];
  }

  /** What an entry covers on screen: a button's plate, a switch row, or a text line's letters (null for a blank line). */
  inkOf(entryIndex: number): Rect | null {
    const rect = this.placed[entryIndex];
    const entry = this.entries[entryIndex];
    if (!rect || !entry) return null;
    if (entry.kind !== 'text') return inkRect(rect, { kind: entry.kind });
    const drawn = this.drawn[entryIndex];
    return inkRect(rect, { kind: 'text', text: drawn?.kind === 'text' ? drawn.text.text : entry.text, scale: this.scaleOf(entry.scale) });
  }

  /** Lays the menu out for the view as it is now. Registered for Scale RESIZE. */
  readonly layout = (): void => {
    const { width, height } = this.scene.scale;
    const placed = menuLayout(width, height, cssPerArt(), this.items);
    this.placed = placed.items.map((item) => item.rect);
    const ts = placed.textScale;
    this.textScale = ts;
    const size = (text: Phaser.GameObjects.BitmapText, scale: number): void => {
      if (text.fontSize !== FONT_SIZE * scale) text.setFontSize(FONT_SIZE * scale);
    };
    this.dim?.setSize(width, height);
    this.panel?.setPosition(placed.panel.x, placed.panel.y).setSize(placed.panel.w, placed.panel.h);
    this.drawn.forEach((drawn, i) => {
      const item = placed.items[i];
      const entry = this.entries[i];
      if (!item || !entry) return;
      if (drawn.kind === 'text' && entry.kind === 'text') {
        const scale = drawnScale(entry.scale, ts);
        size(drawn.text, scale);
        const at = textOrigin(item.rect, drawn.text.text, scale);
        drawn.text.setPosition(at.x, at.y);
      } else if (drawn.kind === 'button' && entry.kind === 'button') {
        drawn.plate.setPosition(item.rect.x, item.rect.y).setSize(item.rect.w, item.rect.h);
        size(drawn.label, ts);
        const at = textOrigin(item.rect, entry.text, ts);
        drawn.label.setPosition(at.x, at.y);
        drawn.target.hit = item.rect;
      } else if (drawn.kind === 'switches') {
        drawn.cells.forEach((cell, c) => {
          const rects = item.cells[c];
          if (!rects) return;
          cell.icon.setPosition(rects.icon.x, rects.icon.y);
          size(cell.label, ts);
          cell.label.setPosition(rects.label.x, textOrigin(rects.label, 'X', ts).y);
          cell.target.hit = rects.hit;
        });
      }
    });
  };

  /** Removes the listeners. Called by itself on the scene's shutdown. */
  destroy(): void {
    this.closed = true;
    OPEN.delete(this);
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
    for (const remove of this.removers.splice(0)) remove();
  }

  private scaleOf(scale: 1 | 2 | 3 | undefined): 1 | 2 | 3 {
    return drawnScale(scale, this.textScale);
  }

  private plate(depth: number): Phaser.GameObjects.NineSlice {
    return this.scene.add
      .nineslice(0, 0, TEXTURE_KEY.sprites, 'ui_panel_0', 24, 24, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER)
      .setOrigin(0, 0)
      .setDepth(depth);
  }

  private targetAt(x: number, y: number): Target | null {
    if (this.closed) return null;
    return this.targets.find((t) => contains(t.hit, x, y)) ?? null;
  }

  private move(by: number): void {
    if (this.closed || this.targets.length === 0) return;
    this.setFocus((this.focused + by + this.targets.length) % this.targets.length, true);
  }

  private setFocus(index: number, withSound: boolean): void {
    if (index !== this.focused && withSound) sfx.play('uiMove');
    this.focused = index;
    this.targets.forEach((t, i) => {
      t.focus(i === index);
    });
  }

  private pick(target: Target): void {
    if (this.closed) return;
    sfx.play('uiOk');
    target.activate();
  }
}
