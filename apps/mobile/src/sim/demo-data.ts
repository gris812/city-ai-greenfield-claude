/**
 * Bundled demo data (D-005: offline demo + simulation only). Generated from /fixtures by
 * scripts/prepare-assets.mjs; loaded lazily so the JSON is parsed only when demo/simulation is used.
 */
import type { EvidencePack, GeoFix, PlaceCandidate } from '@city/core';
import { DEMO_SCENARIOS, demoDataFrom, type DemoData, type DemoScenario, type TraceFile } from '@city/client';
import { decodeTrace, type CompactTrace } from '../logic/trace';

let data: DemoData | null = null;
let traces: Record<string, CompactTrace> | null = null;

function rawTraces(): Record<string, CompactTrace> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  traces ??= require('../../assets/demo/traces.json') as Record<string, CompactTrace>;
  return traces;
}

export async function loadDemoData(): Promise<DemoData> {
  if (!data) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const places = require('../../assets/demo/places.json') as PlaceCandidate[];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const evidence = require('../../assets/demo/evidence.json') as EvidencePack[];
    data = demoDataFrom(places, evidence);
  }
  return data;
}

export function availableScenarios(): DemoScenario[] {
  const t = rawTraces();
  return DEMO_SCENARIOS.filter((s) => t[s.trace]);
}

export function loadTrace(name: string): TraceFile | null {
  const c = rawTraces()[name];
  return c ? decodeTrace(c) : null;
}

export type { GeoFix };
