/**
 * Journey state orchestration: `ingestFrame` folds a client ContextFrame into the
 * server-side JourneyState (regime tracker, safety, audio progress, route) — pure.
 *
 * JourneyState = JourneyContext + internal bookkeeping. `contextOf(state)` returns the
 * plain JourneyContext consumed by discovery/director.
 *
 * Story lifecycle events are explicit reducers (`storyStarted`, `storyCompleted`,
 * `storyInterrupted`, `storySkipped`, `storyResumed`, `storyAbandoned`) called by the
 * session service when it issues/observes directives. `ingestFrame` only syncs playback
 * progress (segment/offset) for the active plan — it never infers completion from a
 * missing "playing" flag, which would be fragile across network drops.
 */
import type {
  ActiveStoryState,
  ContextFrame,
  GeoFix,
  Id,
  JourneyContext,
  Locale,
  Millis,
  MovementRegime,
  PlaceCandidate,
  StoryAngle,
} from './contracts.js';
import { initialDensityState, observedDensity, updateDensity } from './density.js';
import { emptyMemory, recordStoryCompleted, recordStoryInterrupted, recordStorySkipped, recordStoryStarted } from './memory.js';
import { initialRegimeState, updateRegime, type RegimeOptions } from './regime.js';
import { evaluateSafety } from './safety.js';

export const JOURNEY = {
  MAX_TRANSITIONS: 200,
} as const;

export interface RegimeTransition {
  at: Millis;
  from: MovementRegime;
  to: MovementRegime;
}

export interface JourneyState extends JourneyContext {
  lastSeq: number;
  lastInteractionAt: Millis | null;
  appState: ContextFrame['appState'];
  /** When density was last observed (for time-based smoothing). */
  densityObservedAt: Millis | null;
  /** Bounded log of regime transitions (for telemetry + replay assertions). */
  transitions: RegimeTransition[];
  /** Latest plan id issued in this session (resume 'superseded' check). */
  currentPlanId: Id | null;
  /** Significance of the active story's place (director preempt margin). */
  activeStorySignificance: number | null;
  /** An answer was spoken since the last interruption (resume bridge). */
  answerSpokenSinceInterrupt: boolean;
}

export interface NewJourneyParams {
  sessionId: Id;
  now: Millis;
  guideId: Id;
  locale: Locale;
  simulated?: boolean;
}

export function newJourney(p: NewJourneyParams): JourneyState {
  return {
    sessionId: p.sessionId,
    now: p.now,
    position: null,
    regime: initialRegimeState(p.now),
    density: initialDensityState(p.now),
    route: null,
    memory: emptyMemory(),
    activeStory: null,
    guideId: p.guideId,
    locale: p.locale,
    lastSpeechEndedAt: null,
    sessionStartedAt: p.now,
    safety: { driveSafe: false, maneuvering: false, speechHoldReasons: [] },
    audioRoute: 'unknown',
    simulated: p.simulated ?? false,
    lastSeq: -1,
    lastInteractionAt: null,
    appState: 'foreground',
    densityObservedAt: null,
    transitions: [],
    currentPlanId: null,
    activeStorySignificance: null,
    answerSpokenSinceInterrupt: false,
  };
}

export function contextOf(s: JourneyState): JourneyContext {
  return {
    sessionId: s.sessionId,
    now: s.now,
    position: s.position,
    regime: s.regime,
    density: s.density,
    route: s.route,
    memory: s.memory,
    activeStory: s.activeStory,
    guideId: s.guideId,
    locale: s.locale,
    lastSpeechEndedAt: s.lastSpeechEndedAt,
    sessionStartedAt: s.sessionStartedAt,
    safety: s.safety,
    audioRoute: s.audioRoute,
    simulated: s.simulated,
  };
}

function latestAccepted(fixes: readonly GeoFix[], s: JourneyState): GeoFix | null {
  const lastSample = s.regime.track?.samples.at(-1);
  if (!lastSample) return s.position;
  // Use the newest frame fix whose timestamp matches the tracker's last accepted sample.
  const hit = [...fixes].reverse().find((f) => f.t === lastSample.t && f.lat === lastSample.lat && f.lng === lastSample.lng);
  return hit ?? s.position;
}

export interface IngestOptions {
  regime?: RegimeOptions;
}

