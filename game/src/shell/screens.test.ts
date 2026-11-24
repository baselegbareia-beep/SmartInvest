import { describe, expect, it } from 'vitest';

import { TUNING } from '../tuning';

import { textLinePx, textPx } from './menuLayout';
import type { Rect } from './menuLayout';
import {
  BANNER_Y,
  BEST_BLINK_PERIOD,
  GIRDER_TILES,
  SHUTTER_FRAMES,
  WIN_LINE_FRAMES,
  bannerLayout,
  blinkShown,
  endLines,
  glowBands,
  inkRect,
  introLayout,
  wrapInTwo,
  ridgeRow,
  screenLabel,
  shutterBlades,
  splitTitle,
  titleBest,
  titleScenery,
} from './screens';

const inside = (r: Rect, w: number, h: number): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

describe('shutterBlades', () => {
  it('is shut at the start: the two blades cover the whole view', () => {
    for (const h of [160, 161, 195, 224]) {
      const b = shutterBlades(0, h);
      expect(b.topH + b.bottomH, `height ${h}`).toBeGreaterThanOrEqual(h);
      expect(b.bottomY).toBeLessThanOrEqual(b.topH);
    }
  });

  it(`is open after ${SHUTTER_FRAMES} frames, and opens a little every frame`, () => {
    let last = Infinity;
    for (let f = 0; f <= SHUTTER_FRAMES; f++) {
      const b = shutterBlades(f, 180);
      expect(b.topH, `frame ${f}`).toBeLessThan(last);
      expect(Number.isInteger(b.topH) && Number.isInteger(b.bottomY) && Number.isInteger(b.bottomH)).toBe(true);
      expect(b.bottomY + b.bottomH).toBe(180);
      last = b.topH;
    }
    expect(shutterBlades(SHUTTER_FRAMES, 180)).toEqual({ topH: 0, bottomY: 180, bottomH: 0 });
    expect(shutterBlades(99, 180).topH).toBe(0);
  });
});

describe('endLines', () => {
  const lifePoints = TUNING.score.lifeLeft;

  it('game over: GAME OVER in amber at 2x, the score, and BEST with the larger best', () => {
    const lines = endLines({ outcome: 'gameOver', score: 4250, lives: 0, lifeBonus: 0, previousBest: 6100 }, lifePoints);
    expect(lines.map((l) => [l.text, l.scale, l.colour, l.showAt, l.blink])).toEqual([
      ['GAME OVER', 2, 'amber', 0, false],
      ['SCORE 04250', 1, 'gold', 0, false],
      ['BEST 06100', 1, 'gold', 0, false],
    ]);
  });

  it('NEW BEST! blinks only when the score beats the best as it was when the session began', () => {
    const better = endLines({ outcome: 'gameOver', score: 6200, lives: 0, lifeBonus: 0, previousBest: 6100 }, lifePoints);
    expect(better.at(-1)).toMatchObject({ text: 'NEW BEST!', blink: true });
    const equal = endLines({ outcome: 'gameOver', score: 6100, lives: 0, lifeBonus: 0, previousBest: 6100 }, lifePoints);
    expect(equal.at(-1)).toMatchObject({ text: 'BEST 06100', blink: false });
  });

  it('an unsaved session (a development room) has no best line', () => {
    const lines = endLines({ outcome: 'gameOver', score: 20, lives: 0, lifeBonus: 0, previousBest: null }, lifePoints);
    expect(lines.map((l) => l.text)).toEqual(['GAME OVER', 'SCORE 00020']);
  });

  it('win: the heading at once, then score, lives, total and best 30 frames apart', () => {
    const lines = endLines({ outcome: 'won', score: 7900, lives: 3, lifeBonus: 1500, previousBest: 5000 }, lifePoints);
    expect(lines.map((l) => [l.text, l.scale, l.showAt])).toEqual([
      ['THE FOUNDRY IS LIT!', 2, 0],
      ['SCORE 06400', 1, WIN_LINE_FRAMES],
      ['LIVES LEFT 3 X 500', 1, 2 * WIN_LINE_FRAMES],
      ['TOTAL 07900', 1, 3 * WIN_LINE_FRAMES],
      ['NEW BEST!', 1, 4 * WIN_LINE_FRAMES],
    ]);
  });

  it('blinkShown: on for 20 frames of every 30, never before the line appears', () => {
    expect(blinkShown(-1)).toBe(false);
    expect(blinkShown(0)).toBe(true);
    expect(blinkShown(19)).toBe(true);
    expect(blinkShown(20)).toBe(false);
    expect(blinkShown(BEST_BLINK_PERIOD)).toBe(true);
    // Steady under reduced motion: shown once it has appeared, never hidden.
    expect([0, 19, 20, 29, BEST_BLINK_PERIOD + 25].every((age) => blinkShown(age, true))).toBe(true);
    expect(blinkShown(-1, true)).toBe(false);
  });

  it('screenLabel joins the words for the canvas name', () => {
    expect(screenLabel(['GAME OVER', 'SCORE 00020', ' '])).toBe('GAME OVER. SCORE 00020');
  });
});

