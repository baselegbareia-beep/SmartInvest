/**
 * The route watch as numbers: a level's validator proof (or a room's script) played tick by tick on the real
 * core, seen through the shell's pure camera, view size, touch layout and pop-up placement, and counted.
 * Test support only (src/shell/routeView.test.ts and scratch probes): nothing of the game imports it.
 *
 * What is counted, on the ticks the world is shown (phases 'ready' and 'playing'; pop-ups on every frame):
 * - (a) `stripThings`: (tick, thing) pairs with at least half of the thing's 16 px tile (8 rows) under the top bar's
 *   strip (rows 0 to STRIP_H of the view) and on screen across. Things: live enemies, crystals, packs and blasters
 *   not taken, the cog until taken, the airlock, and the hazard tiles (fire, coolant, spikes) within 6 tiles of the
 *   hero. `stripThingsNoCrystal` leaves the crystals out.
 * - (b) `ahead6`, `ahead4`: (tick, thing) pairs with the thing's middle 0 to 6 (0 to 4) tiles ahead of the hero's
 *   middle (the way he faces) and more than a quarter of its tile under a drawn button (LEFT, RIGHT, JUMP, PAUSE;
 *   FIRE and THRUST while their item is held). `underButton`: any thing on screen under a button, anywhere.
 * - (c) `heroStrip`, `heroButton`: ticks on which the hero's sprite (and the fuel bar over it while he thrusts)
 *   reaches into the strip, or overlaps a drawn button.
 * - (d) `risingTight`: ticks on which he rises through the air (playing, off the ground, `vy < 0`) with less than a
 *   tile of undimmed view between his sprite's top and the strip.
 * - (e) `beyondBottom`, `beyondSide`: ticks on which the view shows what lies below the level's bottom row, or
 *   beyond a side wall, where staying inside the level (or centring a level smaller than the view) would not.
 * - (f) `popupPairs`, `popupHero`, `popupBar`: frames on which two score pop-ups overlap, a pop-up overlaps the
 *   hero's sprite, or a pop-up reaches into the strip or (while it shows) the cog's toast band.
 * - (g) `hiddenNear`: (tick, thing) pairs for the cog (until taken), a pack or blaster (until taken) and the airlock
 *   (once open) within 8 tiles across and 4 tiles up or down of the hero that are not clearly seen: off the view,
 *   at least half under the strip, or more than a quarter under a button.
 *
 * Pure apart from what the caller passes in: no Phaser, no DOM, no file access.
 */
import { textWidth } from '../art/font';
import { createSession, step } from '../core/game';
import { inputFromBits } from '../core/script';
import { SUB_SHIFT, TILE_PX, Tile } from '../core/types';
import type { GameEvent, GameState, InputScript, LevelData, Phys, Tuning } from '../core/types';
import { BOTH_ITEMS, layoutControls } from '../input/touchLayout';
import type { ControlId, Rect } from '../input/touchLayout';

import { cameraTarget, levelSize, padReach, snapCamera, stepCamera } from './camera';
import type { CameraState, PadButtonsOnView, PadReach, Size } from './camera';
import { chooseView, cssPerArtPx } from './chooseView';
import { POPUP_H, PopupBoard, popupAnchor } from './fxModel';
import { STRIP_H, TOAST_BAND_BOTTOM, TOAST_PAD } from './hudModel';
import { heroDrawX, heroDrawY } from './viewModel';

/** A browser window of the route watch, in CSS px, with the touch pad on or off. */
export interface WatchWindow {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly touch: boolean;
}

/** The camera under test: the shipped one (`SHIPPED_CAMERA`) or a prototype. */
export interface CameraUnderTest<S extends { readonly scrollX: number; readonly scrollY: number }> {
  snap(game: GameState, view: Size, level: Size, pad: Readonly<PadReach>, buttons: PadButtonsOnView | null): S;
  step(prev: S, game: GameState, view: Size, level: Size, pad: Readonly<PadReach>, buttons: PadButtonsOnView | null): S;
}

/** How score pop-ups are laid out: the shipped board (`PopupBoard`) or a prototype with the same members. */
export interface PopupsUnderTest {
  clear(): void;
  spawn(textW: number, x: number, y: number, camY: number, toastUp: boolean): void;
  advance(frames: number): void;
  /** The pop-ups shown now, world px, after placing them for the scroll, the toast and the hero's sprite (world px). */
  place(camY: number, toastUp: boolean, hero: Rect): readonly Rect[];
}

