/**
 * Deterministic policy tables. Every behavioural knob that varies with movement
 * or surroundings lives here — keyed by MovementRegime and DensityClass only.
 * There are intentionally no city keys (DECISIONS D-004).
 */
import type { DensityClass, MovementRegime, StoryMode, TtsTier } from './contracts.js';

export interface RegimePolicy {
  /** Radial discovery radius (stationary/walking) or near-field radius (driving). */
  nearRadiusM: number;
  /** Base look-ahead along the trajectory for an average-significance place. */
  lookAheadBaseM: number;
  /** Absolute maximum look-ahead for the most significant features (cities, ranges, rivers). */
  lookAheadMaxM: number;
  /** Corridor half-width at the vehicle; widens with along-track distance. */
  corridorHalfWidthM: number;
  /** Additional half-width per km of along-track distance (cone). */
  corridorWideningMPerKm: number;
  /** Candidates behind by more than this are suppressed. */
  behindToleranceM: number;
  /** Minimum significance to be considered at all. */
  significanceFloor: number;
  /** Minimum value score for speaking unprompted; below → silence. */
  speakThreshold: number;
  /** Minimum quiet gap after a story ends before starting another unprompted. */
  minGapS: number;
  /** Hard cap on unprompted story length. */
  maxStoryS: number;
  /** Default story mode. */
  defaultMode: StoryMode;
  /** Whether the Guide may ask the user questions / offer choices. */
  interactivePrompts: boolean;
  /** Whether listening may open without an explicit user action. */
  autoListen: boolean;
  /** Minimum seconds of lead time needed before closest approach to start a story. */
  minLeadS: number;
  /** Speech words per second used for duration estimates. */
  wordsPerSecond: number;
  /** Seconds after entering the regime before the first unprompted story. */
  warmupS: number;
}

const BASE: Record<Exclude<MovementRegime, 'unknown'>, RegimePolicy> = {
  stationary: {
    nearRadiusM: 250,
    lookAheadBaseM: 0,
    lookAheadMaxM: 1500,
    corridorHalfWidthM: 0,
    corridorWideningMPerKm: 0,
    behindToleranceM: Infinity,
    significanceFloor: 0.2,
    speakThreshold: 0.45,
    minGapS: 90,
    maxStoryS: 150,
    defaultMode: 'full',
    interactivePrompts: true,
    autoListen: false,
    minLeadS: 0,
    wordsPerSecond: 2.5,
    warmupS: 5,
  },
  walking: {
    nearRadiusM: 300,
    lookAheadBaseM: 250,
    lookAheadMaxM: 1500,
    corridorHalfWidthM: 120,
    corridorWideningMPerKm: 200,
    behindToleranceM: 60,
    significanceFloor: 0.2,
    speakThreshold: 0.42,
    minGapS: 45,
    maxStoryS: 120,
    defaultMode: 'full',
    interactivePrompts: true,
    autoListen: false,
    minLeadS: 20,
    wordsPerSecond: 2.5,
    warmupS: 8,
  },
  cycling: {
    nearRadiusM: 350,
    lookAheadBaseM: 700,
    lookAheadMaxM: 4000,
    corridorHalfWidthM: 150,
    corridorWideningMPerKm: 150,
    behindToleranceM: 40,
    significanceFloor: 0.3,
    speakThreshold: 0.5,
    minGapS: 90,
    maxStoryS: 75,
    defaultMode: 'short',
    interactivePrompts: false,
    autoListen: false,
    minLeadS: 25,
    wordsPerSecond: 2.5,
    warmupS: 15,
  },
  urban_driving: {
    nearRadiusM: 400,
    lookAheadBaseM: 1200,
    lookAheadMaxM: 8000,
    corridorHalfWidthM: 200,
    corridorWideningMPerKm: 120,
    behindToleranceM: 30,
    significanceFloor: 0.4,
    speakThreshold: 0.55,
    minGapS: 120,
    maxStoryS: 60,
    defaultMode: 'short',
    interactivePrompts: false,
    autoListen: false,
    minLeadS: 30,
    wordsPerSecond: 2.4,
    warmupS: 30,
  },
  highway_driving: {
    nearRadiusM: 1500,
    lookAheadBaseM: 6000,
    lookAheadMaxM: 60000,
    corridorHalfWidthM: 1500,
    corridorWideningMPerKm: 150,
    behindToleranceM: 0,
    significanceFloor: 0.55,
    speakThreshold: 0.62,
    minGapS: 480,
    maxStoryS: 75,
    defaultMode: 'short',
    interactivePrompts: false,
    autoListen: false,
    minLeadS: 60,
    wordsPerSecond: 2.4,
    warmupS: 60,
  },
};

