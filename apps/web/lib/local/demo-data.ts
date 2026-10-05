/**
 * Browser-side demo data for the clearly-labelled "Offline demo mode" (D-005): the fixture
 * POI packs, evidence packs and replay traces from /fixtures, served as static files by
 * scripts/prepare-assets.mjs. Nothing here is used by the live transport.
 *
 * The data model (FixtureSource / FixtureEvidence / scenarios) lives in @city/client and is
 * shared with apps/mobile; this module only provides the browser loaders.
 */
import type { EvidencePack, PlaceCandidate } from '@city/core';
import { demoDataFrom, type DemoData, type TraceFile } from '@city/client';

export {
  DEMO_SCENARIOS,
  FixtureEvidence as BrowserEvidence,
  FixtureSource as BrowserFixtureSource,
  type DemoData,
  type DemoScenario,
  type TraceFile,
} from '@city/client';

let dataPromise: Promise<DemoData> | null = null;
const traceCache = new Map<string, Promise<TraceFile>>();

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function loadDemoData(): Promise<DemoData> {
  dataPromise ??= Promise.all([getJson<PlaceCandidate[]>('/demo/places.json'), getJson<EvidencePack[]>('/demo/evidence.json')])
    .then(([places, packs]) => demoDataFrom(places, packs))
    .catch((e) => {
      dataPromise = null;
      throw e;
    });
  return dataPromise;
}

export function loadTrace(name: string): Promise<TraceFile> {
  let p = traceCache.get(name);
  if (!p) {
    p = getJson<TraceFile>(`/demo/traces/${name}.json`).catch((e) => {
      traceCache.delete(name);
      throw e;
    });
    traceCache.set(name, p);
  }
  return p;
}
