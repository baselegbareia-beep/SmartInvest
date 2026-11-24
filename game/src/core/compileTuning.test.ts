import { describe, expect, it } from 'vitest';

import { TUNING } from '../tuning';
import { compileTuning, TuningError } from './compileTuning';
import { DISTINCT_PHYS, REFERENCE_PHYS, REFERENCE_TUNING } from './testkit';
import { SUB } from './types';
import type { Phys, Tuning } from './types';

/**
 * The table of docs/ARCHITECTURE.md, section 3, row by row: which Phys fields
 * each number of the tuning feeds. `step` is a change that keeps the tuning
 * valid, used to prove that the number reaches exactly those fields.
 */
interface Row {
  readonly path: string;
  readonly feeds: readonly (keyof Phys)[];
  /** 'px': rounded to 1/256 px. 'copy': copied as it is. 'scale': the apex hang factor. */
  readonly kind: 'px' | 'copy' | 'scale';
  readonly step: number;
}

const px = (path: string, feeds: readonly (keyof Phys)[], step = 1 / SUB): Row => ({ path, feeds, kind: 'px', step });
const copy = (path: string, feeds: readonly (keyof Phys)[], step = 1): Row => ({ path, feeds, kind: 'copy', step });

const TABLE: readonly Row[] = [
  px('hero.heroHitboxW', ['heroW'], -2),
  px('hero.heroHitboxH', ['heroH'], -1),
  px('run.runMaxSpeed', ['runMax']),
  px('run.groundAccel', ['groundAccel']),
  px('run.groundDecel', ['groundDecel']),
  px('run.groundTurnAccel', ['groundTurn']),
  px('run.airAccel', ['airAccel']),
  px('run.airDecel', ['airDecel']),
  px('run.airTurnAccel', ['airTurn']),
  px('jump.jumpVelocity', ['jumpVel']),
  px('jump.jumpCutVelocity', ['jumpCutVel']),
  // Gravity also feeds its hang variant; a step of 2/256 px moves the halved value by a whole sub-pixel.
  px('gravity.gravityRise', ['gravRise', 'gravRiseHang'], 2 / SUB),
  px('gravity.gravityFall', ['gravFall', 'gravFallHang'], 2 / SUB),
  px('gravity.apexHangSpeed', ['apexHangSpeed']),
  { path: 'gravity.apexHangScale', feeds: ['gravRiseHang', 'gravFallHang'], kind: 'scale', step: 0.25 },
  px('gravity.maxFallSpeed', ['maxFall']),
  copy('forgiveness.coyoteFrames', ['coyoteTicks']),
  copy('forgiveness.jumpBufferFrames', ['jumpBufferTicks']),
  px('forgiveness.cornerNudgePx', ['cornerNudge']),
  px('forgiveness.ledgeCatchPx', ['ledgeCatch']),
  px('forgiveness.hurtInsetSidePx', ['hurtInsetSide']),
  px('forgiveness.hurtInsetTopPx', ['hurtInsetTop']),
  px('forgiveness.hurtInsetBottomPx', ['hurtInsetBottom']),
  px('forgiveness.spikeInsetSidePx', ['spikeInsetSide']),
  px('forgiveness.spikeInsetTopPx', ['spikeInsetTop']),
  px('forgiveness.fireInsetSidePx', ['fireInsetSide']),
  px('forgiveness.fireInsetTopPx', ['fireInsetTop']),
  px('forgiveness.coolantInsetTopPx', ['coolantInsetTop']),
  px('forgiveness.enemyTouchInsetPx', ['enemyTouchInset']),
  px('forgiveness.pickupOutsetPx', ['pickupOutset']),
  px('forgiveness.doorInsetSidePx', ['doorInsetSide']),
  px('thruster.jetAccel', ['thrustAccel']),
  px('thruster.jetMaxRiseSpeed', ['thrustMaxRise']),
  px('thruster.jetCutSpeed', ['thrustCutVel']),
  copy('thruster.jetFuelFrames', ['fuelTicks']),
  px('blaster.boltSpeed', ['boltSpeed']),
  px('blaster.boltRangePx', ['boltRange']),
  px('blaster.boltHitboxW', ['boltW']),
  px('blaster.boltHitboxH', ['boltH']),
  copy('blaster.fireBufferFrames', ['fireBufferTicks']),
  px('enemies.cinderpegSpeed', ['cinderpegSpeed']),
  px('enemies.mothSpeed', ['mothSpeed']),
  copy('timing.hitStopFrames', ['dyingTicks']),
  copy('timing.deathAnimFrames', ['dyingTicks']),
  copy('timing.fadeFrames', ['dyingTicks', 'respawnReadyTicks']),
  copy('timing.readyMinFrames', ['respawnReadyTicks', 'readyMinTicks']),
  copy('timing.exitFrames', ['exitTicks']),
  // One life less, not one more: startLives may not pass maxLives.
  copy('lives.startLives', ['startLives'], -1),
  copy('lives.maxLives', ['maxLives']),
  copy('lives.livesPerLevelClear', ['livesPerLevelClear']),
  copy('score.crystal', ['scoreCrystal']),
  copy('score.cog', ['scoreCog']),
  copy('score.cinderpeg', ['scoreCinderpeg']),
  copy('score.arcMoth', ['scoreMoth']),
  copy('score.levelClear', ['scoreLevelClear']),
  copy('score.lifeLeft', ['scoreLifeLeft']),
];

