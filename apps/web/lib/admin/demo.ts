/**
 * DEMO DATA — deterministic, obviously synthetic sample payloads used ONLY when the operator
 * explicitly turns on the "Demo data" toggle in the console preview (no API connected).
 * Every chart rendered from these carries a "Demo data" label. Never shown as real.
 */
import type { CostResp, GeoResp, LatencyResp, OverviewResp, ProvidersResp, QualityResp } from './types';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 27 - (n - 1 - i)));
    return d.toISOString().slice(0, 10);
  });

export const DEMO: Record<string, unknown> = {
  '/v1/admin/metrics/overview': {
    rangeDays: 7,
    active: { dau: 42, wau: 180, mau: 510 },
    sessions: { sessions: 640, guest_sessions: 560, account_sessions: 80, avg_duration_s: 1260, simulated: 120 },
    funnel: { story_offered: 2400, story_started: 2100, story_completed: 1500, story_skipped: 260, story_interrupted: 340, question_asked: 410, nearby_search: 150 },
    guideMix: [
      { guide_id: 'ida', n: 390 },
      { guide_id: 'emil', n: 250 },
    ],
    regimeMix: [
      { regime: 'walking', n: 1200 },
      { regime: 'stationary', n: 260 },
      { regime: 'urban_driving', n: 380 },
      { regime: 'highway_driving', n: 260 },
    ],
  } satisfies OverviewResp,
  '/v1/admin/metrics/latency': {
    interactions: [
      { interaction: 'trigger_to_first_audio', n: 2100, p50: 1400, p95: 3100, max: 7400 },
      { interaction: 'cached_story_to_first_audio', n: 600, p50: 260, p95: 700, max: 1900 },
      { interaction: 'bargein_stop', n: 340, p50: 90, p95: 240, max: 610 },
      { interaction: 'speech_end_to_first_audio', n: 410, p50: 1300, p95: 2600, max: 5200 },
      { interaction: 'nearby_to_result', n: 150, p50: 800, p95: 1900, max: 3900 },
    ],
  } satisfies LatencyResp,
  '/v1/admin/metrics/cost': (() => {
    const r = rng(7);
    const byDay = days(14).map((day) => ({ day, usd: Math.round((6 + r() * 5) * 100) / 100 }));
    const total = byDay.reduce((s, d) => s + d.usd, 0);
    return {
      note: 'DEMO DATA',
      totalUsd: total,
      perSessionUsd: total / 640,
      perActiveUserUsd: total / 510,
      byProvider: [
        { provider: 'tts', category: 'tts', usd: total * 0.44, calls: 21000 },
        { provider: 'llm', category: 'llm', usd: total * 0.31, calls: 3100 },
        { provider: 'places', category: 'maps', usd: total * 0.19, calls: 5200 },
        { provider: 'knowledge', category: 'knowledge', usd: total * 0.06, calls: 9800 },
      ],
      byTask: [
        { task: 'tts_segment', usd: total * 0.44, calls: 21000 },
        { task: 'story_generation', usd: total * 0.27, calls: 2100 },
        { task: 'discovery', usd: total * 0.17, calls: 4700 },
        { task: 'intent', usd: total * 0.04, calls: 1000 },
        { task: 'evidence', usd: total * 0.08, calls: 9800 },
      ],
      byDay,
    } satisfies CostResp;
  })(),
  '/v1/admin/metrics/providers': {
    calls: [
      { provider: 'tts', category: 'tts', task: 'tts_segment', calls: 21000, errors: 42, cache_hits: 9100, p50_ms: 380, p95_ms: 900 },
      { provider: 'llm', category: 'llm', task: 'story_generation', calls: 2100, errors: 18, cache_hits: 0, p50_ms: 1100, p95_ms: 2600 },
      { provider: 'places', category: 'maps', task: 'discovery', calls: 4700, errors: 9, cache_hits: 2600, p50_ms: 240, p95_ms: 700 },
      { provider: 'knowledge', category: 'knowledge', task: 'evidence', calls: 9800, errors: 30, cache_hits: 7400, p50_ms: 180, p95_ms: 520 },
    ],
    cacheByLayer: [
      { layer: 'discovery', hits: 2600, lookups: 4700, hit_rate: 0.55 },
      { layer: 'density_probe', hits: 900, lookups: 1300, hit_rate: 0.69 },
      { layer: 'evidence', hits: 7400, lookups: 9800, hit_rate: 0.76 },
      { layer: 'tts_segment', hits: 9100, lookups: 21000, hit_rate: 0.43 },
    ],
    errors: [
      { provider: 'llm', kind: 'timeout', n: 12 },
      { provider: 'tts', kind: 'http_5xx', n: 30 },
    ],
  } satisfies ProvidersResp,
  '/v1/admin/metrics/quality': {
    not_that_one: 38,
    skips: 260,
    stories: 2100,
    grounding_failures: 21,
    template_fallbacks: 64,
    avg_rating: 4.3,
    feedback_count: 120,
  } satisfies QualityResp,
  '/v1/admin/metrics/geo': {
    kAnonymity: 5,
    precision: 5,
    cells: [
      { geohash5: 'dr5re', sessions: 80, events: 3000 },
      { geohash5: 'dr5ru', sessions: 44, events: 1500 },
      { geohash5: 'dp3wn', sessions: 61, events: 2100 },
      { geohash5: 'dp3wj', sessions: 25, events: 800 },
      { geohash5: '9q8zn', sessions: 37, events: 1200 },
      { geohash5: '9whp5', sessions: 9, events: 300 },
      { geohash5: '9wd7x', sessions: 6, events: 200 },
    ],
  } satisfies GeoResp,
};
