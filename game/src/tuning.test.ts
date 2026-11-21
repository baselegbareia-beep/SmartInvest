import { describe, expect, it } from 'vitest';

import { TILE_PX } from './core/types';
import { TUNING } from './tuning';

/**
 * Sanity checks on the numbers an owner may edit. They catch a slip of the
 * keyboard (a missing decimal point, a negative sign) before it turns into a
 * confusing failure somewhere else. They do not check feel: the levels'
 * validator tests do that.
 */

/** Every number in the table as "group.name" and its value. */
function entries(): { path: string; value: number }[] {
  // The tuning table is two levels deep and holds only numbers; this cast lets the test walk it by name.
  const groups = TUNING as unknown as Record<string, Record<string, number>>;
  return Object.entries(groups).flatMap(([group, values]) =>
    Object.entries(values).map(([name, value]) => ({ path: `${group}.${name}`, value })),
  );
}

/** The "group.name" of every entry that fails the check, so a failure names the culprit. */
function failing(check: (value: number, path: string) => boolean): string[] {
  return entries()
    .filter(({ path, value }) => !check(value, path))
    .map(({ path }) => path);
}

describe('tuning', () => {
  it('holds only finite numbers that are zero or more', () => {
    expect(failing((value) => Number.isFinite(value) && value >= 0)).toEqual([]);
  });

  it('uses whole numbers for frame counts, lives and points', () => {
    const mustBeWhole = (path: string): boolean =>
      path.endsWith('Frames') || path.startsWith('lives.') || path.startsWith('score.');
    expect(failing((value, path) => !mustBeWhole(path) || Number.isInteger(value))).toEqual([]);
  });

  it('keeps every speed below half a tile per frame, so nothing can pass through a wall', () => {
    const limit = TILE_PX / 2;
    const speeds = {
      runMaxSpeed: TUNING.run.runMaxSpeed,
      jumpVelocity: TUNING.jump.jumpVelocity,
      maxFallSpeed: TUNING.gravity.maxFallSpeed,
      jetMaxRiseSpeed: TUNING.thruster.jetMaxRiseSpeed,
      boltSpeed: TUNING.blaster.boltSpeed,
      cinderpegSpeed: TUNING.enemies.cinderpegSpeed,
      mothSpeed: TUNING.enemies.mothSpeed,
    };
    for (const [name, value] of Object.entries(speeds)) {
      expect(value, name).toBeGreaterThan(0);
      expect(value, name).toBeLessThan(limit);
    }
  });

  it('gives the hero a box that fits inside one tile and centres in it on whole pixels', () => {
    const { heroHitboxW, heroHitboxH } = TUNING.hero;
    expect(Number.isInteger(heroHitboxW)).toBe(true);
    expect(Number.isInteger(heroHitboxH)).toBe(true);
    expect(heroHitboxW).toBeGreaterThan(0);
    expect(heroHitboxW).toBeLessThanOrEqual(TILE_PX);
    expect((TILE_PX - heroHitboxW) % 2).toBe(0);
    expect(heroHitboxH).toBeGreaterThan(0);
    expect(heroHitboxH).toBeLessThanOrEqual(TILE_PX);
  });

  it('leaves the hurt box, the enemy touch box and every hazard kill box with some size', () => {
    const f = TUNING.forgiveness;
    expect(TUNING.hero.heroHitboxW - 2 * f.hurtInsetSidePx).toBeGreaterThan(0);
    expect(TUNING.hero.heroHitboxH - f.hurtInsetTopPx - f.hurtInsetBottomPx).toBeGreaterThan(0);
    expect(TILE_PX - 2 * f.enemyTouchInsetPx).toBeGreaterThan(0);
    expect(TILE_PX - 2 * f.spikeInsetSidePx).toBeGreaterThan(0);
    expect(TILE_PX - f.spikeInsetTopPx).toBeGreaterThan(0);
    expect(TILE_PX - 2 * f.fireInsetSidePx).toBeGreaterThan(0);
    expect(TILE_PX - f.fireInsetTopPx).toBeGreaterThan(0);
    expect(TILE_PX - f.coolantInsetTopPx).toBeGreaterThan(0);
    expect(TILE_PX - 2 * f.doorInsetSidePx).toBeGreaterThan(0);
  });

  it('keeps the cut speeds below the speeds they cut', () => {
    expect(TUNING.jump.jumpCutVelocity).toBeLessThan(TUNING.jump.jumpVelocity);
    expect(TUNING.thruster.jetCutSpeed).toBeLessThanOrEqual(TUNING.thruster.jetMaxRiseSpeed);
    expect(TUNING.gravity.apexHangScale).toBeGreaterThan(0);
    expect(TUNING.gravity.apexHangScale).toBeLessThanOrEqual(1);
  });

  it('lets a bolt reach at least one tile and never skip over an enemy', () => {
    const { boltSpeed, boltRangePx, boltHitboxW } = TUNING.blaster;
    expect(boltRangePx).toBeGreaterThanOrEqual(TILE_PX);
    expect(boltSpeed + TUNING.enemies.cinderpegSpeed).toBeLessThan(boltHitboxW + TILE_PX);
  });

  it('starts a run with at least one life and never more than the maximum', () => {
    expect(TUNING.lives.startLives).toBeGreaterThanOrEqual(1);
    expect(TUNING.lives.startLives).toBeLessThanOrEqual(TUNING.lives.maxLives);
  });

  it('orders the camera lines from top to bottom', () => {
    const c = TUNING.camera;
    expect(c.camAirBandTop).toBeGreaterThanOrEqual(0);
    expect(c.camAirBandTop).toBeLessThan(c.camAnchorY);
    expect(c.camAnchorY).toBeLessThan(c.camAirBandBottom);
    expect(c.camAirBandBottom).toBeLessThanOrEqual(1);
    expect(c.camVerticalEase).toBeGreaterThan(0);
    expect(c.camVerticalEase).toBeLessThanOrEqual(1);
  });

  it('orders the view limits', () => {
    const v = TUNING.view;
    expect(v.viewMinCols).toBeGreaterThan(0);
    expect(v.viewMinRows).toBeGreaterThan(0);
    expect(v.viewMinCols).toBeLessThanOrEqual(v.viewMaxCols);
    expect(v.viewMinRows).toBeLessThanOrEqual(v.viewMaxRows);
  });

  it('lets the level intro be skipped before it ends by itself', () => {
    const e = TUNING.effects;
    expect(e.introFrames).toBeGreaterThan(0);
    expect(e.introSkipAfterFrames).toBeLessThanOrEqual(e.introFrames);
    expect(e.shakeLandMinFallTiles).toBeGreaterThan(0);
  });

  it('keeps every touch button inside the zone that feeds it', () => {
    const t = TUNING.touch;
    expect(2 * t.moveButtonSize + t.moveButtonGap + t.moveMarginSide).toBeLessThanOrEqual(t.moveZoneWidth);
    expect(t.moveButtonSize + t.moveMarginBottom).toBeLessThanOrEqual(t.moveZoneHeight);
    expect(t.jumpButtonSize + t.jumpMarginSide).toBeLessThanOrEqual(t.actionZoneSize);
    expect(t.fireButtonSize + t.fireMarginSide).toBeLessThanOrEqual(t.actionZoneSize);
    expect(t.thrustButtonSize + t.thrustMarginBottom).toBeLessThanOrEqual(t.actionZoneSize);
    expect(t.pauseButtonSize).toBeLessThanOrEqual(t.pauseHitSize);
    expect(t.opacityDimmed).toBeLessThan(t.opacityIdle);
    expect(t.opacityIdle).toBeLessThan(t.opacityPressed);
    expect(t.opacityPressed).toBeLessThanOrEqual(1);
  });
});
