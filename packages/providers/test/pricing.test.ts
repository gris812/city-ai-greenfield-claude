import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRICE_TABLE, PRICES_RETRIEVED_AT, computeCost, realtimeCost, type PriceRef } from '../src/pricing.js';

interface Row {
  provider: string;
  product: string;
  sku: string;
  unit: string;
  priceUsd: number;
  retrievedAt: string;
}
const rows = JSON.parse(readFileSync(fileURLToPath(new URL('../../../benchmark/research/provider_pricing.json', import.meta.url)), 'utf8')) as Row[];
const find = (r: PriceRef) => rows.find((x) => x.product === r.product && x.sku === r.sku);

describe('pricing table is derived from provider_pricing.json', () => {
  it('has the research retrieval date', () => {
    expect(new Set(rows.map((r) => r.retrievedAt))).toEqual(new Set([PRICES_RETRIEVED_AT]));
  });

  for (const [key, e] of Object.entries(PRICE_TABLE)) {
    const checks: Array<[PriceRef, number]> = [];
    if (e.kind === 'tokens' && e.refs) {
      if (e.refs.input) checks.push([e.refs.input, e.inputPerM]);
      if (e.refs.output) checks.push([e.refs.output, e.outputPerM]);
      if (e.refs.cached && e.cachedInputPerM !== undefined) checks.push([e.refs.cached, e.cachedInputPerM]);
    }
    if ((e.kind === 'characters' || e.kind === 'per_minute' || e.kind === 'per_1k_requests') && e.ref) {
      checks.push([e.ref, e.kind === 'characters' ? e.perMChars : e.kind === 'per_minute' ? e.perMinute : e.per1k]);
    }
    if (e.kind === 'tts_tokens' && e.ref) checks.push([e.ref, e.audioOutputPerM]);
    if (e.kind === 'realtime' && e.refs) {
      if (e.refs.input) checks.push([e.refs.input, e.inputPerMinute]);
      if (e.refs.output) checks.push([e.refs.output, e.outputPerMinute]);
    }
    for (const [ref, price] of checks) {
      it(`${key} ${ref.sku} = ${price}`, () => {
        const row = find(ref);
        expect(row, `${ref.product} / ${ref.sku} missing from JSON`).toBeDefined();
        expect(row!.priceUsd).toBeCloseTo(price, 6);
      });
    }
  }
});

describe('computeCost', () => {
  const at2026 = Date.parse('2026-10-01T00:00:00Z');
  const at2027 = Date.parse('2027-02-01T00:00:00Z');

  it('prices a ~1-min story on gpt-6-luna (1,500 in + 250 out) at ≈ $0.0003', () => {
    const c = computeCost('openai', 'gpt-6-luna', { inputTokens: 1500, outputTokens: 250 }, at2026);
    expect(c).toBeCloseTo(0.00015 + 0.000125, 8);
  });

  it('applies cached-input pricing', () => {
    const c = computeCost('openai', 'gpt-6-luna', { inputTokens: 1000, cachedInputTokens: 1000, outputTokens: 0 }, at2026);
    expect(c).toBeCloseTo((1000 * 0.01) / 1e6, 10);
  });

  it('switches Gemini promo prices on 2027-01-01', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(computeCost('gemini', 'gemini-3.8-flash', u, at2026)).toBeCloseTo(0.75, 6);
    expect(computeCost('gemini', 'gemini-3.8-flash', u, at2027)).toBeCloseTo(1.5, 6);
  });

  it('prices character TTS and per-minute STT', () => {
    expect(computeCost('openai', 'tts-1', { characters: 900 }, at2026)).toBeCloseTo(0.0135, 6);
    expect(computeCost('openai', 'gpt-4o-mini-transcribe', { audioSeconds: 60 }, at2026)).toBeCloseTo(0.003, 6);
  });

  it('prices token TTS by audio seconds (gemini lite TTS ≈ $0.009/min promo)', () => {
    expect(computeCost('gemini', 'gemini-3.8-flash-lite-tts', { audioSeconds: 60, inputTokens: 0 }, at2026)).toBeCloseTo(0.009, 5);
  });

  it('prices Places Nearby Pro per request and Wikimedia as free', () => {
    expect(computeCost('google_places', 'nearby_search_pro', { requests: 1 }, at2026)).toBeCloseTo(0.032, 6);
    expect(computeCost('wikimedia', 'api', { requests: 50 }, at2026)).toBe(0);
  });

  it('prices unknown LLM model ids conservatively (never silently $0)', () => {
    expect(computeCost('openai', 'gpt-99-mystery', { inputTokens: 1000, outputTokens: 1000 }, at2026, 'llm')).toBeGreaterThan(0.01);
  });

  it('prices realtime by direction', () => {
    expect(realtimeCost('gemini', 'gemini-3.8-live', 60, 60)).toBeCloseTo(0.023, 6);
    expect(realtimeCost('openai', 'gpt-realtime-2.1-mini', 60, 60)).toBeCloseTo(0.03, 6);
  });
});
