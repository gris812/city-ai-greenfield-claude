/**
 * Movement-regime tracker (DECISIONS D-006).
 *
 * Pure reducer: `updateRegime(prev, newFixes, now)` → next RegimeState. All rolling
 * state lives in `RegimeState.track` (JSON-safe), so the server can persist it in Redis.
 *
 * Pipeline per fix: validate → reject GPS jumps → speed sample (device speed when sane,
 * else derived from displacement over a baseline) → course sample → window stats
 * (smoothed speed, std-dev, turn rate, acceleration) → candidate regime (banded with
 * hysteresis relative to the *current* regime) → dwell timer → commit.
 *
 * The notable asymmetric rules:
 *  - A driving vehicle that stops (red light, queue) stays in its driving regime for up to
 *    STOP_AND_GO_HOLD_S — "stop-and-go memory". Only a longer stop becomes `stationary`.
 *  - Slow driving (2.5–7 m/s in traffic) never becomes `cycling` while in a driving regime.
 *  - Driving → walking requires WALK_AFTER_DRIVE_DWELL_S of sustained walking-speed
 *    movement with no sample above WALK_PEAK_MAX_MPS (i.e. parked and got out).
 *  - Highway entry needs > HIGHWAY_ENTER_MPS sustained HIGHWAY_ENTER_DWELL_S; exit needs
 *    < HIGHWAY_EXIT_MPS sustained HIGHWAY_EXIT_DWELL_S.
 */
import type { GeoFix, MovementRegime, Millis, RegimeSample, RegimeState, RegimeTrack } from './contracts.js';
import { DRIVING_REGIMES } from './contracts.js';
import { angleDiff, haversineM, initialBearingDeg } from './geo.js';
import { mean, slope, stdDev } from './util.js';

// ─────────────────────────────────────────────── named thresholds (m/s, s, m)

