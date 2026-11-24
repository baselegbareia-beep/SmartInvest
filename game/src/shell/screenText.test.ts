import { describe, expect, it } from 'vitest';

import { MAX_LINE_CHARS, canDraw } from '../art/font';
import { GAME_TITLE } from '../meta';

import { textWidth } from '../art/font';

import { TEXT } from './scenes/strings';
import { NARROWEST_VIEW_PX, ROTATE_CSS_PER_ART, ROTATE_SIDE_GAP_CSS, drawnLines, lineWidth, rotateDevicePerArt } from './screenText';

describe('every fixed line on screen', () => {
  const lines = drawnLines();

  it('covers the whole list of screens', () => {
    const where = new Set(lines.map((l) => l.where.split(':')[0]));
    for (const screen of ['title', 'top bar', 'intro card', 'toast', 'level-clear banner', 'pause', 'game over', 'win', 'end', 'rotate message']) {
      expect(where, screen).toContain(screen);
    }
  });

  it('uses only characters of the pixel font', () => {
    for (const line of lines) expect(canDraw(line.text), `${line.where}: "${line.text}"`).toBe(true);
  });

  it(`fits across the narrowest view (${NARROWEST_VIEW_PX} px) at the size it is drawn, with room to spare`, () => {
    // At least 4 px clear on each side: no line may touch the edge of the picture.
    for (const line of lines) {
      expect(lineWidth(line), `${line.where}: "${line.text}" at ${line.scale}x`).toBeLessThanOrEqual(NARROWEST_VIEW_PX - 8);
    }
  });

  it(`keeps every 1x line within ${MAX_LINE_CHARS} characters`, () => {
    for (const line of lines) expect(line.text.length, `${line.where}: "${line.text}"`).toBeLessThanOrEqual(MAX_LINE_CHARS);
  });

  it('draws the game name from src/meta.ts, first word at 3x and the rest at 1x', () => {
    const [first, ...rest] = GAME_TITLE.toUpperCase().split(' ');
    expect(lines).toContainEqual(expect.objectContaining({ text: first, scale: 3 }));
    expect(lines).toContainEqual(expect.objectContaining({ text: rest.join(' '), scale: 1 }));
  });

  it('never puts lower case on screen', () => {
    for (const line of lines) expect(line.text, line.where).toBe(line.text.toUpperCase());
  });
});

describe('the rotate message (drawn by main.ts on a phone held upright)', () => {
  const art = textWidth(TEXT.rotate);
  // Portrait phones and narrow windows: CSS width and pixel ratio.
  const WINDOWS: [number, number][] = [[320, 1.5], [280, 3], [320, 4.5], [360, 2], [360, 3], [375, 2], [390, 3], [412, 2.625], [430, 3], [768, 2]];

  it('fits between the side gaps of every portrait window, and is as close to 3 CSS px per art px as that allows', () => {
    for (const [w, dpr] of WINDOWS) {
      const k = rotateDevicePerArt(w, dpr, art);
      const cssW = (art * k) / dpr;
      expect(cssW, `${w} px at ${dpr}`).toBeLessThanOrEqual(w - 2 * ROTATE_SIDE_GAP_CSS);
      expect(k, `${w} px at ${dpr}`).toBeLessThanOrEqual(Math.round(ROTATE_CSS_PER_ART * dpr));
      // One device pixel more per art pixel would not fit, unless 3 CSS px was reached already.
      const larger = (art * (k + 1)) / dpr;
      expect(larger > w - 2 * ROTATE_SIDE_GAP_CSS || k === Math.round(ROTATE_CSS_PER_ART * dpr), `${w} px at ${dpr}`).toBe(true);
    }
  });

  it('the review\'s windows: 320 px at 1.5 was 337 px wide, 280 px at 3 was 303 px', () => {
    expect((art * rotateDevicePerArt(320, 1.5, art)) / 1.5).toBeLessThanOrEqual(304);
    expect((art * rotateDevicePerArt(280, 3, art)) / 3).toBeLessThanOrEqual(264);
  });

  it('never goes below one device pixel per art pixel, however narrow', () => {
    expect(rotateDevicePerArt(50, 1, art)).toBe(1);
    expect(rotateDevicePerArt(0, 0, art)).toBe(1);
  });
});
