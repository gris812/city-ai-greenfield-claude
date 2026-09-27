import { describe, expect, it } from 'vitest';
import type { ContextFrame, GeoFix } from '../src/index.js';
import {
  adjustTalkativeness,
  contextOf,
  decideMoment,
  discoveryQueryFor,
  emptyMemory,
  ingestFrame,
  newJourney,
  observeDensity,
  orientationGiven,
  recordDiscoveryFetch,
  recordQuestion,
  recordRejected,
  recordStoryCompleted,
  recordStorySkipped,
  recordStoryStarted,
  scoreCandidates,
  shouldRefreshDensity,
  shouldRefreshDiscovery,
  storyCompleted,
  storyInterrupted,
  storyResumed,
  storyStarted,
  destinationPoint,
} from '../src/index.js';
import { makeCtx, offset, ORIGIN, place, synthTrace } from './helpers.js';

function frame(seq: number, fixes: GeoFix[], over: Partial<ContextFrame> = {}): ContextFrame {
  return {
    sessionId: 's1',
    seq,
    fixes,
    appState: 'foreground',
    audio: { playing: false, outputRoute: 'bluetooth' },
    clientTime: fixes.at(-1)?.t ?? 0,
    simulated: true,
    ...over,
  };
}

describe('memory reducers', () => {
  const p = { id: 'a', name: 'A', kind: 'museum' as const, tags: ['art'] };
  it('start → complete, themes, skip → rejection + talkativeness nudge', () => {
    let m = recordStoryStarted(emptyMemory(), p, 'people', 10);
    expect(m.discussed.a).toMatchObject({ completed: false, angle: 'people', tags: ['art'] });
    expect(m.themes).toMatchObject({ art: 1, 'kind:museum': 1, 'angle:people': 1 });
    m = recordStoryCompleted(m, 'a', 20);
    expect(m.discussed.a!.completed).toBe(true);
    expect(m.storiesCompleted).toBe(1);
    let s = emptyMemory();
    for (let i = 0; i < 3; i++) s = recordStorySkipped(s, `p${i}`, i);
    expect(s.storiesSkipped).toBe(3);
    expect(s.rejected.p2).toBe(2);
    expect(s.talkativeness).toBe(-1);
  });
  it('talkativeness is clamped, questions are bounded, rejects are recorded', () => {
    expect(adjustTalkativeness(emptyMemory(), 10).talkativeness).toBe(2);
    let m = emptyMemory();
    for (let i = 0; i < 60; i++) m = recordQuestion(m, `q${i}`, 'ask_question', i);
    expect(m.questions).toHaveLength(50);
    expect(recordRejected(emptyMemory(), 'x', 5).rejected.x).toBe(5);
  });
  it('reducers are immutable', () => {
    const m = emptyMemory();
    recordStoryStarted(m, p, 'origin', 1);
    expect(m).toEqual(emptyMemory());
  });
});

