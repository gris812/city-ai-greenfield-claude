import { describe, expect, it } from 'vitest';
import type { ScoredCandidate } from '../src/index.js';
import { IDA, EMIL, policyFor, storyBudget } from '../src/index.js';
import { makeCtx, ORIGIN, place } from './helpers.js';

// Regression (found by bench:acceptance): Ida's verbosity (>1) stretched the highway
// safety cap. Driving caps are hard limits; verbosity may only shorten them.
function farTarget(): ScoredCandidate {
  return {
    place: place('t', 'city', ORIGIN, 0.9),
    geometry: { distanceM: 40_000, bearingDeg: 0, relativeBearingDeg: 0, alongTrackM: 40_000, crossTrackM: 0, etaS: 1300, relative: 'ahead', side: 'center' },
    eligible: true, suppressedBy: [], score: 0.9,
    components: { etaToPassS: 10_000 },
  };
}

describe('story duration caps', () => {
  for (const regime of ['highway_driving', 'urban_driving'] as const) {
    it(`never exceeds maxStoryS while ${regime}, for every guide`, () => {
      const ctx = makeCtx({ position: ORIGIN, regime, speed: regime === 'highway_driving' ? 30 : 12, course: 0, density: 'sparse' });
      const cap = policyFor(regime, 'sparse').maxStoryS;
      for (const g of [IDA, EMIL]) expect(storyBudget(ctx, farTarget(), g).durationBudgetS).toBeLessThanOrEqual(cap);
    });
  }
  it('lets a verbose guide tell longer stories on foot', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban' });
    const cap = policyFor('walking', 'urban').maxStoryS;
    const verbose = IDA.narrative.verbosity > 1 ? IDA : EMIL;
    expect(storyBudget(ctx, farTarget(), verbose).durationBudgetS).toBeGreaterThanOrEqual(cap);
  });
});
