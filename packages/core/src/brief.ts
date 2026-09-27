/**
 * StoryBrief builder (D-009). Deterministic: the same decision + evidence + guide +
 * context always produces the same brief. The LLM only turns this brief into prose.
 */
import type { CandidateGeometry, EvidenceFact, EvidencePack, FactKind, GuideProfile, JourneyContext, Locale, MomentDecision, PlaceCandidate, StoryAngle, StoryBrief } from './contracts.js';
import { ANGLE_FACT_KINDS } from './director.js';
import { sharedTags } from './discovery.js';
import { policyFor } from './policy.js';
import { cmpStr, stableId } from './util.js';

export const BRIEF = {
  /** Fraction of maxWords the selected facts' own words may occupy (rest = connective prose). */
  FACT_WORD_SHARE: 0.75,
  /** Minimum facts even for a teaser (identity + 1 when available). */
  MIN_FACTS: 1,
  MAX_FACTS: 6,
  MAX_CALLBACKS: 2,
  MIN_CONFIDENCE: 0.5,
} as const;

export type Units = 'metric' | 'imperial';

export function unitsForLocale(locale: Locale): Units {
  const l = String(locale).toLowerCase();
  return l === 'en-us' || l === 'en_us' || l.endsWith('-us') || l === 'en-lr' || l === 'my' ? 'imperial' : 'metric';
}