export const REGIME_THRESHOLDS = {
  /** Fixes worse than this are ignored for movement estimation. */
  MAX_ACCURACY_M: 100,
  /** Assumed accuracy when the device omits it. */
  DEFAULT_ACCURACY_M: 15,
  /** Anything faster is not a ground vehicle (≈ 324 km/h). */
  MAX_PLAUSIBLE_SPEED_MPS: 90,
  /** Implausible acceleration between consecutive fixes (beyond position uncertainty). */
  MAX_PLAUSIBLE_ACCEL_MPS2: 8,
  /** Slack added to the acceleration bound (m/s) for timing jitter. */
  ACCEL_SLACK_MPS: 6,
  /** After this many consecutive rejections we re-anchor on the new position (real relocation). */
  REANCHOR_AFTER_REJECTS: 5,
  /** A gap longer than this in fixes re-anchors the tracker (tunnel, app suspended). */
  REANCHOR_GAP_S: 60,

  /** Rolling window kept in the track. */
  TRACK_WINDOW_S: 60,
  /** Speed smoothing window (mean of samples). */
  SMOOTH_WINDOW_S: 5,
  /** Std-dev window for the variance profile. */
  VARIANCE_WINDOW_S: 30,
  /** Turn-rate and acceleration windows. */
  TURN_WINDOW_S: 4,
  ACCEL_WINDOW_S: 4,
  /**
   * Displacement-derived speed (when the device gives none) uses an adaptive baseline:
   * the most recent sample ≥ MIN_S old whose displacement exceeds DERIVED_DISPLACEMENT_ACC
   * × accuracy, else the oldest sample within MAX_S. Fast movement → short baseline (low
   * latency); jitter at rest → long baseline (noise averages out).
   */
  DERIVED_BASELINE_MIN_S: 4,
  DERIVED_BASELINE_MAX_S: 30,
  DERIVED_DISPLACEMENT_ACC: 2.5,
  /** Fraction of position accuracy subtracted from derived displacement (jitter floor). */
  DERIVED_NOISE_FRACTION: 0.3,
  /** Seconds of accepted history required before leaving `unknown`. */
  MIN_HISTORY_S: 6,
  /** Course is trusted from device heading / displacement only above this speed. */
  COURSE_MIN_SPEED_MPS: 1.5,
  /** Course from displacement needs at least this net displacement over the window. */
  COURSE_MIN_DISPLACEMENT_M: 12,
  /** Turn rate is only meaningful above this speed. */
  TURN_MIN_SPEED_MPS: 3,

  // bands
  STATIONARY_MAX_MPS: 0.5,
  /** Hysteresis: leave stationary only above this. */
  STATIONARY_EXIT_MPS: 0.6,
  /** Hysteresis: walking → stationary only below this. */
  WALK_TO_STATIONARY_MPS: 0.35,
  WALK_MAX_MPS: 2.5,
  /** Hysteresis: walking → faster only above this. */
  WALK_EXIT_HIGH_MPS: 2.9,
  CYCLE_MAX_MPS: 7,
  /** Cycling tolerated up to this while already cycling (downhill). */
  CYCLE_EXIT_HIGH_MPS: 8.5,
  /** Cycling → walking below this. */
  CYCLE_TO_WALK_MPS: 2.0,
  /** A cycling profile never peaks above this in the variance window… */
  CYCLE_PEAK_MAX_MPS: 9,
  /** …and never shows acceleration magnitudes above this (cars do, pulling away). */
  CYCLE_ACCEL_MAX_MPS2: 1.3,
  URBAN_MIN_MPS: 7,
  HIGHWAY_ENTER_MPS: 22,
  HIGHWAY_EXIT_MPS: 17,
  /** Driving → walking: no sample above this within WALK_PEAK_WINDOW_S. */
  WALK_PEAK_MAX_MPS: 2.6,
  WALK_PEAK_WINDOW_S: 15,

  // dwell (seconds a candidate must persist before commit)
  DWELL_FROM_UNKNOWN_S: 3,
  DWELL_STATIONARY_TO_WALK_S: 6,
  DWELL_WALK_TO_STATIONARY_S: 20,
  DWELL_TO_CYCLING_S: 20,
  DWELL_CYCLING_TO_SLOWER_S: 25,
  DWELL_TO_URBAN_S: 8,
  /** Re-entering driving shortly after a driving stop (parking-lot shuffle, long queue). */
  DWELL_TO_URBAN_RECENT_S: 3,
  RECENT_DRIVING_MEMORY_S: 600,
  HIGHWAY_ENTER_DWELL_S: 45,
  HIGHWAY_EXIT_DWELL_S: 60,
  /** Stop-and-go memory: a driving stop shorter than this is still driving. */
  STOP_AND_GO_HOLD_S: 120,
  WALK_AFTER_DRIVE_DWELL_S: 45,
  /** Minimum accepted samples before leaving `unknown`. */
  MIN_SAMPLES: 3,
} as const;

export type RegimeThresholds = { -readonly [K in keyof typeof REGIME_THRESHOLDS]: number };

export interface RegimeOptions {
  thresholds?: Partial<RegimeThresholds>;
}

export function isDriving(r: MovementRegime): boolean {
  return DRIVING_REGIMES.includes(r);
}

export function initialRegimeState(now: Millis): RegimeState {
  return {
    regime: 'unknown',
    since: now,
    pending: null,
    smoothedSpeedMps: 0,
    speedStdDevMps: 0,
    courseDeg: null,
    turnRateDegPerS: 0,
    accelMps2: 0,
    track: emptyTrack(),
  };
}

function emptyTrack(): RegimeTrack {
  return { samples: [], rejectStreak: 0, lastDrivingAt: null, rejectedTotal: 0 };
}

export function updateRegime(prev: RegimeState | null, fixes: readonly GeoFix[], now: Millis, opts: RegimeOptions = {}): RegimeState {
  const T: RegimeThresholds = { ...REGIME_THRESHOLDS, ...(opts.thresholds ?? {}) };
  let state: RegimeState = prev ? { ...prev, track: cloneTrack(prev.track ?? emptyTrack()) } : initialRegimeState(now);
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  for (const fix of sorted) {
    const track = state.track!;
    const accepted = acceptFix(track, fix, T);
    if (!accepted) continue;
    state = computeStats(state, fix.t, T);
    state = classify(state, fix.t, T);
  }
  // Evaluate dwell against `now` too (fixes may be sparse); stats unchanged.
  const lastT = state.track!.samples.at(-1)?.t ?? null;
  if (lastT !== null && now > lastT) state = classify(state, now, T);
  return state;
}