/** The shipped camera, framing the standing view as the Play scene does (`FrameScene`). */
export const shippedCamera = (t: Tuning): CameraUnderTest<CameraState> => ({
  snap: (game, view, level, pad, buttons) => snapCamera(cameraTarget(game), view, level, t.camera, pad, { game, buttons }),
  step: (prev, game, view, level, pad, buttons) => stepCamera(prev, cameraTarget(game), view, level, t.camera, pad, { game, buttons }),
});

export interface RouteCounts {
  ticks: number;
  stripThings: number;
  stripThingsNoCrystal: number;
  ahead6: number;
  ahead4: number;
  underButton: number;
  heroStrip: number;
  heroButton: number;
  risingTight: number;
  beyondBottom: number;
  beyondSide: number;
  popupPairs: number;
  popupHero: number;
  popupBar: number;
  hiddenNear: number;
  /** Vertical scroll travel, art px, and how often the vertical scroll turned round on a tick the hero stood. */
  camTravelY: number;
  camTurnsStanding: number;
  /** The largest change of the scroll in one tick, either way, art px (a jump of the view when large). */
  camStepMax: number;
}

export const NO_COUNTS: Readonly<RouteCounts> = Object.freeze({
  ticks: 0,
  stripThings: 0,
  stripThingsNoCrystal: 0,
  ahead6: 0,
  ahead4: 0,
  underButton: 0,
  heroStrip: 0,
  heroButton: 0,
  risingTight: 0,
  beyondBottom: 0,
  beyondSide: 0,
  popupPairs: 0,
  popupHero: 0,
  popupBar: 0,
  hiddenNear: 0,
  camTravelY: 0,
  camTurnsStanding: 0,
  camStepMax: 0,
});

export function addCounts(a: RouteCounts, b: Readonly<RouteCounts>): RouteCounts {
  const out = { ...a };
  for (const k of Object.keys(NO_COUNTS) as (keyof RouteCounts)[]) out[k] = k === 'camStepMax' ? Math.max(a[k], b[k]) : a[k] + b[k];
  return out;
}

/** One finding, for reading a count back: what, where and on which ticks. */
export interface Sighting {
  readonly what: keyof RouteCounts;
  readonly thing: string;
  readonly tick: number;
}

interface Thing {
  readonly id: string;
  readonly kind: 'enemy' | 'crystal' | 'blaster' | 'thruster' | 'cog' | 'airlock' | 'hazard';
  readonly x: number;
  readonly y: number;
}

const THUMBS: readonly ControlId[] = ['left', 'right', 'jump', 'fire', 'thrust', 'pause'];
const FUELBAR_RISE = 5; // the fuel bar's top over the sprite's top (WorldView: gap 3, height 2)
const POPUP_LIFT_PX = 16; // Effects: pop-ups start this far above the centre of what scored
const TOAST_TEXT = 'COG FOUND! AIRLOCK OPEN';

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Rows of a 16 px tile whose top is `top` (view px) that lie under the strip. */
const stripRows = (top: number, strip = STRIP_H): number => Math.max(0, Math.min(top + TILE_PX, strip) - Math.max(top, 0));
/** Rows of it that are clearly seen: below the strip and above the view's bottom edge. */
const clearRows = (top: number, viewH: number, strip = STRIP_H): number => Math.max(0, Math.min(top + TILE_PX, viewH) - Math.max(top, strip));

const HAZARDS: ReadonlySet<number> = new Set([Tile.Fire, Tile.Coolant, Tile.Spikes]);

/**
 * Plays `script` on `level` from a fresh session and counts what the player sees, on window `win`. `sightings`,
 * when given, receives every finding (for reading the counts back).
 */
