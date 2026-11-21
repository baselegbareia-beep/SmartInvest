import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * A sanity check of the placeholder test room. The real level validator
 * (reachability of the trophy and the door by search over the core step
 * function) arrives with the levels.
 */
const rows = readFileSync(new URL('../levels/test.txt', import.meta.url), 'utf8').trimEnd().split('\n');

describe('levels/test.txt', () => {
  it('is a rectangle of at least 30 by 12 tiles', () => {
    const width = rows[0]?.length ?? 0;
    expect(width).toBeGreaterThanOrEqual(30);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.every((row) => row.length === width)).toBe(true);
  });

  it('is closed by walls on every side', () => {
    expect(rows[0]).toMatch(/^#+$/);
    expect(rows.at(-1)).toMatch(/^#+$/);
    expect(rows.every((row) => row.startsWith('#') && row.endsWith('#'))).toBe(true);
  });

  it('has exactly one player start', () => {
    expect(rows.join('').split('P').length - 1).toBe(1);
  });
});
