/**
 * Dated price table (D-014). Derived from `benchmark/research/provider_pricing.json`
 * (list prices retrieved 2026-09-27 from official pricing pages; see
 * docs/research/PROVIDER_PRICING.md for caveats). A unit test cross-checks every entry
 * that carries a `ref` against that JSON so the two cannot drift silently.
 *
 * These are LIST prices used for estimates and budgets — never presented as measured
 * production cost. Re-verify against provider consoles before the first production bill.
 */
import type { CostRecord } from '@city/core';

export const PRICES_RETRIEVED_AT = '2026-09-27';
export const PRICES_SOURCE = 'benchmark/research/provider_pricing.json';

/** Reference into provider_pricing.json: `product` + `sku` identify the row. */
export interface PriceRef {
  product: string;
  sku: string;
}

export type PriceEntry =
  | {
      kind: 'tokens';
      inputPerM: number;
      cachedInputPerM?: number;
      outputPerM: number;
      /** Promo: prices valid until (exclusive) this ISO date, then `after`. */
      promoUntil?: string;
      after?: { inputPerM: number; cachedInputPerM?: number; outputPerM: number };
      refs?: { input?: PriceRef; output?: PriceRef; cached?: PriceRef };
    }
  | { kind: 'characters'; perMChars: number; ref?: PriceRef }
  | {
      /** Token-priced TTS: text input tokens + audio output tokens (audio tokens/s assumption). */
      kind: 'tts_tokens';
      textInputPerM: number;
      audioOutputPerM: number;
      audioTokensPerSecond: number;
      promoUntil?: string;
      after?: { textInputPerM: number; audioOutputPerM: number };
      ref?: PriceRef;
    }
  | { kind: 'per_minute'; perMinute: number; ref?: PriceRef }
  | {
      /** Realtime speech-to-speech: user audio minutes in, assistant audio minutes out. */
      kind: 'realtime';
      inputPerMinute: number;
      outputPerMinute: number;
      refs?: { input?: PriceRef; output?: PriceRef };
    }
  | { kind: 'per_1k_requests'; per1k: number; freePerMonth?: number; ref?: PriceRef }
  | { kind: 'free' };

