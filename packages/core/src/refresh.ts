/**
 * Discovery refresh / query-throttle policy (acceptance A5 "no paid request loop at highway
 * GPS frequency", F1 "no paid refresh on every GPS update", E1 "no provider-call spam").
 *
 * The PlaceSource is queried only when the cached result no longer covers the traveller:
 *  - first query, or route changed;
 *  - movement regime changed (radius/look-ahead/floor change) — still subject to the minimum interval;
 *  - moved farther than a fraction of the covered distance since the last fetch
 *    (radial: fraction of the radius; corridor: fraction of the look-ahead length);
 *  - course turned materially away from the corridor the last fetch covered;
 *  - the cached result is older than a max age.
 * Never more often than a per-regime minimum interval. Empty results back off exponentially
 * (interval and distance), so a sparse desert produces a handful of calls, not one per fix.
 *
 * Between refreshes, callers re-score the cached candidates against the current position —
 * scoring is pure and cheap; the provider call is the paid part.
 */
import type { DensityClass, DiscoveryQuery, JourneyContext, LatLng, Millis, MovementRegime, PlaceCandidate } from './contracts.js';
import { angleDiff, haversineM, polylineLengthM } from './geo.js';
import { DENSITY_SAMPLE_RADIUS_M, classifyDensity, densityProbeRadiusFor, observedDensity } from './density.js';

export const REFRESH = {
  MIN_INTERVAL_S: { unknown: 20, stationary: 60, walking: 20, cycling: 20, urban_driving: 20, highway_driving: 30 } satisfies Record<MovementRegime, number>,
  MAX_AGE_S: { unknown: 300, stationary: 900, walking: 300, cycling: 300, urban_driving: 300, highway_driving: 600 } satisfies Record<MovementRegime, number>,
  /** Radial: refresh after moving this fraction of the query radius. */
  RADIAL_MOVE_FRACTION: 0.3,
  /** Corridor: refresh after moving this fraction of the covered corridor length. */
  CORRIDOR_MOVE_FRACTION: 0.2,
  /** Corridor: refresh when the course deviates this much from the fetched corridor's course. */
  COURSE_CHANGE_DEG: 35,
  /** Empty-result backoff: multiplier per consecutive empty result (capped). */
  EMPTY_BACKOFF: 2,
  EMPTY_BACKOFF_MAX_STEPS: 3,
  /** Density probe: minimum interval per regime and minimum movement. */
  DENSITY_MIN_INTERVAL_S: { unknown: 30, stationary: 300, walking: 30, cycling: 45, urban_driving: 45, highway_driving: 90 } satisfies Record<MovementRegime, number>,
  DENSITY_MIN_MOVE_M: DENSITY_SAMPLE_RADIUS_M,
  /**
   * Stable-density backoff (D-024): after each probe that left the density class unchanged the
   * interval doubles, up to 2^steps. Highway surroundings change slowly and a class change is
   * also caught early by the discovery hint (`densityHintFrom`), so the highway may back off
   * furthest. A regime change always resets to the base interval.
   */
  DENSITY_STABLE_MAX_STEPS: { unknown: 0, stationary: 0, walking: 1, cycling: 1, urban_driving: 1, highway_driving: 2 } satisfies Record<MovementRegime, number>,
} as const;

/** What the caller remembers about the last paid fetch. JSON-safe. */
export interface DiscoveryFetchRecord {
  at: Millis;
  position: LatLng;
  regime: MovementRegime;
  /** Covered distance: radius (radial) or corridor length (corridor). */
  coverageM: number;
  mode: 'radial' | 'corridor';
  courseDeg: number | null;
  resultCount: number;
  /** Consecutive empty results (for backoff). */
  emptyStreak: number;
  /** Route identity (first/last vertex + length) to detect route changes. */
  routeKey: string | null;
}

export type RefreshReason = 'initial' | 'route_changed' | 'regime_changed' | 'moved' | 'course_changed' | 'stale';

export type RefreshDecision = { refresh: true; reason: RefreshReason } | { refresh: false; reason: 'min_interval' | 'covered' | 'no_fix' };

export function routeKey(ctx: Pick<JourneyContext, 'route'>): string | null {
  const r = ctx.route?.polyline;
  if (!r || r.length < 2) return null;
  const a = r[0]!;
  const b = r.at(-1)!;
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}#${Math.round(polylineLengthM(r))}`;
}

function backoff(rec: DiscoveryFetchRecord): number {
  if (rec.resultCount > 0) return 1;
  return REFRESH.EMPTY_BACKOFF ** Math.min(REFRESH.EMPTY_BACKOFF_MAX_STEPS, Math.max(1, rec.emptyStreak));
}

