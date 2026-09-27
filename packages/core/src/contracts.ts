/**
 * Core contracts — the single source of truth for every boundary in the system.
 *
 * Rules (see DECISIONS.md):
 *  - Nothing here knows about cities. Behaviour is a function of JourneyContext.
 *  - Everything is plain serializable data (JSON-safe). No classes, no Dates.
 *  - Time is epoch milliseconds, distances metres, speeds m/s, bearings degrees [0,360).
 */

// ─────────────────────────────────────────────────────────── primitives

export type Millis = number;
export type Id = string;
export type Locale = 'en' | 'ru' | (string & {});

export interface LatLng {
  lat: number;
  lng: number;
}

export type FixSource = 'gps' | 'network' | 'fused' | 'simulated' | 'replay';

export interface GeoFix extends LatLng {
  t: Millis;
  accuracyM?: number | null;
  /** Device-reported speed; may be null/negative on some devices. */
  speedMps?: number | null;
  /** Course over ground (not compass). */
  headingDeg?: number | null;
  altitudeM?: number | null;
  source: FixSource;
}

// ─────────────────────────────────────────────────────────── movement & density

export type MovementRegime =
  | 'unknown'
  | 'stationary'
  | 'walking'
  | 'cycling'
  | 'urban_driving'
  | 'highway_driving';

export const DRIVING_REGIMES: readonly MovementRegime[] = ['urban_driving', 'highway_driving'];

export type DensityClass = 'sparse' | 'suburban' | 'urban' | 'dense';

export interface RegimeState {
  regime: MovementRegime;
  /** When the current regime was entered (after dwell). */
  since: Millis;
  /** A candidate regime currently accumulating dwell time, if any. */
  pending?: { regime: MovementRegime; since: Millis } | null;
  smoothedSpeedMps: number;
  speedStdDevMps: number;
  /** Course estimated from recent fixes when device heading is missing/noisy. */
  courseDeg: number | null;
  /** Degrees per second over the recent window; high values = maneuvering. */
  turnRateDegPerS: number;
  /** Longitudinal acceleration estimate (m/s²), negative = braking. */
  accelMps2: number;
}

export interface DensityState {
  density: DensityClass;
  /** Smoothed candidate places per km² observed by discovery. */
  placesPerKm2: number;
  since: Millis;
}

// ─────────────────────────────────────────────────────────── client → server

export type AudioOutputRoute = 'speaker' | 'headphones' | 'bluetooth' | 'carplay' | 'android_auto' | 'unknown';

export interface ClientAudioState {
  playing: boolean;
  planId?: Id | null;
  segmentIndex?: number | null;
  /** Offset within the current segment. */
  offsetMs?: number | null;
  outputRoute: AudioOutputRoute;
}

export interface RouteHint {
  /** Ordered polyline, start ≈ current position. */
  polyline: LatLng[];
  destinationName?: string;
  source: 'navigation_handoff' | 'user' | 'replay';
}

export interface ContextFrame {
  sessionId: Id;
  /** Monotonic per session; server ignores out-of-order frames. */
  seq: number;
  /** New fixes since the previous frame (oldest first). */
  fixes: GeoFix[];
  route?: RouteHint | null;
  appState: 'foreground' | 'background' | 'locked';
  audio: ClientAudioState;
  /** Last time the user touched the screen (for driver distraction policy). */
  lastInteractionAt?: Millis | null;
  clientTime: Millis;
  /** True when fixes are emulated (WebApp simulation / replay). Must be surfaced in UI. */
  simulated: boolean;
}

// ─────────────────────────────────────────────────────────── places & evidence

export type PlaceKind =
  | 'landmark'
  | 'building'
  | 'museum'
  | 'monument'
  | 'memorial'
  | 'historic_site'
  | 'religious_site'
  | 'park'
  | 'bridge'
  | 'neighborhood'
  | 'city'
  | 'town'
  | 'region'
  | 'natural_feature'
  | 'water'
  | 'mountain'
  | 'venue'
  | 'food'
  | 'shop'
  | 'lodging'
  | 'fuel'
  | 'transit'
  | 'road_feature'
  | 'other';

/** Kinds that only surface through explicit nearby search, never as unprompted stories. */
export const UTILITY_KINDS: readonly PlaceKind[] = ['food', 'shop', 'lodging', 'fuel', 'transit'];

