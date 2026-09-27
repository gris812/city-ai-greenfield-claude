/**
 * GroundingCheck (D-003): every number and proper noun in generated prose must be
 * traceable to the StoryBrief (facts, place name, spatial cue, journey callbacks) or to a
 * small allowlist of generic words. Also enforces the word budget (+15 %).
 *
 * Deliberately conservative and language-light:
 *  - numbers: digit groups (thousand separators normalized), plus minimal EN spelled-out
 *    numbers ("two hundred", "twenty-three", "a thousand" is NOT counted — only explicit numerals);
 *  - entities: EN capitalized sequences (with "of/the/de/and" connectors) excluding
 *    sentence-initial single words; RU Cyrillic capitalized words mid-sentence and
 *    capitalized sequences, matched by stem prefix to tolerate case endings.
 */
import type { GroundingResult, StoryBrief } from './contracts.js';
import { isRussian, wordCount } from './brief.js';

export const GROUNDING = {
  OVER_BUDGET_FACTOR: 1.15,
} as const;

/** Capitalized words that are never treated as named entities. */
export const GENERIC_CAPITALIZED = new Set([
  'I',
  "I'm",
  "I'd",
  "I've",
  "I'll",
  'OK',
  'North',
  'South',
  'East',
  'West',
  'Northern',
  'Southern',
  'Eastern',
  'Western',
  'Here',
  'There',
  'Now',
  'Look',
  'Listen',
  'Ahead',
  // RU
  'Я',
  'Вот',
  'Здесь',
  'Сейчас',
  'Смотрите',
  'Впереди',
]);

/** Leading words stripped from sentence-initial capitalized sequences. */
const LEAD_STOP = new Set(['The', 'A', 'An', 'This', 'That', 'These', 'Those', 'In', 'On', 'At', 'From', 'By', 'For', 'Its', 'It', 'And', 'But', 'As', 'Then', 'When', 'Today', 'Here', 'There', 'Just', 'Now', 'Ahead', 'Behind', 'Earlier', 'Soon', 'Look', 'After', 'Before', 'Since', 'With', 'To', 'Of', 'Our', 'Your', 'My', 'If', 'So', 'Yet']);
const EN_CONNECTORS = new Set(['of', 'the', 'de', 'la', 'del', 'and', '&', 'von', 'van', 'du', 'des', 'le', 'y']);

const EN_UNITS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const EN_MULT: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