function cloneTrack(t: RegimeTrack): RegimeTrack {
  return { samples: t.samples.slice(), rejectStreak: t.rejectStreak, lastDrivingAt: t.lastDrivingAt, rejectedTotal: t.rejectedTotal };
}

function saneDeviceSpeed(v: number | null | undefined, T: RegimeThresholds): number | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0 || v > T.MAX_PLAUSIBLE_SPEED_MPS) return null;
  return v;
}

/** Validate, jump-reject and append a fix to the track. Returns false when rejected. */
function acceptFix(track: RegimeTrack, fix: GeoFix, T: RegimeThresholds): boolean {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) return false;
  const acc = fix.accuracyM ?? T.DEFAULT_ACCURACY_M;
  if (!(acc >= 0) || acc > T.MAX_ACCURACY_M) return false;
  const samples = track.samples;
  const last = samples.at(-1);
  const deviceV = saneDeviceSpeed(fix.speedMps, T);

  if (last) {
    const dt = (fix.t - last.t) / 1000;
    if (dt <= 0) return false; // duplicate / out of order
    const dist = haversineM(last, fix);
    if (dt > T.REANCHOR_GAP_S) {
      samples.length = 0; // stale window; re-anchor
    } else {
      const excess = Math.max(0, dist - (acc + last.accuracyM));
      const impliedV = excess / dt;
      const maxV = Math.min(T.MAX_PLAUSIBLE_SPEED_MPS, Math.max(last.v, deviceV ?? 0) + T.MAX_PLAUSIBLE_ACCEL_MPS2 * dt + T.ACCEL_SLACK_MPS);
      if (impliedV > maxV) {
        track.rejectStreak += 1;
        track.rejectedTotal += 1;
        if (track.rejectStreak < T.REANCHOR_AFTER_REJECTS) return false;
        samples.length = 0; // persistent disagreement → the old anchor was wrong
      }
    }
  }
  track.rejectStreak = 0;

  // speed sample
  let v: number;
  if (deviceV !== null) v = deviceV;
  else v = derivedSpeed(samples, fix, acc, T);

  // course sample
  let course: number | null = null;
  if (v >= T.COURSE_MIN_SPEED_MPS && fix.headingDeg !== null && fix.headingDeg !== undefined && Number.isFinite(fix.headingDeg) && fix.headingDeg >= 0) {
    course = fix.headingDeg % 360;
  } else if (last && v >= T.COURSE_MIN_SPEED_MPS) {
    const d = haversineM(last, fix);
    if (d >= Math.max(3, 0.5 * acc)) course = initialBearingDeg(last, fix);
  }

  samples.push({ t: fix.t, lat: fix.lat, lng: fix.lng, v, accuracyM: acc, courseDeg: course });
  const cutoff = fix.t - T.TRACK_WINDOW_S * 1000;
  while (samples.length > 0 && samples[0]!.t < cutoff) samples.shift();
  return true;
}

/** Displacement-derived speed with an adaptive, noise-aware baseline. */
function derivedSpeed(samples: RegimeSample[], fix: GeoFix, acc: number, T: RegimeThresholds): number {
  let base: RegimeSample | null = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    const dt = (fix.t - s.t) / 1000;
    if (dt < T.DERIVED_BASELINE_MIN_S) continue;
    if (dt > T.DERIVED_BASELINE_MAX_S) break;
    if (haversineM(s, fix) >= T.DERIVED_DISPLACEMENT_ACC * Math.max(acc, s.accuracyM)) {
      base = s;
      break;
    }
  }
  const significant = base !== null;
  if (!base) {
    const cutoff = fix.t - T.DERIVED_BASELINE_MAX_S * 1000;
    base = samples.find((s) => s.t >= cutoff) ?? null;
  }
  if (!base) return 0;
  const dt = (fix.t - base.t) / 1000;
  if (dt < T.DERIVED_BASELINE_MIN_S) return 0;
  // Insignificant displacement: subtract a full accuracy radius (jitter at rest ≈ 0 m/s).
  const floor = (significant ? T.DERIVED_NOISE_FRACTION : 1) * Math.max(acc, base.accuracyM);
  return Math.min(T.MAX_PLAUSIBLE_SPEED_MPS, Math.max(0, haversineM(base, fix) - floor) / dt);
}

