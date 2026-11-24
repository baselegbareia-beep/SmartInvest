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

import { cameraTarget, levelSize, padReach, snapCamera, stepCamera } from './camera';
import type { CameraState, PadReach } from './camera';
import { chooseView, cssPerArtPx } from './chooseView';

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
