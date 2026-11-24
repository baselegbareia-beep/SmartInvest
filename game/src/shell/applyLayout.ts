/**
 * Pixel-perfect scaling on the page (docs/PHASER4-NOTES.md section 6, docs/ARCHITECTURE.md 11.5).
 *
 * The canvas holds the view in ART pixels (Phaser runs in Scale.NONE with zoom 1 and never sizes the
 * canvas with CSS); a CSS transform enlarges it by exactly `zoom / devicePixelRatio`, so one art pixel
 * is exactly `zoom` device pixels, and moves it to the centre of the safe area on whole device pixels.
 * The pure arithmetic is `chooseView` (chooseView.ts); this file only applies it.
 */
import type * as Phaser from 'phaser';

import type { Insets, View } from './chooseView';

/**
 * CSS env(safe-area-inset-*) cannot be read from script, so a hidden probe element carries the four
 * insets as its padding (the #safe-probe rule in index.html) and this reads them back.
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

/** Applies a view: canvas backing store = art pixels, CSS transform = position + exact whole-number upscale. */
export function applyLayout(game: Phaser.Game, view: View, dpr: number): void {
  const style = game.canvas.style;
  // Order matters: the transform first, then resize() or refresh(), which re-read the canvas bounds
  // (transform included) for pointer input. That is all the pointer mapping needs.
  style.transformOrigin = '0 0';
  style.transform = `translate(${view.cssLeft}px, ${view.cssTop}px) scale(${view.zoom / dpr})`;
  if (game.scale.width !== view.viewW || game.scale.height !== view.viewH) {
    // Scale mode NONE + zoom 1: resize() sets canvas.width/height, resizes the renderer and every
    // full-size camera in every scene, re-reads the canvas bounds for input, and emits 'resize'.
    // Only when the size really changed: setting canvas.width clears a WebGL canvas.
    game.scale.resize(view.viewW, view.viewH);
  } else {
    // Same size, new position or zoom: only the input bounds need re-reading (also emits 'resize').
    game.scale.refresh();
  }
}

/** Calls onChange (at most once per animation frame) whenever the window size or orientation changes. Returns a remover. */
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
