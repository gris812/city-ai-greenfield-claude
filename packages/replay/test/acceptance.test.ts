/**
 * Replay acceptance assertions, keyed to benchmark/ACCEPTANCE_BENCHMARK.md IDs.
 * Every scenario runs through the same runner and the same global FixturePlaceSource.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiscoveryQuery, PlaceCandidate } from '@city/core';
import { lookAheadFor, policyFor } from '@city/core';
import { FixtureEvidence, FixturePlaceSource, runScenario, SCENARIOS, scenarioByName, type ReplayResult } from '../src/index.js';

const results: Record<string, ReplayResult> = {};
let source: FixturePlaceSource;
let evidence: FixtureEvidence;

beforeAll(async () => {
  source = new FixturePlaceSource();
  evidence = new FixtureEvidence();
  for (const sc of SCENARIOS) {
    source.resetStats();
    results[sc.name] = await runScenario(sc, { source, evidence });
  }
});

const R = (n: string) => results[n]!;
const storyIds = (n: string) => R(n).stories.filter((s) => s.kind === 'story').map((s) => s.placeId);
const allIds = (n: string) => R(n).stories.map((s) => s.placeId);

/** Is `sub` a subsequence of `seq`? */
function subsequence<T>(seq: T[], sub: T[]): boolean {
  let i = 0;
  for (const x of seq) if (x === sub[i]) i++;
  return i === sub.length;
}

class ReversedSource extends FixturePlaceSource {
  override querySync(q: DiscoveryQuery): PlaceCandidate[] {
    return super.querySync(q).reverse();
  }
}

describe('A1 — World Trade Center / Ground Zero', () => {
  const LOCAL = ['fx:nyc:911-memorial', 'fx:nyc:one-wtc', 'fx:nyc:oculus', 'fx:nyc:st-pauls'];
  it('the 9/11 Memorial is the first story, before any clutter or distant landmark', () => {
    expect(storyIds('wtc-walk')[0]).toBe('fx:nyc:911-memorial');
    const first = R('wtc-walk').stories[0]!;
    expect(first.distanceM).toBeLessThan(first.reachM);
  });
  it('strong local targets dominate: all local WTC-area targets precede any distant one', () => {
    const ids = storyIds('wtc-walk');
    const firstDistant = ids.findIndex((id) => !LOCAL.includes(id));
    const localIdx = ids.map((id, i) => (LOCAL.includes(id) ? i : -1)).filter((i) => i >= 0);
    expect(localIdx.length).toBeGreaterThanOrEqual(3);
    if (firstDistant >= 0) expect(Math.max(...localIdx)).toBeLessThan(firstDistant);
    expect(ids).not.toContain('fx:nyc:statue-of-liberty');
    expect(ids).not.toContain('fx:nyc:empire-state');
    expect(R('wtc-walk').summary.clutterStories).toBe(0);
    expect(R('wtc-walk').summary.utilityStories).toBe(0);
  });
  it('provider result ordering does not change target selection', async () => {
    const rev = await runScenario(scenarioByName('wtc-walk')!, { source: new ReversedSource(), evidence });
    expect(rev.stories.map((s) => s.placeId)).toEqual(allIds('wtc-walk'));
  });
});

describe('A2 — Golden Gate Bridge', () => {
  it('the bridge is the first story; distant city alternatives never precede it', () => {
    const ids = storyIds('golden-gate');
    expect(ids[0]).toBe('fx:sf:golden-gate-bridge');
  });
  it('a major landmark triggers from farther than a small POI could', () => {
    const b = R('golden-gate').stories.find((s) => s.placeId === 'fx:sf:golden-gate-bridge')!;
    const smallReach = lookAheadFor(policyFor(b.regime, b.density), 0.4); // the fixture's Vista Point
    expect(b.distanceM).toBeGreaterThan(3000);
    expect(b.alongTrackM!).toBeGreaterThan(smallReach);
    expect(b.reachM).toBeGreaterThan(3 * smallReach);
    expect(allIds('golden-gate')).not.toContain('fx:sf:vista-point-north');
    expect(Object.keys(R('golden-gate').summary.rejections)).toContain('fx:sf:vista-point-north');
  });
  it('drive → park → walk continues in the same session and tells the immediate context on foot', () => {
    const s = R('golden-gate').summary;
    expect(subsequence(s.regimeSequence, ['urban_driving', 'stationary', 'walking'])).toBe(true);
    const onFoot = R('golden-gate').stories.filter((x) => x.regime === 'walking' || x.regime === 'stationary');
    expect(onFoot.map((x) => x.placeId)).toContain('fx:sf:fort-point');
  });
});

