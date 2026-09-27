/**
 * NarrativePlan segmentation (D-009) and the deterministic template fallback.
 *
 * Segments are sentence groups of ~8–18 s so that interruption resumes at a natural
 * boundary and TTS can be cached per segment (hash = text + voice + locale).
 */
import type { EvidenceFact, GroundingResult, GuideProfile, Millis, NarrativePlan, NarrativeSegment, StoryBrief } from './contracts.js';
import { isRussian, wordCount } from './brief.js';
import { policyFor } from './policy.js';
import { stableHash, stableId } from './util.js';

export const SEGMENT = {
  MIN_S: 8,
  TARGET_S: 12,
  MAX_S: 18,
} as const;

function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}«"“(\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

export function wordsPerSecondFor(brief: Pick<StoryBrief, 'regime' | 'locale'>, guide: GuideProfile): number {
  const base = policyFor(brief.regime, 'urban').wordsPerSecond;
  // Russian words are longer on average → fewer words per second at equal speaking rate.
  const lang = isRussian(brief.locale) ? 0.85 : 1;
  return base * guide.voice.speakingRate * lang;
}

function voiceKey(guide: GuideProfile): string {
  const entries = Object.entries(guide.voice.byProvider).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${guide.id}|${entries.map(([k, v]) => `${k}=${v}`).join(',')}|${guide.voice.speakingRate}`;
}

export function segmentHash(text: string, guide: GuideProfile, locale: string): string {
  return stableHash(`${text}␟${voiceKey(guide)}␟${locale}`);
}

/** Which facts a sentence group draws on (by distinctive entity / number / text overlap). */
function factIdsFor(text: string, facts: readonly EvidenceFact[]): string[] {
  const lower = text.toLowerCase();
  const ids: string[] = [];
  for (const f of facts) {
    const cues = [...f.entities, ...f.numbers].filter((c) => c.length >= 3);
    if (lower.includes(f.text.toLowerCase().slice(0, 40)) || cues.some((c) => lower.includes(c.toLowerCase()))) ids.push(f.id);
  }
  return ids;
}

export type NarrativeDraft = Omit<NarrativePlan, 'generatedBy' | 'grounding'> & {
  generatedBy?: NarrativePlan['generatedBy'];
  grounding?: GroundingResult;
};

export interface SegmentParams {
  generatedBy?: NarrativePlan['generatedBy'];
  grounding?: GroundingResult;
  /** Override plan id (default: stable id from brief + text hash). */
  planId?: string;
}

export function segmentNarrative(text: string, brief: StoryBrief, guide: GuideProfile, now: Millis, params: SegmentParams = {}): NarrativeDraft {
  const wps = wordsPerSecondFor(brief, guide);
  const planId = params.planId ?? stableId('plan', brief.id, stableHash(text), guide.id);
  const sentences = splitSentences(text);
  const groups: string[][] = [];
  let cur: string[] = [];
  let curS = 0;
  for (const s of sentences) {
    const d = wordCount(s) / wps;
    if (cur.length > 0 && (curS + d > SEGMENT.MAX_S || curS >= SEGMENT.TARGET_S)) {
      groups.push(cur);
      cur = [];
      curS = 0;
    }
    cur.push(s);
    curS += d;
  }
  if (cur.length > 0) {
    // merge a short tail into the previous group if it stays within MAX
    const prev = groups.at(-1);
    if (prev && curS < SEGMENT.MIN_S && wordCount(prev.join(' ')) / wps + curS <= SEGMENT.MAX_S) prev.push(...cur);
    else groups.push(cur);
  }
  const segments: NarrativeSegment[] = groups.map((g, index) => {
    const t = g.join(' ');
    return {
      id: stableId('seg', planId, index),
      index,
      text: t,
      hash: segmentHash(t, guide, brief.locale),
      estDurationMs: Math.round((wordCount(t) / wps) * 1000),
      factIds: factIdsFor(t, brief.facts),
    };
  });
  return {
    id: planId,
    briefId: brief.id,
    placeId: brief.placeId,
    guideId: guide.id,
    locale: brief.locale,
    segments,
    createdAt: now,
    ...(params.generatedBy ? { generatedBy: params.generatedBy } : {}),
    ...(params.grounding ? { grounding: params.grounding } : {}),
  };
}

// ─────────────────────────────────────────────── template fallback

function ensurePeriod(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * Deterministic, always-grounded fallback prose: spatial cue opener + fact texts in brief
 * order + a neutral sign-off. Uses no names/numbers beyond the brief. Trims facts from the
 * end to respect maxWords (the identity fact is kept).
 */
export function templateNarrative(brief: StoryBrief, guide: GuideProfile): string {
  const ru = isRussian(brief.locale);
  const opener = brief.spatialCue
    ? ru
      ? `${capitalize(brief.spatialCue)} — ${brief.placeName}.`
      : `${capitalize(brief.spatialCue)}: ${brief.placeName}.`
    : ru
      ? `Перед нами — ${brief.placeName}.`
      : `This is ${brief.placeName}.`;
  const callback = brief.journeyCallbacks.length > 0 ? (ru ? `Это перекликается с тем, что мы видели раньше: ${brief.journeyCallbacks[0]}.` : `It connects with ${brief.journeyCallbacks[0]}, which we passed earlier.`) : null;
  const signoff = brief.mode === 'teaser' ? null : ru ? 'Вот такая история.' : "That's the story.";
  void guide; // persona styling is the LLM's job; the template stays neutral and grounded
  const parts = [opener, ...brief.facts.map((f) => ensurePeriod(f.text))];
  if (callback) parts.push(callback);
  if (signoff) parts.push(signoff);
  // Respect the budget: drop trailing optional parts, then facts from the end (keep ≥ 1 fact).
  const fits = (ps: string[]) => wordCount(ps.join(' ')) <= brief.maxWords;
  let ps = parts;
  if (!fits(ps) && signoff) ps = ps.filter((p) => p !== signoff);
  if (!fits(ps) && callback) ps = ps.filter((p) => p !== callback);
  while (!fits(ps) && ps.length > 2) ps = ps.slice(0, -1);
  return ps.join(' ');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
