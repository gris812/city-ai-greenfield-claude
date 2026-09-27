/**
 * Rule-based utterance interpreter (EN + RU). Returns null when unsure so the caller can
 * escalate to the LLM interpreter (D-003). Rules are ordered: most specific first.
 */
import type { Intent, InterpretedUtterance, Locale } from './contracts.js';

interface Rule {
  intent: Intent;
  re: RegExp;
  confidence: number;
  slots?: (m: RegExpMatchArray, text: string) => InterpretedUtterance['slots'];
}

/** Normalized category keys for nearby search (EN + RU surface forms). */
export const CATEGORY_SYNONYMS: Array<{ category: string; re: RegExp }> = [
  { category: 'gas_station', re: /\b(gas|petrol|fuel)(\s+station)?s?\b|\bfill up\b|заправк\p{L}*|бензин\p{L}*|азс/iu },
  { category: 'ev_charging', re: /\b(ev\s+)?charg(er|ing)(\s+station)?s?\b|зарядк\p{L}*|зарядн\p{L}*\s+станц\p{L}*/iu },
  { category: 'parking', re: /\bpark(ing|ing lot|ing garage)\b|парковк\p{L}*|стоянк\p{L}*/iu },
  { category: 'coffee', re: /\bcoffee( shop)?s?\b|\bcaf[eé]s?\b|\bespresso\b|кофе\p{L}*|кофейн\p{L}*|кафе/iu },
  { category: 'restroom', re: /\b(restroom|bathroom|toilet|washroom)s?\b|туалет\p{L}*/iu },
  { category: 'pharmacy', re: /\b(pharmacy|pharmacies|drugstore|chemist)\b|аптек\p{L}*/iu },
  { category: 'atm', re: /\batms?\b|\bcash machine\b|банкомат\p{L}*/iu },
  { category: 'restaurant', re: /\b(restaurant|diner|place to eat|somewhere to eat|food|lunch|dinner|breakfast)s?\b|ресторан\p{L}*|поесть|пообедать|поужинать|позавтракать|столов\p{L}*|еда/iu },
  { category: 'lodging', re: /\b(hotel|motel|place to stay|lodging)s?\b|гостиниц\p{L}*|отел\p{L}*|мотел\p{L}*|переночевать/iu },
  { category: 'rest_area', re: /\b(rest (area|stop)|truck stop)s?\b|зон\p{L}* отдыха|стоянк\p{L}* для грузовик\p{L}*/iu },
  { category: 'grocery', re: /\b(grocery|supermarket|grocery store)s?\b|продуктов\p{L}*|супермаркет\p{L}*|магазин\p{L}*/iu },
];

export function extractCategory(text: string): string | null {
  for (const c of CATEGORY_SYNONYMS) if (c.re.test(text)) return c.category;
  return null;
}

// \b does not work with Cyrillic in JS regex; use explicit boundaries for RU.
const B = '(?:^|[\\s,.!?;:«»"—-])';
const E = '(?=$|[\\s,.!?;:«»"—-])';
function ru(pattern: string): RegExp {
  return new RegExp(`${B}(?:${pattern})${E}`, 'iu');
}

