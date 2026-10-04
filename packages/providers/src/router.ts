/**
 * ProviderRouter: ordered primary → fallback chains per task, every call routed through the
 * ProviderGuard (budget, breaker, timeout, ≤1 retry, metering). Fallback happens on
 * provider failure only; a budget refusal or caller abort stops the chain (F2/F5: a refusal
 * must not fan out into more paid calls).
 */
import type { DiscoveryQuery, EvidencePack, GuideProfile, InterpretedUtterance, Locale, PlaceCandidate, ProviderCategory, TtsTier } from '@city/core';
import { AnthropicTextGenerator } from './adapters/anthropic.js';
import { GeminiLiveTokenIssuer, GeminiSpeechRecognizer, GeminiSpeechSynthesizer, GeminiTextGenerator } from './adapters/gemini.js';
import { GooglePlacesNearbySearch, GooglePlacesPlaceSource } from './adapters/google-places.js';
import { GoogleCloudSpeechSynthesizer } from './adapters/google-tts.js';
import { OpenAIRealtimeTokenIssuer, OpenAISpeechRecognizer, OpenAISpeechSynthesizer, OpenAITextGenerator } from './adapters/openai.js';
import { WikimediaKnowledgeSource, WikimediaPlaceSource } from './adapters/wikimedia.js';
import type { ProviderEnvConfig } from './config.js';
import { ProviderError, isProviderError } from './errors.js';
import { FakeNearbySearch, FakeRealtimeTokenIssuer, FakeSpeechRecognizer, FakeSpeechSynthesizer, FakeTextGenerator } from './fakes.js';
import { HeuristicIntentInterpreter, LlmIntentInterpreter } from './intent.js';
import type { ProviderGuard } from './metered.js';
import type { GenerateFn } from './story.js';
import type {
  CallContext,
  GenerateRequest,
  GenerateResult,
  IntentContext,
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
  ProviderInfo,
} from './types.js';

export interface ProviderSet {
  story: TextGenerator[];
  intent: TextGenerator[];
  tts: SpeechSynthesizer[];
  /** Cheap TTS tier (D-019). Empty → the economy tier uses the standard `tts` chain. */
  ttsEconomy?: SpeechSynthesizer[];
  stt: SpeechRecognizer[];
  realtime: RealtimeTokenIssuer[];
  places: PlaceSource[];
  knowledge: KnowledgeSource[];
  nearby: NearbySearch[];
}

export const TASK_TIMEOUTS_MS = {
  story: 9000,
  followup: 6000,
  intent: 2500,
  tts: 9000,
  stt: 8000,
  realtime: 8000,
  places: 7000,
  knowledge: 7000,
  nearby: 4000,
} as const;

export type TaskTimeouts = { -readonly [K in keyof typeof TASK_TIMEOUTS_MS]: number };

