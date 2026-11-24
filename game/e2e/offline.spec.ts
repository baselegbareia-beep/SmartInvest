import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { GAME_ID, GAME_TITLE } from '../src/meta.ts';
import { WORKER_FILE, workerFile, workerValues } from '../src/pwa/build.ts';
import type { BuiltFile } from '../src/pwa/build.ts';
import { distFolder, readBuild, serveBuild } from '../src/pwa/serveBuild.ts';
import type { Overlay } from '../src/pwa/serveBuild.ts';

/**
 * The offline app (docs/ARCHITECTURE.md 11.7; Phase 5 exit check): the second visit works with the network
 * off; an update installs only when the server gives the new build whole, replaces the game's cache and
 * nothing else; another site on the origin cannot leave the game without its offline copy; a cache that lost a
 * file keeps the rest when the network is off; and copies of the game in two folders keep their own caches.
 * The first test runs on the configured server (the project's own build); the others serve the same dist/
 * folder themselves (src/pwa/serveBuild.ts), so that they can switch to a second build, add another site and
 * a second copy. The manifest is read in e2e/subpath.spec.ts.
 */

/** Console errors, uncaught errors, failed requests and HTTP errors of the page, as readable lines. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

const waitForGame = (page: Page): Promise<unknown> => page.waitForFunction(() => window.__GAME_READY__ === true, undefined, { timeout: 20_000 });

/** The name of the game's cache for a version, in a folder (a path such as `/game/`): see sw.template.js. */
const cacheName = (version: string, folder: string): string => `${GAME_ID}-${version}@${folder}`;

/** Every cache name of the origin, and the precache entries the game's cache (for this version and scope) lacks. Needs no network. */
function held(page: Page, scope: string, version: string, precache: readonly string[]): Promise<{ names: string[]; missing: string[] }> {
  return page.evaluate(
    async ({ name, entries, base }) => {
      const names = await caches.keys();
      if (!names.includes(name)) return { names, missing: entries };
      const cache = await caches.open(name);
      const missing: string[] = [];
      for (const entry of entries) if (!(await cache.match(new URL(entry, base).href, { ignoreVary: true }))) missing.push(entry);
      return { names, missing };
    },
    { name: cacheName(version, new URL(scope).pathname), entries: [...precache], base: scope },
  );
}

/** What the page's worker holds: its scope, every cache name of the origin, and the precache entries its cache lacks. */
async function installed(page: Page): Promise<{ scope: string; version: string; precache: string[]; caches: string[]; missing: string[] }> {
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  const { prefix, version, precache } = workerValues(await (await page.request.get(new URL('sw.js', scope).href)).text());
  expect(prefix).toBe(`${GAME_ID}-`);
  const { names, missing } = await held(page, scope, version, precache);
  return { scope, version, precache, caches: names, missing };
}

const text = (source: string | Uint8Array | undefined): string => (typeof source === 'string' ? source : Buffer.from(source ?? '').toString('utf8'));
const WORKER_TEMPLATE = readFileSync(path.join(import.meta.dirname, '..', 'src', 'pwa', 'sw.template.js'), 'utf8');

/**
 * A second build made from the first without building again: every file under assets/ renamed, as new
 * hashes would be, with every reference to it rewritten; the page marked; and the worker the build would
 * write for these files.
 */
function secondBuild(first: readonly BuiltFile[], mark: string): { files: BuiltFile[]; page: string; worker: string; version: string } {
  const renames = first
    .filter((f) => f.fileName.startsWith('assets/'))
    .map((f): [string, string] => [path.posix.basename(f.fileName), path.posix.basename(f.fileName).replace(/(\.[a-z]+)$/, '2$1')]);
  const rewrite = (source: string): string => renames.reduce((result, [from, to]) => result.replaceAll(from, to), source);
  const files = first
    .filter((f) => f.fileName !== WORKER_FILE)
    .map((f): BuiltFile => {
      if (f.fileName.startsWith('assets/')) return { fileName: rewrite(f.fileName), source: rewrite(text(f.source)) };
      if (f.fileName === 'index.html') return { fileName: f.fileName, source: rewrite(text(f.source)).replace('</body>', `${mark}</body>`) };
      return f;
    });
  const worker = text(workerFile(WORKER_TEMPLATE, GAME_ID, files).source);
  return { files, page: text(files.find((f) => f.fileName === 'index.html')?.source), worker, version: workerValues(worker).version };
}