/** The eleven groups compileTuning reads; the other five belong to the shell. */
const CORE_GROUPS = [
  'hero',
  'run',
  'jump',
  'gravity',
  'forgiveness',
  'thruster',
  'blaster',
  'enemies',
  'timing',
  'lives',
  'score',
] as const;
const SHELL_GROUPS = ['camera', 'view', 'touch', 'effects', 'pacing'] as const;

type Groups = Record<string, Record<string, number>>;

/** The tuning as a plain two-level table of numbers, so a test can reach a number by its "group.name". */
function asGroups(tuning: Tuning): Groups {
  // Tuning is exactly that shape (groups of numbers); the cast only drops the field names.
  return tuning as unknown as Groups;
}

function read(tuning: Tuning, path: string): number {
  const [group = '', name = ''] = path.split('.');
  const value = asGroups(tuning)[group]?.[name];
  if (value === undefined) throw new Error(`no tuning number called ${path}`);
  return value;
}

/** A copy of the reference tuning with the numbers named by "group.name" replaced. */
function withValues(patch: Readonly<Record<string, number>>, base: Tuning = REFERENCE_TUNING): Tuning {
  const groups: Groups = {};
  for (const [group, values] of Object.entries(asGroups(base))) groups[group] = { ...values };
  for (const [path, value] of Object.entries(patch)) {
    const [group = '', name = ''] = path.split('.');
    const target = groups[group];
    if (target === undefined || !(name in target)) throw new Error(`no tuning number called ${path}`);
    target[name] = value;
  }
  // Same shape as before, so it is a Tuning again.
  return groups as unknown as Tuning;
}

/** The problems compileTuning reports for a tuning; empty when it compiles. */
function problemsOf(tuning: Tuning): readonly string[] {
  try {
    compileTuning(tuning);
  } catch (error) {
    if (error instanceof TuningError) return error.problems;
    throw error;
  }
  return [];
}

