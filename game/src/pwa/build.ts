/**
 * The offline app's files, made at build time (docs/ARCHITECTURE.md, section 11.7; docs/ART-AND-SOUND.md,
 * section 11): the web app manifest, the four icons and the service worker.
 *
 * Node only. The offline-app plugin in vite.config.ts calls these functions, and so do the unit tests
 * (build.test.ts) and the browser tests (e2e/offline.spec.ts makes a second build's worker with them).
 * Nothing here is part of the game's bundle.
 */
import { createHash } from 'node:crypto';

import { decodeFrame, overlayFrame } from '../art/grid.ts';
import type { Frame } from '../art/grid.ts';
import { SPRITES } from '../art/sprites/index.ts';
import { encodePng } from '../art/tools/png.ts';

/** One file of the built game: its path inside dist/ (with '/' separators) and its bytes or text. */
export interface BuiltFile {
  readonly fileName: string;
  readonly source: string | Uint8Array;
}

/** One app icon: the file, its square size in pixels, and how many pixels each art pixel becomes. */
export interface IconSpec {
  readonly file: string;
  readonly size: number;
  readonly scale: number;
}

/** docs/ART-AND-SOUND.md, section 11. The art is centred; whatever it does not cover is `night`. */
export const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, scale: 6 },
  { file: 'icon-512.png', size: 512, scale: 16 },
  { file: 'icon-maskable-512.png', size: 512, scale: 12 },
  { file: 'apple-touch-icon.png', size: 180, scale: 5 },
];

/** The palette code around the art: `night`, the icon grid's own background. */
export const ICON_BACKGROUND = '1';

export const MANIFEST_FILE = 'manifest.webmanifest';
export const WORKER_FILE = 'sw.js';

/** The icon grid enlarged by a whole number and centred on a `size` x `size` square of `night`, as a grid. */
export function iconGrid(art: Frame, size: number, scale: number): Frame {
  const side = art.length * scale;
  const offset = (size - side) / 2;
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`icon: ${art.length} px x ${scale} does not centre in ${size} px`);
  const enlarged = art.flatMap((row) => {
    const wide = row.replace(/./g, (ch) => ch.repeat(scale));
    return Array.from({ length: scale }, () => wide);
  });
  const square = Array.from({ length: size }, () => ICON_BACKGROUND.repeat(size));
  return overlayFrame(square, enlarged, offset, offset);
}

/** The four icons as PNG files, drawn from the `icon` grid of src/art. */
export function iconFiles(art: Frame | undefined = SPRITES.icon[0]): BuiltFile[] {
  if (!art) throw new Error('src/art has no icon grid');
  return ICONS.map(({ file, size, scale }) => {
    const pixels = decodeFrame(iconGrid(art, size, scale));
    return { fileName: file, source: encodePng(pixels.width, pixels.height, pixels.data) };
  });
}

/**
 * manifest.webmanifest: the template with the game's name (src/meta.ts), its first word and its id filled in.
 *
 * The id is GAME_ID, not './': a browser resolves `id` against the origin, not against the manifest's
 * folder (Chromium turns './' into 'https://<owner>.github.io/'), so './' would give the game the same
 * identity as any other app on the shared origin that does the same. GAME_ID is already the name that
 * must never change once players have the game, which is what an app's id needs too.
 */
export function manifestFile(template: string, title: string, gameId: string): BuiltFile {
  const manifest = JSON.parse(template) as Record<string, unknown>;
  if (manifest.name !== '%GAME_TITLE%' || manifest.short_name !== '%SHORT_NAME%' || manifest.id !== '%GAME_ID%') {
    throw new Error('manifest.template.json: name, short_name and id must be "%GAME_TITLE%", "%SHORT_NAME%" and "%GAME_ID%"');
  }
  const named = { ...manifest, name: title, short_name: title.split(' ')[0] ?? title, id: gameId };
  return { fileName: MANIFEST_FILE, source: `${JSON.stringify(named, null, 2)}\n` };
}

/** What the worker caches: `./` (the page itself) and every emitted file but the worker, in a fixed order. */
export function precacheList(files: readonly BuiltFile[]): string[] {
  const names = files.map((f) => f.fileName).filter((name) => name !== WORKER_FILE);
  return ['./', ...names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))];
}

/**
 * A hash of the file list, every file's contents and the worker template: any change to the build
 * gives a new version, hence a new cache. 16 hex digits.
 */
export function buildVersion(template: string, files: readonly BuiltFile[]): string {
  const hash = createHash('sha256').update(template);
  const byName = new Map(files.map((f) => [f.fileName, f.source]));
  for (const name of precacheList(files).slice(1)) {
    hash.update(`\0${name}\0`).update(byName.get(name) ?? '');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Replaces the placeholder `token`, which must appear exactly once in the worker template, by a JavaScript value. */
function fill(template: string, token: string, value: unknown): string {
  const parts = template.split(token);
  if (parts.length !== 2) throw new Error(`sw.template.js must hold ${token} exactly once`);
  return parts.join(JSON.stringify(value));
}

/** sw.js: the template with the cache prefix, the version and the precache list of these files. */
export function workerFile(template: string, gameId: string, files: readonly BuiltFile[]): BuiltFile {
  let source = fill(template, `'__CACHE_PREFIX__'`, `${gameId}-`);
  source = fill(source, `'__VERSION__'`, buildVersion(template, files));
  source = fill(source, `['__PRECACHE__']`, precacheList(files));
  if (/__[A-Z_]+__/.test(source)) throw new Error('sw.template.js: a placeholder was left unfilled');
  return { fileName: WORKER_FILE, source };
}

/** The three values a built sw.js holds, read back (for the tests). */
export function workerValues(source: string): { prefix: string; version: string; precache: string[] } {
  const value = (name: string): unknown => JSON.parse(new RegExp(`^const ${name} = (.*);$`, 'm').exec(source)?.[1] ?? 'null');
  return { prefix: value('CACHE_PREFIX') as string, version: value('VERSION') as string, precache: value('PRECACHE') as string[] };
}