/** The first build of dist/, checked to be what src/pwa/build.ts makes from its files as written. */
function firstBuild(): { files: BuiltFile[]; page: string; version: string } {
  const files = readBuild(distFolder());
  const worker = text(files.find((f) => f.fileName === WORKER_FILE)?.source);
  // The build's sw.js is exactly what src/pwa/build.ts makes from the files as written: the version covers their final bytes.
  expect(worker).toBe(workerFile(WORKER_TEMPLATE, GAME_ID, files).source);
  return { files, page: text(files.find((f) => f.fileName === 'index.html')?.source), version: workerValues(worker).version };
}

test('the second visit works with the network off, a room opened by its address too', async ({ page, context, baseURL }) => {
  const problems = watchProblems(page);
  await page.goto('./');
  await waitForGame(page);
  await expect(page).toHaveTitle(GAME_TITLE);

  // The worker is active, scoped to the game's folder, and its one cache holds every file of the build.
  await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);
  const worker = await installed(page);
  expect(worker.scope).toBe(new URL('./', baseURL).href);
  expect(worker.caches.filter((name) => name.startsWith(`${GAME_ID}-`))).toEqual([cacheName(worker.version, new URL(worker.scope).pathname)]);
  expect(worker.precache).toEqual(expect.arrayContaining(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png']));
  // Every file this page loaded is among them.
  const loaded = (await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)))
    .filter((url) => url.startsWith(worker.scope) && !url.endsWith(`/${WORKER_FILE}`))
    .map((url) => url.slice(worker.scope.length).replace(/\?.*$/, '') || './');
  for (const file of loaded) expect(worker.precache, file).toContain(file);
  // No script that players need is loaded later than the start: every other script of the build is one of the two
  // test-only chunks of section 11.6. An update deletes the old cache, so a tab left open on the old build could
  // not load a later chunk (docs/ARCHITECTURE.md 11.7).
  const later = worker.precache.filter((entry) => entry.endsWith('.js') && !loaded.includes(entry));
  expect(later.filter((entry) => !/^assets\/(e2eHook|offline)-[\w-]+\.js$/.test(entry))).toEqual([]);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // The network goes off. The page and all its files now come from the worker.
  await context.setOffline(true);
  const fromNetwork: string[] = [];
  page.on('response', (response) => {
    if (/^https?:/.test(response.url()) && !response.fromServiceWorker()) fromNetwork.push(response.url());
  });
  await page.reload();
  await waitForGame(page);
  await expect(page).toHaveTitle(GAME_TITLE);
  const canvas = await page.evaluate(() => document.querySelector('#game canvas') instanceof HTMLCanvasElement);
  expect(canvas).toBe(true);

  // A room by its address: the worker's cache lookup ignores the query (the worker answers no other address in its
  // folder), and the test hook's chunk was cached with the rest.
  await page.goto('./?level=test&e2e=1');
  await expect.poll(() => page.evaluate(() => window.__E2E__?.state()?.levelId ?? null), { timeout: 15_000 }).toBe('test');
  const tickAt = (): Promise<number> => page.evaluate(() => window.__E2E__?.state()?.tick ?? -1);
  const before = await tickAt();
  await expect.poll(tickAt, { timeout: 10_000 }).toBeGreaterThan(before + 10);

  expect(fromNetwork).toEqual([]);
  expect(problems).toEqual([]);

  // The network really is off for the worker too: a file the build does not have cannot be fetched.
  const outcome = await page.evaluate(() => fetch('./not-in-the-build.txt').then(() => 'fetched', () => 'failed'));
  expect(outcome).toBe('failed');
});

