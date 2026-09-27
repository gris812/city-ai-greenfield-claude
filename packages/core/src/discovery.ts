/**
 * Location-first discovery (D-004, D-007).
 *
 *  - stationary / walking / unknown → RADIAL around the position (walking: forward bias).
 *  - cycling / driving              → CORRIDOR along the route polyline when known and the
 *    traveller is on it, else along a straight heading projection. Each candidate gets
 *    along-track, signed cross-track and ETA; candidates behind, off-course, beyond the
 *    significance-scaled look-ahead, or reachable too soon to tell are suppressed.
 *
 * Score = significance × (BASE + (1 − BASE) × contextFit)
 *   contextFit = Σ wᵢ·componentᵢ over timing, novelty, affinity, visibility, continuity.
 * Significance is therefore the ceiling of a candidate's score — context can only discount
 * it — which keeps the speak threshold meaningful across regimes ("is this place worth
 * interrupting for, right now?"). All components are kept for explainability.
 */
import type {
  CandidateGeometry,
  DiscoveryQuery,
  GuideProfile,
  Id,
  JourneyContext,
  LatLng,
  PlaceCandidate,
  PlaceKind,
  ScoredCandidate,
  StoryAngle,
  SuppressionReason,
} from './contracts.js';
import { UTILITY_KINDS } from './contracts.js';
import { angleDiff, destinationPoint, haversineM, headingTrajectory, initialBearingDeg, polylineLengthM, projectOntoPolyline, remainingRoute } from './geo.js';
import { DENSITY_SIGNIFICANCE_FLOOR, densityProbeRadiusFor } from './density.js';
import { clamp01, lookAheadFor, policyFor, type RegimePolicy } from './policy.js';
import { clamp, cmpStr } from './util.js';

export const DISCOVERY = {
  /** Place counts as 'rejected' for this long after "not that one"/skip. */
  RECENT_REJECT_MS: 30 * 60 * 1000,
  /** Point features within this distance are 'here' (radial modes). */
  HERE_RADIUS_M: 40,
  /** Minimum speed used for ETA computations (avoid ∞ in stop-and-go). */
  MIN_ETA_SPEED_MPS: 1,
  /** How far off the route the traveller may be before we fall back to heading projection. */
  OFF_ROUTE_TOLERANCE_M: 250,
  /** Walking: forward cone half-angle for the long reach. */
  WALK_FORWARD_CONE_DEG: 60,
  /** Walking: fraction of long reach allowed outside the forward cone. */
  WALK_SIDE_REACH_FRACTION: 0.35,
  /** Score = sig × (SCORE_BASE + (1 − SCORE_BASE) × fit). */
  SCORE_BASE: 0.55,
  /** Timing plateau as multiples of the "ideal" lead (minLead + story length). */
  TIMING_PLATEAU_MULT: 3,
  /** Log-normal widths of the timing curve before/after the plateau. */
  TIMING_SIGMA_EARLY: 0.6,
  TIMING_SIGMA_LATE: 0.9,
  /** Weights of the context-fit components (sum = 1). */
  WEIGHTS: { timing: 0.45, novelty: 0.2, affinity: 0.15, visibility: 0.12, continuity: 0.08 },
} as const;

/**
 * How far off the road a feature can meaningfully be pointed out, by kind (m, at
 * significance 1; scaled by significance). Mountains and big water are visible from far.
 * Kind-based and global — never place-specific.
 */
export const VISUAL_REACH_M: Partial<Record<PlaceKind, number>> = {
  mountain: 30000,
  natural_feature: 6000,
  water: 4000,
  bridge: 1500,
  region: 0,
};

/** Administrative areas that, when enclosing a walker, are ambient context rather than a sight. */
export const ENCLOSING_KINDS: readonly PlaceKind[] = ['city', 'town', 'region'];

/** Tags too generic to create a "continuity" link between places. */
const GENERIC_TAGS = new Set(['landmark', 'tourism', 'attraction', 'poi', 'place', 'usa', 'united_states']);

