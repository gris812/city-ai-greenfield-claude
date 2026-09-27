import { describe, expect, it } from 'vitest';
import type { PlaceCandidate } from '../src/index.js';
import {
  classifyDensity,
  destinationPoint,
  discoveryQueryFor,
  haversineM,
  lookAheadFor,
  observedDensity,
  policyFor,
  scoreCandidates,
  trajectoryFor,
  updateDensity,
} from '../src/index.js';
import { GUIDE, makeCtx, offset, ORIGIN, place } from './helpers.js';

const HWY = 30; // m/s ≈ 108 km/h
const NORTH = 0;

function byId(list: ReturnType<typeof scoreCandidates>, id: string) {
  const c = list.find((x) => x.place.id === id);
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

describe('density', () => {
  it('classifies by bounds', () => {
    expect(classifyDensity(1)).toBe('sparse');
    expect(classifyDensity(5)).toBe('suburban');
    expect(classifyDensity(40)).toBe('urban');
    expect(classifyDensity(200)).toBe('dense');
  });

  it('smooths and applies hysteresis', () => {
    let d = updateDensity(null, 10, 0);
    expect(d.density).toBe('suburban');
    // a single spike does not flip the class
    d = updateDensity(d, 40, 5000, 0);
    expect(d.density).toBe('suburban');
    // sustained dense readings do
    let t = 5000;
    for (let i = 0; i < 40; i++) {
      t += 5000;
      d = updateDensity(d, 150, t, t - 5000);
    }
    expect(d.density).toBe('dense');
    // hovering just under the boundary (72 > 80×0.8=64) stays dense (hysteresis)
    for (let i = 0; i < 60; i++) {
      t += 5000;
      d = updateDensity(d, 72, t, t - 5000);
    }
    expect(d.density).toBe('dense');
  });

  it('observedDensity counts point places within the probe radius only', () => {
    const cands: PlaceCandidate[] = [];
    for (let i = 0; i < 10; i++) cands.push(place(`p${i}`, 'building', destinationPoint(ORIGIN, i * 36, 200), 0.3));
    cands.push(place('far', 'building', destinationPoint(ORIGIN, 0, 2000), 0.3));
    cands.push(place('region', 'region', ORIGIN, 0.9, { extentM: 50_000 }));
    cands.push(place('tiny', 'building', ORIGIN, 0.01));
    const d = observedDensity(ORIGIN, 350, cands);
    expect(d).toBeCloseTo(10 / ((Math.PI * 350 * 350) / 1e6), 3);
  });
});

describe('discovery — highway corridor', () => {
  const ctx = makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: HWY, course: NORTH, density: 'sparse' });

  it('uses heading-projected corridor when no route', () => {
    expect(trajectoryFor(ctx).mode).toBe('corridor_heading');
  });

  it('suppresses places behind, even highly significant ones', () => {
    const list = scoreCandidates(ctx, [place('behind-city', 'city', offset(ORIGIN, NORTH, -8000, 0), 0.95, { extentM: 3000 })]);
    expect(byId(list, 'behind-city').suppressedBy).toContain('behind');
  });

  it('keeps a large feature the vehicle is inside as "here" (not behind)', () => {
    const list = scoreCandidates(ctx, [place('big-city', 'city', offset(ORIGIN, NORTH, -2000, 500), 0.95, { extentM: 6000 })]);
    const c = byId(list, 'big-city');
    expect(c.geometry.relative).toBe('here');
    expect(c.eligible).toBe(true);
  });

  it('suppresses off-course places beyond the widening corridor', () => {
    const list = scoreCandidates(ctx, [
      place('near-road', 'historic_site', offset(ORIGIN, NORTH, 10_000, 2000), 0.8),
      place('off-road', 'historic_site', offset(ORIGIN, NORTH, 10_000, 12_000), 0.8),
    ]);
    expect(byId(list, 'near-road').suppressedBy).not.toContain('off_course');
    expect(byId(list, 'off-road').suppressedBy).toContain('off_course');
  });

  it('mountains are visible farther off-course than point sites (kind-based visual reach)', () => {
    const list = scoreCandidates(ctx, [
      place('peak', 'mountain', offset(ORIGIN, NORTH, 20_000, -18_000), 0.8),
      place('site', 'historic_site', offset(ORIGIN, NORTH, 20_000, -18_000), 0.8),
    ]);
    expect(byId(list, 'peak').suppressedBy).not.toContain('off_course');
    expect(byId(list, 'site').suppressedBy).toContain('off_course');
  });

  it('significance-scaled look-ahead: 0.95 city 40 km ahead eligible; 0.5 museum 5 km ahead never speakable', () => {
    const p = policyFor('highway_driving', 'sparse');
    expect(lookAheadFor(p, 0.95)).toBeGreaterThan(40_000);
    const list = scoreCandidates(ctx, [
      place('major-city', 'city', offset(ORIGIN, NORTH, 40_000 + 4000, 1500), 0.95, { extentM: 4000 }),
      place('small-museum', 'museum', offset(ORIGIN, NORTH, 5000, 200), 0.5),
    ]);
    expect(byId(list, 'major-city').eligible).toBe(true);
    // Sparse highway lowers the consideration floor, but significance caps the score, so a
    // 0.5 museum can never clear the highway speak threshold — it stays silent.
    const m = byId(list, 'small-museum');
    expect(m.eligible && m.score >= p.speakThreshold).toBe(false);
    // In non-sparse highway context the same museum is below the consideration floor.
    const urbanHwy = makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: HWY, course: NORTH, density: 'urban' });
    expect(byId(scoreCandidates(urbanHwy, [m.place]), 'small-museum').suppressedBy).toContain('below_significance_floor');
    // A mid-significance place far ahead is beyond its (significance-scaled) look-ahead,
    // while a 0.95 feature at the same distance is not.
    const list2 = scoreCandidates(ctx, [place('mid', 'museum', offset(ORIGIN, NORTH, 40_000, 200), 0.6), place('major', 'landmark', offset(ORIGIN, NORTH, 40_000, 200), 0.95)]);
    expect(byId(list2, 'mid').suppressedBy).toContain('beyond_lookahead');
    expect(byId(list2, 'major').suppressedBy).not.toContain('beyond_lookahead');
  });

  it('utility kinds never surface unprompted', () => {
    const list = scoreCandidates(ctx, [place('truck-stop', 'fuel', offset(ORIGIN, NORTH, 4000, 100), 0.9)]);
    expect(byId(list, 'truck-stop').suppressedBy).toContain('utility_kind');
  });

  it('too close to pass: point landmark with ETA below minLead is suppressed', () => {
    const list = scoreCandidates(ctx, [place('close', 'landmark', offset(ORIGIN, NORTH, 900, 100), 0.9)]);
    expect(byId(list, 'close').suppressedBy).toContain('too_close_to_pass');
  });

  it('memory suppressions: already discussed, recently rejected (30 min)', () => {
    const c2 = makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: HWY, course: NORTH, density: 'sparse', now: 100 * 60_000 });
    c2.memory.discussed['d'] = { placeId: 'd', placeName: 'd', at: 0, depth: 'story', completed: true };
    c2.memory.rejected['r1'] = c2.now - 10 * 60_000;
    c2.memory.rejected['r2'] = c2.now - 40 * 60_000;
    const list = scoreCandidates(c2, [
      place('d', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9),
      place('r1', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9),
      place('r2', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9),
    ]);
    expect(byId(list, 'd').suppressedBy).toContain('already_discussed');
    expect(byId(list, 'r1').suppressedBy).toContain('recently_rejected');
    expect(byId(list, 'r2').suppressedBy).not.toContain('recently_rejected');
  });

  it('evidence-thin places are suppressed', () => {
    const list = scoreCandidates(ctx, [place('thin', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9)], new Set(['thin']));
    expect(byId(list, 'thin').suppressedBy).toContain('evidence_thin');
  });

  it('route polyline that curves: follows the route, not the heading', () => {
    // Route goes north 3 km then turns east for 30 km.
    const bend = destinationPoint(ORIGIN, 0, 3000);
    const route = [ORIGIN, bend, destinationPoint(bend, 90, 30_000)];
    const rctx = makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: HWY, course: NORTH, density: 'sparse', route });
    const onRoute = place('east-town', 'town', offset(bend, 90, 15_000, -3000), 0.85, { extentM: 1500 });
    const onHeading = place('north-town', 'town', offset(ORIGIN, NORTH, 18_000, 0), 0.85, { extentM: 1500 });
    const withRoute = scoreCandidates(rctx, [onRoute, onHeading]);
    expect(trajectoryFor(rctx).mode).toBe('corridor_route');
    expect(byId(withRoute, 'east-town').eligible).toBe(true);
    expect(byId(withRoute, 'east-town').geometry.alongTrackM!).toBeCloseTo(18_000, -3);
    expect(byId(withRoute, 'east-town').geometry.side).toBe('left'); // north of eastbound = left
    expect(byId(withRoute, 'north-town').suppressedBy).toContain('off_course');
    const noRoute = scoreCandidates({ ...rctx, route: null }, [onRoute, onHeading]);
    expect(byId(noRoute, 'north-town').eligible).toBe(true);
    expect(byId(noRoute, 'east-town').suppressedBy).toContain('off_course');
  });

  it('off the route → falls back to heading projection', () => {
    const far = destinationPoint(ORIGIN, 90, 20_000);
    const rctx = makeCtx({ position: far, regime: 'highway_driving', speed: HWY, course: NORTH, density: 'sparse', route: [ORIGIN, destinationPoint(ORIGIN, 0, 50_000)] });
    expect(trajectoryFor(rctx).mode).toBe('corridor_heading');
  });

  it('discovery query covers the corridor', () => {
    const q = discoveryQueryFor(ctx);
    const reach = policyFor('highway_driving', 'sparse').lookAheadMaxM;
    expect(q.corridor).not.toBeNull();
    expect(haversineM(q.center, ORIGIN)).toBeGreaterThan(reach / 2 - 2000);
    expect(q.radiusM).toBeGreaterThan(reach / 2);
    expect(q.minSignificance).toBe(policyFor('highway_driving', 'sparse').significanceFloor);
  });

  it('is deterministic with id tie-break', () => {
    const a = place('a', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9);
    const b = place('b', 'landmark', offset(ORIGIN, NORTH, 8000, 0), 0.9);
    expect(scoreCandidates(ctx, [b, a]).map((x) => x.place.id)).toEqual(['a', 'b']);
    expect(scoreCandidates(ctx, [a, b])).toEqual(scoreCandidates(ctx, [a, b]));
  });
});

