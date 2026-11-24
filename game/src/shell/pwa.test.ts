import { describe, expect, it } from 'vitest';

import { WORKER_URL, registerServiceWorker } from './pwa';
import type { PwaHost } from './pwa';

/** A stand-in page: top level unless `top` is given, with a service worker container that records calls. */
function fakeHost(options: { top?: unknown; container?: 'none' | 'rejects' | 'throws' | 'reading-throws' } = {}) {
  const registered: string[] = [];
  const self = {};
  const container = {
    register(url: string): Promise<unknown> {
      registered.push(url);
      if (options.container === 'throws') throw new Error('SecurityError');
      return options.container === 'rejects' ? Promise.reject(new Error('no worker for you')) : Promise.resolve({ scope: url });
    },
  };
  const navigator =
    options.container === 'reading-throws'
      ? {
          get serviceWorker(): never {
            throw new Error('SecurityError: denied in a sandboxed frame');
          },
        }
      : { serviceWorker: options.container === 'none' ? undefined : container };
  const host: PwaHost = { self, top: 'top' in options ? options.top : self, navigator };
  return { host, registered };
}

describe('registerServiceWorker (docs/ARCHITECTURE.md 11.7)', () => {
  it('registers ./sw.js, a relative URL, in a production build at the top level', () => {
    const { host, registered } = fakeHost();
    expect(registerServiceWorker(host, true)).toBe('registering');
    expect(registered).toEqual(['./sw.js']);
    expect(WORKER_URL).toBe('./sw.js');
  });

  it('does nothing in a development build', () => {
    const { host, registered } = fakeHost();
    expect(registerServiceWorker(host, false)).toBe('development');
    expect(registered).toEqual([]);
  });

  it('does nothing inside a frame, sandboxed or not', () => {
    const framed = fakeHost({ top: {} });
    expect(registerServiceWorker(framed.host, true)).toBe('in-frame');
    expect(framed.registered).toEqual([]);
    // A sandboxed frame: reading navigator.serviceWorker would throw, but the frame test comes first.
    const sandboxed = fakeHost({ top: {}, container: 'reading-throws' });
    expect(registerServiceWorker(sandboxed.host, true)).toBe('in-frame');
  });

  it('does nothing where the browser has no service workers (not a secure context)', () => {
    const { host } = fakeHost({ container: 'none' });
    expect(registerServiceWorker(host, true)).toBe('unsupported');
  });

  it('never throws: a throwing getter, a throwing register and a rejected registration are all ignored', async () => {
    expect(registerServiceWorker(fakeHost({ container: 'reading-throws' }).host, true)).toBe('failed');
    expect(registerServiceWorker(fakeHost({ container: 'throws' }).host, true)).toBe('failed');
    const rejected = fakeHost({ container: 'rejects' });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(registerServiceWorker(rejected.host, true)).toBe('registering');
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(rejected.registered).toEqual(['./sw.js']);
    expect(unhandled).toEqual([]);
  });

  it('reads a page that cannot even be compared with its top without throwing', () => {
    const host = {
      get self(): never {
        throw new Error('cross-origin');
      },
      top: null,
      navigator: {},
    };
    expect(registerServiceWorker(host, true)).toBe('failed');
  });
});