describe('A3 — Art Institute of Chicago', () => {
  it('the museum is the first story when approaching it on foot', () => {
    const first = R('art-institute-walk').stories[0]!;
    expect(first.placeId).toBe('fx:chi:art-institute');
    expect(first.distanceM).toBeLessThan(500);
  });
  it('farther objects do not replace it; the enclosing city is ambient context, not a walking story', () => {
    const ids = storyIds('art-institute-walk');
    const aic = ids.indexOf('fx:chi:art-institute');
    for (const far of ['fx:chi:willis-tower', 'fx:chi:field-museum', 'fx:chi:navy-pier']) {
      const i = ids.indexOf(far);
      if (i >= 0) expect(i).toBeGreaterThan(aic);
    }
    expect(ids).not.toContain('fx:chi:chicago');
    expect(R('art-institute-walk').summary.rejections['fx:chi:chicago']!.reasons.enclosing_area).toBeGreaterThan(0);
  });
});

describe('A4 — Weak evidence', () => {
  it('a thin-evidence venue gets at most one orientation line — never a story', () => {
    const recs = R('art-institute-walk').stories.filter((s) => s.placeId === 'fx:chi:pritzker-pavilion');
    expect(recs.length).toBeLessThanOrEqual(1);
    for (const r of recs) {
      expect(r.kind).toBe('orientation');
      expect(r.text).toMatch(/^[^:]+: Jay Pritzker Pavilion, a venue\.$/);
    }
  });
  it('no scenario ever starts a story on a thin-evidence place; every story is grounded', () => {
    for (const r of Object.values(results)) {
      for (const s of r.stories.filter((x) => x.kind === 'story')) {
        expect(evidence.isThin(s.placeId)).toBe(false);
        expect(s.grounded).toBe(true);
      }
      expect(r.summary.groundingFailures).toBe(0);
    }
  });
  it('orientation lines carry no facts: only a spatial cue, the name and a generic kind label', () => {
    for (const r of Object.values(results)) {
      for (const o of r.stories.filter((x) => x.kind === 'orientation')) {
        expect(o.text.startsWith(`${o.name}`) || o.text.includes(`: ${o.name}`)).toBe(true);
        expect(o.words).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('A5 — Highway / ahead discovery (+E1 safety, F1 cost)', () => {
  for (const name of ['interstate', 'interstate-routed']) {
    describe(name, () => {
      it('only targets ahead along the trajectory; nothing behind; nothing passed mid-story', () => {
        const r = R(name);
        expect(r.summary.wronglyBehindTargets).toBe(0);
        expect(r.summary.endedAfterPassing).toBe(0);
        for (const s of r.stories) {
          expect(['ahead', 'here', 'beside']).toContain(s.relative);
          expect(s.alongTrackM!).toBeGreaterThanOrEqual(0);
        }
        expect(r.stories.every((s) => s.trajectory === (name === 'interstate' ? 'corridor_heading' : 'corridor_route'))).toBe(true);
      });
      it('major features announced from far ahead (significance-scaled look-ahead)', () => {
        for (const s of R(name).stories) {
          expect(s.alongTrackM!).toBeGreaterThan(10_000);
          expect(s.alongTrackM!).toBeLessThanOrEqual(s.reachM + 5000);
          expect(s.reachM).toBeGreaterThan(lookAheadFor(policyFor('highway_driving', s.density), 0.5));
        }
        expect(storyIds(name)).toEqual(expect.arrayContaining(['fx:i40:mount-taylor', 'fx:i40:continental-divide', 'fx:i40:gallup']));
      });
      it('minor settlements, truck stops, clutter and off-route landmarks stay silent — with reasons recorded', () => {
        const s = R(name).summary;
        const ids = allIds(name);
        expect(s.utilityStories + s.clutterStories).toBe(0);
        for (const id of ['fx:i40:truckstop-laguna', 'fx:i40:truckstop-grants', 'fx:i40:truckstop-thoreau', 'fx:i40:truckstop-gallup']) {
          expect(ids).not.toContain(id);
          expect(s.rejections[id]!.reasons.utility_kind).toBeGreaterThan(0);
        }
        expect(ids).not.toContain('fx:i40:thoreau');
        expect(ids).not.toContain('fx:i40:acoma');
        expect(s.rejections['fx:i40:acoma']!.reasons.off_course).toBeGreaterThan(0);
        expect(ids).not.toContain('fx:i40:albuquerque');
        expect(s.rejections['fx:i40:albuquerque']!.reasons.behind).toBeGreaterThan(0);
        expect(R(name).stories.some((x) => x.rejected.length > 0)).toBe(true);
      });
      it('long silence is the norm; stories are short, audio-only, no questions', () => {
        const r = R(name);
        expect(r.summary.durationS).toBeGreaterThan(3600);
        expect(r.summary.storiesStarted).toBeLessThanOrEqual(8);
        expect(r.summary.silenceRatio).toBeGreaterThan(0.95);
        expect(r.summary.maxSilentGapS).toBeGreaterThan(20 * 60);
        for (const s of r.stories) {
          expect(s.allowQuestionsToUser).toBe(false);
          expect(s.durationBudgetS!).toBeLessThanOrEqual(75);
          expect(s.mode).not.toBe('full');
        }
      });
      it('no provider request loop at highway GPS frequency', () => {
        const q = R(name).summary.providerQueries;
        expect(q.perHour).toBeLessThanOrEqual(60);
        expect(q.framesPerQuery).toBeGreaterThanOrEqual(20);
      });
    });
  }
  it('route-polyline and heading-projection corridors agree on this (straight-ish) Interstate', () => {
    expect(new Set(storyIds('interstate-routed'))).toEqual(new Set(storyIds('interstate')));
  });
});

describe('A6 — Environment transition (highway → outskirts → urban → downtown → walking)', () => {
  it('regimes and densities change automatically, in order, in one session', () => {
    const s = R('transition').summary;
    expect(subsequence(s.regimeSequence, ['highway_driving', 'urban_driving', 'stationary', 'walking'])).toBe(true);
    expect(subsequence(s.densitySequence, ['sparse', 'suburban', 'urban', 'dense'])).toBe(true);
    expect(s.sessionRestarts).toBe(0);
    expect(R('transition').finalState.lastSeq).toBe(s.frames - 1);
  });
  it('journey memory is preserved: nothing is re-told after the transition; memory holds everything said', () => {
    const r = R('transition');
    const ids = allIds('transition');
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.summary.memory.discussed).toBe(ids.length);
    const drivingIds = r.stories.filter((x) => x.regime.endsWith('driving')).map((x) => x.placeId);
    expect(drivingIds.length).toBeGreaterThan(0);
    for (const id of drivingIds) expect(r.finalState.memory.discussed[id]).toBeDefined();
  });
  it('policy adapts: walking does not keep highway look-ahead/cadence; driving is stricter', () => {
    const tl = R('transition').timeline;
    const hwy = tl.filter((e) => e.regime === 'highway_driving');
    const walk = tl.filter((e) => e.regime === 'walking');
    expect(hwy.length).toBeGreaterThan(0);
    expect(walk.length).toBeGreaterThan(0);
    const maxWalkLook = Math.max(...walk.map((e) => e.policy.lookAheadMaxM));
    const minHwyLook = Math.min(...hwy.map((e) => e.policy.lookAheadMaxM));
    expect(maxWalkLook).toBeLessThan(minHwyLook / 10);
    expect(Math.max(...walk.map((e) => e.policy.minGapS))).toBeLessThan(Math.min(...hwy.map((e) => e.policy.minGapS)));
    expect(walk.every((e) => e.trajectory === 'radial')).toBe(true);
    expect(hwy.every((e) => e.trajectory !== 'radial')).toBe(true);
    const stories = R('transition').stories.filter((s) => s.kind === 'story');
    for (const s of stories) {
      if (s.regime.endsWith('driving')) expect(s.allowQuestionsToUser).toBe(false);
      if (s.regime === 'walking') expect(s.allowQuestionsToUser).toBe(true);
    }
  });
  it('the city is announced on the way in, while driving', () => {
    const c = R('transition').stories.find((s) => s.placeId === 'fx:chi:chicago')!;
    expect(c.regime).toBe('highway_driving');
  });
});

describe('A7 — Cross-city portability', () => {
  const CITY_SCENARIOS = ['wtc-walk', 'art-institute-walk', 'golden-gate'];
  it('scenarios carry no city/area configuration — only trace, guide, locale', () => {
    const allowed = new Set(['name', 'trace', 'guide', 'locale', 'useRoute', 'acceptance', 'description']);
    for (const sc of SCENARIOS) for (const k of Object.keys(sc)) expect(allowed.has(k)).toBe(true);
  });
  it('the same global source (all packs loaded) serves every city; each yields grounded stories', () => {
    const packs = new Set(source.places.map((p) => p.id.split(':')[1]));
    expect(packs.size).toBeGreaterThanOrEqual(4);
    for (const n of CITY_SCENARIOS) {
      expect(R(n).summary.storiesStarted).toBeGreaterThanOrEqual(3);
      // candidates from other cities never leak in: every target is within 15 km of the trace
      for (const s of R(n).stories) expect(s.distanceM).toBeLessThan(15_000);
    }
  });
  it('telemetry explains selection with the same fields in every city', () => {
    const shapes = CITY_SCENARIOS.map((n) => JSON.stringify(Object.keys(R(n).stories.find((s) => s.kind === 'story')!).sort()));
    expect(new Set(shapes).size).toBe(1);
    const tl = CITY_SCENARIOS.map((n) => JSON.stringify(Object.keys(R(n).timeline[0]!.policy).sort()));
    expect(new Set(tl).size).toBe(1);
  });
});

describe('F1 — Empty discovery result', () => {
  it('an empty provider over a 105-minute highway run does not refresh on every GPS update', async () => {
    const empty = new FixturePlaceSource([]);
    const r = await runScenario(scenarioByName('interstate')!, { source: empty, evidence });
    expect(r.summary.storiesStarted).toBe(0);
    expect(r.summary.silenceRatio).toBe(1);
    expect(r.summary.providerQueries.total).toBeLessThanOrEqual(40);
    expect(r.summary.providerQueries.framesPerQuery).toBeGreaterThanOrEqual(75);
  });
  it('an empty provider while standing still issues a single query pair', async () => {
    const empty = new FixturePlaceSource([]);
    const sc = scenarioByName('wtc-walk')!;
    const r = await runScenario(sc, { source: empty, evidence });
    expect(r.summary.providerQueries.total).toBeLessThanOrEqual(12);
  });
});

describe('determinism', () => {
  it('the same scenario replays byte-identically', async () => {
    const a = await runScenario(scenarioByName('golden-gate')!, { source: new FixturePlaceSource(), evidence });
    const { finalState: _a, ...fa } = a;
    const { finalState: _b, ...fb } = R('golden-gate');
    expect(JSON.stringify(fa)).toBe(JSON.stringify(fb));
  });
});
