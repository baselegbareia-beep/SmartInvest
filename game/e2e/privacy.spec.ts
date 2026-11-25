import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { compileTuning } from '../src/core/compileTuning.ts';
import type { InputScript } from '../src/core/types.ts';
import { distFolder, readBuild, serveBuild } from '../src/pwa/serveBuild.ts';
import { TUNING } from '../src/tuning.ts';

/**
 * docs/SPEC.md: "Nothing is sent anywhere. ... the game uses no network once it has loaded." Watched here over
 * a whole play session: the title, a new game started with a key, the pause menu with the sound switched off and
 * on again, RESTART LEVEL from the pause menu until the lives run out, a while on the GAME OVER screen, TITLE,
 * then the ten campaign levels replayed from their scripts through the test hook, as e2e/levels.spec.ts does, to
 * the win screen, and a while on it once all its lines are up.
 *
 * Every timer of the page runs on Playwright's clock (page.clock.install). It keeps time as usual through the
 * session. At the end it jumps a day ahead, so every timer the page set for up to a day later fires before the
 * look: a request left for later is caught too.
 *
 * The build is served by the test's own server (src/pwa/serveBuild.ts) at /SmartInvest/game/, as GitHub Pages
 * serves it. The browser context reports every request from the first navigation on: the page's, its workers'
 * and the offline worker's. The server's own list of what it was asked for is a second witness: it also sees the
 * browser's own update check of sw.js, which the context does not report. The rule, for the whole session:
 * - No request goes to another origin. A request passes only if it is http to the test server's origin, or a
 *   data: or blob: address, which is made and read inside the page. Any other address fails, and so does any
 *   WebSocket. WebRTC and WebTransport send UDP that no request event shows, so the page may not open one at
 *   all: every RTCPeerConnection and WebTransport it makes is counted, and the count must be zero.
 * - Every request is a GET of one of the build's own files at its exact address: the game's folder plus the path
 *   of a file of dist/, or the folder alone (its index.html), with no query. The one exception is the page's own
 *   address as the test opens it (`?e2e=1` turns on the test hook), and only before the page has loaded (the
 *   title is up: `__GAME_READY__`). That covers the game loading, all the offline worker asks for (its install
 *   and its refill fetch its precache list, which is exactly these files, and the browser checks sw.js for an
 *   update) and what the game loads later (the test hook's chunk). Anything else fails, on the same origin too:
 *   another path in the folder or on the site, a query on a file of the build, or a POST.
 * Both rules hold whether the offline worker has installed, is installing or has not started, so the test never
 * waits for it. Not watched: a timer set for more than a day later, and timers or WebTransport inside a worker (the
 * clock and the count are the page's).
 */