export interface SourceRef {
  provider: string; // e.g. 'google_places', 'wikidata', 'wikipedia', 'fixture'
  ref: string; // provider-native id / URL / title
  license?: string;
  retrievedAt: Millis;
}

export interface PlaceCandidate {
  /** Stable, provider-scoped id: 'wd:Q9188', 'gp:ChIJ...', 'fx:...' */
  id: Id;
  name: string;
  kind: PlaceKind;
  location: LatLng;
  /** Approximate radius of the feature (city, park, lake). 0 for point features. */
  extentM: number;
  /**
   * Deterministic 0..1 importance, derived by provider adapters from
   * global signals (Wikidata sitelinks, heritage designations, rating volume, kind).
   * Never produced by an LLM.
   */
  significance: number;
  tags: string[];
  externalRefs: { wikidataId?: string; googlePlaceId?: string; wikipediaTitle?: string };
  sources: SourceRef[];
}

export type FactKind =
  | 'identity'
  | 'date'
  | 'person'
  | 'architecture'
  | 'event'
  | 'quantity'
  | 'culture'
  | 'nature'
  | 'trivia'
  | 'practical';

export interface EvidenceFact {
  id: Id;
  placeId: Id;
  kind: FactKind;
  /** One normalized, self-contained statement. */
  text: string;
  /** Tokens the generator may use verbatim; used by GroundingCheck. */
  entities: string[];
  numbers: string[];
  /** 0..1, from source quality/agreement; deterministic. */
  confidence: number;
  source: SourceRef;
}

export interface EvidencePack {
  placeId: Id;
  placeName: string;
  facts: EvidenceFact[];
  fetchedAt: Millis;
  /** True when facts are too thin to support a full story. */
  thin: boolean;
}

// ─────────────────────────────────────────────────────────── discovery

export type RelativePosition = 'here' | 'ahead' | 'beside' | 'behind';

export interface CandidateGeometry {
  distanceM: number;
  bearingDeg: number;
  /** Signed bearing relative to course (-180..180), null when no course. */
  relativeBearingDeg: number | null;
  /** Distance along trajectory/route to closest approach; null for radial mode. */
  alongTrackM: number | null;
  /** Lateral offset from trajectory/route at closest approach. */
  crossTrackM: number | null;
  /** Seconds until closest approach at current speed. */
  etaS: number | null;
  relative: RelativePosition;
  side: 'left' | 'right' | 'center' | null;
}

export type SuppressionReason =
  | 'behind'
  | 'off_course'
  | 'beyond_lookahead'
  | 'below_significance_floor'
  | 'already_discussed'
  | 'recently_rejected'
  | 'utility_kind'
  | 'too_close_to_pass' // not enough time to tell even a short story
  | 'evidence_thin';

export interface ScoredCandidate {
  place: PlaceCandidate;
  geometry: CandidateGeometry;
  eligible: boolean;
  suppressedBy: SuppressionReason[];
  /** Final score (higher is better). Only meaningful when eligible. */
  score: number;
  /** Named components for explainability/admin debugging. */
  components: Record<string, number>;
}

export interface DiscoveryQuery {
  /** Centre and radius the PlaceSource should cover (a superset of the corridor). */
  center: LatLng;
  radiusM: number;
  /** Optional corridor polyline so sources can bias toward the route. */
  corridor?: LatLng[] | null;
  minSignificance: number;
  kinds?: PlaceKind[] | null;
  locale: Locale;
}

// ─────────────────────────────────────────────────────────── guides

export type StoryAngle =
  | 'origin'
  | 'people'
  | 'architecture'
  | 'turning_point'
  | 'hidden_detail'
  | 'nature'
  | 'everyday_life'
  | 'numbers'
  | 'connection'; // links to something discussed earlier in the journey

export interface GuideProfile {
  id: Id;
  name: string;
  tagline: string;
  personality: string;
  narrative: {
    preferredAngles: StoryAngle[];
    /** Multiplier on regime word budget (0.7 terse … 1.2 expansive). */
    verbosity: number;
    humor: number; // 0..1
    useJourneyCallbacks: boolean;
    openingStyle: string;
    signoffStyle: string;
  };
  voice: {
    description: string;
    /** Provider → voice id. Chosen by benchmark, not by the LLM. */
    byProvider: Record<string, string>;
    speakingRate: number;
  };
  visual: { accent: string; portrait: string; avatar: string };
}

