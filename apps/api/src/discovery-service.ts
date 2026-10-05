/**
 * Discovery + evidence caching in front of the ProviderRouter.
 *  - Place results: Redis, keyed by (geohash cell of the query centre sized to the radius,
 *    radius bucket, floor, kinds, locale, corridor fingerprint), TTL 15 min. Wikimedia
 *    content is poolable across users; Google Places results are never cached longer than
 *    Google's terms allow (we use minutes; limit is 30 days for lat/lng).
 *  - Evidence packs: Redis, keyed by place id + language, TTL 7 days (Wikimedia, CC BY-SA/CC0).
 * Cache hits are written to the cost ledger with cacheHit = true, cost 0 (hit-rate metrics).
 */
import type { DiscoveryQuery, EvidencePack, Locale, PlaceCandidate } from '@city/core';
import { geohashEncode, isRussian, polylineLengthM } from '@city/core';
import type { CallContext, ProviderRouter } from '@city/providers';
import type { KV } from './kv.js';
import type { Telemetry } from './telemetry.js';

export const CACHE_TTL_S = { places: 15 * 60, evidence: 7 * 24 * 3600, evidenceMiss: 6 * 3600 } as const;

function precisionFor(radiusM: number): number {
  // Cell size must stay well below the radius so a cached result still covers the traveller.
  if (radiusM <= 1500) return 7; // ~150 m cells
  if (radiusM <= 8000) return 6; // ~1.2 × 0.6 km
  if (radiusM <= 40_000) return 5; // ~5 km
  return 4; // ~40 km
}

export function placesCacheKey(q: DiscoveryQuery): string {
  const cell = geohashEncode(q.center, precisionFor(q.radiusM));
  const rBucket = Math.round(q.radiusM / 100) * 100;
  const corridor = q.corridor && q.corridor.length >= 2 ? `${geohashEncode(q.corridor.at(-1)!, 5)}~${Math.round(polylineLengthM(q.corridor) / 1000)}` : '-';
  const lang = isRussian(q.locale) ? 'ru' : 'en';
  return `pl:v1:${cell}:${rBucket}:${q.minSignificance.toFixed(2)}:${q.kinds?.join('|') ?? '*'}:${lang}:${corridor}`;
}

export class DiscoveryService {
  stats = { placeHits: 0, placeMisses: 0, evidenceHits: 0, evidenceMisses: 0 };
  constructor(
    private readonly router: ProviderRouter,
    private readonly kv: KV,
    private readonly telemetry: Telemetry,
  ) {}

  private hit(sessionId: string | null, task: string, provider: string): void {
    this.telemetry.record({ sessionId, provider, model: null, category: 'knowledge', task, units: { requests: 0 }, costUsd: 0, latencyMs: 0, cacheHit: true, ok: true, at: Date.now() });
  }

  async places(q: DiscoveryQuery, ctx: CallContext, task: 'discovery' | 'density_probe' = 'discovery'): Promise<{ places: PlaceCandidate[]; cacheHit: boolean }> {
    const key = placesCacheKey(q);
    const cached = await this.kv.get(key);
    if (cached) {
      this.stats.placeHits++;
      this.hit(ctx.sessionId, task, 'cache');
      return { places: JSON.parse(cached) as PlaceCandidate[], cacheHit: true };
    }
    this.stats.placeMisses++;
    const { result, provider } = await this.router.queryPlaces(q, ctx, task);
    // Google-sourced candidates carry lat/lng subject to Places caching terms: keep them out of the shared cache.
    const poolable = provider.name !== 'google_places';
    if (poolable) await this.kv.set(key, JSON.stringify(result), CACHE_TTL_S.places);
    return { places: result, cacheHit: false };
  }

  async evidence(place: PlaceCandidate, locale: Locale, ctx: CallContext): Promise<EvidencePack | null> {
    const key = `ev:v1:${place.id}:${isRussian(locale) ? 'ru' : 'en'}`;
    const cached = await this.kv.get(key);
    if (cached) {
      this.stats.evidenceHits++;
      this.hit(ctx.sessionId, 'evidence', 'cache');
      return cached === 'null' ? null : (JSON.parse(cached) as EvidencePack);
    }
    this.stats.evidenceMisses++;
    const { result } = await this.router.evidence(place, locale, ctx);
    await this.kv.set(key, result ? JSON.stringify(result) : 'null', result ? CACHE_TTL_S.evidence : CACHE_TTL_S.evidenceMiss);
    return result;
  }
}