/** Natural story angles per place kind (for guide affinity). */
export const KIND_ANGLES: Record<PlaceKind, StoryAngle[]> = {
  landmark: ['origin', 'hidden_detail', 'numbers', 'people'],
  building: ['architecture', 'numbers', 'people', 'origin'],
  museum: ['people', 'hidden_detail', 'architecture', 'origin'],
  monument: ['turning_point', 'people', 'origin'],
  memorial: ['turning_point', 'people', 'origin'],
  historic_site: ['origin', 'turning_point', 'people', 'everyday_life'],
  religious_site: ['origin', 'people', 'architecture', 'turning_point'],
  park: ['nature', 'everyday_life', 'origin', 'hidden_detail'],
  bridge: ['architecture', 'numbers', 'people', 'turning_point'],
  neighborhood: ['everyday_life', 'origin', 'people'],
  city: ['origin', 'everyday_life', 'turning_point', 'people'],
  town: ['origin', 'everyday_life', 'turning_point'],
  region: ['nature', 'origin', 'everyday_life'],
  natural_feature: ['nature', 'origin', 'numbers'],
  water: ['nature', 'origin', 'everyday_life'],
  mountain: ['nature', 'numbers', 'origin'],
  venue: ['people', 'everyday_life', 'origin'],
  food: ['everyday_life'],
  shop: ['everyday_life'],
  lodging: ['everyday_life'],
  fuel: ['everyday_life'],
  transit: ['architecture', 'everyday_life'],
  road_feature: ['origin', 'numbers', 'nature'],
  other: ['origin', 'hidden_detail'],
};

export type DiscoveryMode = 'radial' | 'corridor_route' | 'corridor_heading';

export interface Trajectory {
  mode: DiscoveryMode;
  /** Corridor polyline starting at (the projection of) the position; null in radial mode. */
  polyline: LatLng[] | null;
  courseDeg: number | null;
  speedMps: number;
}

export interface ScoreOptions {
  guide?: GuideProfile | null;
  /** Override for the rejection memory window. */
  recentRejectMs?: number;
  /** Precomputed trajectory (e.g. shared with discoveryQueryFor). */
  trajectory?: Trajectory;
}

export function isMovingRegime(r: JourneyContext['regime']['regime']): boolean {
  return r === 'cycling' || r === 'urban_driving' || r === 'highway_driving';
}

export function policyForContext(ctx: JourneyContext): RegimePolicy {
  return policyFor(ctx.regime.regime, ctx.density.density);
}

function courseOf(ctx: JourneyContext): number | null {
  if (ctx.regime.courseDeg !== null && ctx.regime.courseDeg !== undefined) return ctx.regime.courseDeg;
  const h = ctx.position?.headingDeg;
  return h !== null && h !== undefined && Number.isFinite(h) && h >= 0 ? h % 360 : null;
}

/** Decide radial vs corridor and build the corridor polyline. */
export function trajectoryFor(ctx: JourneyContext): Trajectory {
  const policy = policyForContext(ctx);
  const course = courseOf(ctx);
  const speed = ctx.regime.smoothedSpeedMps;
  const pos = ctx.position;
  // A stationary user's last course is stale (parked car, standing): no relative directions.
  if (!pos || !isMovingRegime(ctx.regime.regime)) return { mode: 'radial', polyline: null, courseDeg: ctx.regime.regime === 'stationary' ? null : course, speedMps: speed };
  const route = ctx.route?.polyline ?? null;
  if (route && route.length >= 2) {
    const p = projectOntoPolyline(pos, route);
    const onRoute = Math.abs(p.crossTrackM) <= policy.corridorHalfWidthM + DISCOVERY.OFF_ROUTE_TOLERANCE_M && p.alongTrackM <= polylineLengthM(route) + DISCOVERY.OFF_ROUTE_TOLERANCE_M;
    if (onRoute) {
      const rest = remainingRoute(pos, route);
      if (rest.length >= 2 && polylineLengthM(rest) > 1) return { mode: 'corridor_route', polyline: rest, courseDeg: course ?? initialBearingDeg(rest[0]!, rest[1]!), speedMps: speed };
    }
  }
  if (course === null) return { mode: 'radial', polyline: null, courseDeg: null, speedMps: speed };
  return {
    mode: 'corridor_heading',
    polyline: headingTrajectory(pos, course, policy.lookAheadMaxM + 1000, Math.max(500, Math.round(policy.lookAheadMaxM / 12))),
    courseDeg: course,
    speedMps: speed,
  };
}