/** Density modifiers — dense areas raise the bar and shrink windows; sparse areas widen them. */
const DENSITY_MOD: Record<DensityClass, { radius: number; lookAhead: number; floor: number; threshold: number; gap: number }> = {
  dense: { radius: 0.7, lookAhead: 0.7, floor: +0.1, threshold: +0.05, gap: 1.0 },
  urban: { radius: 1.0, lookAhead: 1.0, floor: 0, threshold: 0, gap: 1.0 },
  suburban: { radius: 1.4, lookAhead: 1.3, floor: -0.05, threshold: 0, gap: 1.0 },
  sparse: { radius: 2.0, lookAhead: 1.6, floor: -0.1, threshold: -0.02, gap: 1.0 },
};

export function policyFor(regime: MovementRegime, density: DensityClass): RegimePolicy {
  const base = BASE[regime === 'unknown' ? 'walking' : regime];
  const m = DENSITY_MOD[density];
  return {
    ...base,
    nearRadiusM: Math.round(base.nearRadiusM * m.radius),
    lookAheadBaseM: Math.round(base.lookAheadBaseM * m.lookAhead),
    lookAheadMaxM: Math.round(base.lookAheadMaxM * m.lookAhead),
    significanceFloor: clamp01(base.significanceFloor + m.floor),
    speakThreshold: clamp01(base.speakThreshold + m.threshold),
    minGapS: Math.round(base.minGapS * m.gap),
    // unknown regime is treated as walking but never speaks unprompted until classified
    ...(regime === 'unknown' ? { speakThreshold: 1.01 } : {}),
  };
}

/**
 * Significance-scaled look-ahead: a place's reach grows smoothly from the base window
 * (significance ≈ floor) to the regime max (significance = 1).
 */
export function lookAheadFor(policy: RegimePolicy, significance: number): number {
  if (policy.lookAheadBaseM === 0) return policy.nearRadiusM;
  const s = clamp01(significance);
  const k = s * s * s; // strongly favour truly major features for long reach
  return policy.lookAheadBaseM + (policy.lookAheadMaxM - policy.lookAheadBaseM) * k;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ─────────────────────────────────────────────── TTS tiers (D-019)

/** What a piece of speech is, for tier routing. */
export type SpeechPurpose = 'story_body' | 'story_prefix' | 'answer' | 'ack';

/**
 * Tier configuration. Stories are tiered by movement regime; the spoken context prefix either
 * matches its story's tier (`match`, default: one voice per story, no mid-story voice switch)
 * or is pinned to a tier. Deployment config may override every entry (TTS_TIER_* env).
 */
export interface TtsTierConfig {
  stories: Record<MovementRegime, TtsTier>;
  prefix: TtsTier | 'match';
  answer: TtsTier;
  ack: TtsTier;
}

export const DEFAULT_TTS_TIERS: TtsTierConfig = {
  stories: {
    unknown: 'standard',
    stationary: 'standard',
    walking: 'standard',
    cycling: 'standard',
    urban_driving: 'standard',
    // Highway teasers: long silences, short stories, glance-free listening; the cheap tier is the
    // difference between a break-even and a profitable driver plan (docs/PERFORMANCE_COST.md §9).
    highway_driving: 'economy',
  },
  prefix: 'match',
  answer: 'standard',
  ack: 'standard',
};

/** Deterministic tier for a piece of speech. */
export function ttsTierFor(purpose: SpeechPurpose, regime: MovementRegime, cfg: TtsTierConfig = DEFAULT_TTS_TIERS): TtsTier {
  switch (purpose) {
    case 'story_body':
      return cfg.stories[regime] ?? 'standard';
    case 'story_prefix':
      return cfg.prefix === 'match' ? (cfg.stories[regime] ?? 'standard') : cfg.prefix;
    case 'answer':
      return cfg.answer;
    case 'ack':
      return cfg.ack;
  }
}

// ─────────────────────────────────────────────── cross-session memory (D-023)

export const RETELL = {
  /**
   * A place told to this user/guest in an earlier session is not re-offered unprompted until
   * this many days have passed (daily commuters do not hear the same stories). Asking about it
   * explicitly still works. Must stay ≤ the 90-day history retention (D-012).
   */
  AFTER_DAYS: 30,
  /** History entries loaded into a new session (most recent first). */
  MAX_ENTRIES: 2000,
} as const;

/** True when a place last told at `lastToldAt` (epoch ms) may be told again at `now`. */
export function retellAllowed(lastToldAt: number | undefined, now: number, afterDays: number = RETELL.AFTER_DAYS): boolean {
  if (afterDays <= 0) return true; // knob off: retelling is never suppressed by history (also immune to client/server clock skew)
  if (lastToldAt === undefined || !Number.isFinite(lastToldAt)) return true;
  return now - lastToldAt >= afterDays * 86_400_000;
}
