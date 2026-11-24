/**
 * Menu layout in art pixels, sized for fingers in CSS pixels (docs/ARCHITECTURE.md 11.5,
 * docs/ART-AND-SOUND.md section 9).
 *
 * The picture is drawn at a whole-number zoom, so one art pixel is `zoom / dpr` CSS px on the glass:
 * 2 or more on a phone using its whole screen, but as little as 1.0 in a browser tab whose toolbars
 * take height. A menu button 22 art px tall is then only 22 CSS px, too small to hit. So every tappable
 * row is `max(22, ceil(44 / cssPerArt))` art px tall (at least 44 CSS px) and the panel grows with its
 * rows, centred in the view. If the rows do not fit the view's height, the spacing gives way first:
 * the gaps between items, then the panel's padding above and below them, one pixel at a time down to
 * MIN_SPACING_PX. Only if the rows still do not fit do they share the height evenly (with the spacing
 * at its smallest), never below 22 art px. Small switches drawn as 12 px icons get a hit area of at
 * least 44 CSS px too.
 *
 * A menu is a list of items from top to bottom: text lines, buttons, and rows of small switches. The
 * scene builds the list with its real strings (docs/ART-AND-SOUND.md section 9 lists them), gets
 * back one rectangle per item, and draws there: the text with `textOrigin`, a button as the
 * `ui_panel` plate with its label centred, a switch as its icon with the label beside it. A button's
 * rectangle and a switch's `hit` rectangle are also what a tap must land in. Every rectangle is in
 * whole art pixels inside the view's coordinates. Recompute on every resize (`Scale.Events.RESIZE`).
 *
 * Pure: no Phaser, no DOM.
 */
import { FONT_ADVANCE, FONT_CELL_H, GLYPH_W } from '../art/font';

/** The smallest thing a finger can reliably tap, CSS px (ARCHITECTURE 11.5; the common mobile guideline). */
export const MIN_TOUCH_CSS_PX = 44;
/** A menu row is never shorter than this, art px: the button height of docs/ART-AND-SOUND.md section 9. */
export const MIN_ROW_PX = 22;
/** A menu button is at least this wide, art px (section 9: buttons of 144 x 22). */
export const BUTTON_W_PX = 144;
/** A button's label keeps this far from its ends: the 8 px corners of the `ui_panel` nine-slice. */
export const BUTTON_TEXT_INSET_PX = 8;
/** A panel is at least this wide, art px (section 9: the pause panel is 160 x 130 at the smallest). */
export const PANEL_MIN_W_PX = 160;
/** Space inside the panel's edge, and between two items. With these the pause menu is exactly 160 x 130 at 22 px rows. */
export const PANEL_PAD_PX = 7;
export const ITEM_GAP_PX = 3;
/** Where 44 CSS px rows would not fit, the gaps and then the padding above and below shrink, down to this. */
export const MIN_SPACING_PX = 1;
/** The switch icons `btn_sound` and `btn_vibe` are 12 x 12 (docs/ART-AND-SOUND.md section 4). */
export const SWITCH_ICON_PX = 12;
/** Space between a switch icon and its label. */
export const SWITCH_LABEL_GAP_PX = 3;
/** A corner switch's icon keeps at least this far from the view's edges (the top bar's text starts 3 px down). */
export const CORNER_INSET_PX = 3;

/** A rectangle in art pixels: top-left corner and size, whole numbers. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One item of a menu, top to bottom.
 * - `text`: a line drawn at `scale` (1, 2 for headings, 3 for the title's first word); not tappable.
 * - `button`: a tappable row with a centred label.
 * - `switches`: small switches side by side, one per label. Give each the LONGEST label it can show
 *   (`SOUND OFF`, not `SOUND ON`) so the layout does not move when it is toggled.
 */
export type MenuItem =
  | { readonly kind: 'text'; readonly text: string; readonly scale?: 1 | 2 | 3 }
  | { readonly kind: 'button'; readonly text: string }
  | { readonly kind: 'switches'; readonly labels: readonly string[] };

/** A small icon and the larger area where a tap on it counts (a square of at least 44 CSS px centred on the icon fits inside). */
export interface IconHit {
  readonly hit: Rect;
  readonly icon: Rect;
}

