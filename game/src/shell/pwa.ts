/**
 * Registers the offline app's service worker (docs/ARCHITECTURE.md, section 11.7). main.ts calls
 * `registerServiceWorker()` once, after the game is created.
 *
 * - Only in a production build: the dev server has no sw.js.
 * - Never inside a frame: a preview pane or another page must not install the game on its origin.
 * - Everything inside one try / catch: in a sandboxed frame merely reading `navigator.serviceWorker`
 *   throws, as `localStorage` does (the frame test is first, but nothing here may ever stop the game).
 * - A relative URL, './sw.js': the worker's scope is the game's own folder, never the site's root.
 * - A failed registration is ignored: the game then simply needs the network, as any web page does.
 */

/** The relative address of the worker the build writes beside index.html. */
export const WORKER_URL = './sw.js';

/** What registration reads from the page: `window` in the game, a stand-in in the unit test. */
export interface PwaHost {
  readonly self: unknown;
  readonly top: unknown;
  readonly navigator: { readonly serviceWorker?: { register(url: string): Promise<unknown> } | undefined };
}

/** Why the worker was or was not asked for: the unit test reads it, the game ignores it. */
export type PwaOutcome = 'registering' | 'development' | 'in-frame' | 'unsupported' | 'failed';

export function registerServiceWorker(host: PwaHost = window, production: boolean = import.meta.env.PROD): PwaOutcome {
  try {
    if (!production) return 'development';
    if (host.self !== host.top) return 'in-frame';
    // Undefined on a page that is not a secure context (plain http outside localhost) and in old browsers.
    const container = host.navigator.serviceWorker;
    if (!container) return 'unsupported';
    container.register(WORKER_URL).catch(() => undefined);
    return 'registering';
  } catch {
    return 'failed';
  }
}
