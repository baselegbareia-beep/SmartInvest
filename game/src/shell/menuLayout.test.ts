import { describe, expect, it } from 'vitest';

import type { ViewTuning } from '../core/types';
import { GAME_TITLE } from '../meta';
import { TUNING } from '../tuning';

import { chooseView, cssPerArtPx } from './chooseView';
import { STRIP_H } from './hudModel';
import {
  BUTTON_W_PX,
  CORNER_INSET_PX,
  ITEM_GAP_PX,
  LARGE_TEXT_BELOW,
  MIN_ROW_PX,
  MIN_SPACING_PX,
  MIN_TOUCH_CSS_PX,
  PANEL_FRAME_PX,
  PANEL_MIN_W_PX,
  PANEL_PAD_PX,
  SWITCH_ICON_PX,
  contains,
  cornerSwitch,
  drawnScale,
  menuLayout,
  menuRowPx,
  textLinePx,
  textOrigin,
  textPx,
} from './menuLayout';
import type { MenuItem, MenuLayout, MenuPlace, Rect } from './menuLayout';
import { TEXT } from './scenes/strings';

/** Ruling R11's numbers, as in chooseView.test.ts. */
const R11: ViewTuning = { viewMinCols: 17, viewMinRows: 10, viewMaxCols: 30, viewMaxRows: 14 };

/** The windows of the device table in docs/PHASER4-NOTES.md, section 6: CSS size, pixel ratio, notches. */
const DEVICES: readonly (readonly [number, number, number, number, number])[] = [
  [568, 320, 2, 0, 0],
  [667, 375, 2, 0, 0],
  [667, 325, 2, 0, 0],
  [800, 360, 3, 0, 0],
  [844, 390, 3, 47, 47],
  [844, 390, 3, 0, 0],
  [915, 412, 2.625, 0, 0],
  [915, 412, 2.625, 30, 0],
  [932, 430, 3, 59, 59],
  [1080, 810, 2, 0, 0],
  [1280, 720, 1, 0, 0],
  [1920, 1080, 1, 0, 0],
  [3440, 1300, 1, 0, 0],
  [3000, 800, 1, 0, 0],
  [740, 360, 2.75, 0, 0],
  [851, 393, 3.5, 44, 0],
  [1366, 768, 1.25, 0, 0],
  [1536, 864, 1.5, 0, 0],
  [320, 568, 2, 0, 0],
  [740, 304, 2.75, 0, 0],
  [740, 280, 2.75, 0, 0],
  [568, 232, 2, 0, 0],
];

const [titleWord = '', ...titleRest] = GAME_TITLE.toUpperCase().split(' ');

/** The screens of docs/ART-AND-SOUND.md section 9, each with the longest strings it can show. */
const SCREENS: Readonly<Record<string, readonly MenuItem[]>> = {
  title: [
    { kind: 'text', text: titleWord, scale: 3 },
    { kind: 'text', text: titleRest.join(' ') },
    { kind: 'text', text: 'BEST 07900' },
    { kind: 'button', text: 'CONTINUE - LEVEL 10' },
    { kind: 'button', text: 'NEW GAME' },
  ],
  pause: [
    { kind: 'text', text: 'PAUSED', scale: 2 },
    { kind: 'button', text: 'RESUME' },
    { kind: 'button', text: 'RESTART LEVEL -1 LIFE' },
    { kind: 'button', text: 'QUIT TO TITLE' },
    { kind: 'switches', labels: ['SOUND OFF', 'BUZZ OFF'] },
  ],
  /** The pause menu in keyboard play: the key line under the switches. */
  pauseKeys: [
    { kind: 'text', text: 'PAUSED', scale: 2 },
    { kind: 'button', text: 'RESUME' },
    { kind: 'button', text: 'RESTART LEVEL -1 LIFE' },
    { kind: 'button', text: 'QUIT TO TITLE' },
    { kind: 'switches', labels: ['SOUND OFF', 'BUZZ OFF'] },
    { kind: 'text', text: TEXT.keys },
  ],
  gameOver: [
    { kind: 'text', text: 'GAME OVER', scale: 2 },
    { kind: 'text', text: 'SCORE 04250' },
    { kind: 'text', text: 'NEW BEST!' },
    { kind: 'button', text: 'TRY AGAIN - LEVEL 10' },
    { kind: 'button', text: 'TITLE' },
  ],
  win: [
    { kind: 'text', text: 'THE FOUNDRY IS LIT!', scale: 2 },
    { kind: 'text', text: 'SCORE 06400' },
    { kind: 'text', text: 'LIVES LEFT 3 X 500' },
    { kind: 'text', text: 'TOTAL 07900' },
    { kind: 'text', text: 'NEW BEST!' },
    { kind: 'button', text: 'PLAY AGAIN' },
    { kind: 'button', text: 'TITLE' },
  ],
};

/** Where the pause menu is drawn: on the plate (menu.ts passes `framed` for a panel), off the top bar (PauseScene). */
const PAUSE_PLACE: MenuPlace = { clearTop: STRIP_H, framed: true };
/** Each screen's placement as its scene asks for it; the title and the end screens draw no plate. */
const PLACES: Readonly<Record<string, MenuPlace>> = { pause: PAUSE_PLACE, pauseKeys: PAUSE_PLACE };
const placeOf = (name: string): MenuPlace => PLACES[name] ?? {};

