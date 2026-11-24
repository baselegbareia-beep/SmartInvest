import type { E2EHook } from '../shell/e2eHook';

declare global {
  interface Window {
    /**
     * Test hook for the end-to-end tests: true once the first scene has been
     * drawn to the canvas, so a test can wait for it instead of sleeping.
     */
    __GAME_READY__?: boolean;
    /** The test hook (docs/ARCHITECTURE.md 11.6), installed only with `?e2e=1` or in a dev build. */
    __E2E__?: E2EHook;
  }
}