/** One switch of a switch row: its icon, its hit area, and the space right of the icon for its label. */
export interface SwitchCell extends IconHit {
  readonly label: Rect;
}

export interface PlacedItem {
  /** The item's box. For a button it is the drawn plate and the hit area; for switches, the whole row. */
  readonly rect: Rect;
  /** For `switches`, one cell per label, left to right; empty for the other kinds. */
  readonly cells: readonly SwitchCell[];
}

export interface MenuLayout {
  /** The panel, centred in the view. Draw `ui_panel` here (the title screen draws no panel). */
  readonly panel: Rect;
  /** Height of every button and switch row, art px. */
  readonly rowPx: number;
  /** True when the rows reach `MIN_TOUCH_CSS_PX` on the glass; false only when the view is too short and they share it. */
  readonly fits: boolean;
  /** One per item, in the order given. */
  readonly items: readonly PlacedItem[];
  /** The buttons' rectangles in order: what to hit-test and where keyboard focus moves. */
  readonly buttons: readonly Rect[];
  /** Every switch cell in order. */
  readonly switches: readonly SwitchCell[];
}

/** Guards `ceil` against rounding dust: 44 / (4 / 3) must give 33, not 34. */
const EPSILON = 1e-9;

/** Width in art px of a line of text at `scale`: the advance per character, less the empty column after the last. */
export function textPx(text: string, scale = 1): number {
  if (text.length === 0) return 0;
  return (text.length * FONT_ADVANCE - (FONT_ADVANCE - GLYPH_W)) * scale;
}

/** Height in art px of a text line at `scale`: one font cell. */
export function textLinePx(scale = 1): number {
  return FONT_CELL_H * scale;
}

/** Top-left corner for a text line (bitmap text has origin 0) so that it is centred in `rect`, on whole pixels. */
export function textOrigin(rect: Rect, text: string, scale = 1): { x: number; y: number } {
  return {
    x: rect.x + Math.floor((rect.w - textPx(text, scale)) / 2),
    y: rect.y + Math.floor((rect.h - textLinePx(scale)) / 2),
  };
}

/** The smallest side, in art px, of anything a finger must hit, at `cssPerArt` CSS px per art px. */
export function touchPx(cssPerArt: number): number {
  const c = cssPerArt > 0 && Number.isFinite(cssPerArt) ? cssPerArt : 1;
  return Math.ceil(MIN_TOUCH_CSS_PX / c - EPSILON);
}

/** The height of a tappable menu row: `max(22, ceil(44 * dpr / zoom))` art px (ARCHITECTURE 11.5). */
export function menuRowPx(cssPerArt: number): number {
  return Math.max(MIN_ROW_PX, touchPx(cssPerArt));
}

/**
 * Lays out a menu centred in a view of `viewW` x `viewH` art px.
 *
 * @param cssPerArt CSS px per art px: `zoom / devicePixelRatio` (`cssPerArtPx(view, dpr)` in chooseView.ts)
 * @param items     the menu, top to bottom
 */
