/** Deterministic short phrases (acks, bridges, errors) in EN/RU. No facts, nothing to ground. */
import { isRussian } from '@city/core';

type P = { en: string; ru: string };

export const PHRASES = {
  bridge: { en: 'As I was saying…', ru: 'Так вот, продолжим…' },
  ackSkip: { en: 'Okay, moving on.', ru: 'Хорошо, идём дальше.' },
  ackTopic: { en: "Sure, let's leave that.", ru: 'Хорошо, оставим это.' },
  ackStop: { en: "Okay, I'll be quiet.", ru: 'Хорошо, тишина.' },
  ackPause: { en: 'Paused.', ru: 'Пауза.' },
  ackQuieter: { en: "Got it, I'll talk less.", ru: 'Хорошо, буду говорить реже.' },
  ackChattier: { en: "Got it, I'll tell you more.", ru: 'Хорошо, буду рассказывать чаще.' },
  noFix: { en: "I can't see your location yet.", ru: 'Я пока не вижу, где вы.' },
  notUnderstood: { en: "Sorry, I didn't catch that.", ru: 'Простите, не удалось разобрать.' },
  noSubject: { en: "I'm not sure which place you mean.", ru: 'Не совсем понятно, о каком месте речь.' },
  nearbyFailed: { en: "I can't search nearby right now.", ru: 'Сейчас не получается искать поблизости.' },
  nearbyLimited: { en: 'Give me a moment before the next search.', ru: 'Дайте мне минутку перед следующим поиском.' },
  nothingToRepeat: { en: 'There is nothing to repeat yet.', ru: 'Пока нечего повторить.' },
  navigateUnknown: { en: "I don't know where that is yet. Try asking me to find it first.", ru: 'Я пока не знаю, где это. Попросите меня сначала найти это место.' },
  navigating: { en: 'Opening directions.', ru: 'Открываю маршрут.' },
  guideChanged: { en: "Hi, I'll take it from here.", ru: 'Привет, дальше с вами буду я.' },
  smalltalk: { en: "I'm here. Ask me about anything you see.", ru: 'Я здесь. Спрашивайте о том, что видите.' },
} satisfies Record<string, P>;

export type PhraseKey = keyof typeof PHRASES;

export function phrase(key: PhraseKey, locale: string): string {
  return isRussian(locale) ? PHRASES[key].ru : PHRASES[key].en;
}

export const CATEGORY_LABEL: Record<string, P> = {
  coffee: { en: 'coffee', ru: 'кофе' },
  parking: { en: 'parking', ru: 'парковку' },
  gas_station: { en: 'a gas station', ru: 'заправку' },
  ev_charging: { en: 'EV charging', ru: 'зарядную станцию' },
  restroom: { en: 'a restroom', ru: 'туалет' },
  pharmacy: { en: 'a pharmacy', ru: 'аптеку' },
  atm: { en: 'an ATM', ru: 'банкомат' },
  restaurant: { en: 'a place to eat', ru: 'где поесть' },
  lodging: { en: 'a place to stay', ru: 'где переночевать' },
  rest_area: { en: 'a rest area', ru: 'зону отдыха' },
  grocery: { en: 'a grocery store', ru: 'магазин' },
};

export function categoryLabel(cat: string | null | undefined, locale: string): string {
  const l = cat ? CATEGORY_LABEL[cat] : undefined;
  if (!l) return isRussian(locale) ? 'это' : 'that';
  return isRussian(locale) ? l.ru : l.en;
}
