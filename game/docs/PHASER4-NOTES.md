# Phaser 4.2.1 notes for the shell

This is the reference for everything outside `src/core`: boot, scaling, drawing, scenes, the frame loop, input, sound, pausing and storage. Follow it instead of Phaser 3 habits or examples from memory. `docs/ARCHITECTURE.md` says *what* the shell must do (section 11) and which file owns what (section 2); this file says *how* to do it in Phaser 4.2.1 with code that has been run.

## Where each fact comes from

Every code block and every claim carries one of these tags.

| Tag | Meaning |
|---|---|
| **[R]** | Run by the rendering spike (headless Chromium, Playwright 1.63, WebGL on SwiftShader, phaser 4.2.1) |
| **[I]** | Run by the input spike (same set-up, plus headed Chromium under `xvfb-run` for throttling) |
| **[C]** | Run on 2026-11-21 by this document's own check. The two spikes were written apart and the rulings changed parts of both, so the merged recipes below were built as one small Vite app with the game's real `src/tuning.ts` and `src/core/types.ts`, served from a sub-path, and driven by Playwright: **152 browser checks and 36 unit checks, all passing**. Its sources also pass `tsc` and `eslint` under copies of this project's `tsconfig.json` and `eslint.config.js` |
| **[F]** | Run on 2026-11-21 by the foundation fix that followed the review of these documents: stand-alone pages without Phaser in headless Chromium (Playwright 1.63). Used only for the rotate guard of section 17 |
| **FROM SKILL FILE** | Read in `docs/phaser-skills/**`, not run |
| **UNVERIFIED** | Nobody ran it. Treat it as a sketch |

Code tagged [C] is the code that ran, character for character, unless the text above the block lists what was left out or changed afterwards. The scratch folders (`spike-render`, `spike-input`, `phaser-notes-check` under the session scratchpad) may be gone by the time you read this; everything needed is inlined here.

**Nothing in this file was run on a real phone, in Safari or in Firefox.** Section 21 lists what that leaves open.

## Conflicts

Places where the two spikes, the designs and the rulings disagree, and what this file does about each. Nothing here is hidden further down.

| # | Topic | The disagreement | Used here |
|---|---|---|---|
| 1 | Renderer type | Render spike's snippets say `Phaser.WEBGL`; input spike says `Phaser.AUTO` | `Phaser.AUTO`. It picked WebGL in every run [I][C]. Where WebGL is missing it falls back to the Canvas renderer, which runs the game but ignores tints [R][C]; `Phaser.WEBGL` would throw instead [I] |
| 2 | Scale mode | Input spike's config uses `Scale.FIT` + `CENTER_BOTH` at 320 x 180 (and notes it looks uneven); render spike proved `Scale.NONE` + CSS transform | Ruling R11: `Scale.NONE` + CSS transform. The merged config (input spike's keys, render spike's scale block) was run as one [C] |
| 3 | View size rounding | Render spike: `Math.ceil`, canvas covers the window and overhangs by up to Z - 1 device pixels, no upper limit, minimum 320 x 200 px. Feel design and R11: `Math.floor`, minimum 17 x 10 tiles, cap 30 x 14 tiles, centred, pillarboxed to the notch | R11. The render spike's 72-case proof was for a canvas at the window's corner, so pixel uniformity was proven again with offsets and caps [C] |
| 4 | Device pixel count | Render spike: `Math.round(innerWidth * dpr)`. Feel design and ARCHITECTURE 11.5: `Math.floor((cssW - insets) * dpr)` | `Math.floor`: the canvas can then never be larger than the window |
| 5 | Pixel-ratio change | Render spike suggests a `matchMedia('(resolution: ...dppx)')` listener (unverified). In the check that listener did **not** fire when the ratio changed | Compare `devicePixelRatio` once per frame [C] |
| 6 | Frame pacing | Feel design: at most 4 steps per frame, drop gaps over 250 ms. Input spike: at most 5, backlog dropped, Phaser's smoothed `delta` (raw gaps over 200 ms never arrive) | Input spike's, as ARCHITECTURE section 14 and `TUNING.pacing.maxStepsPerFrame = 5` already say |
| 7 | Interpolation | Feel design: always interpolate. Input spike: frame-lock at 60 Hz, high refresh unverified. R13: 'auto' | R13, with a gate that was run at 60 Hz and at about 500 Hz [C]. Real 90 and 120 Hz screens are UNVERIFIED |
| 8 | How to interpolate | ARCHITECTURE 11.1: lerp sub-pixels, then floor. Measured here with a small numeric model: with the camera locked to the hero (and the camera blended and rounded on its own) that makes the hero wobble between three screen pixels at 144 Hz | `lerpPx`: lerp the whole-pixel draw positions, the same way for sprites and camera. Zero wobble at 60, 90, 120, 144 and about 500 Hz [C]. ARCHITECTURE 11.1 has since been changed to say the same; this document's section 12 is the recipe |
| 9 | HUD data | Render spike's HUD polls the simulation in its own `update`. Input spike found the HUD scene updates *before* Play, so polling is one frame late | Play pushes to the HUD after its ticks [C] |
| 10 | Touch buttons | Input spike: five 72 px elements, each receives `pointerdown`, hit-tested by element rectangle. Feel design and R14: sizes and places from a pure function, large invisible zones, FIRE and THRUST only while held | R14's layout on the input spike's pointer plumbing (one tracker, window-level move/up/cancel). Re-run with real multi-touch sequences [C] |
| 11 | Names | Input spike calls the button `jet`; the core's `Input` field is `thrust` | `thrust` |
| 12 | Pause | Input spike: a soft pause that any key or tap ends. Feel design, R4 and R7: a pause overlay with a menu; resuming goes through the core's ready gate | Overlay scene; RESUME calls `holdReady(game)` |
| 13 | Rotate message | Input spike's CSS shows it in any portrait window. Feel design: touch devices only. Review: inside a tall preview frame the window is "portrait" although the device is not, and a phone can never get past the message | Touch devices only, and only when the **device** is upright (`screen.orientation`), not merely the window (`#app.touch.upright`) [F] |
| 14 | Touch detection | Input spike: `(pointer: coarse)` or `maxTouchPoints > 0` at boot. Feel design: `(any-pointer: coarse)` at boot, or the first touch; a key press hides the pad again | Feel design's rule [C] |
| 15 | Keys | Input spike: Z thrusts, Esc pauses, through `keydown-ESC`. Feel design: Z or Shift, Esc or P. `keydown-ESC` re-fires on key auto-repeat [C] | Z and Shift; Esc and P; always through `addKey(code).on('down')` |
| 16 | Storage keys | Input spike suggests one key like `pip.save.v1`. R1 and ARCHITECTURE section 10: `moon-foundry:progress` and `moon-foundry:settings`, version inside the data | R1 |
| 17 | Font cell | Render spike's sample font is a 4 x 6 cell. Content design and `docs/ART-AND-SOUND.md` section 7: 5 x 7 glyph in a 6 x 8 cell, advance 6, line height 9 | Cell 6 x 8 with `lineSpacing: 1`, crisp at 1x, 2x and 3x [C] |
| 18 | Camera | Render spike's sample `stepCamera` (dead zone plus speed limit) is not the feel design's camera | The camera maths belongs to ARCHITECTURE 11.4. This file covers only how its result reaches Phaser |
| 19 | RetroFont | The shipped skill file (`text-and-bitmaptext`) shows `cache.bitmapFont.add(key, { data: RetroFont.Parse(...) })`; that throws [R] | Pass `Parse()`'s result itself [R][C] |
| 20 | Import style | Both spikes write `import Phaser from 'phaser'`; the Phase 0 skeleton writes `import * as Phaser from 'phaser'` | Both compile here [C]. Keep the skeleton's form; use `import type * as Phaser` in files that need only types |
| 21 | Particle colour | Render spike's emitter has a `tint` array in its config. `docs/ART-AND-SOUND.md` wants one emitter whose sparks are tinted per use. With a `tint` array in the config, `setParticleTint` is ignored [C] | Emitter with no `tint` in its config; `setParticleTint(colour)` before each `explode` [C] |
| 22 | Tile change cost | Render spike measured `putTileAt` at 0.3 ms (one cold call) | About 0.4 microseconds per call over 2000 calls [C]. Animating hazards by swapping tile indexes is cheap |

---
# Part 1. Decisions for this game

## 1. Decisions on one screen

| Topic | Do this | Not this |
|---|---|---|
| Renderer | `type: Phaser.AUTO` | `Phaser.WEBGL`, `Phaser.CANVAS` |
| Assets | Build every texture in `BootScene.create()`; no `preload()` | Image, atlas, font or audio files |
| Textures | `makeSheet` (section 4): `textures.createCanvas`, `putImageData`, `refresh()`, `tex.add(name, ...)` | `textures.generate` (gone), `addUint8Array`, DynamicTexture |
| Sampling | `pixelArt: true` in the game config | Per-texture filters, `smoothPixelArt`, padding between frames |
| Level | CPU `TilemapLayer` from `make.tilemap({ data })` | `TilemapGPULayer`, Blitter, one Image per tile, stamped textures |
| Scaling | `Scale.NONE`, canvas in game pixels, CSS `transform: translate(...) scale(Z / dpr)` | `Scale.FIT`, `RESIZE`, `MAX_ZOOM`, `scale.zoom`, camera zoom |
| Camera | Pure `stepCamera`, then `cam.setScroll(integer, integer)`; zoom stays 1 | `startFollow`, `setLerp`, `setDeadzone`, `setBounds`, `setZoom` |
| Sprites | `Image` objects in a `Map` keyed by entity id; `setFrame` each frame; whole-pixel positions | `Sprite` with the animation manager; fractional positions |
| Text | `BitmapText` through `RetroFont.Parse` from a runtime glyph sheet, origin 0, whole-pixel positions | `this.add.text`, `setOrigin(0.5)` on bitmap text |
| HUD | Its own scene, launched by Play, fed by pushes | A second camera; polling the simulation |
| Effects | One particle emitter with `emitting: false` and `explode()`; `setTintMode(FILL)`; camera `flash` and `shake` | A particle manager, `setTintFill`, filters |
| Loop | Own `FixedStepper` fed Phaser's `delta`; `fps: { panicMax: 0 }` | `fps.limit`, `fps.forceSetTimeOut`, Arcade `fixedStep` |
| Keyboard | Poll `isDown` each frame and latch Key `'down'` events | `JustDown`, `keydown-XXX` events for actions |
| Touch | DOM pad over the canvas, Pointer Events, `touch-action: none`; Phaser `input.windowEvents: false` | Phaser zones or extra Phaser pointers for the pad |
| Audio | Private `AudioContext`, `audio: { noAudio: true }` | `this.sound`, audio files |
| Pause | A `mode` flag in Play plus a Pause scene; `game.pause()` only under the rotate message | Expecting Phaser to pause on blur; `scene.pause()` |
| Orientation | `matchMedia('(orientation: portrait)')` together with `screen.orientation.type` (section 17) | The Scale Manager's orientation event; the media query alone |
| Storage | `loadJson` / `saveJson` wrappers that never throw | Bare `localStorage` |

## 2. The page: `index.html`

**[C]** This is the page the check ran, complete, with two lines changed afterwards: the button rim is now the palette's `light steel` (`#8090b4`, as `docs/ART-AND-SOUND.md` section 10 says; the check ran with `#bfcbe0`), and the rotate message is shown by the class `upright` that the rotate guard sets (section 17, [F]) instead of by a bare `@media (orientation: portrait)` rule. Compared with the Phase 0 `index.html` it adds the `#app` wrapper (the fullscreen target), the touch pad, the rotate message and the safe-area probe, and the background becomes palette colour 0 (`#0b0d1a`, "void"). Keep the Phase 0 file's `<title>%GAME_TITLE%</title>`, `theme-color` (change it to `#0b0d1a` too) and empty favicon link; the button labels below are placeholders for the real icons.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <title>phaser notes check</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; overscroll-behavior: none;
                   background: #0b0d1a; -webkit-text-size-adjust: 100%; }
      body { position: fixed; inset: 0; touch-action: none; }
      #app { position: fixed; inset: 0; }
      #app, #app * { touch-action: none; user-select: none; -webkit-user-select: none;
                     -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
      #game { position: absolute; inset: 0; overflow: hidden; }
      #game canvas { display: block; }

      /* Carries the safe-area insets as padding so script can read them (readSafeInsets). */
      #safe-probe { position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;
                    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
                             env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }

      /* Touch pad: shown only on touch devices while a level is being played. */
      #pad { position: absolute; inset: 0; pointer-events: none; display: none; }
      #app.touch.playing #pad { display: block; }
      #pad .zone { position: absolute; pointer-events: auto; }
      #pad .tbtn { position: absolute; pointer-events: none; box-sizing: border-box; opacity: var(--pad-idle, 0.35);
                   border: 2px solid #8090b4; background: #151a36; color: #f5f8fc; border-radius: 50%;
                   display: flex; align-items: center; justify-content: center; font: bold 12px monospace;
                   transition: opacity var(--pad-appear, 150ms); }
      #pad .tbtn[data-btn='left'], #pad .tbtn[data-btn='right'], #pad .tbtn[data-btn='pause'] { border-radius: 12px; }
      #pad .tbtn[data-btn='fire'], #pad .tbtn[data-btn='thrust'] { opacity: 0; }
      #pad .tbtn.shown { opacity: var(--pad-idle, 0.35); }
      #pad .tbtn.shown.dim { opacity: var(--pad-dimmed, 0.15); }
      #pad .tbtn.on { opacity: var(--pad-pressed, 0.6); transform: scale(var(--pad-pressed-scale, 0.94)); }

      /* Rotate message: a touch device that is held upright. installRotateGuard sets the class "upright". */
      #rotate { display: none; position: absolute; inset: 0; z-index: 10; background: #0b0d1a; color: #f5f8fc;
                font: bold 20px monospace; align-items: center; justify-content: center; text-align: center; }
      #app.touch.upright #rotate { display: flex; }
    </style>
  </head>
  <body>
    <div id="app">
      <div id="game"></div>
      <div id="pad">
        <div class="zone" data-zone="move"></div>
        <div class="zone" data-zone="action"></div>
        <div class="zone" data-zone="pause"></div>
        <div class="tbtn" data-btn="left" role="button" aria-label="Move left">&lt;</div>
        <div class="tbtn" data-btn="right" role="button" aria-label="Move right">&gt;</div>
        <div class="tbtn" data-btn="jump" role="button" aria-label="Jump">JUMP</div>
        <div class="tbtn" data-btn="fire" role="button" aria-label="Fire">FIRE</div>
        <div class="tbtn" data-btn="thrust" role="button" aria-label="Thrust">FLY</div>
        <div class="tbtn" data-btn="pause" role="button" aria-label="Pause">II</div>
      </div>
      <div id="rotate" role="alert">Rotate your phone</div>
      <div id="safe-probe"></div>
    </div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

What each hardening rule is for, measured with real touch sequences [I]:

| | No CSS, plain viewport | `user-scalable=no` only | CSS above |
|---|---|---|---|
| Finger drags up | Page scrolled 175 px | Scrolled 175 px | No scroll |
| Held button, finger wobbles 20 px | `pointercancel`, button released | Same | Stays held |
| Two-finger pinch | Zoom x5 | No zoom | No zoom |

Phaser sets no `touch-action` on its canvas, so the `#app *` rule is what protects it [I]. Without `touch-action: none` a held button is cancelled as soon as the browser decides the finger is panning.

## 3. Renderer and GameConfig: `src/main.ts`

**[C]** As run, with three check-only lines left out (a `?safe=` test override of the insets, a `?renderer=` switch, an export of the view for the tests) and the scene imports renamed to the planned files. `EndScene` was not part of the check.

