/**
 * Provider configuration from environment. Selection is config + benchmark driven (D-010):
 * each task has an ordered provider list; a provider is included only when its key is set.
 * Model ids are env-overridable because the research found conflicting model names across
 * OpenAI pages — defaults are provisional until `scripts/bench/providers.ts` verifies them.
 */
import { DEFAULT_TTS_TIERS, type MovementRegime, type TtsTier, type TtsTierConfig } from '@city/core';
import { GOOGLE_TTS_FAMILIES, type GoogleVoiceFamily } from './adapters/google-tts.js';

export interface ProviderEnvConfig {
  keys: { openai?: string; gemini?: string; anthropic?: string; googleMaps?: string; googleTts?: string };
  models: {
    openaiStory: string;
    openaiIntent: string;
    openaiTts: string;
    openaiStt: string;
    openaiRealtime: string;
    geminiStory: string;
    geminiIntent: string;
    geminiTts: string;
    geminiStt: string;
    geminiLive: string;
    anthropicStory: string;
    /** Google Cloud TTS voice family of the cheap tier (D-019). */
    googleTtsFamily: GoogleVoiceFamily;
  };
  order: {
    story: string[];
    intent: string[];
    tts: string[];
    /** Cheap TTS tier chain (D-019); falls back to `tts` when empty or failing. */
    ttsEconomy: string[];
    stt: string[];
    realtime: string[];
    places: string[];
    knowledge: string[];
    nearby: string[];
  };
  openaiReasoningEffort?: string;
  /** Allow deterministic fakes when no real provider is configured (never in production unless DEMO_MODE). */
  allowFakes: boolean;
  demoMode: boolean;
}

type Env = Record<string, string | undefined>;

function list(v: string | undefined, dflt: string[]): string[] {
  if (!v || !v.trim()) return dflt;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function providerConfigFromEnv(env: Env = process.env): ProviderEnvConfig {
  const production = env.NODE_ENV === 'production';
  const demoMode = env.DEMO_MODE === '1';
  const keys: ProviderEnvConfig['keys'] = {};
  const openai = nonEmpty(env.OPENAI_API_KEY);
  const gemini = nonEmpty(env.GEMINI_API_KEY);
  const anthropic = nonEmpty(env.ANTHROPIC_API_KEY);
  const googleMaps = nonEmpty(env.GOOGLE_MAPS_SERVER_KEY);
  const googleTts = nonEmpty(env.GOOGLE_TTS_API_KEY) ?? nonEmpty(env.GOOGLE_CLOUD_API_KEY);
  if (googleTts) keys.googleTts = googleTts;
  if (openai) keys.openai = openai;
  if (gemini) keys.gemini = gemini;
  if (anthropic) keys.anthropic = anthropic;
  if (googleMaps) keys.googleMaps = googleMaps;
  const effort = nonEmpty(env.OPENAI_REASONING_EFFORT);
  return {
    keys,
    models: {
      openaiStory: env.OPENAI_STORY_MODEL ?? 'gpt-6-luna',
      openaiIntent: env.OPENAI_INTENT_MODEL ?? 'gpt-6-luna',
      openaiTts: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      openaiStt: env.OPENAI_STT_MODEL ?? 'gpt-4o-mini-transcribe',
      openaiRealtime: env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2.1-mini',
      geminiStory: env.GEMINI_STORY_MODEL ?? 'gemini-3.1-flash-lite',
      geminiIntent: env.GEMINI_INTENT_MODEL ?? 'gemini-3.1-flash-lite',
      geminiTts: env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-lite-tts',
      geminiStt: env.GEMINI_STT_MODEL ?? 'gemini-3.5-transcribe',
      geminiLive: env.GEMINI_LIVE_MODEL ?? 'gemini-3.8-live',
      anthropicStory: env.ANTHROPIC_STORY_MODEL ?? 'claude-haiku-4-5',
      googleTtsFamily: (GOOGLE_TTS_FAMILIES as readonly string[]).includes(String(env.GOOGLE_TTS_VOICE_TYPE ?? '').toLowerCase()) ? (String(env.GOOGLE_TTS_VOICE_TYPE).toLowerCase() as GoogleVoiceFamily) : 'wavenet',
    },
    order: {
      story: list(env.STORY_PROVIDERS, ['openai', 'gemini', 'anthropic']),
      intent: list(env.INTENT_PROVIDERS, ['openai', 'gemini', 'anthropic']),
      tts: list(env.TTS_PROVIDERS, ['openai', 'gemini']),
      ttsEconomy: list(env.TTS_ECONOMY_PROVIDERS, ['google_tts']),
      stt: list(env.STT_PROVIDERS, ['openai', 'gemini']),
      realtime: list(env.REALTIME_PROVIDERS, ['openai', 'gemini']),
      places: list(env.PLACES_PROVIDERS, ['wikimedia']),
      knowledge: list(env.KNOWLEDGE_PROVIDERS, ['wikimedia']),
      nearby: list(env.NEARBY_PROVIDERS, ['google_places']),
    },
    ...(effort ? { openaiReasoningEffort: effort } : {}),
    allowFakes: !production || demoMode || env.ALLOW_FAKE_PROVIDERS === '1',
    demoMode,
  };
}

/** Names of configured real providers per task (for /readyz; never includes key material). */
export function describeConfig(c: ProviderEnvConfig): Record<string, string[]> {
  const has = (p: string) => (p === 'openai' ? !!c.keys.openai : p === 'gemini' ? !!c.keys.gemini : p === 'anthropic' ? !!c.keys.anthropic : p === 'google_places' ? !!c.keys.googleMaps : p === 'google_tts' ? !!c.keys.googleTts : p === 'wikimedia');
  return Object.fromEntries(Object.entries(c.order).map(([task, ps]) => [task, ps.filter(has)]));
}

const TIERS: readonly TtsTier[] = ['standard', 'economy'];
const tier = (v: string | undefined): TtsTier | undefined => (v && (TIERS as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as TtsTier) : undefined);

/**
 * TTS tier routing from env (D-019), on top of core's DEFAULT_TTS_TIERS:
 *   TTS_TIER_WALKING (walking, stationary, unknown), TTS_TIER_CYCLING, TTS_TIER_URBAN_DRIVING,
 *   TTS_TIER_HIGHWAY, TTS_TIER_ANSWER, TTS_TIER_ACK = standard | economy;
 *   TTS_TIER_PREFIX = match | standard | economy.
 */
export function ttsTiersFromEnv(env: Env = process.env): TtsTierConfig {
  const d = DEFAULT_TTS_TIERS;
  const walking = tier(env.TTS_TIER_WALKING);
  const stories: Record<MovementRegime, TtsTier> = {
    unknown: walking ?? d.stories.unknown,
    stationary: walking ?? d.stories.stationary,
    walking: walking ?? d.stories.walking,
    cycling: tier(env.TTS_TIER_CYCLING) ?? d.stories.cycling,
    urban_driving: tier(env.TTS_TIER_URBAN_DRIVING) ?? d.stories.urban_driving,
    highway_driving: tier(env.TTS_TIER_HIGHWAY) ?? d.stories.highway_driving,
  };
  const p = String(env.TTS_TIER_PREFIX ?? '').trim().toLowerCase();
  return { stories, prefix: p === 'match' ? 'match' : (tier(p) ?? d.prefix), answer: tier(env.TTS_TIER_ANSWER) ?? d.answer, ack: tier(env.TTS_TIER_ACK) ?? d.ack };
}
