import { describe, expect, it } from 'vitest';
import type { EvidenceFact, EvidencePack, MomentDecision, StoryBrief } from '../src/index.js';
import {
  buildOrientation,
  buildStoryBrief,
  checkGrounding,
  distancePhrase,
  extractEntities,
  extractNumbers,
  scoreCandidates,
  segmentNarrative,
  selectFacts,
  spatialCue,
  templateNarrative,
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
    fact('f6', 'trivia', 'Low-confidence rumor about ghosts.', [], [], 0.2),
  ],
};

function briefFor(maxWords = 120, locale = 'en', angle: StoryBrief['angle'] = 'origin'): StoryBrief {
  const ctx = makeCtx({ position: ORIGIN, regime: 'urban_driving', speed: 15, course: 0, density: 'urban', now: 5_000_000, locale });
  const target = scoreCandidates(ctx, [place('p', 'bridge', offset(ORIGIN, 0, 2500, 300), 0.95, { name: 'Harbor Span' })], undefined, { guide: GUIDE })[0]!;
  const d: Extract<MomentDecision, { kind: 'start_story' }> = { kind: 'start_story', target, mode: 'short', angle, durationBudgetS: Math.round(maxWords / 2.4), maxWords, preempt: false };
  return buildStoryBrief(d, PACK, GUIDE, ctx);
}

describe('StoryBrief', () => {
  it('selects identity first, respects confidence and budget, is deterministic', () => {
    const f = selectFacts(PACK, 'origin', 60);
    expect(f[0]!.id).toBe('f1');
    expect(f.map((x) => x.id)).not.toContain('f6');
    expect(selectFacts(PACK, 'origin', 60)).toEqual(f);
    expect(f.reduce((s, x) => s + wordCount(x.text), 0)).toBeLessThanOrEqual(Math.floor(60 * 0.75));
    const tiny = selectFacts(PACK, 'numbers', 10);
    expect(tiny.length).toBeGreaterThanOrEqual(1);
    expect(tiny[0]!.kind).toBe('identity');
  });

  it('angle affinity changes the second fact', () => {
    expect(selectFacts(PACK, 'people', 200)[1]!.kind).toBe('person');
    expect(selectFacts(PACK, 'numbers', 200)[1]!.kind).toBe('quantity');
  });

  it('brief carries budgets, spatial cue, no questions while driving', () => {
    const b = briefFor();
    expect(b.maxWords).toBe(120);
    expect(b.spatialCue).toMatch(/^ahead on your right, about/);
    expect(b.allowQuestionsToUser).toBe(false);
    expect(b.placeName).toBe('Harbor Span');
    expect(briefFor()).toEqual(b);
  });

  it('journey callbacks from memory with shared tags', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', now: 9_000_000 });
    ctx.memory.discussed['old'] = { placeId: 'old', placeName: 'Old Ferry Pier', at: 1, depth: 'story', completed: true, tags: ['harbor'] };
    ctx.memory.discussed['x'] = { placeId: 'x', placeName: 'Unrelated', at: 2, depth: 'story', completed: true, tags: ['desert'] };
    const target = scoreCandidates(ctx, [place('p', 'bridge', offset(ORIGIN, 0, 100, 0), 0.9, { tags: ['harbor'] })])[0]!;
    const b = buildStoryBrief({ kind: 'start_story', target, mode: 'full', angle: 'connection', durationBudgetS: 100, maxWords: 250, preempt: false }, PACK, GUIDE, ctx);
    expect(b.journeyCallbacks).toEqual(['Old Ferry Pier']);
    expect(b.allowQuestionsToUser).toBe(true);
  });
});

describe('spatial cues EN/RU and units', () => {
  const g = { distanceM: 3100, bearingDeg: 10, relativeBearingDeg: 10, alongTrackM: 3000, crossTrackM: 400, etaS: 100, relative: 'ahead' as const, side: 'right' as const };
  it('EN metric / US imperial / RU', () => {
    expect(spatialCue(g, { extentM: 0 }, 'en')).toBe('ahead on your right, about 3 kilometres');
    expect(spatialCue(g, { extentM: 0 }, 'en-US')).toBe('ahead on your right, about 2 miles');
    expect(spatialCue(g, { extentM: 0 }, 'ru')).toBe('впереди справа, примерно в трёх километрах');
    expect(spatialCue({ ...g, side: 'left' }, { extentM: 0 }, 'ru')).toBe('впереди слева, примерно в трёх километрах');
    expect(spatialCue({ ...g, relative: 'here' }, { extentM: 5000 }, 'en')).toBe("you're passing through it now");
  });
  it('distance phrases', () => {
    expect(distancePhrase(120, 'metric').en).toBe('about 100 metres');
    expect(distancePhrase(40_000, 'metric').en).toBe('about 40 kilometres');
    expect(distancePhrase(40_000, 'imperial').en).toBe('about 25 miles');
    expect(distancePhrase(50, 'imperial').en).toBe('about 200 feet');
    expect(distancePhrase(700, 'imperial').en).toBe('about half a mile');
  });
});