/** Build real adapters for configured keys (+ fakes where allowed and nothing real exists). */
export function buildProviderSet(c: ProviderEnvConfig): ProviderSet {
  const k = c.keys;
  const text = (p: string, model: 'story' | 'intent'): TextGenerator | null => {
    if (p === 'openai' && k.openai) return new OpenAITextGenerator({ apiKey: k.openai, model: model === 'story' ? c.models.openaiStory : c.models.openaiIntent, ...(c.openaiReasoningEffort ? { reasoningEffort: c.openaiReasoningEffort } : {}) });
    if (p === 'gemini' && k.gemini) return new GeminiTextGenerator({ apiKey: k.gemini, model: model === 'story' ? c.models.geminiStory : c.models.geminiIntent });
    if (p === 'anthropic' && k.anthropic) return new AnthropicTextGenerator({ apiKey: k.anthropic, model: c.models.anthropicStory });
    return null;
  };
  const nn = <T>(xs: Array<T | null>): T[] => xs.filter((x): x is T => x !== null);
  const tts = (p: string): SpeechSynthesizer | null =>
    p === 'openai' && k.openai
      ? new OpenAISpeechSynthesizer({ apiKey: k.openai, model: c.models.openaiTts })
      : p === 'gemini' && k.gemini
        ? new GeminiSpeechSynthesizer({ apiKey: k.gemini, model: c.models.geminiTts })
        : p === 'google_tts' && k.googleTts
          ? new GoogleCloudSpeechSynthesizer({ apiKey: k.googleTts, family: c.models.googleTtsFamily })
          : null;
  const set: ProviderSet = {
    story: nn(c.order.story.map((p) => text(p, 'story'))),
    intent: nn(c.order.intent.map((p) => text(p, 'intent'))),
    tts: nn(c.order.tts.map(tts)),
    ttsEconomy: nn(c.order.ttsEconomy.map(tts)),
    stt: nn(
      c.order.stt.map((p) =>
        p === 'openai' && k.openai ? new OpenAISpeechRecognizer({ apiKey: k.openai, model: c.models.openaiStt }) : p === 'gemini' && k.gemini ? new GeminiSpeechRecognizer({ apiKey: k.gemini, model: c.models.geminiStt }) : null,
      ),
    ),
    realtime: nn(
      c.order.realtime.map((p) =>
        p === 'openai' && k.openai ? new OpenAIRealtimeTokenIssuer({ apiKey: k.openai, model: c.models.openaiRealtime }) : p === 'gemini' && k.gemini ? new GeminiLiveTokenIssuer({ apiKey: k.gemini, model: c.models.geminiLive }) : null,
      ),
    ),
    places: nn(c.order.places.map((p) => (p === 'wikimedia' ? new WikimediaPlaceSource() : p === 'google_places' && k.googleMaps ? new GooglePlacesPlaceSource({ apiKey: k.googleMaps }) : null))),
    knowledge: nn(c.order.knowledge.map((p) => (p === 'wikimedia' ? new WikimediaKnowledgeSource() : null))),
    nearby: nn(c.order.nearby.map((p) => (p === 'google_places' && k.googleMaps ? new GooglePlacesNearbySearch({ apiKey: k.googleMaps }) : null))),
  };
  if (c.allowFakes) {
    if (set.story.length === 0) set.story.push(new FakeTextGenerator());
    if (set.intent.length === 0) set.intent.push(new FakeTextGenerator());
    if (set.tts.length === 0) set.tts.push(new FakeSpeechSynthesizer());
    if (set.stt.length === 0) set.stt.push(new FakeSpeechRecognizer());
    if (set.realtime.length === 0) set.realtime.push(new FakeRealtimeTokenIssuer());
    if (set.nearby.length === 0) set.nearby.push(new FakeNearbySearch());
  }
  return set;
}

export function describeSet(s: ProviderSet): Record<string, Array<{ name: string; model: string | null; fake: boolean }>> {
  const d = (xs: ProviderInfo[]) => xs.map((x) => ({ name: x.name, model: x.model, fake: !!x.fake }));
  return { story: d(s.story), intent: d(s.intent), tts: d(s.tts), ttsEconomy: d(s.ttsEconomy ?? []), stt: d(s.stt), realtime: d(s.realtime), places: d(s.places), knowledge: d(s.knowledge), nearby: d(s.nearby) };
}

/** Stop the fallback chain for errors that another provider would not fix. */
function chainStops(e: unknown): boolean {
  return isProviderError(e) && (e.kind === 'budget' || e.kind === 'aborted');
}

export class ProviderRouter {
  readonly timeouts: TaskTimeouts;
  private readonly heuristic = new HeuristicIntentInterpreter();

  constructor(
    readonly set: ProviderSet,
    readonly guard: ProviderGuard,
    timeouts: Partial<TaskTimeouts> = {},
  ) {
    this.timeouts = { ...TASK_TIMEOUTS_MS, ...timeouts };
  }

