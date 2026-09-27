import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  destinationPoint,
  geohashDecode,
  geohashEncode,
  haversineM,
  headingTrajectory,
  initialBearingDeg,
  localProjection,
  polylineLengthM,
  projectOntoPolyline,
  remainingRoute,
} from '../src/index.js';

describe('geo', () => {
  it('haversine: 1° of latitude ≈ 111.195 km', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
  });

  it('haversine: known city-pair distance (Paris–London ≈ 343.5 km)', () => {
    const d = haversineM({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 });
    expect(d / 1000).toBeGreaterThan(342);
    expect(d / 1000).toBeLessThan(345);
  });

  it('initial bearing: cardinal directions', () => {
    expect(initialBearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 6);
    expect(initialBearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 6);
    expect(initialBearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 6);
  });

  it('destination point round-trips distance and bearing', () => {
    const s = { lat: 35, lng: -100 };
    for (const b of [0, 45, 133, 270, 359]) {
      const d = destinationPoint(s, b, 12_345);
      expect(haversineM(s, d)).toBeCloseTo(12_345, 0);
      expect(Math.abs(angleDiff(b, initialBearingDeg(s, d)))).toBeLessThan(0.1);
    }
  });

  it('angleDiff is signed and wraps', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 270)).toBe(180);
    expect(angleDiff(0, 0)).toBe(0);
  });

  it('local projection round-trips and scales', () => {
    const o = { lat: 40, lng: -74 };
    const p = localProjection(o);
    const q = destinationPoint(o, 90, 1000);
    const xy = p.toXY(q);
    expect(xy.x).toBeCloseTo(1000, -1);
    expect(Math.abs(xy.y)).toBeLessThan(1);
    const back = p.toLatLng(xy);
    expect(haversineM(back, q)).toBeLessThan(0.01);
  });

  it('polyline projection: signs of cross-track (right +, left −)', () => {
    const a = { lat: 0, lng: 0 };
    const b = destinationPoint(a, 0, 10_000); // heading north
    const line = [a, b];
    const right = destinationPoint(destinationPoint(a, 0, 4000), 90, 300);
    const left = destinationPoint(destinationPoint(a, 0, 4000), 270, 300);
    const pr = projectOntoPolyline(right, line);
    const pl = projectOntoPolyline(left, line);
    expect(pr.crossTrackM).toBeCloseTo(300, 0);
    expect(pl.crossTrackM).toBeCloseTo(-300, 0);
    expect(pr.alongTrackM).toBeCloseTo(4000, -1);
    expect(pr.segmentIndex).toBe(0);
  });

  it('polyline projection: behind start gives negative along-track; beyond end exceeds length', () => {
    const a = { lat: 0, lng: 0 };
    const line = [a, destinationPoint(a, 90, 5000)];
    expect(projectOntoPolyline(destinationPoint(a, 270, 700), line).alongTrackM).toBeCloseTo(-700, -1);
    expect(projectOntoPolyline(destinationPoint(a, 90, 6000), line).alongTrackM).toBeCloseTo(6000, -1);
  });

  it('polyline projection across a bend picks the right segment and cumulative distance', () => {
    const a = { lat: 0, lng: 0 };
    const b = destinationPoint(a, 0, 2000);
    const c = destinationPoint(b, 90, 3000);
    const p = destinationPoint(destinationPoint(b, 90, 1000), 180, 200); // south of 2nd leg = right of eastbound travel
    const pr = projectOntoPolyline(p, [a, b, c]);
    expect(pr.segmentIndex).toBe(1);
    expect(pr.alongTrackM).toBeCloseTo(3000, -1);
    expect(pr.crossTrackM).toBeCloseTo(200, 0);
  });

  it('polyline length and heading trajectory', () => {
    const s = { lat: 30, lng: 30 };
    const tr = headingTrajectory(s, 45, 20_000, 3000);
    expect(polylineLengthM(tr)).toBeCloseTo(20_000, -1);
    expect(tr[0]).toEqual(s);
    expect(angleDiff(45, initialBearingDeg(s, tr.at(-1)!))).toBeCloseTo(0, 1);
  });

  it('remainingRoute starts at the projection', () => {
    const a = { lat: 0, lng: 0 };
    const b = destinationPoint(a, 0, 5000);
    const pos = destinationPoint(destinationPoint(a, 0, 1000), 90, 20);
    const r = remainingRoute(pos, [a, b]);
    expect(polylineLengthM(r)).toBeCloseTo(4000, -1);
  });

  it('geohash: known value and precision', () => {
    // Canonical example from the geohash spec.
    expect(geohashEncode({ lat: 57.64911, lng: 10.40744 }, 11)).toBe('u4pruydqqvj');
    expect(geohashEncode({ lat: 57.64911, lng: 10.40744 }, 5)).toBe('u4pru');
    const c = geohashDecode('u4pru');
    expect(haversineM(c, { lat: 57.64911, lng: 10.40744 })).toBeLessThan(3500);
  });
});
