/**
 * Where the touch buttons are and which one a finger is on (docs/PHASER4-NOTES.md section 14,
 * docs/ART-AND-SOUND.md section 10). Every number comes from the `touch` group of src/tuning.ts.
 *
 * All values are CSS pixels measured from the top-left corner of the pad (the window).
 *
 * The idea: the buttons that are drawn are small, the areas that react are large.
 * - LEFT and RIGHT share one invisible zone in the bottom-left corner, split down the middle.
 * - JUMP, FIRE and THRUST share one invisible zone in the bottom-right corner: a finger gets the
 *   nearest button that is shown. FIRE and THRUST exist only while their item is held, so until
 *   then the whole zone is JUMP.
 * - PAUSE has its own enlarged area in the top-right corner.
 * - All three run out to the edges of the screen, through the notch and home-bar margins.
 * - Each zone always holds its own drawn buttons whole, whatever the tuned zone sizes: those sizes
 *   only set how far the slop reaches beyond the buttons. So a new touch on a drawn button always
 *   gets that button, for any touch numbers whose drawn buttons do not overlap.
 *
 * Pure: no Phaser, no DOM.
 */
import type { TouchTuning } from '../core/types';

export const CONTROL_IDS = ['left', 'right', 'jump', 'fire', 'thrust', 'pause'] as const;
export type ControlId = (typeof CONTROL_IDS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Safe-area insets in CSS px (the notch and the home bar). Same shape as the shell's `Insets`. */
export interface SafeInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Which item buttons exist right now. */
export interface ShownItems {
  fire: boolean;
  thrust: boolean;
}

export interface ControlLayout {
  /** Where each button is drawn. LEFT, RIGHT and PAUSE are squares; JUMP, FIRE and THRUST are circles inside their square. */
  buttons: Record<ControlId, Rect>;
  /**
   * The invisible areas that react. The move zone holds LEFT and RIGHT, the action zone JUMP, FIRE
   * and THRUST, each whole. The move and action zones never overlap; PAUSE wins where its area
   * reaches into the action zone, and never covers another button.
   */
  moveZone: Rect;
  actionZone: Rect;
  pauseZone: Rect;
  /** Inside the move zone a touch left of this x is LEFT, the rest is RIGHT. */
  splitX: number;
  /**
   * A finger that already holds a button must cross a border by this much to switch: between LEFT
   * and RIGHT, and between any two of JUMP, FIRE and THRUST. It is `moveSplitHysteresis` (scaled),
   * but never more than half the gap between LEFT and RIGHT.
   */
  splitHysteresis: number;
  /**
   * 1 wherever the safe area is at least `minimumPadSize`: every phone held sideways in full
   * screen. In a smaller window (a narrow preview frame, a very short browser tab) the whole
   * layout shrinks by this factor instead of letting two buttons overlap.
   */
  scale: number;
}

const ITEM_IDS = ['fire', 'thrust'] as const;

/**
 * The smallest safe area (CSS px) in which the tuned layout fits at full size: LEFT and RIGHT beside
 * the action buttons, PAUSE above them, with at least the LEFT-to-RIGHT gap between the groups.
 */
export function minimumPadSize(t: TouchTuning): { w: number; h: number } {
  const moveW = t.moveMarginSide + 2 * t.moveButtonSize + t.moveButtonGap;
  const rightW = Math.max(
    t.jumpMarginSide + t.jumpButtonSize,
    t.fireMarginSide + t.fireButtonSize,
    t.thrustMarginSide + t.thrustButtonSize,
    t.pauseMarginSide + t.pauseButtonSize,
  );
  const topH = t.pauseMarginTop + t.pauseButtonSize;
  const bottomH = Math.max(
    t.jumpMarginBottom + t.jumpButtonSize,
    t.fireMarginBottom + t.fireButtonSize,
    t.thrustMarginBottom + t.thrustButtonSize,
    t.moveMarginBottom + t.moveButtonSize,
  );
  return { w: moveW + t.moveButtonGap + rightW, h: topH + t.moveButtonGap + bottomH };
}

const square = (x: number, y: number, size: number): Rect => ({ x, y, w: size, h: size });
const fromEdges = (x0: number, y0: number, x1: number, y1: number): Rect => ({
  x: x0,
  y: y0,
  w: Math.max(0, x1 - x0),
  h: Math.max(0, y1 - y0),
});

/** How the item buttons share the bottom row in this level. */
export interface ItemSlots {
  /**
   * True in a level without a thruster pack: FIRE then takes the place beside JUMP that THRUST has in the other
   * levels (`thrustMarginSide`), instead of its own one further in (`fireMarginSide`), which would leave a gap and
   * put FIRE over the floor a few tiles ahead of the hero. Fixed for a whole level, so a button never moves under
   * a thumb.
   */
  readonly fireBesideJump: boolean;
}

/** Both item buttons in their own places (FIRE, THRUST, JUMP along the bottom row). */
export const BOTH_ITEMS: ItemSlots = Object.freeze({ fireBesideJump: false });

/**
 * Lays the pad out in a window of `vw` by `vh` CSS px whose safe area is inset by `safe`.
 * Buttons have their tuned size and their tuned distance from the safe edges; see
 * `ControlLayout.scale` for windows that are too small for that. `slots`: where FIRE goes in this level.
 */
export function layoutControls(vw: number, vh: number, safe: SafeInsets, t: TouchTuning, slots: ItemSlots = BOTH_ITEMS): ControlLayout {
  const left = safe.left;
  const right = vw - safe.right;
  const top = safe.top;
  const bottom = vh - safe.bottom;

  const need = minimumPadSize(t);
  const scale = Math.max(0, Math.min(1, (right - left) / need.w, (bottom - top) / need.h));
  const k = (cssPx: number): number => cssPx * scale;
  /** A button measured from the right and bottom safe edges. */
  const corner = (marginSide: number, marginBottom: number, size: number): Rect =>
    square(right - k(marginSide + size), bottom - k(marginBottom + size), k(size));

  const moveY = bottom - k(t.moveMarginBottom + t.moveButtonSize);
  const buttons: Record<ControlId, Rect> = {
    left: square(left + k(t.moveMarginSide), moveY, k(t.moveButtonSize)),
    right: square(left + k(t.moveMarginSide + t.moveButtonSize + t.moveButtonGap), moveY, k(t.moveButtonSize)),
    jump: corner(t.jumpMarginSide, t.jumpMarginBottom, t.jumpButtonSize),
    fire: slots.fireBesideJump ? corner(t.thrustMarginSide, t.thrustMarginBottom, t.fireButtonSize) : corner(t.fireMarginSide, t.fireMarginBottom, t.fireButtonSize),
    thrust: corner(t.thrustMarginSide, t.thrustMarginBottom, t.thrustButtonSize),
    pause: square(right - k(t.pauseMarginSide + t.pauseButtonSize), top + k(t.pauseMarginTop), k(t.pauseButtonSize)),
  };

  // Each bottom zone reaches its tuned size from the corner, and always at least round its own drawn
  // buttons: a tuned size smaller than the buttons it feeds never leaves part of one dead. Where the
  // window is too narrow for both zones at their tuned size, they meet half-way between RIGHT and
  // the left-most action button. That line only trims the slop: `scale` keeps the two groups of
  // buttons at least `moveButtonGap` apart, so it never runs through a drawn button.
  const moveRight = buttons.right.x + buttons.right.w;
  const actionLeft = Math.min(buttons.jump.x, buttons.fire.x, buttons.thrust.x);
  const actionTop = Math.min(buttons.jump.y, buttons.fire.y, buttons.thrust.y);
  const midX = (moveRight + actionLeft) / 2;
  const moveZone = fromEdges(
    0,
    Math.min(moveY, Math.max(0, bottom - k(t.moveZoneHeight))),
    Math.max(moveRight, Math.min(left + k(t.moveZoneWidth), midX)),
    vh,
  );
  const actionZone = fromEdges(
    Math.min(actionLeft, Math.max(right - k(t.actionZoneSize), midX)),
    Math.min(actionTop, Math.max(0, bottom - k(t.actionZoneSize))),
    vw,
    vh,
  );

  // PAUSE reacts over its tuned hit size (not shrunk with the drawing): the button grown evenly,
  // then out to the corner of the screen, and at least the hit size both ways. It never reaches so
  // far down that it would cover part of another button.
  const pause = buttons.pause;
  const grow = Math.max(0, (t.pauseHitSize - pause.w) / 2);
  const highestOther = Math.min(buttons.left.y, buttons.right.y, buttons.jump.y, buttons.fire.y, buttons.thrust.y);
  const pauseBottom = pause.y + pause.h;
  const pauseZone = fromEdges(
    Math.max(0, Math.min(pause.x - grow, vw - t.pauseHitSize)),
    0,
    vw,
    Math.max(pauseBottom, Math.min(Math.max(pauseBottom + grow, t.pauseHitSize), highestOther)),
  );

  return {
    buttons,
    moveZone,
    actionZone,
    pauseZone,
    splitX: left + k(t.moveMarginSide + t.moveButtonSize + t.moveButtonGap / 2),
    // Never more than half the gap between LEFT and RIGHT: a finger on drawn LEFT or RIGHT always gets it.
    splitHysteresis: k(Math.max(0, Math.min(t.moveSplitHysteresis, t.moveButtonGap / 2))),
    scale,
  };
}

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

// ---------------------------------------------------------------------------------------
// Device pixels (for drawing: the glyphs are pixel art)
// ---------------------------------------------------------------------------------------

/** A length or position in CSS px moved to the nearest whole device pixel. */
export function toDevicePx(cssPx: number, dpr: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return Math.round(cssPx * d) / d;
}

/**
 * A drawn rectangle with all four edges on whole device pixels. At ratios such as 2.75 or 2.625 the
 * layout's CSS px fall between device pixels; a glyph centred in such a button had its outer rows
 * and columns blended with the button's fill.
 */
export function snapRect(r: Rect, dpr: number): Rect {
  const x = toDevicePx(r.x, dpr);
  const y = toDevicePx(r.y, dpr);
  return { x, y, w: toDevicePx(r.x + r.w, dpr) - x, h: toDevicePx(r.y + r.h, dpr) - y };
}

/**
 * The offset that centres a glyph `glyph` CSS px long in a space `space` CSS px long, as a whole number of
 * device pixels (rounded down where the two leave an odd number): with both on whole device pixels the
 * glyph lands on them too.
 */
export function centreOnDevicePx(space: number, glyph: number, dpr: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return Math.floor(Math.round((space - glyph) * d) / 2) / d;
}

/** True when (x, y) is inside one of the three zones that take touches (where a new touch belongs to the pad). */
export function onPadZone(l: ControlLayout, x: number, y: number): boolean {
  return inside(l.moveZone, x, y) || inside(l.actionZone, x, y) || inside(l.pauseZone, x, y);
}

/** Distance from a point to the rim of a round button (negative inside it). */
function rimDistance(r: Rect, x: number, y: number): number {
  const dx = x - (r.x + r.w / 2);
  const dy = y - (r.y + r.h / 2);
  return Math.sqrt(dx * dx + dy * dy) - r.w / 2;
}

/**
 * Which control a finger at (x, y) is on, or null when it is on none.
 *
 * `prev` is the control the same finger was on a moment ago (null for a new touch). It matters only
 * on a border between two buttons, where it stops flicker: a finger keeps the button it holds until
 * it has crossed the border by `splitHysteresis`. Between JUMP, FIRE and THRUST the border is the
 * line where the two rims are equally far, and the rule holds even where two drawn circles touch, so
 * a thumb resting on the seam does not flicker between them.
 *
 * What a finger on a drawn button gets (for any touch numbers whose drawn buttons do not overlap):
 * - a new touch always gets that button;
 * - a finger sliding onto LEFT or RIGHT always gets it (the hysteresis is at most half their gap);
 * - a finger sliding onto JUMP, FIRE or THRUST from a neighbour gets it at the latest once it is
 *   `splitHysteresis` inside the drawn circle; at once wherever the two rims are at least twice
 *   that apart, as they are with the shipped numbers.
 * FIRE and THRUST are never returned while they are not shown.
 */
export function hitTest(l: ControlLayout, shown: ShownItems, x: number, y: number, prev: ControlId | null): ControlId | null {
  if (inside(l.pauseZone, x, y)) return 'pause';

  if (inside(l.moveZone, x, y)) {
    if (prev === 'left') return x >= l.splitX + l.splitHysteresis ? 'right' : 'left';
    if (prev === 'right') return x < l.splitX - l.splitHysteresis ? 'left' : 'right';
    return x < l.splitX ? 'left' : 'right';
  }

  if (inside(l.actionZone, x, y)) {
    let best: ControlId = 'jump';
    let bestDistance = rimDistance(l.buttons.jump, x, y);
    for (const id of ITEM_IDS) {
      if (!shown[id]) continue;
      const d = rimDistance(l.buttons[id], x, y);
      if (d < bestDistance) {
        best = id;
        bestDistance = d;
      }
    }
    const holdsAction = prev === 'jump' || ((prev === 'fire' || prev === 'thrust') && shown[prev]);
    // Moving a distance d across the border, along the line between the two centres, changes the
    // difference of the two rim distances by 2 d. Applied inside a drawn circle too: where two
    // circles (nearly) touch, the border runs through them, and only this keeps a resting thumb
    // from switching back and forth.
    if (holdsAction && prev !== best && rimDistance(l.buttons[prev], x, y) - bestDistance < 2 * l.splitHysteresis) return prev;
    return best;
  }

  return null;
}