```ts
import * as Phaser from 'phaser';

import { TUNING } from './tuning';
import { applyLayout, readSafeInsets, watchViewport } from './shell/applyLayout';
import { chooseView, type View } from './shell/chooseView';
import { installRotateGuard, installTouchMode } from './shell/lifecycle';
// plus the scene classes, and app, safeProbe, sfx, pad, onPadPause from './shell/singletons' (shown below)

const BACKDROP = '#0b0d1a'; // palette colour 0 "void"; the page background in index.html is the same colour
const params = new URLSearchParams(window.location.search);

sfx.install(); // before any gesture: it only adds listeners

const dpr = (): number => window.devicePixelRatio || 1;
const currentView = (): View =>
  chooseView(window.innerWidth, window.innerHeight, dpr(), readSafeInsets(safeProbe), TUNING.view);

const first = currentView();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: BACKDROP,
  pixelArt: true, // nearest filtering for every texture, antialias off, roundPixels on, canvas image-rendering: pixelated
  banner: false,
  disableContextMenu: true,
  audio: { noAudio: true }, // sound is hand-written WebAudio on a private AudioContext (Sfx)
  fps: { panicMax: 0 }, // no 120-frame capped-delta cool-down after boot / focus / visible
  input: { activePointers: 2, windowEvents: false }, // Phaser listens on the canvas only; the DOM pad owns the rest
  scale: {
    mode: Phaser.Scale.NONE,
    width: first.viewW,
    height: first.viewH,
    zoom: 1,
    autoCenter: Phaser.Scale.NO_CENTER,
    fullscreenTarget: 'app', // so the DOM pad and the rotate message go fullscreen with the canvas
  },
  scene: [BootScene, TitleScene, PlayScene, HudScene, PauseScene, EndScene], // first one starts; array order = draw order
});

let appliedDpr = dpr();
const relayout = (): void => {
  appliedDpr = dpr();
  const view = currentView();
  applyLayout(game, view, appliedDpr);
  pad.layout(window.innerWidth, window.innerHeight, readSafeInsets(safeProbe));
};
game.events.once(Phaser.Core.Events.READY, relayout); // emitted before the first frame
watchViewport(relayout);
// devicePixelRatio can change with no resize event (the window dragged to another monitor): compare one number per frame.
game.events.on(Phaser.Core.Events.PRE_STEP, () => {
  if (dpr() !== appliedDpr) relayout();
});

const pausePlay = (): void => {
  const play = game.scene.getScene('Play');
  if (play instanceof PlayScene && game.scene.isActive('Play')) play.pauseGame();
};
onPadPause(pausePlay);
const applyRotate = installRotateGuard(game, app, pausePlay);
installTouchMode(app, params.get('touch') === '1', applyRotate);
```

`app`, `safeProbe`, `sfx`, `controls`, `pad` and `onPadPause` are module-level singletons that the scenes import too [C]. The file is `src/shell/singletons.ts` (ARCHITECTURE section 2):

```ts
// src/shell/singletons.ts: shell singletons shared by main.ts and the scenes.
import { TUNING } from '../tuning';

import { Controls } from '../input/Controls';
import { Sfx } from '../audio/Sfx';
import { installTouchPad } from '../input/TouchPad';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html: missing #${id}`);
  return el;
};

export const app = byId('app');
export const safeProbe = byId('safe-probe');
export const controls = new Controls();
export const sfx = new Sfx();