// ─────────────────────────────────────────────────────────── narrative

export type StoryMode = 'teaser' | 'short' | 'full';

export interface StoryBrief {
  id: Id;
  placeId: Id;
  placeName: string;
  placeKind: PlaceKind;
  angle: StoryAngle;
  mode: StoryMode;
  facts: EvidenceFact[];
  /** Hard budgets decided by policy; the generator must obey. */
  durationBudgetS: number;
  maxWords: number;
  guideId: Id;
  locale: Locale;
  regime: MovementRegime;
  /** Deterministic phrase, e.g. "ahead on your right, about two kilometres". */
  spatialCue: string | null;
  /** Names of earlier places the Guide may reference for continuity. */
  journeyCallbacks: string[];
  /** Driving: the Guide must not ask the user questions. */
  allowQuestionsToUser: boolean;
}

export interface NarrativeSegment {
  id: Id;
  index: number;
  text: string;
  /** Hash of (text, guide voice, locale) — TTS cache key. */
  hash: string;
  estDurationMs: number;
  factIds: Id[];
}

export interface GroundingResult {
  ok: boolean;
  unsupportedNumbers: string[];
  unsupportedEntities: string[];
  wordCount: number;
  overBudget: boolean;
}

export interface NarrativePlan {
  id: Id;
  briefId: Id;
  placeId: Id;
  guideId: Id;
  locale: Locale;
  segments: NarrativeSegment[];
  generatedBy: { kind: 'llm'; provider: string; model: string } | { kind: 'template' };
  grounding: GroundingResult;
  createdAt: Millis;
}

// ─────────────────────────────────────────────────────────── active story / interruption

export type StoryStatus = 'playing' | 'paused' | 'interrupted' | 'completed' | 'abandoned' | 'skipped';

export interface ActiveStoryState {
  planId: Id;
  placeId: Id;
  status: StoryStatus;
  startedAt: Millis;
  segmentIndex: number;
  offsetMs: number;
  segmentCount: number;
  interruptedAt?: Millis | null;
  interruptionCause?: 'user_speech' | 'user_tap' | 'safety' | 'higher_priority' | 'connectivity' | null;
}

export type ResumeDecision =
  | { action: 'resume'; fromSegment: number; bridge: boolean }
  | { action: 'abandon'; reason: 'target_passed' | 'stale' | 'user_moved_on' | 'superseded' | 'nearly_done' };

// ─────────────────────────────────────────────────────────── journey memory

export interface DiscussedEntry {
  placeId: Id;
  placeName: string;
  at: Millis;
  depth: 'mention' | 'story' | 'followup';
  completed: boolean;
  angle?: StoryAngle;
}

export interface JourneyMemory {
  discussed: Record<Id, DiscussedEntry>;
  /** Places the user skipped/rejected ("not that one"). */
  rejected: Record<Id, Millis>;
  /** Coarse themes already covered (e.g. 'architecture', 'bridges'), to vary angles. */
  themes: Record<string, number>;
  questions: Array<{ at: Millis; text: string; intent: Intent }>;
  storiesCompleted: number;
  storiesSkipped: number;
  /** User-set talkativeness (-2 quieter … +2 chattier). */
  talkativeness: number;
}

export interface SafetyState {
  /** True while regime is driving; UI must be glanceable-only. */
  driveSafe: boolean;
  maneuvering: boolean;
  /** Reasons speech onset is currently blocked. */
  speechHoldReasons: string[];
}

export interface JourneyContext {
  sessionId: Id;
  now: Millis;
  position: GeoFix;
  regime: RegimeState;
  density: DensityState;
  route: RouteHint | null;
  memory: JourneyMemory;
  activeStory: ActiveStoryState | null;
  guideId: Id;
  locale: Locale;
  lastSpeechEndedAt: Millis | null;
  sessionStartedAt: Millis;
  safety: SafetyState;
  audioRoute: AudioOutputRoute;
  simulated: boolean;
}

// ─────────────────────────────────────────────────────────── moment planning

export type SilenceReason =
  | 'nothing_worth_it'
  | 'cadence_gap'
  | 'story_in_progress'
  | 'safety_hold'
  | 'listening'
  | 'warming_up'
  | 'user_paused'
  | 'no_fix';

