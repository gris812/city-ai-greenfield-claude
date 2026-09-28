/** Per-viewer WebApp preferences (browser storage; conveniences only, never product state). */
export interface Settings {
  guideId: 'ida' | 'emil';
  locale: 'en' | 'ru';
  units: 'metric' | 'imperial';
  talkativeness: number;
  transport: 'auto' | 'local' | 'live';
  voice: boolean;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  guideId: 'ida',
  locale: 'en',
  units: 'imperial',
  talkativeness: 0,
  transport: 'auto',
  voice: true,
  theme: 'system',
};

const KEY = 'telvey.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const lang = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
      return { ...DEFAULT_SETTINGS, locale: lang.startsWith('ru') ? 'ru' : 'en', units: lang === 'en-us' || lang.endsWith('-us') ? 'imperial' : 'metric' };
    }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

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

const HKEY = 'telvey.history.v1';

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HKEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}
export function saveHistory(h: HistoryEntry[]): void {
  try {
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 100)));
  } catch {
    /* ignore */
  }
}
export function clearLocalData(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('telvey.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
