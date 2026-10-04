/**
 * Provider interfaces. Every external capability the product uses sits behind one of these,
 * so adapters (real or fake) are interchangeable and selection is config + benchmark driven
 * (D-010, D-014). Nothing here is city-aware (D-004).
 */
import type { PromptPayload } from './prompts.js';
import type {
  CostRecord,
  DiscoveryQuery,
  EvidencePack,
  InterpretedUtterance,
  LatLng,
  Locale,
  PlaceCandidate,
  PlaceKind,
  PlaceSource as CorePlaceSource,
  ProviderCategory,
} from '@city/core';

/** Per-call context threaded through metering, budgets and cancellation. */
export interface CallContext {
  sessionId: string | null;
  /** Aborted when the caller no longer needs the result (turn superseded, session ended). */
  signal?: AbortSignal;
}

export interface ProviderInfo {
  /** Stable adapter name: 'openai', 'gemini', 'anthropic', 'wikimedia', 'google_places', 'fake'. */
  readonly name: string;
  /** Model / product id used for pricing (null for free/non-model APIs). */
  readonly model: string | null;
  /** Deterministic fake (tests/dev) — surfaced in /readyz and admin so it is never mistaken for real data. */
  readonly fake?: boolean;
}

// ─────────────────────────────────────────────── places & knowledge

export interface PlaceSource extends CorePlaceSource, ProviderInfo {
  query(q: DiscoveryQuery, ctx?: CallContext): Promise<PlaceCandidate[]>;
}

export interface KnowledgeSource extends ProviderInfo {
  /** Evidence for a place. Returns null when the source knows nothing about it. */
  evidence(place: PlaceCandidate, locale: Locale, ctx?: CallContext): Promise<EvidencePack | null>;
}

export interface NearbyRequest {
  location: LatLng;
  /** Normalized category key from core `extractCategory` (coffee, parking, gas_station…). */
  category: string | null;
  /** Free-text query (used when no category matched). */
  query: string;
  radiusM: number;
  maxResults: number;
  locale: Locale;
}

/** Raw adapter output. The API validates it with zod before anything is spoken or shown (C1). */
export interface NearbyResult {
  placeId: string;
  name: string;
  location: LatLng;
  kind: PlaceKind;
  category: string | null;
  openNow?: boolean | null;
  address?: string | null;
}

export interface NearbySearch extends ProviderInfo {
  search(req: NearbyRequest, ctx?: CallContext): Promise<unknown[]>;
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  mode: 'drive' | 'walk';
}
export interface RouteResult {
  polyline: LatLng[];
  distanceM: number;
  durationS: number;
}
/** Optional (routes/ETA). No production adapter yet — navigation is handed off to map apps. */
export interface RouteService extends ProviderInfo {
  route(req: RouteRequest, ctx?: CallContext): Promise<RouteResult>;
}

// ─────────────────────────────────────────────── language

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  /** When set, the model must return JSON matching this (JSON-Schema subset) schema. */
  json?: { name: string; schema: Record<string, unknown> };
  /** Metering task label: story_generation, followup_answer, intent… */
  task: string;
  /**
   * Structured twin of the prompt (D-021). Real adapters never send it; deterministic fakes read
   * it instead of parsing the prompt text.
   */
  structured?: PromptPayload;
  /**
   * Streaming (D-020): when set, adapters that support server-sent events stream the completion
   * and call this with each text delta as it arrives; adapters without streaming call it once
   * with the full text. The promise still resolves with the complete result (usage, metering).
   */
  onDelta?: (delta: string) => void;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  model: string;
}

export interface TextGenerator extends ProviderInfo {
  generate(req: GenerateRequest, ctx?: CallContext): Promise<GenerateResult>;
}

export interface IntentContext {
  /** Name of the place currently being discussed (active subject), if any. */
  activeSubject?: string | null;
  /** Intent of the previous user turn (barge-in corrections: "No, I meant parking"). */
  previousIntent?: string | null;
}

export interface IntentInterpreter extends ProviderInfo {
  /** Closed-enum interpretation; never returns an intent outside core's `Intent`. */
  interpret(text: string, locale: Locale, context: IntentContext, ctx?: CallContext): Promise<InterpretedUtterance>;
}

// ─────────────────────────────────────────────── voice

export interface SynthesisRequest {
  text: string;
  /** Provider-specific voice id (GuideProfile.voice.byProvider[provider]). */
  voice: string;
  locale: Locale;
  speakingRate: number;
  /** Persona delivery instructions (models that support them). */
  instructions?: string;
}

export interface SynthesisResult {
  audio: Uint8Array;
  mime: 'audio/mpeg' | 'audio/wav';
  /** Measured/estimated duration of the audio. */
  durationMs: number;
  /** Time to first byte from the provider (for the TTS benchmark). */
  ttfbMs?: number;
}

export interface SpeechSynthesizer extends ProviderInfo {
  /** Voice id used for this provider when the guide has none. */
  readonly defaultVoice: string;
  synthesize(req: SynthesisRequest, ctx?: CallContext): Promise<SynthesisResult>;
}

export interface TranscriptionRequest {
  audio: Uint8Array;
  mime: string;
  locale: Locale;
  /** Client-reported duration (s) — used for metering when the provider doesn't return one. */
  durationS?: number;
}

export interface TranscriptionResult {
  text: string;
  durationS: number;
}

export interface SpeechRecognizer extends ProviderInfo {
  transcribe(req: TranscriptionRequest, ctx?: CallContext): Promise<TranscriptionResult>;
}

export interface RealtimeTokenRequest {
  instructions: string;
  voice: string;
  locale: Locale;
  maxSeconds: number;
  idleTimeoutS: number;
}

export interface RealtimeToken {
  provider: string;
  model: string;
  clientSecret: string;
  expiresAt: number;
  maxSeconds: number;
  idleTimeoutS: number;
  /** Where the client connects (WebRTC/WebSocket endpoint). */
  connectUrl: string;
}

export interface RealtimeTokenIssuer extends ProviderInfo {
  issue(req: RealtimeTokenRequest, ctx?: CallContext): Promise<RealtimeToken>;
}

// ─────────────────────────────────────────────── metering

export interface CostSink {
  record(r: CostRecord): void;
}

export const NULL_COST_SINK: CostSink = { record: () => {} };

export type { ProviderCategory };
