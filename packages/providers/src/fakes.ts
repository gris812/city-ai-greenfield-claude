/**
 * Deterministic fakes for every provider interface (tests, local dev without keys, demo).
 * Controllable latency and failure modes let tests prove F2–F5 containment. Fakes are
 * labelled `fake: true` so /readyz and the admin console never present them as real.
 */
import type { DiscoveryQuery, EvidencePack, LatLng, Locale, PlaceCandidate, PlaceKind } from '@city/core';
import { destinationPoint, haversineM, isRussian, templateNarrative, GUIDES, wordCount } from '@city/core';
import { ProviderError, type ProviderErrorKind } from './errors.js';
import { silentMp3 } from './audio.js';
import { heuristicIntent } from './intent.js';
import { readPayload } from './prompts.js';
import { deterministicAnswer } from './story.js';
import type {
  CallContext,
  GenerateRequest,
  GenerateResult,
  KnowledgeSource,
  NearbyRequest,
  NearbySearch,
  PlaceSource,
  RealtimeToken,
  RealtimeTokenIssuer,
  RealtimeTokenRequest,
  SpeechRecognizer,
  SpeechSynthesizer,
  SynthesisRequest,
  SynthesisResult,
  TextGenerator,
  TranscriptionRequest,
  TranscriptionResult,
} from './types.js';

export interface FakeBehaviour {
  latencyMs?: number;
  /** Fail every call with this kind ('timeout' waits for the caller's timeout/abort). */
  failWith?: ProviderErrorKind | null;
  /** Fail only the first N calls. */
  failFirst?: number;
}

/** Sleep that honours cancellation; 'hang' never resolves unless aborted. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

abstract class FakeBase {
  readonly fake = true;
  calls = 0;
  constructor(public behaviour: FakeBehaviour = {}) {}

  protected async enter(provider: string, ctx?: CallContext): Promise<void> {
    this.calls++;
    const b = this.behaviour;
    const failing = b.failWith && (b.failFirst === undefined || this.calls <= b.failFirst);
    if (failing && b.failWith === 'timeout') {
      await wait(3_600_000, ctx?.signal); // hang until the guard's timeout aborts us
    }
    if (b.latencyMs) await wait(b.latencyMs, ctx?.signal);
    if (failing) throw new ProviderError(provider, b.failWith!, 'fake failure', { status: b.failWith === 'auth' ? 401 : b.failWith === 'quota' ? 429 : 500 });
  }
}

// ─────────────────────────────────────────────── text

export type FakeTextMode = 'grounded' | 'hallucinate' | 'hallucinate_once';

/** Returns guide-styled, grounded prose built from the brief in the prompt payload. */
export class FakeTextGenerator extends FakeBase implements TextGenerator {
  readonly name: string;
  readonly model = 'fake';
  constructor(
    behaviour: FakeBehaviour & { mode?: FakeTextMode } = {},
    name = 'fake',
  ) {
    super(behaviour);
    this.name = name;
  }

  async generate(req: GenerateRequest, ctx?: CallContext): Promise<GenerateResult> {
    await this.enter(this.name, ctx);
    const p = readPayload(req.prompt);
    const mode = (this.behaviour as { mode?: FakeTextMode }).mode ?? 'grounded';
    const hallucinate = mode === 'hallucinate' || (mode === 'hallucinate_once' && this.calls === 1);
    let text = '';
    if (p?.kind === 'intent') {
      const r = heuristicIntent(p.utterance ?? '', (p.context ?? {}) as { previousIntent?: string });
      text = JSON.stringify({ intent: r.intent, category: r.slots.category ?? null, query: r.slots.query ?? null, placeRef: r.slots.placeRef ?? null, confidence: r.confidence });
    } else if (p?.brief) {
      const guide = GUIDES.find((g) => g.id === p.brief!.guideId) ?? GUIDES[0]!;
      const base = p.kind === 'followup' || p.kind === 'followup_retry' ? deterministicAnswer(p.brief) : templateNarrative(p.brief, guide);
      // Persona flavour without new facts: a guide-specific connective.
      const ru = isRussian(p.brief.locale);
      const flavour = guide.id === 'ida' ? (ru ? 'Вот что мне нравится здесь.' : 'Here is what I love about it.') : ru ? 'Коротко.' : 'Quick one.';
      text = p.kind === 'story' || p.kind === 'story_retry' ? `${flavour} ${base}` : base;
      if (wordCount(text) > p.brief.maxWords) text = base;
      if (hallucinate) text = `${text} It was completed in 1492 by Johann Fakename.`;
    } else {
      text = 'OK.';
    }
    const inputTokens = Math.ceil((req.system.length + req.prompt.length) / 4);
    return { text, model: this.model, usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) } };
  }
}

// ─────────────────────────────────────────────── voice

export class FakeSpeechSynthesizer extends FakeBase implements SpeechSynthesizer {
  readonly name: string;
  readonly model = 'fake';
  readonly defaultVoice = 'fake-voice';
  constructor(behaviour: FakeBehaviour = {}, name = 'fake') {
    super(behaviour);
    this.name = name;
  }
  async synthesize(req: SynthesisRequest, ctx?: CallContext): Promise<SynthesisResult> {
    const t0 = performance.now();
    await this.enter(this.name, ctx);
    const durationMs = Math.max(400, Math.round((wordCount(req.text) / (2.5 * (req.speakingRate || 1))) * 1000));
    return { audio: silentMp3(durationMs), mime: 'audio/mpeg', durationMs, ttfbMs: Math.round(performance.now() - t0) };
  }
}

