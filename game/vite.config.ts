import { defineConfig } from 'vitest/config';

import { GAME_TITLE } from './src/meta.ts';

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
  ],
  build: {
    // Phaser is one large pre-bundled module (about 1.4 MB minified), far above Vite's 500 kB default.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