const whole = (r: Rect): boolean => [r.x, r.y, r.w, r.h].every(Number.isInteger);
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A view too narrow for the pause menu's labels at 2x (RESTART LEVEL -1 LIFE is 250 px there). */
const NARROW_1X = 240;

/** The padding above the first item and the gaps between items, read back from a layout. */
function spacingOf(m: MenuLayout): { pad: number; gaps: number[] } {
  const rects = m.items.map((placed) => placed.rect);
  return { pad: (rects[0]?.y ?? m.panel.y) - m.panel.y, gaps: rects.slice(1).map((r, i) => r.y - ((rects[i]?.y ?? 0) + (rects[i]?.h ?? 0))) };
}

/** The height a menu needs for 44 CSS px rows with the given padding and gap. */
function neededPx(items: readonly MenuItem[], cssPerArt: number, pad: number, gap: number, textScale: 1 | 2 = 1): number {
  const rows = items.filter((item) => item.kind !== 'text').length;
  const text = items.reduce((sum, item) => sum + (item.kind === 'text' ? textLinePx(drawnScale(item.scale, textScale)) : 0), 0);
  return 2 * pad + text + Math.max(0, items.length - 1) * gap + rows * menuRowPx(cssPerArt);
}

/** Everything wrong with one laid-out menu, placed as `place` asks. */
function problems(m: MenuLayout, items: readonly MenuItem[], viewW: number, viewH: number, cssPerArt: number, place: MenuPlace = {}): string[] {
  const out: string[] = [];
  // Spacing gives way before the rows do: shared rows only when even the tightest spacing cannot hold 44 CSS px rows,
  // and where the rows fit, the largest spacing that lets them (gaps shrink first, then the padding, which on the
  // plate stops at its frame). A menu that keeps off the top bar fits its rows under the bar wherever they can be.
  const { pad, gaps } = spacingOf(m);
  const gap = gaps[0] ?? ITEM_GAP_PX;
  const ts = m.textScale;
  const minPad = place.framed === true ? PANEL_FRAME_PX : MIN_SPACING_PX;
  const clearTop = place.clearTop ?? 0;
  const room = clearTop > 0 && neededPx(items, cssPerArt, minPad, MIN_SPACING_PX, ts) <= viewH - clearTop ? viewH - clearTop : viewH;
  if (ts === 2 && !(cssPerArt < LARGE_TEXT_BELOW)) out.push(`2x text at ${cssPerArt} CSS px per art px`);
  if (ts === 2 && !m.fits) out.push('2x text in a menu whose rows do not reach 44 CSS px');
  if (gaps.some((g) => g !== gap)) out.push(`uneven gaps ${gaps.join(', ')}`);
  if (pad < minPad || gap < MIN_SPACING_PX || pad > PANEL_PAD_PX || gap > ITEM_GAP_PX) out.push(`spacing ${pad}/${gap} out of range`);
  if (!m.fits && neededPx(items, cssPerArt, minPad, MIN_SPACING_PX, ts) <= viewH) out.push('shares the rows although tighter spacing would hold 44 CSS px rows');
  if (!m.fits && (pad !== minPad || gap !== MIN_SPACING_PX)) out.push(`shares the rows with spacing ${pad}/${gap} left over`);
  if (m.fits && pad < PANEL_PAD_PX && gap !== MIN_SPACING_PX) out.push(`the padding shrank to ${pad} before the gaps (${gap})`);
  if (m.fits && gap < ITEM_GAP_PX && pad === PANEL_PAD_PX && neededPx(items, cssPerArt, pad, gap + 1, ts) <= room) out.push(`gaps of ${gap} px where ${gap + 1} would fit`);
  if (m.fits && pad < PANEL_PAD_PX && neededPx(items, cssPerArt, pad + 1, gap, ts) <= room) out.push(`padding of ${pad} px where ${pad + 1} would fit`);
  if (place.framed === true) {
    const inner: Rect = { x: m.panel.x + PANEL_FRAME_PX, y: m.panel.y + PANEL_FRAME_PX, w: m.panel.w - 2 * PANEL_FRAME_PX, h: m.panel.h - 2 * PANEL_FRAME_PX };
    m.items.forEach((placed, i) => {
      if (!inside(placed.rect, inner)) out.push(`item ${i} ${JSON.stringify(placed.rect)} reaches into the plate's frame ${JSON.stringify(m.panel)}`);
    });
  }
  const view: Rect = { x: 0, y: 0, w: viewW, h: viewH };
  const touch = MIN_TOUCH_CSS_PX - 1e-9;

  if (m.rowPx < MIN_ROW_PX) out.push(`rows of ${m.rowPx} px are below ${MIN_ROW_PX} art px`);
  if (m.fits && m.rowPx * cssPerArt < touch) out.push(`rows are ${m.rowPx * cssPerArt} CSS px although the menu fits`);
  if (!m.fits && m.rowPx * cssPerArt >= touch) out.push('reports not fitting although the rows reach 44 CSS px');
  if (!whole(m.panel)) out.push('the panel is not on whole pixels');
  if (m.fits || m.rowPx > MIN_ROW_PX) {
    if (!inside(m.panel, view)) out.push(`the panel ${JSON.stringify(m.panel)} leaves the view`);
  }
  if (Math.abs(m.panel.x - (viewW - m.panel.x - m.panel.w)) > 1) out.push('the panel is not centred across');
  // Centred down; a menu that keeps off the top bar lies lower by as much as that needs and the view allows.
  const centredY = Math.floor((viewH - m.panel.h) / 2);
  const wantY = clearTop > 0 ? Math.max(centredY, Math.min(clearTop, viewH - m.panel.h)) : centredY;
  if (m.panel.y !== wantY) out.push(`the panel is at y = ${m.panel.y}, not ${wantY}`);
  if (room < viewH && m.panel.y < clearTop) out.push(`the panel is over the top ${clearTop} px although its rows fit under them`);
  if (m.items.length !== items.length) out.push('not one placed item per item');

  let lastBottom = -Infinity;
  m.items.forEach((placed, i) => {
    const item = items[i];
    const r = placed.rect;
    if (!whole(r)) out.push(`item ${i} is not on whole pixels`);
    if (!inside(r, m.panel)) out.push(`item ${i} ${JSON.stringify(r)} leaves the panel ${JSON.stringify(m.panel)}`);
    if (r.y < lastBottom) out.push(`item ${i} overlaps the one above`);
    lastBottom = r.y + r.h;
    if (item?.kind === 'text' && textPx(item.text, drawnScale(item.scale, ts)) > r.w) out.push(`text ${item.text} is wider than its box`);
    if (item?.kind === 'button') {
      if (r.h !== m.rowPx) out.push(`button ${item.text} is not one row tall`);
      if (r.w < BUTTON_W_PX) out.push(`button ${item.text} is narrower than ${BUTTON_W_PX}`);
      if (textPx(item.text, ts) > r.w - 2 * 8) out.push(`label ${item.text} does not fit its button`);
      if (textLinePx(ts) > r.h) out.push(`label ${item.text} is taller than its button`);
      if (m.fits && (r.w * cssPerArt < touch || r.h * cssPerArt < touch)) out.push(`button ${item.text} is smaller than 44 CSS px`);
    }
    if (item?.kind === 'switches') {
      if (placed.cells.length !== item.labels.length) out.push('not one cell per switch');
      placed.cells.forEach((cell, j) => {
        const label = item.labels[j] ?? '';
        if (!inside(cell.hit, r)) out.push(`switch ${label} leaves its row`);
        if (!inside(cell.icon, cell.hit) || !inside(cell.label, cell.hit)) out.push(`switch ${label}: icon or label outside its hit area`);
        if (cell.icon.w !== SWITCH_ICON_PX || cell.icon.h !== SWITCH_ICON_PX) out.push('the icon is not 12 px');
        if (textPx(label, ts) > cell.label.w) out.push(`switch label ${label} does not fit`);
        if (cell.label.x < cell.icon.x + cell.icon.w) out.push(`switch label ${label} overlaps its icon`);
        // A square of at least 44 CSS px (one row) centred on the icon lies inside the hit area.
        const side = m.rowPx;
        const square: Rect = {
          x: cell.icon.x + SWITCH_ICON_PX / 2 - side / 2,
          y: cell.icon.y + SWITCH_ICON_PX / 2 - side / 2,
          w: side,
          h: side,
        };
        if (!inside(square, { x: cell.hit.x - 0.5, y: cell.hit.y - 0.5, w: cell.hit.w + 1, h: cell.hit.h + 1 })) {
          out.push(`switch ${label}: no square of one row centred on the icon fits in its hit area`);
        }
        if (m.fits && side * cssPerArt < touch) out.push(`switch ${label} is smaller than 44 CSS px`);
      });
      for (let a = 0; a < placed.cells.length; a++) {
        for (let b = a + 1; b < placed.cells.length; b++) {
          const ca = placed.cells[a];
          const cb = placed.cells[b];
          if (ca && cb && overlap(ca.hit, cb.hit)) out.push('two switches share a hit area');
        }
      }
    }
  });
  // No two tappable areas overlap.
  const taps = [...m.buttons, ...m.switches.map((s) => s.hit)];
  for (let a = 0; a < taps.length; a++) {
    for (let b = a + 1; b < taps.length; b++) {
      const ta = taps[a];
      const tb = taps[b];
      if (ta && tb && overlap(ta, tb)) out.push('two tap areas overlap');
    }
  }
  return out;
}

