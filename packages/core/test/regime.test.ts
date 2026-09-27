import { describe, expect, it } from 'vitest';
import type { GeoFix, MovementRegime, RegimeState } from '../src/index.js';
import { destinationPoint, updateRegime, REGIME_THRESHOLDS } from '../src/index.js';
import { ORIGIN, synthTrace, type Leg } from './helpers.js';

/** Feed fixes one by one (as 1 Hz frames) and record the regime after each. */
function run(fixes: GeoFix[], prev: RegimeState | null = null): { state: RegimeState; timeline: Array<{ t: number; r: MovementRegime }> } {
  let s = prev;
  const timeline: Array<{ t: number; r: MovementRegime }> = [];
  for (const f of fixes) {
    s = updateRegime(s, [f], f.t);
    timeline.push({ t: f.t, r: s.regime });
  }
  return { state: s!, timeline };
}

function sequence(timeline: Array<{ r: MovementRegime }>): MovementRegime[] {
  const out: MovementRegime[] = [];
  for (const x of timeline) if (out.at(-1) !== x.r) out.push(x.r);
  return out;
}

describe('regime classification', () => {
  it('walking trace → walking (derived speed, noisy positions)', () => {
    const fixes = synthTrace([{ durationS: 180, fromMps: 1.4 }], { start: ORIGIN, bearingDeg: 30, noiseM: 3, deviceSpeed: false, seed: 1 });
    const { state, timeline } = run(fixes);
    expect(state.regime).toBe('walking');
    expect(sequence(timeline).filter((r) => r !== 'unknown')[0]).toBe('walking');
    expect(state.smoothedSpeedMps).toBeGreaterThan(0.9);
    expect(state.smoothedSpeedMps).toBeLessThan(2.0);
    expect(state.courseDeg).not.toBeNull();
    expect(Math.abs(((state.courseDeg! - 30 + 540) % 360) - 180)).toBeLessThan(25);
  });

  it('standing still with GPS jitter → stationary (never walking)', () => {
    const fixes = synthTrace([{ durationS: 300, fromMps: 0 }], { start: ORIGIN, bearingDeg: 0, noiseM: 4, deviceSpeed: false, seed: 3 });
    const { timeline } = run(fixes);
    const after = timeline.slice(10).map((x) => x.r);
    expect(after.every((r) => r === 'stationary')).toBe(true);
  });

  it('cycling trace (steady 5 m/s, gentle variance) → cycling', () => {
    const legs: Leg[] = [];
    for (let i = 0; i < 12; i++) legs.push({ durationS: 15, fromMps: 4.6 + (i % 3) * 0.3, toMps: 4.9 + ((i + 1) % 3) * 0.3 });
    const fixes = synthTrace(legs, { start: ORIGIN, bearingDeg: 90, speedNoise: 0.2, seed: 5 });
    const { state } = run(fixes);
    expect(state.regime).toBe('cycling');
  });

  it('city drive with red lights never flips to stationary or walking', () => {
    const legs: Leg[] = [];
    for (let block = 0; block < 6; block++) {
      legs.push({ durationS: 8, fromMps: 0, toMps: 12 }); // pull away (1.5 m/s²)
      legs.push({ durationS: 30, fromMps: 12 });
      legs.push({ durationS: 6, fromMps: 12, toMps: 0 }); // brake 2 m/s²
      legs.push({ durationS: block % 2 === 0 ? 60 : 90, fromMps: 0 }); // red light ≤ 90 s
    }
    const fixes = synthTrace([{ durationS: 5, fromMps: 0, toMps: 10 }, { durationS: 30, fromMps: 10 }, ...legs], { start: ORIGIN, bearingDeg: 0, speedNoise: 0.3, noiseM: 2, seed: 7 });
    const { timeline } = run(fixes);
    const seq = sequence(timeline).filter((r) => r !== 'unknown');
    expect(seq).toEqual(['urban_driving']);
  });

  it('slow stop-and-go traffic (3–6 m/s) stays urban_driving, not cycling', () => {
    const legs: Leg[] = [{ durationS: 40, fromMps: 13 }];
    for (let i = 0; i < 10; i++) legs.push({ durationS: 10, fromMps: 3, toMps: 6 }, { durationS: 10, fromMps: 6, toMps: 3 });
    const fixes = synthTrace(legs, { start: ORIGIN, bearingDeg: 0, speedNoise: 0.3, seed: 8 });
    const { timeline } = run(fixes);
    const seq = sequence(timeline).filter((r) => r !== 'unknown');
    expect(seq).toEqual(['urban_driving']);
  });

  it('highway requires sustained > 22 m/s for 45 s; brief bursts do not enter', () => {
    const burst = synthTrace([{ durationS: 30, fromMps: 15 }, { durationS: 30, fromMps: 25 }, { durationS: 60, fromMps: 15 }], { start: ORIGIN, bearingDeg: 0, seed: 9 });
    expect(sequence(run(burst).timeline)).not.toContain('highway_driving');

    const sustained = synthTrace([{ durationS: 30, fromMps: 15 }, { durationS: 20, fromMps: 15, toMps: 30 }, { durationS: 300, fromMps: 30 }], { start: ORIGIN, bearingDeg: 0, speedNoise: 0.5, seed: 10 });
    const { timeline, state } = run(sustained);
    expect(state.regime).toBe('highway_driving');
    const entry = timeline.find((x) => x.r === 'highway_driving')!;
    const firstFast = sustained.find((f) => (f.speedMps ?? 0) > 22.5)!;
    expect((entry.t - firstFast.t) / 1000).toBeGreaterThanOrEqual(REGIME_THRESHOLDS.HIGHWAY_ENTER_DWELL_S - 3);
  });

  it('highway slowdown to 19 m/s (above exit threshold) stays highway; exit needs < 17 m/s for 60 s', () => {
    const fixes = synthTrace(
      [
        { durationS: 20, fromMps: 10, toMps: 30 },
        { durationS: 200, fromMps: 30 },
        { durationS: 10, fromMps: 30, toMps: 19 },
        { durationS: 120, fromMps: 19 }, // construction zone
        { durationS: 10, fromMps: 19, toMps: 30 },
        { durationS: 60, fromMps: 30 },
        { durationS: 10, fromMps: 30, toMps: 14 },
        { durationS: 40, fromMps: 14 }, // < 60 s → still highway
        { durationS: 10, fromMps: 14, toMps: 30 },
        { durationS: 60, fromMps: 30 },
      ],
      { start: ORIGIN, bearingDeg: 0, speedNoise: 0.4, seed: 11 },
    );
    const seq = sequence(run(fixes).timeline).filter((r) => r !== 'unknown');
    expect(seq).toEqual(['urban_driving', 'highway_driving']);
  });

  it('chain: highway → exit → urban → parked → walking, via dwell/hysteresis', () => {
    const drive = synthTrace(
      [
        { durationS: 20, fromMps: 5, toMps: 30 },
        { durationS: 300, fromMps: 30 }, // highway
        { durationS: 20, fromMps: 30, toMps: 13 },
        { durationS: 120, fromMps: 13 }, // exit ramp + arterial
        { durationS: 6, fromMps: 13, toMps: 0 },
        { durationS: 45, fromMps: 0 }, // red light
        { durationS: 8, fromMps: 0, toMps: 11 },
        { durationS: 60, fromMps: 11 },
        { durationS: 8, fromMps: 11, toMps: 0 },
        { durationS: 150, fromMps: 0 }, // parked (> stop-and-go hold)
        { durationS: 3, fromMps: 0, toMps: 1.3 },
        { durationS: 180, fromMps: 1.3 }, // walking away
      ],
      { start: ORIGIN, bearingDeg: 45, speedNoise: 0.2, noiseM: 2, seed: 12 },
    );
    const { timeline } = run(drive);
    const seq = sequence(timeline).filter((r) => r !== 'unknown');
    expect(seq).toEqual(['urban_driving', 'highway_driving', 'urban_driving', 'stationary', 'walking']);
    // red light (45 s) did not produce stationary: exactly one stationary in the sequence
    expect(seq.filter((r) => r === 'stationary')).toHaveLength(1);
  });

  it('driving → brief creeping at walking speed (parking lot) does not become walking', () => {
    const fixes = synthTrace(
      [
        { durationS: 10, fromMps: 0, toMps: 12 },
        { durationS: 60, fromMps: 12 },
        { durationS: 5, fromMps: 12, toMps: 2 },
        { durationS: 25, fromMps: 2 }, // creep < 45 s
        { durationS: 5, fromMps: 2, toMps: 10 },
        { durationS: 30, fromMps: 10 },
      ],
      { start: ORIGIN, bearingDeg: 0, seed: 13 },
    );
    const seq = sequence(run(fixes).timeline).filter((r) => r !== 'unknown');
    expect(seq).toEqual(['urban_driving']);
  });

  it('GPS jump rejection: a 2 km teleport for 2 fixes does not change regime or speed', () => {
    const fixes = synthTrace([{ durationS: 120, fromMps: 1.4 }], { start: ORIGIN, bearingDeg: 0, noiseM: 2, seed: 14, deviceSpeed: false });
    const jumped = fixes.map((f, i) => (i === 60 || i === 61 ? { ...f, ...destinationPoint(f, 90, 2000) } : f));
    const { state, timeline } = run(jumped);
    expect(state.regime).toBe('walking');
    expect(timeline.slice(20).every((x) => x.r === 'walking')).toBe(true);
    expect(state.track!.rejectedTotal).toBe(2);
    expect(state.smoothedSpeedMps).toBeLessThan(2.5);
  });

  it('persistent relocation (>= 5 consecutive) re-anchors instead of rejecting forever', () => {
    const a = synthTrace([{ durationS: 30, fromMps: 1.4 }], { start: ORIGIN, bearingDeg: 0, seed: 15, deviceSpeed: false });
    const bStart = destinationPoint(ORIGIN, 90, 5000);
    const b = synthTrace([{ durationS: 60, fromMps: 1.4 }], { start: bStart, bearingDeg: 0, seed: 16, deviceSpeed: false, t0: a.at(-1)!.t + 1000 });
    const { state } = run([...a, ...b]);
    expect(state.track!.samples.at(-1)!.lat).toBeCloseTo(b.at(-1)!.lat, 6);
    expect(state.regime).toBe('walking');
  });

  it('inaccurate fixes (> 100 m) are ignored', () => {
    const fixes = synthTrace([{ durationS: 60, fromMps: 1.4 }], { start: ORIGIN, bearingDeg: 0, seed: 17 });
    const bad = fixes.map((f, i) => (i % 2 ? { ...f, accuracyM: 500 } : f));
    const { state } = run(bad);
    expect(state.track!.samples.every((s) => s.accuracyM <= 100)).toBe(true);
  });

  it('turn rate and braking are measured', () => {
    const fixes = synthTrace(
      [
        { durationS: 40, fromMps: 12 },
        { durationS: 5, fromMps: 12, turnDegPerS: 18 },
      ],
      { start: ORIGIN, bearingDeg: 0, seed: 18 },
    );
    const { state } = run(fixes);
    expect(state.turnRateDegPerS).toBeGreaterThan(12);
    const brake = synthTrace([{ durationS: 40, fromMps: 15 }, { durationS: 4, fromMps: 15, toMps: 3 }], { start: ORIGIN, bearingDeg: 0, seed: 19 });
    expect(run(brake).state.accelMps2).toBeLessThan(-2.5);
  });

  it('is deterministic and batch-equivalent (one frame of many fixes = many frames)', () => {
    const fixes = synthTrace([{ durationS: 90, fromMps: 1.4 }, { durationS: 60, fromMps: 0 }], { start: ORIGIN, bearingDeg: 10, seed: 20, noiseM: 2 });
    const a = run(fixes).state;
    const b = updateRegime(null, fixes, fixes.at(-1)!.t);
    expect(b.regime).toBe(a.regime);
    expect(b.smoothedSpeedMps).toBeCloseTo(a.smoothedSpeedMps, 9);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b); // JSON-safe
  });
});
