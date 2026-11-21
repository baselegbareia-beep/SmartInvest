import { defineConfig } from '@playwright/test';

// A fixed port that is not Vite's default (4173), so a preview server someone
// left running by hand is never mistaken for the build under test.
const PORT = 4273;
const BASE_URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    // A phone held in landscape.
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 1,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
      args: [
        // Phaser 4 draws with WebGL. Headless Chromium has no GPU, so WebGL
        // runs on SwiftShader (software). Chromium only allows that with this
        // flag: without it WebGL still works today, but with a "fallback to
        // software WebGL has been deprecated" warning. Playwright 1.63 already
        // passes the flag by default; it is repeated here so the tests do not
        // depend on that default. No other flag is needed. If WebGL is ever
        // missing, Phaser silently falls back to its Canvas renderer, which
        // is why the smoke test asserts that the canvas has a WebGL context.
        '--enable-unsafe-swiftshader',
      ],
    },
  },

  // Always test a fresh production build, served the way it will be hosted.
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