/** Should the PlaceSource be queried now for `next` (the query discoveryQueryFor would issue)? */
export function shouldRefreshDiscovery(prev: DiscoveryFetchRecord | null, ctx: JourneyContext, next: DiscoveryQuery): RefreshDecision {
  if (!ctx.position) return { refresh: false, reason: 'no_fix' };
  if (!prev) return { refresh: true, reason: 'initial' };
  const regime = ctx.regime.regime;
  const ageS = (ctx.now - prev.at) / 1000;
  const k = backoff(prev);
  const minInterval = Math.max(REFRESH.MIN_INTERVAL_S[regime], REFRESH.MIN_INTERVAL_S[prev.regime] / 2) * k;
  if (ageS < Math.min(minInterval, REFRESH.MAX_AGE_S[regime])) return { refresh: false, reason: 'min_interval' };
  if (routeKey(ctx) !== prev.routeKey) return { refresh: true, reason: 'route_changed' };
  if (regime !== prev.regime) return { refresh: true, reason: 'regime_changed' };
  const moved = haversineM(prev.position, ctx.position);
  const corridor = !!next.corridor && next.corridor.length >= 2;
  const frac = corridor ? REFRESH.CORRIDOR_MOVE_FRACTION : REFRESH.RADIAL_MOVE_FRACTION;
  if (moved >= frac * prev.coverageM * k) return { refresh: true, reason: 'moved' };
  if (corridor && prev.courseDeg !== null && ctx.regime.courseDeg !== null && Math.abs(angleDiff(prev.courseDeg, ctx.regime.courseDeg)) >= REFRESH.COURSE_CHANGE_DEG) {
    return { refresh: true, reason: 'course_changed' };
  }
  if (ageS >= REFRESH.MAX_AGE_S[regime] * k) return { refresh: true, reason: 'stale' };
  return { refresh: false, reason: 'covered' };
}

/** Build the record to keep after a fetch. */
export function recordDiscoveryFetch(prev: DiscoveryFetchRecord | null, ctx: JourneyContext, q: DiscoveryQuery, resultCount: number): DiscoveryFetchRecord {
  const corridor = !!q.corridor && q.corridor.length >= 2;
  return {
    at: ctx.now,
    position: { lat: ctx.position?.lat ?? q.center.lat, lng: ctx.position?.lng ?? q.center.lng },
    regime: ctx.regime.regime,
    coverageM: corridor ? polylineLengthM(q.corridor!) : q.radiusM,
    mode: corridor ? 'corridor' : 'radial',
    courseDeg: ctx.regime.courseDeg,
    resultCount,
    emptyStreak: resultCount === 0 ? (prev?.emptyStreak ?? 0) + 1 : 0,
    routeKey: routeKey(ctx),
  };
}

export interface DensityProbeRecord {
  at: Millis;
  position: LatLng;
  regime: MovementRegime;
  /** Consecutive empty probes (backoff). */
  emptyStreak?: number;
  /** Density class right after this probe was folded in (stable backoff, D-024). */
  density?: DensityClass;
  /** Consecutive probes (same regime) that left the density class unchanged. */
  stableStreak?: number;
}

/**
 * Density evidence from a discovery result that already covers the probe area (D-024): the
 * discovery candidates inside the probe circle are a LOWER BOUND on local density (discovery
 * uses a higher significance floor than the probe). Null when the discovery query does not
 * cover the whole probe circle around the current position.
 */
export function densityHintFrom(ctx: JourneyContext, discovery: { query: Pick<DiscoveryQuery, 'center' | 'radiusM'> | null; candidates: readonly PlaceCandidate[] }): number | null {
  if (!ctx.position || !discovery.query) return null;
  const r = densityProbeRadiusFor(ctx.regime.regime);
  if (haversineM(discovery.query.center, ctx.position) + r > discovery.query.radiusM) return null;
  return observedDensity(ctx.position, r, discovery.candidates);
}

function classIndex(c: DensityClass): number {
  return ['sparse', 'suburban', 'urban', 'dense'].indexOf(c);
}

/**
 * Density probe throttle: regime interval AND movement (a parked user is probed once);
 * a regime change probes again after the (new) interval; empty probes back off; probes that
 * keep confirming the same class back off (D-024). A discovery hint that already proves a
 * denser class than the current one (lower bound above the class) probes at the base interval.
 */
export function shouldRefreshDensity(prev: DensityProbeRecord | null, ctx: JourneyContext, hintPlacesPerKm2: number | null = null): boolean {
  if (!ctx.position) return false;
  if (!prev) return true;
  const regime = ctx.regime.regime;
  const ageS = (ctx.now - prev.at) / 1000;
  const regimeChanged = prev.regime !== regime;
  const base = REFRESH.DENSITY_MIN_INTERVAL_S[regime];
  if (regimeChanged) return ageS >= base;
  const moved = haversineM(prev.position, ctx.position) >= REFRESH.DENSITY_MIN_MOVE_M;
  if (!moved) return false;
  const kEmpty = REFRESH.EMPTY_BACKOFF ** Math.min(REFRESH.EMPTY_BACKOFF_MAX_STEPS, prev.emptyStreak ?? 0);
  const kStable = REFRESH.EMPTY_BACKOFF ** Math.min(REFRESH.DENSITY_STABLE_MAX_STEPS[regime], prev.stableStreak ?? 0);
  if (ageS >= base * Math.max(kEmpty, kStable)) return true;
  // Area change seen by discovery: its lower bound already classifies above the current class.
  return hintPlacesPerKm2 !== null && ageS >= base && classIndex(classifyDensity(hintPlacesPerKm2)) > classIndex(ctx.density.density);
}

export function recordDensityProbe(prev: DensityProbeRecord | null, ctx: JourneyContext, resultCount: number, densityAfter?: DensityClass): DensityProbeRecord {
  const pos = ctx.position!;
  const sameRegime = prev?.regime === ctx.regime.regime;
  const stable = densityAfter !== undefined && sameRegime && prev?.density === densityAfter;
  return {
    at: ctx.now,
    position: { lat: pos.lat, lng: pos.lng },
    regime: ctx.regime.regime,
    emptyStreak: resultCount === 0 ? (prev?.emptyStreak ?? 0) + 1 : 0,
    ...(densityAfter !== undefined ? { density: densityAfter, stableStreak: stable ? (prev?.stableStreak ?? 0) + 1 : 0 } : {}),
  };
}
