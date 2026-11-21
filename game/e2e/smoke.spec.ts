import path from 'node:path';

import { expect, test } from '@playwright/test';

import { GAME_TITLE } from '../src/meta.ts';

const SCREENSHOT = path.join(import.meta.dirname, 'screenshots', 'title.png');

test('the title screen boots on WebGL without errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    problems.push(`request failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.goto('./');
  await page.waitForFunction(() => window.__GAME_READY__ === true);

  await expect(page).toHaveTitle(GAME_TITLE);

  // A canvas has one context type for life: asking for another type gives null.
  // So this tells which renderer Phaser picked without any hook into the game.
  const renderer = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return 'no canvas';
    if (canvas.getContext('webgl') ?? canvas.getContext('webgl2')) return 'webgl';
    return canvas.getContext('2d') ? 'canvas' : 'unknown';
  });
  expect(renderer, 'Phaser must use its WebGL renderer, not the Canvas fallback').toBe('webgl');

  // The canvas is on screen, inside the viewport, and the page cannot scroll.
  const layout = await page.evaluate(() => {
    const box = document.querySelector('#game canvas')?.getBoundingClientRect();
    const root = document.documentElement;
    return {
      canvasIsVisible: box !== undefined && box.width > 0 && box.height > 0,
      canvasIsInsideViewport:
        box !== undefined &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight,
      pageScrolls: root.scrollWidth > window.innerWidth || root.scrollHeight > window.innerHeight,
    };
  });
  expect(layout).toEqual({ canvasIsVisible: true, canvasIsInsideViewport: true, pageScrolls: false });

  await page.screenshot({ path: SCREENSHOT });

  expect(problems).toEqual([]);
});