const SUB = '/SmartInvest/game/';
const CAMPAIGN_IDS = Array.from({ length: 10 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`);
const PHYS = compileTuning(TUNING);
/** The ticks per rendered frame of the replay, as in e2e/levels.spec.ts. */
const FAST = 20;

const readRuns = (id: string): InputScript['runs'] =>
  (JSON.parse(readFileSync(path.join(import.meta.dirname, 'scripts', `${id}.json`), 'utf8')) as InputScript).runs;

const now = (page: Page) => page.evaluate(() => window.__E2E__?.state() ?? null);
const scenes = (page: Page): Promise<string[]> => page.evaluate(() => window.__E2E__?.scenes() ?? []);
const menuLabels = (page: Page): Promise<string[]> => page.evaluate(() => (window.__E2E__?.menu() ?? []).map((item) => item.label));
const muted = (page: Page) => page.evaluate(() => window.__E2E__?.sound().muted);

interface Row {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The menu takes picks (an end screen takes none for a moment after it opens). */
  readonly armed: boolean;
}
const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(() =>
    (window.__E2E__?.menu() ?? []).map((i) => ({ label: i.label, x: i.x, y: i.y, w: i.w, h: i.h, armed: (i as { armed?: boolean }).armed ?? true })),
  );

/** Clicks a menu row where the hook says it is, once the menu takes picks: the row labelled `row`, or the row at index `row`. */
async function pick(page: Page, row: string | number): Promise<void> {
  const find = (all: readonly Row[]): Row | undefined => (typeof row === 'number' ? all[row] : all.find((r) => r.label === row));
  await expect.poll(async () => find(await rows(page))?.armed ?? false, { message: `menu row ${String(row)}, taking picks` }).toBe(true);
  const item = find(await rows(page));
  if (!item) throw new Error(`no menu row ${String(row)}`);
  await page.mouse.click(item.x + item.w / 2, item.y + item.h / 2);
}

test("a session from the title through GAME OVER to the win screen sends nothing anywhere: past the page's own address, every request is a GET of a file of the build", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const server = await serveBuild(distFolder(), SUB);
  try {
    const files = readBuild(distFolder()).map((f) => f.fileName);
    const ownUrls = new Set([server.url, ...files.map((name) => server.url + name)]);
    const ownPaths = new Set([SUB, ...files.map((name) => SUB + name)]);

    const requests: { readonly url: string; readonly line: string; readonly get: boolean }[] = [];
    context.on('request', (request) => {
      const by = request.serviceWorker() ? ' (offline worker)' : '';
      requests.push({ url: request.url(), line: `${request.method()} ${request.url()}${by}`, get: request.method() === 'GET' });
    });
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    // The page's timers on Playwright's clock, which keeps time as usual until the jump at the end.
    await page.clock.install();
    // Every WebRTC and WebTransport connection the page (or a frame of it) makes, by the name it was made with.
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown> & { __direct__: string[] };
      w.__direct__ = [];
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
        const Real = w[name];
        if (typeof Real !== 'function') continue;
        w[name] = new Proxy(Real, {
          construct(target, args, made) {
            w.__direct__.push(name);
            return Reflect.construct(target, args, made) as object;
          },
        });
      }
    });

    // The first screen.
    const opened = `${server.url}?e2e=1`;
    await page.goto(opened);
    await page.waitForFunction(() => window.__E2E__ !== undefined && window.__GAME_READY__ === true, undefined, { timeout: 20_000 });
    const loaded = { requests: requests.length, server: server.requests.length };
    await expect.poll(() => scenes(page)).toEqual(['Title']);

    // A new game, started as a player starts it: Space on the title, the intro card, then a key opens the ready gate.
    await page.keyboard.press('Space');
    await expect.poll(async () => (await now(page))?.mode, { timeout: 10_000 }).toBe('running');
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await now(page))?.phase).toBe('playing');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowRight');

    // The pause menu: the sound off, then on again.
    await page.keyboard.press('Escape');
    await expect.poll(() => scenes(page)).toContain('Pause');
    await pick(page, 'SOUND ON');
    await expect.poll(() => muted(page)).toBe(true);
    await pick(page, 'SOUND OFF');
    await expect.poll(() => muted(page)).toBe(false);

    // RESTART LEVEL from the pause menu until the lives run out, a while on the GAME OVER screen, then TITLE. The
    // restart row is picked by its place, under RESUME, as its words may change on the last life.
    for (let i = 0; i < 10 && !(await scenes(page)).includes('End'); i++) {
      if (i > 0) {
        await page.keyboard.press('Escape');
        await expect.poll(() => scenes(page)).toContain('Pause');
      }
      expect((await menuLabels(page))[0]).toBe('RESUME');
      await pick(page, 1);
      await expect
        .poll(async () => {
          const on = await scenes(page);
          return on.includes('End') || (!on.includes('Pause') && (await now(page))?.mode === 'running');
        })
        .toBe(true);
    }
    await expect.poll(() => scenes(page)).toEqual(['End']);
    expect(await now(page)).toMatchObject({ status: 'gameOver' });
    await page.waitForTimeout(2000);
    await pick(page, 'TITLE');
    await expect.poll(() => scenes(page)).toEqual(['Title']);

    // The ten levels from their scripts, as one session, to the win screen (as e2e/levels.spec.ts plays them).
    const wait: InputScript['runs'][number] = [0, PHYS.exitTicks];
    const runs = CAMPAIGN_IDS.flatMap((id) => [...readRuns(id), wait]);
    const result = await page.evaluate(
      async ({ ids, r, n }) => {
        const hook = window.__E2E__;
        if (!hook) throw new Error('window.__E2E__ is missing');
        return hook.replay(ids, { runs: r }, n, { until: 'sessionEnd' });
      },
      { ids: CAMPAIGN_IDS, r: runs, n: FAST },
    );
    expect(result.died).toBeNull();
    await expect.poll(() => scenes(page)).toEqual(['End']);
    expect(await now(page)).toMatchObject({ status: 'won', levelId: 'level-10' });
    expect(await menuLabels(page)).toEqual(['PLAY AGAIN', 'TITLE']);
    // A while on the win screen, past its last line (90 frames, 1.5 s; 120 frames with a best line): the jump below
    // does not move the game on, as Phaser takes one long frame as a short one. Then a day on the page's clock:
    // every timer the page set for later fires now. Then a moment for what they would send.
    await page.waitForTimeout(3000);
    await page.clock.fastForward('24:00:00');
    await page.waitForTimeout(1000);

    const isLocal = (url: string): boolean => url.startsWith('data:') || url.startsWith('blob:');
    const isOnOrigin = (url: string): boolean => URL.canParse(url) && new URL(url).protocol === 'http:' && new URL(url).origin === server.origin;
    expect(sockets, 'WebSockets').toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { __direct__?: string[] }).__direct__),
      'WebRTC and WebTransport connections',
    ).toEqual([]);
    expect(
      requests.filter((r) => !isLocal(r.url) && !isOnOrigin(r.url)).map((r) => r.line),
      'requests to another origin',
    ).toEqual([]);
    expect(
      requests.filter((r, i) => !isLocal(r.url) && !(r.get && (ownUrls.has(r.url) || (i < loaded.requests && r.url === opened)))).map((r) => r.line),
      'requests that are not a GET of a file of the build',
    ).toEqual([]);
    expect(
      server.requests.filter((p, i) => !ownPaths.has(p) && !(i < loaded.server && p === `${SUB}?e2e=1`)),
      "what the server was asked for besides the build's files",
    ).toEqual([]);
    // The session really was recorded: the page itself, before load.
    expect(requests.slice(0, loaded.requests).map((r) => r.url)).toContain(opened);
    expect(problems).toEqual([]);
  } finally {
    await server.close();
  }
});