/** Radial reach for a place in stationary/walking modes. */
function radialReach(policy: RegimePolicy, significance: number, forward: boolean): number {
  const s = clamp01(significance);
  const extra = Math.max(0, policy.lookAheadMaxM - policy.nearRadiusM) * s * s * s;
  return policy.nearRadiusM + extra * (forward ? 1 : DISCOVERY.WALK_SIDE_REACH_FRACTION);
}

function sideOf(crossM: number | null, relBearing: number | null, extentM: number): 'left' | 'right' | 'center' | null {
  if (crossM !== null) {
    const centerBand = Math.max(15, extentM);
    if (Math.abs(crossM) <= centerBand) return 'center';
    return crossM > 0 ? 'right' : 'left';
  }
  if (relBearing === null) return null;
  if (Math.abs(relBearing) <= 15 || Math.abs(relBearing) >= 165) return 'center';
  return relBearing > 0 ? 'right' : 'left';
}

export function geometryFor(ctx: JourneyContext, place: PlaceCandidate, traj: Trajectory): CandidateGeometry {
  const pos = ctx.position!;
  const distanceM = haversineM(pos, place.location);
  const bearingDeg = initialBearingDeg(pos, place.location);
  const relativeBearingDeg = traj.courseDeg === null ? null : angleDiff(traj.courseDeg, bearingDeg);
  const inside = distanceM <= Math.max(place.extentM, place.extentM > 0 ? 0 : DISCOVERY.HERE_RADIUS_M);
  const speed = Math.max(DISCOVERY.MIN_ETA_SPEED_MPS, traj.speedMps);

  if (traj.mode === 'radial' || !traj.polyline) {
    const moving = traj.speedMps >= 0.5;
    const relative = inside
      ? 'here'
      : relativeBearingDeg === null
        ? 'beside'
        : Math.abs(relativeBearingDeg) <= 60
          ? 'ahead'
          : Math.abs(relativeBearingDeg) >= 120
            ? 'behind'
            : 'beside';
    return {
      distanceM,
      bearingDeg,
      relativeBearingDeg,
      alongTrackM: null,
      crossTrackM: null,
      etaS: moving ? Math.max(0, distanceM - place.extentM) / Math.max(0.5, traj.speedMps) : null,
      relative,
      side: sideOf(null, relativeBearingDeg, 0),
    };
  }

  const p = projectOntoPolyline(place.location, traj.polyline);
  const along = p.alongTrackM;
  const cross = p.crossTrackM;
  const nearBand = Math.max(place.extentM, 60);
  const relative = inside ? 'here' : along < -nearBand ? 'behind' : along <= nearBand ? 'beside' : 'ahead';
  return {
    distanceM,
    bearingDeg,
    relativeBearingDeg,
    alongTrackM: along,
    crossTrackM: cross,
    // Closest approach of an areal feature is its edge (arrival), not its centre.
    etaS: Math.max(0, along - place.extentM) / speed,
    relative,
    side: sideOf(cross, relativeBearingDeg, place.extentM),
  };
}

/** Time (s) until the place is behind the traveller: (along + extent)/speed. Null in radial mode. */
export function etaToPassS(g: CandidateGeometry, place: PlaceCandidate, speedMps: number): number | null {
  if (g.alongTrackM === null) return null;
  return Math.max(0, g.alongTrackM + place.extentM) / Math.max(DISCOVERY.MIN_ETA_SPEED_MPS, speedMps);
}

function timingScore(etaS: number, idealS: number): number {
  if (idealS <= 0) return 1;
  const lo = idealS;
  const hi = idealS * DISCOVERY.TIMING_PLATEAU_MULT;
  if (etaS >= lo && etaS <= hi) return 1;
  const x = Math.max(etaS, 1);
  const sigma = x < lo ? DISCOVERY.TIMING_SIGMA_EARLY : DISCOVERY.TIMING_SIGMA_LATE;
  const ref = x < lo ? lo : hi;
  const l = Math.log(x / ref);
  return Math.exp(-(l * l) / (2 * sigma * sigma));
}

function affinityScore(kind: PlaceKind, guide: GuideProfile | null | undefined): number {
  if (!guide) return 0.6;
  const natural = KIND_ANGLES[kind];
  const pref = guide.narrative.preferredAngles;
  if (pref.slice(0, 2).some((a) => natural.includes(a))) return 1;
  if (pref.some((a) => natural.includes(a))) return 0.75;
  return 0.45;
}

