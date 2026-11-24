/**
 * The entry (docs/PHASER4-NOTES.md section 3, docs/ARCHITECTURE.md section 2): audio listeners first,
 * then the first layout, the Phaser game, the viewport watcher, the rotate guard and touch mode, the
 * rotate message, and the test hook when asked for.
 */
import * as Phaser from 'phaser';

import { CAMPAIGN_PROBLEMS } from './levels';
import { textWidth } from './art/font';
import { applyLayout, readSafeInsets, watchViewport } from './shell/applyLayout';
import { chooseView } from './shell/chooseView';
import type { View } from './shell/chooseView';
import { gameConfig } from './shell/config';
import { installRotateGuard, installTouchMode } from './shell/lifecycle';
import { registerServiceWorker } from './shell/pwa';
import { PlayScene } from './shell/scenes/PlayScene';
import { TEXT } from './shell/scenes/strings';
import { PHONE_FRAME_MS, PHONE_SCALE, PHONE_SIDEWAYS, PHONE_UPRIGHT } from './shell/rotateArt';
import './shell/rotate.css';
import { rotateDevicePerArt } from './shell/screenText';
import { app, pad, pixelCanvas, safeProbe, setAppliedView, sfx, textGrid } from './shell/singletons';
import { TUNING } from './tuning';

sfx.install(); // before any gesture: it only adds listeners

const params = new URLSearchParams(window.location.search);

// A campaign file that does not parse is left out, not fatal: say which (tests/levels.test.ts is the gate).
for (const problem of CAMPAIGN_PROBLEMS) console.warn(problem);

const dpr = (): number => window.devicePixelRatio || 1;
const currentView = (): View => chooseView(window.innerWidth, window.innerHeight, dpr(), readSafeInsets(safeProbe), TUNING.view);

const first = currentView();
setAppliedView(first, dpr());
const game = new Phaser.Game(gameConfig(first));
registerServiceWorker(); // the offline app (src/shell/pwa.ts): production only, never in a frame, never throws

// The rotate message: a phone outline turning from upright to sideways (src/shell/rotateArt.ts; still under reduced
// motion: src/shell/rotate.css) over the words in the game's own pixel font (no browser text on screen), as large
// as the window allows: redrawn when the window's width or pixel ratio changes it (a phone turned upright is the
// narrowest case). The phone is drawn PHONE_SCALE times the words' size and is narrower than they are.
const rotateBox = document.getElementById('rotate');
const rotateGrid = textGrid(TEXT.rotate);
const rotateArtW = textWidth(TEXT.rotate);
let rotateDrawn = '';
const drawRotate = (): void => {
  const ratio = dpr();
  const k = rotateDevicePerArt(window.innerWidth, ratio, rotateArtW);
  const key = `${k}@${ratio}`;
  if (!rotateBox || key === rotateDrawn) return;
  rotateDrawn = key;
  const phone = document.createElement('div');
  phone.className = 'rotate__phone';
  const upright = pixelCanvas(PHONE_UPRIGHT, (k * PHONE_SCALE) / ratio);
  const sideways = pixelCanvas(PHONE_SIDEWAYS, (k * PHONE_SCALE) / ratio);
  upright.className = 'rotate__upright';
  sideways.className = 'rotate__sideways';
  phone.style.width = upright.style.width;
  phone.style.height = upright.style.height;
  phone.style.setProperty('--rotate-turn', `${2 * PHONE_FRAME_MS}ms`);
  phone.append(upright, sideways);
  const words = pixelCanvas(rotateGrid, k / ratio);
  words.dataset.part = 'words';
  rotateBox.style.gap = `${(6 * k) / ratio}px`; // six art px of the words' size between the phone and them
  rotateBox.replaceChildren(phone, words);
};

let appliedDpr = dpr();
const relayout = (): void => {
  drawRotate();
  appliedDpr = dpr();
  const view = currentView();
  setAppliedView(view, appliedDpr);
  pad.layout(); // first: applyLayout's resize event re-places the camera, which keeps the hero clear of the pad
  applyLayout(game, view, appliedDpr);
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
const applyRotate = installRotateGuard(game, app, pausePlay);
installTouchMode(app, params.get('touch') === '1', (on, firstTouch) => {
  pad.setTouchMode(on);
  // The touch that brought the pad back (after a key hid it) presses what it landed on, instead of being lost.
  if (on && firstTouch) pad.takeFirstTouch(firstTouch);
  applyRotate();
});

drawRotate();

if (params.get('e2e') === '1' || import.meta.env.DEV) {
  void import('./shell/e2eHook').then((hook) => {
    hook.installE2EHook(game);
  });
}
