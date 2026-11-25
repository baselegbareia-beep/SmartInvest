import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { GAME_ID, GAME_TITLE } from './src/meta.ts';
import { MANIFEST_FILE, iconFiles, manifestFile, workerFile } from './src/pwa/build.ts';
import type { BuiltFile } from './src/pwa/build.ts';

const PWA_DIR = path.join(import.meta.dirname, 'src', 'pwa');
const readTemplate = (name: string): string => readFileSync(path.join(PWA_DIR, name), 'utf8');

/**
 * The offline app (docs/ARCHITECTURE.md, section 11.7). After the bundle is complete it adds the web app
 * manifest and the four icons, then sw.js, whose precache list and version cover every file emitted.
 * In the dev server it serves the manifest and the icons (there is no worker in development).
 */
export function offlineApp(): Plugin {
  const appFiles = (): BuiltFile[] => [manifestFile(readTemplate('manifest.template.json'), GAME_TITLE, GAME_ID), ...iconFiles()];
  return {
    name: 'offline-app',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = path.posix.basename(new URL(req.url ?? '/', 'http://dev').pathname);
        const file = name.endsWith('.png') || name === MANIFEST_FILE ? appFiles().find((f) => f.fileName === name) : undefined;
        if (!file) {
          next();
          return;
        }
        res.setHeader('Content-Type', name === MANIFEST_FILE ? 'application/manifest+json' : 'image/png');
        res.end(file.source);
      });
    },
    generateBundle: {
      // After every other plugin's generateBundle, so the version hashes the files as they are written.
      order: 'post',
      handler(_options, bundle) {
        const own = appFiles();
        for (const file of own) this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
        const emitted = Object.values(bundle)
          .filter((out) => !own.some((f) => f.fileName === out.fileName))
          .map((out): BuiltFile => ({ fileName: out.fileName, source: out.type === 'chunk' ? out.code : out.source }));
        const worker = workerFile(readTemplate('sw.template.js'), GAME_ID, [...emitted, ...own]);
        this.emitFile({ type: 'asset', fileName: worker.fileName, source: worker.source });
      },
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the built game runs from any sub-path
  // (GitHub Pages serves it from /<repository>/game/).
  base: './',
  plugins: [
    {
      // index.html says %GAME_TITLE% so that the name lives only in src/meta.ts.
      name: 'html-game-title',
      transformIndexHtml: (html) => html.replaceAll('%GAME_TITLE%', GAME_TITLE),
    },
    offlineApp(),
  ],
  build: {
    // Main chunk, 25 Nov 2026: Phaser 1,367 kB + the game 262 kB = 1,630 kB minified; kept whole, as the game needs all of it to start.
    chunkSizeWarningLimit: 1700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
