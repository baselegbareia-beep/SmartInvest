/**
 * The touch pad: a DOM overlay above the canvas, driven by Pointer Events
 * (docs/PHASER4-NOTES.md section 14, docs/ART-AND-SOUND.md section 10).
 *
 * It only translates fingers into `Controls.set('touch', button, down)`: no game logic.
 *
 * How it works:
 * - It builds its own elements inside the element it is given: three invisible zones that take
 *   `pointerdown`, and six drawn buttons that take nothing. Places and sizes come from the pure
 *   `layoutControls`; looks come from `TUNING.touch` through touchpad.css.
 * - ONE tracker holds every active pointer. On every pointer event each of them is tested again
 *   against the pure `hitTest`, so a thumb slides from LEFT to RIGHT (or from JUMP to THRUST)
 *   without lifting, several fingers just work, and a finger that slides off lets go.
 *   (One handler per button cannot do this: a touch stays captured by the element it began on.)
 * - PAUSE acts on touch down, through a callback, and is never a held control.
 * - Everything is let go of on touch cancel, window blur, a hidden page, `hide()` and `dispose()`.
 *
 * The pad is on screen only while BOTH are true: touch mode is on (`setTouchMode`, a touch device)
 * and the game wants it (`show()` while a level is played, `hide()` under every menu). Menus are
 * drawn on the canvas, under the pad's zones: a pad left showing would swallow their taps.
 *
 * Create one pad for the whole game (it belongs with the shell's singletons) and give it `#app`,
 * so that it goes full screen together with the canvas. index.html needs no markup and no CSS
 * for it: the stylesheet below is the pad's own.
 */
import type { TouchTuning } from '../core/types';

import { BUTTONS } from './Controls';
import type { Controls } from './Controls';
import { BOTH_ITEMS, CONTROL_IDS, centreOnDevicePx, hitTest, layoutControls, onPadZone, snapRect, toDevicePx } from './touchLayout';
import type { ControlId, ControlLayout, ItemSlots, Rect, SafeInsets, ShownItems } from './touchLayout';

import './touchpad.css';

// ---------------------------------------------------------------------------
// The tracker: pure bookkeeping, no DOM. Exported for its unit test.
// ---------------------------------------------------------------------------

interface TrackedPointer {
  x: number;
  y: number;
  /** The control this pointer was on after the last event (the `prev` of `hitTest`). */
  on: ControlId | null;
}

export class PointerTracker {
  private readonly pointers = new Map<number, TrackedPointer>();
  private readonly shown: ShownItems = { fire: false, thrust: false };
  private layout: ControlLayout | null = null;
  private readonly controls: Controls;
  private readonly onPause: () => void;
  private readonly onChange: (pressed: ReadonlySet<ControlId>) => void;

  /**
   * @param onPause  called when a new pointer lands on PAUSE
   * @param onChange called after every change with the controls that are pressed now (for highlights)
   */
  constructor(controls: Controls, onPause: () => void, onChange: (pressed: ReadonlySet<ControlId>) => void = () => undefined) {
    this.controls = controls;
    this.onPause = onPause;
    this.onChange = onChange;
  }

  /** How many pointers are being followed. */
  get count(): number {
    return this.pointers.size;
  }

  /** A new layout (the window changed). Pointers that are down are tested against it at once. */
  setLayout(layout: ControlLayout | null): void {
    this.layout = layout;
    this.recompute();
  }

  /** Which item buttons exist. A finger on a button that vanishes falls to the nearest one left. */
  setShown(fire: boolean, thrust: boolean): void {
    if (this.shown.fire === fire && this.shown.thrust === thrust) return;
    this.shown.fire = fire;
    this.shown.thrust = thrust;
    this.recompute();
  }

  /** A pointer went down at (x, y), in pad coordinates. */
  down(id: number, x: number, y: number): void {
    if (!this.layout) return;
    if (hitTest(this.layout, this.shown, x, y, null) === 'pause') {
      this.onPause(); // PAUSE is a tap, not a held control: this pointer is not followed
      return;
    }
    this.pointers.set(id, { x, y, on: null });
    this.recompute();
  }

  /**
   * A pointer went down somewhere on the page, not on one of the zones' elements: taken as `down` when it is
   * inside a zone (as if the zone had taken it), ignored otherwise. Returns whether it was taken.
   */
  downIfOnPad(id: number, x: number, y: number): boolean {
    if (!this.layout || !onPadZone(this.layout, x, y)) return false;
    this.down(id, x, y);
    return true;
  }

