import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compileTuning } from '../core/compileTuning';
import { createSession, step } from '../core/game';
import { parseLevel } from '../core/level';
import { inputFromBits } from '../core/script';
import { SUB_SHIFT, TILE_PX } from '../core/types';
import type { GameEvent, GameState, InputScript } from '../core/types';
import { BOTH_ITEMS, layoutControls } from '../input/touchLayout';
import type { ControlId, Rect } from '../input/touchLayout';
import { TUNING } from '../tuning';

import { cameraTarget, frameShift, levelSize, padReach, snapCamera, stepCamera } from './camera';
import type { CameraState, PadReach } from './camera';
import { chooseView, cssPerArtPx } from './chooseView';
import { NO_COUNTS, addCounts, measureRoute, shippedCamera, shippedPopups } from './routeMeasure';
import type { CameraUnderTest, PopupsUnderTest, RouteCounts, Sighting, WatchWindow } from './routeMeasure';

/**
 * The ten campaign proofs (`e2e/scripts/level-NN.json`, the routes `e2e/levels.spec.ts` replays) seen through
 * the shipped camera and touch pad, on the phones of the device table (docs/PHASER4-NOTES.md, section 6).
 *
 * The route watch of 24 November 2026 found THRUST drawn on the hero's own row, 8 to 10 tiles ahead of him on
 * the 568 x 320 phone: exactly where a long flight lands and where level 8's mid-air pack floats, so for 25 to 30
 * ticks before the game's longest flight the pack lay behind the button. The buttons now all sit on the bottom
 * row, below his feet line. This test holds that: at every take-off of every proof (a jump, or a thrust from
 * the ground), nothing he is flying for lies under a drawn thumb button. Read on the live numbers
 * (src/tuning.ts), as tests/levelScripts.test.ts reads the scripts, because it is about the shipped layout.
 *
 * "What he is flying for": the flight's landing, and every pack, blaster and the cog not yet taken, within
 * 10 tiles ahead of him and no more than a tile below his feet. Further down (a drop into a pit ahead) lies in
 * the bottom row's band by design: the thumbs own the lower corners (docs/ART-AND-SOUND.md section 8).
 * "Under": more than a quarter of its tile under a drawn LEFT, RIGHT, JUMP, or FIRE and THRUST once held.
 */