/** Key: `${provider}:${model}`. */
export const PRICE_TABLE: Record<string, PriceEntry> = {
  // ── LLMs
  'openai:gpt-6-luna': {
    kind: 'tokens',
    inputPerM: 0.1,
    cachedInputPerM: 0.01,
    outputPerM: 0.5,
    refs: { input: { product: 'GPT-6 Luna (gpt-6-luna)', sku: 'input' }, output: { product: 'GPT-6 Luna (gpt-6-luna)', sku: 'output' }, cached: { product: 'GPT-6 Luna (gpt-6-luna)', sku: 'cached input' } },
  },
  'openai:gpt-6-sol': {
    kind: 'tokens',
    inputPerM: 2.0,
    cachedInputPerM: 0.2,
    outputPerM: 10.0,
    refs: { input: { product: 'GPT-6 Sol (gpt-6-sol)', sku: 'input' }, output: { product: 'GPT-6 Sol (gpt-6-sol)', sku: 'output' } },
  },
  'openai:gpt-6-astra': {
    kind: 'tokens',
    inputPerM: 10.0,
    cachedInputPerM: 1.0,
    outputPerM: 50.0,
    refs: { input: { product: 'GPT-6 Astra (gpt-6-astra)', sku: 'input' }, output: { product: 'GPT-6 Astra (gpt-6-astra)', sku: 'output' } },
  },
  'gemini:gemini-3.1-flash-lite': {
    kind: 'tokens',
    inputPerM: 0.25,
    cachedInputPerM: 0.025,
    outputPerM: 1.5,
    refs: { input: { product: 'gemini-3.1-flash-lite', sku: 'input (text)' }, output: { product: 'gemini-3.1-flash-lite', sku: 'output' } },
  },
  'gemini:gemini-3.5-flash-lite': {
    kind: 'tokens',
    inputPerM: 0.3,
    outputPerM: 2.5,
    refs: { input: { product: 'gemini-3.5-flash-lite', sku: 'input' }, output: { product: 'gemini-3.5-flash-lite', sku: 'output' } },
  },
  'gemini:gemini-3.8-flash': {
    kind: 'tokens',
    inputPerM: 0.75,
    cachedInputPerM: 0.075,
    outputPerM: 3.75,
    promoUntil: '2027-01-01',
    after: { inputPerM: 1.5, cachedInputPerM: 0.15, outputPerM: 7.5 },
    refs: { input: { product: 'gemini-3.8-flash', sku: 'input' }, output: { product: 'gemini-3.8-flash', sku: 'output' } },
  },
  'gemini:gemini-3.5-flash': {
    kind: 'tokens',
    inputPerM: 1.5,
    cachedInputPerM: 0.15,
    outputPerM: 9.0,
    refs: { input: { product: 'gemini-3.5-flash', sku: 'input' }, output: { product: 'gemini-3.5-flash', sku: 'output' } },
  },
  'anthropic:claude-haiku-4-5': {
    kind: 'tokens',
    inputPerM: 1.0,
    cachedInputPerM: 0.1,
    outputPerM: 5.0,
    refs: { input: { product: 'Claude Haiku 4.5', sku: 'input' }, output: { product: 'Claude Haiku 4.5', sku: 'output' } },
  },
  'anthropic:claude-sonnet-5': {
    kind: 'tokens',
    inputPerM: 2.0,
    cachedInputPerM: 0.2,
    outputPerM: 10.0,
    refs: { input: { product: 'Claude Sonnet 5', sku: 'input' }, output: { product: 'Claude Sonnet 5', sku: 'output' } },
  },

  // ── TTS
  'openai:tts-1': { kind: 'characters', perMChars: 15.0, ref: { product: 'tts-1', sku: 'speech generation' } },
  'openai:tts-1-hd': { kind: 'characters', perMChars: 30.0, ref: { product: 'tts-1-hd', sku: 'speech generation' } },
  // gpt-4o-mini-tts: $0.60/1M text in, $12/1M audio out; ~$0.015/min → ≈20.8 audio tok/s (derived assumption).
  'openai:gpt-4o-mini-tts': { kind: 'tts_tokens', textInputPerM: 0.6, audioOutputPerM: 12.0, audioTokensPerSecond: 20.8, ref: { product: 'gpt-4o-mini-tts', sku: 'audio output' } },
  'gemini:gemini-3.8-flash-lite-tts': {
    kind: 'tts_tokens',
    textInputPerM: 0.5,
    audioOutputPerM: 6.0,
    audioTokensPerSecond: 25,
    promoUntil: '2027-01-01',
    after: { textInputPerM: 1.0, audioOutputPerM: 12.0 },
    ref: { product: 'gemini-3.8-flash-lite-tts', sku: 'audio output' },
  },
  'gemini:gemini-3.8-flash-tts': {
    kind: 'tts_tokens',
    textInputPerM: 0.5,
    audioOutputPerM: 9.0,
    audioTokensPerSecond: 25,
    promoUntil: '2027-01-01',
    after: { textInputPerM: 1.0, audioOutputPerM: 18.0 },
    ref: { product: 'gemini-3.8-flash-tts', sku: 'audio output' },
  },

  // Google Cloud Text-to-Speech (D-019, cheap tier): model = voice family; per 1M characters.
  'google_tts:standard': { kind: 'characters', perMChars: 4.0, ref: { product: 'Cloud Text-to-Speech Standard / WaveNet', sku: 'characters' } },
  'google_tts:wavenet': { kind: 'characters', perMChars: 4.0, ref: { product: 'Cloud Text-to-Speech Standard / WaveNet', sku: 'characters' } },
  'google_tts:neural2': { kind: 'characters', perMChars: 16.0, ref: { product: 'Cloud Text-to-Speech Neural2', sku: 'characters' } },

  // ── STT
  'openai:gpt-4o-mini-transcribe': { kind: 'per_minute', perMinute: 0.003, ref: { product: 'gpt-4o-mini-transcribe', sku: 'transcription' } },
  'openai:gpt-4o-transcribe': { kind: 'per_minute', perMinute: 0.006, ref: { product: 'gpt-4o-transcribe', sku: 'transcription' } },
  'openai:gpt-transcribe': { kind: 'per_minute', perMinute: 0.0045, ref: { product: 'gpt-transcribe', sku: 'transcription' } },
  'gemini:gemini-3.5-transcribe': { kind: 'per_minute', perMinute: 0.005, ref: undefined }, // 0.003 audio in + 0.002 text out per min

  // ── Realtime
  'openai:gpt-realtime-2.1-mini': { kind: 'realtime', inputPerMinute: 0.006, outputPerMinute: 0.024 },
  'openai:gpt-realtime-2.1': { kind: 'realtime', inputPerMinute: 0.0192, outputPerMinute: 0.0768 },
  'gemini:gemini-3.8-live': {
    kind: 'realtime',
    inputPerMinute: 0.005,
    outputPerMinute: 0.018,
    refs: { input: { product: 'gemini-3.8-live', sku: 'audio input' }, output: { product: 'gemini-3.8-live', sku: 'audio output' } },
  },

  // ── Maps / places (list price, free monthly caps ignored for per-call estimates)
  'google_places:nearby_search_pro': { kind: 'per_1k_requests', per1k: 32.0, freePerMonth: 5000, ref: { product: 'Places API (New) Nearby Search Pro', sku: 'Pro' } },
  'google_places:place_details_essentials': { kind: 'per_1k_requests', per1k: 5.0, freePerMonth: 10000, ref: { product: 'Places API (New) Place Details Essentials', sku: 'Essentials' } },
  'google_places:place_details_ids_only': { kind: 'per_1k_requests', per1k: 0, ref: { product: 'Places API (New) Place Details Essentials (IDs only)', sku: 'Essentials' } },
  'wikimedia:api': { kind: 'free' },
  'fake:fake': { kind: 'free' },
};

