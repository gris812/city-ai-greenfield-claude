/**
 * Google Places API (New) — explicit NearbySearch tool (C1) and minimal Place Details.
 *
 * Cost/terms discipline (docs/research/PROVIDER_PRICING.md §5):
 *  - Field masks are minimal: id, displayName, location, primaryType, types (Nearby Search
 *    **Pro** SKU). `currentOpeningHours`/`rating` would escalate to Enterprise — not requested.
 *  - Only place IDs may be kept long-term; lat/lng at most 30 days (GOOGLE_PLACES_MAX_LATLNG_CACHE_S).
 *    Callers must cache Places results no longer than that (the API uses minutes).
 *  - Places content must be shown on a Google map (clients use Google Maps SDK / JS API).
 *
 * Not used for automatic discovery by default (Wikimedia is free and poolable); a
 * GooglePlacesPlaceSource exists for optional enrichment but is off unless configured.
 */
import type { DiscoveryQuery, LatLng, PlaceCandidate, PlaceKind } from '@city/core';
import { haversineM } from '@city/core';
import { httpJson, type FetchLike } from '../http.js';
import type { CallContext, NearbyRequest, NearbySearch, PlaceSource } from '../types.js';

export const GOOGLE_PLACES_MAX_LATLNG_CACHE_S = 30 * 24 * 3600;
const BASE = 'https://places.googleapis.com/v1';
const NEARBY_FIELD_MASK = 'places.id,places.displayName,places.location,places.primaryType,places.types';

/** Normalized category (core CATEGORY_SYNONYMS keys) → Places (New) includedTypes. */
export const CATEGORY_TYPES: Record<string, string[]> = {
  coffee: ['cafe', 'coffee_shop'],
  parking: ['parking'],
  gas_station: ['gas_station'],
  ev_charging: ['electric_vehicle_charging_station'],
  restroom: ['public_bathroom'],
  pharmacy: ['pharmacy', 'drugstore'],
  atm: ['atm'],
  restaurant: ['restaurant'],
  lodging: ['lodging'],
  rest_area: ['rest_stop', 'truck_stop'],
  grocery: ['grocery_store', 'supermarket'],
};

export function kindForGoogleType(t: string | undefined): PlaceKind {
  if (!t) return 'other';
  if (/cafe|coffee|restaurant|bakery|bar|food|meal/.test(t)) return 'food';
  if (/lodging|hotel|motel|inn/.test(t)) return 'lodging';
  if (/gas_station|charging/.test(t)) return 'fuel';
  if (/parking|station|transit|airport|bus|subway|train|rest_stop|truck_stop/.test(t)) return 'transit';
  if (/store|shop|pharmacy|drugstore|supermarket|market|atm|bank/.test(t)) return 'shop';
  if (/museum|art_gallery/.test(t)) return 'museum';
  if (/park|garden/.test(t)) return 'park';
  if (/church|mosque|synagogue|temple|place_of_worship/.test(t)) return 'religious_site';
  if (/monument|historical|landmark/.test(t)) return 'landmark';
  if (/bathroom|toilet/.test(t)) return 'transit';
  return 'other';
}

interface GPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
}

export interface GooglePlacesOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class GooglePlacesNearbySearch implements NearbySearch {
  readonly name = 'google_places';
  readonly model = 'nearby_search_pro';
  constructor(private readonly o: GooglePlacesOptions) {}

  async search(req: NearbyRequest, ctx?: CallContext): Promise<unknown[]> {
    const types = req.category ? CATEGORY_TYPES[req.category] : undefined;
    const body: Record<string, unknown> = {
      maxResultCount: Math.max(1, Math.min(20, req.maxResults)),
      rankPreference: 'DISTANCE',
      languageCode: String(req.locale).slice(0, 2),
      locationRestriction: { circle: { center: { latitude: req.location.lat, longitude: req.location.lng }, radius: Math.max(50, Math.min(50_000, req.radiusM)) } },
      ...(types ? { includedTypes: types } : {}),
    };
    const res = await httpJson<{ places?: GPlace[] }>(
      `${BASE}/places:searchNearby`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.o.apiKey, 'X-Goog-FieldMask': NEARBY_FIELD_MASK }, body: JSON.stringify(body) },
      { provider: this.name, timeoutMs: this.o.timeoutMs ?? 4000, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) },
    );
    // Raw-ish mapping; the API validates with zod before use (C1 step 4).
    return (res.places ?? []).map((p) => ({
      placeId: p.id ? `gp:${p.id}` : undefined,
      name: p.displayName?.text,
      location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
      kind: kindForGoogleType(p.primaryType ?? p.types?.[0]),
      category: req.category,
    }));
  }

  /** Place Details, IDs + location only (Essentials SKU). */
  async details(placeId: string, ctx?: CallContext): Promise<{ placeId: string; name: string | null; location: LatLng | null }> {
    const id = placeId.replace(/^gp:/, '');
    const res = await httpJson<GPlace>(
      `${BASE}/places/${encodeURIComponent(id)}`,
      { headers: { 'X-Goog-Api-Key': this.o.apiKey, 'X-Goog-FieldMask': 'id,displayName,location' } },
      { provider: this.name, timeoutMs: this.o.timeoutMs ?? 4000, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) },
    );
    return {
      placeId: `gp:${res.id ?? id}`,
      name: res.displayName?.text ?? null,
      location: res.location?.latitude !== undefined && res.location.longitude !== undefined ? { lat: res.location.latitude, lng: res.location.longitude } : null,
    };
  }
}

/** Optional discovery enrichment via Nearby Search (Pro). Significance from type only (no Enterprise fields). */
export class GooglePlacesPlaceSource implements PlaceSource {
  readonly name = 'google_places';
  readonly model = 'nearby_search_pro';
  private readonly nearby: GooglePlacesNearbySearch;
  constructor(o: GooglePlacesOptions) {
    this.nearby = new GooglePlacesNearbySearch(o);
  }

  async query(q: DiscoveryQuery, ctx?: CallContext): Promise<PlaceCandidate[]> {
    const raw = (await this.nearby.search({ location: q.center, category: null, query: '', radiusM: Math.min(50_000, q.radiusM), maxResults: 20, locale: q.locale }, ctx)) as Array<{
      placeId?: string;
      name?: string;
      location?: { lat?: number; lng?: number };
      kind: PlaceKind;
    }>;
    const now = Date.now();
    const out: PlaceCandidate[] = [];
    for (const r of raw) {
      if (!r.placeId || !r.name || typeof r.location?.lat !== 'number' || typeof r.location?.lng !== 'number') continue;
      const location = { lat: r.location.lat, lng: r.location.lng };
      if (haversineM(q.center, location) > q.radiusM) continue;
      const significance = ['museum', 'landmark', 'park', 'religious_site'].includes(r.kind) ? 0.45 : 0.2;
      if (significance < q.minSignificance) continue;
      out.push({
        id: r.placeId,
        name: r.name,
        kind: r.kind,
        location,
        extentM: 0,
        significance,
        tags: [r.kind],
        externalRefs: { googlePlaceId: r.placeId.replace(/^gp:/, '') },
        sources: [{ provider: 'google_places', ref: r.placeId, retrievedAt: now }],
      });
    }
    return out;
  }
}
