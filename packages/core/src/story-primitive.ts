/**
 * Story primitives (D-018): every story is split into
 *
 *  1. a short, deterministic, template-built CONTEXT PREFIX — the quantized spatial cue, the
 *     place name and (optionally) one journey callback — spoken as its own segment; and
 *  2. a context-free BODY — the story itself, generated from (place, angle, fact set, Guide,
 *     language, mode, question policy, word-budget bucket) only.
 *
 * The body brief contains nothing session-specific (no session id, time, position, spatial cue,
 * journey callbacks or user text), so its prose and its segment audio can be cached and shared
 * across users under a deterministic key without leaking anything about any user. The prefix is
 * rebuilt for every telling from the live context; its audio is cached by exact text only, and
 * because spatial cues are quantized ("about 3 kilometres ahead on your right") it repeats across
 * users too.
 *
 * Pure and deterministic: same inputs → same prefix, body brief and key.
 */
import type { EvidencePack, GroundingResult, GuideProfile, JourneyContext, Millis, MomentDecision, MovementRegime, NarrativeSegment, StoryBrief } from './contracts.js';
import { buildStoryBrief, isRussian, selectFacts, wordCount, type BriefOptions } from './brief.js';
import { checkGrounding } from './grounding.js';
import { segmentHash, segmentNarrative, wordsPerSecondFor, type NarrativeDraft } from './segment.js';
import { stableHash, stableId } from './util.js';

export const STORY_PRIMITIVE = {
  /** Bump when the body prompt, body template or key recipe changes (invalidates shared bodies). */
  VERSION: 'sp1',
  /** Body word budgets are rounded DOWN to this bucket so near-identical budgets share a body. */
  BUDGET_BUCKET_WORDS: 10,
  /** Words reserved for the spoken prefix out of the decided story budget. */
  PREFIX_RESERVE_WORDS: 20,
  /** Minimum body budget (a teaser still needs one fact). */
  MIN_BODY_WORDS: 12,
} as const;

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Canonical regime for body prose: speech rate and question policy only differ foot vs vehicle. */
function bodyRegime(r: MovementRegime): MovementRegime {
  return r === 'urban_driving' || r === 'highway_driving' ? 'urban_driving' : 'walking';
}

/**
 * Deterministic spoken prefix: "Ahead on your right, about 3 kilometres: <place name>."
 * (+ "It connects with X, which we passed earlier." when a callback fits the reserve).
 * Every token comes from the brief (cue, name, callbacks) → always grounded.
 */
export function storyPrefix(brief: Pick<StoryBrief, 'spatialCue' | 'placeName' | 'journeyCallbacks' | 'locale'>, reserveWords: number = STORY_PRIMITIVE.PREFIX_RESERVE_WORDS): string {
  const ru = isRussian(brief.locale);
  const head = brief.spatialCue ? (ru ? `${capitalize(brief.spatialCue)} — ${brief.placeName}.` : `${capitalize(brief.spatialCue)}: ${brief.placeName}.`) : ru ? `Перед нами — ${brief.placeName}.` : `This is ${brief.placeName}.`;
  const cb = brief.journeyCallbacks[0];
  if (!cb) return head;
  const withCb = `${head} ${ru ? `Это перекликается с тем, что мы видели раньше: ${cb}.` : `It connects with ${cb}, which we passed earlier.`}`;
  return wordCount(withCb) <= reserveWords ? withCb : head;
}

export interface StoryParts {
  /** Full, session-specific brief (grounding corpus for the prefix, telemetry, follow-ups). */
  brief: StoryBrief;
  /** Deterministic spoken prefix (segment 0). */
  prefix: string;
  /** Context-free brief the body prose is generated from. */
  bodyBrief: StoryBrief;
  /** Shared cache key of the body (no user data). */
  bodyKey: string;
}

/**
 * Deterministic cache key of a body brief. Inputs: primitive version, place id + name, angle,
 * mode, Guide, language, canonical regime, question policy, budget bucket and the selected
 * facts' ids AND texts (an evidence refresh that changes a fact changes the key).
 */
export function storyBodyKey(body: StoryBrief): string {
  const facts = body.facts.map((f) => `${f.id}=${stableHash(f.text)}`).join(',');
  return stableId(
    `body_${STORY_PRIMITIVE.VERSION}`,
    body.placeId,
    body.placeName,
    body.angle,
    body.mode,
    body.guideId,
    String(body.locale).toLowerCase(),
    body.regime,
    body.allowQuestionsToUser ? 'q' : '-',
    body.maxWords,
    facts,
  );
}

/**
 * Split a start_story decision into prefix + context-free body (D-018). The body budget is the
 * decided budget minus the prefix reserve (or the actual prefix when longer), rounded down to the
 * bucket, and the facts are re-selected for that budget so the body can never overrun the story.
 */