function noveltyScore(place: PlaceCandidate, themes: Record<string, number>): number {
  let overlap = 0;
  for (const t of place.tags) overlap += Math.min(2, themes[t] ?? 0);
  overlap += Math.min(2, themes[`kind:${place.kind}`] ?? 0) * 0.5;
  return clamp(1 - 0.15 * overlap, 0.3, 1);
}

function continuityScore(place: PlaceCandidate, ctx: JourneyContext): number {
  const tags = new Set(place.tags.filter((t) => !GENERIC_TAGS.has(t)));
  if (tags.size === 0) return 0;
  for (const d of Object.values(ctx.memory.discussed)) {
    if (d.placeId === place.id) continue;
    if ((d.tags ?? []).some((t) => tags.has(t))) return 1;
  }
  return 0;
}

/** Places of `kinds` related by shared non-generic tags to earlier discussed places. */
export function sharedTags(a: readonly string[], b: readonly string[]): string[] {
  const s = new Set(b.filter((t) => !GENERIC_TAGS.has(t)));
  return a.filter((t) => s.has(t));
}

export function scoreCandidates(ctx: JourneyContext, candidates: readonly PlaceCandidate[], evidenceThin?: ReadonlySet<Id>, opts: ScoreOptions = {}): ScoredCandidate[] {
  if (!ctx.position) return [];
  const policy = policyForContext(ctx);
  const traj = opts.trajectory ?? trajectoryFor(ctx);
  const moving = traj.mode !== 'radial';
  const rejectMs = opts.recentRejectMs ?? DISCOVERY.RECENT_REJECT_MS;
  const storyS = policy.maxStoryS * (opts.guide?.narrative.verbosity ?? 1);
  const idealLeadS = policy.minLeadS + 0.8 * storyS;
  const seen = new Set<Id>();
  const out: ScoredCandidate[] = [];

  for (const place of candidates) {
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    const g = geometryFor(ctx, place, traj);
    const sup: SuppressionReason[] = [];
    const here = g.relative === 'here';
    const s = clamp01(place.significance);
    const visualReach = (VISUAL_REACH_M[place.kind] ?? 0) * s;
    const lateralReach = Math.max(place.extentM, visualReach);
    let reach: number;

    if (moving) {
      const along = g.alongTrackM!;
      const cross = Math.abs(g.crossTrackM!);
      reach = lookAheadFor(policy, s);
      if (!here && along + place.extentM < -policy.behindToleranceM) sup.push('behind');
      const halfWidth = policy.corridorHalfWidthM + policy.corridorWideningMPerKm * (Math.max(0, along) / 1000) + lateralReach;
      if (!here && cross > halfWidth) sup.push('off_course');
      if (!here && along - place.extentM > reach) sup.push('beyond_lookahead');
      if (!here && policy.minLeadS > 0 && (g.etaS ?? 0) < policy.minLeadS && !sup.includes('behind')) sup.push('too_close_to_pass');
    } else {
      const forward = g.relativeBearingDeg === null || Math.abs(g.relativeBearingDeg) <= DISCOVERY.WALK_FORWARD_CONE_DEG || ctx.regime.regime === 'stationary';
      reach = radialReach(policy, s, forward);
      if (!here && g.distanceM - place.extentM > reach) sup.push('beyond_lookahead');
      if (ENCLOSING_KINDS.includes(place.kind) && place.extentM > radialReach(policy, 1, true) && g.distanceM <= place.extentM) sup.push('enclosing_area');
    }
    if (s < policy.significanceFloor) sup.push('below_significance_floor');
    if (ctx.memory.discussed[place.id]) sup.push('already_discussed');
    const rej = ctx.memory.rejected[place.id];
    if (rej !== undefined && ctx.now - rej < rejectMs) sup.push('recently_rejected');
    if (UTILITY_KINDS.includes(place.kind)) sup.push('utility_kind');
    if (evidenceThin?.has(place.id)) sup.push('evidence_thin');

    // ── components
    let timing: number;
    let visibility: number;
    let early = 0;
    if (moving) {
      timing = here ? 0.9 : timingScore(g.etaS ?? 0, idealLeadS);
      if (!here && (g.etaS ?? 0) > idealLeadS * DISCOVERY.TIMING_PLATEAU_MULT) early = 1;
      const cross = Math.abs(g.crossTrackM ?? 0);
      const excess = Math.max(0, cross - lateralReach);
      visibility = here ? 1 : clamp(1 - excess / Math.max(1, policy.corridorHalfWidthM * 2), 0.3, 1);
    } else {
      const d = Math.max(0, g.distanceM - place.extentM);
      timing = here ? 1 : Math.exp(-d / Math.max(50, 0.6 * reach));
      const rb = g.relativeBearingDeg;
      visibility = rb === null ? 0.8 : clamp(0.65 + 0.35 * Math.cos((rb * Math.PI) / 180), 0.35, 1);
    }
    const novelty = noveltyScore(place, ctx.memory.themes);
    const affinity = affinityScore(place.kind, opts.guide);
    const continuity = continuityScore(place, ctx);
    const W = DISCOVERY.WEIGHTS;
    const fit = W.timing * timing + W.novelty * novelty + W.affinity * affinity + W.visibility * visibility + W.continuity * continuity;
    const score = s * (DISCOVERY.SCORE_BASE + (1 - DISCOVERY.SCORE_BASE) * fit);
    const etaPass = etaToPassS(g, place, traj.speedMps);
    out.push({
      place,
      geometry: g,
      eligible: sup.length === 0,
      suppressedBy: sup,
      score,
      components: {
        significance: s,
        timing,
        novelty,
        affinity,
        visibility,
        continuity,
        fit,
        reachM: Math.round(reach),
        early,
        ...(etaPass === null ? {} : { etaToPassS: Math.round(etaPass) }),
      },
    });
  }

  out.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible && b.score !== a.score) return b.score - a.score;
    return cmpStr(a.place.id, b.place.id);
  });
  return out;
}

