/**
 * Fixture-backed providers — ONLY for DEMO_MODE=1 and tests (D-005). Loaded lazily so a
 * production process without DEMO_MODE never imports fixture code. Everything returned is
 * labelled `fake: true`, surfaced in /readyz and in the `state` directive (`simulated`).
 */
import type { DiscoveryQuery, EvidencePack, Locale, PlaceCandidate } from '@city/core';
import type { CallContext, KnowledgeSource, PlaceSource } from '@city/providers';

export async function fixtureProviders(): Promise<{ places: PlaceSource; knowledge: KnowledgeSource }> {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== '1') throw new Error('fixture providers require DEMO_MODE=1 (D-005)');
  const { FixturePlaceSource, FixtureEvidence } = await import('@city/replay');
  const src = new FixturePlaceSource();
  const ev = new FixtureEvidence();
  const places: PlaceSource & { calls: number } = {
    name: 'fixture',
    model: 'fixture',
    fake: true,
    calls: 0,
    async query(q: DiscoveryQuery, _ctx?: CallContext): Promise<PlaceCandidate[]> {
      this.calls++;
      return src.querySync(q);
    },
  };
  const knowledge: KnowledgeSource = {
    name: 'fixture',
    model: 'fixture',
    fake: true,
    async evidence(place: PlaceCandidate, _locale: Locale): Promise<EvidencePack | null> {
      const p = ev.get(place.id);
      if (!p) return null;
      return { ...p, thin: ev.isThin(place.id) };
    },
  };
  return { places, knowledge };
}
