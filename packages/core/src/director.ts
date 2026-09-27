/**
 * MomentDirector — decides, for "right now", whether to speak and what.
 * Silence is a first-class outcome (D-007). Decision order:
 *
 *   no fix → listening → user paused → interrupted story (resume/abandon) →
 *   story playing (continue, or rare preempt) → warm-up → safety hold → cadence gap →
 *   best eligible below threshold → start_story.
 *
 * The director never ranks places itself (that is `scoreCandidates`); it only applies
 * timing/cadence/safety rules on top of the ranked list and sizes the story.
 */
import type {
  ActiveStoryState,
  FactKind,
  GuideProfile,
  Id,
  JourneyContext,
  MomentDecision,
  MovementRegime,
  ScoredCandidate,
  StoryAngle,
  StoryMode,
} from './contracts.js';
import { KIND_ANGLES, policyForContext, sharedTags } from './discovery.js';
import { isDriving } from './regime.js';
import { decideResume } from './resume.js';

export const DIRECTOR = {
  /** Candidate significance required to preempt a playing story (driving only). */
  PREEMPT_MIN_SIGNIFICANCE: 0.9,
  /** Preempting candidate must beat the active story's place significance by this much. */
  PREEMPT_MARGIN: 0.1,
  /** Assumed seconds per remaining segment when the caller doesn't supply remaining time. */
  EST_SEGMENT_S: 12,
  /** Story must end this many seconds before the place is passed. */
  LEAD_MARGIN_S: 10,
  /** Absolute minimum budget for any story. */
  MIN_BUDGET_S: 10,
  /** Budget below this → teaser. */
  TEASER_MAX_S: 25,
  /** Budget below this fraction of the regime max → short. */
  SHORT_FRACTION: 0.6,
  /** Talkativeness scaling of the cadence gap, per step. */
  QUIETER_GAP_MULT: 1.6,
  CHATTIER_GAP_MULT: 0.7,
  /** Talkativeness shift of the speak threshold, per step (quieter raises it). */
  THRESHOLD_STEP: 0.03,
  /** A 'here' major feature may bypass the cadence gap after this fraction of it has elapsed. */
  HERE_GAP_FRACTION: 0.5,
  /** Deferral: a candidate that is still early with poor timing waits for a better moment. */
  DEFER_TIMING_BELOW: 0.75,
  /** Orientation needs the same bar as a story (margin 0 = identical threshold). */
  ORIENTATION_SCORE_MARGIN: 0,
  /** Recent-angle memory (last N stories) for angle variety. */
  RECENT_ANGLES: 2,
  REEVALUATE_MS: {
    unknown: 3000,
    stationary: 5000,
    walking: 3000,
    cycling: 4000,
    urban_driving: 5000,
    highway_driving: 10000,
  } satisfies Record<MovementRegime, number>,
} as const;

/** Fact kinds that can carry a story angle. */
export const ANGLE_FACT_KINDS: Record<StoryAngle, FactKind[]> = {
  origin: ['date', 'event', 'identity', 'person'],
  people: ['person'],
  architecture: ['architecture', 'quantity'],
  turning_point: ['event', 'date'],
  hidden_detail: ['trivia', 'architecture', 'culture'],
  nature: ['nature'],
  everyday_life: ['culture', 'practical'],
  numbers: ['quantity'],
  connection: [],
};

export interface DirectorOptions {
  guide?: GuideProfile | null;
  /** Available fact kinds per place (from the evidence cache). Missing → any angle accepted. */
  factKinds?: Record<Id, FactKind[]> | ReadonlyMap<Id, readonly FactKind[]>;
  /** Listening session open (user speaking / push-to-talk). */
  listening?: boolean;
  /** User explicitly paused narration. */
  userPaused?: boolean;
  /** Seconds left in the playing story (from the plan); estimated from segments otherwise. */
  activeStoryRemainingS?: number | null;
  /** Significance of the active story's place (for the preempt margin). */
  activeStorySignificance?: number | null;
  /** Latest planId known to the session (for resume 'superseded'). */
  currentPlanId?: Id | null;
  /** An answer was spoken since the interruption (resume bridge). */
  answerSpokenSince?: boolean;
}

function reevaluate(regime: MovementRegime): number {
  return DIRECTOR.REEVALUATE_MS[regime];
}

export function gapMultiplier(talkativeness: number): number {
  const t = Math.max(-2, Math.min(2, Math.round(talkativeness)));
  return t < 0 ? DIRECTOR.QUIETER_GAP_MULT ** -t : DIRECTOR.CHATTIER_GAP_MULT ** t;
}

