/**
 * Deterministic generator for replay fixtures (TEST/DEMO ONLY — D-005).
 *
 *   pnpm gen:traces
 *
 * Writes:
 *   fixtures/traces/<name>.json         GeoFix sequences from waypoint polylines + speed profiles
 *   fixtures/places/<name>.clutter.json synthetic low-significance "clutter" places that give each
 *                                       area a realistic candidate density (they are NOT real POIs;
 *                                       every one is tagged `synthetic_clutter`)
 *
 * Trace geometry approximates real roads/streets from a handful of waypoints; it is synthetic
 * and good to tens of metres, not survey-grade. Noise comes from a seeded PRNG, so the output
 * is byte-for-byte reproducible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeoFix, LatLng, PlaceCandidate, PlaceKind } from '../packages/core/src/index.js';
import { destinationPoint, haversineM, initialBearingDeg, normBearing } from '../packages/core/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.UTC(2026, 8, 27, 15, 0, 0); // fixed epoch for all traces

// ─────────────────────────────────────────── PRNG

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ─────────────────────────────────────────── trace model

interface Leg {
  /** Waypoint to travel to. */
  to: LatLng;
  /** Cruise speed on this leg (m/s). */
  v: number;
  /** Stop at the end of this leg for this many seconds (red light, parking, standing). */
  stopS?: number;
}
interface Stand {
  standS: number;
}
type Step = Leg | Stand;

interface TraceSpec {
  name: string;
  description: string;
  start: LatLng;
  steps: Step[];
  hz: number;
  accel: number; // m/s² (positive)
  decel: number; // m/s² (positive)
  posNoiseM: number;
  speedNoise: number;
  accuracyM: number;
  seed: number;
  /** Report a route hint polyline (navigation handoff) in the trace file. */
  withRoute?: boolean;
}

function round(x: number, n: number): number {
  const k = 10 ** n;
  return Math.round(x * k) / k;
}

function generate(spec: TraceSpec): { fixes: GeoFix[]; route: LatLng[] } {
  const r = mulberry32(spec.seed);
  const dt = 1 / spec.hz;
  const fixes: GeoFix[] = [];
  let pos = { ...spec.start };
  let v = 0;
  let t = T0;
  let heading = 0;
  const route: LatLng[] = [spec.start];
  const emit = () => {
    const n = spec.posNoiseM * Math.abs(gaussian(r));
    const p = n > 0 ? destinationPoint(pos, r() * 360, n) : pos;
    const moving = v > 0.4;
    fixes.push({
      t: Math.round(t),
      lat: round(p.lat, 6),
      lng: round(p.lng, 6),
      accuracyM: round(spec.accuracyM * (0.8 + 0.4 * r()), 1),
      speedMps: round(Math.max(0, v + (moving ? spec.speedNoise * gaussian(r) : 0.05 * Math.abs(gaussian(r)))), 2),
      headingDeg: moving ? round(normBearing(heading + 1.5 * gaussian(r)), 1) : null,
      source: 'replay',
    });
  };
  emit();
  for (const step of spec.steps) {
    if ('standS' in step) {
      v = 0;
      for (let s = 0; s < step.standS * spec.hz; s++) {
        t += dt * 1000;
        emit();
      }
      continue;
    }
    route.push(step.to);
    const stopAtEnd = step.stopS !== undefined;
    // integrate along the straight leg
    for (let guard = 0; guard < 1e6; guard++) {
      const rem = haversineM(pos, step.to);
      heading = rem > 0.5 ? initialBearingDeg(pos, step.to) : heading;
      const brakeDist = stopAtEnd ? (v * v) / (2 * spec.decel) : 0;
      let target = step.v;
      if (stopAtEnd && rem <= brakeDist + v * dt) target = 0;
      if (v < target) v = Math.min(target, v + spec.accel * dt);
      else if (v > target) v = Math.max(target, v - spec.decel * dt);
      // creep the last metres so the waypoint is actually reached
      if (stopAtEnd && target === 0 && v < 0.5) v = Math.min(0.5, rem / dt);
      const d = v * dt;
      if (d >= rem || rem < 0.3) {
        pos = { ...step.to };
        t += dt * 1000;
        if (stopAtEnd) v = 0;
        emit();
        break;
      }
      pos = destinationPoint(pos, heading, d);
      t += dt * 1000;
      emit();
    }
    if (stopAtEnd) {
      v = 0;
      for (let s = 0; s < (step.stopS ?? 0) * spec.hz; s++) {
        t += dt * 1000;
        emit();
      }
    }
  }
  return { fixes, route };
}