  private async chain<P extends ProviderInfo, T>(providers: readonly P[], category: ProviderCategory, run: (p: P) => Promise<T>, stop?: () => boolean): Promise<{ result: T; provider: P }> {
    let last: unknown = new ProviderError('router', 'not_configured', `no ${category} provider configured`);
    for (const p of providers) {
      if (!this.guard.available(p, category)) {
        last = new ProviderError(p.name, 'circuit_open', 'unavailable');
        continue;
      }
      try {
        return { result: await run(p), provider: p };
      } catch (e) {
        last = e;
        if (chainStops(e) || stop?.()) break;
      }
    }
    throw last;
  }

  hasRealText(): boolean {
    return this.set.story.some((p) => !p.fake);
  }

  /** A GenerateFn bound to a task chain (story/follow-up use `story`, intent uses `intent`). */
  generator(task: 'story' | 'followup' | 'intent', ctx: CallContext): GenerateFn | null {
    const providers = task === 'intent' ? this.set.intent : this.set.story;
    if (providers.length === 0) return null;
    return async (req: GenerateRequest) => {
      // Streaming (D-020): once a provider has emitted text, neither a retry nor a fallback
      // provider may run (their text would be spoken twice) — the caller keeps what it has.
      let emitted = false;
      const r: GenerateRequest = req.onDelta
        ? {
            ...req,
            onDelta: (d) => {
              emitted = true;
              req.onDelta!(d);
            },
          }
        : req;
      const { result, provider } = await this.chain(
        providers,
        'llm',
        (p) =>
          this.guard.call<GenerateResult>(
            { provider: p, category: 'llm', task: req.task, ctx, timeoutMs: this.timeouts[task], units: (x) => ({ inputTokens: x.usage.inputTokens, outputTokens: x.usage.outputTokens, cachedInputTokens: x.usage.cachedInputTokens ?? 0, requests: 1 }), noRetry: task !== 'story' || !!req.onDelta },
            (c) => p.generate(r, c),
          ),
        () => emitted,
      );
      return { ...result, provider: provider.name };
    };
  }

  /** Closed-enum LLM interpretation; deterministic heuristic when no LLM is usable. */
  async interpret(text: string, locale: Locale, ictx: IntentContext, ctx: CallContext): Promise<InterpretedUtterance> {
    const gen = this.generator('intent', ctx);
    if (gen) {
      try {
        const first = this.set.intent[0]!;
        return await new LlmIntentInterpreter(gen, { name: first.name, model: first.model }).interpret(text, locale, ictx, ctx);
      } catch (e) {
        if (isProviderError(e) && e.kind === 'aborted') throw e;
      }
    }
    return this.heuristic.interpret(text, locale, ictx);
  }

  /** TTS chain of a tier (D-019): economy providers first, then the standard chain as fallback. */
  ttsChain(tier: TtsTier = 'standard'): SpeechSynthesizer[] {
    const eco = this.set.ttsEconomy ?? [];
    return tier === 'economy' && eco.length > 0 ? [...eco, ...this.set.tts.filter((p) => !eco.includes(p))] : this.set.tts;
  }

  /** The TTS provider that would be tried first right now for `tier` (audio cache key namespace). */
  plannedTts(tier: TtsTier = 'standard'): SpeechSynthesizer | null {
    return this.ttsChain(tier).find((p) => this.guard.available(p, 'tts')) ?? null;
  }

  /**
   * Voice of `guide` on provider `p`: the tier/language-specific candidate when the Guide has one
   * (D-019), else the provider voice, else the provider default. Guides never share a voice id.
   */
  voiceFor(p: SpeechSynthesizer, guide: GuideProfile, locale?: Locale, tier: TtsTier = 'standard'): string {
    const lang = String(locale ?? 'en').slice(0, 2).toLowerCase();
    const byTier = guide.voice.byTier;
    const k = `${p.name}:${p.model ?? ''}`;
    const tiered = byTier?.[tier]?.[k] ?? byTier?.[tier]?.[p.name] ?? byTier?.standard?.[k] ?? byTier?.standard?.[p.name];
    if (tiered) return tiered[lang] ?? '';
    return guide.voice.byProvider[p.name] ?? p.defaultVoice;
  }