function kindsFor(opts: DirectorOptions, placeId: Id): readonly FactKind[] | null {
  const fk = opts.factKinds;
  if (!fk) return null;
  if (fk instanceof Map) return (fk as ReadonlyMap<Id, readonly FactKind[]>).get(placeId) ?? null;
  return (fk as Record<Id, FactKind[]>)[placeId] ?? null;
}

function recentAngles(ctx: JourneyContext): StoryAngle[] {
  return Object.values(ctx.memory.discussed)
    .filter((d) => d.angle)
    .sort((a, b) => b.at - a.at || (a.placeId < b.placeId ? -1 : 1))
    .slice(0, DIRECTOR.RECENT_ANGLES)
    .map((d) => d.angle!);
}

/** Deterministic angle choice: guide preference → not recently used → supported by facts. */
export function chooseAngle(ctx: JourneyContext, target: ScoredCandidate, opts: DirectorOptions): StoryAngle {
  const kinds = kindsFor(opts, target.place.id);
  const recent = new Set(recentAngles(ctx));
  const hasConnection = Object.values(ctx.memory.discussed).some((d) => d.placeId !== target.place.id && sharedTags(target.place.tags, d.tags ?? []).length > 0);
  const supported = (a: StoryAngle): boolean => {
    if (a === 'connection') return hasConnection && (opts.guide?.narrative.useJourneyCallbacks ?? true);
    if (!kinds) return true;
    return ANGLE_FACT_KINDS[a].some((k) => kinds.includes(k));
  };
  const natural = KIND_ANGLES[target.place.kind];
  const preferred = opts.guide?.narrative.preferredAngles ?? natural;
  for (const a of preferred) if (!recent.has(a) && supported(a)) return a;
  for (const a of natural) if (!recent.has(a) && supported(a)) return a;
  for (const a of [...preferred, ...natural]) if (supported(a)) return a;
  return 'origin';
}

export interface StoryBudget {
  durationBudgetS: number;
  maxWords: number;
  mode: StoryMode;
}

/** Budget: min(regime max × verbosity, max(MIN, etaToPass − margin)); words = duration × wps. */
export function storyBudget(ctx: JourneyContext, target: ScoredCandidate, guide: GuideProfile | null | undefined): StoryBudget {
  const policy = policyForContext(ctx);
  const cap = policy.maxStoryS * (guide?.narrative.verbosity ?? 1);
  const etaPass = target.components.etaToPassS;
  const byEta = etaPass === undefined ? Infinity : Math.max(DIRECTOR.MIN_BUDGET_S, etaPass - DIRECTOR.LEAD_MARGIN_S);
  const duration = Math.round(Math.max(DIRECTOR.MIN_BUDGET_S, Math.min(cap, byEta)));
  const mode: StoryMode = duration < DIRECTOR.TEASER_MAX_S ? 'teaser' : duration < DIRECTOR.SHORT_FRACTION * cap ? 'short' : policy.defaultMode;
  return { durationBudgetS: duration, maxWords: Math.round(duration * policy.wordsPerSecond), mode };
}

/** Best NEAR candidate whose ONLY suppression is thin evidence and whose score clears the bar. */
export function orientationCandidate(scored: readonly ScoredCandidate[], threshold: number, nearRadiusM = Infinity): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const c of scored) {
    if (c.eligible || c.suppressedBy.length !== 1 || c.suppressedBy[0] !== 'evidence_thin') continue;
    // Orientation is about what is around you now, not a list of distant names.
    const gap = (c.geometry.alongTrackM ?? c.geometry.distanceM) - c.place.extentM;
    if (c.geometry.relative !== 'here' && gap > nearRadiusM) continue;
    if (c.score + DIRECTOR.ORIENTATION_SCORE_MARGIN < threshold) continue;
    if (!best || c.score > best.score || (c.score === best.score && c.place.id < best.place.id)) best = c;
  }
  return best;
}

function isMajorHere(c: ScoredCandidate): boolean {
  return c.geometry.relative === 'here' && c.place.significance >= DIRECTOR.PREEMPT_MIN_SIGNIFICANCE;
}

function storyRemainingS(story: ActiveStoryState, opts: DirectorOptions): number {
  if (opts.activeStoryRemainingS !== null && opts.activeStoryRemainingS !== undefined) return opts.activeStoryRemainingS;
  return Math.max(0, story.segmentCount - story.segmentIndex) * DIRECTOR.EST_SEGMENT_S;
}