const NEARBY_EN = /\b(where (can|do|could) (i|we) (get|find|buy)|where('s| is)?( the)? (nearest|closest)|find( me)?( a| the| some)?|is there( a| any)?|any|looking for|i need( a)?|take me to( a| the)? nearest|nearest|closest)\b/i;
const NEARBY_RU = ru('где (?:ближайш\\p{L}*|найти|тут|здесь)|найди\\p{L}*|найти|ближайш\\p{L}*|есть (?:ли )?(?:тут|рядом|поблизости)|нужн\\p{L}*|поищи|ищу');

const RULES: Rule[] = [
  // navigation
  {
    intent: 'navigate_to',
    re: /\b(navigate|take me|directions|drive me|route me|get me) to\s+(?:the\s+)?(.+?)[.!?]*$/i,
    confidence: 0.85,
    slots: (m) => ({ query: m[2]!.trim(), placeRef: m[2]!.trim() }),
  },
  {
    intent: 'navigate_to',
    re: ru('(?:проложи маршрут|как (?:доехать|добраться|пройти)|отвези меня|веди меня|поехали|маршрут) (?:до|к|в|на)\\s+(.+?)[.!?]*$'),
    confidence: 0.85,
    slots: (m) => ({ query: m[1]!.trim(), placeRef: m[1]!.trim() }),
  },
  // control
  { intent: 'not_that_one', re: /\b(not (that|this) one|not interested|not that|something else|other one)\b/i, confidence: 0.9 },
  { intent: 'not_that_one', re: ru('не (?:то|это|этот|эту|об этом|про это)|не интересно|неинтересно|что-нибудь другое|другое'), confidence: 0.85 },
  { intent: 'skip', re: /^\s*(skip( it| this| that)?|next( one)?|move on)[.!]*\s*$/i, confidence: 0.95 },
  { intent: 'skip', re: ru('пропусти\\p{L}*|дальше|следующ\\p{L}*|пропуск'), confidence: 0.9 },
  { intent: 'stop', re: /^\s*(stop( talking| it)?|shut up|be quiet|enough|that's enough|silence)[.!]*\s*$/i, confidence: 0.95 },
  { intent: 'stop', re: ru('стоп|хватит|замолчи|помолчи|достаточно|прекрати|остановись|тихо'), confidence: 0.9 },
  { intent: 'pause', re: /^\s*(pause|hold on|wait( a (sec|second|minute))?|one (sec|second|moment))[.!]*\s*$/i, confidence: 0.95 },
  { intent: 'pause', re: ru('пауза|подожди|погоди|секунду|минутку|постой'), confidence: 0.9 },
  { intent: 'resume', re: /^\s*(resume|continue|go on|keep going|carry on|where were we|play)[.!?]*\s*$/i, confidence: 0.95 },
  { intent: 'resume', re: ru('продолжай|продолжи|продолжить|дальше рассказывай|на чём мы остановились|давай дальше'), confidence: 0.9 },
  { intent: 'repeat', re: /\b(repeat( that)?|say (that|it) again|come again|what did you say|pardon)\b/i, confidence: 0.9 },
  { intent: 'repeat', re: ru('повтори\\p{L}*|ещё раз|что ты сказал\\p{L}*|не расслышал\\p{L}*'), confidence: 0.9 },
  { intent: 'quieter', re: /\b(talk less|less talk(ing|ative)?|fewer stories|(be )?quieter( please)?|not so (much|chatty|often))\b/i, confidence: 0.85 },
  { intent: 'quieter', re: ru('говори меньше|поменьше|реже|меньше рассказывай|не так часто|потише'), confidence: 0.85 },
  { intent: 'chattier', re: /\b(talk more|more stories|more often|(be )?chattier|tell me more often)\b/i, confidence: 0.85 },
  { intent: 'chattier', re: ru('говори больше|рассказывай больше|почаще|чаще|побольше'), confidence: 0.85 },
  { intent: 'tell_more', re: /\b(tell me more|more about (it|that|this)|go deeper|and then\??|what else)\b/i, confidence: 0.9 },
  { intent: 'tell_more', re: ru('расскажи (?:ещё|подробнее|больше)|подробнее|а что ещё|что ещё'), confidence: 0.9 },
  { intent: 'what_is_that', re: /\b(what('s| is) (that|this|there|it)|what am i (looking at|seeing)|what building is (that|this))\b/i, confidence: 0.9 },
  { intent: 'what_is_that', re: ru('что (?:это|там|вот это)(?: за (?:здание|место))?|что это такое'), confidence: 0.9 },
  { intent: 'change_guide', re: /\b(change|switch)( the)? guide\b|\bdifferent guide\b/i, confidence: 0.85 },
  { intent: 'change_guide', re: ru('(?:смени|поменяй|другой) гид\\p{L}*'), confidence: 0.85 },
];

export function interpretUtterance(text: string, locale: Locale = 'en'): InterpretedUtterance | null {
  const t = text.trim();
  if (!t) return null;
  void locale; // rules are bilingual; locale is informative for the LLM fallback

  // Nearby search first when a category is present with a search cue (or alone as a short phrase).
  const category = extractCategory(t);
  if (category) {
    const cue = NEARBY_EN.test(t) || NEARBY_RU.test(t);
    const short = t.split(/\s+/).length <= 3;
    const navigateCue = /\b(navigate|directions|route me|take me to (?!(a|the)? ?(nearest|closest)))\b/i.test(t);
    if ((cue || short) && !navigateCue) {
      return { text: t, intent: 'nearby_search', slots: { category, query: t }, confidence: cue ? 0.9 : 0.7, interpretedBy: 'rules' };
    }
  }

  for (const r of RULES) {
    const m = t.match(r.re);
    if (m) return { text: t, intent: r.intent, slots: r.slots ? r.slots(m, t) : {}, confidence: r.confidence, interpretedBy: 'rules' };
  }
  return null;
}
