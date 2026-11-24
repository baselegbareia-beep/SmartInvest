import { describe, expect, it } from 'vitest';

import { keyEndsTouchMode } from './lifecycle';

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('keyEndsTouchMode', () => {
  it('a key the game is played with hides the pad: arrows, letters, Space, Esc, and Shift (THRUST)', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'a', 'x', 'z', 'Escape', 'p', 'm', 'Shift', 'Enter']) {
      expect(keyEndsTouchMode(key(k)), k).toBe(true);
    }
  });

  it('the system keys and shortcuts made with them leave it alone (Cmd-Tab on a tablet keyboard)', () => {
    for (const k of ['Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'OS']) expect(keyEndsTouchMode(key(k)), k).toBe(false);
    expect(keyEndsTouchMode(key('Tab', { metaKey: true }))).toBe(false);
    expect(keyEndsTouchMode(key('r', { ctrlKey: true }))).toBe(false);
    expect(keyEndsTouchMode(key('ArrowLeft', { altKey: true }))).toBe(false);
  });
});