describe('discovery — walking/stationary radial', () => {
  it('walking: radial with forward bias', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: NORTH, density: 'dense' });
    expect(trajectoryFor(ctx).mode).toBe('radial');
    const list = scoreCandidates(
      ctx,
      [
        place('fwd', 'memorial', offset(ORIGIN, NORTH, 180, 0), 0.8),
        place('back', 'memorial', offset(ORIGIN, NORTH, -180, 0), 0.8),
        place('far-fwd', 'museum', offset(ORIGIN, NORTH, 700, 0), 0.9),
        place('far-back', 'museum', offset(ORIGIN, NORTH, -700, 0), 0.9),
      ],
      undefined,
      { guide: GUIDE },
    );
    expect(byId(list, 'fwd').score).toBeGreaterThan(byId(list, 'back').score);
    expect(byId(list, 'far-fwd').eligible).toBe(true);
    expect(byId(list, 'far-back').suppressedBy).toContain('beyond_lookahead');
  });

  it('stationary: radius, "here" for places we are inside', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'stationary', density: 'urban' });
    const list = scoreCandidates(ctx, [place('park', 'park', offset(ORIGIN, 0, 100, 0), 0.6, { extentM: 300 }), place('far', 'building', offset(ORIGIN, 0, 900, 0), 0.4)]);
    expect(byId(list, 'park').geometry.relative).toBe('here');
    expect(byId(list, 'far').suppressedBy).toContain('beyond_lookahead');
  });

  it('dense areas raise the floor so minor clutter is filtered', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: NORTH, density: 'dense' });
    const list = scoreCandidates(ctx, [place('clutter', 'building', offset(ORIGIN, NORTH, 50, 10), 0.25)]);
    expect(byId(list, 'clutter').suppressedBy).toContain('below_significance_floor');
  });

  it('components are exposed for explainability', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: NORTH, density: 'urban' });
    const [c] = scoreCandidates(ctx, [place('x', 'museum', offset(ORIGIN, NORTH, 100, 0), 0.8)], undefined, { guide: GUIDE });
    for (const k of ['significance', 'timing', 'novelty', 'affinity', 'visibility', 'continuity']) expect(c!.components).toHaveProperty(k);
    expect(c!.score).toBeLessThanOrEqual(0.8);
  });

  it('continuity bonus for places sharing tags with discussed ones', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: NORTH, density: 'urban' });
    ctx.memory.discussed['old'] = { placeId: 'old', placeName: 'Old', at: 0, depth: 'story', completed: true, tags: ['railroad'] };
    const list = scoreCandidates(ctx, [
      place('rel', 'historic_site', offset(ORIGIN, NORTH, 150, 0), 0.7, { tags: ['railroad'] }),
      place('unrel', 'historic_site', offset(ORIGIN, NORTH, 150, 0), 0.7, { tags: ['mining'] }),
    ]);
    expect(byId(list, 'rel').components.continuity).toBe(1);
    expect(byId(list, 'rel').score).toBeGreaterThan(byId(list, 'unrel').score);
  });
});