export type MomentDecision =
  | { kind: 'silence'; reason: SilenceReason; reevaluateInMs: number; best?: ScoredCandidate | null }
  | { kind: 'start_story'; target: ScoredCandidate; mode: StoryMode; angle: StoryAngle; durationBudgetS: number; maxWords: number; preempt: boolean }
  | { kind: 'continue_story' }
  | { kind: 'resume_story'; decision: Extract<ResumeDecision, { action: 'resume' }> }
  | { kind: 'abandon_story'; decision: Extract<ResumeDecision, { action: 'abandon' }> };

// ─────────────────────────────────────────────────────────── conversation

export type Intent =
  | 'what_is_that'
  | 'tell_more'
  | 'ask_question'
  | 'skip'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'repeat'
  | 'nearby_search'
  | 'navigate_to'
  | 'not_that_one'
  | 'quieter'
  | 'chattier'
  | 'change_guide'
  | 'smalltalk'
  | 'unknown';

export interface InterpretedUtterance {
  text: string;
  intent: Intent;
  slots: { category?: string; query?: string; placeRef?: string; guideRef?: string };
  confidence: number;
  interpretedBy: 'rules' | 'llm';
}

/** Tools the conversation layer may *request*; ToolPolicy decides. */
export type ToolName = 'nearby_search' | 'place_details' | 'navigate_handoff' | 'show_on_map' | 'evidence_lookup';

export interface ToolRequest {
  tool: ToolName;
  args: Record<string, unknown>;
  requestedBy: 'rules' | 'llm';
}

export type ToolDecision = { allowed: true; request: ToolRequest } | { allowed: false; request: ToolRequest; reason: string };

// ─────────────────────────────────────────────────────────── server → client directives

export type MapAction =
  | { kind: 'follow_user' }
  | { kind: 'focus_place'; placeId: Id; location: LatLng; name: string }
  | { kind: 'show_results'; results: Array<{ placeId: Id; name: string; location: LatLng; distanceM: number; kind: PlaceKind }> }
  | { kind: 'clear' };

export interface PlayableSegment {
  segmentId: Id;
  index: number;
  text: string;
  audioUrl: string | null; // null → client uses on-device TTS fallback (degraded)
  durationMs: number;
}

export type Directive =
  | { type: 'play'; planId: Id; placeId: Id; placeName: string; segments: PlayableSegment[]; startAt: { segmentIndex: number; offsetMs: number }; bridgeText?: string | null }
  | { type: 'stop_audio'; reason: string }
  | { type: 'map'; action: MapAction }
  | { type: 'listen'; mode: 'push_to_talk' | 'open'; timeoutMs: number }
  | { type: 'say'; text: string; audioUrl: string | null; purpose: 'answer' | 'ack' | 'error' }
  | { type: 'navigate_handoff'; destination: LatLng; name: string; urls: { apple?: string; google: string; waze?: string } }
  | { type: 'state'; regime: MovementRegime; density: DensityClass; driveSafe: boolean; simulated: boolean; silence?: SilenceReason | null }
  | { type: 'card'; placeId: Id; name: string; kind: PlaceKind; location: LatLng; spatialCue: string | null };

// ─────────────────────────────────────────────────────────── telemetry & cost

export type ProviderCategory = 'llm' | 'tts' | 'stt' | 'realtime' | 'maps' | 'knowledge';

export interface CostRecord {
  sessionId: Id | null;
  provider: string;
  model: string | null;
  category: ProviderCategory;
  task: string; // e.g. 'story_generation', 'intent', 'nearby_search', 'tts_segment'
  units: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; characters?: number; audioSeconds?: number; requests?: number };
  costUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  ok: boolean;
  at: Millis;
}

export type TelemetryEventName =
  | 'session_start'
  | 'session_end'
  | 'regime_change'
  | 'story_offered'
  | 'story_started'
  | 'story_completed'
  | 'story_skipped'
  | 'story_interrupted'
  | 'story_resumed'
  | 'story_abandoned'
  | 'question_asked'
  | 'nearby_search'
  | 'navigate_handoff'
  | 'not_that_one'
  | 'feedback'
  | 'guide_selected'
  | 'provider_error'
  | 'provider_fallback'
  | 'latency';

export interface TelemetryEvent {
  name: TelemetryEventName;
  sessionId: Id;
  at: Millis;
  /** Coarse geohash (precision ≤ 5); never raw coordinates. */
  geohash5?: string | null;
  regime?: MovementRegime;
  props: Record<string, string | number | boolean | null>;
}