describe('menuRowPx: the row height rule of docs/ARCHITECTURE.md 11.5', () => {
  it('is max(22, ceil(44 * dpr / zoom)) on every window of the device table, computed exactly', () => {
    for (const [cssW, cssH, dpr, left, right] of DEVICES) {
      const v = chooseView(cssW, cssH, dpr, { left, right, top: 0, bottom: 0 }, R11);
      // dpr * 8 is a whole number for every ratio in the table, so this is integer arithmetic.
      const num = 44 * dpr * 8;
      const den = v.zoom * 8;
      const exact = Math.max(22, Math.floor((num + den - 1) / den));
      expect(menuRowPx(cssPerArtPx(v, dpr)), `${cssW} x ${cssH} @${dpr}`).toBe(exact);
    }
  });

  it('is 22 art px wherever an art pixel is 2 CSS px or more, and grows below that', () => {
    expect(menuRowPx(2)).toBe(22);
    expect(menuRowPx(3.5)).toBe(22);
    expect(menuRowPx(4 / 3)).toBe(33); // not 34: rounding dust is ignored
    expect(menuRowPx(1.82)).toBe(25);
    expect(menuRowPx(1.45)).toBe(31);
    expect(menuRowPx(1)).toBe(44);
    expect(menuRowPx(0.5)).toBe(88);
  });

  it('treats a nonsensical CSS size as 1 CSS px per art px', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(menuRowPx(bad)).toBe(44);
  });
});