describe('ingestFrame', () => {
  const fixes = synthTrace([{ durationS: 60, fromMps: 1.4 }], { start: ORIGIN, bearingDeg: 0, seed: 3, t0: 1_000_000 });

  it('folds frames, ignores out-of-order/duplicate seq and foreign sessions', () => {
    let s = newJourney({ sessionId: 's1', now: 1_000_000, guideId: 'g', locale: 'en' });
    s = ingestFrame(s, frame(1, fixes.slice(0, 30)));
    const snap = s;
    expect(ingestFrame(s, frame(1, fixes.slice(30)))).toBe(snap);
    expect(ingestFrame(s, frame(0, fixes.slice(30)))).toBe(snap);
    expect(ingestFrame(s, { ...frame(2, fixes.slice(30)), sessionId: 'other' })).toBe(snap);
    s = ingestFrame(s, frame(2, fixes.slice(30)));
    expect(s.regime.regime).toBe('walking');
    expect(s.position!.t).toBe(fixes.at(-1)!.t);
    expect(s.lastSeq).toBe(2);
    expect(s.transitions.map((t) => t.to)).toEqual(['walking']);
    expect(s.audioRoute).toBe('bluetooth');
  });

  it('syncs playback progress for the active plan without regressing', () => {
    let s = newJourney({ sessionId: 's1', now: 1_000_000, guideId: 'g', locale: 'en' });
    s = ingestFrame(s, frame(1, fixes.slice(0, 10)));
    s = storyStarted(s, { planId: 'p1', place: { id: 'x', name: 'X', kind: 'museum', tags: [], significance: 0.8 }, angle: 'origin', segmentCount: 5, at: s.now });
    s = ingestFrame(s, frame(2, fixes.slice(10, 20), { audio: { playing: true, planId: 'p1', segmentIndex: 2, offsetMs: 500, outputRoute: 'speaker' } }));
    expect(s.activeStory).toMatchObject({ segmentIndex: 2, offsetMs: 500 });
    s = ingestFrame(s, frame(3, fixes.slice(20, 30), { audio: { playing: true, planId: 'p1', segmentIndex: 1, offsetMs: 0, outputRoute: 'speaker' } }));
    expect(s.activeStory).toMatchObject({ segmentIndex: 2, offsetMs: 500 });
    s = ingestFrame(s, frame(4, fixes.slice(30, 40), { audio: { playing: true, planId: 'old', segmentIndex: 4, offsetMs: 0, outputRoute: 'speaker' } }));
    expect(s.activeStory!.segmentIndex).toBe(2);
  });

  it('story lifecycle: interrupt → director resumes at segment start → complete keeps memory', () => {
    let s = newJourney({ sessionId: 's1', now: 1_000_000, guideId: 'g', locale: 'en' });
    s = ingestFrame(s, frame(1, fixes.slice(0, 40)));
    s = storyStarted(s, { planId: 'p1', place: { id: 'x', name: 'X', kind: 'museum', tags: ['art'], significance: 0.8 }, angle: 'origin', segmentCount: 5, at: s.now });
    s = storyInterrupted(s, s.now, 'user_speech', { segmentIndex: 3, offsetMs: 2200 });
    s = ingestFrame(s, frame(2, fixes.slice(40, 45)));
    const d = decideMoment(contextOf(s), [], { currentPlanId: s.currentPlanId });
    expect(d).toEqual({ kind: 'resume_story', decision: { action: 'resume', fromSegment: 3, bridge: false } });
    s = storyResumed(s, 3, s.now);
    s = storyCompleted(s, s.now + 5000);
    expect(s.activeStory).toBeNull();
    expect(s.memory.discussed.x!.completed).toBe(true);
    expect(s.lastSpeechEndedAt).toBe(s.now + 5000);
  });

  it('density observation folds into state', () => {
    let s = newJourney({ sessionId: 's1', now: 1_000_000, guideId: 'g', locale: 'en' });
    s = ingestFrame(s, frame(1, fixes.slice(0, 10)));
    const many = Array.from({ length: 40 }, (_, i) => place(`c${i}`, 'building', destinationPoint(s.position!, i * 9, 50 + i * 5), 0.2));
    s = observeDensity(s, many);
    expect(s.density.density).toBe('dense');
  });

  it('orientation marks a mention and counts as speech', () => {
    let s = newJourney({ sessionId: 's1', now: 1_000_000, guideId: 'g', locale: 'en' });
    s = orientationGiven(s, { id: 'v', name: 'V', kind: 'venue', tags: [] }, 1_004_000);
    expect(s.memory.discussed.v).toMatchObject({ depth: 'mention', completed: true });
    expect(s.lastSpeechEndedAt).toBe(1_004_000);
  });
});

