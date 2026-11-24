/* global self, caches, fetch, Request, URL */
/**
 * The game's service worker (docs/ARCHITECTURE.md, section 11.7). Plain JavaScript, no imports.
 *
 * This file is a template: the build (the offline-app plugin in vite.config.ts) writes it to sw.js
 * with the three quoted placeholders below filled in. It is never loaded as it stands.
 *
 * - install: put every file of this build into a new cache, check that the page stored names only
 *   files of this build, then take over at once. On any failure the new cache is deleted: the old
 *   version keeps running and the browser tries again on a later start.
 * - activate: delete this game's older caches of this folder (never a copy of the game in another
 *   folder, never another site's), then control the open pages.
 * - fetch: only GET requests for the build's own files are answered (the query is ignored, so
 *   `?level=test` and `?e2e=1` work offline too): from the cache, or from the network when the cache
 *   lacks them. Every other request is left to the browser untouched. A start of the game (a
 *   navigation) also fills the cache again if it is not complete, for instance because another site
 *   on the origin deleted it; if that fails, the files the cache still has stay.
 */

/** `${GAME_ID}-`: the start of every cache name this game owns (src/meta.ts). */
const CACHE_PREFIX = '__CACHE_PREFIX__';
/** A hash of this build's file list and contents: a new build gets a new cache. */
const VERSION = '__VERSION__';
/** `./` and every file the build emitted, relative to this worker (that is, to the game's folder). */
const PRECACHE = ['__PRECACHE__'];

/**
 * The parts of a service worker's global scope used here (the project's type check knows only the DOM).
 *
 * @typedef {Event & { waitUntil(work: Promise<unknown>): void }} LifecycleEvent
 * @typedef {LifecycleEvent & { readonly request: Request; respondWith(answer: Promise<Response>): void }} FetchRequestEvent
 * @typedef {{
 *   readonly registration: { readonly scope: string };
 *   readonly clients: { claim(): Promise<void> };
 *   skipWaiting(): Promise<void>;
 *   addEventListener(type: 'install' | 'activate', listener: (event: LifecycleEvent) => void): void;
 *   addEventListener(type: 'fetch', listener: (event: FetchRequestEvent) => void): void;
 * }} WorkerScope
 */
const worker = /** @type {WorkerScope} */ (/** @type {unknown} */ (self));

/** The game's folder, such as `https://<owner>.github.io/SmartInvest/game/`: where `./sw.js` was registered. */
const SCOPE = worker.registration.scope;
/**
 * The folder's path ends the cache's name, so that a copy of the game in another folder of the same
 * origin (a test copy, say) keeps its own cache: `moon-foundry-<VERSION>@/SmartInvest/game/`.
 */
const CACHE_SUFFIX = `@${new URL(SCOPE).pathname}`;
const CACHE_NAME = CACHE_PREFIX + VERSION + CACHE_SUFFIX;
/** The address of each of the build's files, without query: the only requests this worker answers. */
const OWN_FILES = new Set(PRECACHE.map((entry) => new URL(entry, SCOPE).href));
/** The pages among them (`./` and `index.html`): what a start of the game loads first. */
const PAGES = PRECACHE.filter((entry) => entry === './' || entry.endsWith('.html'));
/** ignoreVary: the cache holds one copy of each of the game's own files, whatever the server's Vary says. */
const MATCH = { ignoreSearch: true, ignoreVary: true };

/**
 * True for a cache of this game in this folder: the prefix, a version hash, then this folder's suffix.
 * A cache of another site on the same origin (on GitHub Pages every project of one owner shares it)
 * never matches, even one whose name happens to start with the same words; nor does the cache of a
 * copy of the game in another folder.
 *
 * @param {string} name
 */
const isOwnCache = (name) =>
  name.startsWith(CACHE_PREFIX) &&
  name.endsWith(CACHE_SUFFIX) &&
  /^[0-9a-f]+$/.test(name.slice(CACHE_PREFIX.length, name.length - CACHE_SUFFIX.length));

/**
 * Puts every file of this build into its cache, all or nothing. Each request says 'no-cache', so the
 * server confirms each file (an unchanged file costs a 304) and a stale copy in the browser's HTTP
 * cache is never stored.
 *
 * Then each stored page must name (`src="./…"` or `href="./…"`) only files of this build: during a
 * deploy a server, or a CDN in front of it, may still return the previous index.html beside the new
 * sw.js, and that page's scripts are neither in this cache nor, for long, on the server.
 *
 * `addAll` stores all or nothing: when a file fails (one the server does not have, no network, no room
 * left), nothing is stored and the entries already in the cache stay as they were. So on a failure the
 * cache is deleted only if this call created it (a failed install leaves nothing behind) or if the page
 * check failed (addAll has then stored that page over the cache's own). A cache that was already there
 * and only lacked some files (a refill, see `repair`) keeps the files it has: they are this build's, and a
 * start with the network off still needs them. So the game's cache only ever holds files of its own build.
 */
async function precache() {
  const existed = await caches.has(CACHE_NAME);
  let stored = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.map((entry) => new Request(entry, { cache: 'no-cache' })));
    stored = true;
    for (const entry of PAGES) {
      const page = await cache.match(entry, MATCH);
      if (!page) throw new Error(`${entry} is not in the cache`);
      for (const [, file = ''] of (await page.text()).matchAll(/\s(?:src|href)="\.\/([^"?#]+)/g)) {
        if (!PRECACHE.includes(file)) throw new Error(`${entry} names ./${file}, which is not a file of this build`);
      }
    }
  } catch (error) {
    if (stored || !existed) await caches.delete(CACHE_NAME);
    throw error;
  }
}

/**
 * Fills the cache again when it lacks any file of the build; does nothing when it is complete. When the
 * refill fails (the network is off, say), the files the cache still has stay (see `precache`).
 */
async function repair() {
  if (await caches.has(CACHE_NAME)) {
    const cache = await caches.open(CACHE_NAME);
    const held = await Promise.all(PRECACHE.map((entry) => cache.match(entry, MATCH)));
    if (held.every(Boolean)) return;
  }
  await precache();
}

worker.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => isOwnCache(name) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  // Not a GET, or not one of the build's files (another address in the folder, the site's root, other
  // projects, other origins): not this worker's business. The browser asks the network, as without a worker.
  if (request.method !== 'GET' || !OWN_FILES.has(request.url.replace(/[?#].*$/, ''))) return;
  // `caches.match` with a cache name reads the game's own cache only, and never creates it.
  event.respondWith(caches.match(request, { ...MATCH, cacheName: CACHE_NAME }).then((hit) => hit ?? fetch(request)));
  if (request.mode === 'navigate') event.waitUntil(repair().catch(() => undefined));
});
