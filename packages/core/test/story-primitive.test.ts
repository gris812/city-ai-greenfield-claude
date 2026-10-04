/**
 * D-018 story primitives, D-019 TTS tiers, D-023 retell policy, D-024 density-probe backoff.
 * Synthetic inputs only (no fixtures, no city data).
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceFact, EvidencePack, JourneyContext, MomentDecision } from '../src/index.js';
import {
  DEFAULT_TTS_TIERS,
  REFRESH,
  STORY_PRIMITIVE,
  buildStoryParts,
  checkGrounding,
  checkPrefix,
  composeStoryPlan,
  densityHintFrom,
  emptyMemory,
  recordDensityProbe,
  retellAllowed,
  scoreCandidates,
  shouldRefreshDensity,
  storyPrefix,
  templateBody,
  toldPlaces,
  ttsTierFor,
  withHistory,
  wordCount,
} from '../src/index.js';
import { GUIDE, makeCtx, offset, ORIGIN, place } from './helpers.js';

const src = { provider: 'test', ref: 'test:1', retrievedAt: 0 };
function fact(id: string, kind: EvidenceFact['kind'], text: string, entities: string[] = [], numbers: string[] = [], confidence = 0.9): EvidenceFact {
  return { id, placeId: 'p', kind, text, entities, numbers, confidence, source: src };
}
const PACK: EvidencePack = {
  placeId: 'p',
  placeName: 'Harbor Span',
  fetchedAt: 0,
  thin: false,
  facts: [
    fact('f1', 'identity', 'Harbor Span is a suspension bridge across the harbor mouth.', ['Harbor Span'], []),
    fact('f2', 'date', 'It opened to traffic in 1937.', [], ['1937']),
    fact('f3', 'person', 'Its chief engineer was Ada Merrow.', ['Ada Merrow'], []),
    fact('f4', 'quantity', 'The main span is 1,280 metres long.', [], ['1,280']),
    fact('f5', 'architecture', 'Its towers are painted a deep orange to stand out in fog.', [], []),
  ],
};

/** Same place and decision for two different "users": different session, time, position and memory. */
function partsFor(opts: { sessionId: string; now: number; alongM: number; crossM: number; callback?: boolean; maxWords?: number; locale?: string; guide?: typeof GUIDE }) {
  const ctx: JourneyContext = { ...makeCtx({ position: ORIGIN, regime: 'urban_driving', speed: 15, course: 0, density: 'urban', now: opts.now, locale: opts.locale ?? 'en' }), sessionId: opts.sessionId };
  if (opts.callback) ctx.memory = { ...emptyMemory(), discussed: { old: { placeId: 'old', placeName: 'Old Ferry Pier', at: 1, depth: 'story', completed: true, tags: ['harbor'] } } };
  const target = scoreCandidates(ctx, [place('p', 'bridge', offset(ORIGIN, 0, opts.alongM, opts.crossM), 0.95, { name: 'Harbor Span', tags: ['harbor'] })], undefined, { guide: opts.guide ?? GUIDE })[0]!;
  const maxWords = opts.maxWords ?? 144;
  const d: Extract<MomentDecision, { kind: 'start_story' }> = { kind: 'start_story', target, mode: 'short', angle: 'origin', durationBudgetS: Math.round(maxWords / 2.4), maxWords, preempt: false };
  return buildStoryParts(d, PACK, opts.guide ?? GUIDE, ctx);
}

