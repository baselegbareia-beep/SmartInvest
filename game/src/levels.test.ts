import { describe, expect, it } from 'vitest';

import { buildCampaign, CAMPAIGN, CAMPAIGN_PROBLEMS, DEV_LEVELS, findLevel } from './levels';

/** The smallest level the parser accepts: a start on a wall, a cog and an airlock. */
const tiny = (name: string): string => `@name ${name}\n######\n#P.TD#\n######\n`;

describe('the development rooms', () => {
  it('both parse, under their own ids', () => {
    expect(DEV_LEVELS.test.id).toBe('test');
    expect(DEV_LEVELS.debug.id).toBe('debug');
    expect(DEV_LEVELS.test.name).toBe('Movement Room');
    expect(DEV_LEVELS.debug.name).toBe('Debug Room');
  });

  it('the debug room holds every item and both enemies', () => {
    const kinds = new Set(DEV_LEVELS.debug.pickups.map((p) => p.kind));
    expect(kinds).toEqual(new Set(['crystal', 'blaster', 'thruster']));
    expect(new Set(DEV_LEVELS.debug.enemies.map((e) => e.kind))).toEqual(new Set(['cinderpeg', 'moth']));
  });

  it('are found by id, and an unknown id is not', () => {
    expect(findLevel('test')).toBe(DEV_LEVELS.test);
    expect(findLevel('debug')).toBe(DEV_LEVELS.debug);
    expect(findLevel('no-such-room')).toBeUndefined();
  });
});

describe('buildCampaign', () => {
  it('takes only level-<number>.txt files, in number order, whatever order they come in', () => {
    const campaign = buildCampaign({
      '../levels/level-10.txt': tiny('Ten'),
      '../levels/level-02.txt': tiny('Two'),
      '../levels/test.txt': tiny('Not campaign'),
      '../levels/level-01.txt': tiny('One'),
      '../levels/level-03-draft.txt': tiny('Draft'),
      '../levels/level-09.txt': tiny('Nine'),
    });
    expect(campaign.levels.map((l) => l.id)).toEqual(['level-01', 'level-02', 'level-09', 'level-10']);
    expect(campaign.levels.map((l) => l.name)).toEqual(['One', 'Two', 'Nine', 'Ten']);
    expect(campaign.problems).toEqual([]);
  });

  it('is empty, with no problem, when there are no level files yet', () => {
    expect(buildCampaign({})).toEqual({ levels: [], problems: [] });
  });

  it('leaves out a file that does not parse and says why, keeping the others', () => {
    const campaign = buildCampaign({
      '../levels/level-01.txt': tiny('One'),
      '../levels/level-02.txt': '######\n#P..D#\n######\n',
      '../levels/level-03.txt': tiny('Three'),
    });
    expect(campaign.levels.map((l) => l.id)).toEqual(['level-01', 'level-03']);
    expect(campaign.problems).toHaveLength(1);
    expect(campaign.problems[0]).toContain('levels/level-02.txt');
    expect(campaign.problems[0]).toContain('T (trophy)');
  });
});

describe('CAMPAIGN as built from levels/', () => {
  it('is in number order and holds only campaign ids', () => {
    const ids = CAMPAIGN.map((l) => l.id);
    for (const id of ids) expect(id).toMatch(/^level-\d+$/);
    const numbers = ids.map((id) => Number(id.slice('level-'.length)));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('every campaign level is found by its id', () => {
    for (const level of CAMPAIGN) expect(findLevel(level.id)).toBe(level);
  });

  it('reports its problems as plain sentences (none is expected in a commit)', () => {
    for (const problem of CAMPAIGN_PROBLEMS) expect(problem).toMatch(/^left out of the campaign: levels\/level-\d+\.txt/);
  });
});
