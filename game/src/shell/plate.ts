/**
 * The `ui_panel` plate under a menu, a button, the level's intro card and the level-clear banner
 * (docs/ART-AND-SOUND.md sections 4 and 9), drawn by whichever renderer runs.
 *
 * With WebGL it is the 24 x 24 nine-slice with 8 px corners. Phaser 4.2.1's Canvas renderer (the fallback where
 * the browser has no WebGL) draws no nine-slice at all (NineSliceRender's renderCanvas is a no-op), so the panels and
 * button plates vanished there; on Canvas the plate is the nine-slice's own colours as filled rectangles instead: a
 * light-steel rim round the night face. Filled rectangles are drawn by both renderers and need no tint.
 */
import * as Phaser from 'phaser';

import { TEXTURE_KEY } from '../art/manifest';
import { COLOR } from '../art/palette';

/** The `ui_panel` nine-slice: 24 x 24 with 8 px corners (docs/ART-AND-SOUND.md section 4). */
const PANEL_CORNER = 8;
const PANEL_SIZE = 24;

/** A plate placed in view coordinates (top-left corner, size), shown or hidden as one. */
export interface Plate {
  place(x: number, y: number, w: number, h: number): void;
  setVisible(on: boolean): void;
  setAlpha(alpha: number): void;
}

/** True when the game draws with Phaser's Canvas renderer (no WebGL in this browser). */
export function onCanvas(scene: Phaser.Scene): boolean {
  return scene.game.renderer.type === Phaser.CANVAS;
}

/** A plate at `depth`, drawn as the nine-slice with WebGL and as rectangles on Canvas. Placed at (0, 0), 24 x 24. */
export function addPlate(scene: Phaser.Scene, depth: number): Plate {
  if (!onCanvas(scene)) {
    const slice = scene.add
      .nineslice(0, 0, TEXTURE_KEY.sprites, 'ui_panel_0', PANEL_SIZE, PANEL_SIZE, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER, PANEL_CORNER)
      .setOrigin(0, 0)
      .setDepth(depth);
    return {
      place(x, y, w, h) {
        slice.setPosition(x, y).setSize(w, h);
      },
      setVisible(on) {
        slice.setVisible(on);
      },
      setAlpha(alpha) {
        slice.setAlpha(alpha);
      },
    };
  }
  const rim = scene.add.rectangle(0, 0, PANEL_SIZE, PANEL_SIZE, COLOR.lightSteel).setOrigin(0, 0).setDepth(depth);
  const face = scene.add.rectangle(1, 1, PANEL_SIZE - 2, PANEL_SIZE - 2, COLOR.night).setOrigin(0, 0).setDepth(depth);
  return {
    place(x, y, w, h) {
      rim.setPosition(x, y).setSize(w, h);
      face.setPosition(x + 1, y + 1).setSize(Math.max(0, w - 2), Math.max(0, h - 2));
    },
    setVisible(on) {
      rim.setVisible(on);
      face.setVisible(on);
    },
    setAlpha(alpha) {
      rim.setAlpha(alpha);
      face.setAlpha(alpha);
    },
  };
}