describe('story primitives (D-018)', () => {
  it('prefix = quantized spatial cue + place name (+ callback when it fits), deterministic and grounded', () => {
    const a = partsFor({ sessionId: 's1', now: 1_000_000, alongM: 2300, crossM: 300 });
    expect(a.prefix).toMatch(/^Ahead on your right, about \d+(\.\d+)? kilometres: Harbor Span\.$/);
    expect(partsFor({ sessionId: 's1', now: 1_000_000, alongM: 2300, crossM: 300 }).prefix).toBe(a.prefix);
    expect(checkPrefix(a, GUIDE).ok).toBe(true);
    const cb = partsFor({ sessionId: 's1', now: 1_000_000, alongM: 2300, crossM: 300, callback: true });
    expect(cb.prefix).toContain('Old Ferry Pier');
    expect(checkPrefix(cb, GUIDE).ok).toBe(true);
    expect(wordCount(cb.prefix)).toBeLessThanOrEqual(STORY_PRIMITIVE.PREFIX_RESERVE_WORDS);
    // quantization: nearby positions give the same cue → the prefix audio repeats across users
    expect(partsFor({ sessionId: 's9', now: 7, alongM: 2250, crossM: 320 }).prefix).toBe(a.prefix);
    expect(storyPrefix({ spatialCue: null, placeName: 'Harbor Span', journeyCallbacks: [], locale: 'ru' })).toBe('Перед нами — Harbor Span.');
  });

  it('body key and body brief are identical across users/sessions and contain nothing session-specific', () => {
    const a = partsFor({ sessionId: 'session-A', now: 1_000_000, alongM: 2500, crossM: 300 });
    const b = partsFor({ sessionId: 'session-B', now: 9_999_999, alongM: 1800, crossM: -250, callback: true });
    expect(a.prefix).not.toBe(b.prefix); // context differs
    expect(b.bodyKey).toBe(a.bodyKey); // body is shared
    expect(b.bodyBrief).toEqual(a.bodyBrief);
    const json = JSON.stringify(a.bodyBrief);
    expect(json).not.toContain('session-A');
    expect(json).not.toContain('1000000');
    expect(json).not.toContain('Old Ferry Pier');
    expect(a.bodyBrief.spatialCue).toBeNull();
    expect(a.bodyBrief.journeyCallbacks).toEqual([]);
    expect(a.bodyBrief.id).toBe(a.bodyKey);
    // the session brief stays session-specific
    expect(a.brief.id).not.toBe(b.brief.id);
  });

  it('key changes with guide, language, budget bucket and fact text — not with small budget changes', () => {
    const base = partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300 });
    expect(partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300, guide: { ...GUIDE, id: 'g2' } }).bodyKey).not.toBe(base.bodyKey);
    expect(partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300, locale: 'ru' }).bodyKey).not.toBe(base.bodyKey);
    expect(partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300, maxWords: 60 }).bodyKey).not.toBe(base.bodyKey);
    expect(partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300, maxWords: 147 }).bodyKey).toBe(base.bodyKey); // same bucket
    const orig = PACK.facts[1]!.text;
    try {
      PACK.facts[1] = { ...PACK.facts[1]!, text: 'It opened to traffic in 1937 after four years of work.' };
      expect(partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300 }).bodyKey).not.toBe(base.bodyKey);
    } finally {
      PACK.facts[1] = { ...PACK.facts[1]!, text: orig };
    }
  });

  it('prefix + body never exceed the decided word budget; body template is grounded against the body brief', () => {
    for (const maxWords of [40, 72, 144, 300]) {
      const p = partsFor({ sessionId: 's', now: 1, alongM: 2500, crossM: 300, callback: true, maxWords });
      expect(p.bodyBrief.maxWords % STORY_PRIMITIVE.BUDGET_BUCKET_WORDS === 0 || p.bodyBrief.maxWords === STORY_PRIMITIVE.MIN_BODY_WORDS).toBe(true);
      if (maxWords >= STORY_PRIMITIVE.PREFIX_RESERVE_WORDS + STORY_PRIMITIVE.MIN_BODY_WORDS) expect(wordCount(p.prefix) + p.bodyBrief.maxWords).toBeLessThanOrEqual(maxWords);
      const body = templateBody(p.bodyBrief);
      expect(wordCount(body)).toBeLessThanOrEqual(p.bodyBrief.maxWords);
      expect(checkGrounding(body, p.bodyBrief, { allow: [GUIDE.name] }).ok).toBe(true);
      // the full brief carries exactly the body's facts (follow-ups continue from them)
      expect(p.brief.facts.map((f) => f.id)).toEqual(p.bodyBrief.facts.map((f) => f.id));
    }
  });

  it('plan = prefix segment + body segments; body segment hashes are shared across users', () => {
    const a = partsFor({ sessionId: 'A', now: 1, alongM: 2500, crossM: 300 });
    const b = partsFor({ sessionId: 'B', now: 2, alongM: 1500, crossM: -200, callback: true });
    const text = templateBody(a.bodyBrief);
    const g = checkGrounding(text, a.bodyBrief);
    const pa = composeStoryPlan(a, text, GUIDE, 1, { bodyGrounding: g, prefixGrounding: checkPrefix(a, GUIDE) });
    const pb = composeStoryPlan(b, text, GUIDE, 2, { bodyGrounding: g, prefixGrounding: checkPrefix(b, GUIDE) });
    expect(pa.segments[0]!.text).toBe(a.prefix);
    expect(pa.segments.map((s) => s.index)).toEqual(pa.segments.map((_, i) => i));
    expect(pa.segments.slice(1).map((s) => s.hash)).toEqual(pb.segments.slice(1).map((s) => s.hash));
    expect(pa.segments[0]!.hash).not.toBe(pb.segments[0]!.hash);
    expect(pa.id).not.toBe(pb.id);
    expect(pa.placeId).toBe('p');
    expect(pa.grounding!.ok).toBe(true);
  });
});