/** Fallback when a model id is unknown (env override not yet priced): most expensive plausible tier, so budgets err on the safe side. */
const UNKNOWN_LLM: PriceEntry = { kind: 'tokens', inputPerM: 10, outputPerM: 50 };

export function priceFor(provider: string, model: string | null): PriceEntry | null {
  if (provider === 'fake' || provider.startsWith('fake')) return { kind: 'free' };
  return PRICE_TABLE[`${provider}:${model ?? ''}`] ?? null;
}

export function isPromoActive(promoUntil: string | undefined, at: number): boolean {
  return !!promoUntil && at < Date.parse(`${promoUntil}T00:00:00Z`);
}

/**
 * Cost of one call. `at` selects promo vs. post-promo prices. `category` lets unknown LLM
 * models fall back to a conservative price instead of silently costing $0.
 */
export function computeCost(provider: string, model: string | null, units: CostRecord['units'], at: number, category?: CostRecord['category']): number {
  let p = priceFor(provider, model);
  if (!p) {
    if (category === 'llm') p = UNKNOWN_LLM;
    else return 0;
  }
  const M = 1_000_000;
  switch (p.kind) {
    case 'free':
      return 0;
    case 'tokens': {
      const promo = p.promoUntil ? isPromoActive(p.promoUntil, at) : true;
      const r = promo || !p.after ? p : { ...p, ...p.after };
      const cached = units.cachedInputTokens ?? 0;
      const input = Math.max(0, (units.inputTokens ?? 0) - cached);
      return (input * r.inputPerM + cached * (r.cachedInputPerM ?? r.inputPerM) + (units.outputTokens ?? 0) * r.outputPerM) / M;
    }
    case 'characters':
      return ((units.characters ?? 0) * p.perMChars) / M;
    case 'tts_tokens': {
      const promo = p.promoUntil ? isPromoActive(p.promoUntil, at) : true;
      const r = promo || !p.after ? p : { ...p, ...p.after };
      const textTokens = units.inputTokens ?? Math.ceil((units.characters ?? 0) / 4);
      const audioTokens = units.outputTokens ?? (units.audioSeconds ?? 0) * p.audioTokensPerSecond;
      return (textTokens * r.textInputPerM + audioTokens * r.audioOutputPerM) / M;
    }
    case 'per_minute':
      return ((units.audioSeconds ?? 0) / 60) * p.perMinute;
    case 'realtime':
      // Generic path prices audioSeconds as user input; sessions with both directions use realtimeCost().
      return ((units.audioSeconds ?? 0) / 60) * p.inputPerMinute;
    case 'per_1k_requests':
      return ((units.requests ?? 1) * p.per1k) / 1000;
  }
}

/** Realtime session cost split into user-audio-in and assistant-audio-out minutes. */
export function realtimeCost(provider: string, model: string, userAudioS: number, assistantAudioS: number): number {
  const p = priceFor(provider, model);
  if (!p || p.kind !== 'realtime') return 0;
  return (userAudioS / 60) * p.inputPerMinute + (assistantAudioS / 60) * p.outputPerMinute;
}
