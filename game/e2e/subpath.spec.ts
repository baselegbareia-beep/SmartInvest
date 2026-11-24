import { chromium, expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

import { GAME_ID, GAME_TITLE } from '../src/meta.ts';
import { distFolder, serveBuild } from '../src/pwa/serveBuild.ts';

/**
 * The build served from a sub-folder (docs/ARCHITECTURE.md 11.7; Phase 5 exit check). GitHub Pages serves
 * the game at /<repository>/game/, beside another site at the root; here the same dist/ folder is served at
 * /deep/sub/ by the test's own server (src/pwa/serveBuild.ts, on a free port), which records every path
 * it is asked for. There the manifest is read as Chromium reads it: every address in it must be inside
 * /deep/sub/ (at the origin's root, as the configured server serves the build, a '/' would pass for './').
 * Then the game inside other pages' frames: no worker, no error.
 */

const SUB = '/deep/sub/';

/** Every error a frame reports, collected inside it (an init script runs in every frame). */
const COLLECT_ERRORS = (): void => {
  const w = window as unknown as { __errors__?: string[] };
  w.__errors__ = [];
  window.addEventListener('error', (e) => w.__errors__?.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => w.__errors__?.push(`rejection: ${String(e.reason)}`));
};
const errorsIn = (target: Page | Frame): Promise<string[]> => target.evaluate(() => (window as unknown as { __errors__?: string[] }).__errors__ ?? []);

/** Console errors and uncaught errors of the page and all its frames. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test('from /deep/sub/: the same boot, the worker scoped to /deep/sub/, no request outside it, and offline next time', async ({ page, context }) => {
  const server = await serveBuild(distFolder(), SUB);
  try {
    const problems = watchProblems(page);
    page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    // Every request of the browser context: the page's and the worker's.
    const urls: string[] = [];
    context.on('request', (request) => urls.push(request.url()));
    await page.addInitScript(COLLECT_ERRORS);

    await page.goto(server.url);
    await page.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
    await expect(page).toHaveTitle(GAME_TITLE);
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector('#game canvas');
      // A canvas keeps one context type for life (as in e2e/smoke.spec.ts): this names the one Phaser took.
      if (!(canvas instanceof HTMLCanvasElement)) return 'no canvas';
      return (canvas.getContext('webgl') ?? canvas.getContext('webgl2')) ? 'webgl' : 'other';
    });
    expect(renderer).toBe('webgl');

    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(`${server.origin}${SUB}`);
    // The worker's install has fetched every file: the server has seen it ask for the manifest and the last icon.
    await expect.poll(() => server.requests.filter((p) => p === `${SUB}manifest.webmanifest` || p === `${SUB}icon-maskable-512.png`).length, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    expect(server.requests).toContain(`${SUB}sw.js`);
    expect(server.requests.filter((p) => !p.startsWith(SUB))).toEqual([]);
    expect(urls.filter((u) => /^https?:/.test(u) && !u.startsWith(server.url))).toEqual([]);

    // The next visit to the sub-folder works with the server gone.
    await server.close();
    await page.reload();
    await page.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
    await expect(page).toHaveTitle(GAME_TITLE);

    expect(await errorsIn(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    await server.close();
  }
});

for (const { label, sandbox } of [
  { label: 'a frame', sandbox: false },
  { label: 'a sandboxed frame (scripts allowed, no same-origin)', sandbox: true },
]) {
  test(`inside ${label}: no worker is registered and nothing throws`, async ({ page }) => {
    const host = `<!doctype html><html><body style="margin:0;background:#222"><iframe ${sandbox ? 'sandbox="allow-scripts" ' : ''}src="sub/" style="width:844px;height:390px;border:0"></iframe></body></html>`;
    // The host page sits beside the game's folder on the same origin, so that it shares the game's storage
    // (a worker registered by the frame would be listed here).
    const server = await serveBuild(distFolder(), SUB, { pages: { '/deep/host.html': host } });
    try {
      const problems = watchProblems(page);
      await page.addInitScript(COLLECT_ERRORS);
      await page.goto(`${server.origin}/deep/host.html`);

      await expect.poll(() => page.frames().length).toBeGreaterThan(1);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      if (!frame) throw new Error('no game frame');
      await frame.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
      // main.ts registers right after creating the game, long before the title is up; give a wrong
      // registration time to show anyway.
      await page.waitForTimeout(500);

      const frameFacts = await frame.evaluate(() => {
        let storage = 'usable';
        try {
          window.localStorage.getItem('x');
        } catch {
          storage = 'throws';
        }
        return { framed: window.self !== window.top, storage };
      });
      expect(frameFacts).toEqual({ framed: true, storage: sandbox ? 'throws' : 'usable' });

      expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope))).toEqual([]);
      expect(server.requests).not.toContain(`${SUB}sw.js`);
      if (!sandbox) expect(await frame.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

      expect(await errorsIn(frame)).toEqual([]);
      expect(await errorsIn(page)).toEqual([]);
      expect(problems).toEqual([]);
    } finally {
      await server.close();
    }
  });
}

/** Chromium's own reading of the manifest (CDP Page.getAppManifest). */
interface AppManifest {
  url: string;
  errors: { message: string }[];
  manifest?: {
    name?: string;
    id?: string;
    startUrl?: string;
    scope?: string;
    display?: string;
    displayOverrides?: string[];
    orientation?: string;
    themeColor?: string;
    backgroundColor?: string;
    icons?: { url: string; sizes?: string; type?: string }[];
  };
}

test('from /deep/sub/: the manifest parses, its icons load at their sizes, and Chromium reads an app of this folder', async ({ page, context }) => {
  const server = await serveBuild(distFolder(), SUB);
  try {
    await page.goto(server.url);
    await page.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
    const folder = server.url;

    const fromPage = await page.evaluate(async () => {
      const size = async (url: string): Promise<{ type: string | null; drawn: string }> => {
        const response = await fetch(url);
        const bitmap = await createImageBitmap(await response.blob());
        return { type: response.headers.get('content-type'), drawn: `${bitmap.width}x${bitmap.height}` };
      };
      const link = (rel: string): HTMLLinkElement | null => document.querySelector(`link[rel="${rel}"]`);
      const manifestUrl = link('manifest')?.href ?? '';
      const manifest = JSON.parse(await (await fetch(manifestUrl)).text()) as { short_name: string; icons: { src: string; sizes: string }[] };
      return {
        links: ['manifest', 'icon', 'apple-touch-icon'].map((rel) => link(rel)?.getAttribute('href') ?? null),
        shortName: manifest.short_name,
        icons: await Promise.all(manifest.icons.map(async (icon) => ({ src: icon.src, sizes: icon.sizes, ...(await size(new URL(icon.src, manifestUrl).href)) }))),
        favicon: await size(link('icon')?.href ?? ''),
        appleTouch: await size(link('apple-touch-icon')?.href ?? ''),
      };
    });
    expect(fromPage.links).toEqual(['./manifest.webmanifest', './icon-192.png', './apple-touch-icon.png']);
    expect(fromPage.shortName).toBe(GAME_TITLE.split(' ')[0]);
    expect(fromPage.icons.length).toBe(4);
    for (const icon of fromPage.icons) expect(icon, icon.src).toEqual({ src: icon.src, sizes: icon.sizes, type: 'image/png', drawn: icon.sizes });
    expect(fromPage.favicon).toEqual({ type: 'image/png', drawn: '192x192' });
    expect(fromPage.appleTouch).toEqual({ type: 'image/png', drawn: '180x180' });

    const cdp = await context.newCDPSession(page);
    const read = (await cdp.send('Page.getAppManifest')) as unknown as AppManifest;
    expect(read.url).toBe(`${folder}manifest.webmanifest`);
    expect(read.errors).toEqual([]);
    const voidRgba = 'rgba(11,13,26,1)';
    expect(read.manifest).toMatchObject({
      name: GAME_TITLE,
      // The id is resolved against the origin, so it is the game's id, not the folder (docs/ARCHITECTURE.md 11.7).
      id: new URL(`/${GAME_ID}`, folder).href,
      startUrl: folder,
      scope: folder,
      display: 'kFullscreen',
      displayOverrides: ['kFullscreen', 'kStandalone'],
      orientation: 'LANDSCAPE',
      themeColor: voidRgba,
      backgroundColor: voidRgba,
    });
    expect(read.manifest?.icons?.map((icon) => [icon.url, icon.sizes])).toEqual([
      [`${folder}icon-192.png`, '192x192'],
      [`${folder}icon-512.png`, '512x512'],
      [`${folder}icon-maskable-512.png`, '512x512'],
      [`${folder}apple-touch-icon.png`, '180x180'],
    ]);
  } finally {
    await server.close();
  }
});

test('from /deep/sub/: the full Chromium judges the game installable, and a page without a manifest not', async () => {
  // The headless shell that runs the other tests answers "no errors" even for a page with no manifest, so this
  // asks the full Chromium (the 'chromium' channel, which `playwright install chromium` installs beside the shell),
  // in a profile on disk: a private profile only answers 'in-incognito'.
  const server = await serveBuild(distFolder(), SUB, { pages: { '/deep/plain.html': '<!doctype html><title>plain</title>' } });
  const browser = await chromium.launchPersistentContext(test.info().outputPath('profile'), {
    channel: 'chromium',
    viewport: { width: 844, height: 390 },
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    const errors = async (): Promise<string[]> => {
      const cdp = await browser.newCDPSession(page);
      try {
        return (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((error) => error.errorId);
      } finally {
        await cdp.detach();
      }
    };
    await page.goto(`${server.origin}/deep/plain.html`);
    expect(await errors()).toContain('no-manifest');
    await page.goto(server.url);
    await page.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
    await expect.poll(errors, { timeout: 10_000 }).toEqual([]);
  } finally {
    await browser.close();
    await server.close();
  }
});