  async synthesize(req: Omit<SynthesisRequest, 'voice'>, guide: GuideProfile, ctx: CallContext, only?: SpeechSynthesizer, tier: TtsTier = 'standard'): Promise<{ result: SynthesisResult; provider: SpeechSynthesizer }> {
    const chain = this.ttsChain(tier);
    const providers = only ? [only, ...chain.filter((p) => p !== only)] : chain;
    return this.chain(providers, 'tts', (p) =>
      this.guard.call<SynthesisResult>(
        { provider: p, category: 'tts', task: 'tts_segment', ctx, timeoutMs: this.timeouts.tts, units: (r) => ({ characters: req.text.length, audioSeconds: r.durationMs / 1000, requests: 1 }) },
        (c) => p.synthesize({ ...req, voice: this.voiceFor(p, guide, req.locale, tier) }, c),
      ),
    );
  }

  async transcribe(req: TranscriptionRequest, ctx: CallContext): Promise<{ result: TranscriptionResult; provider: SpeechRecognizer }> {
    return this.chain(this.set.stt, 'stt', (p) =>
      this.guard.call<TranscriptionResult>(
        { provider: p, category: 'stt', task: 'stt_utterance', ctx, timeoutMs: this.timeouts.stt, units: (r) => ({ audioSeconds: r.durationS || req.durationS || 0, requests: 1 }), noRetry: true },
        (c) => p.transcribe(req, c),
      ),
    );
  }

  async issueRealtime(req: RealtimeTokenRequest, ctx: CallContext, providerName?: string): Promise<{ result: RealtimeToken; provider: RealtimeTokenIssuer }> {
    const ps = providerName ? this.set.realtime.filter((p) => p.name === providerName) : this.set.realtime;
    return this.chain(ps, 'realtime', (p) =>
      this.guard.call<RealtimeToken>({ provider: p, category: 'realtime', task: 'realtime_token', ctx, timeoutMs: this.timeouts.realtime, units: () => ({ requests: 1 }), costUsd: () => 0, noRetry: true }, (c) => p.issue(req, c)),
    );
  }

  async queryPlaces(q: DiscoveryQuery, ctx: CallContext, task = 'discovery'): Promise<{ result: PlaceCandidate[]; provider: PlaceSource }> {
    return this.chain(this.set.places, 'maps', (p) =>
      this.guard.call<PlaceCandidate[]>({ provider: p, category: p.name === 'wikimedia' ? 'knowledge' : 'maps', task, ctx, timeoutMs: this.timeouts.places, units: () => ({ requests: 1 }) }, (c) => p.query(q, c)),
    );
  }

  async evidence(place: PlaceCandidate, locale: Locale, ctx: CallContext): Promise<{ result: EvidencePack | null; provider: KnowledgeSource | null }> {
    let lastErr: unknown = null;
    for (const p of this.set.knowledge) {
      if (!this.guard.available(p, 'knowledge')) continue;
      try {
        const r = await this.guard.call<EvidencePack | null>({ provider: p, category: 'knowledge', task: 'evidence', ctx, timeoutMs: this.timeouts.knowledge, units: () => ({ requests: 1 }) }, (c) => p.evidence(place, locale, c));
        if (r) return { result: r, provider: p };
      } catch (e) {
        lastErr = e;
        if (chainStops(e)) break;
      }
    }
    if (lastErr) throw lastErr;
    return { result: null, provider: null };
  }

  async nearby(req: NearbyRequest, ctx: CallContext): Promise<{ result: unknown[]; provider: NearbySearch }> {
    return this.chain(this.set.nearby, 'maps', (p) =>
      this.guard.call<unknown[]>({ provider: p, category: 'maps', task: 'nearby_search', ctx, timeoutMs: this.timeouts.nearby, units: () => ({ requests: 1 }), noRetry: true }, (c) => p.search(req, c)),
    );
  }
}