describe('discovery refresh policy (F1 / A5)', () => {
  it('highway: one query per several km, not per GPS fix', () => {
    let calls = 0;
    let rec = null as ReturnType<typeof recordDiscoveryFetch> | null;
    for (let s = 0; s < 3600; s++) {
      const ctx = makeCtx({ position: destinationPoint(ORIGIN, 0, 30 * s), regime: 'highway_driving', speed: 30, course: 0, density: 'sparse', now: 1_000_000 + s * 1000 });
      const q = discoveryQueryFor(ctx);
      if (shouldRefreshDiscovery(rec, ctx, q).refresh) {
        calls++;
        rec = recordDiscoveryFetch(rec, ctx, q, 5);
      }
    }
    expect(calls).toBeLessThanOrEqual(12);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('empty results back off (F1)', () => {
    let full = 0;
    let empty = 0;
    let r1 = null as ReturnType<typeof recordDiscoveryFetch> | null;
    let r2 = null as ReturnType<typeof recordDiscoveryFetch> | null;
    for (let s = 0; s < 3600; s += 1) {
      const ctx = makeCtx({ position: destinationPoint(ORIGIN, 0, 1.4 * s), regime: 'walking', speed: 1.4, course: 0, density: 'sparse', now: 1_000_000 + s * 1000 });
      const q = discoveryQueryFor(ctx);
      if (shouldRefreshDiscovery(r1, ctx, q).refresh) {
        full++;
        r1 = recordDiscoveryFetch(r1, ctx, q, 10);
      }
      if (shouldRefreshDiscovery(r2, ctx, q).refresh) {
        empty++;
        r2 = recordDiscoveryFetch(r2, ctx, q, 0);
      }
    }
    expect(empty).toBeLessThan(full);
    expect(full).toBeLessThanOrEqual(20);
  });

  it('stationary user is not re-queried until stale; regime change refreshes after min interval', () => {
    const ctx0 = makeCtx({ position: ORIGIN, regime: 'stationary', density: 'urban', now: 0 });
    const rec = recordDiscoveryFetch(null, ctx0, discoveryQueryFor(ctx0), 3);
    const later = makeCtx({ position: ORIGIN, regime: 'stationary', density: 'urban', now: 300_000 });
    expect(shouldRefreshDiscovery(rec, later, discoveryQueryFor(later))).toEqual({ refresh: false, reason: 'covered' });
    const soon = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 5_000 });
    expect(shouldRefreshDiscovery(rec, soon, discoveryQueryFor(soon))).toEqual({ refresh: false, reason: 'min_interval' });
    const walk = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 61_000 });
    expect(shouldRefreshDiscovery(rec, walk, discoveryQueryFor(walk))).toEqual({ refresh: true, reason: 'regime_changed' });
  });

  it('corridor: course change triggers refresh', () => {
    const c0 = makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: 30, course: 0, density: 'sparse', now: 0 });
    const rec = recordDiscoveryFetch(null, c0, discoveryQueryFor(c0), 4);
    const c1 = makeCtx({ position: offset(ORIGIN, 0, 1000, 0), regime: 'highway_driving', speed: 30, course: 60, density: 'sparse', now: 40_000 });
    expect(shouldRefreshDiscovery(rec, c1, discoveryQueryFor(c1))).toEqual({ refresh: true, reason: 'course_changed' });
  });

  it('density probe needs both interval and movement', () => {
    const c = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 100_000 });
    expect(shouldRefreshDensity(null, c)).toBe(true);
    expect(shouldRefreshDensity({ at: 0, position: ORIGIN, regime: 'walking' }, c)).toBe(false);
    const moved = { ...c, position: { ...c.position!, ...destinationPoint(ORIGIN, 0, 400) } };
    expect(shouldRefreshDensity({ at: 0, position: ORIGIN, regime: 'walking' }, moved)).toBe(true);
    expect(shouldRefreshDensity({ at: 90_000, position: ORIGIN, regime: 'walking' }, moved)).toBe(false);
  });
});

describe('A4 weak evidence in the director', () => {
  it('thin-evidence place → orientation only (never a story), and only when no story is available', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 600_000 });
    const thin = place('thin', 'venue', offset(ORIGIN, 0, 120, 30), 0.85);
    const good = place('good', 'museum', offset(ORIGIN, 0, 200, 0), 0.8);
    const both = decideMoment(ctx, scoreCandidates(ctx, [thin, good], new Set(['thin'])));
    expect(both).toMatchObject({ kind: 'start_story', target: { place: { id: 'good' } } });
    const only = decideMoment(ctx, scoreCandidates(ctx, [thin], new Set(['thin'])));
    expect(only).toMatchObject({ kind: 'orientation', allowFollowUp: false, target: { place: { id: 'thin' } } });
    // a thin minor place is not worth even an orientation
    const minor = decideMoment(ctx, scoreCandidates(ctx, [place('m', 'venue', offset(ORIGIN, 0, 120, 30), 0.3)], new Set(['m'])));
    expect(minor).toMatchObject({ kind: 'silence', reason: 'nothing_worth_it' });
  });
});
