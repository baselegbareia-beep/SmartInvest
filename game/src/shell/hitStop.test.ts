import { describe, expect, it } from 'vitest';

import { HitStop } from './hitStop';

describe('the hit stop on a kill', () => {
  it('holds exactly the asked number of frames, then lets ticks run again', () => {
    const h = new HitStop();
    h.request(3);
    expect([h.hold(), h.hold(), h.hold(), h.hold()]).toEqual([true, true, true, false]);
  });

  it('two kills close together hold for the longer of the two, not the sum', () => {
    const h = new HitStop();
    h.request(3);
    h.hold();
    h.request(3);
    expect(h.frames).toBe(3);
    h.request(1);
    expect(h.frames).toBe(3);
  });

  it('never holds during a replay, so the script runs tick-exact', () => {
    const h = new HitStop(false);
    h.request(3);
    expect(h.hold()).toBe(false);
    expect(h.frames).toBe(0);
  });

  it('ignores a hold of 0 frames (TUNING.effects.killHitStopFrames = 0 turns it off) and can be reset', () => {
    const h = new HitStop();
    h.request(0);
    expect(h.hold()).toBe(false);
    h.request(5);
    h.reset();
    expect(h.hold()).toBe(false);
  });
});