describe('GroundingCheck', () => {
  const b = briefFor(120);

  it('extracts numbers incl. thousands separators and spelled-out EN', () => {
    expect(extractNumbers('In 1937 the 1,280 metre span and twenty-three towers, two hundred cables')).toEqual(['1937', '1280', '23', '200']);
  });

  it('extracts EN multi-word entities, ignoring sentence-initial ambiguity', () => {
    expect(extractEntities('Its chief engineer was Ada Merrow. The Harbor Span opened. Then we drove to Port of Sands.')).toEqual(['Ada Merrow', 'Harbor Span', 'Port of Sands']);
  });

  it('passes the deterministic template output', () => {
    const t = templateNarrative(b, GUIDE);
    const r = checkGrounding(t, b);
    expect(r).toMatchObject({ ok: true, unsupportedNumbers: [], unsupportedEntities: [], overBudget: false });
  });

  it('catches an invented year', () => {
    const r = checkGrounding('Harbor Span opened to traffic in 1936, after years of work.', b);
    expect(r.ok).toBe(false);
    expect(r.unsupportedNumbers).toEqual(['1936']);
  });

  it('catches an invented number spelled out', () => {
    expect(checkGrounding('It took four thousand workers to build Harbor Span.', b).unsupportedNumbers).toEqual(['4000']);
  });

  it('catches an invented name', () => {
    const r = checkGrounding('Its chief engineer was Ada Merrow, helped by John Fielding.', b);
    expect(r.unsupportedEntities).toEqual(['John Fielding']);
  });

  it('accepts supported names, possessives, cue numbers', () => {
    const r = checkGrounding(`${b.spatialCue}, is Harbor Span. Ada Merrow's towers are painted a deep orange.`, b);
    expect(b.spatialCue).toMatch(/\d/);
    expect(r.unsupportedNumbers).toEqual([]);
    expect(r.unsupportedEntities).toEqual([]);
    expect(r).toMatchObject({ ok: true });
  });

  it('flags over-budget text (> maxWords × 1.15)', () => {
    const small = briefFor(20);
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    expect(checkGrounding(long, small).overBudget).toBe(true);
  });

  it('RU: case endings of supported names pass; invented names fail', () => {
    const ru = { ...b, locale: 'ru', facts: [fact('r1', 'person', 'Главным инженером была Ада Мерроу.', ['Ада Мерроу']), fact('r2', 'date', 'Мост открыли в 1937 году.', [], ['1937'])] };
    expect(checkGrounding('Мост спроектировала Ада Мерроу, его открыли в 1937 году.', ru).ok).toBe(true);
    const bad = checkGrounding('Мост построил Иван Петров в 1935 году.', ru);
    expect(bad.unsupportedEntities).toContain('Иван Петров');
    expect(bad.unsupportedNumbers).toEqual(['1935']);
  });
});

describe('segmentation and template', () => {
  it('segments into 8–18 s groups with stable ids/hashes', () => {
    const b = briefFor(200);
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} tells a small part of the story in about twelve words.`).join(' ');
    const p = segmentNarrative(text, b, GUIDE, 123);
    expect(p.segments.length).toBeGreaterThan(2);
    for (const s of p.segments.slice(0, -1)) {
      expect(s.estDurationMs).toBeGreaterThanOrEqual(8000);
      expect(s.estDurationMs).toBeLessThanOrEqual(18_000);
    }
    const again = segmentNarrative(text, b, GUIDE, 999);
    expect(again.segments.map((s) => [s.id, s.hash])).toEqual(p.segments.map((s) => [s.id, s.hash]));
    expect(p.segments.map((s) => s.index)).toEqual(p.segments.map((_, i) => i));
    // voice change → different TTS cache key, same text
    const other = segmentNarrative(text, b, { ...GUIDE, voice: { ...GUIDE.voice, byProvider: { fake: 'v2' } } }, 1);
    expect(other.segments[0]!.hash).not.toBe(p.segments[0]!.hash);
    expect(p.segments.map((s) => s.text).join(' ')).toBe(text);
  });

  it('tags segments with the facts they use', () => {
    const b = briefFor(200);
    const p = segmentNarrative(templateNarrative(b, GUIDE), b, GUIDE, 0);
    expect(p.segments.flatMap((s) => s.factIds)).toContain('f1');
  });

  it('template respects the word budget and keeps the identity fact', () => {
    const b = briefFor(25);
    const t = templateNarrative(b, GUIDE);
    expect(wordCount(t)).toBeLessThanOrEqual(Math.max(25, wordCount(PACK.facts[0]!.text) + 12));
    expect(t).toContain(PACK.facts[0]!.text);
  });

  it('RU template is grounded', () => {
    const b = { ...briefFor(120, 'ru'), facts: [fact('r1', 'identity', 'Это висячий мост через пролив.', []), fact('r2', 'date', 'Мост открыли в 1937 году.', [], ['1937'])] };
    const t = templateNarrative(b, GUIDE);
    expect(t).toMatch(/^Впереди справа/);
    expect(checkGrounding(t, b).ok).toBe(true);
  });
});

describe('orientation (A4 weak evidence)', () => {
  it('names the place and kind only, no facts or numbers beyond the cue', () => {
    const ctx = makeCtx({ position: ORIGIN, regime: 'walking', speed: 1.4, course: 0, density: 'urban', locale: 'en-US' });
    const c = scoreCandidates(ctx, [place('v', 'venue', offset(ORIGIN, 0, 150, 60), 0.8, { name: 'Lakeside Pavilion' })], new Set(['v']))[0]!;
    const line = buildOrientation(c, 'en-US');
    expect(line).toBe('Ahead on your right, about 500 feet: Lakeside Pavilion, a venue.');
    expect(buildOrientation(c, 'ru')).toBe('Впереди справа, примерно в 150 метрах: Lakeside Pavilion, площадка.');
  });
});

describe('grounding — punctuation-insensitive entities', () => {
  it('matches parenthesised names', () => {
    const b = { ...briefFor(120), placeName: 'Central Hub (Great Hall)' };
    expect(checkGrounding('Straight ahead: Central Hub (Great Hall). Ada Merrow designed Harbor Span.', b).unsupportedEntities).toEqual([]);
  });
});