/** The query a PlaceSource should answer for this context (superset of the corridor/radius). */
export function discoveryQueryFor(ctx: JourneyContext, traj: Trajectory = trajectoryFor(ctx)): DiscoveryQuery {
  const policy = policyForContext(ctx);
  const pos = ctx.position ?? { lat: 0, lng: 0 };
  if (traj.mode === 'radial' || !traj.polyline) {
    return {
      center: { lat: pos.lat, lng: pos.lng },
      radiusM: Math.round(Math.max(policy.nearRadiusM, policy.lookAheadMaxM)),
      corridor: null,
      minSignificance: policy.significanceFloor,
      kinds: null,
      locale: ctx.locale,
    };
  }
  const L = Math.min(polylineLengthM(traj.polyline), policy.lookAheadMaxM);
  const halfW = policy.corridorHalfWidthM + policy.corridorWideningMPerKm * (L / 1000);
  // centre: midpoint of the look-ahead window along the first bearing (a superset circle)
  const mid = pointAlong(traj.polyline, L / 2);
  const maxVisual = Math.max(0, ...Object.values(VISUAL_REACH_M).map((v) => v ?? 0));
  const radius = Math.round(L / 2 + halfW + maxVisual + policy.nearRadiusM);
  return {
    center: mid,
    radiusM: radius,
    corridor: clipPolyline(traj.polyline, L),
    minSignificance: policy.significanceFloor,
    kinds: null,
    locale: ctx.locale,
  };
}

/**
 * Local density probe query (small radius, low significance floor): the adapter answers
 * with everything notable nearby; `observedDensity` turns it into places/km².
 */
export function densityProbeQueryFor(ctx: JourneyContext): DiscoveryQuery {
  const pos = ctx.position ?? { lat: 0, lng: 0 };
  return { center: { lat: pos.lat, lng: pos.lng }, radiusM: densityProbeRadiusFor(ctx.regime.regime), corridor: null, minSignificance: DENSITY_SIGNIFICANCE_FLOOR, kinds: null, locale: ctx.locale };
}

function pointAlong(line: readonly LatLng[], distM: number): LatLng {
  let rem = distM;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = haversineM(a, b);
    if (rem <= d) return destinationPoint(a, initialBearingDeg(a, b), rem);
    rem -= d;
  }
  return line.at(-1)!;
}

function clipPolyline(line: readonly LatLng[], maxM: number): LatLng[] {
  const out: LatLng[] = [line[0]!];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = haversineM(line[i - 1]!, line[i]!);
    if (acc + d >= maxM) {
      out.push(pointAlong([line[i - 1]!, line[i]!], maxM - acc));
      return out;
    }
    acc += d;
    out.push(line[i]!);
  }
  return out;
}
