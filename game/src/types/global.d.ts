export {};

declare global {
  interface Window {
    /**
     * Test hook for the end-to-end tests: true once the first scene has been
     * drawn to the canvas, so a test can wait for it instead of sleeping.
     */
    __GAME_READY__?: boolean;
  }
}
