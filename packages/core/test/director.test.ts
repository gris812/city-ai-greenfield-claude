import { describe, expect, it } from 'vitest';
import type { ActiveStoryState, JourneyContext, PlaceCandidate } from '../src/index.js';
import { decideMoment, destinationPoint, evaluateSafety, gapMultiplier, policyFor, scoreCandidates, storyBudget } from '../src/index.js';
import { GUIDE, makeCtx, offset, ORIGIN, place } from './helpers.js';

const HWY = 30;

function hwyCtx(over: Partial<Parameters<typeof makeCtx>[0]> = {}): JourneyContext {
  return makeCtx({ position: ORIGIN, regime: 'highway_driving', speed: HWY, course: 0, density: 'sparse', now: 3_600_000, regimeSince: 0, ...over });
}

function decide(ctx: JourneyContext, places: PlaceCandidate[], opts: Parameters<typeof decideMoment>[2] = {}) {
  return decideMoment(ctx, scoreCandidates(ctx, places, undefined, { guide: GUIDE }), { guide: GUIDE, ...opts });
}

describe('MomentDirector', () => {
  it('no fix → silence(no_fix)', () => {
    const d = decideMoment(makeCtx({ position: null, regime: 'unknown' }), []);
    expect(d).toMatchObject({ kind: 'silence', reason: 'no_fix' });
  });

  it('warm-up after regime entry', () => {
    const ctx = hwyCtx({ regimeSince: 3_600_000 - 20_000 });
    const d = decide(ctx, [place('city', 'city', offset(ORIGIN, 0, 20_000, 0), 0.95, { extentM: 3000 })]);
    expect(d).toMatchObject({ kind: 'silence', reason: 'warming_up' });
  });

  it('long sparse highway stretch with nothing worthy → silence for 25+ minutes', () => {
    // Candidates along 45 km: utility stops, minor sites, a far-off-course feature.
    const clutter: PlaceCandidate[] = [];
    for (let km = 2; km < 60; km += 3) {
      clutter.push(place(`fuel${km}`, 'fuel', offset(ORIGIN, 0, km * 1000, 150), 0.6));
      clutter.push(place(`minor${km}`, 'historic_site', offset(ORIGIN, 0, km * 1000, 600), 0.3));
      clutter.push(place(`motel${km}`, 'lodging', offset(ORIGIN, 0, km * 1000 + 500, -200), 0.4));
    }
    clutter.push(place('far-peak', 'mountain', offset(ORIGIN, 0, 30_000, 45_000), 0.7));
    let stories = 0;
    const decisions = new Set<string>();
    for (let s = 0; s <= 25 * 60; s += 10) {
      const pos = destinationPoint(ORIGIN, 0, HWY * s);
      const ctx = hwyCtx({ position: pos, now: 3_600_000 + s * 1000 });
      const d = decide(ctx, clutter);
      if (d.kind === 'start_story') stories++;
      if (d.kind === 'silence') decisions.add(d.reason);
    }
    expect(stories).toBe(0);
    expect([...decisions]).toEqual(['nothing_worth_it']);
  });

  it('cadence gap: silent until minGap elapses; talkativeness scales it', () => {
    const p = policyFor('highway_driving', 'sparse');
    const target = [place('town', 'town', offset(ORIGIN, 0, 12_000, 800), 0.85, { extentM: 1500 })];
    const now = 3_600_000;
    const early = hwyCtx({ lastSpeechEndedAt: now - (p.minGapS - 30) * 1000 });
    expect(decide(early, target)).toMatchObject({ kind: 'silence', reason: 'cadence_gap' });
    const later = hwyCtx({ lastSpeechEndedAt: now - (p.minGapS + 1) * 1000 });
    expect(decide(later, target).kind).toBe('start_story');
    // quieter: gap ×1.6
    const quiet = hwyCtx({ lastSpeechEndedAt: now - (p.minGapS + 1) * 1000 });
    quiet.memory.talkativeness = -1;
    expect(decide(quiet, target)).toMatchObject({ kind: 'silence', reason: 'cadence_gap' });
    expect(gapMultiplier(-1)).toBeCloseTo(1.6);
    expect(gapMultiplier(1)).toBeCloseTo(0.7);
  });

  it('safety hold during a maneuver', () => {
    const ctx = hwyCtx();
    ctx.regime = { ...ctx.regime, turnRateDegPerS: 20 };
    ctx.safety = evaluateSafety({ regime: ctx.regime, now: ctx.now, audioRoute: 'unknown' });
    expect(ctx.safety.maneuvering).toBe(true);
    const d = decide(ctx, [place('town', 'town', offset(ORIGIN, 0, 12_000, 800), 0.85, { extentM: 1500 })]);
    expect(d).toMatchObject({ kind: 'silence', reason: 'safety_hold' });
  });

  it('screen interaction while driving holds speech onset', () => {
    const ctx = hwyCtx();
    ctx.safety = evaluateSafety({ regime: ctx.regime, now: ctx.now, audioRoute: 'bluetooth', lastInteractionAt: ctx.now - 2000 });
    expect(ctx.safety.speechHoldReasons).toContain('screen_interaction_while_driving');
    expect(decide(ctx, [place('town', 'town', offset(ORIGIN, 0, 12_000, 800), 0.85, { extentM: 1500 })])).toMatchObject({ reason: 'safety_hold' });
  });

  it('below threshold → silence(nothing_worth_it) with best attached', () => {
    const d = decide(hwyCtx(), [place('meh', 'historic_site', offset(ORIGIN, 0, 8000, 300), 0.56)]);
    expect(d.kind).toBe('silence');
    if (d.kind === 'silence') {
      expect(d.reason).toBe('nothing_worth_it');
      expect(d.best?.place.id).toBe('meh');
      expect(d.reevaluateInMs).toBe(10_000);
    }
  });

  it('start_story: durations fit ETA-to-pass and regime cap', () => {
    // town 3.2 km ahead: ETA-to-pass (along+extent)/speed = (3200+500)/30 ≈ 123 s → cap 75 s wins.
    const d = decide(hwyCtx(), [place('town', 'town', offset(ORIGIN, 0, 3200, 300), 0.85, { extentM: 500 })]);
    expect(d.kind).toBe('start_story');
    if (d.kind !== 'start_story') return;
    expect(d.durationBudgetS).toBeLessThanOrEqual(75);
    expect(d.maxWords).toBe(Math.round(d.durationBudgetS * 2.4));
    // landmark 2.4 km ahead (ETA 80 s) → budget ≤ 80 − 10
    const ctx2 = hwyCtx();
    const d2 = decide(ctx2, [place('lm', 'landmark', offset(ORIGIN, 0, 2400, 100), 0.9)]);
    expect(d2.kind).toBe('start_story');
    if (d2.kind !== 'start_story') return;
    expect(d2.durationBudgetS).toBeLessThanOrEqual(70);
    expect(d2.durationBudgetS).toBeGreaterThanOrEqual(10);
    const b = storyBudget(ctx2, d2.target, GUIDE);
    expect(b.durationBudgetS).toBe(d2.durationBudgetS);
  });

  it('story playing → continue; preempt only for major here/imminent features while driving', () => {
    const story: ActiveStoryState = { planId: 'p1', placeId: 'ridge', status: 'playing', startedAt: 0, segmentIndex: 1, offsetMs: 0, segmentCount: 6, interruptedAt: null, interruptionCause: null };
    const ridge = place('ridge', 'natural_feature', offset(ORIGIN, 0, 9000, 2000), 0.7);
    const town = place('town', 'town', offset(ORIGIN, 0, 1200, 200), 0.85, { extentM: 1500 }); // here-ish, not major
    const city = place('city', 'city', offset(ORIGIN, 0, -1000, 0), 0.95, { extentM: 3000 }); // we're inside
    const ctx = hwyCtx();
    ctx.activeStory = story;
    expect(decide(ctx, [ridge, town])).toEqual({ kind: 'continue_story' });
    const d = decide(ctx, [ridge, town, city], { activeStorySignificance: 0.7 });
    expect(d).toMatchObject({ kind: 'start_story', preempt: true });
    // walking never preempts
    const w = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban' });
    w.activeStory = story;
    expect(decide(w, [place('big', 'landmark', ORIGIN, 0.99, { extentM: 100 })])).toEqual({ kind: 'continue_story' });
  });

  it('interrupted story → resume/abandon via ResumePolicy', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 100_000 });
    ctx.activeStory = { planId: 'p', placeId: 'x', status: 'interrupted', startedAt: 0, segmentIndex: 2, offsetMs: 3000, segmentCount: 5, interruptedAt: 95_000, interruptionCause: 'user_speech' };
    const d = decide(ctx, [place('x', 'museum', offset(ORIGIN, 0, 100, 0), 0.8)]);
    expect(d).toEqual({ kind: 'resume_story', decision: { action: 'resume', fromSegment: 2, bridge: false } });
  });

  it('listening and user pause silence the director', () => {
    const ctx = hwyCtx();
    expect(decide(ctx, [], { listening: true })).toMatchObject({ reason: 'listening' });
    expect(decide(ctx, [], { userPaused: true })).toMatchObject({ reason: 'user_paused' });
  });

  it('walking: speaks for a worthy nearby place with full mode and walking re-evaluation', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'dense', now: 600_000 });
    const d = decide(ctx, [place('mem', 'memorial', offset(ORIGIN, 0, 120, 10), 0.95, { extentM: 60 })]);
    expect(d.kind).toBe('start_story');
    if (d.kind === 'start_story') {
      expect(d.mode).toBe('full');
      expect(d.durationBudgetS).toBe(120);
    }
    const s = decide(ctx, []);
    expect(s).toMatchObject({ kind: 'silence', reevaluateInMs: 3000 });
  });

  it('angle choice respects guide preference, recent use and available fact kinds', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 600_000 });
    const p = place('m', 'museum', offset(ORIGIN, 0, 100, 0), 0.9);
    const d1 = decide(ctx, [p], { factKinds: { m: ['identity', 'date', 'person'] } });
    expect(d1.kind === 'start_story' && d1.angle).toBe('origin');
    ctx.memory.discussed['a'] = { placeId: 'a', placeName: 'A', at: 1, depth: 'story', completed: true, angle: 'origin' };
    const d2 = decide(ctx, [p], { factKinds: { m: ['identity', 'date', 'person'] } });
    expect(d2.kind === 'start_story' && d2.angle).toBe('people');
    const d3 = decide(ctx, [p], { factKinds: { m: ['identity', 'architecture'] } });
    expect(d3.kind === 'start_story' && d3.angle).toBe('architecture');
  });
});
