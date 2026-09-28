/**
 * Provider configuration from environment. Selection is config + benchmark driven (D-010):
 * each task has an ordered provider list; a provider is included only when its key is set.
 * Model ids are env-overridable because the research found conflicting model names across
 * OpenAI pages — defaults are provisional until `scripts/bench/providers.ts` verifies them.
 */
export interface ProviderEnvConfig {
  keys: { openai?: string; gemini?: string; anthropic?: string; googleMaps?: string };
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
  };
  order: {
    story: string[];
    intent: string[];
    tts: string[];
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
    },
    order: {
      story: list(env.STORY_PROVIDERS, ['openai', 'gemini', 'anthropic']),
      intent: list(env.INTENT_PROVIDERS, ['openai', 'gemini', 'anthropic']),
      tts: list(env.TTS_PROVIDERS, ['openai', 'gemini']),
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
  const has = (p: string) => (p === 'openai' ? !!c.keys.openai : p === 'gemini' ? !!c.keys.gemini : p === 'anthropic' ? !!c.keys.anthropic : p === 'google_places' ? !!c.keys.googleMaps : p === 'wikimedia');
  return Object.fromEntries(Object.entries(c.order).map(([task, ps]) => [task, ps.filter(has)]));
}