const PHYS = compileTuning(TUNING);
const CAMPAIGN_IDS = Array.from({ length: 10 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`);

interface Window {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

const win = (w: number, h: number, dpr: number, left = 0, right = 0, bottom = 0): Window => ({
  name: `${w} x ${h} @${dpr}${left + right > 0 ? `, notch ${left} + ${right}` : ''}${bottom > 0 ? `, home bar ${bottom}` : ''}`,
  w,
  h,
  dpr,
  left,
  right,
  bottom,
});

/**
 * The landscape touch rows of the device table, full screen, and three browser tabs with a toolbar (on the
 * 568 x 232 one, at 1 CSS px per art px, the buttons cover 43 % of the view's height). Left out: the rows
 * without a touch screen.
 */
const WINDOWS: readonly Window[] = [
  win(568, 320, 2),
  win(667, 375, 2),
  win(667, 325, 2),
  win(800, 360, 3),
  win(844, 390, 3, 47, 47, 21),
  win(844, 390, 3),
  win(915, 412, 2.625),
  win(915, 412, 2.625, 30, 0),
  win(932, 430, 3, 59, 59, 21),
  win(740, 360, 2.75),
  win(851, 393, 3.5, 44, 0),
  win(740, 304, 2.75),
  win(740, 280, 2.75),
  win(568, 232, 2),
];

/** One tick of a proof, as the camera and this test need it. */
interface Seen {
  readonly tick: number;
  readonly playing: boolean;
  readonly feetY: number;
  readonly midX: number;
  readonly facing: number;
  readonly onGround: boolean;
  readonly hasBlaster: boolean;
  readonly hasThruster: boolean;
  readonly hasTrophy: boolean;
  readonly taken: readonly boolean[];
  readonly events: readonly GameEvent[];
  readonly target: ReturnType<typeof cameraTarget>;
  readonly heroX: number;
  readonly heroY: number;
}

function playProof(id: string): { game: GameState; seen: Seen[] } {
  const level = parseLevel(readFileSync(new URL(`../../levels/${id}.txt`, import.meta.url), 'utf8'), id);
  const script = JSON.parse(readFileSync(new URL(`../../e2e/scripts/${id}.json`, import.meta.url), 'utf8')) as InputScript;
  const events: GameEvent[] = [];
  const game = createSession([level], PHYS, {}, events);
  const seen: Seen[] = [];
  for (const [bits, count] of script.runs) {
    for (let i = 0; i < count; i++) {
      events.length = 0;
      step(game, inputFromBits(bits), events);
      const p = game.run.player;
      seen.push({
        tick: game.run.tick,
        playing: game.run.phase === 'playing',
        feetY: (p.y + game.phys.heroH) >> SUB_SHIFT,
        midX: (p.x + (game.phys.heroW >> 1)) >> SUB_SHIFT,
        facing: p.facing,
        onGround: p.onGround,
        hasBlaster: p.hasBlaster,
        hasThruster: p.hasThruster,
        hasTrophy: game.run.hasTrophy,
        taken: [...game.run.taken],
        events: [...events],
        target: cameraTarget(game),
        heroX: (p.x >> SUB_SHIFT) - ((TILE_PX - (game.phys.heroW >> SUB_SHIFT)) >> 1),
        heroY: (p.y >> SUB_SHIFT) - (TILE_PX - (game.phys.heroH >> SUB_SHIFT)),
      });
    }
  }
  return { game, seen };
}

const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const THUMB_BUTTONS: readonly ControlId[] = ['left', 'right', 'jump', 'fire', 'thrust'];

describe('the ten proofs through the shipped camera and pad: nothing a take-off aims for is under a thumb button', () => {
  const proofs = CAMPAIGN_IDS.map((id) => ({ id, ...playProof(id) }));

  it.each(WINDOWS)('$name', (w) => {
    const safe = { left: w.left, right: w.right, top: 0, bottom: w.bottom };
    const view = chooseView(w.w, w.h, w.dpr, safe, TUNING.view);
    const k = cssPerArtPx(view, w.dpr);
    const size = { w: view.viewW, h: view.viewH };
    const canvas = { x: view.cssLeft, y: view.cssTop, w: view.viewW * k, h: view.viewH * k };
    // The buttons in art px of the view.
    const onView = (r: Rect): Rect => ({ x: (r.x - view.cssLeft) / k, y: (r.y - view.cssTop) / k, w: r.w / k, h: r.h / k });

    const found: string[] = [];
    let takeoffs = 0;
    for (const { id, game, seen } of proofs) {
      const level = game.level;
      // As the Play scene sets the pad for each level: FIRE beside JUMP where there is no thruster pack.
      const slots = level.pickups.some((p) => p.kind === 'thruster') ? BOTH_ITEMS : { fireBesideJump: true };
      const b = layoutControls(w.w, w.h, safe, TUNING.touch, slots).buttons;
      const reach: PadReach = { left: 0, right: 0, bottom: 0 };
      padReach([b.left, b.right], [b.jump, b.fire, b.thrust, b.pause], canvas, k, reach);
      const drawn = (s: Seen): [ControlId, Rect][] =>
        THUMB_BUTTONS.filter((bid) => (bid === 'fire' ? s.hasBlaster : bid === 'thrust' ? s.hasThruster : true)).map((bid) => [bid, onView(b[bid])]);
      const levelPx = levelSize(level);
      let cam: CameraState | null = null;
      for (let i = 0; i < seen.length; i++) {
        const s = seen[i];
        if (!s) continue;
        cam = cam ? stepCamera(cam, s.target, size, levelPx, TUNING.camera, reach) : snapCamera(s.target, size, levelPx, TUNING.camera, reach);
        if (!s.playing) continue;
        const jumped = s.events.some((e) => e.type === 'jumped');
        const thrustOff = s.events.some((e) => e.type === 'thrustStarted') && seen[i - 1]?.onGround === true;
        if (!jumped && !thrustOff) continue;
        takeoffs += 1;
        const aims: { what: string; r: Rect }[] = [];
        const landing = seen.slice(i + 1).find((later) => later.events.some((e) => e.type === 'landed'));
        if (landing) aims.push({ what: 'the landing', r: { x: landing.heroX, y: landing.heroY, w: TILE_PX, h: TILE_PX } });
        level.pickups.forEach((p, j) => {
          if (p.kind !== 'crystal' && s.taken[j] !== true) aims.push({ what: `the ${p.kind} at ${p.col},${p.row}`, r: { x: p.col * TILE_PX, y: p.row * TILE_PX, w: TILE_PX, h: TILE_PX } });
        });
        if (!s.hasTrophy) aims.push({ what: `the cog at ${level.trophy.col},${level.trophy.row}`, r: { x: level.trophy.col * TILE_PX, y: level.trophy.row * TILE_PX, w: TILE_PX, h: TILE_PX } });
        for (const aim of aims) {
          const ahead = ((aim.r.x + TILE_PX / 2 - s.midX) * s.facing) / TILE_PX;
          if (ahead < -1 || ahead > 10) continue; // within 10 tiles ahead (a tile behind: a jump straight up)
          if (aim.r.y > s.feetY) continue; // more than a tile below his feet: a drop, in the thumbs' band by design
          const at = { x: aim.r.x - cam.scrollX, y: aim.r.y - cam.scrollY, w: TILE_PX, h: TILE_PX };
          for (const [button, r] of drawn(s)) {
            if (overlapArea(at, r) > (TILE_PX * TILE_PX) / 4) found.push(`${id} tick ${s.tick}: ${aim.what} under ${button.toUpperCase()}`);
          }
        }
      }
    }
    expect(takeoffs, 'the proofs take off').toBeGreaterThan(200);
    expect(found).toEqual([]);
  });

  it('FIRE and THRUST are drawn below where the hero stands, on every window above', () => {
    for (const w of WINDOWS) {
      const safe = { left: w.left, right: w.right, top: 0, bottom: w.bottom };
      const view = chooseView(w.w, w.h, w.dpr, safe, TUNING.view);
      const k = cssPerArtPx(view, w.dpr);
      const b = layoutControls(w.w, w.h, safe, TUNING.touch).buttons;
      const feetLine = TUNING.camera.camAnchorY * view.viewH;
      for (const id of ['fire', 'thrust'] as const) expect((b[id].y - view.cssTop) / k, `${w.name}: ${id.toUpperCase()}'s top`).toBeGreaterThan(feetLine);
      const alone = layoutControls(w.w, w.h, safe, TUNING.touch, { fireBesideJump: true }).buttons.fire;
      expect((alone.y - view.cssTop) / k, `${w.name}: FIRE beside JUMP, top`).toBeGreaterThan(feetLine);
    }
  });
});

