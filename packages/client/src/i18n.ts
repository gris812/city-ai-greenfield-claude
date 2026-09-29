/**
 * Companion UI strings (EN / RU) shared by the WebApp and the native app. Moved from
 * apps/web/lib/i18n.ts (which re-exports this module). The marketing site is English-only for now.
 */
export type UiLocale = 'en' | 'ru';

const en = {
  nowTelling: 'Now telling',
  segmentOf: (i: number, n: number) => `segment ${i} of ${n}`,
  left: (s: string) => `${s} left`,
  pause: 'Pause',
  resume: 'Resume',
  skip: 'Skip',
  notThatOne: 'Not that one',
  paused: 'Paused',
  interrupted: 'Paused while you talk',
  deviceVoice: 'Device voice · degraded',
  textOnly: 'Text only · no voice available',
  quietTitle: 'Quiet stretch',
  quietBody: "Nothing worth interrupting for. Still here — tap the mic or say 'Telvey'.",
  warmingUp: 'Getting my bearings…',
  noFix: 'Waiting for a location…',
  listening: 'Listening…',
  answering: 'Answering',
  listeningHint: 'Ask about what you see, or say “skip”, “quieter”, “find coffee”.',
  typeInstead: 'Type your question',
  send: 'Send',
  cancel: 'Cancel',
  done: 'Done',
  tapToTalk: 'Tap to talk',
  holdToTalk: 'Tap or hold to talk',
  simulated: 'Simulated location',
  offlineDemo: 'Offline demo mode',
  live: 'Live',
  drive: 'Drive',
  guide: 'Guide',
  talkativeness: 'Talkativeness',
  quieter: 'Quieter',
  chattier: 'Chattier',
  history: 'History',
  settings: 'Settings',
  explore: 'Explore',
  debug: 'Debug',
  simulation: 'Simulation',
  scenario: 'Scenario',
  play: 'Play',
  speed: 'Speed',
  dragPuck: 'Drag the puck',
  useMyLocation: 'Use my location',
  stopSim: 'Stop',
  ahead: 'ahead',
  regime: {
    unknown: 'Starting',
    stationary: 'Standing still',
    walking: 'Walking',
    cycling: 'Cycling',
    urban_driving: 'City driving',
    highway_driving: 'Highway',
  } as Record<string, string>,
  density: { sparse: 'sparse', suburban: 'suburban', urban: 'urban', dense: 'dense' } as Record<string, string>,
  silence: {
    nothing_worth_it: 'Nothing worth interrupting for',
    cadence_gap: 'Letting the last story breathe',
    story_in_progress: 'Story in progress',
    safety_hold: 'Holding speech: maneuvering',
    listening: 'Listening',
    warming_up: 'Getting my bearings',
    user_paused: 'Paused',
    no_fix: 'Waiting for a location',
  } as Record<string, string>,
};

export type Dict = typeof en;

const ru: Dict = {
  ...en,
  nowTelling: 'Сейчас рассказывает',
  segmentOf: (i, n) => `фрагмент ${i} из ${n}`,
  left: (s) => `осталось ${s}`,
  pause: 'Пауза',
  resume: 'Продолжить',
  skip: 'Пропустить',
  notThatOne: 'Не то',
  paused: 'На паузе',
  interrupted: 'Пауза, пока вы говорите',
  deviceVoice: 'Голос устройства · упрощённый режим',
  textOnly: 'Только текст · голос недоступен',
  quietTitle: 'Тихий участок',
  quietBody: 'Ничего такого, ради чего стоит прерывать. Я рядом — нажмите на микрофон или скажите «Телвей».',
  warmingUp: 'Осматриваюсь…',
  noFix: 'Жду местоположение…',
  listening: 'Слушаю…',
  answering: 'Отвечаю',
  listeningHint: 'Спросите о том, что видите, или скажите «пропусти», «потише», «найди кофе».',
  typeInstead: 'Напишите вопрос',
  send: 'Отправить',
  cancel: 'Отмена',
  done: 'Готово',
  tapToTalk: 'Нажмите, чтобы говорить',
  holdToTalk: 'Нажмите или удерживайте',
  simulated: 'Симуляция местоположения',
  offlineDemo: 'Офлайн-демо',
  live: 'Онлайн',
  drive: 'За рулём',
  guide: 'Гид',
  talkativeness: 'Разговорчивость',
  quieter: 'Тише',
  chattier: 'Больше',
  history: 'История',
  settings: 'Настройки',
  explore: 'Карта',
  debug: 'Отладка',
  simulation: 'Симуляция',
  scenario: 'Сценарий',
  play: 'Старт',
  speed: 'Скорость',
  dragPuck: 'Перетащить точку',
  useMyLocation: 'Моё местоположение',
  stopSim: 'Стоп',
  ahead: 'впереди',
  regime: {
    unknown: 'Старт',
    stationary: 'На месте',
    walking: 'Пешком',
    cycling: 'На велосипеде',
    urban_driving: 'Город',
    highway_driving: 'Трасса',
  },
  density: { sparse: 'редко', suburban: 'пригород', urban: 'город', dense: 'центр' },
  silence: {
    nothing_worth_it: 'Нечего рассказать',
    cadence_gap: 'Пауза после истории',
    story_in_progress: 'Идёт рассказ',
    safety_hold: 'Жду: манёвр',
    listening: 'Слушаю',
    warming_up: 'Осматриваюсь',
    user_paused: 'Пауза',
    no_fix: 'Нет местоположения',
  },
};

export const DICTS: Record<UiLocale, Dict> = { en, ru };
export const EN = en;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDistance(m: number, units: 'metric' | 'imperial'): string {
  if (units === 'imperial') {
    const mi = m / 1609.344;
    if (mi < 0.2) return `${Math.round((m * 3.28084) / 50) * 50} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
