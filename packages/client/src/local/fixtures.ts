/**
 * Demo data model for the clearly-labelled "Offline demo mode" and simulation (D-005): fixture
 * POI packs, evidence packs and replay traces from /fixtures, delivered to each client by its own
 * loader (web: static files; mobile: bundled JSON). Nothing here is used by the live transport.
 * Moved from apps/web/lib/local/demo-data.ts.
 *
 * `FixtureSource` mirrors @city/replay's FixturePlaceSource semantics exactly
 * (extent-intersects-circle, significance floor, kind filter, NO ranking) — @city/replay itself
 * reads from node:fs and cannot run in a browser or on a phone.
 */
import type { DiscoveryQuery, EvidencePack, FactKind, GeoFix, GuideProfile, Id, LatLng, PlaceCandidate, PlaceSource } from '@city/core';
import { EMIL, IDA, haversineM } from '@city/core';

export interface TraceFile {
  name: string;
  description: string;
  synthetic: boolean;
  hz: number;
  durationS: number;
  route: LatLng[] | null;
  fixes: GeoFix[];
}

export interface DemoScenario {
  name: string;
  label: string;
  trace: string;
  guide: GuideProfile;
  useRoute?: boolean;
  description: string;
}

/** Same scenario set as packages/replay/src/scenarios.ts (trace + guide only; no per-city config). Demo only. */
export const DEMO_SCENARIOS: DemoScenario[] = [
  { name: 'wtc-walk', label: 'Dense-urban walk (Lower Manhattan)', trace: 'wtc-walk', guide: IDA, description: 'Walk toward the 9/11 Memorial area, pause at the pools, continue east.' },
  { name: 'art-institute-walk', label: 'Museum-district walk (Chicago Loop)', trace: 'art-institute-walk', guide: IDA, description: 'Michigan Ave to the Art Institute and into Millennium Park; includes a thin-evidence venue.' },
  { name: 'golden-gate', label: 'Drive, park, walk (Golden Gate)', trace: 'golden-gate-drive-walk', guide: EMIL, description: 'Drive across the bridge, park at the vista point, then walk.' },
  { name: 'interstate', label: 'Interstate truck run (I-40, NM)', trace: 'i40-westbound', guide: EMIL, description: 'No navigation route: heading-projected corridor, sparse places, long silences.' },
  { name: 'transition', label: 'Highway → downtown → walk (Chicago)', trace: 'highway-to-downtown-walk', guide: IDA, description: 'One continuous session: highway, outskirts, urban, dense downtown, parked, walking.' },
];

export class FixtureSource implements PlaceSource {
  queries = 0;
  constructor(readonly places: PlaceCandidate[]) {}
  async query(q: DiscoveryQuery): Promise<PlaceCandidate[]> {
    return this.querySync(q);
  }
  querySync(q: DiscoveryQuery): PlaceCandidate[] {
    this.queries++;
    const out = this.places.filter((p) => p.significance >= q.minSignificance && (!q.kinds || q.kinds.includes(p.kind)) && haversineM(q.center, p.location) - p.extentM <= q.radiusM);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

export class FixtureEvidence {
  readonly packs: Map<Id, EvidencePack>;
  constructor(packs: EvidencePack[]) {
    this.packs = new Map(packs.map((p) => [p.placeId, p] as const));
  }
  get(placeId: Id): EvidencePack | null {
    return this.packs.get(placeId) ?? null;
  }
  isThin(placeId: Id): boolean {
    const p = this.packs.get(placeId);
    return !p || p.thin || p.facts.filter((f) => f.confidence >= 0.5).length < 2;
  }
  factKinds(placeId: Id): FactKind[] | null {
    const p = this.packs.get(placeId);
    return p ? [...new Set(p.facts.map((f) => f.kind))] : null;
  }
}

export interface DemoData {
  source: FixtureSource;
  evidence: FixtureEvidence;
}

export function demoDataFrom(places: PlaceCandidate[], packs: EvidencePack[]): DemoData {
  return { source: new FixtureSource(places), evidence: new FixtureEvidence(packs) };
}