/**
 * The whole route watch as numbers (`routeMeasure.ts`): the ten proofs and the two rooms, played on the real core and seen
 * through the shipped camera (with its standing framing), the pad as laid out on each window, and the score pop-ups as
 * Effects places them, on the phone windows of the route watch and a desktop, each with the touch pad and with keys.
 *
 * The ceilings are the numbers of this build (25 November 2026, after the second re-check's fixes); the numbers before
 * them, on the camera and pop-ups of commit 3c1db1b with the same levels, are in the comments (thing-ticks, ticks or
 * frames; popupAway and popupFar were first counted in the final round and have none). Measured on the live tuning and levels, as tests/levelScripts.test.ts reads the scripts: a change to the
 * camera, view or touch numbers, the pad's layout or a level can move them. Lower is better everywhere; when a change
 * lowers one, lower its ceiling here.
 */
describe('the route watch, counted: nothing worse than this build on any window, the hero never under the bar or a button, no pop-up on another, on him or on the bar', () => {
  const ids = [...CAMPAIGN_IDS, 'test', 'debug'];
  const routes = ids.map((id) => ({
    id,
    level: parseLevel(readFileSync(new URL(`../../levels/${id}.txt`, import.meta.url), 'utf8'), id),
    script: JSON.parse(readFileSync(new URL(`../../e2e/scripts/${id}.json`, import.meta.url), 'utf8')) as InputScript,
  }));
  const phones = [
    { name: '568 x 320 @2', w: 568, h: 320, dpr: 2 },
    { name: '844 x 390 @3', w: 844, h: 390, dpr: 3 },
    { name: '740 x 360 @4', w: 740, h: 360, dpr: 4 },
    { name: '568 x 232 @2 (a tab)', w: 568, h: 232, dpr: 2 },
    { name: '1280 x 720 @1', w: 1280, h: 720, dpr: 1 },
  ];
  type Ceiling = Pick<
    RouteCounts,
    'stripThings' | 'stripThingsNoCrystal' | 'ahead6' | 'ahead4' | 'risingTight' | 'beyondBottom' | 'beyondSide' | 'hiddenNear' | 'popupJumps' | 'popupAway' | 'popupFar'
  >;
  // (a) things at least half under the top bar's strip (and without the crystals); (b) things 0-6 and 0-4 tiles ahead
  // under a drawn button; (d) rising ticks with less than a tile clear above his head; (e) ticks showing what lies
  // below the level or beyond a side wall; (g) the cog, a pack, the blaster or the open airlock near him, not clearly
  // seen; frames on which a pop-up moved 3 px or more (a step aside from a hero who would run into it: 441 of the
  // 450; on 9 a pop-up moved below the cog's toast band as it came up, or was pushed down by an older one); and pop-ups
  // first drawn more than 16 px (32 px) from their own place. The last two count what fewer steps would cost: placing
  // every pop-up off the hero's way from the start, as under reduced motion, took popupJumps from 450 to 136 over the ten
  // windows, but popupAway from 220 to 326 and popupFar from 10 to 26; looking only 8 frames ahead, without the half tile
  // over his head, gave 191, 210 and 26 (final round; docs/ART-AND-SOUND.md section 13). Which a player minds more, a
  // step or a pop-up away from what scored, is the owner's call at the playtest: neither changes without a ceiling here.
  const CEILING: Record<string, Ceiling> = {
    // before: 1866, 715, 571, 143, 870, 5142, 3695, 256, 402
    '568 x 320 @2 touch': { stripThings: 1852, stripThingsNoCrystal: 701, ahead6: 571, ahead4: 143, risingTight: 868, beyondBottom: 5142, beyondSide: 3695, hiddenNear: 256, popupJumps: 45, popupAway: 23, popupFar: 1 },
    // before: 2813, 717, 0, 0, 587, 0, 0, 241, 405
    '568 x 320 @2 keys': { stripThings: 2813, stripThingsNoCrystal: 717, ahead6: 0, ahead4: 0, risingTight: 587, beyondBottom: 0, beyondSide: 0, hiddenNear: 241, popupJumps: 46, popupAway: 22, popupFar: 1 },
    // before: 2414, 738, 34, 0, 565, 5324, 4863, 204, 404
    '844 x 390 @3 touch': { stripThings: 2330, stripThingsNoCrystal: 670, ahead6: 34, ahead4: 0, risingTight: 558, beyondBottom: 5324, beyondSide: 4863, hiddenNear: 204, popupJumps: 45, popupAway: 22, popupFar: 1 },
    // before: 1776, 838, 0, 0, 454, 0, 0, 160, 406
    '844 x 390 @3 keys': { stripThings: 1776, stripThingsNoCrystal: 838, ahead6: 0, ahead4: 0, risingTight: 452, beyondBottom: 0, beyondSide: 0, hiddenNear: 160, popupJumps: 46, popupAway: 22, popupFar: 1 },
    // before: 1728, 690, 74, 3, 864, 5107, 4346, 213, 403
    '740 x 360 @4 touch': { stripThings: 1694, stripThingsNoCrystal: 656, ahead6: 74, ahead4: 3, risingTight: 860, beyondBottom: 5055, beyondSide: 4346, hiddenNear: 213, popupJumps: 45, popupAway: 23, popupFar: 1 },
    // before: 3112, 740, 0, 0, 587, 0, 0, 215, 405
    '740 x 360 @4 keys': { stripThings: 3112, stripThingsNoCrystal: 740, ahead6: 0, ahead4: 0, risingTight: 587, beyondBottom: 0, beyondSide: 0, hiddenNear: 215, popupJumps: 46, popupAway: 22, popupFar: 1 },
    // before: 2438, 537, 152, 18, 96, 7208, 6816, 46, 406
    '568 x 232 @2 (a tab) touch': { stripThings: 2383, stripThingsNoCrystal: 537, ahead6: 152, ahead4: 18, risingTight: 96, beyondBottom: 7208, beyondSide: 6816, hiddenNear: 46, popupJumps: 44, popupAway: 22, popupFar: 1 },
    // before: 2302, 266, 0, 0, 96, 0, 0, 2, 410
    '568 x 232 @2 (a tab) keys': { stripThings: 2302, stripThingsNoCrystal: 266, ahead6: 0, ahead4: 0, risingTight: 96, beyondBottom: 0, beyondSide: 0, hiddenNear: 2, popupJumps: 43, popupAway: 21, popupFar: 1 },
    // before: 3009, 1175, 2, 0, 370, 5454, 4236, 167, 410
    '1280 x 720 @1 touch': { stripThings: 3009, stripThingsNoCrystal: 1175, ahead6: 2, ahead4: 0, risingTight: 370, beyondBottom: 5454, beyondSide: 4236, hiddenNear: 167, popupJumps: 45, popupAway: 22, popupFar: 1 },
    // before: 2384, 1344, 0, 0, 327, 0, 0, 129, 414
    '1280 x 720 @1 keys': { stripThings: 2384, stripThingsNoCrystal: 1344, ahead6: 0, ahead4: 0, risingTight: 327, beyondBottom: 0, beyondSide: 0, hiddenNear: 129, popupJumps: 45, popupAway: 21, popupFar: 1 },
  };
  /** The pop-up counts that must be 0: on another, on the hero, on the bar, past a side, cut short, flipping round him. */
  const NEVER_POPUP: ReadonlySet<keyof RouteCounts> = new Set(['popupPairs', 'popupHero', 'popupBar', 'popupSide', 'popupShort', 'popupFlips']);
  const windows: WatchWindow[] = phones.flatMap((p) => [
    { ...p, name: `${p.name} touch`, touch: true },
    { ...p, name: `${p.name} keys`, touch: false },
  ]);
  const camera = shippedCamera(TUNING);

  it.each(windows)('$name', (w) => {
    let total: RouteCounts = { ...NO_COUNTS };
    const seen: Sighting[] = [];
    for (const r of routes) {
      const list: Sighting[] = [];
      total = addCounts(total, measureRoute(r.level, r.script, PHYS, TUNING, w, camera, shippedPopups(), list));
      seen.push(...list.filter((s) => s.what === 'heroStrip' || s.what === 'heroButton' || NEVER_POPUP.has(s.what)).map((s) => ({ ...s, thing: `${r.id}: ${s.thing}` })));
    }
    expect(total.ticks, 'the routes were played').toBeGreaterThan(10_000);
    // (c) and (f): never; nor a pop-up that flips round the hero (it hopped round him, '+50' on level 5).
    expect(seen.slice(0, 5), 'the hero under the strip or a button; pop-ups on each other, on him or on the bar, or flipping').toEqual([]);
    const ceiling = CEILING[w.name];
    if (!ceiling) throw new Error(`no ceiling for ${w.name}`);
    for (const [k, max] of Object.entries(ceiling) as [keyof Ceiling, number][]) expect(total[k], `${w.name}: ${k}`).toBeLessThanOrEqual(max);
  });

  it("level 9 on the 568 x 320 phone (touch): the deck-2 pack, Cinderpeg 3 and the Arc Moths are never in the top bar's row (the re-check: 96, 59 and 99 ticks)", () => {
    const r = routes.find((x) => x.id === 'level-09');
    if (!r) throw new Error('no level 9');
    const list: Sighting[] = [];
    measureRoute(r.level, r.script, PHYS, TUNING, { name: 'se', w: 568, h: 320, dpr: 2, touch: true }, camera, shippedPopups(), list);
    const strip = list.filter((s) => s.what === 'stripThings');
    expect(strip.filter((s) => s.thing === 'thruster 4,16' || s.thing === 'cinderpeg 3')).toEqual([]);
    expect(strip.filter((s) => s.thing.startsWith('moth')).length, 'the moths: 99 thing-ticks before, 18 after the first fix').toBeLessThanOrEqual(4);
  });

  it.each([
    { name: '844 x 390 @3', w: 844, h: 390, dpr: 3, most: 23, before: 91 },
    { name: '740 x 360 @4', w: 740, h: 360, dpr: 4, most: 4, before: 38 },
  ])("level 9 on $name (touch): the framing no longer pushes the pool moths into the top bar's row ($before thing-ticks on 3c1db1b)", ({ name, w, h, dpr, most }) => {
    const r = routes.find((x) => x.id === 'level-09');
    if (!r) throw new Error('no level 9');
    const list: Sighting[] = [];
    measureRoute(r.level, r.script, PHYS, TUNING, { name, w, h, dpr, touch: true }, camera, shippedPopups(), list);
    const moths = list.filter((s) => s.what === 'stripThings' && s.thing.startsWith('moth'));
    expect(moths.length, moths.map((s) => `${s.tick} ${s.thing}`).join(', ')).toBeLessThanOrEqual(most);
  });

  it('the framing weighs the view as drawn: on every standing tick of every proof, its choice is the one for the left edge the side walls hold the view at (it weighed the dead zone\'s, up to 228 px off by a wall)', () => {
    let standing = 0;
    let wouldDiffer = 0;
    const wrong: string[] = [];
    for (const w of windows) {
      for (const r of routes) {
        const checked: CameraUnderTest<CameraState> = {
          snap: (game, view, level, pad, buttons) => camera.snap(game, view, level, pad, buttons),
          step: (prev, game, view, level, pad, buttons) => {
            const next = camera.step(prev, game, view, level, pad, buttons);
            const t = cameraTarget(game);
            if (!t.onGround) return next;
            standing += 1;
            const scene = { game, buttons };
            const drawn = frameShift(scene, t, next.x, view, level, TUNING.camera, pad, prev.passBottom);
            if (drawn !== next.shift && wrong.length < 5) wrong.push(`${w.name} ${r.id} tick ${game.run.tick}: ${next.shift}, for the drawn view ${drawn}`);
            // The left edge the dead zone asks for, before the walls hold it.
            const anchor = view.w / 2 - next.look;
            const screenX = t.x - prev.x;
            const dz = TUNING.camera.camDeadzoneHalfW;
            const asked = screenX > anchor + dz ? t.x - (anchor + dz) : screenX < anchor - dz ? t.x - (anchor - dz) : prev.x;
            if (asked !== next.x && frameShift(scene, t, asked, view, level, TUNING.camera, pad, prev.passBottom) !== drawn) wouldDiffer += 1;
            return next;
          },
        };
        measureRoute(r.level, r.script, PHYS, TUNING, w, checked, shippedPopups());
      }
    }
    expect(standing, "standing ticks weighed").toBeGreaterThan(10_000);
    expect(wrong).toEqual([]);
    expect(wouldDiffer, 'standing ticks on which the dead zone\'s left edge would have framed him otherwise').toBeGreaterThan(0);
    // All 10 windows and 12 routes: 2 to 3 s on a lightly loaded machine, 11 to 13 s beside eight busy loops (vitest's 5 s ran out).
  }, 60_000);

  // Under reduced motion (shippedPopups(true)): frames on which a pop-up moved 3 px or more on screen, nearly all a step
  // out of the hero's way while it has shown fewer than POPUP_MIN_FRAMES frames (85 of 91: 8 with the pad and 9 with
  // keys on each window, of 11 to 32 px, each in one frame); the other 6, on level 8 on the 568, 844 and 740 windows, a
  // pop-up moved 5 to 11 px down below the cog's toast band as the toast comes up. Before, none moved, but 30 of the
  // 175 on the 568 x 320 phone (touch) were taken down after one or two frames, 48 after fewer than 10. The board moves one each time he comes onto it in that time (a random walk that
  // turns and jumps often moves a few twice); on the proofs none moves twice, which the docs say and this holds.
  const STILL_STEPS: Record<string, number> = {
    '568 x 320 @2 touch': 9,
    '568 x 320 @2 keys': 10,
    '844 x 390 @3 touch': 9,
    '844 x 390 @3 keys': 10,
    '740 x 360 @4 touch': 9,
    '740 x 360 @4 keys': 10,
    '568 x 232 @2 (a tab) touch': 8,
    '568 x 232 @2 (a tab) keys': 9,
    '1280 x 720 @1 touch': 8,
    '1280 x 720 @1 keys': 9,
  };

  /** shippedPopups(true), and how many frames each pop-up moved 3 px or more on, in the world or on screen, whichever is less (as popupJumps). */
  function countingSteps(): { popups: PopupsUnderTest; steps: Map<number, number> } {
    const inner = shippedPopups(true);
    const steps = new Map<number, number>();
    let last = new Map<number, { x: number; y: number; camY: number }>();
    return {
      steps,
      popups: {
        clear: () => {
          inner.clear();
          last = new Map();
        },
        spawn: (textW, x, y, camY, toastUp) => {
          inner.spawn(textW, x, y, camY, toastUp);
        },
        advance: (frames) => {
          inner.advance(frames);
        },
        place: (camY, toastUp, hero, ahead, view) => {
          const shown = inner.place(camY, toastUp, hero, ahead, view);
          const now = new Map<number, { x: number; y: number; camY: number }>();
          for (const p of shown) {
            if (p.id === undefined) continue;
            const q = last.get(p.id);
            const across = q ? Math.abs(p.x - q.x) : 0;
            if (q && across + Math.min(Math.abs(p.y - q.y), Math.abs(p.y - camY - (q.y - q.camY))) >= 3) steps.set(p.id, (steps.get(p.id) ?? 0) + 1);
            now.set(p.id, { x: p.x, y: p.y, camY });
          }
          last = now;
          return shown;
        },
      },
    };
  }

  it.each(windows)('under reduced motion, $name: every pop-up shows POPUP_MIN_FRAMES frames or more, none on another, on him, on the bar or past a side, few move and none twice', (w) => {
    let total: RouteCounts = { ...NO_COUNTS };
    const seen: Sighting[] = [];
    const twice: string[] = [];
    for (const r of routes) {
      const list: Sighting[] = [];
      const { popups, steps } = countingSteps();
      total = addCounts(total, measureRoute(r.level, r.script, PHYS, TUNING, w, camera, popups, list));
      seen.push(...list.filter((s) => NEVER_POPUP.has(s.what)).map((s) => ({ ...s, thing: `${r.id}: ${s.thing}` })));
      for (const [id, n] of steps) if (n > 1) twice.push(`${r.id}: pop-up #${id} moved on ${n} frames`);
    }
    expect(seen.slice(0, 5), 'pop-ups cut short, on each other, on him, on the bar or past a side').toEqual([]);
    expect(total.popupJumps, `${w.name}: frames with a step`).toBeLessThanOrEqual(STILL_STEPS[w.name] ?? 0);
    expect(twice, 'pop-ups that moved more than once').toEqual([]);
  }, 30_000);
});
