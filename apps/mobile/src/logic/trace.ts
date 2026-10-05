/** Compact trace encoding produced by scripts/prepare-assets.mjs (pure; unit-tested). */
import type { GeoFix } from '@city/core';
import type { TraceFile } from '@city/client';

export interface CompactTrace {
  name: string;
  description: string;
  synthetic: boolean;
  hz: number;
  durationS: number;
  t0: number;
  route: Array<[number, number]> | null;
  /** [dtMs, lat, lng, accuracyM, speedMps, headingDeg] */
  fixes: Array<[number, number, number, number | null, number | null, number | null]>;
}

export function decodeTrace(c: CompactTrace): TraceFile {
  return {
    name: c.name,
    description: c.description,
    synthetic: c.synthetic,
    hz: c.hz,
    durationS: c.durationS,
    route: c.route ? c.route.map(([lat, lng]) => ({ lat, lng })) : null,
    fixes: c.fixes.map(
      ([dt, lat, lng, acc, spd, hdg]): GeoFix => ({ t: c.t0 + dt, lat, lng, accuracyM: acc, speedMps: spd, headingDeg: hdg, source: 'replay' }),
    ),
  };
}