export function measureRoute<S extends { readonly scrollX: number; readonly scrollY: number }>(
  level: LevelData,
  script: InputScript,
  phys: Phys,
  tuning: Tuning,
  win: WatchWindow,
  camera: CameraUnderTest<S>,
  popups: PopupsUnderTest,
  sightings?: Sighting[],
  /** How far down the strip reaches at a column of the view (a prototype of another strip); STRIP_H everywhere by default. */
  stripAt: (viewX: number, viewW: number) => number = () => STRIP_H,
): RouteCounts {
  const c: RouteCounts = { ...NO_COUNTS };
  const note = (what: keyof RouteCounts, thing: string, tick: number): void => {
    c[what] += 1;
    sightings?.push({ what, thing, tick });
  };
  const safe = { left: 0, right: 0, top: 0, bottom: 0 };
  const view = chooseView(win.w, win.h, win.dpr, safe, tuning.view);
  const k = cssPerArtPx(view, win.dpr);
  const size: Size = { w: view.viewW, h: view.viewH };
  const levelPx = levelSize(level);
  const slots = level.pickups.some((p) => p.kind === 'thruster') ? BOTH_ITEMS : { fireBesideJump: true };
  const b = layoutControls(win.w, win.h, safe, tuning.touch, slots).buttons;
  const canvas = { x: view.cssLeft, y: view.cssTop, w: view.viewW * k, h: view.viewH * k };
  const pad: PadReach = { left: 0, right: 0, bottom: 0 };
  if (win.touch) padReach([b.left, b.right], [b.jump, b.fire, b.thrust, b.pause], canvas, k, pad);
  const onView = (r: Rect): Rect => ({ x: (r.x - view.cssLeft) / k, y: (r.y - view.cssTop) / k, w: r.w / k, h: r.h / k });
  const buttons = new Map(THUMBS.map((id) => [id, onView(b[id])] as const));
  const padOnView: PadButtonsOnView | null = win.touch
    ? { left: onView(b.left), right: onView(b.right), jump: onView(b.jump), fire: onView(b.fire), thrust: onView(b.thrust), pause: onView(b.pause) }
    : null;
  const toastW = textWidth(TOAST_TEXT);
  const toastX = Math.floor((view.viewW - toastW) / 2);
  const toastBand: Rect = { x: toastX - TOAST_PAD, y: STRIP_H, w: toastW + 2 * TOAST_PAD, h: TOAST_BAND_BOTTOM - STRIP_H };

  const hazards: { col: number; row: number }[] = [];
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) if (HAZARDS.has(level.tiles[row * level.width + col] ?? 0)) hazards.push({ col, row });
  }
  // The highest scroll that keeps the view inside the level (or centres a smaller one), each way.
  const innerX = (x: number): boolean => (levelPx.w <= size.w ? x === Math.floor((levelPx.w - size.w) / 2) : x >= 0 && x <= levelPx.w - size.w);
  const innerBottom = levelPx.h <= size.h ? Math.floor((levelPx.h - size.h) / 2) : levelPx.h - size.h;

  const events: GameEvent[] = [];
  const game = createSession([level], phys, {}, events);
  popups.clear();
  let cam = camera.snap(game, size, levelPx, pad, padOnView);
  let toastLeft = 0;
  let lastDy = 0;
  const flashes: { age: number; x: number; y: number; score: number }[] = [];
  const toPx = (sub: number): number => sub >> SUB_SHIFT;

  for (const [bits, count] of script.runs) {
    for (let i = 0; i < count; i++) {
      events.length = 0;
      step(game, inputFromBits(bits), events);
      const run = game.run;
      const p = run.player;
      const playing = run.phase === 'playing';
      // The pop-ups the tick's events start (Effects: the hero as of this tick decides where a rising one goes).
      const rising = playing && !p.onGround && p.vy < 0;
      const side: 1 | -1 = p.vx > 0 ? 1 : p.vx < 0 ? -1 : p.facing;
      for (const e of events) {
        if (e.type === 'levelStarted' || e.type === 'respawned') {
          cam = camera.snap(game, size, levelPx, pad, padOnView);
          if (e.type === 'levelStarted') toastLeft = 0;
          popups.clear();
          flashes.length = 0;
        }
      }
      const before = cam;
      cam = camera.step(cam, game, size, levelPx, pad, padOnView);
      if (!events.some((e) => e.type === 'levelStarted' || e.type === 'respawned')) {
        const dy = cam.scrollY - before.scrollY;
        c.camTravelY += Math.abs(dy);
        c.camStepMax = Math.max(c.camStepMax, Math.abs(dy), Math.abs(cam.scrollX - before.scrollX));
        if (dy !== 0) {
          if (lastDy !== 0 && Math.sign(dy) !== Math.sign(lastDy) && p.onGround && playing) c.camTurnsStanding += 1;
          lastDy = dy;
        }
      }
      for (const e of events) {
        if (e.type === 'pickup' && e.score > 0) {
          const text = `+${e.score}`;
          const at = popupAnchor(toPx(e.x), toPx(e.y), POPUP_LIFT_PX, rising, side, textWidth(text), { x: 0, y: 0 });
          popups.spawn(textWidth(text), at.x, at.y, cam.scrollY, toastLeft > 0);
        } else if (e.type === 'trophyCollected') {
          const text = `+${e.score}`;
          const at = popupAnchor(toPx(e.x), toPx(e.y), POPUP_LIFT_PX, rising, side, textWidth(text), { x: 0, y: 0 });
          if (e.score > 0) popups.spawn(textWidth(text), at.x, at.y, cam.scrollY, true);
          toastLeft = tuning.effects.toastFrames;
        } else if (e.type === 'enemyKilled') {
          flashes.push({ age: 0, x: toPx(e.x), y: toPx(e.y), score: e.score });
        }
      }
      // Effects.update: one frame goes by (pop-ups age, an enemy's 2-frame flash ends in its burst and pop-up).
      popups.advance(1);
      for (const f of flashes) {
        f.age += 1;
        if (f.age === 2 && f.score > 0) {
          const text = `+${f.score}`;
          popups.spawn(textWidth(text), Math.round(f.x), Math.round(f.y - POPUP_LIFT_PX), cam.scrollY, toastLeft > 0);
        }
      }

      const sx = cam.scrollX;
      const sy = cam.scrollY;
      const hx = heroDrawX(p, phys) - sx;
      const hy = heroDrawY(p, phys) - sy;
      const burning = run.phase === 'playing' && p.thrusting;
      const heroWorld: Rect = { x: hx + sx, y: hy + sy - (burning ? FUELBAR_RISE : 0), w: TILE_PX, h: TILE_PX + (burning ? FUELBAR_RISE : 0) };
      // Effects.place, with the HUD's toast as it shows on this frame.
      const shown = popups.place(sy, toastLeft > 0, heroWorld);
      {
        let pair = false;
        let onHero = false;
        let onBar = false;
        for (let a = 0; a < shown.length; a++) {
          const ra = shown[a];
          if (!ra) continue;
          if (overlap(ra, heroWorld) > 0) onHero = true;
          const inView = { x: ra.x - sx, y: ra.y - sy, w: ra.w, h: ra.h };
          if (inView.y < STRIP_H || (toastLeft > 0 && overlap(inView, toastBand) > 0)) onBar = true;
          for (let z = a + 1; z < shown.length; z++) {
            const rz = shown[z];
            if (rz && overlap(ra, rz) > 0) pair = true;
          }
        }
        if (pair) note('popupPairs', 'pop-ups', run.tick);
        if (onHero) note('popupHero', 'pop-up', run.tick);
        if (onBar) note('popupBar', 'pop-up', run.tick);
      }
      if (toastLeft > 0) toastLeft -= 1;

      if (!playing && run.phase !== 'ready') continue;
      c.ticks += 1;

      // (e) The view beyond the level.
      if (sy > innerBottom) note('beyondBottom', 'view', run.tick);
      if (!innerX(sx) && levelPx.w > size.w) note('beyondSide', 'view', run.tick);
      else if (levelPx.w <= size.w && !innerX(sx)) note('beyondSide', 'view', run.tick);

      // (c) The hero's sprite, and the fuel bar over it while he thrusts.
      const thrusting = playing && p.thrusting;
      const top = thrusting ? hy - FUELBAR_RISE : hy;
      const heroRect: Rect = { x: hx, y: top, w: TILE_PX, h: hy + TILE_PX - top };
      if (top < STRIP_H) note('heroStrip', 'hero', run.tick);
      const drawn = [...buttons].filter(([id]) => win.touch && (id === 'fire' ? p.hasBlaster : id === 'thrust' ? p.hasThruster : true));
      if (drawn.some(([, r]) => overlap(heroRect, r) > 0)) note('heroButton', 'hero', run.tick);

      // (d) Rising with less than a tile of clear view above.
      if (playing && !p.onGround && p.vy < 0 && hy - STRIP_H < TILE_PX) note('risingTight', 'hero', run.tick);

      // The things.
      const midX = toPx(p.x + (phys.heroW >> 1));
      const midY = toPx(p.y + (phys.heroH >> 1));
      const things: Thing[] = [];
      run.enemies.forEach((e, j) => {
        if (e.alive) things.push({ id: `${level.enemies[j]?.kind ?? 'enemy'} ${j}`, kind: 'enemy', x: toPx(e.x), y: toPx(e.y) });
      });
      level.pickups.forEach((pk, j) => {
        if (run.taken[j] !== true) things.push({ id: `${pk.kind} ${pk.col},${pk.row}`, kind: pk.kind, x: pk.col * TILE_PX, y: pk.row * TILE_PX });
      });
      if (!run.hasTrophy) things.push({ id: `cog ${level.trophy.col},${level.trophy.row}`, kind: 'cog', x: level.trophy.col * TILE_PX, y: level.trophy.row * TILE_PX });
      things.push({ id: `airlock ${level.door.col},${level.door.row}`, kind: 'airlock', x: level.door.col * TILE_PX, y: level.door.row * TILE_PX });
      for (const h of hazards) {
        const hcx = h.col * TILE_PX + TILE_PX / 2;
        const hcy = h.row * TILE_PX + TILE_PX / 2;
        if (Math.abs(hcx - midX) <= 6 * TILE_PX && Math.abs(hcy - midY) <= 6 * TILE_PX) things.push({ id: `hazard ${h.col},${h.row}`, kind: 'hazard', x: h.col * TILE_PX, y: h.row * TILE_PX });
      }
      for (const t of things) {
        const vx = t.x - sx;
        const vy = t.y - sy;
        const across = Math.min(vx + TILE_PX, size.w) - Math.max(vx, 0);
        if (across < TILE_PX / 2) {
          if (isKey(t) && near(t, midX, midY) && run.phase === 'playing' && keyWanted(t, run.hasTrophy)) note('hiddenNear', t.id, run.tick);
          continue;
        }
        const tile: Rect = { x: vx, y: vy, w: TILE_PX, h: TILE_PX };
        const strip = stripAt(vx + TILE_PX / 2, size.w);
        const underStrip = stripRows(vy, strip) >= TILE_PX / 2;
        if (underStrip) {
          note('stripThings', t.id, run.tick);
          if (t.kind !== 'crystal') note('stripThingsNoCrystal', t.id, run.tick);
        }
        const under = drawn.find(([, r]) => overlap(tile, r) > (TILE_PX * TILE_PX) / 4);
        if (under) {
          note('underButton', `${t.id} under ${under[0]}`, run.tick);
          const ahead = (t.x + TILE_PX / 2 - midX) * p.facing;
          if (ahead >= 0 && ahead <= 6 * TILE_PX) note('ahead6', `${t.id} under ${under[0]}`, run.tick);
          if (ahead >= 0 && ahead <= 4 * TILE_PX) note('ahead4', `${t.id} under ${under[0]}`, run.tick);
        }
        if (isKey(t) && near(t, midX, midY) && run.phase === 'playing' && keyWanted(t, run.hasTrophy)) {
          if (underStrip || under || clearRows(vy, size.h, strip) < TILE_PX / 2) note('hiddenNear', t.id, run.tick);
        }
      }
    }
  }
  return c;
}

const isKey = (t: Thing): boolean => t.kind === 'cog' || t.kind === 'blaster' || t.kind === 'thruster' || t.kind === 'airlock';
const keyWanted = (t: Thing, hasTrophy: boolean): boolean => t.kind !== 'airlock' || hasTrophy;
const near = (t: Thing, midX: number, midY: number): boolean =>
  Math.abs(t.x + TILE_PX / 2 - midX) <= 8 * TILE_PX && Math.abs(t.y + TILE_PX / 2 - midY) <= 4 * TILE_PX;

/** Pop-ups as the shipped Effects lays them out (`PopupBoard`), for `measureRoute`. */
export function shippedPopups(reducedMotion = false): PopupsUnderTest {
  const board = new PopupBoard(reducedMotion);
  return {
    clear: () => {
      board.clear();
    },
    spawn: (textW, x, y, camY, toastUp) => {
      board.spawn(textW, x, y, camY, toastUp);
    },
    advance: (frames) => {
      board.advance(frames);
    },
    place: (camY, toastUp, hero) => {
      board.place(camY, toastUp, hero);
      return board.shown().map((p) => ({ x: p.drawX, y: p.drawY, w: p.w, h: POPUP_H }));
    },
  };
}
