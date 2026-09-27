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
import type { DiscoveryQuery, JourneyContext, LatLng, Millis, MovementRegime } from './contracts.js';
import { angleDiff, haversineM, polylineLengthM } from './geo.js';
import { DENSITY_SAMPLE_RADIUS_M } from './density.js';

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
}

/**
 * Density probe throttle: regime interval AND movement (a parked user is probed once);
 * a regime change probes again after the (new) interval; empty probes back off.
 */
export function shouldRefreshDensity(prev: DensityProbeRecord | null, ctx: JourneyContext): boolean {
  if (!ctx.position) return false;
  if (!prev) return true;
  const ageS = (ctx.now - prev.at) / 1000;
  const k = REFRESH.EMPTY_BACKOFF ** Math.min(REFRESH.EMPTY_BACKOFF_MAX_STEPS, prev.emptyStreak ?? 0);
  const regimeChanged = prev.regime !== ctx.regime.regime;
  if (ageS < REFRESH.DENSITY_MIN_INTERVAL_S[ctx.regime.regime] * (regimeChanged ? 1 : k)) return false;
  return regimeChanged || haversineM(prev.position, ctx.position) >= REFRESH.DENSITY_MIN_MOVE_M;
}

export function recordDensityProbe(prev: DensityProbeRecord | null, ctx: JourneyContext, resultCount: number): DensityProbeRecord {
  const pos = ctx.position!;
  return { at: ctx.now, position: { lat: pos.lat, lng: pos.lng }, regime: ctx.regime.regime, emptyStreak: resultCount === 0 ? (prev?.emptyStreak ?? 0) + 1 : 0 };
}
