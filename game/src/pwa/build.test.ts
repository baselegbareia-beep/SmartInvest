/**
 * The offline app's build step (docs/ARCHITECTURE.md 11.7, docs/ART-AND-SOUND.md 11): the plugin's output
 * for a fake bundle, the worker's behaviour in a stand-in worker scope, and the four icons decoded pixel
 * by pixel.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { offlineApp } from '../../vite.config.ts';
import { PALETTE, codeToHex, codeToRgb } from '../art/palette.ts';
import { SPRITES } from '../art/sprites/index.ts';
import { GAME_ID, GAME_TITLE } from '../meta.ts';

import { ICONS, ICON_BACKGROUND, MANIFEST_FILE, WORKER_FILE, buildVersion, iconFiles, manifestFile, workerFile, workerValues } from './build.ts';
import type { BuiltFile } from './build.ts';

const WORKER_TEMPLATE = readFileSync(path.join(import.meta.dirname, 'sw.template.js'), 'utf8');
const MANIFEST_TEMPLATE = readFileSync(path.join(import.meta.dirname, 'manifest.template.json'), 'utf8');

// ---------------------------------------------------------------- the plugin, run on a fake bundle

type FakeOutput = { type: 'asset'; fileName: string; source: string | Uint8Array } | { type: 'chunk'; fileName: string; code: string };

const FAKE_BUNDLE: readonly FakeOutput[] = [
  { type: 'asset', fileName: 'index.html', source: '<!doctype html><script type="module" src="./assets/index-AbC123.js"></script>' },
  { type: 'chunk', fileName: 'assets/index-AbC123.js', code: 'console.log("game");' },
  { type: 'chunk', fileName: 'assets/e2eHook-Zz9.js', code: 'export const hook = 1;' },
  { type: 'asset', fileName: 'assets/index-Css1.css', source: 'body{background:#0b0d1a}' },
];

/** Runs the plugin's generateBundle on a bundle and returns every file it emitted, by name. */
function runPlugin(outputs: readonly FakeOutput[]): Map<string, string | Uint8Array> {
  const hook = offlineApp().generateBundle;
  const handler = typeof hook === 'function' ? hook : hook?.handler;
  if (!handler) throw new Error('the offline-app plugin has no generateBundle hook');
  const emitted = new Map<string, string | Uint8Array>();
  const context = {
    emitFile(file: { fileName: string; source: string | Uint8Array }): string {
      if (emitted.has(file.fileName)) throw new Error(`${file.fileName} emitted twice`);
      emitted.set(file.fileName, file.source);
      return file.fileName;
    },
  };
  const bundle = Object.fromEntries(outputs.map((out) => [out.fileName, out]));
  // The hook only reads fileName, type, code and source, and only calls emitFile.
  (handler as (this: unknown, options: unknown, bundle: unknown, isWrite: boolean) => void).call(context, {}, bundle, true);
  return emitted;
}

const text = (source: string | Uint8Array | undefined): string =>
  typeof source === 'string' ? source : new TextDecoder().decode(source ?? new Uint8Array(0));