// ─────────────────────────────────────────── clutter model

interface ClutterZone {
  /** Polyline band or a circle. */
  path?: LatLng[];
  halfWidthM?: number;
  center?: LatLng;
  radiusM?: number;
  /** Target places per km². */
  density: number;
}

const CLUTTER_KINDS: Array<{ kind: PlaceKind; label: string }> = [
  { kind: 'building', label: 'Office building' },
  { kind: 'building', label: 'Apartment block' },
  { kind: 'food', label: 'Cafe' },
  { kind: 'shop', label: 'Store' },
  { kind: 'historic_site', label: 'Historic marker' },
  { kind: 'venue', label: 'Small venue' },
  { kind: 'religious_site', label: 'Neighborhood church' },
  { kind: 'park', label: 'Pocket park' },
];

function randomInCircle(r: () => number, c: LatLng, radius: number): LatLng {
  return destinationPoint(c, r() * 360, radius * Math.sqrt(r()));
}

function clutter(prefix: string, zones: ClutterZone[], seed: number): PlaceCandidate[] {
  const r = mulberry32(seed);
  const out: PlaceCandidate[] = [];
  let n = 0;
  for (const z of zones) {
    const pts: LatLng[] = [];
    if (z.center && z.radiusM) {
      const count = Math.round(z.density * (Math.PI * z.radiusM * z.radiusM) / 1e6);
      for (let i = 0; i < count; i++) pts.push(randomInCircle(r, z.center, z.radiusM));
    } else if (z.path && z.halfWidthM) {
      for (let i = 1; i < z.path.length; i++) {
        const a = z.path[i - 1]!;
        const b = z.path[i]!;
        const len = haversineM(a, b);
        const brg = initialBearingDeg(a, b);
        const count = Math.round((z.density * (len * 2 * z.halfWidthM)) / 1e6);
        for (let k = 0; k < count; k++) {
          const along = destinationPoint(a, brg, r() * len);
          pts.push(destinationPoint(along, brg + (r() < 0.5 ? 90 : -90), r() * z.halfWidthM));
        }
      }
    }
    for (const p of pts) {
      const k = CLUTTER_KINDS[Math.floor(r() * CLUTTER_KINDS.length)]!;
      n++;
      out.push({
        id: `fx:${prefix}:clutter:${String(n).padStart(4, '0')}`,
        name: `${k.label} #${n} (synthetic)`,
        kind: k.kind,
        location: { lat: round(p.lat, 6), lng: round(p.lng, 6) },
        extentM: 0,
        significance: round(0.1 + 0.25 * r(), 2), // 0.10–0.35: minor, never worth a story unprompted
        tags: ['synthetic_clutter'],
        externalRefs: {},
        sources: [{ provider: 'fixture', ref: 'fixture:synthetic-clutter', retrievedAt: T0 }],
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────── scenarios

const LL = (lat: number, lng: number): LatLng => ({ lat, lng });

const WALK = { hz: 1, accel: 0.5, decel: 0.8, posNoiseM: 3, speedNoise: 0.15, accuracyM: 8 };
const DRIVE = { hz: 1, accel: 1.4, decel: 2.0, posNoiseM: 2.5, speedNoise: 0.3, accuracyM: 6 };

// 1) Walk toward the 9/11 Memorial from the south along Greenwich St, then east to St. Paul's.
const wtcWalk: TraceSpec = {
  name: 'wtc-walk',
  description: 'Walk north on Greenwich St toward the 9/11 Memorial, pause at the pools, continue east past the Oculus to St. Paul\'s Chapel.',
  start: LL(40.7083, -74.0128),
  steps: [
    { to: LL(40.7098, -74.0127), v: 1.35 },
    { to: LL(40.7111, -74.0126), v: 1.35, stopS: 150 },
    { to: LL(40.7120, -74.0124), v: 1.3 },
    { to: LL(40.7119, -74.0108), v: 1.35 },
    { to: LL(40.7116, -74.0097), v: 1.35, stopS: 150 },
    { to: LL(40.7109, -74.0098), v: 1.3 },
    { standS: 60 },
  ],
  ...WALK,
  seed: 101,
};

// 2) Walk north on Michigan Ave to the Art Institute, pause, continue into Millennium Park.
const aicWalk: TraceSpec = {
  name: 'art-institute-walk',
  description: 'Walk north on Michigan Ave from Van Buren to the Art Institute entrance, pause, continue to Cloud Gate and the Pritzker Pavilion lawn.',
  start: LL(41.8755, -87.6246),
  steps: [
    { to: LL(41.8777, -87.6246), v: 1.35 },
    { to: LL(41.8795, -87.6246), v: 1.3, stopS: 150 },
    { to: LL(41.8822, -87.6245), v: 1.35 },
    { to: LL(41.8826, -87.6236), v: 1.3, stopS: 120 },
    { to: LL(41.8829, -87.6216), v: 1.3, stopS: 120 },
    { standS: 60 },
  ],
  ...WALK,
  seed: 202,
};

// 3) Drive south on US-101 across the Golden Gate Bridge, exit to the south vista point lot, walk to the Fort Point overlook.
const ggDrive: TraceSpec = {
  name: 'golden-gate-drive-walk',
  description: 'Drive southbound on US-101 through Marin and across the Golden Gate Bridge, park at the south vista point, walk to the Fort Point overlook.',
  start: LL(37.872, -122.51),
  steps: [
    { to: LL(37.856, -122.493), v: 22 },
    { to: LL(37.847, -122.4835), v: 21 },
    { to: LL(37.838, -122.482), v: 20 },
    { to: LL(37.8325, -122.4808), v: 20 },
    { to: LL(37.8108, -122.4772), v: 20 },
    { to: LL(37.8078, -122.4748), v: 11 },
    { to: LL(37.8068, -122.4753), v: 5, stopS: 180 },
    { to: LL(37.8072, -122.4756), v: 1.3 },
    { to: LL(37.8086, -122.4765), v: 1.3 },
    { to: LL(37.8094, -122.4769), v: 1.2, stopS: 180 },
    { standS: 30 },
  ],
  ...DRIVE,
  seed: 303,
};

// 4) Interstate 40 westbound across western New Mexico (≈ 200 km, ≈ 110 min), no stops.
const i40Path = [
  LL(35.04, -106.86),
  LL(35.025, -106.95),
  LL(35.015, -107.12),
  LL(35.035, -107.3),
  LL(35.043, -107.39),
  LL(35.045, -107.5),
  LL(35.07, -107.62),
  LL(35.12, -107.75),
  LL(35.145, -107.84),
  LL(35.18, -107.92),
  LL(35.25, -108.0),
  LL(35.33, -108.07),
  LL(35.405, -108.2),
  LL(35.43, -108.335),
  LL(35.47, -108.53),
  LL(35.5, -108.65),
  LL(35.523, -108.74),
];
const speeds = [27, 30, 31, 30, 29, 31, 30, 29, 28, 30, 31, 31, 30, 29, 30, 28];
const i40: TraceSpec = {
  name: 'i40-westbound',
  description: 'Truck on Interstate 40 westbound from west of Albuquerque to Gallup at 60–70 mph (0.5 Hz fixes).',
  start: i40Path[0]!,
  steps: i40Path.slice(1).map((to, i) => ({ to, v: speeds[i]! })),
  hz: 0.5,
  accel: 0.6,
  decel: 1.0,
  posNoiseM: 3,
  speedNoise: 0.4,
  accuracyM: 5,
  seed: 404,
  withRoute: true,
};

// 5) Transition: expressway inbound → outskirts → urban arterial with lights → dense downtown → park → walk.
const approach = [LL(41.74, -87.94), LL(41.77, -87.85), LL(41.8, -87.76), LL(41.82, -87.7), LL(41.84, -87.66)];
const transition: TraceSpec = {
  name: 'highway-to-downtown-walk',
  description: 'Inbound expressway at highway speed, exit, urban arterial with red lights, slow dense downtown grid, park, walk to a museum entrance.',
  start: approach[0]!,
  steps: [
    { to: approach[1]!, v: 29 },
    { to: approach[2]!, v: 29 },
    { to: approach[3]!, v: 28 },
    { to: approach[4]!, v: 26 },
    { to: LL(41.852, -87.635), v: 16 },
    { to: LL(41.853, -87.6245), v: 12, stopS: 50 },
    { to: LL(41.8605, -87.6245), v: 12, stopS: 60 },
    { to: LL(41.8676, -87.6244), v: 11, stopS: 45 },
    { to: LL(41.8715, -87.6244), v: 7, stopS: 40 },
    { to: LL(41.8745, -87.6244), v: 6 },
    { to: LL(41.8772, -87.6240), v: 4, stopS: 200 },
    { to: LL(41.8776, -87.6246), v: 1.3 },
    { to: LL(41.8795, -87.6246), v: 1.35, stopS: 120 },
    { standS: 30 },
  ],
  ...DRIVE,
  seed: 505,
};

// ─────────────────────────────────────────── clutter zones per area

const CLUTTER: Array<{ file: string; prefix: string; seed: number; zones: ClutterZone[] }> = [
  { file: 'nyc-lower-manhattan', prefix: 'nyc', seed: 11, zones: [{ center: LL(40.7112, -74.0115), radiusM: 900, density: 140 }] },
  { file: 'chicago-loop', prefix: 'chi', seed: 22, zones: [{ center: LL(41.879, -87.626), radiusM: 900, density: 120 }] },
  {
    file: 'chicago-approach',
    prefix: 'chiap',
    seed: 23,
    zones: [
      { path: [approach[0]!, approach[2]!], halfWidthM: 1500, density: 0.6 }, // sparse (industrial / forest preserve belt)
      { path: [approach[2]!, approach[4]!], halfWidthM: 900, density: 8 }, // suburban outskirts
      { path: [approach[4]!, LL(41.852, -87.635), LL(41.853, -87.6245), LL(41.8676, -87.6244)], halfWidthM: 700, density: 45 }, // urban
      { path: [LL(41.8676, -87.6244), LL(41.8745, -87.6244)], halfWidthM: 500, density: 130 }, // dense downtown
    ],
  },
  {
    file: 'sf-golden-gate',
    prefix: 'sf',
    seed: 33,
    zones: [
      { path: [LL(37.872, -122.51), LL(37.838, -122.482)], halfWidthM: 1000, density: 4 },
      { center: LL(37.806, -122.474), radiusM: 700, density: 10 },
    ],
  },
  { file: 'i40-new-mexico', prefix: 'i40', seed: 44, zones: [{ path: i40Path, halfWidthM: 2500, density: 0.12 }] },
];

// ─────────────────────────────────────────── main

function write(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj) + '\n');
}

for (const spec of [wtcWalk, aicWalk, ggDrive, i40, transition]) {
  const { fixes, route } = generate(spec);
  const durationS = (fixes.at(-1)!.t - fixes[0]!.t) / 1000;
  write(join(ROOT, 'fixtures/traces', `${spec.name}.json`), {
    name: spec.name,
    description: spec.description,
    synthetic: true,
    hz: spec.hz,
    durationS,
    route: spec.withRoute ? route : null,
    fixes,
  });
  console.log(`trace ${spec.name}: ${fixes.length} fixes, ${Math.round(durationS / 60)} min`);
}
for (const c of CLUTTER) {
  const places = clutter(c.prefix, c.zones, c.seed);
  write(join(ROOT, 'fixtures/places', `${c.file}.clutter.json`), places);
  console.log(`clutter ${c.file}: ${places.length} places`);
}