function within(samples: RegimeSample[], t: Millis, windowS: number): RegimeSample[] {
  const cutoff = t - windowS * 1000;
  return samples.filter((s) => s.t >= cutoff);
}

function computeStats(state: RegimeState, t: Millis, T: RegimeThresholds): RegimeState {
  const samples = state.track!.samples;
  const smoothWin = within(samples, t, T.SMOOTH_WINDOW_S);
  const smoothed = mean(smoothWin.map((s) => s.v));
  const varWin = within(samples, t, T.VARIANCE_WINDOW_S);
  const sd = stdDev(varWin.map((s) => s.v));

  // course: displacement over the smoothing window when it is long enough; else latest sample course; else hold.
  let course = state.courseDeg;
  const courseWin = within(samples, t, Math.max(T.SMOOTH_WINDOW_S, 8));
  const first = courseWin[0];
  const lastS = courseWin.at(-1);
  const latestWithCourse = [...smoothWin].reverse().find((s) => s.courseDeg !== null);
  if (smoothed >= T.COURSE_MIN_SPEED_MPS && latestWithCourse) {
    course = latestWithCourse.courseDeg;
  } else if (first && lastS && first !== lastS && haversineM(first, lastS) >= Math.max(T.COURSE_MIN_DISPLACEMENT_M, 1.5 * lastS.accuracyM) && smoothed >= T.STATIONARY_MAX_MPS) {
    course = initialBearingDeg(first, lastS);
  }

  // turn rate from per-sample courses in the turn window
  let turnRate = 0;
  if (smoothed >= T.TURN_MIN_SPEED_MPS) {
    const tw = within(samples, t, T.TURN_WINDOW_S).filter((s) => s.courseDeg !== null && s.v >= T.TURN_MIN_SPEED_MPS);
    if (tw.length >= 2) {
      let total = 0;
      for (let i = 1; i < tw.length; i++) total += angleDiff(tw[i - 1]!.courseDeg!, tw[i]!.courseDeg!);
      const dt = (tw.at(-1)!.t - tw[0]!.t) / 1000;
      if (dt > 0) turnRate = Math.abs(total) / dt;
    }
  }

  const aw = within(samples, t, T.ACCEL_WINDOW_S);
  const accel = aw.length >= 2 ? slope(aw.map((s) => (s.t - aw[0]!.t) / 1000), aw.map((s) => s.v)) : 0;

  return { ...state, smoothedSpeedMps: smoothed, speedStdDevMps: sd, courseDeg: course, turnRateDegPerS: turnRate, accelMps2: accel };
}