test("an update installs only once the server gives the new build whole; it replaces the game's old cache, other sites' caches stay, and the start after is the new build", async ({
  page,
}) => {
  const first = firstBuild();
  const MARK = '<!-- second build -->';
  const second = secondBuild(first.files, MARK);
  expect(second.version).not.toBe(first.version);
  const newScript = second.files.find((f) => /^assets\/index-.*\.js$/.test(f.fileName))?.fileName ?? 'none';
  expect(first.files.map((f) => f.fileName)).not.toContain(newScript);
  /** The server after the deploy: the second build's files and worker, the first build's assets gone, and `index` as the page. */
  const deployed = (index: string): Overlay =>
    new Map<string, string | Uint8Array | null>([
      ...first.files.filter((f) => f.fileName.startsWith('assets/')).map((f): [string, null] => [f.fileName, null]),
      ...second.files.map((f): [string, string | Uint8Array] => [f.fileName, f.source]),
      [WORKER_FILE, second.worker],
      ['index.html', index],
    ]);
  const showsSecond = async (): Promise<boolean> => (await page.evaluate(() => document.body.innerHTML)).includes(MARK);
  const keys = async (): Promise<string[]> => (await page.evaluate(() => caches.keys())).sort();

  // As GitHub Pages serves: the browser may reuse each file for 10 minutes, so the first build's page stays in its
  // HTTP cache. Only the worker's 'no-cache' requests keep that copy out of the new cache.
  const server = await serveBuild(distFolder(), '/game/', { httpCache: 'pages' });
  try {
    await page.goto(server.url);
    await waitForGame(page);
    await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);

    // Other sites on the same origin (on GitHub Pages every project of one owner shares it), among them one whose
    // name starts with this game's id.
    const others = ['smartinvest-charts-v3', GAME_ID, `${GAME_ID}-ii-0123`];
    await page.evaluate(async (names) => {
      for (const name of names) await (await caches.open(name)).put(`/elsewhere/${name}.json`, new Response(`{"site":"${name}"}`));
    }, others);
    expect(await keys()).toEqual([cacheName(first.version, '/game/'), ...others].sort());

    // The deploy, seen half-done: the second build's files and worker are live and the first build's are gone, but
    // the server still returns the first build's index.html (a CDN may, for a while). The next start runs the first
    // build from the cache. The browser finds the new worker, which stores that page, sees it name scripts that are
    // not its own, deletes its new cache and fails. So the first build keeps running.
    const seen = server.requests.length;
    server.overlay = deployed(first.page);
    await page.reload();
    await waitForGame(page);
    expect(await showsSecond()).toBe(false);
    const attempt = async (): Promise<{ fetchedNewScript: boolean; installing: string | null; caches: string[] }> => ({
      fetchedNewScript: server.requests.slice(seen).includes(`/game/${newScript}`),
      installing: await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state ?? null),
      caches: await keys(),
    });
    await expect.poll(attempt, { timeout: 15_000 }).toEqual({ fetchedNewScript: true, installing: null, caches: [cacheName(first.version, '/game/'), ...others].sort() });
    await page.reload();
    await waitForGame(page);
    expect(await showsSecond()).toBe(false);

    // The deploy completes. The next start still runs the first build from the cache, while the browser tries the new
    // worker again: now it installs beside the old cache, then replaces it. Other sites' caches keep their entries.
    server.overlay = deployed(second.page);
    await page.reload();
    await waitForGame(page);
    expect(await showsSecond()).toBe(false);
    await expect.poll(keys, { timeout: 15_000 }).toEqual([cacheName(second.version, '/game/'), ...others].sort());
    const kept = await page.evaluate(
      (names) => Promise.all(names.map(async (name) => (await (await caches.open(name)).match(`/elsewhere/${name}.json`))?.text() ?? null)),
      others,
    );
    expect(kept).toEqual(others.map((name) => `{"site":"${name}"}`));
    expect((await installed(page)).missing).toEqual([]);

    // The start after that, with the server gone: the new build, from the new cache.
    await server.close();
    await page.reload();
    await waitForGame(page);
    expect(await showsSecond()).toBe(true);
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
    expect(scripts).toContain(`${server.url}${newScript}`);
  } finally {
    await server.close();
  }
});