describe('introLayout', () => {
  const card = { levelNumber: 10, name: 'Heart Furnace', teaches: 'Everything at once, one last time, carefully.', lives: 2, maxLives: 3 };

  for (const [w, h, css] of [
    [272, 160, 2],
    [284, 160, 2],
    [422, 195, 2],
    [480, 224, 2],
    [480, 224, 1], // an iPhone SE's tab with toolbars: the name at 2x
    [340, 193, 1.45], // a Pixel 7's tab
    [272, 160, 1],
  ] as const) {
    it(`fits a ${w} x ${h} view at ${css} CSS px per art px: plate inside, lines inside the plate, centred, on whole pixels`, () => {
      const layout = introLayout(w, h, card, css);
      expect(inside(layout.plate, w, h)).toBe(true);
      // The hint may be wrapped onto two lines (a 2x line too wide for the view): the same words, in order.
      const [heading, name, ...hint] = layout.lines;
      expect([heading?.text, name?.text, hint.map((l) => l.text).join(' ')]).toEqual(['LEVEL 10', 'HEART FURNACE', 'EVERYTHING AT ONCE, ONE LAST TIME, CAREFULLY.']);
      expect(layout.lines.map((l) => l.colour)).toEqual(['white', 'lime', ...hint.map(() => 'white')]);
      expect(hint.length).toBeLessThanOrEqual(2);
      expect(new Set(hint.map((l) => l.scale)).size).toBe(1);
      for (const line of layout.lines) {
        const box = { x: line.x, y: line.y, w: textPx(line.text, line.scale), h: textLinePx(line.scale) };
        expect(inside(box, w, h), line.text).toBe(true);
        expect(box.x).toBeGreaterThanOrEqual(layout.plate.x);
        expect(box.x + box.w).toBeLessThanOrEqual(layout.plate.x + layout.plate.w);
        expect(Math.abs(box.x - (w - box.x - box.w))).toBeLessThanOrEqual(1);
      }
      expect(layout.lives).toHaveLength(3);
      expect(layout.livesY + 8).toBeLessThanOrEqual(layout.plate.y + layout.plate.h);
      for (let i = 1; i < layout.lines.length; i++) expect(layout.lines[i]?.y).toBeGreaterThan(layout.lines[i - 1]?.y ?? 0);
      expect(layout.plate.h).toBeLessThanOrEqual(h);
    });
  }

  it('draws the name and the hint at 2x where the pixels are small (a long hint on two lines), and nothing at 2x on a phone in full screen', () => {
    const short = { ...card, teaches: 'Jump the gaps.' };
    // LEVEL 10 grows to 3x over 2x lines, so the heading still leads (ART-AND-SOUND section 7: "2x for headings").
    expect(introLayout(480, 224, short, 1).lines.map((l) => l.scale)).toEqual([3, 2, 2]);
    // 45 characters: 538 px at 2x, too wide for one line: two 2x lines at a word boundary (it was one 1x line).
    expect(introLayout(480, 224, card, 1).lines.map((l) => [l.text, l.scale])).toEqual([
      ['LEVEL 10', 3],
      ['HEART FURNACE', 2],
      ['EVERYTHING AT ONCE, ONE', 2],
      ['LAST TIME, CAREFULLY.', 2],
    ]);
    // Level 3's hint on the 568 x 232 tab (the route watch): 41 characters, never 1x.
    const l3 = { ...card, levelNumber: 3, name: 'Quench Hall', teaches: 'Coolant freezes robots. Stop on the pads.' };
    expect(introLayout(480, 224, l3, 1).lines.map((l) => l.scale)).toEqual([3, 2, 2, 2]);
    expect(introLayout(480, 224, short, 2).lines.map((l) => l.scale)).toEqual([2, 1, 1]);
    expect(introLayout(480, 224, short).lines.map((l) => l.scale)).toEqual([2, 1, 1]);
    // Too short a view for 2x lines and the life icons: back to 1x, the heading at 2x.
    expect(introLayout(480, 60, short, 1).lines.map((l) => l.scale)).toEqual([2, 1, 1]);
    // A name too long for 2x and a hint too, even on two lines: nothing to lead, the heading stays 2x.
    const long = { ...card, name: 'Anamethatisfartoolongfortwo', teaches: 'Unbreakablewordsthatcannotwrap atall.' };
    expect(introLayout(300, 224, long, 1).lines.map((l) => l.scale)).toEqual([2, 1, 1]);
  });

  it('the heading is always the largest line of the card, wherever the card is drawn', () => {
    for (const [w, h] of [[272, 160], [284, 160], [300, 224], [480, 192], [480, 224], [339, 165], [480, 100]] as const) {
      for (const css of [1, 1.45, 2, 3]) {
        for (const c of [card, { ...card, teaches: 'Jump the gaps.' }, { ...card, name: 'Up' }]) {
          const scales = introLayout(w, h, c, css).lines.map((l) => l.scale);
          expect(Math.max(...scales.slice(1)), `${w} x ${h} at ${css}: ${JSON.stringify(scales)}`).toBeLessThan(scales[0] ?? 0);
        }
      }
    }
  });
});

