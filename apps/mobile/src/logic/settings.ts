/** App settings model (pure; persisted by the store). */

export type SttMode = 'auto' | 'device' | 'server';

export interface Settings {
  guideId: 'ida' | 'emil';
  locale: 'en' | 'ru';
  units: 'metric' | 'imperial';
  /** -2 quieter … +2 chattier. */
  talkativeness: number;
  /** auto: live when the API is reachable, otherwise offline demo. */
  transport: 'auto' | 'local' | 'live';
  /** Voice input: on-device recognition (fast, preferred) with server STT fallback. */
  stt: SttMode;
  /** Keep following location with the screen locked while a session is active (E2). */
  backgroundLocation: boolean;
  /** Spoken output; off = captions only. */
  voice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  guideId: 'ida',
  locale: 'en',
  units: 'imperial',
  talkativeness: 0,
  transport: 'auto',
  stt: 'auto',
  backgroundLocation: true,
  voice: true,
};

/** Imperial regions per CLDR (US, Liberia, Myanmar); everything else metric. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

export function defaultSettingsFor(languageCode: string | null | undefined, regionCode: string | null | undefined): Settings {
  const lang = (languageCode ?? 'en').toLowerCase();
  const region = (regionCode ?? '').toUpperCase();
  return { ...DEFAULT_SETTINGS, locale: lang.startsWith('ru') ? 'ru' : 'en', units: IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric' };
}

export function mergeSettings(base: Settings, stored: Partial<Settings> | null | undefined): Settings {
  if (!stored || typeof stored !== 'object') return base;
  const s = { ...base, ...stored };
  return {
    guideId: s.guideId === 'emil' ? 'emil' : 'ida',
    locale: s.locale === 'ru' ? 'ru' : 'en',
    units: s.units === 'metric' ? 'metric' : 'imperial',
    talkativeness: Math.max(-2, Math.min(2, Math.round(Number(s.talkativeness) || 0))),
    transport: s.transport === 'local' || s.transport === 'live' ? s.transport : 'auto',
    stt: s.stt === 'device' || s.stt === 'server' ? s.stt : 'auto',
    backgroundLocation: s.backgroundLocation !== false,
    voice: s.voice !== false,
  };
}

/** BCP-47 tag for TTS / STT / the server session. */
export function localeTag(s: Pick<Settings, 'locale' | 'units'>): string {
  return s.locale === 'ru' ? 'ru-RU' : s.units === 'imperial' ? 'en-US' : 'en-GB';
}

export interface HistoryEntry {
  planId: string;
  placeName: string;
  guideId: string;
  at: number;
  simulated: boolean;
  excerpt: string;
}

export function addHistory(h: HistoryEntry[], e: HistoryEntry, max = 100): HistoryEntry[] {
  if (h.some((x) => x.planId === e.planId)) return h;
  return [e, ...h].slice(0, max);
}