describe('menuLayout: the sizes of docs/ART-AND-SOUND.md section 9 at the smallest', () => {
  it('the pause menu is a 160 x 130 panel with 144 x 22 buttons where an art pixel is 2 CSS px', () => {
    const m = menuLayout(284, 160, 2, SCREENS.pause ?? []);
    expect(m.rowPx).toBe(22);
    expect({ w: m.panel.w, h: m.panel.h }).toEqual({ w: PANEL_MIN_W_PX, h: 130 });
    expect(m.buttons.map((b) => [b.w, b.h])).toEqual([
      [144, 22],
      [144, 22],
      [144, 22],
    ]);
    expect(m.switches).toHaveLength(2);
    expect(m.fits).toBe(true);
  });

  it('places items top to bottom, buttons the same width, centred across the panel', () => {
    const m = menuLayout(400, 180, 2, SCREENS.pause ?? []);
    const xs = new Set(m.buttons.map((b) => b.x));
    expect(xs.size).toBe(1);
    const ys = m.items.map((p) => p.rect.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(m.items[0]?.cells).toEqual([]);
  });
});

describe('menuLayout clearTop: the pause menu keeps off the top bar where the view has room', () => {
  const pause = SCREENS.pause ?? [];
  const pauseKeys = SCREENS.pauseKeys ?? [];
  const tab = (w: number, h: number, dpr: number): { viewW: number; viewH: number; c: number } => {
    const v = chooseView(w, h, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, R11);
    return { viewW: v.viewW, viewH: v.viewH, c: cssPerArtPx(v, dpr) };
  };

  it('568 x 320 at 2 with keys: centred, the 141 px panel began at 9, across the 14 px bar; it now begins under the bar', () => {
    const centred = menuLayout(284, 160, 2, pauseKeys);
    expect({ y: centred.panel.y, h: centred.panel.h }).toEqual({ y: 9, h: 141 });
    const clear = menuLayout(284, 160, 2, pauseKeys, PAUSE_PLACE);
    expect(clear.panel).toEqual({ ...centred.panel, y: STRIP_H });
    // Everything else moves down with it, unchanged in size.
    expect(clear.items.map((p) => p.rect)).toEqual(centred.items.map((p) => ({ ...p.rect, y: p.rect.y + STRIP_H - 9 })));
    expect(clear.panel.y + clear.panel.h).toBeLessThanOrEqual(160);
    expect(problems(clear, pauseKeys, 284, 160, 2, PAUSE_PLACE)).toEqual([]);
  });

  it('a panel already clear of the bar stays centred: the touch pause menu at 568 x 320, and 1280 x 720', () => {
    expect(menuLayout(284, 160, 2, pause, PAUSE_PLACE)).toEqual(menuLayout(284, 160, 2, pause));
    expect(menuLayout(320, 180, 4, pauseKeys, PAUSE_PLACE)).toEqual(menuLayout(320, 180, 4, pauseKeys));
  });

  it('where the room under the bar is short, the gaps give way before the panel goes over the bar', () => {
    // 150 px: centred, the 141 px panel began at 4; with the gaps at 3 it could only sit on the bottom edge, at 9.
    const m = menuLayout(284, 150, 2, pauseKeys, PAUSE_PLACE);
    expect(m.panel.y).toBe(STRIP_H);
    expect(spacingOf(m)).toEqual({ pad: PANEL_PAD_PX, gaps: [2, 2, 2, 2, 2] });
    expect(problems(m, pauseKeys, 284, 150, 2, PAUSE_PLACE)).toEqual([]);
    // A phone's browser tab, 673 x 310 at 2.625 (the re-check's window): 162 px, rows of 24. The 149 px panel lay on
    // the bottom edge, its top row on the bar's last; with gaps of 2 it is 144 px and begins under the bar.
    const t = tab(673, 310, 2.625);
    expect({ viewH: t.viewH, rowPx: menuRowPx(t.c) }).toEqual({ viewH: 162, rowPx: 24 });
    const phone = menuLayout(t.viewW, t.viewH, t.c, pauseKeys, PAUSE_PLACE);
    expect({ y: phone.panel.y, h: phone.panel.h }).toEqual({ y: STRIP_H, h: 144 });
    expect(problems(phone, pauseKeys, t.viewW, t.viewH, t.c, PAUSE_PLACE)).toEqual([]);
  });

  it('740 x 280 at 2.75 with keys (2x text): the panel began at y = 4, its frame across the bar\'s words; the padding gives way too, and it begins under the bar', () => {
    const t = tab(740, 280, 2.75);
    const m = menuLayout(t.viewW, t.viewH, t.c, pauseKeys, PAUSE_PLACE);
    expect({ viewH: t.viewH, textScale: m.textScale, fits: m.fits }).toEqual({ viewH: 192, textScale: 2, fits: true });
    expect({ y: m.panel.y, h: m.panel.h }).toEqual({ y: STRIP_H, h: 177 });
    expect(spacingOf(m)).toEqual({ pad: PANEL_FRAME_PX, gaps: [1, 1, 1, 1, 1] });
    expect(problems(m, pauseKeys, t.viewW, t.viewH, t.c, PAUSE_PLACE)).toEqual([]);
  });

  it('a menu whose rows cannot fit under the bar is laid out in the whole view, as low as it goes; one taller than the view stays centred', () => {
    // 130 px: even at the tightest spacing the keys menu needs 125 px, and 116 lie under the bar.
    const low = menuLayout(284, 130, 2, pauseKeys, PAUSE_PLACE);
    expect(low.panel.y + low.panel.h).toBe(130);
    expect(low.fits).toBe(true);
    expect(problems(low, pauseKeys, 284, 130, 2, PAUSE_PLACE)).toEqual([]);
    const tall = menuLayout(300, 100, 1, pause, { framed: true });
    expect(menuLayout(300, 100, 1, pause, PAUSE_PLACE).panel).toEqual(tall.panel);
  });

  it('on every window of the device table: never above centred, never out of the view, clear of the bar wherever its rows fit under it', () => {
    for (const items of [pause, pauseKeys]) {
      for (const [cssW, cssH, dpr, left, right] of DEVICES) {
        const v = chooseView(cssW, cssH, dpr, { left, right, top: 0, bottom: 0 }, R11);
        const c = cssPerArtPx(v, dpr);
        const centred = menuLayout(v.viewW, v.viewH, c, items, { framed: true });
        const m = menuLayout(v.viewW, v.viewH, c, items, PAUSE_PLACE);
        const where = `${cssW} x ${cssH} @${dpr}, ${items.length} items`;
        expect(m.panel.y, where).toBeGreaterThanOrEqual(centred.panel.y);
        if (centred.panel.y >= 0) expect(m.panel.y + m.panel.h, where).toBeLessThanOrEqual(v.viewH);
        if (neededPx(items, c, PANEL_FRAME_PX, MIN_SPACING_PX, m.textScale) <= v.viewH - STRIP_H) expect(m.panel.y, where).toBeGreaterThanOrEqual(STRIP_H);
        // The text scale, the rows and whether they fit do not depend on the bar.
        expect({ textScale: m.textScale, rowPx: m.rowPx, fits: m.fits }, where).toEqual({ textScale: centred.textScale, rowPx: centred.rowPx, fits: centred.fits });
        expect(problems(m, items, v.viewW, v.viewH, c, PAUSE_PLACE), where).toEqual([]);
      }
    }
  });
});

describe('menuLayout framed: a menu on the ui_panel plate keeps its items inside the frame', () => {
  const pauseKeys = SCREENS.pauseKeys ?? [];

  it('a short window at 1 CSS px per art px with keys (568 x 232 at 2, 540 x 360 at 1: 224 px): 2x text only fit padded by 1 px, across the frame; it is drawn at 1x inside it', () => {
    for (const [w, h, dpr] of [[568, 232, 2], [540, 360, 1]] as const) {
      const v = chooseView(w, h, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, R11);
      const c = cssPerArtPx(v, dpr);
      expect({ viewH: v.viewH, c }).toEqual({ viewH: 224, c: 1 });
      // Without the plate (as the title draws its menus) the tightest spacing is allowed, and 2x text fits with it.
      const bare = menuLayout(v.viewW, v.viewH, c, pauseKeys);
      expect({ textScale: bare.textScale, pad: spacingOf(bare).pad }).toEqual({ textScale: 2, pad: MIN_SPACING_PX });
      const m = menuLayout(v.viewW, v.viewH, c, pauseKeys, PAUSE_PLACE);
      expect({ textScale: m.textScale, rowPx: m.rowPx, fits: m.fits }).toEqual({ textScale: 1, rowPx: 44, fits: true });
      expect(spacingOf(m).pad).toBeGreaterThanOrEqual(PANEL_FRAME_PX);
      expect(problems(m, pauseKeys, v.viewW, v.viewH, c, PAUSE_PLACE)).toEqual([]);
    }
  });

  it('the padding gives way only down to the frame: where it would have to go further, the rows share the height', () => {
    const pause = SCREENS.pause ?? [];
    const framedTightest = neededPx(pause, 1, PANEL_FRAME_PX, MIN_SPACING_PX);
    expect(menuLayout(NARROW_1X, framedTightest, 1, pause, { framed: true }).fits).toBe(true);
    expect(spacingOf(menuLayout(NARROW_1X, framedTightest, 1, pause, { framed: true })).pad).toBe(PANEL_FRAME_PX);
    const shared = menuLayout(NARROW_1X, framedTightest - 1, 1, pause, { framed: true });
    expect(shared.fits).toBe(false);
    expect(problems(shared, pause, NARROW_1X, framedTightest - 1, 1, { framed: true })).toEqual([]);
    // Without the plate the same view still holds 44 CSS px rows, padded by less.
    expect(menuLayout(NARROW_1X, framedTightest - 1, 1, pause).fits).toBe(true);
  });
});

describe('menuLayout on every window of the device table', () => {
  for (const [name, items] of Object.entries(SCREENS)) {
    it(`${name}: rows of at least 44 CSS px (the menu fits every window), never below 22 art px, nothing outside the view, nothing overlapping`, () => {
      for (const [cssW, cssH, dpr, left, right] of DEVICES) {
        const v = chooseView(cssW, cssH, dpr, { left, right, top: 0, bottom: 0 }, R11);
        const c = cssPerArtPx(v, dpr);
        const m = menuLayout(v.viewW, v.viewH, c, items, placeOf(name));
        const where = `${cssW} x ${cssH} @${dpr}`;
        expect(m.fits, where).toBe(true);
        expect(m.rowPx * c, where).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX - 1e-9);
        expect(problems(m, items, v.viewW, v.viewH, c, placeOf(name)), where).toEqual([]);
      }
    });
  }

  it.each([
    [568, 240, 2],
    [640, 242, 2],
    [740, 241, 2.75],
    [568, 232, 2],
    [844, 233, 3],
  ])('in a phone browser tab of %i x %i at ratio %f the pause menu gets rows of 44 CSS px (the review\'s windows: 43.5 before)', (cssW, cssH, dpr) => {
    const v = chooseView(cssW, cssH, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, R11);
    const c = cssPerArtPx(v, dpr);
    for (const pause of [SCREENS.pause ?? [], SCREENS.pauseKeys ?? []]) {
      const m = menuLayout(v.viewW, v.viewH, c, pause, PAUSE_PLACE);
      expect(m.fits).toBe(true);
      expect(m.rowPx * c).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX - 1e-9);
      expect(m.panel.h).toBeLessThanOrEqual(v.viewH);
      expect(problems(m, pause, v.viewW, v.viewH, c, PAUSE_PLACE)).toEqual([]);
    }
  });

  it('gives up the gaps first, then the padding, and only then shares the rows', () => {
    const pause = SCREENS.pause ?? [];
    // 240 px: too narrow for 2x labels, so the text stays 1x and only the spacing gives way.
    const full = neededPx(pause, 1, PANEL_PAD_PX, ITEM_GAP_PX);
    expect(spacingOf(menuLayout(NARROW_1X, full, 1, pause))).toEqual({ pad: PANEL_PAD_PX, gaps: [3, 3, 3, 3] });
    expect(spacingOf(menuLayout(NARROW_1X, full - 1, 1, pause))).toEqual({ pad: PANEL_PAD_PX, gaps: [2, 2, 2, 2] });
    expect(spacingOf(menuLayout(NARROW_1X, full - 8, 1, pause))).toEqual({ pad: PANEL_PAD_PX, gaps: [1, 1, 1, 1] });
    expect(spacingOf(menuLayout(NARROW_1X, full - 9, 1, pause))).toEqual({ pad: PANEL_PAD_PX - 1, gaps: [1, 1, 1, 1] });
    const tightest = neededPx(pause, 1, MIN_SPACING_PX, MIN_SPACING_PX);
    const tight = menuLayout(NARROW_1X, tightest, 1, pause);
    expect(tight.fits).toBe(true);
    expect(tight.rowPx).toBe(44);
    expect(spacingOf(tight)).toEqual({ pad: MIN_SPACING_PX, gaps: [1, 1, 1, 1] });
    expect(menuLayout(NARROW_1X, tightest - 1, 1, pause).fits).toBe(false);
  });

  it('in the most extreme window (568 x 232 at ratio 2, one CSS px per art px) the pause menu still gets 44 CSS px rows', () => {
    const v = chooseView(568, 232, 2, { left: 0, right: 0, top: 0, bottom: 0 }, R11);
    const c = cssPerArtPx(v, 2);
    expect(c).toBe(1);
    const m = menuLayout(v.viewW, v.viewH, c, SCREENS.pause ?? []);
    expect(m.rowPx).toBe(44);
    expect(m.panel.h).toBeLessThanOrEqual(v.viewH);
  });

  it('draws the labels at 2x where an art pixel is under 1.5 CSS px and the menu still fits: 10 x 14 CSS px letters, not 5 x 7', () => {
    // An iPhone SE's tab with toolbars (568 x 232 at 2: 1.0) and a Pixel 7's (740 x 280 at 2.75: 1.45).
    for (const [w, h, dpr] of [[568, 232, 2], [740, 280, 2.75]] as const) {
      const v = chooseView(w, h, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, TUNING.view);
      const c = cssPerArtPx(v, dpr);
      expect(c).toBeLessThan(LARGE_TEXT_BELOW);
      for (const name of ['pause', 'title', 'gameOver']) {
        const items = SCREENS[name] ?? [];
        const m = menuLayout(v.viewW, v.viewH, c, items, placeOf(name));
        expect(m.textScale, `${name} at ${w} x ${h}`).toBe(2);
        expect(m.fits).toBe(true);
        expect(problems(m, items, v.viewW, v.viewH, c, placeOf(name))).toEqual([]);
      }
    }
  });

  it('a heading keeps its lead over 2x text: PAUSED, GAME OVER and THE FOUNDRY IS LIT! are drawn at 3x there, and their screens still fit', () => {
    for (const [w, h, dpr] of [[568, 232, 2], [740, 280, 2.75]] as const) {
      const v = chooseView(w, h, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, TUNING.view);
      const c = cssPerArtPx(v, dpr);
      for (const name of ['pause', 'gameOver', 'win']) {
        const items = SCREENS[name] ?? [];
        const m = menuLayout(v.viewW, v.viewH, c, items, placeOf(name));
        const scales = items.map((item) => (item.kind === 'text' ? drawnScale(item.scale, m.textScale) : m.textScale));
        const heading = scales[0] ?? 0;
        expect({ name, w, h, textScale: m.textScale, heading }).toEqual({ name, w, h, textScale: 2, heading: 3 });
        expect(Math.max(...scales.slice(1)), `${name}: the heading is the largest line`).toBeLessThan(heading);
        expect(m.fits).toBe(true);
        expect(problems(m, items, v.viewW, v.viewH, c, placeOf(name))).toEqual([]);
      }
    }
    // The title's first word stays 3x over 2x text: it is larger than everything else already.
    expect(drawnScale(3, 2)).toBe(3);
    expect(drawnScale(2, 1)).toBe(2);
    expect(drawnScale(undefined, 2)).toBe(2);
  });

  it('where a 3x heading would not fit, the whole menu stays 1x with its heading at 2x: never a heading as small as its text', () => {
    const found: string[] = [];
    for (const [name, items] of Object.entries(SCREENS)) {
      for (let w = 240; w <= 480; w += 7) {
        for (let h = 120; h <= 260; h += 5) {
          for (const c of [0.8, 1, 1.25, 1.45]) {
            const m = menuLayout(w, h, c, items);
            const heads = items.filter((item) => item.kind === 'text' && (item.scale ?? 1) > 1).map((item) => (item.kind === 'text' ? drawnScale(item.scale, m.textScale) : 0));
            for (const head of heads) if (head <= m.textScale) found.push(`${name} at ${w} x ${h} (${c}): heading ${head} over text ${m.textScale}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps 1x text where the pixels are large enough, and where 2x would not fit', () => {
    const pause = SCREENS.pause ?? [];
    expect(menuLayout(400, 300, LARGE_TEXT_BELOW, pause).textScale).toBe(1);
    expect(menuLayout(400, 300, 2, pause).textScale).toBe(1);
    // Small pixels, but a view too narrow for RESTART LEVEL -1 LIFE at 2x (250 px and the plate's corners).
    expect(menuLayout(240, 300, 1, pause).textScale).toBe(1);
    // ...or too short for the taller lines and full rows.
    const short = neededPx(pause, 1, MIN_SPACING_PX, MIN_SPACING_PX, 2) - 1;
    expect(menuLayout(400, short, 1, pause).textScale).toBe(1);
    expect(menuLayout(400, short + 1, 1, pause).textScale).toBe(2);
  });
});

describe('menuLayout: properties over a sweep of windows', () => {
  it('for every screen on the live view numbers and R11: rows never below 22 art px; 44 CSS px whenever they fit; sound geometry always', () => {
    const found: string[] = [];
    for (const t of [R11, TUNING.view]) {
      for (const dpr of [1, 1.25, 1.5, 2, 2.625, 2.75, 3, 3.5, 4]) {
        for (let cssW = 240; cssW <= 2600; cssW += 53) {
          for (let cssH = 140; cssH <= 1400; cssH += 29) {
            const v = chooseView(cssW, cssH, dpr, { left: 0, right: 0, top: 0, bottom: 0 }, t);
            const c = cssPerArtPx(v, dpr);
            for (const [name, items] of Object.entries(SCREENS)) {
              if (found.length >= 5) continue;
              const m = menuLayout(v.viewW, v.viewH, c, items, placeOf(name));
              for (const p of problems(m, items, v.viewW, v.viewH, c, placeOf(name))) found.push(`${name} ${cssW} x ${cssH} @${dpr}: ${p}`);
              const rows = items.filter((item) => item.kind !== 'text').length;
              if (!m.fits && m.rowPx > MIN_ROW_PX && v.viewH - m.panel.h >= rows) {
                // Rows that do not reach 44 CSS px must at least use all the height there is.
                found.push(`${name} ${cssW} x ${cssH} @${dpr}: shared rows leave ${v.viewH - m.panel.h} px unused`);
              }            }
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('rows that do not fit share the height evenly, with the spacing at its tightest, never below 22 art px', () => {
    const pause = SCREENS.pause ?? [];
    const fixedPx = neededPx(pause, 1, MIN_SPACING_PX, MIN_SPACING_PX) - 4 * menuRowPx(1);
    const shared = menuLayout(300, 150, 1, pause);
    expect(shared.fits).toBe(false);
    expect(shared.rowPx).toBe(Math.floor((150 - fixedPx) / 4));
    expect(shared.panel.h).toBeLessThanOrEqual(150);
    expect(problems(shared, pause, 300, 150, 1)).toEqual([]);
    const floor = menuLayout(300, 100, 1, pause);
    expect(floor.rowPx).toBe(MIN_ROW_PX);
    expect(floor.fits).toBe(false);
  });

  it('a menu without buttons (the first-visit title) is just its text', () => {
    const m = menuLayout(284, 160, 2, [
      { kind: 'text', text: titleWord, scale: 3 },
      { kind: 'text', text: 'TAP TO START' },
    ]);
    expect(m.fits).toBe(true);
    expect(m.buttons).toEqual([]);
    expect(m.switches).toEqual([]);
  });
});

describe('cornerSwitch: the title screen sound switch', () => {
  it('has a hit square of at least 44 CSS px in the top-right corner, inside the view, with the icon centred in it', () => {
    for (const [cssW, cssH, dpr, left, right] of DEVICES) {
      const v = chooseView(cssW, cssH, dpr, { left, right, top: 0, bottom: 0 }, R11);
      const c = cssPerArtPx(v, dpr);
      const s = cornerSwitch(v.viewW, c);
      const where = `${cssW} x ${cssH} @${dpr}`;
      expect(s.hit.w * c, where).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX - 1e-9);
      expect(s.hit.h, where).toBe(s.hit.w);
      expect(inside(s.hit, { x: 0, y: 0, w: v.viewW, h: v.viewH }), where).toBe(true);
      expect(s.hit.x + s.hit.w, where).toBe(v.viewW);
      expect(s.hit.y, where).toBe(0);
      expect(Math.abs(s.icon.x - s.hit.x - (s.hit.x + s.hit.w - s.icon.x - s.icon.w)), where).toBeLessThanOrEqual(1);
      expect(Math.abs(s.icon.y - s.hit.y - (s.hit.y + s.hit.h - s.icon.y - s.icon.h)), where).toBeLessThanOrEqual(1);
      expect(s.icon.y, where).toBeGreaterThanOrEqual(CORNER_INSET_PX);
      expect(v.viewW - s.icon.x - s.icon.w, where).toBeGreaterThanOrEqual(CORNER_INSET_PX);
    }
  });
});

describe('cornerSwitch off a rounded corner', () => {
  it('keeps its icon rightClearPx from the view\'s edge; the hit area still reaches the corner and is 44 CSS px wide at least', () => {
    for (const c of [1, 1.45, 2, 7 / 3, 6 / 2.75]) {
      for (const clear of [0, 4, 8, 16]) {
        const s = cornerSwitch(400, c, clear);
        expect(400 - s.icon.x - s.icon.w, `${c} ${clear}`).toBeGreaterThanOrEqual(Math.max(clear, CORNER_INSET_PX));
        expect(s.hit.x + s.hit.w).toBe(400);
        expect(s.hit.y).toBe(0);
        expect(s.hit.w * c).toBeGreaterThanOrEqual(MIN_TOUCH_CSS_PX - 1e-9);
        expect(s.icon.x).toBeGreaterThanOrEqual(s.hit.x);
      }
    }
    expect(cornerSwitch(400, 2, 0)).toEqual(cornerSwitch(400, 2));
  });
});

describe('text helpers', () => {
  it('textPx: six px per character less the empty column after the last, times the scale', () => {
    expect(textPx('')).toBe(0);
    expect(textPx('A')).toBe(5);
    expect(textPx('PAUSED')).toBe(35);
    expect(textPx('PAUSED', 2)).toBe(70);
    expect(textPx('RESTART LEVEL -1 LIFE')).toBe(125);
  });

  it('textOrigin centres a line in a box on whole pixels', () => {
    const box: Rect = { x: 10, y: 20, w: 144, h: 22 };
    const at = textOrigin(box, 'RESUME');
    expect(at).toEqual({ x: 10 + Math.floor((144 - 35) / 2), y: 20 + Math.floor((22 - 8) / 2) });
  });

  it('contains: the top and left edges are in, the bottom and right edges are out', () => {
    const r: Rect = { x: 10, y: 20, w: 5, h: 4 };
    expect(contains(r, 10, 20)).toBe(true);
    expect(contains(r, 14.9, 23.9)).toBe(true);
    expect(contains(r, 15, 20)).toBe(false);
    expect(contains(r, 10, 24)).toBe(false);
    expect(contains(r, 9.9, 21)).toBe(false);
  });
});