function normNumber(raw: string): string {
  let s = raw.replace(/[   ]/g, '');
  // thousands separators: 1,776 / 2,983 / 1.776 (EU) when followed by exactly 3 digits
  if (/^\d{1,3}([,.]\d{3})+$/.test(s)) s = s.replace(/[,.]/g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/** Numbers as normalized strings (digits + minimal EN spelled-out). */
export function extractNumbers(text: string, locale: string = 'en'): string[] {
  const out: string[] = [];
  const digitRe = /\d{1,3}(?:[,  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  for (const m of text.matchAll(digitRe)) out.push(normNumber(m[0]));
  if (!isRussian(locale)) {
    const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s]+/).filter(Boolean);
    let i = 0;
    while (i < words.length) {
      let val: number | null = null;
      let j = i;
      const parsePart = (w: string): number | null => {
        if (w in EN_UNITS) return EN_UNITS[w]!;
        if (w in EN_TENS) return EN_TENS[w]!;
        const h = w.split('-');
        if (h.length === 2 && h[0]! in EN_TENS && h[1]! in EN_UNITS && EN_UNITS[h[1]!]! < 10) return EN_TENS[h[0]!]! + EN_UNITS[h[1]!]!;
        return null;
      };
      const first = parsePart(words[j]!);
      if (first !== null) {
        val = first;
        j++;
        while (j < words.length && words[j]! in EN_MULT) {
          val *= EN_MULT[words[j]!]!;
          j++;
        }
        out.push(String(val));
        i = j;
        continue;
      }
      i++;
    }
  }
  return out;
}

interface EntityHit {
  text: string;
  words: string[];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CAP_WORD = /^[\p{Lu}][\p{L}\p{M}'’.\-]*$/u;

function stripPunct(w: string): string {
  return w.replace(/^[«"“„‘'(\[]+|[»"”’'),.;:!?…\]]+$/gu, '');
}

/** Capitalized entity sequences (EN connectors allowed between capitalized words). */
export function extractEntities(text: string, locale: string = 'en'): string[] {
  const ru = isRussian(locale);
  const out: EntityHit[] = [];
  for (const sent of sentences(text)) {
    const raw = sent.split(/\s+/);
    const toks = raw.map(stripPunct);
    let i = 0;
    while (i < toks.length) {
      const t = toks[i]!;
      if (!t || !CAP_WORD.test(t)) {
        i++;
        continue;
      }
      const start = i;
      const seq: string[] = [t];
      let j = i + 1;
      // a sequence breaks at punctuation that ends a phrase
      const breaks = (k: number) => /[,.;:!?…»”)]$/u.test(raw[k]!);
      if (!breaks(i)) {
        while (j < toks.length) {
          const w = toks[j]!;
          if (CAP_WORD.test(w)) {
            seq.push(w);
            if (breaks(j)) {
              j++;
              break;
            }
            j++;
            continue;
          }
          if (!ru && EN_CONNECTORS.has(w) && j + 1 < toks.length && CAP_WORD.test(toks[j + 1]!) && !breaks(j)) {
            seq.push(w);
            j++;
            continue;
          }
          break;
        }
      } else j = i + 1;
      // trim trailing connectors
      while (seq.length > 0 && EN_CONNECTORS.has(seq.at(-1)!)) seq.pop();
      let words = seq;
      if (start === 0) {
        while (words.length > 0 && (LEAD_STOP.has(words[0]!) || GENERIC_CAPITALIZED.has(words[0]!))) words = words.slice(1);
        // sentence-initial single word: ambiguous capitalization → ignore
        if (words.length === seq.length && words.length === 1) words = [];
        while (words.length > 0 && EN_CONNECTORS.has(words[0]!)) words = words.slice(1);
      }
      words = words.filter((w, k) => !(k === 0 && GENERIC_CAPITALIZED.has(w)));
      if (words.length === 1 && GENERIC_CAPITALIZED.has(words[0]!)) words = [];
      if (words.length > 0) out.push({ text: words.join(' '), words });
      i = Math.max(j, i + 1);
    }
  }
  const seen = new Set<string>();
  const res: string[] = [];
  for (const e of out) {
    if (!seen.has(e.text)) {
      seen.add(e.text);
      res.push(e.text);
    }
  }
  return res;
}

function corpusOf(brief: StoryBrief, extra: readonly string[]): string {
  const parts: string[] = [brief.placeName, brief.spatialCue ?? '', ...brief.journeyCallbacks, ...extra];
  for (const f of brief.facts) {
    parts.push(f.text, ...f.entities, ...f.numbers);
  }
  return parts.join(' \n ');
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[’']/g, "'").replace(/ё/g, 'е');
}

/** Russian inflection tolerance: compare stems (word minus up to 3 trailing letters, ≥ 4 chars). */
function ruStem(w: string): string {
  const n = normWord(w);
  return n.length <= 4 ? n : n.slice(0, Math.max(4, n.length - 3));
}

function ruStemMatch(word: string, corpusWords: Set<string>): boolean {
  const w = normWord(word);
  if (corpusWords.has(w)) return true;
  const stem = ruStem(w);
  for (const c of corpusWords) {
    if (c.length < 3) continue;
    if (ruStem(c) === stem || (c.startsWith(stem) && c.length - stem.length <= 4) || (w.startsWith(ruStem(c)) && w.length - ruStem(c).length <= 4)) return true;
  }
  return false;
}

export interface GroundingOptions {
  /** Extra allowed tokens (e.g. the Guide's own name). */
  allow?: string[];
}

export function checkGrounding(text: string, brief: StoryBrief, opts: GroundingOptions = {}): GroundingResult {
  const corpus = corpusOf(brief, opts.allow ?? []);
  const corpusLower = ` ${normWord(corpus).replace(/\s+/g, ' ')} `;
  const corpusNums = new Set(extractNumbers(corpus, 'en'));
  for (const f of brief.facts) for (const n of f.numbers) for (const x of extractNumbers(n, 'en')) corpusNums.add(x);
  const unsupportedNumbers = [...new Set(extractNumbers(text, brief.locale))].filter((n) => !corpusNums.has(n));

  const ru = isRussian(brief.locale);
  const corpusWords = new Set(
    normWord(corpus)
      .split(/[^\p{L}\p{N}'\-]+/u)
      .filter(Boolean),
  );
  const unsupportedEntities: string[] = [];
  for (const e of extractEntities(text, brief.locale)) {
    const phrase = ` ${normWord(e)} `;
    if (corpusLower.includes(phrase) || corpusLower.includes(` ${normWord(e)}`)) continue;
    if (ru) {
      const ok = e.split(/\s+/).every((w) => ruStemMatch(w, corpusWords));
      if (ok) continue;
    } else if (e.split(/\s+/).length === 1) {
      // possessive / plural forms: "Strauss's", "Kemeys'"
      const base = normWord(e).replace(/'s?$/, '');
      if (corpusWords.has(base)) continue;
    }
    unsupportedEntities.push(e);
  }
  const wc = wordCount(text);
  const overBudget = wc > brief.maxWords * GROUNDING.OVER_BUDGET_FACTOR;
  return {
    ok: unsupportedNumbers.length === 0 && unsupportedEntities.length === 0 && !overBudget,
    unsupportedNumbers,
    unsupportedEntities,
    wordCount: wc,
    overBudget,
  };
}