  /** A pointer moved. Pointers that never went down on the pad are ignored. */
  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    this.recompute();
  }

  /** A pointer was lifted or cancelled. */
  up(id: number): void {
    if (this.pointers.delete(id)) this.recompute();
  }

  /** Forgets every pointer and lets go of every touch button. Fingers still down stay forgotten until they touch again. */
  releaseAll(): void {
    this.pointers.clear();
    this.recompute();
    this.controls.releaseAll('touch');
  }

  /** Tests every active pointer again and reports all five buttons, in one go. */
  private recompute(): void {
    const pressed = new Set<ControlId>();
    if (this.layout) {
      for (const p of this.pointers.values()) {
        p.on = hitTest(this.layout, this.shown, p.x, p.y, p.on);
        if (p.on !== null && p.on !== 'pause') pressed.add(p.on);
      }
    }
    for (const b of BUTTONS) this.controls.set('touch', b, pressed.has(b));
    this.onChange(pressed);
  }
}

// ---------------------------------------------------------------------------
// The DOM overlay
// ---------------------------------------------------------------------------

export interface TouchPadOptions {
  /** PAUSE was touched. Called on touch down; open the pause menu and call `hide()`. */
  onPause: () => void;
  /**
   * The art of a button: an element (a small canvas at a whole number of CSS px per art px) that is
   * centred inside the button. Called once per button when the pad is built, and again by
   * `redrawGlyphs()`. Without it the buttons are plain shapes.
   */
  glyph?: (id: ControlId) => HTMLElement | null;
}

export interface TouchPad {
  /** The pad's root element (class `touchpad`; the buttons are `[data-btn="left"]` and so on). */
  readonly element: HTMLElement;
  /** Touch mode on or off (off at first). Off hides the pad whatever `show()` said. */
  setTouchMode(on: boolean): void;
  /** The game wants the pad: a level is being played. */
  show(): void;
  /** A menu, the title or an end screen is up. Also lets go of every touch. */
  hide(): void;
  /** True while the pad is on screen (touch mode on and shown). */
  isVisible(): boolean;
  /**
   * Which item buttons exist and which are dimmed. Call it every rendered frame while playing:
   * `setItems(hasBlaster, hasThruster, bolt.active, fuel === 0)`. Cheap when nothing changed.
   */
  setItems(fire: boolean, thrust: boolean, fireDimmed?: boolean, thrustDimmed?: boolean): void;
  /**
   * Where the item buttons go in the level about to be played (`layoutControls`' ItemSlots): FIRE beside JUMP in a
   * level without a thruster pack. Call it when a level starts, never during one: a button must not move under a thumb.
   */
  setSlots(slots: ItemSlots): void;
  /** Measures the window and the safe area again. The pad does this by itself on every resize and rotation. */
  layout(): void;
  /**
   * Builds every glyph again (`options.glyph`) and lays the pad out. Call it when the device pixel ratio changed
   * (browser zoom, a display-size change, the window moved to another screen): a glyph is drawn at a whole number of
   * DEVICE px per art px for the ratio it was built at, and at any other its art pixels come out uneven (8 and 9).
   */
  redrawGlyphs(): void;
  /**
   * Where each button is drawn, in CSS px of the window (null before the pad was first measured), whether or
   * not the pad is on screen. The camera keeps the hero clear of them (src/shell/camera.ts, PadReach).
   */
  buttonsOnPage(): Readonly<Record<ControlId, Rect>> | null;
  /**
   * The touch that turned touch mode on. While the pad was hidden the browser had already picked the canvas
   * as that touch's target, so the zones never hear of it: without this, after a key press had hidden the
   * pad, the first touch on a button pressed nothing. Call it right after `setTouchMode(true)`, inside the
   * same pointerdown. A touch inside a zone is taken as if it had landed there; any other is left alone.
   */
  takeFirstTouch(event: PointerEvent): void;
  /** Lets go of every touch (pause, blur, scene end). */
  releaseAll(): void;
  /** Removes the elements and every listener. */
  dispose(): void;
}

const LABELS: Record<ControlId, string> = {
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  fire: 'Fire',
  thrust: 'Thrust',
  pause: 'Pause',
};
const ROUND: ReadonlySet<ControlId> = new Set<ControlId>(['jump', 'fire', 'thrust']);
const ITEMS: ReadonlySet<ControlId> = new Set<ControlId>(['fire', 'thrust']);
const ZONE_IDS = ['move', 'action', 'pause'] as const;
/** The rim of a drawn button (docs/ART-AND-SOUND.md section 10: a 2 px rim), CSS px at full size. */
const RIM_CSS_PX = 2;