export function isRussian(locale: Locale): boolean {
  return String(locale).toLowerCase().startsWith('ru');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// ─────────────────────────────────────────────── spatial cue

const RU_PREP: Record<number, string> = {
  1: 'одном',
  2: 'двух',
  3: 'трёх',
  4: 'четырёх',
  5: 'пяти',
  6: 'шести',
  7: 'семи',
  8: 'восьми',
  9: 'девяти',
  10: 'десяти',
  15: 'пятнадцати',
  20: 'двадцати',
  30: 'тридцати',
  40: 'сорока',
  50: 'пятидесяти',
  60: 'шестидесяти',
  100: 'ста',
};

function roundNice(x: number): number {
  if (x < 10) return Math.max(1, Math.round(x));
  if (x < 30) return Math.round(x / 5) * 5;
  return Math.round(x / 10) * 10;
}

interface DistancePhrase {
  en: string;
  ru: string;
}

export function distancePhrase(meters: number, units: Units): DistancePhrase {
  const m = Math.max(0, meters);
  if (units === 'imperial') {
    const feet = m / 0.3048;
    const miles = m / 1609.344;
    if (miles < 0.2) {
      const f = Math.max(100, Math.round(feet / 100) * 100);
      return { en: `about ${f} feet`, ru: `примерно в ${f} футах` };
    }
    if (miles < 0.4) return { en: 'about a quarter mile', ru: 'примерно в четверти мили' };
    if (miles < 0.75) return { en: 'about half a mile', ru: 'примерно в полумиле' };
    if (miles < 1.5) return { en: 'about a mile', ru: 'примерно в миле' };
    const n = roundNice(miles);
    return { en: `about ${n} miles`, ru: `примерно в ${RU_PREP[n] ?? n} милях` };
  }
  if (m < 950) {
    const r = m < 200 ? Math.max(50, Math.round(m / 50) * 50) : Math.round(m / 100) * 100;
    return { en: `about ${r} metres`, ru: `примерно в ${r} метрах` };
  }
  const km = m / 1000;
  if (km < 1.5) return { en: 'about a kilometre', ru: 'примерно в километре' };
  const n = roundNice(km);
  return { en: `about ${n} kilometres`, ru: `примерно в ${RU_PREP[n] ?? n} километрах` };
}

/**
 * Deterministic spatial cue, e.g. "ahead on your right, about 3 kilometres" /
 * "впереди справа, примерно в трёх километрах". Null when geometry is unusable.
 */
export function spatialCue(g: CandidateGeometry, place: Pick<PlaceCandidate, 'extentM'>, locale: Locale, opts: { units?: Units; moving?: boolean } = {}): string | null {
  const ru = isRussian(locale);
  const units = opts.units ?? unitsForLocale(locale);
  const moving = opts.moving ?? g.alongTrackM !== null;
  if (g.relative === 'here') {
    if (place.extentM > 0 && moving) return ru ? 'вы сейчас проезжаете здесь' : "you're passing through it now";
    return ru ? 'прямо здесь' : 'right here';
  }
  let dir: { en: string; ru: string };
  if (g.relative === 'behind') dir = { en: 'behind you', ru: 'позади вас' };
  else if (g.relative === 'beside') dir = g.side === 'left' ? { en: 'on your left', ru: 'слева от вас' } : g.side === 'right' ? { en: 'on your right', ru: 'справа от вас' } : { en: 'right beside you', ru: 'рядом с вами' };
  else if (g.side === 'left') dir = { en: 'ahead on your left', ru: 'впереди слева' };
  else if (g.side === 'right') dir = { en: 'ahead on your right', ru: 'впереди справа' };
  else if (g.side === 'center') dir = { en: 'straight ahead', ru: 'прямо впереди' };
  else dir = { en: 'nearby', ru: 'поблизости' };

  const distM = g.alongTrackM !== null ? Math.max(0, g.alongTrackM - place.extentM) : Math.max(0, g.distanceM - place.extentM);
  if (g.relative === 'beside' && distM < 150) return ru ? dir.ru : dir.en;
  const d = distancePhrase(distM, units);
  return ru ? `${dir.ru}, ${d.ru}` : `${dir.en}, ${d.en}`;
}

// ─────────────────────────────────────────────── fact selection

function factWords(f: EvidenceFact): number {
  return wordCount(f.text);
}

function angleAffinity(kind: FactKind, angle: StoryAngle): number {
  const ks = ANGLE_FACT_KINDS[angle];
  const i = ks.indexOf(kind);
  if (i === 0) return 1;
  if (i > 0) return 0.8;
  if (kind === 'identity') return 0.5;
  if (kind === 'practical') return 0.1;
  return 0.35;
}

/**
 * Deterministic fact selection: identity first (always, when present), then greedily by
 * angle affinity × confidence with a diversity penalty for repeated kinds, subject to the
 * word budget. Ties break by fact id.
 */
export function selectFacts(pack: EvidencePack, angle: StoryAngle, maxWords: number): EvidenceFact[] {
  const usable = pack.facts.filter((f) => f.confidence >= BRIEF.MIN_CONFIDENCE).sort((a, b) => cmpStr(a.id, b.id));
  if (usable.length === 0) return [];
  const budget = Math.max(12, Math.floor(maxWords * BRIEF.FACT_WORD_SHARE));
  const chosen: EvidenceFact[] = [];
  let words = 0;
  const identity = usable
    .filter((f) => f.kind === 'identity')
    .sort((a, b) => b.confidence - a.confidence || factWords(a) - factWords(b) || cmpStr(a.id, b.id))[0];
  if (identity) {
    chosen.push(identity);
    words += factWords(identity);
  }
  const rest = usable.filter((f) => f !== identity);
  while (chosen.length < BRIEF.MAX_FACTS) {
    const kindCount = new Map<FactKind, number>();
    for (const c of chosen) kindCount.set(c.kind, (kindCount.get(c.kind) ?? 0) + 1);
    let best: { f: EvidenceFact; s: number } | null = null;
    for (const f of rest) {
      if (chosen.includes(f)) continue;
      const w = factWords(f);
      if (words + w > budget && chosen.length >= BRIEF.MIN_FACTS) continue;
      const s = angleAffinity(f.kind, angle) * f.confidence * 0.6 ** (kindCount.get(f.kind) ?? 0);
      if (!best || s > best.s + 1e-12) best = { f, s };
    }
    if (!best) break;
    chosen.push(best.f);
    words += factWords(best.f);
  }
  return chosen;
}

// ─────────────────────────────────────────────── callbacks

export function journeyCallbacks(ctx: JourneyContext, place: PlaceCandidate, guide: GuideProfile | null | undefined): string[] {
  if (guide && !guide.narrative.useJourneyCallbacks) return [];
  return Object.values(ctx.memory.discussed)
    .filter((d) => d.placeId !== place.id && sharedTags(place.tags, d.tags ?? []).length > 0)
    .sort((a, b) => b.at - a.at || cmpStr(a.placeId, b.placeId))
    .slice(0, BRIEF.MAX_CALLBACKS)
    .map((d) => d.placeName);
}

export interface BriefOptions {
  units?: Units;
}

export function buildStoryBrief(decision: Extract<MomentDecision, { kind: 'start_story' }>, evidence: EvidencePack, guide: GuideProfile, ctx: JourneyContext, opts: BriefOptions = {}): StoryBrief {
  const target = decision.target;
  const policy = policyFor(ctx.regime.regime, ctx.density.density);
  const facts = selectFacts(evidence, decision.angle, decision.maxWords);
  const moving = target.geometry.alongTrackM !== null;
  return {
    id: stableId('brief', ctx.sessionId, target.place.id, decision.angle, ctx.now),
    placeId: target.place.id,
    placeName: evidence.placeName || target.place.name,
    placeKind: target.place.kind,
    angle: decision.angle,
    mode: decision.mode,
    facts,
    durationBudgetS: decision.durationBudgetS,
    maxWords: decision.maxWords,
    guideId: guide.id,
    locale: ctx.locale,
    regime: ctx.regime.regime,
    spatialCue: spatialCue(target.geometry, target.place, ctx.locale, { ...(opts.units ? { units: opts.units } : {}), moving }),
    journeyCallbacks: journeyCallbacks(ctx, target.place, guide),
    allowQuestionsToUser: policy.interactivePrompts && !ctx.safety.driveSafe,
  };
}