/** A sorted copy, by code unit: the same order on every machine. */
function sorted(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The Phys fields that differ between two compilations, sorted by name. */
function changedFields(a: Phys, b: Phys): string[] {
  return sorted(Object.keys(a).filter((key) => a[key as keyof Phys] !== b[key as keyof Phys]));
}

describe('compileTuning: the table of section 3', () => {
  it('lists every number of the eleven core groups, so a new number cannot be forgotten', () => {
    const inTuning = CORE_GROUPS.flatMap((group) => Object.keys(REFERENCE_TUNING[group]).map((name) => `${group}.${name}`));
    expect(sorted(TABLE.map((row) => row.path))).toEqual(sorted(inTuning));
  });

  it('fills every Phys field from the table and nothing else', () => {
    const fed = new Set(TABLE.flatMap((row) => row.feeds));
    expect(sorted([...fed])).toEqual(sorted(Object.keys(REFERENCE_PHYS)));
  });

  it('rounds a px value to sub(px) = round(px * 256) and copies frames, lives and points', () => {
    for (const row of TABLE) {
      const value = read(REFERENCE_TUNING, row.path);
      const [field] = row.feeds;
      if (field === undefined) throw new Error(`${row.path} feeds nothing`);
      if (row.kind === 'px') expect(REFERENCE_PHYS[field], row.path).toBe(Math.round(value * SUB));
      // Sums (dyingTicks, respawnReadyTicks) are checked by name below.
      if (row.kind === 'copy' && row.feeds.length === 1 && !row.path.startsWith('timing.')) {
        expect(REFERENCE_PHYS[field], row.path).toBe(value);
      }
    }
  });

  it('sends each number to exactly the Phys fields the table names', () => {
    for (const row of TABLE) {
      const changed = compileTuning(withValues({ [row.path]: read(REFERENCE_TUNING, row.path) + row.step }));
      expect(changedFields(REFERENCE_PHYS, changed), row.path).toEqual(sorted(row.feeds));
      for (const field of row.feeds) {
        const moved = changed[field] - REFERENCE_PHYS[field];
        if (row.kind === 'copy') expect(moved, `${row.path} -> ${field}`).toBe(row.step);
        if (row.kind === 'px' && !field.endsWith('Hang')) {
          expect(moved, `${row.path} -> ${field}`).toBe(Math.round(row.step * SUB));
        }
      }
    }
  });

  it('builds the hang gravities as sub(gravity * apexHangScale)', () => {
    const { gravityRise, gravityFall, apexHangScale } = REFERENCE_TUNING.gravity;
    expect(REFERENCE_PHYS.gravRiseHang).toBe(Math.round(gravityRise * apexHangScale * SUB));
    expect(REFERENCE_PHYS.gravFallHang).toBe(Math.round(gravityFall * apexHangScale * SUB));
    const noHang = compileTuning(withValues({ 'gravity.apexHangScale': 1 }));
    expect(noHang.gravRiseHang).toBe(noHang.gravRise);
    expect(noHang.gravFallHang).toBe(noHang.gravFall);
  });

  it('adds up the frozen phases: dying = hit stop + animation + fade, respawn ready = fade + ready minimum', () => {
    const t = REFERENCE_TUNING.timing;
    expect(REFERENCE_PHYS.dyingTicks).toBe(t.hitStopFrames + t.deathAnimFrames + t.fadeFrames);
    expect(REFERENCE_PHYS.respawnReadyTicks).toBe(t.fadeFrames + t.readyMinFrames);
    expect(REFERENCE_PHYS.readyMinTicks).toBe(t.readyMinFrames);
    expect(REFERENCE_PHYS.exitTicks).toBe(t.exitFrames);
  });

  it('gives the reference numbers the golden values the other tests are written on', () => {
    expect(REFERENCE_PHYS).toMatchObject({
      heroW: 2560,
      heroH: 3584,
      runMax: 384,
      groundAccel: 64,
      groundDecel: 96,
      groundTurn: 128,
      airAccel: 48,
      airDecel: 48,
      airTurn: 80,
      jumpVel: 1280,
      jumpCutVel: 384,
      gravRise: 64,
      gravFall: 112,
      gravRiseHang: 32,
      gravFallHang: 56,
      apexHangSpeed: 128,
      maxFall: 1024,
      coyoteTicks: 6,
      jumpBufferTicks: 7,
      cornerNudge: 1024,
      ledgeCatch: 768,
      thrustAccel: 96,
      thrustMaxRise: 448,
      thrustCutVel: 128,
      fuelTicks: 80,
      dyingTicks: 52,
      respawnReadyTicks: 22,
      readyMinTicks: 12,
      exitTicks: 60,
    } satisfies Partial<Phys>);
  });

  it('DISTINCT_PHYS (testkit) gives every Phys field a value at least 2 away from every other: a test on it can tell twin fields apart', () => {
    const names = Object.keys(DISTINCT_PHYS) as (keyof Phys)[];
    const entries = names.map((name) => [name, DISTINCT_PHYS[name]] as const).sort((a, b) => a[1] - b[1]);
    expect(entries).toHaveLength(Object.keys(REFERENCE_PHYS).length);
    const tooClose: string[] = [];
    for (let i = 1; i < entries.length; i++) {
      const [lowName, low] = entries[i - 1] ?? ['', 0];
      const [highName, high] = entries[i] ?? ['', 0];
      if (high - low < 2) tooClose.push(`${lowName} ${low} and ${highName} ${high}`);
    }
    expect(tooClose).toEqual([]);
    // The reference numbers do have twins: that is why DISTINCT_PHYS exists.
    expect(REFERENCE_PHYS.airAccel).toBe(REFERENCE_PHYS.airDecel);
    expect(REFERENCE_PHYS.thrustAccel).toBe(REFERENCE_PHYS.groundDecel);
  });

  it('makes every Phys field an integer', () => {
    for (const [name, value] of Object.entries(REFERENCE_PHYS)) {
      expect(Number.isInteger(value), name).toBe(true);
    }
  });

  it('rounds a value that is not a multiple of 1/256 px to the nearest sub-pixel (the handicap run speed 364.8 becomes 365)', () => {
    const run = REFERENCE_TUNING.run.runMaxSpeed * 0.95;
    expect(run * SUB).toBeCloseTo(364.8, 6);
    expect(compileTuning(withValues({ 'run.runMaxSpeed': run })).runMax).toBe(365);
    expect(compileTuning(withValues({ 'forgiveness.cornerNudgePx': 3.999 })).cornerNudge).toBe(1024);
    expect(compileTuning(withValues({ 'forgiveness.cornerNudgePx': 3.997 })).cornerNudge).toBe(1023);
  });

  it('ignores the shell-only groups (camera, view, touch, effects, pacing), whatever they hold', () => {
    const patch: Record<string, number> = {};
    for (const group of SHELL_GROUPS) {
      for (const name of Object.keys(REFERENCE_TUNING[group])) patch[`${group}.${name}`] = Number.NaN;
    }
    expect(compileTuning(withValues(patch))).toEqual(REFERENCE_PHYS);
  });

  it('returns a frozen Phys: it is shared by every clone of the game, so nothing may write to it', () => {
    expect(Object.isFrozen(compileTuning(REFERENCE_TUNING))).toBe(true);
  });

  it('does not change the tuning it is given, and gives equal results for equal input', () => {
    const before = JSON.stringify(REFERENCE_TUNING);
    expect(compileTuning(REFERENCE_TUNING)).toEqual(REFERENCE_PHYS);
    expect(JSON.stringify(REFERENCE_TUNING)).toBe(before);
  });
});

describe('compileTuning: accepted edge values', () => {
  const accepted: readonly (readonly [why: string, patch: Record<string, number>])[] = [
    ['no coyote time and no jump buffer (the comfort handicap)', { 'forgiveness.coyoteFrames': 0, 'forgiveness.jumpBufferFrames': 0 }],
    ['no corner nudge and no ledge catch', { 'forgiveness.cornerNudgePx': 0, 'forgiveness.ledgeCatchPx': 0 }],
    ['no insets at all', { 'forgiveness.hurtInsetSidePx': 0, 'forgiveness.hurtInsetTopPx': 0, 'forgiveness.hurtInsetBottomPx': 0, 'forgiveness.enemyTouchInsetPx': 0, 'forgiveness.doorInsetSidePx': 0 }],
    ['a hero as large as a tile', { 'hero.heroHitboxW': 16, 'hero.heroHitboxH': 16 }],
    ['a thrust cut speed equal to the top thrust speed', { 'thruster.jetCutSpeed': REFERENCE_TUNING.thruster.jetMaxRiseSpeed }],
    ['an apex hang scale of exactly 1 (hang switched off)', { 'gravity.apexHangScale': 1 }],
    ['a run speed one sub-pixel below half a tile', { 'run.runMaxSpeed': 2047 / SUB }],
    ['a fall speed one sub-pixel below half a tile', { 'gravity.maxFallSpeed': 2047 / SUB }],
    ['a single life', { 'lives.startLives': 1, 'lives.maxLives': 1 }],
    ['an empty tank size and no fire buffer', { 'thruster.jetFuelFrames': 0, 'blaster.fireBufferFrames': 0 }],
  ];
  for (const [why, patch] of accepted) {
    it(`accepts ${why}`, () => {
      expect(problemsOf(withValues(patch))).toEqual([]);
    });
  }
});

describe('compileTuning: every unsafe value is rejected by name', () => {
  /** Exactly one problem, and it names the number to change. */
  function expectOne(patch: Record<string, number>, ...names: string[]): void {
    const problems = problemsOf(withValues(patch));
    expect(problems, JSON.stringify(patch)).toHaveLength(1);
    for (const name of names) expect(problems[0]).toContain(name);
  }

  it('rejects a negative number, NaN and infinity in any core group', () => {
    for (const row of TABLE) {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const problems = problemsOf(withValues({ [row.path]: bad }));
        expect(problems.length, `${row.path} = ${bad}`).toBeGreaterThan(0);
        expect(problems[0], `${row.path} = ${bad}`).toContain(row.path);
        expect(problems[0]).toContain('finite number, zero or more');
      }
    }
  });

  it('rejects a frame count, a lives value or a score that is not a whole number', () => {
    const whole = TABLE.filter((row) => row.kind === 'copy');
    // 9 frame counts, 3 lives values, 6 scores.
    expect(whole).toHaveLength(18);
    for (const row of whole) {
      const problems = problemsOf(withValues({ [row.path]: read(REFERENCE_TUNING, row.path) + 0.5 }));
      expect(problems, row.path).toHaveLength(1);
      expect(problems[0]).toContain(row.path);
      expect(problems[0]).toContain('whole number');
    }
  });

  const SPEEDS = [
    'run.runMaxSpeed',
    'jump.jumpVelocity',
    'gravity.maxFallSpeed',
    'thruster.jetMaxRiseSpeed',
    'blaster.boltSpeed',
    'enemies.cinderpegSpeed',
    'enemies.mothSpeed',
  ];

  it('rejects a speed of 0', () => {
    for (const path of SPEEDS) {
      const problems = problemsOf(withValues({ [path]: 0 }));
      expect(problems.some((p) => p.startsWith(`${path} is 0: a speed must be above 0`)), path).toBe(true);
    }
  });

  it('rejects a speed of 8 px per frame (half a tile) or more, and accepts one sub-pixel less', () => {
    for (const path of SPEEDS) {
      for (const tooFast of [8, 8.5, 12]) {
        const problems = problemsOf(withValues({ [path]: tooFast }));
        expect(problems.some((p) => p.startsWith(`${path} is ${tooFast}:`) && p.includes('half a tile')), `${path} = ${tooFast}`).toBe(true);
      }
      const justBelow = problemsOf(withValues({ [path]: 2047 / SUB }));
      expect(justBelow.filter((p) => p.includes('half a tile')), path).toEqual([]);
    }
  });

  it('judges a speed by its rounded value: 7.999 px per frame rounds to half a tile and is rejected', () => {
    expectOne({ 'run.runMaxSpeed': 7.999 }, 'run.runMaxSpeed', 'half a tile');
    expectOne({ 'enemies.mothSpeed': 0.001 }, 'enemies.mothSpeed', 'above 0');
  });

  it('rejects a hero box that is not a whole number of px', () => {
    expectOne({ 'hero.heroHitboxW': 10.5 }, 'hero.heroHitboxW', 'whole number of px');
    expectOne({ 'hero.heroHitboxH': 13.5 }, 'hero.heroHitboxH', 'whole number of px');
  });

  it('rejects a hero box larger than a tile', () => {
    expectOne({ 'hero.heroHitboxW': 18 }, 'hero.heroHitboxW', 'at most 16 px');
    expectOne({ 'hero.heroHitboxH': 17 }, 'hero.heroHitboxH', 'at most 16 px');
  });

  it('rejects a hero width that cannot be centred in a tile on whole pixels (16 - width is odd)', () => {
    expectOne({ 'hero.heroHitboxW': 11 }, 'hero.heroHitboxW', 'must be even');
  });

  it('rejects a hurt box with no size', () => {
    const { heroHitboxW, heroHitboxH } = REFERENCE_TUNING.hero;
    expectOne({ 'forgiveness.hurtInsetSidePx': heroHitboxW / 2 }, 'forgiveness.hurtInsetSidePx', 'hurt box has no width');
    expectOne(
      { 'forgiveness.hurtInsetTopPx': heroHitboxH - REFERENCE_TUNING.forgiveness.hurtInsetBottomPx },
      'forgiveness.hurtInsetTopPx',
      'forgiveness.hurtInsetBottomPx',
      'hurt box has no height',
    );
  });

  it('rejects an enemy touch box, a hazard kill box or a door box with no size', () => {
    expectOne({ 'forgiveness.enemyTouchInsetPx': 8 }, 'forgiveness.enemyTouchInsetPx', 'enemy touch box has no size');
    expectOne({ 'forgiveness.spikeInsetSidePx': 8 }, 'forgiveness.spikeInsetSidePx', 'spikes kill box has no size');
    expectOne({ 'forgiveness.spikeInsetTopPx': 16 }, 'forgiveness.spikeInsetTopPx', 'spikes kill box has no size');
    expectOne({ 'forgiveness.fireInsetSidePx': 8 }, 'forgiveness.fireInsetSidePx', 'fire kill box has no size');
    expectOne({ 'forgiveness.fireInsetTopPx': 16 }, 'forgiveness.fireInsetTopPx', 'fire kill box has no size');
    expectOne({ 'forgiveness.coolantInsetTopPx': 16 }, 'forgiveness.coolantInsetTopPx', 'coolant kill box has no size');
    expectOne({ 'forgiveness.doorInsetSidePx': 8 }, 'forgiveness.doorInsetSidePx', 'door box has no size');
    // One sub-pixel of box is enough.
    expect(problemsOf(withValues({ 'forgiveness.doorInsetSidePx': 8 - 1 / SUB }))).toEqual([]);
  });

  it('rejects a bolt box with no size: one lying exactly on a row or column line would cover no cell and fly through walls', () => {
    expectOne({ 'blaster.boltHitboxW': 0 }, 'blaster.boltHitboxW', 'bolt box has no size');
    expectOne({ 'blaster.boltHitboxH': 0 }, 'blaster.boltHitboxH', 'bolt box has no size');
    // Judged after rounding: less than half a sub-pixel is nothing.
    expectOne({ 'blaster.boltHitboxH': 1 / 1024 }, 'blaster.boltHitboxH', 'bolt box has no size');
    // One sub-pixel of box is enough.
    expect(problemsOf(withValues({ 'blaster.boltHitboxW': 1 / SUB, 'blaster.boltHitboxH': 1 / SUB }))).toEqual([]);
  });

  it('rejects a bolt box wider or taller than the hero box: the bolt must start inside the hero, never inside a wall', () => {
    const { heroHitboxW, heroHitboxH } = REFERENCE_TUNING.hero;
    expectOne({ 'blaster.boltHitboxW': heroHitboxW + 1 / SUB }, 'blaster.boltHitboxW', 'fit inside the hero box', 'hero.heroHitboxW');
    expectOne({ 'blaster.boltHitboxH': heroHitboxH + 1 / SUB }, 'blaster.boltHitboxH', 'fit inside the hero box', 'hero.heroHitboxH');
    // A smaller hero makes the same bolt too large.
    expectOne({ 'hero.heroHitboxW': 6 }, 'blaster.boltHitboxW', 'at most hero.heroHitboxW, 6');
    // Exactly the hero's size fits.
    expect(problemsOf(withValues({ 'blaster.boltHitboxW': heroHitboxW, 'blaster.boltHitboxH': heroHitboxH }))).toEqual([]);
  });

  it('rejects a jump cut speed that is not below the jump speed', () => {
    const jump = REFERENCE_TUNING.jump.jumpVelocity;
    expectOne({ 'jump.jumpCutVelocity': jump }, 'jump.jumpCutVelocity', 'below jump.jumpVelocity');
    expectOne({ 'jump.jumpCutVelocity': jump + 1 }, 'jump.jumpCutVelocity', 'below jump.jumpVelocity');
  });

  it('rejects a thrust cut speed above the top thrust speed', () => {
    const top = REFERENCE_TUNING.thruster.jetMaxRiseSpeed;
    expectOne({ 'thruster.jetCutSpeed': top + 1 / SUB }, 'thruster.jetCutSpeed', 'at most thruster.jetMaxRiseSpeed');
  });

  it('rejects an apex hang scale outside (0, 1]', () => {
    expectOne({ 'gravity.apexHangScale': 0 }, 'gravity.apexHangScale', 'above 0 and at most 1');
    expectOne({ 'gravity.apexHangScale': 1.01 }, 'gravity.apexHangScale', 'above 0 and at most 1');
  });

  it('rejects a bolt that could skip over an enemy: boltSpeed + enemy speed >= boltHitboxW + 16', () => {
    // Both speeds are below 8 in any valid tuning, so this rule can only fire together with the speed rule.
    const cinderpeg = problemsOf(withValues({ 'blaster.boltSpeed': 12, 'enemies.cinderpegSpeed': 6, 'blaster.boltHitboxW': 2 }));
    expect(cinderpeg.some((p) => p.includes('blaster.boltSpeed') && p.includes('enemies.cinderpegSpeed') && p.includes('skip over'))).toBe(true);
    expect(cinderpeg.some((p) => p.includes('enemies.mothSpeed') && p.includes('skip over'))).toBe(false);

    const moth = problemsOf(withValues({ 'blaster.boltSpeed': 12, 'enemies.mothSpeed': 6, 'blaster.boltHitboxW': 2 }));
    expect(moth.some((p) => p.includes('blaster.boltSpeed') && p.includes('enemies.mothSpeed') && p.includes('skip over'))).toBe(true);

    // One sub-pixel short of the limit is fine as far as this rule goes.
    const short = problemsOf(withValues({ 'blaster.boltSpeed': 12, 'enemies.mothSpeed': 6 - 1 / SUB, 'blaster.boltHitboxW': 2 }));
    expect(short.some((p) => p.includes('skip over'))).toBe(false);
  });

  it('rejects a run that starts with no life, or with more lives than the maximum', () => {
    expectOne({ 'lives.startLives': 0 }, 'lives.startLives', 'at least 1 life');
    expectOne({ 'lives.startLives': REFERENCE_TUNING.lives.maxLives + 1 }, 'lives.startLives', 'at most lives.maxLives');
  });

  it('throws a TuningError whose one message lists every problem, each on its own line', () => {
    const broken = withValues({
      'run.runMaxSpeed': 9,
      'forgiveness.coyoteFrames': 2.5,
      'gravity.apexHangScale': 0,
      'lives.startLives': 0,
    });
    let caught: unknown;
    try {
      compileTuning(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TuningError);
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof TuningError)) return;
    expect(caught.name).toBe('TuningError');
    expect(caught.problems).toHaveLength(4);
    for (const name of ['run.runMaxSpeed', 'forgiveness.coyoteFrames', 'gravity.apexHangScale', 'lives.startLives']) {
      expect(caught.problems.filter((p) => p.startsWith(name)), name).toHaveLength(1);
    }
    expect(caught.message.split('\n').slice(1)).toEqual(caught.problems.map((p) => `- ${p}`));
  });

  it('reports a broken number once, not again through every rule that reads it', () => {
    expect(problemsOf(withValues({ 'jump.jumpVelocity': -5 }))).toHaveLength(1);
    expect(problemsOf(withValues({ 'hero.heroHitboxW': Number.NaN }))).toHaveLength(1);
  });
});

describe('compileTuning: the numbers in src/tuning.ts', () => {
  it('compiles the live tuning; if this fails, the list below names each number in src/tuning.ts to change', () => {
    expect(problemsOf(TUNING)).toEqual([]);
    for (const [name, value] of Object.entries(compileTuning(TUNING))) {
      expect(Number.isInteger(value), `Phys.${name}`).toBe(true);
    }
  });
});