describe('wrapInTwo', () => {
  it('splits at the space that keeps the longer line shortest, both lines fitting', () => {
    expect(wrapInTwo('AB CD EF GH', (l) => l.length <= 6)).toEqual(['AB CD', 'EF GH']);
    expect(wrapInTwo('ABCDEFGH', () => true)).toBeNull();
    expect(wrapInTwo('ABCDEFG HIJKLMN OP', (l) => l.length <= 5)).toBeNull();
  });
});

describe('bannerLayout', () => {
  it('names the bonus at 2x and tallies the score under it, below the top bar and the toast', () => {
    const b = bannerLayout(284, 160, 200, 1230);
    expect(b.heading).toMatchObject({ text: 'LEVEL CLEAR +200', scale: 2 });
    expect(b.tally).toMatchObject({ text: 'SCORE 01230', scale: 1, colour: 'gold' });
    expect(b.plate.y).toBe(BANNER_Y);
    expect(inside(b.plate, 284, 160)).toBe(true);
    expect(b.tally.y).toBeGreaterThan(b.heading.y + 16);
    expect(b.tally.y + 8).toBeLessThanOrEqual(b.plate.y + b.plate.h);
  });

  it('stays the same size while the tally counts (five digits)', () => {
    expect(bannerLayout(422, 195, 200, 0).plate).toEqual(bannerLayout(422, 195, 200, 99999).plate);
  });
});

describe('titleScenery', () => {
  const menu: Rect[] = [
    { x: 98, y: 30, w: 87, h: 24 },
    { x: 70, y: 70, w: 144, h: 22 },
    { x: 70, y: 95, w: 144, h: 22 },
  ];

  it('puts the Earth top left, the ridge along the bottom and Sprue on a girder from the left edge', () => {
    const s = titleScenery(284, 160, menu);
    expect(s.earth).toEqual({ x: 10, y: 10 });
    expect(s.ridges[0]).toEqual({ x: 0, y: 136 });
    expect(s.ridges.length * 64).toBeGreaterThanOrEqual(284);
    expect(s.girder).toHaveLength(GIRDER_TILES);
    expect(s.girder.map((t) => t.frame)).toEqual(['wall_beam_0', 'wall_beam_0', 'wall_beam_0+r']);
    const girderTop = s.girder[0]?.y ?? 0;
    expect(s.hero).toEqual({ x: 16, y: girderTop - 16 });
    expect(girderTop + 16).toBeLessThanOrEqual(160);
  });

  it('leaves out what would touch the menu', () => {
    const wide: Rect[] = [{ x: 0, y: 0, w: 284, h: 160 }];
    const s = titleScenery(284, 160, wide);
    expect(s.earth).toBeNull();
    expect(s.girder).toEqual([]);
    expect(s.hero).toBeNull();
  });

  it('ridgeRow covers the width', () => {
    expect(ridgeRow(320, 180)).toEqual([0, 64, 128, 192, 256].map((x) => ({ x, y: 156 })));
  });
});

describe('glowBands', () => {
  it('fills the lower half in steps, strongest at the bottom', () => {
    const bands = glowBands(180);
    expect(bands[0]?.y).toBe(90);
    const last = bands.at(-1);
    expect((last?.y ?? 0) + (last?.h ?? 0)).toBe(180);
    for (let i = 1; i < bands.length; i++) expect(bands[i]?.alpha).toBeGreaterThan(bands[i - 1]?.alpha ?? 1);
    expect(glowBands(180, 0).every((b) => b.alpha === 0)).toBe(true);
  });
});

describe('title words', () => {
  it('splits the name: the first word big, the rest small, in capitals', () => {
    expect(splitTitle('Sprue and the Moon Foundry')).toEqual({ first: 'SPRUE', rest: 'AND THE MOON FOUNDRY' });
    expect(splitTitle('Solo')).toEqual({ first: 'SOLO', rest: '' });
  });

  it('shows BEST only once there is a best score', () => {
    expect(titleBest(0)).toBeNull();
    expect(titleBest(7900)).toBe('BEST 07900');
  });
});

describe('inkRect', () => {
  const rect = { x: 10, y: 20, w: 200, h: 8 };

  it('narrows a text line to its letters, centred as textOrigin centres them', () => {
    expect(inkRect(rect, { kind: 'text', text: 'BEST 07900' })).toEqual({ x: 10 + Math.floor((200 - 59) / 2), y: 20, w: 59, h: 8 });
    expect(inkRect({ x: 0, y: 0, w: 120, h: 24 }, { kind: 'text', text: 'SPRUE', scale: 3 })).toEqual({ x: 16, y: 0, w: 87, h: 24 });
  });

  it('keeps a button whole and gives a blank line no ink', () => {
    expect(inkRect(rect, { kind: 'button' })).toEqual(rect);
    expect(inkRect(rect, { kind: 'text', text: ' ' })).toBeNull();
  });
});
