/**
 * D-019 Google Cloud TTS + tiered routing, D-020 streaming (SSE adapters, router, sentence-level
 * grounding), D-021 prompt trim. No network: recorded-shape payloads through a mock fetch.
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceFact, EvidencePack, GuideProfile, StoryBrief } from '@city/core';
import { IDA, EMIL, checkGrounding } from '@city/core';
import { AnthropicTextGenerator } from '../src/adapters/anthropic.js';
import { GeminiTextGenerator } from '../src/adapters/gemini.js';
import { GoogleCloudSpeechSynthesizer, googleLanguageCode, googleVoiceFamily } from '../src/adapters/google-tts.js';
import { OpenAITextGenerator } from '../src/adapters/openai.js';
import { silentMp3 } from '../src/audio.js';
import { providerConfigFromEnv, ttsTiersFromEnv } from '../src/config.js';
import { FakeSpeechSynthesizer, FakeTextGenerator } from '../src/fakes.js';
import type { FetchLike } from '../src/http.js';
import { ProviderGuard } from '../src/metered.js';
import { computeCost } from '../src/pricing.js';
import { followUpPrompt, intentPrompt, storyBodyPrompt, storyPrompt } from '../src/prompts.js';
import { ProviderBudget } from '../src/resilience.js';
import { ProviderRouter, buildProviderSet, type ProviderSet } from '../src/router.js';
import { generateGroundedBody, streamGroundedAnswer, takeSentences, type GenerateFn } from '../src/story.js';
import { NULL_COST_SINK, type GenerateRequest, type GenerateResult, type TextGenerator } from '../src/types.js';

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchLike & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FetchLike & { calls: typeof calls };
  f.calls = calls;
  return f;
}
/** SSE body delivered in awkward chunks (split mid-line) to exercise the parser. */
function sse(blocks: string[], chunk = 7): Response {
  const text = blocks.map((b) => `${b}\n\n`).join('');
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < text.length; i += chunk) c.enqueue(enc.encode(text.slice(i, i + chunk)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const req = (onDelta?: (d: string) => void): GenerateRequest => ({ system: 's', prompt: 'p', maxOutputTokens: 100, task: 'followup_answer', ...(onDelta ? { onDelta } : {}) });

describe('SSE streaming adapters (D-020)', () => {
  it('OpenAI: stream + include_usage, deltas in order, usage from the final chunk', async () => {
    const f = mockFetch(() =>
      sse([
        `data: ${JSON.stringify({ model: 'gpt-6-luna', choices: [{ delta: { role: 'assistant' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'It opened ' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'in 1937. ' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'That is all.' } }] })}`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 10 } } })}`,
        'data: [DONE]',
      ]),
    );
    const g = new OpenAITextGenerator({ apiKey: 'sk-test-123456789', model: 'gpt-6-luna', fetchImpl: f });
    const deltas: string[] = [];
    const r = await g.generate(req((d) => deltas.push(d)));
    expect(deltas).toEqual(['It opened ', 'in 1937. ', 'That is all.']);
    expect(r).toMatchObject({ text: 'It opened in 1937. That is all.', model: 'gpt-6-luna', usage: { inputTokens: 50, outputTokens: 9, cachedInputTokens: 10 } });
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('Gemini: streamGenerateContent?alt=sse, parts concatenated, usageMetadata of the last chunk', async () => {
    const f = mockFetch(() =>
      sse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'First. ' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Second.' }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 4 }, modelVersion: 'gemini-3.1-flash-lite' })}`,
      ]),
    );
    const g = new GeminiTextGenerator({ apiKey: 'AIzaTESTTESTTESTTESTTESTTEST', model: 'gemini-3.1-flash-lite', fetchImpl: f });
    const deltas: string[] = [];
    const r = await g.generate(req((d) => deltas.push(d)));
    expect(f.calls[0]!.url).toContain(':streamGenerateContent?alt=sse');
    expect(deltas).toEqual(['First. ', 'Second.']);
    expect(r).toMatchObject({ text: 'First. Second.', usage: { inputTokens: 40, outputTokens: 4 } });
  });

  it('Anthropic: message_start/content_block_delta/message_delta; stream errors surface', async () => {
    const f = mockFetch(() =>
      sse([
        `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 30, output_tokens: 1 } } })}`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } })}`,
        `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'there.' } })}`,
        `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 3 } })}`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
      ]),
    );
    const g = new AnthropicTextGenerator({ apiKey: 'k', model: 'claude-haiku-4-5', fetchImpl: f });
    const deltas: string[] = [];
    const r = await g.generate(req((d) => deltas.push(d)));
    expect(deltas).toEqual(['Hello ', 'there.']);
    expect(r).toMatchObject({ text: 'Hello there.', usage: { inputTokens: 30, outputTokens: 3 } });
    expect(JSON.parse(String(f.calls[0]!.init.body)).stream).toBe(true);
    const bad = new AnthropicTextGenerator({ apiKey: 'k', model: 'm', fetchImpl: mockFetch(() => sse([`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } })}`])) });
    await expect(bad.generate(req(() => undefined))).rejects.toMatchObject({ kind: 'server' });
  });

  it('non-streaming requests are unchanged (no stream flag)', async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    await new OpenAITextGenerator({ apiKey: 'k', model: 'm', fetchImpl: f }).generate(req());
    expect(JSON.parse(String(f.calls[0]!.init.body)).stream).toBeUndefined();
  });
});

describe('router streaming (D-020)', () => {
  const guard = () => new ProviderGuard({ sink: NULL_COST_SINK, budget: new ProviderBudget() });
  const set = (story: TextGenerator[]): ProviderSet => ({ story, intent: [], tts: [], stt: [], realtime: [], places: [], knowledge: [], nearby: [] });

  it('a provider that failed after emitting text is neither retried nor replaced by a fallback', async () => {
    const failing: TextGenerator = {
      name: 'first',
      model: 'm',
      async generate(r: GenerateRequest): Promise<GenerateResult> {
        r.onDelta?.('Partial sentence. ');
        throw Object.assign(new Error('boom'), { status: 500 });
      },
    };
    const backup = new FakeTextGenerator({}, 'backup');
    const router = new ProviderRouter(set([failing, backup]), guard());
    const deltas: string[] = [];
    await expect(router.generator('followup', { sessionId: 's' })!({ ...req((d) => deltas.push(d)) })).rejects.toBeTruthy();
    expect(deltas).toEqual(['Partial sentence. ']);
    expect(backup.calls).toBe(0);
  });

  it('a provider that failed before emitting falls back as usual', async () => {
    const failing = new FakeTextGenerator({ failWith: 'server' }, 'first');
    const backup = new FakeTextGenerator({}, 'backup');
    const router = new ProviderRouter(set([failing, backup]), guard());
    const r = await router.generator('followup', { sessionId: 's' })!(req(() => undefined));
    expect(r.provider).toBe('backup');
  });
});

// ─────────────────────────────────────────────── sentence-level grounding

const src = { provider: 'test', ref: 'test:1', retrievedAt: 0 };
const fact = (id: string, text: string, entities: string[] = [], numbers: string[] = []): EvidenceFact => ({ id, placeId: 'p', kind: 'trivia', text, entities, numbers, confidence: 0.9, source: src });
const BRIEF: StoryBrief = {
  id: 'b',
  placeId: 'p',
  placeName: 'Harbor Span',
  placeKind: 'bridge',
  angle: 'origin',
  mode: 'short',
  facts: [fact('f1', 'It opened to traffic in 1937.', [], ['1937']), fact('f2', 'Its chief engineer was Ada Merrow.', ['Ada Merrow'])],
  durationBudgetS: 30,
  maxWords: 60,
  guideId: 'ida',
  locale: 'en',
  regime: 'walking',
  spatialCue: null,
  journeyCallbacks: [],
  allowQuestionsToUser: false,
};
/** A GenerateFn that streams the given sentences word by word. */
function scripted(text: string, failAfter?: number): GenerateFn {
  return async (r) => {
    const words = text.match(/\s*\S+/g) ?? [];
    for (let i = 0; i < words.length; i++) {
      if (failAfter !== undefined && i === failAfter) throw new Error('stream cut');
      r.onDelta?.(words[i]!);
    }
    return { text, model: 'm', provider: 'p', usage: { inputTokens: 10, outputTokens: 10 } };
  };
}

describe('streamGroundedAnswer (D-020)', () => {
  it('takeSentences splits on sentence boundaries and keeps the unfinished rest', () => {
    expect(takeSentences('One two. Three four! Fi')).toEqual({ sentences: ['One two.', 'Three four!'], rest: 'Fi' });
    expect(takeSentences('It is 3.5 metres. Next')).toEqual({ sentences: ['It is 3.5 metres.'], rest: 'Next' });
  });

  it('emits grounded sentences as they complete, in order', async () => {
    const out: Array<[string, number]> = [];
    const r = await streamGroundedAnswer('why?', BRIEF, IDA, scripted('It opened in 1937. The engineer was Ada Merrow.'), (t, i) => out.push([t, i]));
    expect(out).toEqual([
      ['It opened in 1937.', 0],
      ['The engineer was Ada Merrow.', 1],
    ]);
    expect(r).toMatchObject({ generatedBy: { kind: 'llm' }, replaced: 0, dropped: 0 });
    expect(r.grounding.ok).toBe(true);
  });

  it('replaces an unsupported sentence by the next unspoken fact, drops it when none is left', async () => {
    const out: string[] = [];
    const r = await streamGroundedAnswer('why?', BRIEF, IDA, scripted('It opened in 1937. It was designed by Johann Fakename in 1492. Also 1888 happened.'), (t) => out.push(t));
    expect(out[0]).toBe('It opened in 1937.');
    expect(out[1]).toBe('Its chief engineer was Ada Merrow.'); // replacement (deterministic fact)
    expect(out).toHaveLength(2); // third unsupported sentence: nothing left to replace it with → dropped
    expect(r).toMatchObject({ replaced: 1, dropped: 1 });
    for (const t of out) expect(checkGrounding(t, { ...BRIEF, maxWords: 999 }).ok).toBe(true);
  });

  it('respects the word budget', async () => {
    const out: string[] = [];
    const long = Array.from({ length: 12 }, () => 'It opened to traffic in 1937 and people came to see it.').join(' ');
    const r = await streamGroundedAnswer('why?', { ...BRIEF, maxWords: 25 }, IDA, scripted(long), (t) => out.push(t));
    expect(out.join(' ').split(/\s+/).length).toBeLessThanOrEqual(Math.ceil(25 * 1.15));
    expect(r.truncated).toBeGreaterThan(0);
  });

  it('provider failure before any sentence → deterministic answer; after a sentence → keeps what was spoken', async () => {
    const a: string[] = [];
    const r1 = await streamGroundedAnswer('why?', BRIEF, IDA, scripted('It opened in 1937.', 1), (t) => a.push(t));
    expect(r1.generatedBy.kind).toBe('template');
    expect(a.join(' ')).toContain('1937');
    const b: string[] = [];
    const r2 = await streamGroundedAnswer('why?', BRIEF, IDA, scripted('It opened in 1937. The engineer was Ada Merrow.', 6), (t) => b.push(t));
    expect(b).toEqual(['It opened in 1937.']);
    expect(r2.fallbackReason).toBe('generator_error');
  });

  it('no generator → deterministic sentences through the same callback', async () => {
    const out: string[] = [];
    const r = await streamGroundedAnswer('why?', BRIEF, IDA, null, (t) => out.push(t));
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(r.generatedBy.kind).toBe('template');
  });
});

// ─────────────────────────────────────────────── prompt trim (D-021)

describe('prompt trim (D-021)', () => {
  it('real-provider prompts carry no JSON payload block; fakes read the structured input', async () => {
    for (const p of [storyPrompt(BRIEF), storyBodyPrompt(BRIEF), followUpPrompt(BRIEF, 'why?'), intentPrompt('coffee?', 'en', {})]) {
      expect(p).not.toContain('```json');
      expect(p).not.toContain('"facts":');
    }
    const fake = new FakeTextGenerator();
    const r = await generateGroundedBody(BRIEF, IDA, async (x) => ({ ...(await fake.generate(x)), provider: 'fake' }));
    expect(fake.requests[0]!.structured).toMatchObject({ kind: 'story_body' });
    expect(fake.requests[0]!.temperature).toBe(0);
    expect(r.generatedBy.kind).toBe('llm');
    expect(r.grounding.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────── Google Cloud TTS + tiers (D-019)

describe('Google Cloud TTS adapter (D-019)', () => {
  it('REST text:synthesize with API key header, MP3, family-checked voice; priced per character by family', async () => {
    const mp3 = silentMp3(1500);
    const f = mockFetch(() => new Response(JSON.stringify({ audioContent: Buffer.from(mp3).toString('base64') }), { status: 200 }));
    const tts = new GoogleCloudSpeechSynthesizer({ apiKey: 'AIzaTESTKEYTESTKEYTESTKEY', family: 'wavenet', fetchImpl: f });
    expect(tts.model).toBe('wavenet');
    const r = await tts.synthesize({ text: 'Hello there.', voice: 'en-US-Wavenet-F', locale: 'en-US', speakingRate: 0.95 });
    expect(r.mime).toBe('audio/mpeg');
    expect(r.durationMs).toBeGreaterThan(1000);
    const call = f.calls[0]!;
    expect(call.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTESTKEYTESTKEYTESTKEY');
    expect(call.url).not.toContain('key=');
    expect(JSON.parse(String(call.init.body))).toEqual({ input: { text: 'Hello there.' }, voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F' }, audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 } });
    // a voice of another family or language is not sent (price / pronunciation safety)
    await tts.synthesize({ text: 'x', voice: 'en-US-Neural2-F', locale: 'en-US', speakingRate: 1 });
    expect(JSON.parse(String(f.calls[1]!.init.body)).voice).toEqual({ languageCode: 'en-US' });
    await tts.synthesize({ text: 'x', voice: 'en-US-Wavenet-F', locale: 'ru', speakingRate: 1 });
    expect(JSON.parse(String(f.calls[2]!.init.body)).voice).toEqual({ languageCode: 'ru-RU' });
    const at = Date.parse('2026-10-01');
    expect(computeCost('google_tts', 'wavenet', { characters: 1_000_000 }, at)).toBeCloseTo(4, 6);
    expect(computeCost('google_tts', 'standard', { characters: 1_000_000 }, at)).toBeCloseTo(4, 6);
    expect(computeCost('google_tts', 'neural2', { characters: 1_000_000 }, at)).toBeCloseTo(16, 6);
    expect(googleLanguageCode('en')).toBe('en-US');
    expect(googleVoiceFamily('ru-RU-Wavenet-C')).toBe('wavenet');
    expect(googleVoiceFamily('alloy')).toBeNull();
  });

  it('env: key + family + economy chain; tier routing and per-guide, per-language voices', () => {
    const c = providerConfigFromEnv({ GOOGLE_TTS_API_KEY: 'AIzaX', GOOGLE_TTS_VOICE_TYPE: 'standard', NODE_ENV: 'test' });
    expect(c.models.googleTtsFamily).toBe('standard');
    const s = buildProviderSet(c);
    expect(s.ttsEconomy!.map((p) => `${p.name}:${p.model}`)).toEqual(['google_tts:standard']);
    const router = new ProviderRouter(s, new ProviderGuard({ sink: NULL_COST_SINK, budget: new ProviderBudget() }));
    expect(router.plannedTts('economy')!.name).toBe('google_tts');
    expect(router.plannedTts('standard')!.name).toBe('fake'); // no standard key in this env → fake (tests)
    const g = router.plannedTts('economy')!;
    expect(router.voiceFor(g, IDA, 'en-US', 'economy')).toBe('en-US-Standard-F');
    expect(router.voiceFor(g, EMIL, 'ru', 'economy')).toBe('ru-RU-Standard-D');
    expect(router.voiceFor(g, IDA, 'en', 'economy')).not.toBe(router.voiceFor(g, EMIL, 'en', 'economy'));
    const t = ttsTiersFromEnv({ TTS_TIER_WALKING: 'economy', TTS_TIER_PREFIX: 'standard', TTS_TIER_HIGHWAY: 'bogus' });
    expect(t.stories.walking).toBe('economy');
    expect(t.stories.highway_driving).toBe('economy'); // default kept on invalid input
    expect(t.prefix).toBe('standard');
  });

  it('economy tier falls back to the standard chain; without economy providers it IS the standard chain', async () => {
    const eco = new FakeSpeechSynthesizer({ failWith: 'server' }, 'eco');
    const std = new FakeSpeechSynthesizer({}, 'std');
    const guard = new ProviderGuard({ sink: NULL_COST_SINK, budget: new ProviderBudget() });
    const router = new ProviderRouter({ story: [], intent: [], tts: [std], ttsEconomy: [eco], stt: [], realtime: [], places: [], knowledge: [], nearby: [] }, guard);
    const r = await router.synthesize({ text: 'Hi.', locale: 'en', speakingRate: 1 }, IDA as GuideProfile, { sessionId: null }, undefined, 'economy');
    expect(r.provider.name).toBe('std');
    const plain = new ProviderRouter({ story: [], intent: [], tts: [std], stt: [], realtime: [], places: [], knowledge: [], nearby: [] }, guard);
    expect(plain.plannedTts('economy')!.name).toBe('std');
    void ({} as EvidencePack);
  });
});