/** Transcribes audio whose bytes are UTF-8 `TEXT:<transcript>` (test fixture convention). */
export class FakeSpeechRecognizer extends FakeBase implements SpeechRecognizer {
  readonly name = 'fake';
  readonly model = 'fake';
  async transcribe(req: TranscriptionRequest, ctx?: CallContext): Promise<TranscriptionResult> {
    await this.enter(this.name, ctx);
    const s = Buffer.from(req.audio).toString('utf8');
    return { text: s.startsWith('TEXT:') ? s.slice(5).trim() : '', durationS: req.durationS ?? 2 };
  }
}

export class FakeRealtimeTokenIssuer extends FakeBase implements RealtimeTokenIssuer {
  readonly name = 'fake';
  readonly model = 'fake-realtime';
  async issue(req: RealtimeTokenRequest, ctx?: CallContext): Promise<RealtimeToken> {
    await this.enter(this.name, ctx);
    return { provider: 'fake', model: this.model, clientSecret: `fake_ek_${this.calls}`, expiresAt: Date.now() + Math.min(600, req.maxSeconds) * 1000, maxSeconds: req.maxSeconds, idleTimeoutS: req.idleTimeoutS, connectUrl: 'about:blank' };
  }
}

// ─────────────────────────────────────────────── places

const SYNTH_NAMES: Record<string, string[]> = {
  coffee: ['Morning Cup Cafe', 'Roastery Nine', 'Bean and Leaf'],
  parking: ['Garage North', 'Lot 7 Parking', 'Riverside Parking'],
  gas_station: ['Fuel Stop East', 'Corner Fuel'],
  restaurant: ['Harbor Kitchen', 'Little Table'],
  pharmacy: ['Main Pharmacy'],
};
const CATEGORY_KIND: Record<string, PlaceKind> = { coffee: 'food', restaurant: 'food', parking: 'transit', gas_station: 'fuel', ev_charging: 'fuel', pharmacy: 'shop', grocery: 'shop', atm: 'shop', lodging: 'lodging' };

/**
 * Synthetic nearby results placed deterministically around the query point (labelled fake).
 * `includeInvalid` appends malformed rows to prove the API's zod validation (C1 step 4).
 */
export class FakeNearbySearch extends FakeBase implements NearbySearch {
  readonly name = 'fake';
  readonly model = 'fake';
  constructor(behaviour: FakeBehaviour & { includeInvalid?: boolean; empty?: boolean } = {}) {
    super(behaviour);
  }
  async search(req: NearbyRequest, ctx?: CallContext): Promise<unknown[]> {
    await this.enter(this.name, ctx);
    const b = this.behaviour as { includeInvalid?: boolean; empty?: boolean };
    if (b.empty) return [];
    const cat = req.category ?? 'place';
    const names = SYNTH_NAMES[cat] ?? [`${cat.replace(/_/g, ' ')} A`, `${cat.replace(/_/g, ' ')} B`];
    const out: unknown[] = names.slice(0, req.maxResults).map((name, i) => {
      const loc = destinationPoint(req.location, 40 + i * 110, Math.min(req.radiusM * 0.8, 120 + i * 140));
      return { placeId: `fake:${cat}:${i}`, name, location: loc, kind: CATEGORY_KIND[cat] ?? 'other', category: req.category };
    });
    if (b.includeInvalid) out.push({ placeId: '', name: 'Broken', location: { lat: 'x' } }, { placeId: 'fake:bad', name: 'Nowhere', location: { lat: 999, lng: 0 }, kind: 'food' });
    return out;
  }
}

/** A PlaceSource over an in-memory list (tests / synthetic dev); provider semantics, no ranking. */
export class StaticPlaceSource extends FakeBase implements PlaceSource {
  readonly name: string;
  readonly model = 'fake';
  constructor(
    public places: PlaceCandidate[],
    behaviour: FakeBehaviour = {},
    name = 'fake_places',
  ) {
    super(behaviour);
    this.name = name;
  }
  async query(q: DiscoveryQuery, ctx?: CallContext): Promise<PlaceCandidate[]> {
    await this.enter(this.name, ctx);
    return this.places
      .filter((p) => p.significance >= q.minSignificance && (!q.kinds || q.kinds.includes(p.kind)) && haversineM(q.center, p.location) - p.extentM <= q.radiusM)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}

export class StaticKnowledgeSource extends FakeBase implements KnowledgeSource {
  readonly name: string;
  readonly model = 'fake';
  constructor(
    public packs: Map<string, EvidencePack>,
    behaviour: FakeBehaviour = {},
    name = 'fake_knowledge',
  ) {
    super(behaviour);
    this.name = name;
  }
  async evidence(place: PlaceCandidate, _locale: Locale, ctx?: CallContext): Promise<EvidencePack | null> {
    await this.enter(this.name, ctx);
    return this.packs.get(place.id) ?? null;
  }
}

export function syntheticPoint(center: LatLng, bearing: number, m: number): LatLng {
  return destinationPoint(center, bearing, m);
}
