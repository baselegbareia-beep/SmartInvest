import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

/**
 * The game inside other pages' frames (docs/ARCHITECTURE.md section 2, "Tests and levels"; Phase 1):
 *
 * 1. A preview pane is often a TALL frame on a screen held sideways. The rotate message must follow how
 *    the device is held (the screen), not the frame's shape: on a phone held sideways, inside a frame
 *    taller than wide, there is no rotate message and the game runs.
 * 2. A sandboxed frame (scripts allowed, no same-origin) makes the page's origin opaque: reading
 *    `localStorage` throws there. The game must boot anyway, with no error.
 *
 * The host page is served by the test itself at the game's own address. The game's scripts are
 * modules, which a sandboxed frame (origin "null") fetches with CORS; GitHub Pages, where the game is
 * hosted, answers every file with `Access-Control-Allow-Origin: *`, and the test adds that header to the
 * preview server's answers so the frame is served as it will be in production.
 */

/** Every error the frames report, collected inside each frame (an init script runs in every frame). */
const COLLECT_ERRORS = (): void => {
  const w = window as unknown as { __errors__?: string[] };
  w.__errors__ = [];
  window.addEventListener('error', (e) => w.__errors__?.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => w.__errors__?.push(`rejection: ${String(e.reason)}`));
};

async function hostPage(page: Page, frameAttrs: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  await page.addInitScript(COLLECT_ERRORS);
  await page.route('**/frame-host.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0;background:#222"><iframe ${frameAttrs}></iframe></body></html>`,
    }),
  );
  // Served as on GitHub Pages: every file may be read from any origin (a sandboxed frame's is "null").
  await page.route(
    (url) => !url.pathname.endsWith('/frame-host.html'),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    },
  );
  await page.goto('./frame-host.html');
  return problems;
}

/** The game's frame, once it has loaded. */
async function gameFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
  return frame;
}

const frameErrors = (frame: Frame): Promise<string[]> => frame.evaluate(() => (window as unknown as { __errors__?: string[] }).__errors__ ?? []);

test.describe('a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('inside a tall frame there is no rotate message and the game runs', async ({ page }) => {
    const problems = await hostPage(page, 'src="./?level=test&e2e=1" style="width:300px;height:380px;border:0"');
    const frame = await gameFrame(page);

    const setting = await frame.evaluate(() => {
      const app = document.getElementById('app');
      const rotate = document.getElementById('rotate');
      return {
        tallFrame: window.matchMedia('(orientation: portrait)').matches,
        screenHeldSideways: (screen.orientation as ScreenOrientation | undefined)?.type.startsWith('landscape') ?? null,
        touch: app?.classList.contains('touch') ?? false,
        upright: app?.classList.contains('upright') ?? true,
        rotateShown: rotate ? getComputedStyle(rotate).display !== 'none' : true,
      };
    });
    // The conditions the test is about: a frame taller than wide, on a touch screen held sideways.
    expect(setting.tallFrame).toBe(true);
    expect(setting.screenHeldSideways).toBe(true);
    expect(setting.touch).toBe(true);
    // And the outcome: no rotate message.
    expect(setting.upright).toBe(false);
    expect(setting.rotateShown).toBe(false);

    // The game runs: the level's clock moves (the ready gate counts ticks too) and the card gives way to play.
    const tickAt = (): Promise<number> => frame.evaluate(() => window.__E2E__?.state()?.tick ?? -1);
    await expect.poll(tickAt, { timeout: 10_000 }).toBeGreaterThan(5);
    const before = await tickAt();
    await expect.poll(tickAt).toBeGreaterThan(before + 10);
    await expect.poll(() => frame.evaluate(() => window.__E2E__?.state()?.mode ?? null)).toBe('running');

    expect(await frameErrors(frame)).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test('inside a sandboxed frame (no same-origin, so no storage) the game boots with no error', async ({ page }) => {
  const problems = await hostPage(page, 'src="./" sandbox="allow-scripts" style="width:844px;height:390px;border:0"');
  const frame = await gameFrame(page);

  // The frame really is sandboxed: its storage refuses to be touched.
  const storage = await frame.evaluate(() => {
    try {
      window.localStorage.getItem('x');
      return 'usable';
    } catch {
      return 'throws';
    }
  });
  expect(storage).toBe('throws');
  // The title is up and drawn.
  expect(await frame.evaluate(() => document.querySelector('#game canvas') instanceof HTMLCanvasElement)).toBe(true);

  expect(await frameErrors(frame)).toEqual([]);
  expect(problems).toEqual([]);
});