export function ingestFrame(state: JourneyState, frame: ContextFrame, opts: IngestOptions = {}): JourneyState {
  if (frame.sessionId !== state.sessionId) return state;
  if (frame.seq <= state.lastSeq) return state; // out-of-order / duplicate
  const newestFix = frame.fixes.reduce<Millis>((m, f) => Math.max(m, f.t), -Infinity);
  const now = Math.max(state.now, frame.clientTime, Number.isFinite(newestFix) ? newestFix : -Infinity);
  const regime = updateRegime(state.regime, frame.fixes, now, opts.regime);
  let transitions = state.transitions;
  if (regime.regime !== state.regime.regime) {
    transitions = [...transitions, { at: regime.since, from: state.regime.regime, to: regime.regime }].slice(-JOURNEY.MAX_TRANSITIONS);
  }
  const lastInteractionAt = frame.lastInteractionAt ?? state.lastInteractionAt;
  const safety = evaluateSafety({ regime, now, lastInteractionAt, audioRoute: frame.audio.outputRoute, appState: frame.appState });

  let next: JourneyState = {
    ...state,
    now,
    lastSeq: frame.seq,
    regime,
    transitions,
    safety,
    lastInteractionAt,
    appState: frame.appState,
    audioRoute: frame.audio.outputRoute,
    simulated: state.simulated || frame.simulated,
    route: frame.route === undefined ? state.route : frame.route,
  };
  next = { ...next, position: latestAccepted(frame.fixes, next) };

  // Sync playback progress for the active plan (never regresses).
  const a = next.activeStory;
  if (a && frame.audio.planId === a.planId && typeof frame.audio.segmentIndex === 'number') {
    const idx = Math.max(0, Math.min(a.segmentCount - 1, frame.audio.segmentIndex));
    if (idx > a.segmentIndex || (idx === a.segmentIndex && (frame.audio.offsetMs ?? 0) >= a.offsetMs)) {
      next = { ...next, activeStory: { ...a, segmentIndex: idx, offsetMs: frame.audio.offsetMs ?? 0 } };
    }
  }
  return next;
}

/** Fold a density observation (candidates from the local density probe). */
export function observeDensity(state: JourneyState, probeCandidates: readonly PlaceCandidate[], radiusM?: number): JourneyState {
  if (!state.position) return state;
  const obs = observedDensity(state.position, radiusM, probeCandidates);
  const first = state.densityObservedAt === null;
  const density = updateDensity(first ? null : state.density, obs, state.now, first ? null : state.densityObservedAt);
  return { ...state, density, densityObservedAt: state.now };
}

// ─────────────────────────────────────────────── story lifecycle reducers

export interface StoryStartParams {
  planId: Id;
  place: Pick<PlaceCandidate, 'id' | 'name' | 'kind' | 'tags' | 'significance'>;
  angle: StoryAngle;
  segmentCount: number;
  at: Millis;
}

export function storyStarted(s: JourneyState, p: StoryStartParams): JourneyState {
  let memory = s.memory;
  // a preempted story counts as interrupted in memory (stays 'discussed')
  if (s.activeStory && s.activeStory.placeId !== p.place.id) memory = recordStoryInterrupted(memory, s.activeStory.placeId, p.at);
  memory = recordStoryStarted(memory, p.place, p.angle, p.at);
  const active: ActiveStoryState = { planId: p.planId, placeId: p.place.id, status: 'playing', startedAt: p.at, segmentIndex: 0, offsetMs: 0, segmentCount: p.segmentCount, interruptedAt: null, interruptionCause: null };
  return { ...s, memory, activeStory: active, currentPlanId: p.planId, activeStorySignificance: p.place.significance, answerSpokenSinceInterrupt: false };
}

export function storyCompleted(s: JourneyState, at: Millis): JourneyState {
  if (!s.activeStory) return s;
  return { ...s, memory: recordStoryCompleted(s.memory, s.activeStory.placeId, at), activeStory: null, lastSpeechEndedAt: at, activeStorySignificance: null };
}

export function storyInterrupted(s: JourneyState, at: Millis, cause: NonNullable<ActiveStoryState['interruptionCause']>, position?: { segmentIndex: number; offsetMs: number }): JourneyState {
  const a = s.activeStory;
  if (!a || a.status !== 'playing') return s;
  return {
    ...s,
    memory: recordStoryInterrupted(s.memory, a.placeId, at),
    activeStory: { ...a, status: 'interrupted', interruptedAt: at, interruptionCause: cause, ...(position ?? {}) },
    answerSpokenSinceInterrupt: false,
  };
}

export function answerSpoken(s: JourneyState, at: Millis): JourneyState {
  return { ...s, answerSpokenSinceInterrupt: true, lastSpeechEndedAt: at };
}

export function storyResumed(s: JourneyState, fromSegment: number, _at: Millis): JourneyState {
  const a = s.activeStory;
  if (!a) return s;
  return { ...s, activeStory: { ...a, status: 'playing', segmentIndex: fromSegment, offsetMs: 0, interruptedAt: null, interruptionCause: null }, answerSpokenSinceInterrupt: false };
}

export function storyAbandoned(s: JourneyState, at: Millis): JourneyState {
  if (!s.activeStory) return s;
  return { ...s, activeStory: null, lastSpeechEndedAt: at, activeStorySignificance: null };
}

export function storySkipped(s: JourneyState, at: Millis): JourneyState {
  if (!s.activeStory) return s;
  return { ...s, memory: recordStorySkipped(s.memory, s.activeStory.placeId, at), activeStory: null, lastSpeechEndedAt: at, activeStorySignificance: null };
}

export function storyPaused(s: JourneyState, at: Millis): JourneyState {
  const a = s.activeStory;
  if (!a || a.status !== 'playing') return s;
  return { ...s, activeStory: { ...a, status: 'paused', interruptedAt: at, interruptionCause: 'user_tap' } };
}
