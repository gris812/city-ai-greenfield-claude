/**
 * Adapter request/response shapes against recorded-shape payloads (no network): Wikimedia,
 * Google Places, OpenAI, Gemini, Anthropic. Also checks that secrets never leak into errors.
 */
import { describe, expect, it } from 'vitest';
import { WikimediaKnowledgeSource, WikimediaPlaceSource, buildCandidates, coverageCircles, extentFor, parseEntityBindings, significanceFor, splitSummary, wikimediaUserAgent } from '../src/adapters/wikimedia.js';
import { GooglePlacesNearbySearch } from '../src/adapters/google-places.js';
import { OpenAISpeechSynthesizer, OpenAITextGenerator, OpenAIRealtimeTokenIssuer } from '../src/adapters/openai.js';
import { GeminiSpeechSynthesizer, GeminiTextGenerator } from '../src/adapters/gemini.js';
import { AnthropicTextGenerator } from '../src/adapters/anthropic.js';
import { mp3DurationMs, silentMp3, wavDurationMs } from '../src/audio.js';
import type { FetchLike } from '../src/http.js';
import { ProviderError } from '../src/errors.js';
import { polylineLengthM } from '@city/core';

interface Call {
  url: string;
  init: RequestInit;
}
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

describe('Wikimedia place source', () => {
  const geo = {
    query: {
      pages: [
        { pageid: 1, title: 'Grand Museum', coordinates: [{ lat: 10.001, lon: 20.001 }], pageprops: { wikibase_item: 'Q100' } },
        { pageid: 2, title: 'Small Cafe', coordinates: [{ lat: 10.002, lon: 20.0 }], pageprops: { wikibase_item: 'Q200' } },
        { pageid: 3, title: 'Some Battle', coordinates: [{ lat: 10.0, lon: 20.002 }], pageprops: { wikibase_item: 'Q300' } },
        { pageid: 4, title: 'Unlinked Article', coordinates: [{ lat: 10.0005, lon: 20.0005 }] },
      ],
    },
  };
  const sparql = {
    results: {
      bindings: [
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q100' }, sitelinks: { type: 'literal', value: '120' }, insts: { type: 'literal', value: 'Q33506 Q41176' }, heritage: { type: 'uri', value: 'http://www.wikidata.org/entity/Q9259' }, label: { type: 'literal', value: 'Grand Museum' } },
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q200' }, sitelinks: { type: 'literal', value: '1' }, insts: { type: 'literal', value: 'Q11707' } },
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q300' }, sitelinks: { type: 'literal', value: '40' }, insts: { type: 'literal', value: 'Q178561 Q1656682' } },
      ],
    },
  };

  it('maps geosearch + SPARQL into candidates with deterministic significance', async () => {
    const f = mockFetch((url) => (url.includes('sparql') ? json(sparql) : json(geo)));
    const src = new WikimediaPlaceSource({ fetchImpl: f, clock: () => 42 });
    const out = await src.query({ center: { lat: 10, lng: 20 }, radiusM: 1000, minSignificance: 0, locale: 'en' });
    expect(out.map((p) => p.id)).toEqual(['wd:Q100', 'wd:Q200', 'wp:en:4']); // event (Q1656682) dropped
    const museum = out[0]!;
    expect(museum).toMatchObject({ kind: 'museum', externalRefs: { wikidataId: 'Q100', wikipediaTitle: 'Grand Museum' } });
    expect(museum.tags).toContain('heritage');
    expect(museum.significance).toBeGreaterThan(0.8);
    expect(out[1]!.kind).toBe('food');
    expect(out[1]!.significance).toBeLessThan(0.1);
    // User-Agent per Wikimedia policy on every request
    for (const c of f.calls) expect((c.init.headers as Record<string, string>)['User-Agent']).toMatch(/^TelveyCompanion\//);
    expect(f.calls).toHaveLength(2);
  });

  it('applies the significance floor and radius (extent-aware)', () => {
    const facts = parseEntityBindings(sparql.results.bindings);
    const out = buildCandidates(geo.query.pages, facts, { center: { lat: 10, lng: 20 }, radiusM: 1000, minSignificance: 0.5, locale: 'en' }, 0);
    expect(out.map((p) => p.id)).toEqual(['wd:Q100']);
  });

  it('significance is monotonic in sitelinks and boosted by heritage; extent from area/population', () => {
    const s = (n: number, h = false) => significanceFor({ sitelinks: n, heritage: h, population: null }, 'building');
    expect(s(1)).toBeLessThan(s(10));
    expect(s(10)).toBeLessThan(s(100));
    expect(s(50, true)).toBeGreaterThan(s(50));
    expect(extentFor({ areaM2: Math.PI * 1_000_000, population: null }, 'park')).toBe(1000);
    expect(extentFor({ areaM2: null, population: 2_000_000 }, 'city')).toBeGreaterThan(10_000);
    expect(extentFor({ areaM2: null, population: null }, 'building')).toBe(0);
  });

  it('covers large corridor queries with a bounded number of ≤10 km sub-queries', () => {
    const corridor = [
      { lat: 35, lng: -106 },
      { lat: 35, lng: -107 },
    ];
    const circles = coverageCircles({ center: { lat: 35, lng: -106.5 }, radiusM: 60_000, corridor });
    expect(circles.length).toBeLessThanOrEqual(4);
    expect(circles.every((c) => c.radiusM <= 10_000)).toBe(true);
    expect(polylineLengthM(corridor)).toBeGreaterThan(80_000);
    expect(coverageCircles({ center: { lat: 0, lng: 0 }, radiusM: 800 })).toEqual([{ center: { lat: 0, lng: 0 }, radiusM: 800 }]);
  });

  it('user agent carries configurable contact', () => {
    expect(wikimediaUserAgent('ops@example.org')).toContain('ops@example.org');
  });
});

describe('Wikimedia knowledge source', () => {
  it('builds an EvidencePack from the REST summary + Wikidata claims', async () => {
    const f = mockFetch((url) => {
      if (url.includes('/page/summary/')) return json({ type: 'standard', title: 'Grand Museum', extract: 'The Grand Museum is an art museum in the old town. It was designed by Ada Merrow and opened in 1893. The collection holds 300,000 works.' });
      if (url.includes('sparql')) return json({ results: { bindings: [{ inception: { type: 'literal', value: '1893' }, architects: { type: 'literal', value: 'Ada Merrow' }, height: { type: 'literal', value: '41.5' } }] } });
      return json({});
    });
    const ks = new WikimediaKnowledgeSource({ fetchImpl: f, clock: () => 1 });
    const pack = await ks.evidence({ id: 'wd:Q100', name: 'Grand Museum', kind: 'museum', location: { lat: 0, lng: 0 }, extentM: 0, significance: 0.9, tags: [], externalRefs: { wikidataId: 'Q100', wikipediaTitle: 'Grand Museum' }, sources: [] }, 'en');
    expect(pack).not.toBeNull();
    expect(pack!.thin).toBe(false);
    const kinds = pack!.facts.map((x) => x.kind);
    expect(kinds[0]).toBe('identity');
    expect(kinds).toContain('architecture');
    const arch = pack!.facts.find((x) => x.id.endsWith('#architect'))!;
    expect(arch.text).toBe('Grand Museum was designed by Ada Merrow.');
    expect(arch.entities).toContain('Ada Merrow');
    expect(pack!.facts.find((x) => x.id.endsWith('#s2'))!.numbers).toContain('1893');
    expect(pack!.facts.every((x) => x.source.license)).toBe(true);
  });

  it('summary splitting drops pronunciation parentheticals and keeps years', () => {
    const s = splitSummary('Foo Tower (pronounced foo) is a tower. It opened (in 1931) to the public after many years.');
    expect(s[0]).toBe('Foo Tower is a tower.');
    expect(s[1]).toContain('1931');
  });
});

describe('Google Places nearby', () => {
  it('uses a minimal Pro field mask and maps the category to includedTypes', async () => {
    const f = mockFetch(() => json({ places: [{ id: 'abc', displayName: { text: 'Cafe One' }, location: { latitude: 1, longitude: 2 }, primaryType: 'coffee_shop' }] }));
    const s = new GooglePlacesNearbySearch({ apiKey: 'AIzaTESTKEY000000000000000000', fetchImpl: f });
    const out = await s.search({ location: { lat: 1, lng: 2 }, category: 'coffee', query: 'coffee', radiusM: 800, maxResults: 3, locale: 'en-US' });
    expect(out).toEqual([{ placeId: 'gp:abc', name: 'Cafe One', location: { lat: 1, lng: 2 }, kind: 'food', category: 'coffee' }]);
    const h = f.calls[0]!.init.headers as Record<string, string>;
    expect(h['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.location,places.primaryType,places.types');
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body.includedTypes).toEqual(['cafe', 'coffee_shop']);
    expect(body.rankPreference).toBe('DISTANCE');
  });

  it('maps 429 to quota and never echoes the key', async () => {
    const f = mockFetch(() => new Response('quota exceeded for key=AIzaTESTKEY000000000000000000', { status: 429 }));
    const s = new GooglePlacesNearbySearch({ apiKey: 'AIzaTESTKEY000000000000000000', fetchImpl: f });
    const e = await s.search({ location: { lat: 1, lng: 2 }, category: null, query: 'x', radiusM: 500, maxResults: 3, locale: 'en' }).catch((x: ProviderError) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect((e as ProviderError).kind).toBe('quota');
    expect((e as ProviderError).message).not.toContain('AIzaTESTKEY');
  });
});

describe('OpenAI adapters', () => {
  it('chat completions with json_schema and usage mapping', async () => {
    const f = mockFetch(() => json({ choices: [{ message: { content: '{"intent":"skip"}' } }], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 50 } }, model: 'gpt-x' }));
    const g = new OpenAITextGenerator({ apiKey: 'sk-test-abcdefghijk', model: 'gpt-6-luna', fetchImpl: f });
    const r = await g.generate({ system: 's', prompt: 'p', maxOutputTokens: 50, json: { name: 'intent', schema: { type: 'object' } }, task: 'intent' });
    expect(r).toMatchObject({ text: '{"intent":"skip"}', usage: { inputTokens: 100, outputTokens: 5, cachedInputTokens: 50 } });
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body.response_format.type).toBe('json_schema');
    expect(body.max_completion_tokens).toBe(50);
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-abcdefghijk');
  });

  it('401 → auth error without the key in the message', async () => {
    const f = mockFetch(() => new Response('{"error":"Incorrect API key provided: sk-test-abcdefghijk"}', { status: 401 }));
    const g = new OpenAITextGenerator({ apiKey: 'sk-test-abcdefghijk', model: 'm', fetchImpl: f });
    const e = (await g.generate({ system: 's', prompt: 'p', maxOutputTokens: 5, task: 't' }).catch((x) => x)) as ProviderError;
    expect(e.kind).toBe('auth');
    expect(e.retryable).toBe(false);
    expect(e.message).not.toContain('sk-test-abcdefghijk');
  });

  it('TTS returns mp3 with a parsed duration and sends persona instructions', async () => {
    const mp3 = silentMp3(2000);
    const f = mockFetch(() => new Response(Buffer.from(mp3), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const t = new OpenAISpeechSynthesizer({ apiKey: 'sk-x', model: 'gpt-4o-mini-tts', fetchImpl: f });
    const r = await t.synthesize({ text: 'Hello', voice: 'sage', locale: 'en', speakingRate: 0.95, instructions: 'warm' });
    expect(r.mime).toBe('audio/mpeg');
    expect(Math.abs(r.durationMs - 2000)).toBeLessThan(60);
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'sage', response_format: 'mp3', instructions: 'warm', speed: 0.95 });
  });

  it('realtime client secret request is short-lived and idle-limited', async () => {
    const f = mockFetch(() => json({ value: 'ek_123', expires_at: 2_000_000_000 }));
    const r = await new OpenAIRealtimeTokenIssuer({ apiKey: 'sk-x', model: 'gpt-realtime-2.1-mini', fetchImpl: f }).issue({ instructions: 'i', voice: 'sage', locale: 'en', maxSeconds: 300, idleTimeoutS: 20 });
    expect(r).toMatchObject({ provider: 'openai', clientSecret: 'ek_123', maxSeconds: 300 });
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 300 });
    expect(body.session.audio.input.turn_detection.idle_timeout_ms).toBe(20_000);
  });
});

