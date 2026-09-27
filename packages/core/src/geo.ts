/**
 * Pure geodesy helpers. Spherical Earth (R = 6 371 008.8 m, IUGG mean radius) —
 * errors < 0.5 % which is far below GPS/POI-location noise for our purposes.
 */
import type { LatLng } from './contracts.js';

export const EARTH_RADIUS_M = 6_371_008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function toRad(d: number): number {
  return d * D2R;
}
export function toDeg(r: number): number {
  return r * R2D;
}

/** Normalize to [0, 360). */
export function normBearing(d: number): number {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}

/** Signed smallest difference b − a in (−180, 180]. Positive = b is clockwise (right) of a. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Great-circle distance (haversine), metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const dφ = (b.lat - a.lat) * D2R;
  const dλ = (b.lng - a.lng) * D2R;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing a → b, degrees [0,360). */
export function initialBearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const dλ = (b.lng - a.lng) * D2R;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normBearing(Math.atan2(y, x) * R2D);
}

/** Destination point from `start` travelling `distanceM` on initial bearing `bearingDeg`. */
export function destinationPoint(start: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = bearingDeg * D2R;
  const φ1 = start.lat * D2R;
  const λ1 = start.lng * D2R;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: φ2 * R2D, lng: ((λ2 * R2D + 540) % 360) - 180 };
}

// ─────────────────────────────────────────────── local projection

export interface XY {
  /** metres east */
  x: number;
  /** metres north */
  y: number;
}

/**
 * Equirectangular projection around `origin`. Accurate to well under 1 % within
 * ~100 km of the origin at mid latitudes — sufficient for corridor geometry.
 */
export interface LocalProjection {
  origin: LatLng;
  toXY(p: LatLng): XY;
  toLatLng(p: XY): LatLng;
}

export function localProjection(origin: LatLng): LocalProjection {
  const kx = Math.cos(origin.lat * D2R) * EARTH_RADIUS_M * D2R;
  const ky = EARTH_RADIUS_M * D2R;
  return {
    origin,
    toXY: (p) => {
      let dLng = p.lng - origin.lng;
      if (dLng > 180) dLng -= 360;
      if (dLng < -180) dLng += 360;
      return { x: dLng * kx, y: (p.lat - origin.lat) * ky };
    },
    toLatLng: (p) => ({ lat: origin.lat + p.y / ky, lng: origin.lng + p.x / kx }),
  };
}

// ─────────────────────────────────────────────── polylines

export function polylineLengthM(line: readonly LatLng[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += haversineM(line[i - 1]!, line[i]!);
  return s;
}

export interface PolylineProjection {
  /**
   * Distance along the polyline from its first vertex to the closest point.
   * Negative when the point lies before the start (projection onto the extended first segment).
   * Exceeds the length when beyond the end (extended last segment).
   */
  alongTrackM: number;
  /** Signed lateral offset: + = right of direction of travel, − = left. */
  crossTrackM: number;
  /** Index of the segment [i, i+1] holding the closest point. */
  segmentIndex: number;
  /** Closest point on the (possibly extended) polyline. */
  closest: LatLng;
}

/**
 * Project a point onto a polyline (≥ 2 vertices). The first and last segments are
 * treated as extended rays so that "behind the start" and "beyond the end" produce
 * meaningful negative / over-length along-track values.
 */
export function projectOntoPolyline(point: LatLng, line: readonly LatLng[]): PolylineProjection {
  if (line.length === 0) throw new Error('projectOntoPolyline: empty polyline');
  if (line.length === 1) {
    return { alongTrackM: 0, crossTrackM: haversineM(point, line[0]!), segmentIndex: 0, closest: line[0]! };
  }
  const proj = localProjection(line[0]!);
  const pts = line.map((p) => proj.toXY(p));
  const P = proj.toXY(point);
  let best: { d2: number; along: number; cross: number; seg: number; cx: number; cy: number } | null = null;
  let cum = 0;
  const last = pts.length - 2;
  for (let i = 0; i <= last; i++) {
    const A = pts[i]!;
    const B = pts[i + 1]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    if (len === 0) continue;
    let u = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
    const lo = i === 0 ? -Infinity : 0;
    const hi = i === last ? Infinity : 1;
    u = Math.max(lo, Math.min(hi, u));
    const cx = A.x + u * dx;
    const cy = A.y + u * dy;
    const ex = P.x - cx;
    const ey = P.y - cy;
    const d2 = ex * ex + ey * ey;
    // cross product sign: direction (dx,dy) × (P−A); negative ⇒ P is to the right (x east, y north).
    // Magnitude is the true distance to the (clamped) closest point, so a point beyond a
    // vertex on the segment's own line is still reported as far off-track.
    const cr = dx * (P.y - A.y) - dy * (P.x - A.x);
    const cross = Math.sqrt(d2) * (cr > 0 ? -1 : 1);
    if (best === null || d2 < best.d2 - 1e-9) {
      best = { d2, along: cum + u * len, cross, seg: i, cx, cy };
    }
    cum += len;
  }
  if (best === null) {
    return { alongTrackM: 0, crossTrackM: haversineM(point, line[0]!), segmentIndex: 0, closest: line[0]! };
  }
  return {
    alongTrackM: best.along,
    crossTrackM: best.cross,
    segmentIndex: best.seg,
    closest: proj.toLatLng({ x: best.cx, y: best.cy }),
  };
}

/**
 * Straight heading-projected trajectory from `position` along `courseDeg` for `lengthM`,
 * sampled every `stepM` (used when no route is known). First vertex is the position.
 */
export function headingTrajectory(position: LatLng, courseDeg: number, lengthM: number, stepM = 5000): LatLng[] {
  const n = Math.max(1, Math.ceil(lengthM / stepM));
  const out: LatLng[] = [{ lat: position.lat, lng: position.lng }];
  for (let i = 1; i <= n; i++) out.push(destinationPoint(position, courseDeg, Math.min(lengthM, i * stepM)));
  return out;
}

/**
 * Trim a route polyline so it starts at the projection of `position` (the traveller's
 * current place on the route). Returns the remaining route ahead.
 */
export function remainingRoute(position: LatLng, route: readonly LatLng[]): LatLng[] {
  if (route.length < 2) return [...route];
  const p = projectOntoPolyline(position, route);
  return [p.closest, ...route.slice(p.segmentIndex + 1)];
}

// ─────────────────────────────────────────────── geohash

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash encoding. precision 5 ≈ 4.9 km × 4.9 km cells (privacy telemetry). */
export function geohashEncode(p: LatLng, precision = 5): string {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let out = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (out.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (p.lng >= mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch = ch << 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (p.lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch = ch << 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      out += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

/** Centre of a geohash cell (for tests / admin heatmaps). */
export function geohashDecode(hash: string): LatLng {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let even = true;
  for (const c of hash) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error(`geohashDecode: invalid char ${c}`);
    for (let b = 4; b >= 0; b--) {
      const bitOn = (v >> b) & 1;
      if (even) {
        const mid = (lngLo + lngHi) / 2;
        if (bitOn) lngLo = mid;
        else lngHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (bitOn) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lngLo + lngHi) / 2 };
}
