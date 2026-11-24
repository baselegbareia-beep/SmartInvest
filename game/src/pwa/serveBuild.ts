/**
 * A small static server for the browser tests of the offline app (e2e/offline.spec.ts, e2e/subpath.spec.ts):
 * it serves a built dist/ folder under any path prefix, on a free port, and records every path asked for.
 * Node only; never part of the game.
 *
 * It answers as GitHub Pages does in the ways the tests depend on: `Access-Control-Allow-Origin: *` on
 * every file (a sandboxed frame's module scripts are fetched with CORS from origin "null"), a folder's
 * address serves its index.html, and anything else outside the files is a 404. Two HTTP cache modes:
 * - 'no-cache' (the default): every answer says `Cache-Control: no-cache`, so the browser asks again each
 *   time and a test sees each request.
 * - 'pages': as GitHub Pages, `Cache-Control: max-age=600` and an ETag, with a 304 when the browser's
 *   `If-None-Match` names the current file. The browser may then reuse a file for 10 minutes without asking.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import type { BuiltFile } from './build.ts';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/**
 * Files that replace (or add to) a folder's files, by their path inside dist/: a second build without
 * building again. `null` removes a file: it answers 404, as a file a deploy deleted.
 */
export type Overlay = ReadonlyMap<string, string | Uint8Array | null>;

export interface ServeOptions {
  /** Extra HTML pages by their full path, such as a page that holds the game in a frame, or another site. */
  readonly pages?: Readonly<Record<string, string>>;
  /** More prefixes that serve the same folder, each through its own overlay: copies of the game elsewhere on the origin. */
  readonly copies?: Readonly<Record<string, Overlay>>;
  /** 'no-cache' (the default) or 'pages' (see the top of this file). */
  readonly httpCache?: 'no-cache' | 'pages';
}

export interface BuildServer {
  /** The origin, such as `http://127.0.0.1:41234` (no trailing slash). */
  readonly origin: string;
  /** Where the build is served: origin + prefix. */
  readonly url: string;
  /** Every request path (with its query) in the order it arrived. */
  readonly requests: string[];
  /** The overlay of the main prefix (see `Overlay`). */
  overlay: Overlay;
  close(): Promise<void>;
}

/** The dist/ folder under test: GAME_DIST when set, else game/dist (what the project's own test run builds). */
export function distFolder(): string {
  return process.env.GAME_DIST ?? path.join(import.meta.dirname, '..', '..', 'dist');
}

/** Every file of a built folder, with '/' separators, as the build emitted them. */
export function readBuild(root: string): BuiltFile[] {
  const files: BuiltFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ fileName: path.relative(root, full).split(path.sep).join('/'), source: readFileSync(full) });
    }
  };
  walk(root);
  return files;
}

/** Serves `folder` at `prefix` (which starts and ends with '/'), plus the copies and pages of `options`. */
export async function serveBuild(folder: string, prefix = '/', options: ServeOptions = {}): Promise<BuildServer> {
  const root = path.resolve(folder);
  const requests: string[] = [];
  const pages = options.pages ?? {};
  const mounts = new Map<string, Overlay>([[prefix, new Map()], ...Object.entries(options.copies ?? {})]);
  // Longest prefix first, so that a copy inside the main folder is found before it.
  const prefixes = [...mounts.keys()].sort((a, b) => b.length - a.length);

  /** The body of a path, or undefined for a 404. */
  const find = (pathname: string): { body: string | Uint8Array; type: string } | undefined => {
    const page = pages[pathname];
    if (page !== undefined) return { body: page, type: TYPES['.html'] ?? '' };
    const at = prefixes.find((p) => pathname.startsWith(p));
    if (at === undefined) return undefined;
    let inner = pathname.slice(at.length);
    if (inner === '' || inner.endsWith('/')) inner += 'index.html';
    const full = path.join(root, inner);
    if (!full.startsWith(root + path.sep)) return undefined;
    let body = mounts.get(at)?.get(inner);
    if (body === null) return undefined;
    if (body === undefined) {
      try {
        body = statSync(full).isFile() ? readFileSync(full) : undefined;
      } catch {
        body = undefined;
      }
    }
    return body === undefined ? undefined : { body, type: TYPES[path.extname(inner)] ?? 'application/octet-stream' };
  };

  const server = createServer((req, res) => {
    const asked = req.url ?? '/';
    requests.push(asked);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const file = find(decodeURIComponent(new URL(asked, 'http://host').pathname));
    if (file === undefined) {
      res.setHeader('Cache-Control', 'no-cache');
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', file.type);
    if (options.httpCache === 'pages') {
      const etag = `"${createHash('sha256').update(file.body).digest('hex').slice(0, 16)}"`;
      res.setHeader('Cache-Control', 'max-age=600');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        res.end();
        return;
      }
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closing: Promise<void> | undefined;
  return {
    origin,
    url: origin + prefix,
    requests,
    get overlay() {
      return mounts.get(prefix) ?? new Map();
    },
    set overlay(files) {
      mounts.set(prefix, files);
    },
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      })),
  };
}
