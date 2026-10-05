import { describe, expect, it } from 'vitest';
import { interpretUtterance } from '../src/index.js';

const cases: Array<[string, string, string, Record<string, string>?]> = [
  // EN
  ['skip', 'en', 'skip'],
  ['Next one.', 'en', 'skip'],
  ['stop', 'en', 'stop'],
  ["That's enough", 'en', 'stop'],
  ['pause', 'en', 'pause'],
  ['hold on', 'en', 'pause'],
  ['continue', 'en', 'resume'],
  ['where were we?', 'en', 'resume'],
  ['can you repeat that', 'en', 'repeat'],
  ['tell me more', 'en', 'tell_more'],
  ["what's that?", 'en', 'what_is_that'],
  ['what am I looking at', 'en', 'what_is_that'],
  ['not that one', 'en', 'not_that_one'],
  ['talk less please', 'en', 'quieter'],
  ['more stories please', 'en', 'chattier'],
  ['where can I get coffee', 'en', 'nearby_search', { category: 'coffee' }],
  ["where's the nearest gas station", 'en', 'nearby_search', { category: 'gas_station' }],
  ['I need parking', 'en', 'nearby_search', { category: 'parking' }],
  ['coffee', 'en', 'nearby_search', { category: 'coffee' }],
  ['find a truck stop', 'en', 'nearby_search', { category: 'rest_area' }],
  ['navigate to the Art Museum', 'en', 'navigate_to', { query: 'Art Museum' }],
  ['switch guide', 'en', 'change_guide'],
  // RU
  ['пропусти', 'ru', 'skip'],
  ['дальше', 'ru', 'skip'],
  ['стоп', 'ru', 'stop'],
  ['хватит', 'ru', 'stop'],
  ['подожди', 'ru', 'pause'],
  ['продолжай', 'ru', 'resume'],
  ['повтори', 'ru', 'repeat'],
  ['расскажи подробнее', 'ru', 'tell_more'],
  ['что это?', 'ru', 'what_is_that'],
  ['не то', 'ru', 'not_that_one'],
  ['говори меньше', 'ru', 'quieter'],
  ['рассказывай почаще', 'ru', 'chattier'],
  ['где ближайшая парковка', 'ru', 'nearby_search', { category: 'parking' }],
  ['хочу кофе', 'ru', 'nearby_search', { category: 'coffee' }],
  ['найди заправку', 'ru', 'nearby_search', { category: 'gas_station' }],
  ['проложи маршрут до музея', 'ru', 'navigate_to', { query: 'музея' }],
  ['смени гида', 'ru', 'change_guide'],
];

describe('rule-based intent (EN/RU)', () => {
  for (const [text, locale, intent, slots] of cases) {
    it(`${locale}: "${text}" → ${intent}`, () => {
      const r = interpretUtterance(text, locale);
      expect(r).not.toBeNull();
      expect(r!.intent).toBe(intent);
      expect(r!.interpretedBy).toBe('rules');
      if (slots) expect(r!.slots).toMatchObject(slots);
    });
  }

  it('returns null when unsure (escalate to LLM)', () => {
    expect(interpretUtterance('who designed the building next to the one with the green roof', 'en')).toBeNull();
    expect(interpretUtterance('почему у этого здания такая странная крыша', 'ru')).toBeNull();
    expect(interpretUtterance('   ', 'en')).toBeNull();
  });

  it('"stop" inside a longer question does not become a control command', () => {
    expect(interpretUtterance('why did they stop building the second tower', 'en')?.intent ?? null).not.toBe('stop');
  });
});
