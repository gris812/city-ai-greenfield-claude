/**
 * NearbySearch tool (acceptance C1). Independent of automatic discovery filtering: it
 * never goes through scoreCandidates/significance floors. Adapter output is validated with
 * zod; the spoken answer and the map action are built ONLY from validated results
 * (names from the provider, distances/directions computed here) — nothing to hallucinate.
 */
import { z } from 'zod';
import type { LatLng, MapAction, MovementRegime, PlaceKind } from '@city/core';
import { distancePhrase, haversineM, initialBearingDeg, isRussian, unitsForLocale, type Units } from '@city/core';
import { categoryLabel } from './phrases.js';

const PLACE_KINDS = [
  'landmark',
  'building',
  'museum',
  'monument',
  'memorial',
  'historic_site',
  'religious_site',
  'park',
  'bridge',
  'neighborhood',
  'city',
  'town',
  'region',
  'natural_feature',
  'water',
  'mountain',
  'venue',
  'food',
  'shop',
  'lodging',
  'fuel',
  'transit',
  'road_feature',
  'other',
] as const satisfies readonly PlaceKind[];

export const NearbyResultSchema = z.object({
  placeId: z.string().min(1).max(300),
  name: z.string().trim().min(1).max(120),
  location: z.object({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) }),
  kind: z.enum(PLACE_KINDS).catch('other'),
  category: z.string().nullable().optional(),
  openNow: z.boolean().nullable().optional(),
});

export interface ValidatedNearby {
  placeId: string;
  name: string;
  location: LatLng;
  kind: PlaceKind;
  distanceM: number;
  bearingDeg: number;
}

export const NEARBY_RADIUS_M: Record<MovementRegime, number> = {
  unknown: 800,
  stationary: 800,
  walking: 800,
  cycling: 1500,
  urban_driving: 3000,
  highway_driving: 8000,
};

export function validateNearby(raw: readonly unknown[], origin: LatLng, radiusM: number, max: number): { results: ValidatedNearby[]; invalid: number } {
  const out: ValidatedNearby[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const r of raw) {
    const p = NearbyResultSchema.safeParse(r);
    if (!p.success) {
      invalid++;
      continue;
    }
    const d = p.data;
    const distanceM = haversineM(origin, d.location);
    if (distanceM > radiusM * 1.5 || seen.has(d.placeId)) {
      invalid++;
      continue;
    }
    seen.add(d.placeId);
    out.push({ placeId: d.placeId, name: d.name, location: d.location, kind: d.kind, distanceM: Math.round(distanceM), bearingDeg: initialBearingDeg(origin, d.location) });
  }
  out.sort((a, b) => a.distanceM - b.distanceM || (a.placeId < b.placeId ? -1 : 1));
  return { results: out.slice(0, max), invalid };
}

const DIR_EN = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const DIR_RU = ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'];

export function compass(bearing: number, locale: string): string {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return (isRussian(locale) ? DIR_RU : DIR_EN)[i]!;
}

export function nearbyAnswer(results: readonly ValidatedNearby[], category: string | null, locale: string, units: Units = unitsForLocale(locale), driving = false): string {
  const ru = isRussian(locale);
  const label = categoryLabel(category, locale);
  if (results.length === 0) return ru ? `Поблизости не нашлось: ${label}.` : `I couldn't find ${label} nearby.`;
  const [first, ...rest] = results;
  const dist = distancePhrase(first!.distanceM, units);
  const d = ru ? dist.ru : dist.en;
  const lead = ru ? `Ближайшее — ${first!.name}, ${d} ${compass(first!.bearingDeg, locale)}.` : `The closest is ${first!.name}, ${d} to the ${compass(first!.bearingDeg, locale)}.`;
  if (driving || rest.length === 0) return lead; // driving: one short, audio-first answer
  const others = rest.slice(0, 2).map((r) => r.name);
  return ru ? `${lead} Ещё рядом: ${others.join(' и ')}. Они отмечены на карте.` : `${lead} Also nearby: ${others.join(' and ')}. They're on the map.`;
}

export function showResults(results: readonly ValidatedNearby[]): MapAction {
  return { kind: 'show_results', results: results.map((r) => ({ placeId: r.placeId, name: r.name, location: r.location, distanceM: r.distanceM, kind: r.kind })) };
}
