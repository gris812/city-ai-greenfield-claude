/**
 * Local density estimator (D-006). Input is the number of candidate places per km²
 * (at or above DENSITY_SIGNIFICANCE_FLOOR) observed by discovery around the user.
 * Output is exponentially smoothed and classified with hysteresis so the class does not
 * chatter at boundaries.
 *
 * Thresholds (places/km² with significance ≥ floor):
 *   sparse < 2 ≤ suburban < 15 ≤ urban < 80 ≤ dense
 * A class boundary must be crossed by HYSTERESIS_FRACTION (20 %) to switch.
 * These are tuned for a provider that returns "notable" places (Wikidata-like with
 * sitelinks, Places with rating volume). Raw OSM-node densities would need a different
 * calibration — the adapter is expected to pre-filter by the floor.
 */
import type { DensityClass, DensityState, Millis, PlaceCandidate, LatLng } from './contracts.js';
import { haversineM } from './geo.js';

export const DENSITY_BOUNDS = {
  SPARSE_MAX: 2,
  SUBURBAN_MAX: 15,
  URBAN_MAX: 80,
} as const;

export const DENSITY_SIGNIFICANCE_FLOOR = 0.1;
export const HYSTERESIS_FRACTION = 0.2;
/** Time constant for exponential smoothing. Observation cadence-independent. */
export const DENSITY_TAU_S = 45;
/** Minimum radius used when converting counts to per-km² (avoids tiny-area blowups). */
export const DENSITY_MIN_RADIUS_M = 250;
/**
 * Radius of the local density probe. Kept small on purpose: density is a property of the
 * user's immediate surroundings, not of the (possibly 60 km) discovery corridor, and a
 * small probe keeps the count within a single provider result page (≈ 31 places at the
 * dense boundary).
 */
export const DENSITY_SAMPLE_RADIUS_M = 350;

const ORDER: DensityClass[] = ['sparse', 'suburban', 'urban', 'dense'];
const UPPER: Record<DensityClass, number> = {
  sparse: DENSITY_BOUNDS.SPARSE_MAX,
  suburban: DENSITY_BOUNDS.SUBURBAN_MAX,
  urban: DENSITY_BOUNDS.URBAN_MAX,
  dense: Infinity,
};

export function classifyDensity(placesPerKm2: number): DensityClass {
  if (placesPerKm2 < DENSITY_BOUNDS.SPARSE_MAX) return 'sparse';
  if (placesPerKm2 < DENSITY_BOUNDS.SUBURBAN_MAX) return 'suburban';
  if (placesPerKm2 < DENSITY_BOUNDS.URBAN_MAX) return 'urban';
  return 'dense';
}

export function initialDensityState(now: Millis, density: DensityClass = 'suburban'): DensityState {
  const mid: Record<DensityClass, number> = { sparse: 1, suburban: 6, urban: 35, dense: 120 };
  return { density, placesPerKm2: mid[density], since: now };
}

/**
 * Update with a new observation. `prev` may be null for the first observation, which is
 * taken as-is. Smoothing weight α = 1 − exp(−Δt/τ).
 */
export function updateDensity(prev: DensityState | null, observedPlacesPerKm2: number, now: Millis, lastObservedAt?: Millis | null): DensityState {
  const obs = Number.isFinite(observedPlacesPerKm2) && observedPlacesPerKm2 >= 0 ? observedPlacesPerKm2 : 0;
  if (!prev) return { density: classifyDensity(obs), placesPerKm2: obs, since: now };
  const dtS = Math.max(0, (now - (lastObservedAt ?? prev.since)) / 1000);
  const alpha = lastObservedAt === undefined ? 0.3 : 1 - Math.exp(-Math.max(dtS, 1) / DENSITY_TAU_S);
  const smoothed = prev.placesPerKm2 + alpha * (obs - prev.placesPerKm2);
  const idx = ORDER.indexOf(prev.density);
  let next = prev.density;
  // step up while above the current class's upper bound by the hysteresis margin
  let i = idx;
  while (i < ORDER.length - 1 && smoothed >= UPPER[ORDER[i]!] * (1 + HYSTERESIS_FRACTION)) i++;
  if (i === idx) {
    while (i > 0 && smoothed < UPPER[ORDER[i - 1]!] * (1 - HYSTERESIS_FRACTION)) i--;
  }
  next = ORDER[i]!;
  return { density: next, placesPerKm2: smoothed, since: next === prev.density ? prev.since : now };
}

/**
 * Observed density from a candidate list around `center` within `radiusM`.
 * Only point-ish places (extent < radius) at or above the significance floor count.
 */
export function observedDensity(center: LatLng, radiusM: number = DENSITY_SAMPLE_RADIUS_M, candidates: readonly PlaceCandidate[] = []): number {
  const r = Math.max(DENSITY_MIN_RADIUS_M, radiusM);
  let n = 0;
  for (const c of candidates) {
    if (c.significance < DENSITY_SIGNIFICANCE_FLOOR) continue;
    if (c.extentM >= r) continue; // enclosing regions/cities don't count as local density
    if (haversineM(center, c.location) <= r) n++;
  }
  const areaKm2 = (Math.PI * r * r) / 1e6;
  return n / areaKm2;
}