export function menuLayout(viewW: number, viewH: number, cssPerArt: number, items: readonly MenuItem[]): MenuLayout {
  const rows = items.filter((item) => item.kind !== 'text').length;
  const textHeight = items.reduce((sum, item) => sum + (item.kind === 'text' ? textLinePx(item.scale ?? 1) : 0), 0);
  const fixedWith = (pad: number, gap: number): number => 2 * pad + textHeight + Math.max(0, items.length - 1) * gap;

  // Rows of at least 44 CSS px if they fit, giving up spacing first (the gaps, then the padding above
  // and below, down to MIN_SPACING_PX); otherwise they share the height, never below 22 art px.
  const wanted = menuRowPx(cssPerArt);
  const fitsWith = (pad: number, gap: number): boolean => rows === 0 || fixedWith(pad, gap) + rows * wanted <= viewH;
  let gap = ITEM_GAP_PX;
  let padY = PANEL_PAD_PX;
  while (!fitsWith(padY, gap) && gap > MIN_SPACING_PX) gap--;
  while (!fitsWith(padY, gap) && padY > MIN_SPACING_PX) padY--;
  const fits = fitsWith(padY, gap);
  const fixed = fixedWith(padY, gap);
  const rowPx = fits ? wanted : Math.max(MIN_ROW_PX, Math.floor((viewH - fixed) / rows));

  // Widths: every button as wide as the widest; a switch row wide enough for icons, labels and hit squares.
  const buttonW = items.reduce(
    (w, item) => (item.kind === 'button' ? Math.max(w, textPx(item.text) + 2 * BUTTON_TEXT_INSET_PX) : w),
    BUTTON_W_PX,
  );
  const iconOffset = Math.max(0, Math.floor((rowPx - SWITCH_ICON_PX) / 2));
  const cellW = (labels: readonly string[]): number => {
    const label = Math.max(0, ...labels.map((l) => textPx(l)));
    return Math.max(Math.floor(BUTTON_W_PX / Math.max(1, labels.length)), rowPx, iconOffset + SWITCH_ICON_PX + SWITCH_LABEL_GAP_PX + label);
  };
  const itemW = (item: MenuItem): number => {
    switch (item.kind) {
      case 'text':
        return textPx(item.text, item.scale ?? 1);
      case 'button':
        return buttonW;
      case 'switches':
        return cellW(item.labels) * item.labels.length;
    }
  };
  const contentW = items.reduce((w, item) => Math.max(w, itemW(item)), 0);
  const panelW = Math.min(Math.max(PANEL_MIN_W_PX, contentW + 2 * PANEL_PAD_PX), Math.max(1, viewW));
  const panelH = fixed + rows * rowPx;
  const panel: Rect = { x: Math.floor((viewW - panelW) / 2), y: Math.floor((viewH - panelH) / 2), w: panelW, h: panelH };

  const placed: PlacedItem[] = [];
  const buttons: Rect[] = [];
  const switches: SwitchCell[] = [];
  let y = panel.y + padY;
  for (const item of items) {
    const h = item.kind === 'text' ? textLinePx(item.scale ?? 1) : rowPx;
    const w = item.kind === 'text' ? Math.min(contentW, panelW) : Math.min(itemW(item), panelW);
    const rect: Rect = { x: panel.x + Math.floor((panelW - w) / 2), y, w, h };
    let cells: SwitchCell[] = [];
    if (item.kind === 'button') buttons.push(rect);
    if (item.kind === 'switches') {
      const n = item.labels.length;
      const cw = n > 0 ? Math.floor(w / n) : 0;
      cells = item.labels.map((_, i) => {
        const hit: Rect = { x: rect.x + i * cw, y, w: cw, h };
        const icon: Rect = {
          x: hit.x + Math.min(iconOffset, Math.max(0, Math.floor((cw - SWITCH_ICON_PX) / 2))),
          y: y + Math.floor((h - SWITCH_ICON_PX) / 2),
          w: SWITCH_ICON_PX,
          h: SWITCH_ICON_PX,
        };
        const labelX = icon.x + SWITCH_ICON_PX + SWITCH_LABEL_GAP_PX;
        const label: Rect = { x: labelX, y, w: Math.max(0, hit.x + cw - labelX), h };
        return { hit, icon, label };
      });
      switches.push(...cells);
    }
    placed.push({ rect, cells });
    y += h + gap;
  }

  return { panel, rowPx, fits, items: placed, buttons, switches };
}

/**
 * A lone switch in the view's top-right corner (the sound switch on the title screen): the 12 px icon
 * centred in a square hit area of at least 44 CSS px that lies inside the view.
 */
export function cornerSwitch(viewW: number, cssPerArt: number): IconHit {
  const side = Math.max(touchPx(cssPerArt), SWITCH_ICON_PX + 2 * CORNER_INSET_PX);
  const hit: Rect = { x: viewW - side, y: 0, w: side, h: side };
  const offset = Math.floor((side - SWITCH_ICON_PX) / 2);
  const icon: Rect = { x: hit.x + offset, y: offset, w: SWITCH_ICON_PX, h: SWITCH_ICON_PX };
  return { hit, icon };
}

/** True when the point (art px, in view coordinates) is inside the rectangle. */
export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}
