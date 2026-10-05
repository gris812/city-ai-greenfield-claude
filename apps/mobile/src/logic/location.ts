/** Pure helpers for OS location samples (unit-tested). */
import type { GeoFix } from '@city/core';

/** Shape shared by expo-location LocationObject (kept structural so tests need no native module). */
export interface OsLocation {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
  };
  mocked?: boolean;
}

/**
 * OS sample → GeoFix. Platforms report "unknown" as negative speed/heading (iOS: -1) or 0-heading
 * with 0 speed (Android); the server's regime tracker derives course when heading is missing.
 */
export function toGeoFix(l: OsLocation): GeoFix | null {
  const { latitude, longitude } = l.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const speed = l.coords.speed;
  const heading = l.coords.heading;
  const validSpeed = typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 ? speed : null;
  const validHeading = typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && !(heading === 0 && (validSpeed ?? 0) < 0.5) ? heading % 360 : null;
  return {
    t: Math.round(l.timestamp),
    lat: latitude,
    lng: longitude,
    accuracyM: typeof l.coords.accuracy === 'number' && l.coords.accuracy >= 0 ? l.coords.accuracy : null,
    speedMps: validSpeed,
    headingDeg: validHeading,
    altitudeM: typeof l.coords.altitude === 'number' ? l.coords.altitude : null,
    // A mock-location provider must never be presented as real GPS.
    source: l.mocked ? 'simulated' : 'gps',
  };
}

/**
 * Bounded buffer for fixes delivered while no consumer is attached (background task firing
 * before the store is ready, or JS relaunched headless). Oldest are dropped; duplicates ignored.
 */
export class FixBuffer {
  private buf: GeoFix[] = [];
  constructor(private readonly max = 300) {}
  push(fixes: GeoFix[]): void {
    const lastT = this.buf.at(-1)?.t ?? -Infinity;
    for (const f of fixes) if (f.t > lastT) this.buf.push(f);
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max);
  }
  drain(): GeoFix[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }
  get size(): number {
    return this.buf.length;
  }
}

/** Puck rotation: course while moving, compass heading when (nearly) still. */
export function puckHeading(fix: Pick<GeoFix, 'headingDeg' | 'speedMps'> | null, compassDeg: number | null): number | null {
  if (fix && typeof fix.headingDeg === 'number' && (fix.speedMps ?? 0) >= 1) return fix.headingDeg;
  return compassDeg ?? fix?.headingDeg ?? null;
}
