/**
 * Replay scenarios. A scenario is ONLY a trace + guide + locale (+ optional route hint):
 * there is no per-city configuration — every scenario runs against the same global
 * FixturePlaceSource and the same core code path (acceptance A7).
 */
import { EMIL, IDA } from '@city/core';
import type { Scenario } from './run.js';

export const SCENARIOS: Scenario[] = [
  {
    name: 'wtc-walk',
    trace: 'wtc-walk',
    guide: IDA,
    locale: 'en-US',
    acceptance: ['A1', 'A7'],
    description: 'Dense-urban walk toward the 9/11 Memorial area.',
  },
  {
    name: 'art-institute-walk',
    trace: 'art-institute-walk',
    guide: IDA,
    locale: 'en-US',
    acceptance: ['A3', 'A4', 'A7'],
    description: 'Walk on Michigan Ave to the Art Institute and into Millennium Park (includes a thin-evidence venue).',
  },
  {
    name: 'golden-gate',
    trace: 'golden-gate-drive-walk',
    guide: EMIL,
    locale: 'en-US',
    acceptance: ['A2', 'A7', 'A6'],
    description: 'Drive across the Golden Gate Bridge, park at the vista point, walk.',
  },
  {
    name: 'interstate',
    trace: 'i40-westbound',
    guide: EMIL,
    locale: 'en-US',
    acceptance: ['A5', 'E1', 'F1'],
    description: 'Interstate truck run without navigation: heading-projected corridor, sparse POIs, long silences.',
  },
  {
    name: 'interstate-routed',
    trace: 'i40-westbound',
    guide: EMIL,
    locale: 'en-US',
    useRoute: true,
    acceptance: ['A5', 'F1'],
    description: 'Same Interstate run with a navigation route hint: route-polyline corridor.',
  },
  {
    name: 'transition',
    trace: 'highway-to-downtown-walk',
    guide: IDA,
    locale: 'en-US',
    acceptance: ['A6', 'E1'],
    description: 'highway → outskirts → urban → dense downtown → parked → walking, one continuous session.',
  },
];

export function scenarioByName(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