test("another site on the origin: the game's folder answers it as the server does, and if it deletes the game's cache, the next start online fills it again", async ({
  page,
  context,
}) => {
  // A site at the origin's root that cleans up as many workers do on activation: it deletes every cache but its own.
  const root = `<!doctype html><title>root</title><script>
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== 'root-site-v1').map((name) => caches.delete(name))))
      .then(() => caches.open('root-site-v1'))
      .then(() => { document.title = 'cleaned'; });
  </script>`;
  const server = await serveBuild(distFolder(), '/SmartInvest/game/', { pages: { '/SmartInvest/': root } });
  try {
    await page.goto(server.url);
    await waitForGame(page);
    await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    // An address in the game's folder that is not a file of the build gets the server's own answer (here a 404),
    // as without a worker; not the game's page, whose relative URLs would miss from there and leave it blank.
    for (const address of ['levels/3', 'nested/page/', 'play']) {
      const response = await page.goto(server.url + address);
      expect([response?.status(), response?.fromServiceWorker()], address).toEqual([404, false]);
    }

    await page.goto(`${server.origin}/SmartInvest/`);
    await expect(page).toHaveTitle('cleaned');
    expect(await page.evaluate(() => caches.keys())).toEqual(['root-site-v1']);

    // The next start, online: the game comes from the network, and its worker fills its cache again.
    await page.goto(server.url);
    await waitForGame(page);
    await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);
    const refilled = await installed(page);
    expect(refilled.caches.sort()).toEqual([cacheName(refilled.version, '/SmartInvest/game/'), 'root-site-v1'].sort());

    // So the start after that works with the network off.
    await context.setOffline(true);
    await page.reload();
    await waitForGame(page);
    await expect(page).toHaveTitle(GAME_TITLE);
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});

test('a cache that lost one file keeps the rest when its refill fails with the network off, so the game still starts offline; the next start online completes it', async ({
  page,
  context,
}) => {
  const server = await serveBuild(distFolder(), '/SmartInvest/game/');
  try {
    await page.goto(server.url);
    await waitForGame(page);
    await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const { scope, version, precache } = await installed(page);

    // Something deletes one entry of the game's cache: a file that a start does not load.
    const lost = 'icon-512.png';
    expect(await page.evaluate(async ({ name, url }) => (await caches.open(name)).delete(url), { name: cacheName(version, new URL(scope).pathname), url: new URL(lost, scope).href })).toBe(true);
    expect((await held(page, scope, version, precache)).missing).toEqual([lost]);

    // Two starts with the network off. Each one's refill fails at once; the cache keeps its other files, so both start.
    await context.setOffline(true);
    for (const start of [1, 2]) {
      await page.reload();
      await waitForGame(page);
      await expect(page, `offline start ${start}`).toHaveTitle(GAME_TITLE);
      expect((await held(page, scope, version, precache)).missing, `offline start ${start}`).toEqual([lost]);
    }

    // The next start online fills the cache again.
    await context.setOffline(false);
    await page.reload();
    await waitForGame(page);
    await expect.poll(async () => (await held(page, scope, version, precache)).missing, { timeout: 15_000 }).toEqual([]);
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});

test('copies of the game in two folders of one origin keep their own caches, and both start with the network off', async ({ page, context }) => {
  const first = firstBuild();
  const MARK = '<!-- the copy in /b/ -->';
  const second = secondBuild(first.files, MARK);
  const copy: Overlay = new Map<string, string | Uint8Array | null>([
    ...second.files.map((f): [string, string | Uint8Array] => [f.fileName, f.source]),
    [WORKER_FILE, second.worker],
  ]);
  const server = await serveBuild(distFolder(), '/a/', { copies: { '/b/': copy } });
  try {
    for (const folder of ['/a/', '/b/']) {
      await page.goto(server.origin + folder);
      await waitForGame(page);
      await expect.poll(async () => (await installed(page)).missing, { timeout: 15_000 }).toEqual([]);
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    }
    // Each copy's activation deleted only older caches of its own folder.
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual([cacheName(first.version, '/a/'), cacheName(second.version, '/b/')].sort());

    await context.setOffline(true);
    for (const [folder, marked] of [
      ['/a/', false],
      ['/b/', true],
    ] as const) {
      await page.goto(server.origin + folder);
      await waitForGame(page);
      expect((await page.evaluate(() => document.body.innerHTML)).includes(MARK), folder).toBe(marked);
    }
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});
