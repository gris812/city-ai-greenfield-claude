/** Synthetic, deterministic test inputs (no fixtures, no city data). */
import type { GeoFix, GuideProfile, JourneyContext, LatLng, PlaceCandidate, PlaceKind, RegimeState } from '../src/index.js';
import { destinationPoint, emptyMemory, initialDensityState, normBearing } from '../src/index.js';

/** Mulberry32 PRNG — deterministic noise for tests. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Leg {
  durationS: number;
  /** Speed at leg start → end (linear ramp). */
  fromMps: number;
  toMps?: number;
  /** Constant turn rate during the leg (deg/s). */
  turnDegPerS?: number;
}

export interface TraceOpts {
  start: LatLng;
  bearingDeg: number;
  t0?: number;
  hz?: number;
  /** Position noise σ (m). */
  noiseM?: number;
  /** Speed noise σ (m/s) added to device speed. */
  speedNoise?: number;
  /** Report device speed/heading (else null → derived). */
  deviceSpeed?: boolean;
  accuracyM?: number;
  seed?: number;
}

/** Integrate legs into fixes. Returns fixes + final state. */
export function synthTrace(legs: Leg[], o: TraceOpts): GeoFix[] {
  const hz = o.hz ?? 1;
  const dt = 1 / hz;
  const rnd = prng(o.seed ?? 42);
  const gauss = () => {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let pos = { ...o.start };
  let brg = o.bearingDeg;
  let t = o.t0 ?? 1_700_000_000_000;
  const out: GeoFix[] = [];
  const push = (v: number) => {
    const n = o.noiseM ?? 0;
    const p = n > 0 ? destinationPoint(pos, rnd() * 360, Math.abs(gauss()) * n) : pos;
    const sp = o.deviceSpeed === false ? null : Math.max(0, v + (o.speedNoise ?? 0) * gauss());
    out.push({ t, lat: p.lat, lng: p.lng, accuracyM: o.accuracyM ?? 8, speedMps: sp, headingDeg: o.deviceSpeed === false || v < 1 ? null : brg, source: 'simulated' });
  };
  push(legs[0]?.fromMps ?? 0);
  for (const leg of legs) {
    const steps = Math.round(leg.durationS * hz);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const v = leg.fromMps + ((leg.toMps ?? leg.fromMps) - leg.fromMps) * f;
      brg = normBearing(brg + (leg.turnDegPerS ?? 0) * dt);
      pos = destinationPoint(pos, brg, v * dt);
      t += dt * 1000;
      push(v);
    }
  }
  return out;
}

export function baseRegime(regime: RegimeState['regime'], speed: number, course: number | null, since = 0): RegimeState {
  return { regime, since, pending: null, smoothedSpeedMps: speed, speedStdDevMps: 0, courseDeg: course, turnRateDegPerS: 0, accelMps2: 0, track: null };
}

export function makeCtx(p: {
  position: LatLng | null;
  regime: RegimeState['regime'];
  speed?: number;
  course?: number | null;
  now?: number;
  density?: JourneyContext['density']['density'];
  route?: LatLng[] | null;
  regimeSince?: number;
  lastSpeechEndedAt?: number | null;
  locale?: string;
}): JourneyContext {
  const now = p.now ?? 10_000_000;
  const driving = p.regime === 'urban_driving' || p.regime === 'highway_driving';
  return {
    sessionId: 's1',
    now,
    position: p.position ? { ...p.position, t: now, source: 'simulated', speedMps: p.speed ?? 0, headingDeg: p.course ?? null, accuracyM: 5 } : null,
    regime: baseRegime(p.regime, p.speed ?? 0, p.course ?? null, p.regimeSince ?? 0),
    density: initialDensityState(0, p.density ?? 'urban'),
    route: p.route ? { polyline: p.route, source: 'replay' } : null,
    memory: emptyMemory(),
    activeStory: null,
    guideId: 'g1',
    locale: p.locale ?? 'en',
    lastSpeechEndedAt: p.lastSpeechEndedAt ?? null,
    sessionStartedAt: 0,
    safety: { driveSafe: driving, maneuvering: false, speechHoldReasons: [] },
    audioRoute: 'unknown',
    simulated: true,
  };
}

export function place(id: string, kind: PlaceKind, location: LatLng, significance: number, extra: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return { id, name: extra.name ?? id, kind, location, extentM: 0, significance, tags: [], externalRefs: {}, sources: [], ...extra };
}

/** Point at (along, cross) metres relative to origin/bearing (+cross = right). */
export function offset(origin: LatLng, bearing: number, alongM: number, crossM: number): LatLng {
  const a = alongM === 0 ? origin : destinationPoint(origin, alongM >= 0 ? bearing : bearing + 180, Math.abs(alongM));
  return crossM === 0 ? a : destinationPoint(a, crossM > 0 ? bearing + 90 : bearing - 90, Math.abs(crossM));
}

export const GUIDE: GuideProfile = {
  id: 'g1',
  name: 'Test Guide',
  tagline: 't',
  personality: 'p',
  narrative: { preferredAngles: ['origin', 'people', 'architecture'], verbosity: 1, humor: 0.2, useJourneyCallbacks: true, openingStyle: 'direct', signoffStyle: 'brief' },
  voice: { description: 'd', byProvider: { fake: 'v1' }, speakingRate: 1 },
  visual: { accent: '#000', portrait: '', avatar: '' },
};

/** A neutral synthetic origin in open ocean — deliberately not any real place. */
export const ORIGIN: LatLng = { lat: 10, lng: -140 };