export function buildStoryParts(decision: Extract<MomentDecision, { kind: 'start_story' }>, evidence: EvidencePack, guide: GuideProfile, ctx: JourneyContext, opts: BriefOptions = {}): StoryParts {
  const full = buildStoryBrief(decision, evidence, guide, ctx, opts);
  const prefix = storyPrefix(full);
  const reserve = Math.max(STORY_PRIMITIVE.PREFIX_RESERVE_WORDS, wordCount(prefix));
  const B = STORY_PRIMITIVE.BUDGET_BUCKET_WORDS;
  const bodyMax = Math.max(STORY_PRIMITIVE.MIN_BODY_WORDS, Math.floor((decision.maxWords - reserve) / B) * B);
  const facts = selectFacts(evidence, decision.angle, bodyMax);
  const regime = bodyRegime(full.regime);
  const bodyNoId: StoryBrief = {
    ...full,
    id: '',
    facts,
    maxWords: bodyMax,
    // A function of key inputs only (the body prompt must be identical for every user of a key).
    durationBudgetS: Math.max(1, Math.round(bodyMax / wordsPerSecondFor({ regime, locale: full.locale }, guide))),
    regime,
    spatialCue: null,
    journeyCallbacks: [],
  };
  const bodyKey = storyBodyKey(bodyNoId);
  const bodyBrief: StoryBrief = { ...bodyNoId, id: bodyKey };
  // The full brief carries exactly the facts the body may speak (follow-ups continue from them).
  return { brief: { ...full, facts }, prefix, bodyBrief, bodyKey };
}

/** Deterministic, always-grounded body (no opener: the prefix already named the place). */
export function templateBody(body: StoryBrief): string {
  const ru = isRussian(body.locale);
  const ensure = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  const signoff = body.mode === 'teaser' ? null : ru ? 'Вот такая история.' : "That's the story.";
  let parts = body.facts.map((f) => ensure(f.text));
  if (parts.length === 0) parts = [ru ? `Это ${body.placeName}.` : `That is ${body.placeName}.`];
  if (signoff) parts.push(signoff);
  const fits = (ps: string[]) => wordCount(ps.join(' ')) <= body.maxWords;
  if (!fits(parts) && signoff) parts = parts.filter((p) => p !== signoff);
  while (!fits(parts) && parts.length > 1) parts = parts.slice(0, -1);
  return parts.join(' ');
}

function mergeGrounding(a: GroundingResult, b: GroundingResult): GroundingResult {
  return {
    ok: a.ok && b.ok,
    unsupportedNumbers: [...a.unsupportedNumbers, ...b.unsupportedNumbers],
    unsupportedEntities: [...a.unsupportedEntities, ...b.unsupportedEntities],
    wordCount: a.wordCount + b.wordCount,
    overBudget: a.overBudget || b.overBudget,
  };
}

/** Grounding of the prefix against the full brief (cue, name, callbacks). */
export function checkPrefix(parts: Pick<StoryParts, 'prefix' | 'brief'>, guide: GuideProfile): GroundingResult {
  return checkGrounding(parts.prefix, { ...parts.brief, maxWords: Math.max(STORY_PRIMITIVE.PREFIX_RESERVE_WORDS, wordCount(parts.prefix)) }, { allow: [guide.name] });
}

/**
 * Story plan = [prefix segment, ...body segments]. Body segmentation uses the body brief, so the
 * body's segment texts — and therefore their content-addressed audio keys — are identical for
 * every user who hears the same body.
 */
export function composeStoryPlan(parts: StoryParts, bodyText: string, guide: GuideProfile, now: Millis, params: { generatedBy?: NarrativeDraft['generatedBy']; bodyGrounding: GroundingResult; prefixGrounding: GroundingResult }): NarrativeDraft {
  const planId = stableId('plan', parts.brief.id, stableHash(`${parts.prefix}␟${bodyText}`), guide.id);
  const body = segmentNarrative(bodyText, parts.bodyBrief, guide, now, { planId: `${planId}_b` });
  const wps = body.segments.length > 0 ? body.segments.reduce((s, x) => s + wordCount(x.text), 0) / Math.max(1, body.segments.reduce((s, x) => s + x.estDurationMs, 0) / 1000) : 2.5;
  const prefixSeg: NarrativeSegment = {
    id: stableId('seg', planId, 0),
    index: 0,
    text: parts.prefix,
    hash: segmentHash(parts.prefix, guide, parts.brief.locale),
    estDurationMs: Math.round((wordCount(parts.prefix) / wps) * 1000),
    factIds: [],
  };
  const segments: NarrativeSegment[] = [prefixSeg, ...body.segments.map((s, i) => ({ ...s, id: stableId('seg', planId, i + 1), index: i + 1 }))];
  return {
    id: planId,
    briefId: parts.brief.id,
    placeId: parts.brief.placeId,
    guideId: guide.id,
    locale: parts.brief.locale,
    segments,
    createdAt: now,
    ...(params.generatedBy ? { generatedBy: params.generatedBy } : {}),
    grounding: mergeGrounding(params.prefixGrounding, params.bodyGrounding),
  };
}