describe('Gemini + Anthropic adapters', () => {
  it('Gemini generateContent with responseJsonSchema', async () => {
    const f = mockFetch(() => json({ candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }));
    const r = await new GeminiTextGenerator({ apiKey: 'k', model: 'gemini-3.1-flash-lite', fetchImpl: f }).generate({ system: 's', prompt: 'p', maxOutputTokens: 9, json: { name: 'x', schema: { type: 'object' } }, task: 't' });
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
    expect(f.calls[0]!.url).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(JSON.parse(String(f.calls[0]!.init.body)).generationConfig.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('Gemini TTS wraps PCM into WAV', async () => {
    const pcm = Buffer.alloc(48_000); // 1 s at 24 kHz mono 16-bit
    const f = mockFetch(() => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }));
    const r = await new GeminiSpeechSynthesizer({ apiKey: 'k', model: 'gemini-3.8-flash-lite-tts', fetchImpl: f }).synthesize({ text: 'x', voice: 'Gacrux', locale: 'en', speakingRate: 1 });
    expect(r.mime).toBe('audio/wav');
    expect(r.durationMs).toBe(1000);
  });

  it('Anthropic messages usage mapping', async () => {
    const f = mockFetch(() => json({ content: [{ type: 'text', text: 'Prose.' }], usage: { input_tokens: 90, output_tokens: 12, cache_read_input_tokens: 10 } }));
    const r = await new AnthropicTextGenerator({ apiKey: 'k', model: 'claude-haiku-4-5', fetchImpl: f }).generate({ system: 's', prompt: 'p', maxOutputTokens: 100, task: 't' });
    expect(r).toMatchObject({ text: 'Prose.', usage: { inputTokens: 100, outputTokens: 12, cachedInputTokens: 10 } });
    expect((f.calls[0]!.init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });
});

describe('audio utils', () => {
  it('silent mp3 round-trips its duration', () => {
    for (const ms of [500, 3000, 12_000]) expect(Math.abs(mp3DurationMs(silentMp3(ms)) - ms)).toBeLessThan(40);
  });
  it('wav duration', () => {
    const b = new Uint8Array(44 + 48_000);
    const v = new DataView(b.buffer);
    v.setUint32(28, 48_000, true);
    v.setUint32(40, 48_000, true);
    expect(wavDurationMs(b)).toBe(1000);
  });
});
