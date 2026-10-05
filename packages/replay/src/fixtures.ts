/**
 * Fixture loading + FixturePlaceSource (D-005: test, replay and explicitly labelled demo
 * mode only). The source loads EVERY pack under fixtures/places — scenarios never select a
 * city; the query geometry alone decides what comes back (A7).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryQuery, EvidencePack, FactKind, GeoFix, Id, LatLng, PlaceCandidate, PlaceSource } from '@city/core';
import { haversineM } from '@city/core';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURES_DIR = join(REPO_ROOT, 'fixtures');

function assertDemoAllowed(): void {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== '1') {
    throw new Error('FixturePlaceSource is test/demo only (D-005). Set DEMO_MODE=1 to use it in a production build.');
  }
}

function readJsonDir<T>(dir: string): Array<{ file: string; data: T }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as T }));
}

export interface FixtureSourceStats {
  queries: number;
  /** Queries by caller-supplied purpose label. */
  byPurpose: Record<string, number>;
  emptyResults: number;
}

export class FixturePlaceSource implements PlaceSource {
  readonly places: PlaceCandidate[];
  readonly stats: FixtureSourceStats = { queries: 0, byPurpose: {}, emptyResults: 0 };
  private purpose = 'discovery';

  constructor(places?: PlaceCandidate[], dir = join(FIXTURES_DIR, 'places')) {
    assertDemoAllowed();
    this.places = places ?? readJsonDir<PlaceCandidate[]>(dir).flatMap((x) => x.data);
    const ids = new Set<string>();
    for (const p of this.places) {
      if (ids.has(p.id)) throw new Error(`duplicate fixture place id ${p.id}`);
      ids.add(p.id);
    }
  }

  /** Label the next query (for per-purpose accounting in replay summaries). */
  as(purpose: string): this {
    this.purpose = purpose;
    return this;
  }

  resetStats(): void {
    this.stats.queries = 0;
    this.stats.byPurpose = {};
    this.stats.emptyResults = 0;
  }

  /** Provider semantics: features whose extent intersects the query circle, above the floor. No ranking. */
  async query(q: DiscoveryQuery): Promise<PlaceCandidate[]> {
    return this.querySync(q);
  }

  querySync(q: DiscoveryQuery): PlaceCandidate[] {
    this.stats.queries++;
    this.stats.byPurpose[this.purpose] = (this.stats.byPurpose[this.purpose] ?? 0) + 1;
    this.purpose = 'discovery';
    const out = this.places.filter(
      (p) => p.significance >= q.minSignificance && (!q.kinds || q.kinds.includes(p.kind)) && haversineM(q.center, p.location) - p.extentM <= q.radiusM,
    );
    if (out.length === 0) this.stats.emptyResults++;
    // Provider-like order: by id (deliberately NOT by distance or importance — ranking is core's job, A1).
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

export class FixtureEvidence {
  readonly packs: Map<Id, EvidencePack>;
  constructor(dir = join(FIXTURES_DIR, 'evidence')) {
    assertDemoAllowed();
    this.packs = new Map(readJsonDir<EvidencePack[]>(dir).flatMap((x) => x.data.map((p) => [p.placeId, p] as const)));
  }
  get(placeId: Id): EvidencePack | null {
    return this.packs.get(placeId) ?? null;
  }
  /** Thin = no pack, flagged thin, or fewer than two usable facts. */
  isThin(placeId: Id): boolean {
    const p = this.packs.get(placeId);
    return !p || p.thin || p.facts.filter((f) => f.confidence >= 0.5).length < 2;
  }
  factKinds(placeId: Id): FactKind[] | null {
    const p = this.packs.get(placeId);
    return p ? [...new Set(p.facts.map((f) => f.kind))] : null;
  }
}

export interface TraceFile {
  name: string;
  description: string;
  synthetic: boolean;
  hz: number;
  durationS: number;
  route: LatLng[] | null;
  fixes: GeoFix[];
}

export function loadTrace(name: string): TraceFile {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'traces', `${name}.json`), 'utf8')) as TraceFile;
}