export function decideMoment(ctx: JourneyContext, scored: readonly ScoredCandidate[], opts: DirectorOptions = {}): MomentDecision {
  const regime = ctx.regime.regime;
  const re = reevaluate(regime);
  if (!ctx.position) return { kind: 'silence', reason: 'no_fix', reevaluateInMs: re, best: null };
  if (opts.listening) return { kind: 'silence', reason: 'listening', reevaluateInMs: re, best: null };

  const policy = policyForContext(ctx);
  const eligible = scored.filter((c) => c.eligible);
  const t = Math.max(-2, Math.min(2, ctx.memory.talkativeness));
  const threshold = Math.min(1.01, policy.speakThreshold - DIRECTOR.THRESHOLD_STEP * t);
  const story = ctx.activeStory;

  if (story && story.status === 'paused') return { kind: 'silence', reason: 'user_paused', reevaluateInMs: re, best: eligible[0] ?? null };
  if (opts.userPaused) return { kind: 'silence', reason: 'user_paused', reevaluateInMs: re, best: eligible[0] ?? null };

  if (story && story.status === 'interrupted') {
    const target = scored.find((c) => c.place.id === story.placeId) ?? null;
    const d = decideResume(story, ctx, target ? target.geometry : null, {
      currentPlanId: opts.currentPlanId ?? null,
      answerSpokenSince: opts.answerSpokenSince ?? false,
      targetExtentM: target?.place.extentM ?? 0,
    });
    return d.action === 'resume' ? { kind: 'resume_story', decision: d } : { kind: 'abandon_story', decision: d };
  }

  if (story && story.status === 'playing') {
    // Preempt: driving only, major feature, and it will be 'here'/passed before the story ends.
    if (isDriving(regime) && ctx.safety.speechHoldReasons.length === 0) {
      const remaining = storyRemainingS(story, opts);
      const activeSig = opts.activeStorySignificance ?? scored.find((c) => c.place.id === story.placeId)?.place.significance ?? 0.5;
      const pre = eligible.find(
        (c) =>
          c.place.id !== story.placeId &&
          c.place.significance >= DIRECTOR.PREEMPT_MIN_SIGNIFICANCE &&
          c.place.significance >= activeSig + DIRECTOR.PREEMPT_MARGIN &&
          c.score >= threshold &&
          (c.geometry.relative === 'here' || (c.geometry.etaS !== null && c.geometry.etaS < remaining)),
      );
      if (pre) {
        const b = storyBudget(ctx, pre, opts.guide);
        return { kind: 'start_story', target: pre, mode: b.mode, angle: chooseAngle(ctx, pre, opts), durationBudgetS: b.durationBudgetS, maxWords: b.maxWords, preempt: true };
      }
    }
    return { kind: 'continue_story' };
  }

  const best = eligible[0] ?? null;
  const warmFrom = Math.max(ctx.regime.since, ctx.sessionStartedAt);
  if (regime === 'unknown' || ctx.now - warmFrom < policy.warmupS * 1000) return { kind: 'silence', reason: 'warming_up', reevaluateInMs: re, best };
  if (ctx.safety.speechHoldReasons.length > 0) return { kind: 'silence', reason: 'safety_hold', reevaluateInMs: Math.min(re, 3000), best };

  const gapS = policy.minGapS * gapMultiplier(t);
  if (ctx.lastSpeechEndedAt !== null) {
    const since = (ctx.now - ctx.lastSpeechEndedAt) / 1000;
    if (since < gapS) {
      const majorHere = eligible.find((c) => isMajorHere(c) && c.score >= threshold);
      if (!(majorHere && since >= gapS * DIRECTOR.HERE_GAP_FRACTION)) {
        return { kind: 'silence', reason: 'cadence_gap', reevaluateInMs: Math.min(re * 2, Math.max(1000, Math.round((gapS - since) * 1000))), best };
      }
    }
  }

  // Deferral: still early with poor timing → wait for a better moment (it isn't going anywhere).
  const ready = eligible.filter((c) => !(c.components.early === 1 && (c.components.timing ?? 1) < DIRECTOR.DEFER_TIMING_BELOW));
  const pick = ready[0] ?? null;
  if (!pick || pick.score < threshold) {
    // A4: a worthwhile place with thin evidence gets one orientation line — never a story —
    // and only when no grounded story is available right now.
    const thin = orientationCandidate(scored, threshold, policy.nearRadiusM);
    if (thin) return { kind: 'orientation', target: thin, allowFollowUp: false };
    return { kind: 'silence', reason: 'nothing_worth_it', reevaluateInMs: re, best: pick ?? best };
  }

  const b = storyBudget(ctx, pick, opts.guide);
  return { kind: 'start_story', target: pick, mode: b.mode, angle: chooseAngle(ctx, pick, opts), durationBudgetS: b.durationBudgetS, maxWords: b.maxWords, preempt: false };
}