describe('the offline-app plugin', () => {
  const emitted = runPlugin(FAKE_BUNDLE);

  it('emits the manifest, the four icons and the worker, and nothing else', () => {
    expect([...emitted.keys()].sort()).toEqual([MANIFEST_FILE, WORKER_FILE, ...ICONS.map((i) => i.file)].sort());
  });

  it('writes the manifest of section 11.7', () => {
    const manifest = JSON.parse(text(emitted.get(MANIFEST_FILE))) as Record<string, unknown>;
    const voidHex = codeToHex('0');
    expect(voidHex).toBe('#0b0d1a');
    expect(manifest).toEqual({
      name: GAME_TITLE,
      short_name: GAME_TITLE.split(' ')[0],
      // Not './': a browser resolves the id against the origin, which every project of the owner shares.
      id: GAME_ID,
      start_url: './',
      scope: './',
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'landscape',
      background_color: voidHex,
      theme_color: voidHex,
      icons: expect.any(Array) as unknown,
    });
    expect(manifest.short_name).toBe('Sprue');
  });

  it("lists the four icons with relative URLs and the sizes their PNG files really have", () => {
    const manifest = JSON.parse(text(emitted.get(MANIFEST_FILE))) as { icons: { src: string; sizes: string; type: string; purpose: string }[] };
    expect(manifest.icons.map((i) => i.src)).toEqual(ICONS.map((i) => i.file));
    for (const icon of manifest.icons) {
      expect(icon.src, 'relative: no scheme, no leading slash').toMatch(/^[a-z0-9-]+\.png$/);
      expect(icon.type).toBe('image/png');
      const png = decodePng(emitted.get(icon.src));
      expect(icon.sizes, icon.src).toBe(`${png.width}x${png.height}`);
    }
    expect(manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src)).toEqual(['icon-maskable-512.png']);
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('writes the worker with the cache prefix, the precache list and the version filled in', () => {
    const source = text(emitted.get(WORKER_FILE));
    expect(source).not.toMatch(/__[A-Z_]+__/);
    const { prefix, version, precache } = workerValues(source);
    expect(prefix).toBe(`${GAME_ID}-`);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    // './' first, then every emitted file but the worker itself, in a fixed order.
    const everyFile = [...FAKE_BUNDLE.map((out) => out.fileName), ...emitted.keys()].filter((name) => name !== WORKER_FILE);
    expect(precache[0]).toBe('./');
    expect(precache.slice(1)).toEqual([...everyFile].sort());
    expect(new Set(precache).size).toBe(precache.length);
    for (const entry of precache) expect(entry, 'relative to the worker').not.toMatch(/^\/|^[a-z]+:/);
    // The output is valid JavaScript (compiled here, not run).
    expect(() => new vm.Script(source)).not.toThrow();
  });

  it('gives the same version for the same files, and a new one when any file changes or is added', () => {
    const versionOf = (outputs: readonly FakeOutput[]): string => workerValues(text(runPlugin(outputs).get(WORKER_FILE))).version;
    const base = versionOf(FAKE_BUNDLE);
    expect(versionOf(FAKE_BUNDLE)).toBe(base);
    const changed = FAKE_BUNDLE.map((out): FakeOutput => (out.type === 'asset' && out.fileName === 'index.html' ? { ...out, source: `${text(out.source)}<!-- 2 -->` } : out));
    expect(versionOf(changed)).not.toBe(base);
    const changedChunk = FAKE_BUNDLE.map((out): FakeOutput => (out.type === 'chunk' && out.fileName.includes('e2eHook') ? { ...out, code: 'export const hook = 2;' } : out));
    expect(versionOf(changedChunk)).not.toBe(base);
    expect(versionOf([...FAKE_BUNDLE, { type: 'asset', fileName: 'extra.txt', source: '' }])).not.toBe(base);
  });
});

describe('the build helpers', () => {
  it('refuse a manifest template without the name and id placeholders', () => {
    expect(() => manifestFile('{"name":"Fixed","short_name":"Fixed","id":"%GAME_ID%"}', GAME_TITLE, GAME_ID)).toThrow(/%GAME_TITLE%/);
    expect(() => manifestFile('{"name":"%GAME_TITLE%","short_name":"%SHORT_NAME%","id":"./"}', GAME_TITLE, GAME_ID)).toThrow(/%GAME_ID%/);
  });

  it('refuse a worker template that lacks a placeholder or holds one twice', () => {
    const files: BuiltFile[] = [{ fileName: 'index.html', source: '' }];
    expect(() => workerFile(WORKER_TEMPLATE.replace(`'__VERSION__'`, `'x'`), GAME_ID, files)).toThrow(/'__VERSION__'/);
    expect(() => workerFile(`${WORKER_TEMPLATE}\n['__PRECACHE__'];`, GAME_ID, files)).toThrow(/__PRECACHE__/);
  });

  it('hash the worker template into the version, so a change to the worker gets a fresh cache', () => {
    const files: BuiltFile[] = [{ fileName: 'index.html', source: 'x' }];
    expect(buildVersion(WORKER_TEMPLATE, files)).not.toBe(buildVersion(`${WORKER_TEMPLATE}\n`, files));
    // The worker's own file is never part of what it caches or hashes.
    expect(buildVersion(WORKER_TEMPLATE, [...files, { fileName: WORKER_FILE, source: 'old' }])).toBe(buildVersion(WORKER_TEMPLATE, files));
  });

  it('read the real manifest template', () => {
    expect(() => manifestFile(MANIFEST_TEMPLATE, GAME_TITLE, GAME_ID)).not.toThrow();
  });
});

// ---------------------------------------------------------------- the worker, in a stand-in worker scope

const FOLDER = '/SmartInvest/game/';
const SCOPE = `https://example.test${FOLDER}`;

/** A stand-in for a Response: a status, a text body, and where it came from ('network' or 'cache'). */
class FakeResponse {
  constructor(
    readonly body: string,
    readonly status = 200,
    readonly via = 'network',
  ) {}
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  text(): Promise<string> {
    return Promise.resolve(this.body);
  }
}

/** This build's page, as Vite writes it: relative URLs to its own files. */
const PAGE = '<!doctype html><link rel="manifest" href="./manifest.webmanifest"><script type="module" crossorigin src="./assets/index-AbC.js"></script>';
/** The page of another build: its script is not a file of this one. */
const OTHER_PAGE = PAGE.replace('index-AbC.js', 'index-Old.js');

const FILES: BuiltFile[] = [
  { fileName: 'index.html', source: PAGE },
  { fileName: 'assets/index-AbC.js', source: 'game' },
  { fileName: 'manifest.webmanifest', source: '{}' },
];

/**
 * Loads a built sw.js into a fresh context whose `self`, `caches`, `fetch`, `Request` and `URL` are
 * stand-ins. The network serves this build (`server`, by address without query; anything else is a 404)
 * until a test changes it; `net.online` and `net.full` (no room left for a cache) switch failures on.
 */
function loadWorker(existingCaches: readonly string[] = []) {
  const source = workerFile(WORKER_TEMPLATE, GAME_ID, FILES).source as string;
  const { prefix, version } = workerValues(source);
  const name = `${prefix}${version}@${FOLDER}`;
  const listeners = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, FakeResponse>>(existingCaches.map((cache) => [cache, new Map()]));
  const calls: string[] = [];
  const networkFetches: string[] = [];
  const net = { online: true, full: false };
  const resolve = (url: string): string => new URL(url, `${SCOPE}sw.js`).href;
  const strip = (url: string): string => url.replace(/[?#].*$/, '');
  const server = new Map<string, string>([[SCOPE, PAGE], ...FILES.map((f): [string, string] => [SCOPE + f.fileName, text(f.source)])]);

  class FakeRequest {
    readonly url: string;
    readonly method: string;
    readonly mode: string;
    readonly cache: string;
    constructor(url: string, init: { method?: string; mode?: string; cache?: string } = {}) {
      this.url = resolve(url);
      this.method = init.method ?? 'GET';
      this.mode = init.mode ?? 'cors';
      this.cache = init.cache ?? 'default';
    }
  }
  const network = (request: FakeRequest): Promise<FakeResponse> => {
    if (!net.online) return Promise.reject(new TypeError('Failed to fetch'));
    const body = server.get(strip(request.url));
    return Promise.resolve(body === undefined ? new FakeResponse('not found', 404) : new FakeResponse(body));
  };
  type Options = { ignoreSearch?: boolean; ignoreVary?: boolean; cacheName?: string };
  const lookup = (store: Map<string, FakeResponse>, request: FakeRequest | string, options: Options): FakeResponse | undefined => {
    const url = typeof request === 'string' ? resolve(request) : request.url;
    return options.ignoreSearch ? store.get(strip(url)) : store.get(url);
  };
  const cacheApi = (store: Map<string, FakeResponse>) => ({
    // All or nothing, as the real addAll: every answer must be ok before anything is stored.
    addAll: async (requests: FakeRequest[]) => {
      for (const r of requests) calls.push(`add ${r.url} cache=${r.cache}`);
      const answers = await Promise.all(requests.map(network));
      if (answers.some((a) => !a.ok)) throw new TypeError('addAll: a request failed');
      if (net.full) throw Object.assign(new Error('no room left'), { name: 'QuotaExceededError' });
      requests.forEach((r, i) => store.set(r.url, new FakeResponse(answers[i]?.body ?? '', 200, 'cache')));
    },
    match: (request: FakeRequest | string, options: Options) => Promise.resolve(lookup(store, request, options)),
  });
  const scope = {
    self: {
      registration: { scope: SCOPE },
      clients: { claim: () => (calls.push('claim'), Promise.resolve()) },
      skipWaiting: () => (calls.push('skipWaiting'), Promise.resolve()),
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    },
    caches: {
      open: (cache: string) => {
        calls.push(`open ${cache}`);
        const store = stores.get(cache) ?? new Map<string, FakeResponse>();
        stores.set(cache, store);
        return Promise.resolve(cacheApi(store));
      },
      has: (cache: string) => Promise.resolve(stores.has(cache)),
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (cache: string) => (calls.push(`delete ${cache}`), Promise.resolve(stores.delete(cache))),
      // Never creates a cache: an unknown cacheName finds nothing.
      match: (request: FakeRequest, options: Options) => {
        calls.push(`caches.match ${String(options.cacheName)} ignoreSearch=${String(options.ignoreSearch)} ignoreVary=${String(options.ignoreVary)}`);
        const store = options.cacheName === undefined ? undefined : stores.get(options.cacheName);
        return Promise.resolve(store && lookup(store, request, options));
      },
    },
    fetch: (request: FakeRequest) => (networkFetches.push(request.url), network(request)),
    Request: FakeRequest,
    URL,
  };
  vm.runInNewContext(source, scope);

  /** Fires a lifecycle event and waits for what it asked to wait for. */
  const lifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  /**
   * Fires a fetch event and waits for its answer and for what it asked to wait for. Undefined when the
   * worker left the request to the browser; otherwise 'cache: <body>', 'network: <body>' or 'failed: <error>'.
   */
  const request = async (url: string, init: { method?: string; mode?: string } = {}): Promise<string | undefined> => {
    let answer: Promise<FakeResponse> | undefined;
    let work: Promise<unknown> = Promise.resolve();
    listeners.get('fetch')?.({
      request: new FakeRequest(url, init),
      respondWith: (p: Promise<FakeResponse>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => (work = p),
    });
    if (answer === undefined) return undefined;
    const outcome = await answer.then(
      (r) => `${r.via}: ${r.body}`,
      (error: unknown) => `failed: ${String(error)}`,
    );
    await work;
    return outcome;
  };
  return { source, name, stores, calls, networkFetches, net, server, lifecycle, request };
}

describe('the worker (sw.js in a stand-in worker scope)', () => {
  it('install puts every precache entry into a cache named for this version and this folder, asking the server to confirm each, then takes over', async () => {
    const w = loadWorker();
    expect(w.name).toMatch(new RegExp(`^${GAME_ID}-[0-9a-f]{16}@/SmartInvest/game/$`));
    await w.lifecycle('install');
    expect(w.calls.filter((c) => !c.startsWith('match'))).toEqual([
      `open ${w.name}`,
      `add ${SCOPE} cache=no-cache`,
      `add ${SCOPE}assets/index-AbC.js cache=no-cache`,
      `add ${SCOPE}index.html cache=no-cache`,
      `add ${SCOPE}manifest.webmanifest cache=no-cache`,
      'skipWaiting',
    ]);
    expect([...(w.stores.get(w.name)?.keys() ?? [])].sort()).toEqual([SCOPE, `${SCOPE}assets/index-AbC.js`, `${SCOPE}index.html`, `${SCOPE}manifest.webmanifest`]);
  });

  it.each(['./', 'index.html'])(
    'install refuses a page of another build at %s (a deploy seen half-done): it deletes the new cache, fails, and does not take over',
    async (stale) => {
      const w = loadWorker();
      w.server.set(new URL(stale, SCOPE).href, OTHER_PAGE);
      await expect(w.lifecycle('install')).rejects.toThrow(/names \.\/assets\/index-Old\.js/);
      expect([...w.stores.keys()]).toEqual([]);
      expect(w.calls).toContain(`delete ${w.name}`);
      expect(w.calls).not.toContain('skipWaiting');
    },
  );

  it("install accepts a page that names its own files with a query, and ignores addresses outside the game's folder", async () => {
    const w = loadWorker();
    const page = PAGE.replace('index-AbC.js', 'index-AbC.js?v=2') + '<link rel="preconnect" href="https://cdn.example/"><a href="/elsewhere/">';
    w.server.set(SCOPE, page);
    w.server.set(`${SCOPE}index.html`, page);
    await w.lifecycle('install');
    expect(w.calls).toContain('skipWaiting');
    expect(w.stores.get(w.name)?.size).toBe(4);
  });

  it.each([
    ['no room is left', (w: ReturnType<typeof loadWorker>) => (w.net.full = true)],
    ['a file is missing on the server', (w: ReturnType<typeof loadWorker>) => w.server.delete(`${SCOPE}manifest.webmanifest`)],
    ['the network is off', (w: ReturnType<typeof loadWorker>) => (w.net.online = false)],
  ])('install that cannot store the files (%s) leaves no empty cache behind and fails', async (_label, fail) => {
    const w = loadWorker();
    fail(w);
    await expect(w.lifecycle('install')).rejects.toThrow();
    expect([...w.stores.keys()]).toEqual([]);
    expect(w.calls).not.toContain('skipWaiting');
  });

  it("activate deletes this game's older caches of this folder only, then claims the open pages", async () => {
    const others = [
      'other-site-v1',
      'SmartInvest',
      GAME_ID,
      `${GAME_ID}-ii-0123`,
      `${GAME_ID}2-abc`,
      `${GAME_ID}-xyz@${FOLDER}`,
      // Copies of the game in other folders of the origin keep their caches.
      `${GAME_ID}-0123456789abcdef@/SmartInvest/game-beta/`,
      `${GAME_ID}-0123456789abcdef@/SmartInvest/game/beta/`,
      `${GAME_ID}-0123456789abcdef@/`,
    ];
    const w = loadWorker([`${GAME_ID}-0123456789abcdef@${FOLDER}`, `${GAME_ID}-00aa@${FOLDER}`, ...others]);
    await w.lifecycle('install');
    await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual([w.name, ...others].sort());
    expect(w.calls.slice(-1)).toEqual(['claim']);
  });

  it("answers only the build's own files, from its own cache, ignoring the query; every other request is left to the browser", async () => {
    const w = loadWorker();
    await w.lifecycle('install');
    expect(await w.request('assets/index-AbC.js')).toBe('cache: game');
    expect(await w.request('./?level=test&e2e=1', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    expect(await w.request('index.html?level=3', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    expect(w.calls.filter((c) => c.startsWith('caches.match'))).toEqual(Array(3).fill(`caches.match ${w.name} ignoreSearch=true ignoreVary=true`));
    // Not the worker's business: no answer at all, so the browser asks the network as without a worker
    // (an address in the folder that is not the game's gets the server's 404, not a blank page).
    for (const [url, mode] of [
      ['./somewhere/else', 'navigate'],
      ['levels/3', 'navigate'],
      ['assets/missing.js', 'cors'],
      ['https://example.test/SmartInvest/', 'navigate'],
      ['https://example.test/SmartInvest/index.html', 'navigate'],
      ['https://example.test/SmartInvest/gamey/x.js', 'cors'],
      ['https://elsewhere.test/SmartInvest/game/assets/index-AbC.js', 'cors'],
    ]) {
      expect(await w.request(url ?? '', { mode }), url).toBeUndefined();
    }
    expect(await w.request('assets/index-AbC.js', { method: 'POST' })).toBeUndefined();
    expect(w.networkFetches).toEqual([]);
  });

  it('with its cache deleted (by another site on the origin), it fetches from the network without making an empty cache, and the next start fills the cache again', async () => {
    const w = loadWorker();
    await w.lifecycle('install');
    await w.lifecycle('activate');
    w.stores.clear();
    expect(await w.request('assets/index-AbC.js')).toBe('network: game');
    expect([...w.stores.keys()]).toEqual([]);
    const added = (): number => w.calls.filter((c) => c.startsWith('add ')).length;
    expect(added()).toBe(4);
    // A start of the game: answered from the network, and the cache is filled again, checked as at install.
    expect(await w.request('./', { mode: 'navigate' })).toBe(`network: ${PAGE}`);
    expect(added()).toBe(8);
    expect(w.stores.get(w.name)?.size).toBe(4);
    // The next start comes from the cache, which is complete: nothing is fetched again.
    expect(await w.request('./', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    expect(added()).toBe(8);
  });

  it('a start with its cache deleted and the network off fails as it would without a worker, and leaves no cache behind', async () => {
    const w = loadWorker();
    await w.lifecycle('install');
    w.stores.clear();
    w.net.online = false;
    expect(await w.request('./', { mode: 'navigate' })).toBe('failed: TypeError: Failed to fetch');
    expect([...w.stores.keys()]).toEqual([]);
  });

  it('a start whose cache was refilled with a page of another build drops that cache rather than serve the page', async () => {
    const w = loadWorker();
    await w.lifecycle('install');
    w.stores.clear();
    w.server.set(SCOPE, OTHER_PAGE);
    expect(await w.request('./', { mode: 'navigate' })).toBe(`network: ${OTHER_PAGE}`);
    expect([...w.stores.keys()]).toEqual([]);
  });

  it.each([
    ['the network is off', (w: ReturnType<typeof loadWorker>) => (w.net.online = false)],
    ['no room is left', (w: ReturnType<typeof loadWorker>) => (w.net.full = true)],
    ['the server lacks a file of this build', (w: ReturnType<typeof loadWorker>) => w.server.delete(`${SCOPE}assets/index-AbC.js`)],
  ])('a start whose cache lost one file, when the refill fails (%s), keeps the files the cache still has', async (_label, fail) => {
    const w = loadWorker();
    await w.lifecycle('install');
    await w.lifecycle('activate');
    w.stores.get(w.name)?.delete(`${SCOPE}manifest.webmanifest`);
    fail(w);
    expect(await w.request('./', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    // The refill was tried, failed, and stored nothing; the cache was not deleted.
    expect(w.calls.filter((c) => c.startsWith('add ')).length).toBe(8);
    expect(w.calls).not.toContain(`delete ${w.name}`);
    expect([...(w.stores.get(w.name)?.keys() ?? [])].sort()).toEqual([SCOPE, `${SCOPE}assets/index-AbC.js`, `${SCOPE}index.html`]);
    // So the next start, too, comes from the cache.
    expect(await w.request('./', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    expect(await w.request('assets/index-AbC.js')).toBe('cache: game');
  });

  it('a start whose cache lost one file drops the cache when the refill stores a page of another build over its own', async () => {
    const w = loadWorker();
    await w.lifecycle('install');
    w.stores.get(w.name)?.delete(`${SCOPE}manifest.webmanifest`);
    w.server.set(`${SCOPE}index.html`, OTHER_PAGE);
    expect(await w.request('./', { mode: 'navigate' })).toBe(`cache: ${PAGE}`);
    expect([...w.stores.keys()]).toEqual([]);
  });
});

// ---------------------------------------------------------------- the icons

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/**
 * A small PNG reader for the files src/art/tools/png.ts writes: 8-bit RGBA, not interlaced, every row
 * with filter 0. Anything else fails loudly.
 */
function decodePng(file: string | Uint8Array | undefined): DecodedPng {
  if (!(file instanceof Uint8Array)) throw new Error('not a binary file');
  const bytes = Buffer.from(file);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect([...body.subarray(8, 13)], 'bit depth 8, RGBA, deflate, filter method 0, no interlace').toEqual([8, 6, 0, 0, 0]);
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4 + 1;
  expect(raw.length).toBe(stride * height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride], `row ${y} filter`).toBe(0);
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, rgba };
}

describe('the app icons (docs/ART-AND-SOUND.md, section 11)', () => {
  const art = SPRITES.icon[0] ?? [];
  const files = new Map(iconFiles().map((f) => [f.fileName, f.source]));
  const paletteRgb = new Set(PALETTE.map((c) => c.rgb));
  const night = codeToRgb(ICON_BACKGROUND);

  it('are drawn from the 32 x 32 icon grid, and the plugin emits exactly these files', () => {
    expect(art.length).toBe(32);
    expect(art.every((row) => row.length === 32)).toBe(true);
    const emitted = runPlugin(FAKE_BUNDLE);
    for (const [name, source] of files) expect(Buffer.from(emitted.get(name) as Uint8Array).equals(Buffer.from(source as Uint8Array)), name).toBe(true);
  });

  it.each(ICONS)('$file is $size px square, every art pixel a $scale x $scale block of a palette colour, centred on night', ({ file, size, scale }) => {
    const png = decodePng(files.get(file));
    expect([png.width, png.height]).toEqual([size, size]);
    const offset = (size - 32 * scale) / 2;
    expect(Number.isInteger(offset) && offset >= 0).toBe(true);
    const found = { notOpaque: 0, notPalette: 0, notTheGridPixel: 0 };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const rgb = ((png.rgba[i] ?? 0) << 16) | ((png.rgba[i + 1] ?? 0) << 8) | (png.rgba[i + 2] ?? 0);
        if (png.rgba[i + 3] !== 255) found.notOpaque++;
        if (!paletteRgb.has(rgb)) found.notPalette++;
        // Whole-number enlargement: the pixel is exactly the grid's pixel it falls in, or night outside the art.
        const ax = Math.floor((x - offset) / scale);
        const ay = Math.floor((y - offset) / scale);
        const code = ax >= 0 && ax < 32 && ay >= 0 && ay < 32 ? (art[ay]?.charAt(ax) ?? '?') : ICON_BACKGROUND;
        if (rgb !== (code === '.' ? night : codeToRgb(code))) found.notTheGridPixel++;
      }
    }
    expect(found).toEqual({ notOpaque: 0, notPalette: 0, notTheGridPixel: 0 });
  });

  it('keep the maskable icon inside the safe zone: nothing but night outside the centred circle of 40% radius', () => {
    const { size } = ICONS.find((i) => i.file === 'icon-maskable-512.png') ?? { size: 0 };
    const png = decodePng(files.get('icon-maskable-512.png'));
    const radius = 0.4 * size;
    let outside = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const rgb = ((png.rgba[i] ?? 0) << 16) | ((png.rgba[i + 1] ?? 0) << 8) | (png.rgba[i + 2] ?? 0);
        if (rgb !== night && Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > radius) outside++;
      }
    }
    expect(outside).toBe(0);
  });
});