describe('TTS tiers (D-019)', () => {
  it('defaults: highway stories economy, everything else standard, prefix matches its story', () => {
    expect(ttsTierFor('story_body', 'highway_driving')).toBe('economy');
    expect(ttsTierFor('story_prefix', 'highway_driving')).toBe('economy');
    expect(ttsTierFor('story_body', 'walking')).toBe('standard');
    expect(ttsTierFor('story_prefix', 'walking')).toBe('standard');
    expect(ttsTierFor('answer', 'highway_driving')).toBe('standard');
    expect(ttsTierFor('ack', 'walking')).toBe('standard');
  });
  it('configurable: walking stories and pinned prefix tier', () => {
    const cfg = { ...DEFAULT_TTS_TIERS, stories: { ...DEFAULT_TTS_TIERS.stories, walking: 'economy' as const }, prefix: 'standard' as const };
    expect(ttsTierFor('story_body', 'walking', cfg)).toBe('economy');
    expect(ttsTierFor('story_prefix', 'walking', cfg)).toBe('standard');
  });
});

describe('cross-session retell policy (D-023)', () => {
  const DAY = 86_400_000;
  it('retellAllowed is a pure window check', () => {
    expect(retellAllowed(undefined, 5)).toBe(true);
    expect(retellAllowed(0, 29 * DAY, 30)).toBe(false);
    expect(retellAllowed(0, 30 * DAY, 30)).toBe(true);
    expect(retellAllowed(0, 0, 0)).toBe(true);
  });
  it('a place told in an earlier session is suppressed as told_recently until the window passes', () => {
    const now = 100 * DAY;
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, now });
    const p = place('p', 'monument', offset(ORIGIN, 0, 120, 0), 0.9);
    ctx.memory = withHistory(emptyMemory(), { p: now - 3 * DAY });
    expect(scoreCandidates(ctx, [p])[0]!.suppressedBy).toContain('told_recently');
    expect(scoreCandidates(ctx, [p], undefined, { retellAfterDays: 2 })[0]!.suppressedBy).not.toContain('told_recently');
    ctx.memory = withHistory(emptyMemory(), { p: now - 45 * DAY });
    expect(scoreCandidates(ctx, [p])[0]!.suppressedBy).not.toContain('told_recently');
  });
  it('withHistory keeps the newest entries only; toldPlaces excludes mentions', () => {
    const m = withHistory(emptyMemory(), { a: 1, b: 3, c: 2 }, 2);
    expect(Object.keys(m.history!)).toEqual(['b', 'c']);
    const mem = { ...emptyMemory(), discussed: { x: { placeId: 'x', placeName: 'X', at: 5, depth: 'story' as const, completed: true }, y: { placeId: 'y', placeName: 'Y', at: 6, depth: 'mention' as const, completed: true } } };
    expect(toldPlaces(mem)).toEqual([{ placeId: 'x', at: 5 }]);
  });
});