/** Candidate regime given the current one (hysteresis bands). */
function candidateRegime(state: RegimeState, t: Millis, T: RegimeThresholds): MovementRegime {
  const cur = state.regime;
  const v = state.smoothedSpeedMps;
  const samples = state.track!.samples;
  if (samples.length < T.MIN_SAMPLES) return cur;
  if (cur === 'unknown' && (t - samples[0]!.t) / 1000 < T.MIN_HISTORY_S) return cur;

  const varWin = within(samples, t, T.VARIANCE_WINDOW_S);
  const peak = Math.max(...varWin.map((s) => s.v));
  const cycleProfile = peak <= T.CYCLE_PEAK_MAX_MPS && Math.abs(state.accelMps2) <= T.CYCLE_ACCEL_MAX_MPS2;

  /** Classification from rest/walking into a moving regime. */
  const fresh = (): MovementRegime => {
    if (v < T.STATIONARY_MAX_MPS) return 'stationary';
    if (v <= T.WALK_MAX_MPS) return 'walking';
    if (v <= T.CYCLE_MAX_MPS) return cycleProfile && !recentlyDriving(state, t, T) ? 'cycling' : 'urban_driving';
    return 'urban_driving';
  };

  switch (cur) {
    case 'unknown':
      return fresh();
    case 'stationary':
      return v < T.STATIONARY_EXIT_MPS ? 'stationary' : fresh();
    case 'walking':
      if (v < T.WALK_TO_STATIONARY_MPS) return 'stationary';
      if (v <= T.WALK_EXIT_HIGH_MPS) return 'walking';
      return fresh();
    case 'cycling':
      if (v < T.WALK_TO_STATIONARY_MPS) return 'stationary';
      if (v < T.CYCLE_TO_WALK_MPS) return 'walking';
      if (v <= T.CYCLE_EXIT_HIGH_MPS && peak <= T.CYCLE_PEAK_MAX_MPS + 1) return 'cycling';
      return 'urban_driving';
    case 'urban_driving':
    case 'highway_driving': {
      if (v < T.STATIONARY_MAX_MPS) return 'stationary'; // dwell = stop-and-go hold
      if (v <= T.WALK_MAX_MPS) {
        const recentPeak = Math.max(...within(samples, t, T.WALK_PEAK_WINDOW_S).map((s) => s.v));
        if (recentPeak <= T.WALK_PEAK_MAX_MPS) return 'walking';
        return cur;
      }
      if (cur === 'highway_driving') return v >= T.HIGHWAY_EXIT_MPS ? 'highway_driving' : 'urban_driving';
      return v > T.HIGHWAY_ENTER_MPS ? 'highway_driving' : 'urban_driving';
    }
  }
}

function recentlyDriving(state: RegimeState, t: Millis, T: RegimeThresholds): boolean {
  const last = state.track?.lastDrivingAt ?? null;
  return last !== null && t - last <= T.RECENT_DRIVING_MEMORY_S * 1000;
}

function dwellFor(from: MovementRegime, to: MovementRegime, state: RegimeState, t: Millis, T: RegimeThresholds): number {
  if (from === 'unknown') return to === 'highway_driving' ? T.HIGHWAY_ENTER_DWELL_S : to === 'cycling' ? T.DWELL_TO_CYCLING_S : T.DWELL_FROM_UNKNOWN_S;
  if (to === 'highway_driving') return T.HIGHWAY_ENTER_DWELL_S;
  if (from === 'highway_driving' && to === 'urban_driving') return T.HIGHWAY_EXIT_DWELL_S;
  if (isDriving(from) && to === 'stationary') return T.STOP_AND_GO_HOLD_S;
  if (isDriving(from) && to === 'walking') return T.WALK_AFTER_DRIVE_DWELL_S;
  if (to === 'urban_driving') return recentlyDriving(state, t, T) ? T.DWELL_TO_URBAN_RECENT_S : T.DWELL_TO_URBAN_S;
  if (to === 'cycling') return T.DWELL_TO_CYCLING_S;
  if (from === 'cycling') return T.DWELL_CYCLING_TO_SLOWER_S;
  if (from === 'stationary' && to === 'walking') return T.DWELL_STATIONARY_TO_WALK_S;
  if (from === 'walking' && to === 'stationary') return T.DWELL_WALK_TO_STATIONARY_S;
  return T.DWELL_FROM_UNKNOWN_S;
}

function classify(state: RegimeState, t: Millis, T: RegimeThresholds): RegimeState {
  const track = state.track!;
  const cand = candidateRegime(state, t, T);
  let next: RegimeState;
  if (cand === state.regime) {
    next = { ...state, pending: null };
  } else if (state.pending && state.pending.regime === cand) {
    const dwellS = dwellFor(state.regime, cand, state, t, T);
    if ((t - state.pending.since) / 1000 >= dwellS) next = { ...state, regime: cand, since: t, pending: null };
    else next = state;
  } else {
    // Special case: urban → highway while a highway candidate was pending from an urban
    // state is handled by the generic path; a new candidate restarts the dwell clock.
    const dwellS = dwellFor(state.regime, cand, state, t, T);
    next = dwellS <= 0 ? { ...state, regime: cand, since: t, pending: null } : { ...state, pending: { regime: cand, since: t } };
  }
  if (isDriving(next.regime)) track.lastDrivingAt = t;
  return next;
}