/**
 * Builds the pad inside `parent`, which must cover the window (`#app`). The pad starts hidden:
 * call `setTouchMode(true)` on a touch device and `show()` when a level starts.
 */
export function createTouchPad(parent: HTMLElement, controls: Controls, t: TouchTuning, options: TouchPadOptions): TouchPad {
  const root = document.createElement('div');
  root.className = 'touchpad';

  const zones = new Map<(typeof ZONE_IDS)[number], HTMLElement>();
  for (const id of ZONE_IDS) {
    const el = document.createElement('div');
    el.className = 'touchpad__zone';
    el.dataset.zone = id;
    root.append(el);
    zones.set(id, el);
  }
  const buttons = new Map<ControlId, HTMLElement>();
  const glyphs = new Map<ControlId, HTMLElement>();
  for (const id of CONTROL_IDS) {
    const el = document.createElement('div');
    el.className = 'touchpad__btn';
    el.classList.toggle('touchpad__btn--round', ROUND.has(id));
    el.classList.toggle('touchpad__btn--item', ITEMS.has(id));
    el.dataset.btn = id;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', LABELS[id]);
    const art = options.glyph?.(id);
    if (art) {
      el.append(art);
      glyphs.set(id, art);
    }
    root.append(el);
    buttons.set(id, el);
  }

  /** Replaces each glyph with a new one from `options.glyph` (the old one goes). */
  const buildGlyphs = (): void => {
    for (const [id, el] of buttons) {
      const art = options.glyph?.(id) ?? null;
      const old = glyphs.get(id);
      if (old) old.remove();
      glyphs.delete(id);
      if (art) {
        el.append(art);
        glyphs.set(id, art);
      }
    }
  };

  // Looks are tuning values too: hand them to the stylesheet as custom properties.
  root.style.setProperty('--pad-idle', String(t.opacityIdle));
  root.style.setProperty('--pad-pressed', String(t.opacityPressed));
  root.style.setProperty('--pad-dimmed', String(t.opacityDimmed));
  root.style.setProperty('--pad-pressed-scale', String(t.pressedScale));
  root.style.setProperty('--pad-appear', `${t.appearMs}ms`);
  root.style.setProperty('--pad-scale', '1');
  parent.append(root);

  const tracker = new PointerTracker(controls, options.onPause, (pressed) => {
    for (const [id, el] of buttons) el.classList.toggle('is-on', pressed.has(id));
  });

  let touchMode = false;
  let wanted = false;
  let visible = false;
  // The pad's top-left corner in the window: pointer positions arrive in window coordinates.
  let originX = 0;
  let originY = 0;
  let onPage: Record<ControlId, Rect> | null = null;

  const place = (el: HTMLElement | undefined, r: Rect): void => {
    if (!el) return;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  /** The safe-area insets, read back from the padding that touchpad.css builds from env(). */
  const readInsets = (): SafeInsets => {
    const style = getComputedStyle(root);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    return {
      left: px(style.paddingLeft),
      right: px(style.paddingRight),
      top: px(style.paddingTop),
      bottom: px(style.paddingBottom),
    };
  };

  let slots: ItemSlots = BOTH_ITEMS;
  const relayout = (): void => {
    const box = root.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return; // not on the page: keep the last layout
    originX = box.left;
    originY = box.top;
    const l = layoutControls(box.width, box.height, readInsets(), t, slots);
    root.style.setProperty('--pad-scale', String(l.scale));
    // Drawn on whole device pixels: the buttons, their rims and the glyphs inside them (pixel art). The hit test
    // keeps the exact layout; the two differ by less than half a device pixel.
    const dpr = window.devicePixelRatio || 1;
    const rim = Math.max(1, Math.round(RIM_CSS_PX * l.scale * dpr)) / dpr;
    root.style.setProperty('--pad-rim', `${rim}px`);
    for (const [id, el] of buttons) {
      const r = snapRect({ x: l.buttons[id].x + originX, y: l.buttons[id].y + originY, w: l.buttons[id].w, h: l.buttons[id].h }, dpr);
      place(el, { x: r.x - originX, y: r.y - originY, w: r.w, h: r.h });
      const glyph = glyphs.get(id);
      if (glyph) {
        const style = getComputedStyle(glyph);
        const gw = toDevicePx(Number.parseFloat(style.width) || 0, dpr);
        const gh = toDevicePx(Number.parseFloat(style.height) || 0, dpr);
        glyph.style.left = `${centreOnDevicePx(r.w, gw, dpr)}px`;
        glyph.style.top = `${centreOnDevicePx(r.h, gh, dpr)}px`;
      }
    }
    place(zones.get('move'), l.moveZone);
    place(zones.get('action'), l.actionZone);
    place(zones.get('pause'), l.pauseZone);
    tracker.setLayout(l);
    const at = (r: Rect): Rect => ({ x: r.x + originX, y: r.y + originY, w: r.w, h: r.h });
    const b = l.buttons;
    onPage = { left: at(b.left), right: at(b.right), jump: at(b.jump), fire: at(b.fire), thrust: at(b.thrust), pause: at(b.pause) };
  };

  const releaseAll = (): void => {
    tracker.releaseAll();
  };

  const applyVisibility = (): void => {
    const next = touchMode && wanted;
    if (next === visible) return;
    visible = next;
    root.classList.toggle('is-visible', visible);
    if (visible) relayout();
    else releaseAll();
  };

  const abort = new AbortController();
  const opts: AddEventListenerOptions = { signal: abort.signal };

  // Only the zones take pointerdown; it bubbles to the root. Move, up and cancel are heard on the
  // window, because a touch keeps reporting to the element it began on wherever the finger goes.
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); // no focus change, no compatibility mouse events
      if (e.pointerType !== 'touch' && e.target instanceof Element) {
        // A mouse (?touch=1 on a desktop) is not captured by itself: without this its release
        // would go to whatever is under the cursor, or be lost outside the window.
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {
          // the pointer is already gone: nothing to capture
        }
      }
      tracker.down(e.pointerId, e.clientX - originX, e.clientY - originY);
    },
    opts,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      tracker.move(e.pointerId, e.clientX - originX, e.clientY - originY);
    },
    opts,
  );
  const up = (e: PointerEvent): void => {
    tracker.up(e.pointerId);
  };
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', up, opts);

  window.addEventListener('blur', releaseAll, opts);
  window.addEventListener('pagehide', releaseAll, opts);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) releaseAll();
    },
    opts,
  );

  // No long-press menu, no dragging a glyph away, no text selection.
  const prevent = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };
  for (const type of ['contextmenu', 'dragstart', 'selectstart']) root.addEventListener(type, prevent, opts);
  // Touch events always go to the element the touch began on, so these two see the pad's own
  // touches and no others. Cancelling the end of a touch stops the `click` that follows a tap: by
  // then a tap on PAUSE has hidden the pad, and the click would land on whatever is underneath.
  // Cancelling its start is the usual belt and braces on phones where the CSS is not enough
  // (double-tap zoom, the magnifier, a swipe from the screen edge). Pointer events are not affected.
  for (const type of ['touchstart', 'touchend']) root.addEventListener(type, prevent, { signal: abort.signal, passive: false });

  window.addEventListener('resize', relayout, opts);
  window.addEventListener('orientationchange', relayout, opts);
  window.visualViewport?.addEventListener('resize', relayout, opts);
  // The parent can change size with no window event (fullscreen in and out).
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(relayout);
  observer?.observe(root);

  relayout();

  let lastItems = -1;
  return {
    element: root,
    setTouchMode(on) {
      touchMode = on;
      applyVisibility();
    },
    show() {
      wanted = true;
      applyVisibility();
    },
    hide() {
      wanted = false;
      applyVisibility();
    },
    isVisible: () => visible,
    setSlots(next) {
      if (next.fireBesideJump === slots.fireBesideJump) return;
      slots = next;
      relayout();
    },
    setItems(fire, thrust, fireDimmed = false, thrustDimmed = false) {
      const items = (fire ? 1 : 0) | (thrust ? 2 : 0) | (fireDimmed ? 4 : 0) | (thrustDimmed ? 8 : 0);
      if (items === lastItems) return;
      lastItems = items;
      const fireEl = buttons.get('fire');
      const thrustEl = buttons.get('thrust');
      fireEl?.classList.toggle('is-shown', fire);
      fireEl?.classList.toggle('is-dim', fireDimmed);
      thrustEl?.classList.toggle('is-shown', thrust);
      thrustEl?.classList.toggle('is-dim', thrustDimmed);
      tracker.setShown(fire, thrust);
    },
    layout: relayout,
    redrawGlyphs() {
      buildGlyphs();
      relayout();
    },
    buttonsOnPage: () => onPage,
    takeFirstTouch(event) {
      if (!visible) return;
      if (tracker.downIfOnPad(event.pointerId, event.clientX - originX, event.clientY - originY)) event.preventDefault();
    },
    releaseAll,
    dispose() {
      abort.abort();
      observer?.disconnect();
      releaseAll();
      root.remove();
    },
  };
}