let pauseHandler: () => void = () => undefined;
/** PAUSE on the touch pad calls whatever the running scene registered here. */
export function onPadPause(handler: () => void): void {
  pauseHandler = handler;
}
export const pad = installTouchPad(byId('pad'), controls, TUNING.touch, () => {
  pauseHandler();
});
```

Why each config key is there:

| Key | Reason | Source |
|---|---|---|
| `type: Phaser.AUTO` | Resolved to WebGL (`game.renderer.type === Phaser.WEBGL`) with no browser flags. The context is WebGL 1; Phaser never asks for WebGL 2 | [I][C] |
| `parent: 'game'` | The canvas goes inside `#game`, which sits inside `#app` next to the pad | [I][C] |
| `pixelArt: true` | Gives `antialias: false`, `roundPixels: true` (v4's default is `false`), NEAREST sampling on every texture source, CSS `image-rendering: pixelated`. A 1 px checker drawn at 8x had exactly 2 colours with it and 108 without | [R] |
| `audio: { noAudio: true }` | No Phaser `AudioContext` is created at all; `game.sound` becomes a no-op manager | [I][C] |
| `fps: { panicMax: 0 }` | By default Phaser caps `delta` at 16.7 ms for 120 frames after boot, focus or becoming visible: a phone running at 30 fps played at half speed for 2 s. With 0 the speed was right from the first second | [I] |
| `input.windowEvents: false` | With the default, a touch on a DOM button used up Phaser's only touch pointer and produced `pointerdownoutside` events | [I] |
| `input.activePointers: 2` | Phaser has one touch pointer by default and silently drops further fingers. Two is what the input spike's reference shell and the check ran with; nothing in the game needs more, because the pad is not Phaser's | [I][C] |
| `scale` block | Section 6 | [R][C] |
| `fullscreenTarget: 'app'` | With the default target Phaser wraps the canvas in a new `<div>` and fullscreens that: the DOM pad vanished. With `'app'` the fullscreen element is `#app`, the canvas stays in `#game`, the pad stays visible and the layout follows | [I][C] |
| `scene` array | The first scene starts by itself. Array order is draw order (later = on top) and never changes | [I] |

Observed at boot [C]: served from `/deep/sub/`, the build made two requests (the HTML and one 1.39 MB script, 367 kB gzip), started in the Title scene with no console error, and made no asset request.

Never set: `smoothPixelArt` (it forces `antialias: true` [R]), `scale.zoom` other than 1, `fps.limit`, `fps.forceSetTimeOut`, `physics`.

What this replaces in the Phase 0 skeleton:

- `index.html`: the body and the style block become section 2.
- `src/main.ts`: `Scale.RESIZE` with `'100%'` sizes becomes the config above; the background colour becomes `#0b0d1a`.
- `src/scenes/TitleScene.ts` moves to `src/shell/scenes/` and draws with `BitmapText` instead of `this.add.text`. Keep its `window.__GAME_READY__ = true` on the first `POST_RENDER`: `e2e/smoke.spec.ts` waits for it. That test's other assertions (a WebGL context on `#game canvas`, the canvas inside the viewport, no page scroll, no console errors) all held for the page and config above [C].

## 4. Boot with zero asset files, and `makeSheet`

`BootScene` has no `preload()`. Its `create()` builds every texture and the font, then starts the title. Level text reaches the bundle through `levels/*.txt?raw` imports in `src/levels.ts`, not through Phaser's loader.

**[C]** (from [R], merged into one file, shape checks kept) `src/art/makeSheet.ts`, complete:

```ts
import * as Phaser from 'phaser';

/** Palette: one character -> 0xRRGGBB, or null for transparent. */
export type Palette = Readonly<Record<string, number | null>>;
/** A frame is rows of palette characters; all frames on a sheet share one cell size. */
export type FrameGrid = readonly string[];

/**
 * Turns palette-indexed text grids into ONE canvas texture with a named frame per grid.
 * Frames are packed row-major in the order of the object's keys, so the n-th frame is also
 * tile index n for a Tilemap that uses this texture as its tileset.
 */
export function makeSheet(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frames: Readonly<Record<string, FrameGrid>>,
  cellW: number,
  cellH: number,
  palette: Palette,
  columns = 16,
): Phaser.Textures.CanvasTexture {
  const names = Object.keys(frames);
  const cols = Math.min(columns, names.length);
  const rows = Math.ceil(names.length / cols);
  const tex = textures.createCanvas(key, cols * cellW, rows * cellH);
  if (!tex) throw new Error(`texture key already in use: ${key}`); // createCanvas returns null on a duplicate key
  const ctx = tex.getContext();
  const img = ctx.createImageData(tex.width, tex.height);
  names.forEach((name, n) => {
    const grid = frames[name];
    const ox = (n % cols) * cellW;
    const oy = Math.floor(n / cols) * cellH;
    if (grid?.length !== cellH) throw new Error(`frame ${name}: expected ${cellH} rows`);
    grid.forEach((row, y) => {
      if (row.length !== cellW) throw new Error(`frame ${name} row ${y}: expected ${cellW} chars`);
      for (let x = 0; x < cellW; x++) {
        const ch = row.charAt(x);
        const rgb = palette[ch];
        if (rgb === undefined) throw new Error(`frame ${name}: unknown palette char '${ch}'`);
        if (rgb === null) continue;
        const i = ((oy + y) * tex.width + ox + x) * 4;
        img.data[i] = (rgb >> 16) & 255;
        img.data[i + 1] = (rgb >> 8) & 255;
        img.data[i + 2] = rgb & 255;
        img.data[i + 3] = 255;
      }
    });
  });
  ctx.putImageData(img, 0, 0);
  tex.refresh(); // REQUIRED: uploads the canvas to the GPU. Without it the texture is blank.
  names.forEach((name, n) => {
    tex.add(name, 0, (n % cols) * cellW, Math.floor(n / cols) * cellH, cellW, cellH);
  });
  return tex;
}

/**
 * Registers a fixed-cell bitmap font whose glyphs live in a texture made by makeSheet
 * (white on transparent, one glyph per cell, in the order of `chars`).
 * The font's size is the cell WIDTH: draw it at whole multiples of cellW.
 */
export function addPixelFont(
  scene: Phaser.Scene,
  fontKey: string,
  textureKey: string,
  chars: string,
  cellW: number,
  cellH: number,
  charsPerRow: number,
  lineSpacing: number,
): void {
  // RetroFontConfig is typed with literal keys such as 'offset.x', hence the cast.
  const config = { image: textureKey, width: cellW, height: cellH, chars, charsPerRow, lineSpacing };
  const entry = Phaser.GameObjects.RetroFont.Parse(
    scene,
    config as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig,
  );
  scene.cache.bitmapFont.add(fontKey, entry); // pass Parse()'s result itself, NOT { data: entry }
}
```

**[C]** How the check's boot scene uses it. The frame grids here are generated test patterns and the glyphs are 3 x 5 stand-ins; the real grids live in `src/art/sprites/*.ts` and `src/art/font.ts`.

```ts
const PAL: Palette = {
  '.': null, '0': 0x0b0d1a, '1': 0x151a36, '4': 0x53628c, '6': 0xbfcbe0, '7': 0xf5f8fc, '8': 0xf1e2c3, c: 0xffd65c, e: 0xd8442a, g: 0xb4f04a,
};
const gen = (w: number, h: number, fn: (x: number, y: number) => string): string[] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)).join(''));
```

```ts
// 3x5 test glyphs placed in the font's 6x8 cell (the real glyphs are 5x7 in the same cell).
const GLYPHS: Readonly<Record<string, string>> = {
  '0': '###/#.#/#.#/#.#/###', '1': '.#./##./.#./.#./###', '2': '###/..#/###/#../###', '3': '###/..#/###/..#/###',
  '4': '#.#/#.#/###/..#/..#', '5': '###/#../###/..#/###', '6': '###/#../###/#.#/###', '7': '###/..#/..#/..#/..#',
  '8': '###/#.#/###/#.#/###', '9': '###/#.#/###/..#/###', A: '.#./#.#/###/#.#/#.#', C: '###/#../#../#../###',
  D: '##./#.#/#.#/#.#/##.', E: '###/#../##./#../###', F: '###/#../##./#../#..', L: '#../#../#../#../###',
  M: '#.#/###/###/#.#/#.#', O: '###/#.#/#.#/#.#/###', P: '###/#.#/###/#../#..', R: '##./#.#/##./#.#/#.#',
  S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.', U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.', ' ': '.../.../.../.../...',
};
export const FONT_CHARS = Object.keys(GLYPHS).join('');
export const FONT_W = 6;
export const FONT_H = 8;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    makeSheet(this.textures, 'tiles', {
      wall: gen(TILE, TILE, (x, y) => (x === 0 || y === 0 ? '6' : '4')),
      checker: gen(TILE, TILE, (x, y) => ((x + y) & 1 ? '7' : '0')),
      door: gen(TILE, TILE, (x, y) => (x > 2 && x < 13 && y > 1 ? 'e' : '4')),
      doorOpen: gen(TILE, TILE, (x, y) => (x > 2 && x < 13 && y > 1 ? '1' : '4')),
    }, TILE, TILE, PAL);
    makeSheet(this.textures, 'ents', {
      hero: gen(TILE, TILE, (x, y) => (x > 3 && x < 12 && y > 1 ? (x > 8 && y < 6 ? 'g' : '8') : '.')),
      enemy: gen(TILE, TILE, (x, y) => ((x - 8) ** 2 + (y - 9) ** 2 < 40 ? 'e' : '.')),
      star: gen(TILE, TILE, (x, y) => (x === 8 || y === 8 ? '7' : '.')),
      spark: gen(TILE, TILE, (x, y) => (x < 2 && y < 2 ? '7' : '.')),
    }, TILE, TILE, PAL);
    this.textures.get('ents').add('spark2', 0, 3 * TILE, 0, 2, 2); // a 2x2 px frame inside the 'spark' cell
    const glyphFrames = Object.fromEntries(
      FONT_CHARS.split('').map((ch) => [
        ch,
        [...(GLYPHS[ch] ?? '').split('/').map((row) => row.replace(/#/g, '7') + '...'), '......', '......', '......'],
      ]),
    );
    makeSheet(this.textures, 'font', glyphFrames, FONT_W, FONT_H, { '.': null, '7': 0xffffff }, FONT_CHARS.length);
    addPixelFont(this, 'pix', 'font', FONT_CHARS, FONT_W, FONT_H, FONT_CHARS.length, 1); // line height 8 + 1 = 9
    this.scene.start('Title');
  }
}
```

Facts:

- `textures.createCanvas` returns `null` when the key exists. The result is a `CanvasTexture`; `getFrameNames()` lists the added names [R].
- Without `tex.refresh()` the texture draws as nothing [R].
- Frames are packed row-major in key order, 16 per row by default, so the n-th key is tile index n [R][C]. Keep tile frames in one fixed order and add new ones at the end.
- JavaScript lists object keys that look like whole numbers (`'0'` to `'9'`) first, in numeric order, whatever order they were typed in. A font sheet keyed by its characters is therefore packed digits first, not in the order `docs/ART-AND-SOUND.md` lists the glyphs. Either take the font's `chars` string from `Object.keys(frames).join('')` as the check does (the text then draws correctly; only the order on the sheet differs), or key the glyph frames by names that are not numbers (such as `'g48'`) so the typed order is kept. Never pair a hand-typed `chars` string with character-keyed frames, and do not give tile or sprite frames numeric names.
- No padding or extrusion between frames is needed: with the scaling of section 6 nothing bled between neighbours [R][C].
- After a forced WebGL context loss and restore, canvas textures and the tilemap came back by themselves; a DynamicTexture came back blank [R].
- `tex.add(name, 0, x, y, w, h)` can add extra frames of any size to an existing sheet, such as the 2 x 2 px particle above [R][C].

## 5. Tiles

**[C]** (from [R]) In the check's `PlayScene.create()`; the nested loop is a test pattern standing in for the level:

```ts
// --- level: CPU TilemapLayer from a 2D array; index = frame order in the 'tiles' sheet, -1 = empty
const data: number[][] = [];
for (let y = 0; y < LEVEL_ROWS; y++) {
  const row: number[] = [];
  for (let x = 0; x < LEVEL_COLS; x++) {
    row.push(y === 0 || y >= LEVEL_ROWS - 2 || x === 0 || x === LEVEL_COLS - 1 ? 0 : y >= 6 && y < 10 && x > 4 && x < 12 ? 1 : -1);
  }
  data.push(row);
}
const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
const tileset = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
if (!tileset) throw new Error('tileset');
const layer = map.createLayer(0, tileset, 0, 0);
if (!(layer instanceof Phaser.Tilemaps.TilemapLayer)) throw new Error('layer');
this.layer = layer;
layer.putTileAt(2, 20, LEVEL_ROWS - 3);
```

Later, one tile is changed with `this.layer?.putTileAt(3, 20, LEVEL_ROWS - 3)` [C]; `layer.putTileAt(-1, tx, ty)` clears a cell [R].

- Build `data` from `LevelData` in `src/shell/TileLayer.ts`. Tile index = position of the frame in the `tiles` sheet.
- `putTileAt(index, x, y)` costs about 0.4 microseconds, and `putTileAt(index, x, y, false)` (skip the collision-face update the game does not use) about 0.25 [C]. Opening the airlock and animating fire, coolant and spikes by swapping indexes are all fine.
- Why the plain layer [R] (800 x 304 canvas, 48 scroll offsets, pixel analysis for gaps, bleed and uneven columns):

| Approach | Zoom 1, any scroll | Zoom 2 to 5, scroll snapped | One-tile change | After GL context loss |
|---|---|---|---|---|
| `TilemapLayer` | Clean 48 of 48 | Clean | `putTileAt` | Restored |
| `TilemapGPULayer` | **Fails** at .5 scroll | Clean | Needs `generateLayerDataTexture()` | Not tested |
| One `Image` per tile | Clean | Clean | `setFrame` | Restored |
| Stamped DynamicTexture | Clean | Clean | `clear` + `stamp` + `render()` | **Blank** |
| Blitter | **Fails** at .5 scroll | Clean | `bob.setFrame` | Not tested |

- `TilemapGPULayer` in 4.2.1 also draws index -1 as tile 0, and `removeTileAt` followed by `generateLayerDataTexture()` throws [R]. Never pass the `gpu` flag to `createLayer`.

## 6. Pixel-perfect scaling

The method [R]: the canvas backing store is in **game pixels**. Phaser runs in `Scale.NONE` with zoom 1 and never sets a CSS size on the canvas. A CSS transform enlarges the canvas by exactly `Z / devicePixelRatio`, so one game pixel is exactly `Z` device pixels. Ruling R11 adds: `Z` is the largest whole number that still shows 17 x 10 tiles, the view is capped at 30 x 14 tiles, and the canvas is centred inside the horizontal safe area with offsets that are whole device pixels.

**[C]** `src/shell/chooseView.ts`, complete (pure, unit-testable):

```ts
import type { ViewTuning } from '../core/types';

/** Safe-area insets in CSS pixels (the notch and the home bar). */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface View {
  /** Whole device pixels per game pixel. */
  zoom: number;
  /** Canvas backing-store size, which is also the camera size, in game pixels. */
  viewW: number;
  viewH: number;
  /** Top-left corner of the canvas in CSS pixels from the window's top-left. Always a whole number of device pixels. */
  cssLeft: number;
  cssTop: number;
}

const TILE_PX = 16;

/** Pure: no Phaser, no DOM. Ruling R11. */
export function chooseView(cssW: number, cssH: number, dpr: number, safe: Insets, t: ViewTuning): View {
  // Device pixels available to the game: full height, width minus the notch on either side.
  const dw = Math.max(1, Math.floor((cssW - safe.left - safe.right) * dpr));
  const dh = Math.max(1, Math.floor(cssH * dpr));
  // The largest whole zoom that still shows the minimum number of tiles both ways.
  const zoom = Math.max(
    1,
    Math.min(Math.floor(dw / (t.viewMinCols * TILE_PX)), Math.floor(dh / (t.viewMinRows * TILE_PX))),
  );
  // floor: the canvas never pokes out of the safe area; the cap letterboxes large windows.
  const viewW = Math.min(Math.floor(dw / zoom), t.viewMaxCols * TILE_PX);
  const viewH = Math.min(Math.floor(dh / zoom), t.viewMaxRows * TILE_PX);
  // Centre the leftover. Offsets are whole device pixels, so every game pixel lands on the device grid.
  const offX = Math.round(safe.left * dpr) + Math.floor((dw - viewW * zoom) / 2);
  const offY = Math.floor((dh - viewH * zoom) / 2);
  return { zoom, viewW, viewH, cssLeft: offX / dpr, cssTop: offY / dpr };
}
```

**[C]** `src/shell/applyLayout.ts`, complete (DOM and Phaser):

```ts
import type * as Phaser from 'phaser';

import type { Insets, View } from './chooseView';

/**
 * CSS env(safe-area-inset-*) cannot be read from script, so a hidden probe element carries the four
 * insets as its padding (see the #safe-probe rule in index.html) and this reads them back.
 */
export function readSafeInsets(probe: HTMLElement): Insets {
  const style = getComputedStyle(probe);
  const px = (value: string): number => Number.parseFloat(value) || 0;
  return {
    left: px(style.paddingLeft),
    right: px(style.paddingRight),
    top: px(style.paddingTop),
    bottom: px(style.paddingBottom),
  };
}

/** Applies a view: canvas backing store = game pixels, CSS transform = position + exact integer upscale. */
export function applyLayout(game: Phaser.Game, view: View, dpr: number): void {
  const style = game.canvas.style;
  style.transformOrigin = '0 0';
  style.transform = `translate(${view.cssLeft}px, ${view.cssTop}px) scale(${view.zoom / dpr})`;
  if (game.scale.width !== view.viewW || game.scale.height !== view.viewH) {
    // Scale mode NONE + zoom 1: resize() sets canvas.width/height, resizes the renderer and every
    // full-size camera in every scene, re-reads the canvas bounds for input, and emits 'resize'.
    game.scale.resize(view.viewW, view.viewH);
  } else {
    // Same size, new position or zoom: only the input bounds need re-reading (also emits 'resize').
    game.scale.refresh();
  }
}

/** Calls onChange (at most once per frame) whenever the window size or orientation changes. Returns a remover. */
export function watchViewport(onChange: () => void): () => void {
  let queued = false;
  const handler = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      onChange();
    });
  };
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  window.visualViewport?.addEventListener('resize', handler);
  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    window.visualViewport?.removeEventListener('resize', handler);
  };
}
```

The wiring is in section 3: first view before `new Phaser.Game`, `relayout` once on `READY`, again from `watchViewport`, and when `devicePixelRatio` changes.

Order matters inside `applyLayout`: set the transform first, then call `resize()` or `refresh()`. Both end in `ScaleManager.refresh()`, which re-reads the canvas rectangle with `getBoundingClientRect()` (transform included) and derives the input scale from it; that is the whole reason pointer coordinates come out right with no extra code (Phaser source, `ScaleManager.updateBounds`, and measured below).

**Observed [C]** (1 px checkerboard tiles; run lengths measured along rows and columns of the device-pixel screenshot; the first checker pixel must start on the computed device pixel; the pixels beside the canvas must be page background):

| Window (CSS px) @ DPR, notch | Z | View (px) | Tiles | Canvas offset (device px) | Pixels |
|---|---|---|---|---|---|
| 568 x 320 @2 | 4 | 284 x 160 | 17.8 x 10.0 | 0, 0 | Uniform, aligned |
| 667 x 375 @2 | 4 | 333 x 187 | 20.8 x 11.7 | 1, 1 | Uniform, aligned |
| 667 x 325 @2 | 4 | 333 x 162 | 20.8 x 10.1 | 1, 1 | Uniform, aligned |
| 800 x 360 @3 | 6 | 400 x 180 | 25.0 x 11.3 | 0, 0 | Uniform, aligned |
| 844 x 390 @3, notch 47 + 47 | 7 | 321 x 167 | 20.1 x 10.4 | 142, 0 | Uniform, aligned |
| 844 x 390 @3 | 7 | 361 x 167 | 22.6 x 10.4 | 2, 0 | Uniform, aligned |
| 915 x 412 @2.625 | 6 | 400 x 180 | 25.0 x 11.3 | 0, 0 | Uniform, aligned |
| 915 x 412 @2.625, notch 30 + 0 | 6 | 387 x 180 | 24.2 x 11.3 | 79, 0 | Uniform, aligned |
| 932 x 430 @3, notch 59 + 59 | 8 | 305 x 161 | 19.1 x 10.1 | 178, 1 | Uniform, aligned |
| 1080 x 810 @2 | 7 | 308 x 224 | 19.3 x 14.0 (row cap) | 2, 26 | Uniform, aligned |
| 1280 x 720 @1 | 4 | 320 x 180 | 20.0 x 11.3 | 0, 0 | Uniform, aligned |
| 1920 x 1080 @1 | 6 | 320 x 180 | 20.0 x 11.3 | 0, 0 | Uniform, aligned |
| 3440 x 1300 @1 | 8 | 430 x 162 | 26.9 x 10.1 | 0, 2 | Uniform, aligned |
| 3000 x 800 @1 | 5 | 480 x 160 | 30.0 x 10.0 (column cap) | 300, 0 | Not analysed |
| 740 x 360 @2.75 | 6 | 339 x 165 | 21.2 x 10.3 | 0, 0 | Uniform, aligned |
| 851 x 393 @3.5, notch 44 + 0 | 8 | 353 x 171 | 22.1 x 10.7 | 154, 3 | Uniform, aligned |
| 1366 x 768 @1.25 | 6 | 284 x 160 | 17.8 x 10.0 | 1, 0 | Uniform, aligned |
| 1536 x 864 @1.5 | 8 | 288 x 162 | 18.0 x 10.1 | 0, 0 | Uniform, aligned |
| 320 x 568 @2 (portrait window) | 2 | 320 x 224 | 20.0 x 14.0 | 0, 344 | Uniform, aligned |
| 740 x 304 @2.75 (a browser tab with a toolbar) | 5 | 407 x 167 | 25.4 x 10.4 | 0, 0 | Computed with `chooseView`, not run |
| 740 x 280 @2.75 (toolbar and status bar) | 4 | 480 x 192 | 30.0 x 12.0 (column cap) | 57, 1 | Computed, not run |
| 568 x 232 @2 (small phone, toolbar) | 2 | 480 x 224 | 30.0 x 14.0 (both caps) | 88, 8 | Computed, not run |

The last three rows are the price of a whole-number zoom when a browser's toolbars take height: one art pixel is 2.18 CSS px in the 740 x 360 window but 1.82, 1.45 and (in the 568 x 232 window) 1.0 CSS px in these. ARCHITECTURE 11.5 says what the shell does about it: fullscreen on the first tap, menu rows and switches sized in CSS px. All three rows belong in the `chooseView` test's device table.

- All eleven rows of the feel design's device table come out with the same zoom and tile counts (unit check), and a sweep of 50,000 window sizes, ratios and notches always gave a whole zoom, the largest one that keeps 17 x 10 tiles, at most 30 x 14 tiles, whole-device-pixel offsets, and a canvas inside the safe area [C].
- Pointer mapping needs no code: with the canvas pillarboxed at 844 x 390 @3, a click at CSS (300, 200) arrived as game pixel (108.29, 85.71), exactly `(css - cssOffset) * dpr / Z`. Still exact after a live resize, a portrait round trip, a pixel-ratio change and a position-only change (the `refresh()` branch) [C].
- `resize()` reached the canvas, the renderer, the Play camera and the Hud camera in the same call; a `Scale.Events.RESIZE` listener re-anchors HUD items [R][C].
- `readSafeInsets` returned the real `env()` values (47, 47, 0, 21 px, set through Chrome's DevTools protocol), the view became 321 x 167 at Z 7 with the canvas 47.33 CSS px in, and the touch buttons moved in by the same insets [C].
- A pixel-ratio change with the window size unchanged fired no `resize` event and no media-query `change` event in headless Chromium; the per-frame comparison caught it [C].
- For comparison, the built-in modes on the same test [R]: `Scale.FIT` uneven on all 5 viewports; `Scale.RESIZE` with camera zoom uneven at DPR 2.625; `MAX_ZOOM` ignores the pixel ratio. Sizing the canvas with CSS `width` / `height` (which is what `scale.zoom` does) squeezed one column or row in 23 of 72 cases. A 507 x 234 canvas ran at 60 fps where a 2535 x 1170 canvas with camera zoom 5 ran at 35 fps (software GL, relative only).

**Traps**

- `ScaleManager.resize()` writes `canvas.style.width/height` only when its zoom is not 1. Keep `scale.zoom` at 1 [R].
- `ResizeObserver`'s `devicePixelContentBoxSize` returned CSS pixels under Playwright's emulation, which collapses the zoom to 1. Use `innerWidth * devicePixelRatio` [R].
- Setting `canvas.width` clears a WebGL canvas, so `applyLayout` resizes only when the size really changed.
- In portrait the layout still runs (letterboxed top and bottom). On a touch device the rotate message covers it (section 17); in a desktop window the game simply plays letterboxed [C].
- The view size changes while the game runs (rotation, browser bars, fullscreen). **Every scene that places anything from `this.scale.width/height` must re-place it on `Phaser.Scale.Events.RESIZE`** (section 11).

## 7. The camera rule

`stepCamera` and `snapCamera` are pure functions in `src/shell/camera.ts` with their numbers in `TUNING.camera` (ruling R12, ARCHITECTURE 11.4). This section is only about how their result reaches Phaser.

1. **Never** call `startFollow`, `setLerp`, `setDeadzone`, `setFollowOffset`, `setBounds` or `setZoom` on a gameplay camera. Camera zoom stays 1 in every scene.
2. Once per rendered frame call `this.cameras.main.setScroll(x, y)` with **integers**.
3. Feed the camera the hero's **drawn** position, in whole art pixels (`x >> 8` of the core's sub-pixels), not the sub-pixel position. Then, while the camera is locked to the hero, sprite and scroll move by the same whole number and the hero cannot shimmer against the background.
4. Round the camera's own state once per tick (`Math.round`), keep that integer, and when interpolation is on, blend the two integers with `lerpPx` (section 12) exactly as the sprites are blended.
5. Centre a level that is smaller than the view yourself (negative scroll is fine). Phaser's bounds would pin it to the top [R].
6. Parallax and anything else fixed to the screen: `setScrollFactor(0)` and set the position by hand to a rounded value [C].
7. On a touch screen the scroll may pass a level's side wall, also negative, by as much as it takes to draw the hero clear of the DOM pad's buttons (`PadReach`, ARCHITECTURE 11.4). The backdrop wraps its stars and ridge (`starShift`, `farShift`), so the space beyond the wall is drawn like any other [C, review: at 844 x 390 the hero who starts beside level 1's left wall was drawn inside RIGHT].

**[C]** From the check's `PlayScene`. `stepCamera` here is the render spike's sample (a stand-in for the real one), and `Math.floor(this.sim.x)` stands in for `player.x >> 8`:

```ts
private captureDraw(): void {
  // Whole art pixels: the same integers go to the sprite and to the camera, so they cannot shimmer apart.
  const heroX = Math.floor(this.sim.x);
  const heroY = Math.floor(this.sim.y);
  const view = this.cameras.main;
  this.cam = stepCamera(this.cam, heroX + 8, heroY + 8, this.sim.facing, view.width, view.height,
    LEVEL_COLS * TILE, LEVEL_ROWS * TILE, 24, 32, 32, 1000);
  this.curDraw = { heroX, heroY, camX: Math.round(this.cam.x), camY: Math.round(this.cam.y) };
}
```

```ts
// --- draw: state -> whole pixels (interpolated only on fast displays)
const alpha = interpolate ? this.stepper.alpha : 1;
const heroX = lerpPx(this.prevDraw.heroX, this.curDraw.heroX, alpha);
const heroY = lerpPx(this.prevDraw.heroY, this.curDraw.heroY, alpha);
const camX = lerpPx(this.prevDraw.camX, this.curDraw.camX, alpha);
const camY = lerpPx(this.prevDraw.camY, this.curDraw.camY, alpha);
this.cameras.main.setScroll(camX, camY); // integers, always
this.backdrop?.setPosition(60 - Math.round(camX * 0.2), 40);
```

Observed:

- With the hero running at 1.5 px per tick and the camera locked to it, the hero's screen x never changed: 0 px of shimmer at 60 Hz and at about 500 Hz, with whole-number scroll throughout [C].
- A backdrop image with scroll factor 0, moved by `Math.round(scroll * 0.2)`, stayed on the pixel grid while scrolling [C].
- Why not `startFollow` [R]: it overwrites `cam.roundPixels` with `false` unless told otherwise; lerp and dead zones produce fractional scroll; fractional scroll garbles BitmapText (section 9) and makes a hero at x = 100.5 hop between two distances from the tile grid.
- v4 does not round the camera scroll. It rounds each quad's corners, and only when camera and object together are a pure translation, so `roundPixels` does nothing at all under camera zoom [R]. Another reason zoom stays 1.
- Camera zoom is about the view centre, not the top-left [R]. Not an issue at zoom 1.

## 8. Sprites by entity id

One `Phaser.GameObjects.Image` per entity, kept in a `Map` keyed by the id from ARCHITECTURE 11.2 (`'hero'`, `'enemy:3'`, `'pickup:7'`, `'bolt'`, ...). The frame name comes from a pure function of the state (`src/shell/frames.ts`); nothing uses Phaser's animation manager.

**[C]** (from [R]; two test-counter lines removed) The sync at the end of `update`:

```ts
const seen = new Set<string>();
const draw = (id: string, frame: string, x: number, y: number, flip: boolean): void => {
  seen.add(id);
  let v = this.views.get(id);
  if (!v) {
    v = this.add.image(0, 0, 'ents', frame).setOrigin(0, 0).setDepth(id === 'hero' ? 10 : 8);
    this.views.set(id, v);
  }
  v.setPosition(x, y).setFrame(frame).setFlipX(flip);
};
draw('hero', 'hero', heroX, heroY, this.sim.facing < 0);
if (this.sim.enemyAlive) draw('enemy:0', 'enemy', Math.floor(this.sim.enemyX), FLOOR_Y - TILE, false);
for (const [id, v] of this.views) {
  if (!seen.has(id)) {
    v.destroy();
    this.views.delete(id);
  }
}
```

- `setFrame(name)` every frame is cheap, and `Image` is not on the scene's update list, so idle sprites cost nothing [R].
- Origin (0, 0) everywhere; `setFlipX(true)` mirrors inside the same 16 px box [R].
- Depth bands [R]: backdrop -10, tiles 0, pickups 5, enemies 8, hero 10, effects 50. Equal depth draws in creation order.
- Creating on first sight and destroying when gone is fine at this scale (2000 create and destroy pairs took 9.7 ms) [R]. Hiding with `setVisible(false)` instead, as ARCHITECTURE 11.2 describes for dead enemies and taken pickups, is equally fine.
- Clear the map when the level changes: the old scene's objects are destroyed with it [C] (`this.views.clear()` in `init()`).
- Positions must be whole numbers. At zoom 1 Phaser rounds each object by itself, which is what causes shimmer when the object and the camera are rounded differently [R].

## 9. Bitmap text

One font, built at boot from a glyph sheet (white on transparent) and registered through `RetroFont.Parse`; the helper `addPixelFont` is in section 4.

The font (`docs/ART-AND-SOUND.md`, section 7) is a 5 x 7 glyph in a 6 x 8 cell, advance 6, line height 9. In RetroFont terms: **cell 6 x 8, `lineSpacing: 1`**, which is the call `addPixelFont(this, 'pix', 'font', chars, 6, 8, charsPerRow, 1)` in section 4. The font's nominal size is the cell *width*, so draw at size 6 (1x), 12 (2x) or 18 (3x), never anything else.

**[C]** Title text, centred the only safe way (the check wrote the five-letter word as a literal; the sample now takes it from `GAME_TITLE`, imported from `../../meta`):

```ts
// The game's name is spelled only in src/meta.ts: the first word of GAME_TITLE at 3x (the rest goes below at 1x).
const [firstWord = ''] = GAME_TITLE.toUpperCase().split(' ');
this.title = this.add.bitmapText(0, 0, 'pix', firstWord, FONT_W * 3).setTint(0xffd65c);
this.prompt = this.add.bitmapText(0, 0, 'pix', 'TAP TO START', FONT_W).setDropShadow(1, 1, 0x0b0d1a, 1);
```

```ts
/** BitmapText must sit on whole pixels: origin 0 and a rounded position, never setOrigin(0.5). */
private readonly layout = (): void => {
  const { width, height } = this.scale;
  this.title?.setPosition(Math.round((width - this.title.width) / 2), Math.round(height / 2) - 30);
  this.prompt?.setPosition(Math.round((width - this.prompt.width) / 2), Math.round(height / 2) + 10);
};
```

**[C]** HUD text and the fuel pips, anchored to whatever the view width is:

```ts
create(): void {
  this.add.bitmapText(4, 3, 'pix', 'LEVEL 1', FONT_W).setDropShadow(1, 1, 0x0b0d1a, 1);
  this.score = this.add.bitmapText(0, 3, 'pix', '00000', FONT_W).setTint(0xffd65c);
  this.fuelLabel = this.add.bitmapText(0, 3, 'pix', 'FUEL', FONT_W);
  this.pips = Array.from({ length: 10 }, () => this.add.rectangle(0, 0, 2, 5, 0xb4f04a).setOrigin(0, 0));
  this.layout();
  this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
  onSceneEnd(this.events, () => {
    // src/shell/sceneEnd.ts: once, on 'shutdown' or 'destroy', and the other listener goes too (section 11)
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
  });
}

/** Pushed by PlayScene after its ticks (the HUD updates BEFORE Play in Phaser's order, so it must not poll). */
show(model: HudModel): void {
  this.score?.setText(String(model.score).padStart(5, '0'));
  this.pips.forEach((pip, i) => pip.setVisible(model.hasThruster && i < model.fuelPips));
}

private readonly layout = (): void => {
  const w = this.scale.width;
  if (this.score) this.score.setPosition(Math.round((w - this.score.width) / 2), 3);
  this.fuelLabel?.setPosition(w - 70, 3);
  this.pips.forEach((pip, i) => pip.setPosition(w - 44 + i * 3, 4));
};
```

Observed:

- A five-letter word at size 18 measured 90 px wide and 27 px tall (5 x 18 and 9 x 3). On the title screen there were exactly three colours on screen (backdrop, gold, white) at DPR 3, 2.625 and 2, and the 3x glyph pixels were uniform blocks of 3 x Z device pixels. The HUD row held only backdrop, white and gold [C].
- `setTint`, `setDropShadow(1, 1, colour, 1)`, `setOrigin(1, 0)` and `\n` work; `setText` is cheap (1000 calls in 11 ms) [R].
- `this.add.text` with a system font at 8 px had 158 colours (soft after scaling) and `resolution: 4` did not rescue it [R]. Do not use `Text` anywhere.

**Traps**

- **BitmapText gets no vertex rounding in any mode.** At a final screen position ending in .5 the glyphs are garbled [R]. So: origin 0, positions through `Math.round`, integer camera scroll. Never `setOrigin(0.5)` on bitmap text; centre with `Math.round((width - text.width) / 2)`.
- `scene.cache.bitmapFont.add(key, { data: RetroFont.Parse(...) })`, as the shipped skill file shows, throws. Pass `Parse()`'s result itself [R][C].
- `RetroFontConfig` is typed with literal keys such as `'offset.x'`; the cast in `addPixelFont` is required in strict TypeScript [R][C].
- Under the Canvas renderer (the `AUTO` fallback) tint is ignored: gold text comes out white [C].
- A proportional font is possible by building the cache entry by hand (same shape as `Parse()` returns, with per-glyph `xAdvance`; `v0 = 1 - y / texH`, `v1 = 1 - (y + h) / texH`) [R]. Not needed: the design's font is fixed-width.

## 10. Effects

**[C]** (from [R], colour handling changed) One emitter per scene, created once and reused for every burst, in any colour:

```ts
// --- one reusable burst emitter. No `tint` here: the colour is set per burst with setParticleTint.
this.burst = this.add
  .particles(0, 0, 'ents', {
    frame: 'spark2', lifespan: { min: 250, max: 450 }, speed: { min: 30, max: 90 }, gravityY: 200, emitting: false,
  })
  .setDepth(50);
```

**[C]** (from [R]) The whole effects vocabulary (`effects` is a test hook in the check; `hero` is the hero's `Image`):

```ts
const hero = this.views.get('hero');
if (kind === 'fill') hero?.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL); // solid white flash
if (kind === 'tint') hero?.clearTint().setTint(0xd8442a); // multiply tint
if (kind === 'clear') hero?.clearTint(); // back to normal (also resets the tint mode)
if (kind === 'shake') this.cameras.main.shake(150, 0.005); // intensity is a fraction of the view size
if (kind === 'flash') this.cameras.main.flash(120, 255, 214, 92); // world only; flash the Hud camera for the whole screen
if (kind === 'burst') this.burst?.setParticleTint(0xffd65c).explode(12, this.curDraw.heroX + 8, this.curDraw.heroY);
if (kind === 'limeBurst') this.burst?.setParticleTint(0xb4f04a).explode(6, this.curDraw.heroX + 8, this.curDraw.heroY); // same emitter, another colour
```

**[R]** A bar from two rectangles (the HUD's pips in section 9 are the same idea):

```ts
this.add.rectangle(x - 1, y - 1, W + 2, H + 2, 0x101018).setOrigin(0, 0);       // bar frame
const fill = this.add.rectangle(x, y, W, H, 0x40d0e0).setOrigin(0, 0);
const w = Math.round(W * fuel);
fill.setSize(w, H).setVisible(w > 0);
fill.setFillStyle(fuel < 0.25 ? 0xd04040 : 0x40d0e0);
```

Observed:

- `explode(12, x, y)` gave 12 live particles, drawn as crisp 2 x 2 squares, and none after 700 ms; the same emitter exploded again [R][C].
- `setParticleTint(gold)` then `explode(12)` gave 12 gold particles; `setParticleTint(lime)` then `explode(6)` on the same emitter gave 6 lime ones while earlier particles kept their colour [C].
- A hero body pixel read `#f1e2c3` normally, `#ffffff` under the FILL flash, a darker red under the multiply tint, and `#f1e2c3` again after `clearTint()` [C].
- `flash` on the Hud scene's camera whitened world and HUD; on the Play camera it left the HUD alone [R]. `shake(300, 0.01)` on a 320 px view moved by whole pixels, 3 px at most [R].

**Traps**

- There is no particle manager: `this.add.particles(x, y, textureKey, config)` returns the emitter. `emitting: false` is required for burst-only use [R].
- Do **not** put a `tint` array in the emitter's config if the colour must change later: `setParticleTint(colour)` was then ignored and the particles kept the array's colours. And do not pass an array to `setParticleTint`: the particles got the array itself as their tint. A multi-colour burst is several `setParticleTint(c).explode(n)` calls. (`emitter.updateConfig({ tint })` also changed the colour.) [C]
- `setTintFill()` still exists but only logs a console error [R]; its typing takes no argument, so `setTintFill(0xffffff)` does not compile [C].
- After `setTintMode(FILL)`, a later `setTint(colour)` keeps FILL. Call `clearTint()` first [R][C].
- Shake's default intensity (0.05) is 25 px on a 507 px view; use about 0.005 [R]. Shake and particles use `Math.random`; keep both out of anything the core depends on.
- The content design caps live particles at 48 and switches moving and flashing effects off under `prefers-reduced-motion`. UNVERIFIED here.

## 11. Scene structure

| Scene | Started by | Does | Phaser pointer input |
|---|---|---|---|
| `Boot` | First in the config array | Builds textures and the font, then `this.scene.start('Title')` | None |
| `Title` | Boot, End, Play (quit) | Title screen; first tap or key starts the game and unlocks audio | Yes |
| `Play` | Title, End: `this.scene.start('Play', data)` | Owns the `GameState`, stepper, world view, camera, keyboard and lifecycle listeners. Launches Hud | None (touch is the DOM pad) |
| `Hud` | `this.scene.launch('Hud')` in `Play.create()` | Top bar, toasts, banners. Fed by pushes from Play | None |
| `Pause` | `this.scene.launch('Pause')` in `Play.pauseGame()` | Dim layer and menu | Yes |
| `End` | Play, on game over or win | Final screens | Yes |

Config array order: `[Boot, Title, Play, Hud, Pause, End]`. That order is the draw order and it never changes: `start` and `launch` do not reorder [I].

**[I]** The scene calls and what each one triggers:

```ts
this.scene.start('Play', { level: 3 });   // caller gets 'shutdown'; target runs init(data) then create(data)
this.scene.launch('Hud', { lives: 3 });   // parallel scene
this.scene.pause();                       // no update, still rendered; 'pause' event
this.scene.resume('Play', { x: 1 });      // 'resume' listener receives (sys, { x: 1 })
this.scene.stop('Hud');                   // 'shutdown'
this.scene.restart({ level: 4 });         // 'shutdown' -> 'start' -> 'ready' -> init -> create
```

Rules, all observed:

- Every `this.scene.*` call is queued and applied at the start of the **next** frame; the old scene's `shutdown` and the new scene's `init` and `create` run in that frame [I]. So for one frame after `launch('Hud')` the Hud exists but has not run `create()`: guard pushes with `this.scene.isActive('Hud')` [C].
- Two `scene.start('Play')` calls in one frame both run (create, shutdown, create) [I]. Guard every transition with a flag, or a door touched on two ticks starts the next level twice.
- Data passed to `start` or `launch` arrives in both `init(data)` and `create(data)`. Reset per-run state in `init()`: the scene object is reused [I].
- Scenes **update in reverse** array order and draw in array order: `Hud.update` runs before `Play.update` [I]. A HUD that reads the simulation in its own `update` shows the previous frame; Play pushes instead.
- Listeners on `this.input`, `this.input.keyboard`, Key objects, timers, tweens and the display list are removed for you on shutdown. Listeners on `this.events`, `this.game.events`, `this.scale`, `this.registry.events`, `window` and `document` are **not**: after three restarts there were four of each [I].
- `game.destroy(true)` emits `destroy` on running scenes, **not** `shutdown` [I], and `destroy` is emitted nowhere else. Register cleanup for both, through `onSceneEnd` (src/shell/sceneEnd.ts), which removes the twin listener: two plain `once` calls leave the `destroy` one behind on every visit [C, review]. But `this.scene.stop(...)` inside a `destroy` handler throws (`Cannot read properties of null (reading 'queueOp')`) and aborts the teardown [C]: scene operations go in the `shutdown` handler only.
- A scene that places things from the view size must re-place them on `Scale.Events.RESIZE`. The Pause scene is the proof: it opens during a rotation, its `create()` ran with the old view size, and its RESUME button sat in the wrong place until it listened for resizes [C].
- Pass handlers as arrow-function properties (`private readonly layout = (): void => { ... }`): they can be added and removed by reference, and the project's lint rules reject bare method references (section 19).

**[C]** Title: start once, on release:

```ts
let started = false;
const start = (): void => {
  if (started) return; // a transition must be asked for once
  started = true;
  this.scene.start('Play', { level: 1 });
};
this.input.once('pointerup', start); // 'up', not 'down': a touch unlocks audio and fullscreen on release
this.input.keyboard?.once('keydown', start);
```

The key that started the game did not also make the hero jump: Play's Key objects are created afterwards [C].

Fullscreen (ARCHITECTURE 11.5) is asked for in that same `pointerup` handler, before `scene.start`. The call itself was run from `pointerup` by the input spike [I] (section 15); the three conditions around it are new and UNVERIFIED:

```ts
// Touch devices only, never inside a frame (a preview pane), and only where the browser offers it (not on iPhones).
if (app.classList.contains('touch') && window.self === window.top && this.scale.fullscreen.available && !this.scale.isFullscreen) {
  this.scale.startFullscreen(); // a refusal is ignored; fullscreenTarget is #app, so the pad comes along
}
```

**[C]** Play: lifecycle listeners and the two cleanup paths (in `create()`):

```ts
app.classList.add('playing');
this.scene.launch('Hud');

// --- lifecycle: Phaser keeps updating while blurred, so pause explicitly
const autoPause = (): void => {
  this.pauseGame();
};
this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
this.game.events.on(Phaser.Core.Events.HIDDEN, autoPause);
window.addEventListener('pagehide', autoPause);
onSceneEnd(this.events, (how) => {
  this.game.events.off(Phaser.Core.Events.BLUR, autoPause); // game.events listeners are NOT removed for you
  this.game.events.off(Phaser.Core.Events.HIDDEN, autoPause);
  window.removeEventListener('pagehide', autoPause);
  app.classList.remove('playing');
  pad.releaseAll();
  controls.releaseAll();
  if (how === 'shutdown') {
    this.scene.stop('Hud'); // scene operations belong here only: inside 'destroy' (game.destroy()) they throw
    this.scene.stop('Pause');
  }
});
```

`onSceneEnd` (src/shell/sceneEnd.ts) registers `once` on both `SHUTDOWN` and `DESTROY` and, whichever fires, takes the other listener off. Do **not** write the two `once` calls side by side: `destroy` comes only from `game.destroy()`, so the `once(DESTROY, cleanup)` of every visit stayed on the scene's own `sys.events`, holding its closure (for a menu: its objects and callbacks). After 20 rounds of title, play, pause, quit, restart and game over the scenes' listener totals had grown from 55 to 131 (Title), 26 to 64 (Play), and the heap after a forced GC rose by about 0.06 MB per round; with the twin removed, the counts and the heap stayed flat [C, review].

**[C]** Play: pause, resume, leave. `mode` is `'running' | 'paused'` here; the real scene has more modes (ARCHITECTURE 11.1) and `resumeGame` must also call `holdReady(game)`:

```ts
/** Opens the pause overlay. Safe to call from anywhere, any number of times. */
pauseGame(): void {
  if (this.mode !== 'running' || this.leaving) return;
  this.mode = 'paused';
  this.stepper.reset();
  pad.releaseAll();
  controls.releaseAll();
  this.input.keyboard?.resetKeys();
  app.classList.remove('playing'); // hides the touch pad so the menu underneath gets the taps
  this.scene.launch('Pause');
}

/** Called by PauseScene. The real game also calls holdReady(game) here so the world waits for a control. */
resumeGame(): void {
  if (this.mode !== 'paused') return;
  this.mode = 'running';
  this.stepper.reset();
  this.gate.reset();
  controls.releaseAll();
  this.input.keyboard?.resetKeys();
  app.classList.add('playing');
}
```

```ts
quitToTitle(): void {
  if (this.leaving) return;
  this.leaving = true;
  this.scene.start('Title');
}
```

**[C]** Play: push to the HUD and the pad at the end of `update` (`pad.setItems(fire shown, thrust shown, fire dimmed, thrust dimmed)`):

```ts
pad.setItems(this.sim.hasBlaster, this.sim.hasThruster, false, this.sim.fuel === 0);
const hud = this.scene.get('Hud');
if (hud instanceof HudScene && this.scene.isActive('Hud')) {
  hud.show({ score: this.sim.tick, fuelPips: Math.ceil(this.sim.fuel / 8), hasThruster: this.sim.hasThruster });
}
```

**[C]** The Pause scene, complete (one button; the real one has Resume, Restart level, Quit, Sound, Vibration built the same way):

```ts
export class PauseScene extends Phaser.Scene {
  private dim: Phaser.GameObjects.Rectangle | undefined;
  private title: Phaser.GameObjects.BitmapText | undefined;
  private button: Phaser.GameObjects.Rectangle | undefined;
  private label: Phaser.GameObjects.BitmapText | undefined;

  constructor() {
    super('Pause');
  }

  create(): void {
    this.dim = this.add.rectangle(0, 0, 1, 1, 0x0b0d1a, 0.6).setOrigin(0, 0);
    this.title = this.add.bitmapText(0, 0, 'pix', 'PAUSED', FONT_W * 2);
    // A menu button: a rectangle with a label on top.
    this.button = this.add.rectangle(0, 0, 72, 22, 0x151a36).setOrigin(0, 0).setInteractive();
    this.label = this.add.bitmapText(0, 0, 'pix', 'RESUME', FONT_W);

    // This scene usually opens while the window is changing (rotation, blur), so it MUST follow resizes.
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout);
    onSceneEnd(this.events, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout);
    });

    const play = this.scene.get('Play');
    let closing = false;
    const resume = (): void => {
      if (closing || !(play instanceof PlayScene)) return;
      closing = true;
      play.resumeGame();
      this.scene.stop();
    };

    // Act on release, and only if the press began on the button: a scene can receive a
    // pointerup whose pointerdown it never saw.
    let armed = false;
    this.button.on('pointerdown', () => {
      armed = true;
    });
    this.button.on('pointerout', () => {
      armed = false;
    });
    this.button.on('pointerup', () => {
      if (armed) resume();
    });

    const kb = this.input.keyboard;
    const K = Phaser.Input.Keyboard.KeyCodes;
    for (const code of [K.ESC, K.P, K.ENTER]) kb?.addKey(code).on('down', resume);
  }

  private readonly layout = (): void => {
    const { width, height } = this.scale;
    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);
    this.dim?.setSize(width, height);
    this.title?.setPosition(cx - Math.round(this.title.width / 2), cy - 40);
    this.button?.setPosition(cx - 36, cy - 11);
    this.label?.setPosition(cx - Math.round(this.label.width / 2), cy - 3);
  };
}
```

Observed [C]: after three round trips Play, Title, Play the listener counts on `game.events` (`blur`, `hidden`), on the Scale Manager (`resize`) and on the input manager were the same as on the first visit, and the running scenes were exactly Play and Hud. Count each scene's own `sys.events` too (`__E2E__.listeners()`): that is where the `destroy` twins piled up unseen. e2e/pause.spec.ts checks that four rounds of title, play, pause, restart to game over and the end screen leave every scene's count where the first round left it.

Not exercised by anyone: `scene.sleep`, `wake`, `switch`, `run`, `transition`. `scene.restart` was run only on the input spike's small shell [I], not with Play, Hud and Pause stacked. ARCHITECTURE 11.2 changes level inside the running Play scene (sprites rebuilt on `levelStarted`), which needs no scene restart at all.

## 12. Fixed step, and render interpolation in 'auto' mode

Phaser 4 has no fixed step for scene updates. The shell keeps its own accumulator, fed with the `delta` argument of `update` (Phaser's smoothed value), and runs whole 60 Hz ticks of the core.

**[C]** (from [I], plus the `alpha` getter) `src/shell/FixedStepper.ts`, complete:

```ts
/** Fixed-timestep accumulator. Pure: no Phaser, no DOM. */
export class FixedStepper {
  private acc = 0;

  constructor(
    private readonly stepMs: number,
    private readonly maxStepsPerFrame: number,
    private readonly snapMs = 0.5,
  ) {}

  /** Feed one frame's delta (ms); returns how many fixed steps to run now (0..maxStepsPerFrame). */
  advance(deltaMs: number): number {
    if (!(deltaMs > 0)) return 0; // also rejects NaN
    // Frame-lock on ~60 Hz displays: a delta within snapMs of one step counts as exactly one step,
    // so timing noise cannot produce 0-step / 2-step frame pairs.
    this.acc += Math.abs(deltaMs - this.stepMs) < this.snapMs ? this.stepMs : deltaMs;
    let n = Math.floor(this.acc / this.stepMs + 1e-9);
    if (n > this.maxStepsPerFrame) {
      n = this.maxStepsPerFrame;
      this.acc = 0; // drop the backlog: slow down instead of spiralling
    } else {
      this.acc = Math.max(0, this.acc - n * this.stepMs);
    }
    return n;
  }

  /** How far the display is between the last tick (0) and the next one (1). Used only by render interpolation. */
  get alpha(): number {
    return Math.min(1, this.acc / this.stepMs);
  }

  /** Call after any pause / resume / scene start so stale time is not replayed. */
  reset(): void {
    this.acc = 0;
  }
}
```

Construct it as `new FixedStepper(1000 / TICK_HZ, TUNING.pacing.maxStepsPerFrame)`. `snapMs` stays at its default.

What the numbers do [I]:

| Situation | Result |
|---|---|
| First frames after boot | `delta` 15.0 for 10 frames, then 16.6 to 16.7. No zero, no spike |
| Steady 60 Hz, 292 frames | Smoothed `delta`: exactly one step every frame. Raw delta: 7 frames with 0 steps and 7 with 2 |
| 30 s of deltas replayed from 200 start phases | Frames with a step count other than 1: worst 16 without the snap, worst 1 with `snapMs = 0.5` |
| One 600 ms stall | `delta` stayed 16.7: Phaser discards raw gaps above 200 ms |
| 60 ms frames (about 17 fps) | `delta` climbed to about 62 within 10 frames; 125 steps where 129.5 were ideal. Speed stays right down to 12 fps; below that the 5-step clamp slows the game instead of letting it spiral |
| `fps.limit` 60 / 30 / 120 | `delta` over-reported by x1.75 / x1.41 / x1.32: the game ran that much too fast |
| Window covered by another (rAF at 1 Hz, page still "visible") | `delta` stayed 16.6: one step per second. Acceptable; a real hide pauses (section 16) |

And in the check [C]: 60.2 ticks per second at 60 Hz with no 0-step or 2-step frames; 59.9 ticks per second with the frame-rate limit lifted (about 540 rendered frames per second); after 1.5 s in the pause menu the simulation advanced by a few frames only, because `reset()` drops stale time; 30, 60, 90, 120 and 144 Hz all give 600 ticks in 10 s (unit check).

**Interpolation (ruling R13).** Build it last. Mode 'auto' means: on only while the display's frame interval is under `TUNING.pacing.interpolateBelowMs` (14 ms), which is true for 90 and 120 Hz screens and false at 60 Hz. At 60 Hz the snap above already gives one tick per frame, so drawing the current state is exact and has no added delay.

**[C]** `src/shell/interpolation.ts`, complete (pure):

```ts
/**
 * Render interpolation, 'auto' mode (ruling R13). Pure: no Phaser, no DOM.
 * On only while the display's frame interval, measured as the median of the last frames, is under
 * `belowMs` (TUNING.pacing.interpolateBelowMs = 14: on for 90 and 120 Hz screens, off for 60 Hz).
 */
export class InterpolationGate {
  private readonly recent: number[] = [];
  private on = false;

  constructor(
    private readonly belowMs: number,
    private readonly windowFrames = 31,
  ) {}

  /** Feed the raw frame interval (ms) of every rendered frame. Returns whether interpolation is on. */
  sample(frameMs: number): boolean {
    if (!(frameMs > 0)) return this.on;
    this.recent.push(frameMs);
    if (this.recent.length > this.windowFrames) this.recent.shift();
    if (this.recent.length === this.windowFrames) {
      const sorted = [...this.recent].sort((a, b) => a - b);
      const median = sorted[(this.windowFrames - 1) >> 1] ?? frameMs;
      this.on = median < this.belowMs;
    }
    return this.on;
  }

  get isOn(): boolean {
    return this.on;
  }

  /** Call when the loop restarts (pause, resume, scene start): measure again before trusting the old answer. */
  reset(): void {
    this.recent.length = 0;
    this.on = false;
  }
}

/**
 * Whole-pixel position to draw at, between the previous tick's drawn pixel and the current one.
 * Both arguments are whole art pixels. A jump of more than `snapPx` (a teleport: respawn, level start)
 * is not interpolated.
 */
export function lerpPx(prevPx: number, curPx: number, alpha: number, snapPx = 16): number {
  const d = curPx - prevPx;
  if (d > snapPx || d < -snapPx) return curPx;
  return prevPx + Math.round(d * alpha);
}
```

**[C]** The loop in `PlayScene.update` (test counters and the door test removed; `step`, `sim` and the sound call are the check's stand-ins for the core, the `GameState` and the `EventRouter`; ARCHITECTURE 11.1 has the real shape):

```ts
override update(_time: number, delta: number): void {
  if (this.mode !== 'running') return;
  for (const b of BUTTONS) controls.set('keys', b, this.keys[b].some((k) => k.isDown));

  const interpolate = this.gate.sample(this.game.loop.rawDelta);
  const n = this.stepper.advance(delta); // Phaser's smoothed delta
  for (let i = 0; i < n; i++) {
    this.prevDraw = this.curDraw;
    this.simEvents.length = 0;
    step(this.sim, controls.consume(), this.simEvents); // exactly one input sample per tick
    this.captureDraw();
    for (const e of this.simEvents) {
      if (e === 'jump') sfx.play({ freq: 196, freqEnd: 392, dur: 0.09, gain: 0.16 });
      if (e === 'land') this.burst?.setParticleTint(0xbfcbe0).explode(4, this.curDraw.heroX + 8, FLOOR_Y);
    }
  }
  // --- draw: state -> whole pixels (interpolated only on fast displays)
  const alpha = interpolate ? this.stepper.alpha : 1;
  const heroX = lerpPx(this.prevDraw.heroX, this.curDraw.heroX, alpha);
  const heroY = lerpPx(this.prevDraw.heroY, this.curDraw.heroY, alpha);
  const camX = lerpPx(this.prevDraw.camX, this.curDraw.camX, alpha);
  const camY = lerpPx(this.prevDraw.camY, this.curDraw.camY, alpha);
  this.cameras.main.setScroll(camX, camY); // integers, always
```

The method goes on with the backdrop, the sprite sync of section 8 and the pushes of section 11.

Rules:

- Sample the gate with `this.game.loop.rawDelta` (the unsmoothed frame interval), every frame. It decides on the median of the last 31 frames, so hitches do not flip it and a slow phone on a 60 Hz screen never switches it on (unit check).
- `prevDraw` and `curDraw` hold **whole-pixel draw positions** captured before and after each tick. `lerpPx` blends those, for sprites and camera alike. Blending sub-pixels and flooring, with the camera blended and rounded separately, made the hero wobble across three screen pixels at 144 Hz; `lerpPx` gave one constant pixel at 60, 90, 120 and 144 Hz (unit check) and at about 500 Hz in the browser [C].
- Teleports: `lerpPx` returns the new position at once when the jump is more than 16 px (respawn, level start). Also set `prevDraw = curDraw` on `levelStarted` and `respawned`.
- Things that were not drawn on the previous tick have no previous position: a bolt that became active this tick (`BoltState.x` and `y` are meaningless while inactive), an enemy that came back to life, a pickup that reappeared. Give each `prev = cur` on the tick it appears. The check had no such objects; this rule comes from the review of ARCHITECTURE 11.1 and is UNVERIFIED.
- `stepper.reset()` and `gate.reset()` on every pause, resume, scene start and level start.
- With interpolation on, the hero's drawn position never moved more than 1 px between two frames (1.5 px per tick, about 540 frames per second); with it off at 60 Hz it moves 1 or 2 px per frame, as expected [C].
- **UNVERIFIED:** real 90 and 120 Hz phone screens. The gate was run only at 60 Hz and with Chromium's frame limit lifted.

**Traps** [I]

- `fps.limit` is a frame skipper that reports a wrong `delta`. Never set it. `physics.arcade.fixedStep` is Arcade-only.
- The default 120-frame cool-down (`panicMax`) puts slow phones in slow motion after every start and every return to the page. `fps: { panicMax: 0 }`; leave `smoothStep` on.
- `delta` is also capped while the window is unfocused. The game is paused then anyway.

## 13. Keyboard

Keys (feel design): arrows or A / D move; Space, Up or W jump; X fires; Z or Shift thrusts; Esc or P pauses; M mutes (content design). Held state is polled once per frame; every press is also latched from the Key's `'down'` event so a tap shorter than a frame is not lost.

**[C]** (from [I]; one test-counter line removed) In `PlayScene.create()`:

```ts
// --- keyboard: poll isDown every frame, latch Key 'down' events
const kb = this.input.keyboard;
const K = Phaser.Input.Keyboard.KeyCodes;
const key = (code: number): Phaser.Input.Keyboard.Key[] => (kb ? [kb.addKey(code)] : []); // addKey also captures
this.keys = {
  left: [...key(K.LEFT), ...key(K.A)],
  right: [...key(K.RIGHT), ...key(K.D)],
  jump: [...key(K.SPACE), ...key(K.UP), ...key(K.W)],
  fire: [...key(K.X)],
  thrust: [...key(K.Z), ...key(K.SHIFT)],
};
for (const b of BUTTONS) {
  for (const k of this.keys[b]) {
    k.on('down', () => {
      if (this.mode === 'running') controls.latch(b);
    });
  }
}
for (const k of [...key(K.ESC), ...key(K.P)]) {
  k.on('down', () => {
    this.pauseGame();
  });
}
```

Mute (M) is wired the same way, with one more `addKey(...).on('down', ...)`. First thing in `update`, before stepping:

```ts
for (const b of BUTTONS) controls.set('keys', b, this.keys[b].some((k) => k.isDown));
```

Observed:

- Polling `isDown` works for arrows, Space, letters and Shift, three at once [I][C].
- `addKey` also captures the key: on a 3000 px page Space and ArrowDown did not scroll, and Space did not click a focused DOM button [I].
- 20 Space taps with press and release inside one frame: polled `isDown` saw 3, `Phaser.Input.Keyboard.JustDown` saw 3, a Key `'down'` listener saw all 20 [I]. With the latch, 3 instant taps gave 3 jumps [I][C].
- Left held, then Right added: the hero moved right; Right released: left again; the core never received both (`Controls`, section 14) [C].
- A Key's `'down'` event fires once per physical press. `keyboard.on('keydown-N', ...)` for a key that has no Key object fired 6 times for one held press (1 press + 5 auto-repeats); `addKey('M').on('down', ...)` fired once [C]. **Use `addKey(code).on('down', ...)` for every action key**, pause and mute included.
- Keyboard events reach scenes in the order the scenes were **started**, not top-most first: with Play, Hud and Pause running, Play's Esc handler ran before Pause's [C]. So Phaser's `event.stopPropagation()` in a menu scene does not shield the scenes under it. Guard by state instead: Play's handler does nothing unless `mode === 'running'`; the menu's handler resumes. With that, Esc paused, Esc resumed, and holding Esc through seven `keydown` events paused once and stayed paused [C].
- Phaser's own "release every key when the window loses focus" stops working for **all** scenes as soon as any scene that used the keyboard shuts down (`KeyboardPlugin.shutdown` removes that listener without its context, which removes everybody's). After the first pause menu closed, Play's and Hud's blur listeners were gone [C]. Never rely on it: `pauseGame()` calls `this.input.keyboard?.resetKeys()` itself.
- After `resetKeys()`, a key that is still physically held reads up until its next repeat `keydown` [I]. **That repeat is then taken for a new press**: `Key.onDown` finds the Key up, sets `isDown` and emits `'down'` (with `event.repeat === true`). The same happens for a key already held when a scene starts (its Key is new). Seen in the game [C, review]: RIGHT held through the pause menu opened the ready gate about 12 ticks after RESUME (also after RESTART LEVEL and after a blur), and a held Esc closed the menu it had just opened, then opened it again. src/input/keyboard.ts therefore ignores every `'down'` whose event is an auto-repeat, and reads such a key as up until its `keyup`; e2e/pause.spec.ts holds keys with repeats (`keyboard.down` again on a held key) through every way out of the menu.

**Traps** [I]

- Captures are global on `window`: with A, X and D captured, typing "a x d" into an `<input>` left it empty. The game has no text fields; keep it that way.
- Phaser assigns `window.onblur` and `window.onfocus`. If the page sets `window.onblur`, Phaser sees no blur at all. Use `addEventListener` only.
- `game.hasFocus` is `false` until the first focus event. Use `document.hasFocus()`.
- `this.input.keyboard` is typed `KeyboardPlugin | null`.

## 14. Touch controls: the DOM overlay

The pad is DOM, not Phaser: it sits above the canvas in `#pad`, is laid out in CSS pixels by a pure function, and is driven by Pointer Events. The page part (elements and CSS) is in section 2. Three pieces of TypeScript follow.

**[C]** (from [I]; `thrust` naming and the left/right rule added) `src/input/Controls.ts`, complete (pure):

```ts
import type { Input } from '../core/types';

/** Device-independent button state. Pure: no Phaser, no DOM. */
export const BUTTONS = ['left', 'right', 'jump', 'fire', 'thrust'] as const;
export type Button = (typeof BUTTONS)[number];
export type Source = 'keys' | 'touch';

const blank = (): Record<Button, boolean> => ({ left: false, right: false, jump: false, fire: false, thrust: false });

export class Controls {
  private readonly held: Record<Source, Record<Button, boolean>> = { keys: blank(), touch: blank() };
  private readonly latched = blank();
  private lastDirection: 'left' | 'right' = 'right';

  /** Level-triggered state from one input source. A rising edge is latched until the next tick. */
  set(source: Source, button: Button, down: boolean): void {
    if (down && !this.held[source][button]) this.latch(button);
    this.held[source][button] = down;
  }

  /** Record a press that may already be over (press + release between two frames). */
  latch(button: Button): void {
    this.latched[button] = true;
    if (button === 'left' || button === 'right') this.lastDirection = button;
  }

  /** Call exactly once per simulation tick. */
  consume(): Input {
    const out = blank();
    for (const b of BUTTONS) {
      out[b] = this.held.keys[b] || this.held.touch[b] || this.latched[b];
      this.latched[b] = false;
    }
    // The core wants at most one of left and right: the most recently pressed wins.
    if (out.left && out.right) {
      if (this.lastDirection === 'left') out.right = false;
      else out.left = false;
    }
    return out;
  }

  /** Non-destructive read, for UI highlights and for "is any control held". */
  isDown(button: Button): boolean {
    return this.held.keys[button] || this.held.touch[button];
  }

  releaseAll(source?: Source): void {
    for (const s of source ? [source] : (['keys', 'touch'] as const)) for (const b of BUTTONS) this.held[s][b] = false;
    for (const b of BUTTONS) this.latched[b] = false;
  }
}
```

**[C]** `src/input/touchLayout.ts`, complete (pure; a working reference for the feel design's section 7. Whoever owns the file may refine it but must keep the two signatures, which `TouchPad` uses):

```ts
import type { TouchTuning } from '../core/types';

import type { Insets } from '../shell/chooseView';

/** Pure: no Phaser, no DOM. All numbers are CSS pixels. */
export type ControlId = 'left' | 'right' | 'jump' | 'fire' | 'thrust' | 'pause';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ControlLayout {
  /** Where each button is drawn. */
  buttons: Record<ControlId, Rect>;
  /** Invisible touch regions; each is larger than the buttons inside it. */
  moveZone: Rect;
  actionZone: Rect;
  pauseZone: Rect;
  /** Touches left of this x in the move zone are LEFT, the rest RIGHT. */
  splitX: number;
  splitHysteresis: number;
}

export function layoutControls(vw: number, vh: number, safe: Insets, t: TouchTuning): ControlLayout {
  const bottom = vh - safe.bottom;
  const right = vw - safe.right;
  const leftX = safe.left + t.moveMarginSide;
  const rightX = leftX + t.moveButtonSize + t.moveButtonGap;
  const moveY = bottom - t.moveMarginBottom - t.moveButtonSize;
  const pauseX = right - t.pauseMarginSide - t.pauseButtonSize;
  const pauseY = safe.top + t.pauseMarginTop;
  const grow = (t.pauseHitSize - t.pauseButtonSize) / 2;
  return {
    buttons: {
      left: { x: leftX, y: moveY, w: t.moveButtonSize, h: t.moveButtonSize },
      right: { x: rightX, y: moveY, w: t.moveButtonSize, h: t.moveButtonSize },
      jump: {
        x: right - t.jumpMarginSide - t.jumpButtonSize,
        y: bottom - t.jumpMarginBottom - t.jumpButtonSize,
        w: t.jumpButtonSize,
        h: t.jumpButtonSize,
      },
      fire: {
        x: right - t.fireMarginSide - t.fireButtonSize,
        y: bottom - t.fireMarginBottom - t.fireButtonSize,
        w: t.fireButtonSize,
        h: t.fireButtonSize,
      },
      thrust: {
        x: right - t.thrustMarginSide - t.thrustButtonSize,
        y: bottom - t.thrustMarginBottom - t.thrustButtonSize,
        w: t.thrustButtonSize,
        h: t.thrustButtonSize,
      },
      pause: { x: pauseX, y: pauseY, w: t.pauseButtonSize, h: t.pauseButtonSize },
    },
    // Both zones run out to the physical screen edges (through the safe-area margins).
    moveZone: { x: 0, y: bottom - t.moveZoneHeight, w: safe.left + t.moveZoneWidth, h: vh - (bottom - t.moveZoneHeight) },
    actionZone: {
      x: right - t.actionZoneSize,
      y: bottom - t.actionZoneSize,
      w: vw - (right - t.actionZoneSize),
      h: vh - (bottom - t.actionZoneSize),
    },
    pauseZone: { x: pauseX - grow, y: pauseY - grow, w: t.pauseHitSize, h: t.pauseHitSize },
    splitX: leftX + t.moveButtonSize + t.moveButtonGap / 2,
    splitHysteresis: t.moveSplitHysteresis,
  };
}

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** Distance from a point to the edge of a round button (negative inside it). */
function edgeDistance(r: Rect, x: number, y: number): number {
  const dx = x - (r.x + r.w / 2);
  const dy = y - (r.y + r.h / 2);
  return Math.sqrt(dx * dx + dy * dy) - r.w / 2;
}

/**
 * Which control a pointer at (x, y) is on. `prev` is the control the same pointer was on a moment
 * ago; it only matters on the LEFT/RIGHT split, where it stops flicker.
 */
export function hitTest(
  l: ControlLayout,
  shown: { fire: boolean; thrust: boolean },
  x: number,
  y: number,
  prev: ControlId | null,
): ControlId | null {
  if (inside(l.pauseZone, x, y)) return 'pause';
  if (inside(l.moveZone, x, y)) {
    if (prev === 'left') return x >= l.splitX + l.splitHysteresis ? 'right' : 'left';
    if (prev === 'right') return x < l.splitX - l.splitHysteresis ? 'left' : 'right';
    return x < l.splitX ? 'left' : 'right';
  }
  if (inside(l.actionZone, x, y)) {
    let best: ControlId = 'jump';
    let bestDistance = edgeDistance(l.buttons.jump, x, y);
    for (const id of ['fire', 'thrust'] as const) {
      if (!shown[id]) continue;
      const d = edgeDistance(l.buttons[id], x, y);
      if (d < bestDistance) {
        best = id;
        bestDistance = d;
      }
    }
    return best;
  }
  return null;
}
```

**[C]** (pointer plumbing from [I]) `src/input/TouchPad.ts`, complete:

```ts
import type { TouchTuning } from '../core/types';

import type { Insets } from '../shell/chooseView';
import { BUTTONS, type Controls } from './Controls';
import { hitTest, layoutControls, type ControlId, type ControlLayout, type Rect } from './touchLayout';

export interface TouchPad {
  /** Call on every viewport change (same moment as applyLayout). */
  layout(vw: number, vh: number, safe: Insets): void;
  /** Call every rendered frame: which item buttons exist, and which are dimmed (bolt in flight, tank empty). */
  setItems(fire: boolean, thrust: boolean, fireDimmed: boolean, thrustDimmed: boolean): void;
  /** Lets go of every touch (pause, blur, scene end). */
  releaseAll(): void;
  dispose(): void;
}

const CONTROL_IDS: readonly ControlId[] = ['left', 'right', 'jump', 'fire', 'thrust', 'pause'];

/**
 * DOM touch pad. `root` is #pad; it holds three invisible zones ([data-zone]) that receive
 * pointerdown and six drawn buttons ([data-btn]) that receive nothing. One tracker for all pointers:
 * every pointer is re-tested against the pure layout on every move, so a thumb slides from LEFT to
 * RIGHT (or from JUMP to THRUST) without lifting, and several fingers just work.
 */
export function installTouchPad(root: HTMLElement, controls: Controls, t: TouchTuning, onPause: () => void): TouchPad {
  const find = (selector: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`touch pad: missing ${selector}`);
    return el;
  };
  const buttons = new Map<ControlId, HTMLElement>(CONTROL_IDS.map((id) => [id, find(`[data-btn="${id}"]`)]));
  const zones = { move: find('[data-zone="move"]'), action: find('[data-zone="action"]'), pause: find('[data-zone="pause"]') };
  const pointers = new Map<number, { x: number; y: number; on: ControlId | null }>();
  const shown = { fire: false, thrust: false };
  let layout: ControlLayout | null = null;
  const abort = new AbortController();
  const opts: AddEventListenerOptions = { signal: abort.signal };

  // Looks are tuning values too: hand them to the stylesheet as custom properties.
  root.style.setProperty('--pad-idle', String(t.opacityIdle));
  root.style.setProperty('--pad-pressed', String(t.opacityPressed));
  root.style.setProperty('--pad-dimmed', String(t.opacityDimmed));
  root.style.setProperty('--pad-pressed-scale', String(t.pressedScale));
  root.style.setProperty('--pad-appear', `${t.appearMs}ms`);

  const place = (el: HTMLElement, r: Rect): void => {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  const recompute = (): void => {
    const on = new Set<ControlId>();
    if (layout) {
      for (const p of pointers.values()) {
        p.on = hitTest(layout, shown, p.x, p.y, p.on);
        if (p.on) on.add(p.on);
      }
    }
    for (const b of BUTTONS) controls.set('touch', b, on.has(b));
    for (const [id, el] of buttons) el.classList.toggle('on', id !== 'pause' && on.has(id));
  };

  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no focus change, no compatibility mouse events
    if (!layout) return;
    if (hitTest(layout, shown, e.clientX, e.clientY, null) === 'pause') {
      onPause(); // PAUSE is a tap, not a held control
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, on: null });
    recompute();
  };
  const move = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    recompute();
  };
  const up = (e: PointerEvent): void => {
    if (pointers.delete(e.pointerId)) recompute();
  };
  const releaseAll = (): void => {
    pointers.clear();
    recompute();
  };

  for (const zone of Object.values(zones)) zone.addEventListener('pointerdown', down, opts);
  window.addEventListener('pointermove', move, opts);
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', up, opts);
  window.addEventListener('blur', releaseAll, opts);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) releaseAll();
    },
    opts,
  );
  root.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    opts,
  );

  return {
    layout(vw, vh, safe) {
      layout = layoutControls(vw, vh, safe, t);
      for (const [id, el] of buttons) place(el, layout.buttons[id]);
      place(zones.move, layout.moveZone);
      place(zones.action, layout.actionZone);
      place(zones.pause, layout.pauseZone);
      recompute();
    },
    setItems(fire, thrust, fireDimmed, thrustDimmed) {
      buttons.get('fire')?.classList.toggle('shown', fire);
      buttons.get('thrust')?.classList.toggle('shown', thrust);
      buttons.get('fire')?.classList.toggle('dim', fireDimmed);
      buttons.get('thrust')?.classList.toggle('dim', thrustDimmed);
      if (shown.fire !== fire || shown.thrust !== thrust) {
        shown.fire = fire;
        shown.thrust = thrust;
        recompute();
      }
    },
    releaseAll,
    dispose() {
      abort.abort();
      releaseAll();
    },
  };
}
```

How it is wired [C]: created once at module level with `TUNING.touch` (section 3); `pad.layout(innerWidth, innerHeight, insets)` in `relayout`; `pad.setItems(...)` every frame from Play; `pad.releaseAll()` in `pauseGame()` and in Play's cleanup; shown by CSS only while `#app` has both classes `touch` and `playing`. Touch mode (`installTouchMode`) is in section 17.

Pixel art in the DOM at fractional device ratios [C, review]. At 740 x 360 at 2.75 (and 915 x 412 at 2.625) the glyph canvases, centred by flexbox in buttons whose layout rectangles are fractional CSS px, sat on half device pixels (origins such as 1602.004, 804.504), and the art's outer rows were blended with the button fill (a lime glyph grew a darker 75 % lime line). Three things fix it in the built pad: every drawn button's rectangle is snapped to whole device pixels (`snapRect`), the glyph is placed absolutely at a whole number of device pixels from the button's edge (`centreOnDevicePx`), and the 2 px rim is an inset `box-shadow` rounded to whole device pixels, not a `border` (the browser rounded a 2.18 px border to 2 px, half a device pixel at 2.75, and the glyph's origin moved with it). One more: a CSS size such as 96 / 2.75 px cannot be laid out exactly (layout keeps 1/64 px), so the canvas is a hundredth of a device pixel small and its outermost device pixels are blended whatever the position; each glyph therefore has one transparent art pixel round it. After that every glyph holds only palette colours at 2.75, 2.625, 3 and 2. The hit test keeps the exact layout; the two differ by under half a device pixel.

Why DOM and one tracker [I] (real touch sequences through the DevTools protocol, 844 x 390):

| Scenario | DOM pad, one tracker | DOM, one handler per button | Phaser zones, default | Phaser zones, 3 pointers |
|---|---|---|---|---|
| Hold LEFT, tap JUMP, release LEFT | Pass | Pass | **Fail**: second finger ignored | Pass |
| Slide a held thumb LEFT to RIGHT | Pass | **Fail**: stays LEFT until lifted | Pass | Pass |
| Slide off every button | Released | Stuck until lifted | Released | Released |
| Three fingers | Pass | Pass | Fail | Pass |
| `touchcancel` | Released | Released | Released, with a console error | Same |

The per-button version fails because a touch pointer is captured by the element it started on. Phaser zones would also live inside the scaled canvas instead of at a fixed CSS size.

Observed with the code above [C] (touch context, 844 x 390):

- Layout: LEFT 64 px at (20, 306), RIGHT at x 96, JUMP 76 px 20 px from the right and bottom edges, PAUSE 36 px at top 10, right 12; with insets 47 / 47 / 21 every button moved in by the inset. The pure functions match the feel design's table on five phones: no overlap, every button at least 60 px, each button's centre maps to it, 27 px outside a button toward the screen centre still counts, the screen corners count, and the LEFT / RIGHT split has 6 px of hysteresis (unit checks).
- Hold RIGHT and tap JUMP with a second finger: one jump, both buttons lit, nothing stuck afterwards.
- Slide LEFT to RIGHT without lifting: direction reversed. Slide off every zone: released.
- Fingers on LEFT and RIGHT together: the later one wins; the core never got both.
- Before the item is held, FIRE and THRUST are invisible and a tap where FIRE will be jumps. A press and release inside one frame still jumped.
- With the items held: FIRE and THRUST fade in; FIRE fires; RIGHT + JUMP + FIRE with three fingers are all held; sliding from JUMP up to THRUST releases JUMP and holds THRUST (fuel burned).
- `touchcancel` released every button. A window blur released everything and opened the pause overlay.
- No pad touch ever reached Phaser's input (0 `pointerdown`, 0 `pointerup` in a scene) [C], and the pad gets each event once, with no `click` and no compatibility `mousedown` [I]. A second finger on the canvas while LEFT was held reached Phaser exactly once [C].
- PAUSE acts on touch down. Lifting that finger did not press the menu that had appeared underneath: the release belongs to the pad element the touch started on.
- A key press switched touch mode off (pad hidden); the next touch switched it on again.
- With `?touch=1` on a desktop the pad stays shown (a key press does not hide it) and the mouse drives it: press RIGHT, drag to LEFT, release, click JUMP all behaved like touches.

**Traps**

- Audio and fullscreen are only granted on finger **up** (section 15). Anything that needs them must hang on `pointerup`.
- Phaser calls `preventDefault` on a non-cancelable `touchcancel` for canvas touches; Chromium logs a console **error** [I]. A test that fails on any console error must allow this one.
- Menus drawn in Phaser sit under the pad's zones. The pad is hidden (class `playing` removed) whenever a menu is up, or the zones would swallow the taps [C].
- **UNVERIFIED** (desktop Chromium cannot reproduce them; the CSS and the `contextmenu` handler are the standard countermeasures, applied but not proven): the long-press menu and text selection, double-tap zoom, pull-to-refresh, iOS bounce, iOS ignoring `user-scalable=no`. Vibration (`navigator.vibrate`) was not run either.

## 15. Audio

Phaser's sound system is off (`audio: { noAudio: true }`). All sound is synthesised on one private `AudioContext` that is created and resumed inside a user gesture.

**[C]** (from [I]; the mute switch added) `src/audio/Sfx.ts` as run. `blip` is the spike's one-oscillator example voice; the real recipes (`src/audio/recipes.ts`, `synth.ts`) replace it and keep its `(ctx, dest, at, spec)` shape so they can be rendered offline in a test:

```ts
/** Hand-written WebAudio synthesis on a private AudioContext. No Phaser. */
export interface BlipSpec {
  freq: number;
  freqEnd?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

/** Works on any BaseAudioContext, so the same code renders in an OfflineAudioContext for tests. */
export function blip(ctx: BaseAudioContext, dest: AudioNode, at: number, s: BlipSpec): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = s.type ?? 'square';
  osc.frequency.setValueAtTime(s.freq, at);
  if (s.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.freqEnd), at + s.dur);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(s.gain ?? 0.25, at + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, at + s.dur);
  osc.connect(env).connect(dest);
  osc.start(at);
  osc.stop(at + s.dur + 0.01);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

const MASTER_GAIN = 0.6;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wantRunning = true;
  private muted = false;
  plays = 0;

  /** Call once at startup. Unlocks on the first real user gesture; safe to call before any gesture. */
  install(): void {
    const unlock = (): void => {
      this.ensure();
      this.sync();
    };
    // Touch only grants user activation on finger UP; keyboard and mouse grant it on DOWN.
    for (const type of ['pointerup', 'touchend', 'mousedown', 'keydown', 'click']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      this.setActive(!document.hidden);
    });
    window.addEventListener('blur', () => {
      this.setActive(false);
    });
    window.addEventListener('focus', () => {
      this.setActive(!document.hidden);
    });
  }

  private ensure(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      (window as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /** false while the page is hidden / blurred. */
  setActive(active: boolean): void {
    this.wantRunning = active;
    this.sync();
  }

  /** The mute toggle (saved in settings by the caller). Ramps over 30 ms so it does not click. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + 0.03);
  }

  private sync(): void {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    if (this.wantRunning && c.state !== 'running') void c.resume().catch(() => undefined);
    else if (!this.wantRunning && c.state === 'running') void c.suspend().catch(() => undefined);
  }

  get state(): string {
    return this.ctx ? this.ctx.state : 'none';
  }

  get output(): { ctx: AudioContext; node: GainNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, node: this.master } : null;
  }

  play(spec: BlipSpec): void {
    const c = this.ctx;
    if (!c || !this.master || this.muted || c.state !== 'running') return; // never queue sounds while locked
    blip(c, this.master, c.currentTime, spec);
    this.plays++;
  }
}
```

Call `sfx.install()` once in `main.ts` before anything else; it only adds listeners.

Observed:

- A context created before any gesture is `suspended`; creating or resuming one without a gesture logs Chrome's "AudioContext was not allowed to start" warning. `Sfx` does both only inside gesture events [I].
- **A touch unlocks on finger up, not down.** At `pointerdown` / `touchstart`, `navigator.userActivation.isActive` was `false` and `resume()` stayed pending; at `pointerup` / `touchend` the context went `running`. `keydown` and a mouse `pointerdown` unlock at once [I]. In the check the title tap's release started the game and left the context `running`, and the first jump played one voice [C].
- So the title screen starts on `pointerup` (section 11), and a sound triggered by the very first touch *press* would be silent.
- On window blur a private context keeps playing until we suspend it; `Sfx` suspends on blur and hidden and resumes on focus and on the next gesture [I][C].
- Mute, measured at the output with a test tone through the master gain: peak 0.600, then 0.00000 while muted, then 0.600 again; no voices are created while muted [C].
- Proof that an effect is not silent needs a browser, because Node has no WebAudio [I]:

```ts
const off = new OfflineAudioContext(1, Math.ceil(44100 * 0.3), 44100);
blip(off, off.destination, 0.01, { freq: 320, freqEnd: 760, dur: 0.12 });
const samples = (await off.startRendering()).getChannelData(0);   // peak 0.2326, RMS 0.0482, silent tail
```

- Fullscreen follows the same rule: `game.scale.startFullscreen()` worked from `pointerup` (mouse and touch); from a timer or a touch `pointerdown` it failed with an unhandled rejection and no `fullscreenfailed` event [I]. Check `game.scale.fullscreen.available` first.

**UNVERIFIED:** the content design's master compressor, noise buffer, voice cap and thrust loop; iOS's `interrupted` state and `webkitAudioContext`; audio in a truly hidden tab; `screen.orientation.lock('landscape')`.

## 16. Pause and visibility

Phaser does **not** pause on blur: 30 updates and 30 renders ran in the 500 ms after a window blur. On hidden it emits `hidden` and `pause` but `game.isPaused` stays `false`; it relies on the browser stopping animation frames [I]. The shell pauses itself.

One path, `PlayScene.pauseGame()` (code in section 11), is called by:

| Trigger | How it is heard | Run as |
|---|---|---|
| Esc or P | `addKey(code).on('down', ...)` in Play | Real key presses [C] |
| PAUSE on the pad | `onPause` callback of `installTouchPad` | Real touch [C] |
| Window blur | `game.events.on(Phaser.Core.Events.BLUR, ...)` | `window` blur event [I][C] |
| Tab hidden | `game.events.on(Phaser.Core.Events.HIDDEN, ...)` | `document.hidden` stubbed and `visibilitychange` dispatched [I][C]. A really hidden tab: UNVERIFIED |
| `pagehide` | `window.addEventListener('pagehide', ...)` | Synthetic event only [C]. Real navigation away: UNVERIFIED |
| Rotation to portrait on a touch device | `installRotateGuard` (section 17) | Viewport rotation [C] |

`pauseGame()` sets `mode = 'paused'` (so `update` stops calling `step`), resets the stepper, releases the pad, `Controls` and Phaser's keys, hides the pad, and launches the Pause scene. It returns at once when the game is not running, so it is safe to call from several triggers at the same moment.

Resuming is always a deliberate act in the Pause scene (RESUME, Esc, P or Enter). It never happens on focus or on turning the phone back [C]. `resumeGame()` resets the stepper, the interpolation gate and all inputs, shows the pad, and in the real game calls `holdReady(game)` so the world waits for a control to be pressed (ruling R4: a press, not a control that is still down; `controls.releaseAll()` in the same function makes sure nothing is down).

Observed [C]: after a blur the simulation stopped, the overlay was up, the pad was hidden and the audio context was `suspended`; `focus` alone changed nothing; after RESUME the ticks ran again, the hero did not move (inputs had been released) and audio was `running`.

Why a `mode` flag and not `this.scene.pause()`: `scene.pause()` works (no update, still drawn [I]) but ARCHITECTURE 11.1 keeps one switch for intro, paused, rotated and ended, and Play must stay able to react.

`game.pause()` is different: 0 updates and 0 renders while the browser's animation frames keep ticking, and `game.resume()` is seamless [I]. It is used only under the rotate message. `game.resume()` on a game that is not paused does nothing (Phaser source).

**Traps** [I]

- `game.events` `'pause'` fires on hidden although nothing is paused. Do not use it as "the game is paused".
- After focus or becoming visible `delta` is about 15 ms for 9 frames, then normal; after `game.resume()` it is normal at once. No catch-up burst either way, and the stepper is reset regardless.

## 17. The rotate message and touch mode

The message is plain CSS (section 2): `#rotate` is shown when `#app` has the classes `touch` **and** `upright`. Script sets `upright` and stops the game underneath. The message's canvas is drawn at up to 3 CSS px per art px, smaller in a narrow window (a fixed 3 made it 337 CSS px wide in a 320 px window at 1.5), and redrawn on resize (`rotateDevicePerArt` in src/shell/screenText.ts).

Touch mode and the first touch [C, review]. A key press ends touch mode and hides the pad. The next touch turns it on again in a capture-phase `pointerdown` on `window`, but by then the browser has picked that event's target: the canvas under the hidden zone. So that first touch pressed nothing, and only a second one worked. The built `installTouchMode` hands the pointerdown that turned it on to the pad (`onChange(on, firstTouch)`, then `pad.takeFirstTouch(e)`), which takes it as if a zone had (`PointerTracker.downIfOnPad`); and Cmd, Ctrl and Alt (alone or in a shortcut) no longer end touch mode (`keyEndsTouchMode`). The listing below is the earlier version.

"Upright" means the **device** is held upright, not that the window is taller than wide. The difference matters inside a frame: a preview pane is often a tall rectangle on a screen that is lying sideways, `(orientation: portrait)` describes the pane, and a phone has no way to turn a pane. So the guard asks the window first and then the screen (`screen.orientation.type`, which reports the device also from inside a frame, sandboxed or not [F]).

**[C]** for `installTouchMode` (from the feel design) and for the structure of the guard (from [I]); **[F]** for the guard as printed, which differs from the checked one in three ways: `deviceIsUpright` instead of the bare media query, the `upright` class, and a second listener on `screen.orientation`. `src/shell/lifecycle.ts`, complete:

```ts
import type * as Phaser from 'phaser';

/**
 * Touch mode: the pad and the rotate message exist only on touch devices.
 * On at boot when any pointer is coarse; on at the first real touch; off again at a key press.
 * `forced` (?touch=1) keeps it on and lets the mouse drive the pad, for tests.
 */
export function installTouchMode(app: HTMLElement, forced: boolean, onChange: () => void): void {
  const set = (on: boolean): void => {
    if (app.classList.contains('touch') === on) return;
    app.classList.toggle('touch', on);
    onChange();
  };
  if (forced || window.matchMedia('(any-pointer: coarse)').matches) set(true);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') set(true);
    },
    { capture: true },
  );
  if (!forced) {
    window.addEventListener('keydown', () => {
      set(false);
    });
  }
}

/**
 * True when the DEVICE is held upright. A wide window is never upright. A tall window is upright only if the
 * screen is: inside a frame (a preview pane) the window's shape says nothing about how the phone is held.
 */
export function deviceIsUpright(portrait: MediaQueryList): boolean {
  if (!portrait.matches) return false;
  try {
    // Typed as always present; missing on older iPhones (before iOS 16.4).
    const type = (window.screen as { orientation?: { type?: string } }).orientation?.type;
    if (typeof type === 'string') return type.startsWith('portrait');
    const angle = (window as { orientation?: unknown }).orientation; // the old iPhone property: 0 or 180 is upright
    if (typeof angle === 'number') return angle % 180 === 0;
  } catch {
    // fall through to the window's own shape
  }
  return true;
}

/**
 * Rotate guard. Sets the class "upright" on #app (the CSS in index.html shows the message for
 * #app.touch.upright) and stops the game underneath it.
 * Returns a function to call again whenever touch mode changes.
 */
export function installRotateGuard(game: Phaser.Game, app: HTMLElement, pauseGame: () => void): () => void {
  const portrait = window.matchMedia('(orientation: portrait)');
  let shown: boolean | null = null;
  const apply = (): void => {
    const upright = app.classList.contains('touch') && deviceIsUpright(portrait);
    if (upright === shown) return; // one turn of the phone fires both listeners below
    shown = upright;
    app.classList.toggle('upright', upright);
    if (upright) {
      pauseGame(); // opens the pause overlay, so turning back never resumes by itself
      game.pause(); // no update and no render while the message is up
    } else {
      game.resume();
    }
  };
  portrait.addEventListener('change', apply);
  try {
    (window.screen as { orientation?: EventTarget }).orientation?.addEventListener('change', apply);
  } catch {
    // no screen-orientation events here: the media query still fires
  }
  apply(); // also right when the page opens with the phone upright
  return apply;
}
```

Wiring is in section 3: `installRotateGuard(game, app, pausePlay)` returns `apply`, and `installTouchMode(app, forced, apply)` calls it whenever touch mode flips.

Observed [C]:

- Touch device turned to portrait: message shown, `game.isPaused` true, pause overlay opened, no ticks. Back to landscape: message gone, loop running, **still paused** with the Pause scene on top and the layout correct; RESUME continued the game.
- Page opened in portrait on a touch device: message up and the game paused from the start; turned to landscape: Title running with the right layout.
- A portrait desktop window (no touch): no message; the game runs letterboxed.

Observed [F] (the guard above on a page without Phaser, `game.pause`, `game.resume` and `pauseGame` replaced by counters, touch mode forced on; 9 cases, all as expected; the TypeScript as printed also passes `tsc` and `eslint` under this project's settings):

| Case | Window | `screen.orientation.type` | Message |
|---|---|---|---|
| Phone upright, top-level page | portrait | `portrait-primary` | Shown |
| The same phone turned sideways, and upright again | landscape, then portrait | `landscape-primary`, then `portrait-primary` | Hidden, then shown. One `pause` and one `pauseGame` per turn, although both listeners fire |
| Tall frame (300 x 380) on a phone held sideways | portrait | `landscape-primary` | **Hidden**: the game runs letterboxed in the frame |
| The same frame with `sandbox="allow-scripts"` | portrait | `landscape-primary` (readable, no error) | Hidden |
| Tall frame on a phone held upright | portrait | `portrait-primary` | Shown (turning the phone helps) |
| Wide frame (300 x 200) on a phone held upright | landscape | `portrait-primary` | Hidden |
| Tall window, and a tall frame, on a desktop screen with touch mode on | portrait | `landscape-primary` | Hidden |

The fallback for browsers without `screen.orientation` (the old `window.orientation` number, then the window's shape) is UNVERIFIED: headless Chromium always has `screen.orientation`. A framed case and a sandboxed case belong in the browser tests (`e2e/frame.spec.ts`, ARCHITECTURE section 2).

Why `matchMedia` and not Phaser's event [I]: on rotation the events arrive as window `orientationchange`, then the Scale Manager's `orientationchange` (**before** the viewport has its new size), then window `resize`, then the `matchMedia` change. And `game.scale.orientation` is the physical screen's orientation: it did not change when only the window shape changed.

## 18. Storage

**[C]** (from [I]; one type cast added for the lint rules) `src/shell/storage.ts`, complete:

```ts
/** localStorage that never throws. Falls back to memory for the current session. */
const mem = new Map<string, string>();

function store(): Storage | null {
  try {
    // Typed as always present, but it can be null, and in a sandboxed frame the read itself throws.
    return (window as { localStorage?: Storage | null }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadJson<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = store()?.getItem(key) ?? mem.get(key) ?? null;
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return isValid(v) ? v : fallback;
  } catch { return fallback; }
}

/** Returns false when the value could not be persisted (it is still kept in memory). */
export function saveJson(key: string, value: unknown): boolean {
  let raw: string;
  try { raw = JSON.stringify(value); } catch { return false; }
  mem.set(key, raw);
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, raw);
    return true;
  } catch { return false; }
}
```

This module is the only place that touches `localStorage`. Keys are `${GAME_ID}:progress` and `${GAME_ID}:settings` (ARCHITECTURE section 10); the `isValid` guards come from `parseSave` and its settings twin.

Observed:

| Case | Bare access | Wrapper |
|---|---|---|
| Normal page | Works | Saved; survived a reload [I]. Save and load round trip [C] |
| `<iframe sandbox="allow-scripts">` | Even `typeof window.localStorage` throws `SecurityError` | Fallback on load; `saveJson` returns `false`; value kept in memory [I] |
| Reading `window.localStorage` throws | Throws | `false`; the memory copy is returned by `loadJson` [C] |
| `setItem` throws `QuotaExceededError` | Throws | `false`; memory copy readable [I] |
| `window.localStorage` is `null` | `TypeError` | `false`; memory copy [I] |
| Corrupt JSON, or valid JSON of the wrong shape | n/a | Fallback value [I][C] |

Phaser itself booted in every case and wrote nothing to `localStorage`, `sessionStorage` or IndexedDB [I]. Safari private mode is UNVERIFIED.

The service worker of Phase 5 has the same trap: in a sandboxed frame reading `navigator.serviceWorker` throws. Its registration is wrapped in `try / catch` and skipped inside any frame (ARCHITECTURE 11.7). UNVERIFIED until Phase 5.

## 19. TypeScript and lint traps in this project

The spikes compiled under TypeScript 5 with plain strict mode. This project uses TypeScript 6 with `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, and typescript-eslint's `strictTypeChecked`. Running the recipes through both found these [C]:

| You write | It fails with | Write instead |
|---|---|---|
| `update(time, delta) { ... }` in a scene | TS4114: needs `override` | `override update(...)`. `init`, `preload` and `create` take no `override`: the typings declare only `update` |
| `this.scale.on(RESIZE, this.layout, this)` with a method | `@typescript-eslint/unbound-method` | An arrow-function property: `private readonly layout = (): void => { ... };` then `this.scale.on(RESIZE, this.layout)` |
| `const autoPause = (): void => this.pauseGame();` | `no-confusing-void-expression` | Braces: `(): void => { this.pauseGame(); }` |
| `frames[name]!`, `data[y]![x]` | `no-non-null-assertion` | `const grid = frames[name]; if (!grid) throw ...`, or `?? fallback` |
| `window.localStorage ?? null` | `no-unnecessary-condition` (typed as always present) | The cast in `storage.ts` |
| `sprite.setTintFill(0xffffff)` | TS2554: expected 0 arguments | `setTint(c).setTintMode(Phaser.TintModes.FILL)` |
| `map.createLayer(...)` used as a `TilemapLayer` | Type is `TilemapLayer \| TilemapGPULayer \| null` | Narrow with `instanceof Phaser.Tilemaps.TilemapLayer` |
| `this.input.keyboard.addKey(...)` | Possibly `null` | `const kb = this.input.keyboard;` and guard, as in section 13 |
| `import Phaser from 'phaser'` in a file that uses only types | `consistent-type-imports` | `import type * as Phaser from 'phaser'` |
| `private label!: BitmapText` | Nothing: definite assignment passes | Fine. The check used `\| undefined` with `?.`, which also passes |

Also: `textures.createCanvas` and `map.addTilesetImage` can return `null` [R]. In the Vite bundle `window.Phaser` is **not** defined [R]: a Playwright test cannot reach Phaser classes unless the game exposes a hook (ARCHITECTURE 11.6, `window.__E2E__`).

## 20. Traps for whoever writes the Playwright tests

Set-up that worked for everything here: `chromium.launch()` with no flags; contexts with `viewport`, `deviceScaleFactor`, and for touch `hasTouch: true, isMobile: true`.

- `page.evaluate()` and `page.waitForFunction()` carry user activation: one call unlocks audio and fullscreen. Do not call them before the gesture under test; wait with `page.waitForTimeout` instead [I].
- `--autoplay-policy=user-gesture-required` made contexts start `running`. The **default** launch is the one that locks audio [I].
- Real touches: `cdp.send('Input.dispatchTouchEvent', { type, touchPoints })`. `touchStart` lists the new points; `touchEnd` lists the points being **released** (empty = all); `touchCancel` with an empty list cancels all [I][C]. `Input.synthesizeScrollGesture`, `synthesizePinchGesture` and `synthesizeTapGesture` did nothing [I].
- `page.keyboard.down(k)` then `up(k)` with nothing between is a press inside one frame. Calling `down(k)` again while the key is down sends an auto-repeat `keydown` [C].
- Notches: `cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left, right, top, bottom } })` sets the CSS `env()` values in this Chromium; trigger a resize afterwards so the layout re-reads them [C]. No test-only URL switch is needed.
- Pixel ratio: `cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile })` changes `devicePixelRatio` on a live page without firing `resize` or a media-query `change` [C]. `page.screenshot()` undoes such an override; rotate with `page.setViewportSize` [I].
- High refresh rates: `chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'] })` lets animation frames run at about 400 to 550 per second in headless Chromium; the default is a steady 60 [C].
- Headless pages never become hidden. Stub `document.hidden` and dispatch `visibilitychange` [I][C]. A real blur worked only with `channel: 'chromium'`, DevTools `Emulation.setFocusEmulationEnabled({ enabled: false })`, then `otherPage.bringToFront()` [I]; dispatching a `blur` event on `window` is enough for Phaser and for the shell [I][C].
- Screenshots are in device pixels. Call `game.pause()` through the hook before one that will be measured, so the frame cannot change [C]. A Playwright call can cost the page a frame, so allow an occasional two-step frame in timing assertions [C].
- Headless WebGL logs "GPU stall due to ReadPixels" warnings. Fail on console **errors**, not warnings [I]. Remember the `touchcancel` error from section 14.
- `ResizeObserver`'s `devicePixelContentBoxSize` reports CSS pixels under emulation [R].
- `game.destroy(true)` in a test goes through the scenes' `destroy` handlers, not `shutdown` (section 11) [I][C].

## 21. Not verified by anyone

Plan to look at these on a real phone before calling the shell done.

- Safari (iOS and desktop) and Firefox, for everything in this file. Only Chromium was installed.
- Real notches and browser toolbars. Insets were emulated; `innerWidth` / `innerHeight` behaviour while a phone's URL bar slides was not seen, nor a flip from one landscape side to the other (the notch changes side; `watchViewport` listens for `orientationchange` for this case).
- Real 90 and 120 Hz screens (interpolation gate, frame pacing).
- A really hidden tab, a real `pagehide`, and a phone call or screen lock interrupting audio.
- Fullscreen on iPhone Safari; `screen.orientation.lock`; vibration.
- On iPhones: `screen.orientation` in the rotate guard and its fallback (section 17); the separate storage of a home-screen app; Safari forgetting stored data after a week without a visit; Web Audio muted by the ring/silent switch (ARCHITECTURE 11.7 lists them as expected, not seen).
- The size of the picture in a browser tab with its toolbars showing (section 6, last three rows of the table).
- The long-press menu, text selection, double-tap zoom, pull-to-refresh and iOS bounce.
- Safari private mode storage.
- The content design's reduced-motion switch, particle cap, audio compressor, noise voices and thrust loop.
- `scene.sleep`, `wake`, `switch`, `run`, `transition`.

---
# Part 2. Phaser 3 habits that are wrong in 4.2.1

"VERIFIED" means the behaviour was run: R = rendering spike, I = input spike, C = this document's check. "FROM SKILL FILE" means it was read in `docs/phaser-skills/**` and not run. Rows marked *not used* are here so that nobody reaches for the old API.

## Textures, drawing, text

| Do not write | Write | Status |
|---|---|---|
| `this.textures.generate(key, { data, pixelWidth })`, `Phaser.Create.GenerateTexture` | `makeSheet` (section 4). Both old APIs are `undefined` in v4 | VERIFIED R, I |
| A canvas texture without `tex.refresh()` | Call `refresh()` after drawing, or the texture is blank | VERIFIED R |
| `textures.addUint8Array(...)` | `createCanvas` + `putImageData`. `addUint8Array` threw in the Canvas renderer | VERIFIED R |
| `sprite.setTintFill(0xffffff)` | `sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)`; `clearTint()` to undo. `setTintFill` only logs an error, and its typing takes no argument | VERIFIED R, C |
| `setTint(colour)` after a fill flash, expecting a normal tint | `clearTint()` first; the FILL mode sticks otherwise | VERIFIED R, C |
| Relying on `roundPixels` being on | It is `false` by default in v4. `pixelArt: true` turns it on | VERIFIED R, I |
| Relying on `roundPixels` with a zoomed camera | It does nothing unless camera and object are a pure translation. Keep camera zoom at 1 | VERIFIED R |
| `scale: { mode: Phaser.Scale.FIT }`, `RESIZE` + camera zoom, `zoom: MAX_ZOOM`, `scale.setZoom()` for pixel art | `Scale.NONE` + CSS transform (section 6). The built-in modes gave uneven pixels | VERIFIED R; final routine C |
| `cam.startFollow(hero, false, 0.1, 0.1)`, `setLerp`, `setDeadzone`, `setBounds` | Pure `stepCamera`, then `cam.setScroll(integer, integer)` (section 7). `startFollow` also switches `cam.roundPixels` off | VERIFIED R |
| `const particles = this.add.particles('key'); particles.createEmitter(config)` | `this.add.particles(x, y, 'key', config)` returns the emitter; `emitting: false` and `explode(n, x, y)` for bursts | VERIFIED R, C (manager removal also FROM SKILL FILE) |
| A `tint: [a, b, c]` array in the emitter config, then `setParticleTint(colour)` to recolour a burst | No `tint` in the config; `emitter.setParticleTint(colour).explode(n, x, y)` per burst. With the array the later call is ignored | VERIFIED C |
| `this.add.text(...)` for HUD or menus | `BitmapText` from the runtime glyph sheet (section 9). System-font text was soft at every size tried | VERIFIED R |
| `this.cache.bitmapFont.add(key, { data: RetroFont.Parse(scene, config) })` (as the shipped skill file shows) | `this.cache.bitmapFont.add(key, RetroFont.Parse(scene, config))` | VERIFIED R, C |
| `bitmapText.setOrigin(0.5)` or any fractional position | Origin 0 and `Math.round`; bitmap text is never pixel-rounded for you | VERIFIED R, C |
| `map.createLayer(...)` treated as a `TilemapLayer`; the `gpu` flag; `Blitter` for tiles | Narrow with `instanceof Phaser.Tilemaps.TilemapLayer`. `TilemapGPULayer` and `Blitter` failed at half-pixel scroll, and the GPU layer draws -1 as tile 0 | VERIFIED R, C |
| `renderTexture.draw(obj)` and expecting it to appear | Drawing is buffered until `.render()`; and the texture came back blank after a context loss. *Not used* | VERIFIED R (also FROM SKILL FILE) |
| `type: Phaser.CANVAS` as an ordinary choice | `Phaser.AUTO`. Canvas is deprecated and ignores tints | VERIFIED R, C (deprecation FROM SKILL FILE) |
| `sprite.preFX.addGlow(...)`, `sprite.postFX`, `camera.postFX` | `sprite.enableFilters(); sprite.filters.internal.addGlow(...)` / `filters.external`. *Not used* | FROM SKILL FILE |
| `sprite.setMask(new Phaser.Display.Masks.BitmapMask(scene, img))` | `sprite.filters.internal.addMask(img)`. *Not used* | FROM SKILL FILE |
| `sprite.setPipeline('Light2D')`, custom pipelines | `sprite.setLighting(true)`; render nodes. *Not used* | FROM SKILL FILE |
| `this.add.mesh(...)`, `Plane` | Removed in v4. *Not used* | FROM SKILL FILE |
| `tileSprite.setCrop(...)` | TileSprite no longer supports cropping. *Not used* | FROM SKILL FILE |
| Reading or editing `camera.matrix` as position + rotation + zoom | The camera matrices changed (`matrix`, `matrixExternal`, `matrixCombined`). Use `scrollX`, `scrollY` only | FROM SKILL FILE |
| `new Phaser.Geom.Point(x, y)` | `new Phaser.Math.Vector2(x, y)`; geometry helpers return `Vector2` | FROM SKILL FILE |
| `Phaser.Math.TAU` meaning a quarter turn; `Phaser.Math.PI2` | `TAU` is now 2 x PI; `PI_OVER_2` is the quarter turn; `PI2` is gone | FROM SKILL FILE |
| `Phaser.Structs.Set`, `Phaser.Structs.Map` (the skill file spells them `Phaser.Struct.*`) | Native `Set` and `Map` | FROM SKILL FILE |

## Loop, scenes, lifecycle

| Do not write | Write | Status |
|---|---|---|
| `fps: { target: 60, limit: 60 }` or `forceSetTimeOut` to steady the speed; `physics.arcade.fixedStep` | Own `FixedStepper` on `delta` (section 12). `fps.limit` made the game run 1.3 to 1.75 times too fast | VERIFIED I |
| Trusting `delta` with the default config | `fps: { panicMax: 0 }`. By default `delta` is capped at 16.7 ms for 120 frames after boot, focus and becoming visible | VERIFIED I |
| Expecting Phaser to pause when the window loses focus | Pause yourself on `Phaser.Core.Events.BLUR` and `HIDDEN` (section 16). Phaser kept updating and drawing | VERIFIED I, C |
| `game.events.on('pause', ...)` as "the game is paused"; `game.hasFocus` | A `mode` flag of your own; `document.hasFocus()`. `'pause'` fires on hidden while `isPaused` is false; `hasFocus` is false until the first focus event | VERIFIED I |
| Assuming `this.scene.start('X')` has happened on the next line | It is queued until the next frame. Guard transitions with a flag; two calls in one frame both run | VERIFIED I, C |
| A HUD scene reading game state in its own `update` | Push from Play after its ticks. Scenes update in reverse array order, so the HUD runs first | VERIFIED I, C |
| Using `launch` or `start` order to decide what is on top | The config array order is the draw order and never changes | VERIFIED I |
| Leaving `game.events`, `scale`, `window` or `this.events` listeners to "scene shutdown" | Remove them in a cleanup registered for both `SHUTDOWN` and `DESTROY` with `onSceneEnd` (src/shell/sceneEnd.ts). They are not removed for you and pile up over restarts | VERIFIED I, C |
| `this.events.once(SHUTDOWN, cleanup)` next to `this.events.once(DESTROY, cleanup)` | `onSceneEnd(this.events, cleanup)`: whichever fires removes the other. `destroy` only comes from `game.destroy()`, so its `once` stayed on the scene after every visit | VERIFIED C |
| `this.scene.stop('Hud')` inside a `DESTROY` handler | Scene operations in the `SHUTDOWN` handler only; in `DESTROY` they throw | VERIFIED C |
| Placing menu items once in `create()` from `this.scale.width` | Re-place on `Phaser.Scale.Events.RESIZE`; the view size changes during play | VERIFIED C |
| `this.scale.on('orientationchange', ...)`, `this.scale.orientation` | `window.matchMedia('(orientation: portrait)')`. Phaser's event fires before the viewport has its new size and reports the physical screen | VERIFIED I |
| `this.scale.startFullscreen()` with the default target, or from a timer or touch press | `fullscreenTarget: 'app'`, called from `pointerup`. The default wraps the canvas and loses the DOM pad; outside a release gesture it rejects | VERIFIED I, C |

## Input and audio

| Do not write | Write | Status |
|---|---|---|
| `Phaser.Input.Keyboard.JustDown(key)`, or `if (key.isDown)` to detect presses | Latch the Key's `'down'` event and poll `isDown` for holds (section 13). Polling saw 3 of 20 quick taps | VERIFIED I, C |
| `this.input.keyboard.on('keydown-ESC', togglePause)` | `this.input.keyboard?.addKey(code).on('down', ...)`. Without a Key object the event re-fires on every auto-repeat | VERIFIED C |
| `event.stopPropagation()` in the top scene to hide a key from the scenes below | Guard by state. Keys reach scenes in start order, so the lower scene has usually seen it already | VERIFIED C |
| Trusting Phaser to release held keys on blur | `this.input.keyboard?.resetKeys()` in your pause path. Phaser's own blur reset is lost for all scenes once any keyboard-using scene shuts down | VERIFIED C |
| Acting on every Key `'down'`, or reading `isDown`, after a `resetKeys()` | Ignore a `'down'` whose `event.repeat` is true, and read that key as up until its `keyup` (src/input/keyboard.ts). A held key's next auto-repeat otherwise counts as a fresh press | VERIFIED C |
| `window.onblur = ...`, `window.onfocus = ...` | `addEventListener`. Phaser assigns both properties; overwriting them blinds it | VERIFIED I |
| `this.input.keyboard.addKey(...)` without a null check | `this.input.keyboard?.` or a guard; it is typed nullable | VERIFIED I, C |
| Phaser `Zone`s or `this.input.addPointer(n)` for on-screen buttons | The DOM pad (section 14) with `input: { windowEvents: false }`. Phaser has one touch pointer by default and drops other fingers | VERIFIED I, C |
| `this.input.once('pointerdown', start)` on the title | `'pointerup'`. A touch grants audio and fullscreen only on release | VERIFIED I, C |
| A menu button that acts on any `pointerup` | Arm on the object's `pointerdown`, act on its `pointerup`. A scene can get an up whose down it never saw | VERIFIED I, C |
| `this.sound.add(...)`, `this.sound.play(...)`, `this.sound.context`, `this.sound.unlock()` | `audio: { noAudio: true }` and the private `AudioContext` in `Sfx` (section 15). There are no audio files | VERIFIED I, C |

## Build and typing

| Do not write | Write | Status |
|---|---|---|
| `window.Phaser` in tests or the console | An explicit test hook. The bundle defines no global | VERIFIED R |
| `update() { ... }` in a scene class | `override update(...)` (`noImplicitOverride`); plain `init`, `preload`, `create` | VERIFIED R, I, C |
| `this.scale.on(RESIZE, this.layout, this)`; `() => this.pause()` | Arrow-function property handlers; braces around void calls (section 19) | VERIFIED C |
| A loader `preload()` with image, atlas, bitmap-font or audio files | Nothing to load: textures and font are built in `BootScene.create()` | VERIFIED R, I, C |