describe('density probe backoff (D-024)', () => {
  const hw = (now: number, alongM: number, density: JourneyContext['density']['density'] = 'sparse') => makeCtx({ position: offset(ORIGIN, 0, alongM, 0), regime: 'highway_driving', speed: 30, course: 0, now, density });
  const base = REFRESH.DENSITY_MIN_INTERVAL_S.highway_driving * 1000;

  it('probes that keep confirming the class back off up to ×4 on the highway; a regime change resets', () => {
    let rec = recordDensityProbe(null, hw(0, 0), 3, 'sparse');
    expect(rec.stableStreak).toBe(0);
    rec = recordDensityProbe(rec, hw(base, 2700), 3, 'sparse');
    expect(rec.stableStreak).toBe(1);
    expect(shouldRefreshDensity(rec, hw(2 * base, 5400))).toBe(false); // ×2 now
    expect(shouldRefreshDensity(rec, hw(3 * base, 8100))).toBe(true);
    rec = recordDensityProbe(rec, hw(3 * base, 8100), 3, 'sparse');
    rec = recordDensityProbe(rec, hw(7 * base, 20000), 3, 'sparse');
    expect(rec.stableStreak).toBe(3);
    expect(shouldRefreshDensity(rec, hw(7 * base + 3.9 * base, 30000))).toBe(false); // capped at ×4
    expect(shouldRefreshDensity(rec, hw(7 * base + 4 * base, 30000))).toBe(true);
    const urban = makeCtx({ position: offset(ORIGIN, 0, 21000, 0), regime: 'urban_driving', speed: 12, course: 0, now: 7 * base + REFRESH.DENSITY_MIN_INTERVAL_S.urban_driving * 1000 });
    expect(shouldRefreshDensity(rec, urban)).toBe(true);
    // a class change resets the streak
    expect(recordDensityProbe(rec, hw(12 * base, 40000), 9, 'suburban').stableStreak).toBe(0);
  });

  it('a discovery result covering the probe area that proves a denser class pulls the probe forward', () => {
    let rec = recordDensityProbe(null, hw(0, 0), 3, 'sparse');
    rec = recordDensityProbe(rec, hw(base, 2700), 3, 'sparse');
    const ctx = hw(base * 2.5, 6000); // past the base interval, inside the ×2 stable backoff
    expect(shouldRefreshDensity(rec, ctx)).toBe(false);
    const center = ctx.position!;
    const many = Array.from({ length: 40 }, (_, i) => place(`c${i}`, 'building', offset(center, (i * 37) % 360, 100 + (i % 7) * 120, 0), 0.6));
    const covering = { center, radiusM: 20_000 };
    const hint = densityHintFrom(ctx, { query: covering, candidates: many });
    expect(hint).not.toBeNull();
    expect(shouldRefreshDensity(rec, ctx, hint)).toBe(true);
    // a query that does not cover the probe circle gives no hint
    expect(densityHintFrom(ctx, { query: { center: offset(center, 0, 30_000, 0), radiusM: 5000 }, candidates: many })).toBeNull();
    // a sparse hint never pulls a probe forward
    expect(shouldRefreshDensity(rec, ctx, 0)).toBe(false);
  });
});
