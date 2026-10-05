import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EvidencePack, StoryBrief } from '@city/core';
import { EMIL, IDA, checkGrounding } from '@city/core';
import { FakeTextGenerator } from '../src/fakes.js';
import { deterministicAnswer, followUpBrief, generateGroundedAnswer, generateGroundedNarrative, type GenerateFn } from '../src/story.js';
import { heuristicIntent, validateIntentJson } from '../src/intent.js';

const packs = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/evidence/nyc-lower-manhattan.json', import.meta.url)), 'utf8')) as EvidencePack[];
const pack = packs.find((p) => p.facts.length >= 4)!;

function brief(over: Partial<StoryBrief> = {}): StoryBrief {
  return {
    id: 'brief_t',
    placeId: pack.placeId,
    placeName: pack.placeName,
    placeKind: 'memorial',
    angle: 'origin',
    mode: 'short',
    facts: pack.facts.slice(0, 3),
    durationBudgetS: 45,
    maxWords: 110,
    guideId: IDA.id,
    locale: 'en-US',
    regime: 'walking',
    spatialCue: 'just ahead on your left',
    journeyCallbacks: [],
    allowQuestionsToUser: true,
    ...over,
  };
}

const gen = (g: FakeTextGenerator): GenerateFn => async (req) => ({ ...(await g.generate(req)), provider: g.name });

describe('generateGroundedNarrative (F3)', () => {
  it('uses grounded LLM prose when it passes the check', async () => {
    const g = new FakeTextGenerator();
    const r = await generateGroundedNarrative(brief(), IDA, gen(g));
    expect(r.generatedBy).toEqual({ kind: 'llm', provider: 'fake', model: 'fake' });
    expect(r.grounding.ok).toBe(true);
    expect(r.attempts).toBe(1);
  });

  it('retries once with constraints, then accepts the corrected draft', async () => {
    const g = new FakeTextGenerator({ mode: 'hallucinate_once' });
    const r = await generateGroundedNarrative(brief(), IDA, gen(g));
    expect(r.attempts).toBe(2);
    expect(r.generatedBy.kind).toBe('llm');
    expect(r.text).not.toContain('1492');
  });

  it('falls back to the deterministic template after one failed retry (never more than 2 LLM calls)', async () => {
    const g = new FakeTextGenerator({ mode: 'hallucinate' });
    const r = await generateGroundedNarrative(brief(), IDA, gen(g));
    expect(g.calls).toBe(2);
    expect(r.generatedBy).toEqual({ kind: 'template' });
    expect(r.fallbackReason).toBe('grounding_failed');
    expect(r.grounding.ok).toBe(true);
    expect(r.text).toContain(pack.placeName);
  });

  it('falls back on generator errors without retry storms', async () => {
    const g = new FakeTextGenerator({ failWith: 'server' });
    const r = await generateGroundedNarrative(brief(), IDA, gen(g));
    expect(g.calls).toBe(1);
    expect(r.fallbackReason).toBe('generator_error');
    expect(r.grounding.ok).toBe(true);
  });

  it('works with no generator at all', async () => {
    const r = await generateGroundedNarrative(brief(), EMIL, null);
    expect(r.attempts).toBe(0);
    expect(r.generatedBy.kind).toBe('template');
  });

  it('never substitutes the target: prose that names another place fails grounding', async () => {
    const other: GenerateFn = async () => ({ text: 'Ahead is the Eiffel Tower, built in 1889.', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', provider: 'evil' });
    const r = await generateGroundedNarrative(brief(), IDA, other);
    expect(r.generatedBy.kind).toBe('template');
    expect(r.text).not.toContain('Eiffel');
  });
});

describe('follow-up answers (C2 / B1)', () => {
  it('prefers unspoken facts and stays grounded', async () => {
    const b = brief();
    const spoken = new Set(b.facts.map((f) => f.id));
    const fb = followUpBrief(b, pack, 'Why is that important?', 'ask_question', spoken, 60);
    expect(fb.facts.length).toBeGreaterThan(0);
    expect(fb.facts.every((f) => f.placeId === pack.placeId)).toBe(true);
    expect(fb.facts.some((f) => !spoken.has(f.id))).toBe(true);
    const r = await generateGroundedAnswer('Why is that important?', fb, IDA, gen(new FakeTextGenerator()));
    expect(checkGrounding(r.text, fb, { allow: [IDA.name] }).ok).toBe(true);
  });

  it('tell_more with nothing left answers honestly with no facts', () => {
    const b = brief({ facts: pack.facts });
    const fb = followUpBrief(b, pack, 'tell me more', 'tell_more', new Set(pack.facts.map((f) => f.id)), 60);
    expect(fb.facts).toEqual([]);
    expect(deterministicAnswer(fb)).toMatch(/don't have more detail/);
  });
});

describe('intent validation (closed enum)', () => {
  it('maps out-of-enum intents to unknown', () => {
    expect(validateIntentJson('{"intent":"launch_missiles","confidence":1}', 'x').intent).toBe('unknown');
    expect(validateIntentJson('not json', 'x').intent).toBe('unknown');
  });
  it('accepts nearby_search with a valid category and drops invalid ones', () => {
    const a = validateIntentJson('{"intent":"nearby_search","category":"parking","query":null,"placeRef":null,"confidence":0.9}', 'No, I meant parking');
    expect(a).toMatchObject({ intent: 'nearby_search', slots: { category: 'parking' } });
    const b = validateIntentJson('{"intent":"nearby_search","category":"casino","query":null,"placeRef":null,"confidence":0.9}', 'find a casino');
    expect(b.slots.category).toBeUndefined();
  });
  it('heuristics: barge-in correction, contextual question, topic change', () => {
    expect(heuristicIntent('No, I meant parking.', { previousIntent: 'nearby_search' })).toMatchObject({ intent: 'nearby_search', slots: { category: 'parking' } });
    expect(heuristicIntent('Why is that important?').intent).toBe('ask_question');
    expect(heuristicIntent("Let's talk about something else").intent).toBe('not_that_one');
    expect(heuristicIntent('Почему это важно?').intent).toBe('ask_question');
  });
});
