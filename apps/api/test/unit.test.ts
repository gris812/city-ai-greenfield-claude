/** Service-free unit tests: city decoupling (D-004/D-005), nearby validation, log redaction, cache keys. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nearbyAnswer, validateNearby } from '../src/runtime/nearby.js';
import { REDACT_PATHS, sanitizeUrl } from '../src/logger.js';
import { placesCacheKey } from '../src/discovery-service.js';

const FORBIDDEN = ['New York', 'Manhattan', 'Chicago', 'San Francisco', 'Golden Gate', 'World Trade', 'Art Institute', 'Нью-Йорк', 'Чикаго'];
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no city coupling in production sources (api + providers)', () => {
  const roots = [fileURLToPath(new URL('../src', import.meta.url)), fileURLToPath(new URL('../../../packages/providers/src', import.meta.url))];
  const files = roots.flatMap(walk);
  it('scans files', () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    it(`${f.split('/').slice(-3).join('/')}`, () => {
      const text = readFileSync(f, 'utf8');
      expect(FORBIDDEN.filter((w) => text.toLowerCase().includes(w.toLowerCase()))).toEqual([]);
      // fixtures are only reachable through the lazily imported demo module
      if (!f.endsWith('demo.ts')) expect(/@city\/replay|fixtures\//.test(text)).toBe(false);
    });
  }
});

describe('nearby validation', () => {
  const origin = { lat: 10, lng: 20 };
  it('drops malformed, out-of-range and far results; sorts by distance', () => {
    const raw = [
      { placeId: 'b', name: 'Far Cafe', location: { lat: 10.004, lng: 20 }, kind: 'food' },
      { placeId: 'a', name: 'Near Cafe', location: { lat: 10.001, lng: 20 }, kind: 'food' },
      { placeId: '', name: 'x', location: { lat: 10, lng: 20 } },
      { placeId: 'c', name: 'Bad', location: { lat: 999, lng: 20 } },
      { placeId: 'd', name: 'Moon', location: { lat: 11, lng: 20 } },
      'garbage',
      { placeId: 'e', name: 'Weird kind', location: { lat: 10.002, lng: 20 }, kind: 'spaceship' },
    ];
    const { results, invalid } = validateNearby(raw, origin, 800, 5);
    expect(results.map((r) => r.placeId)).toEqual(['a', 'e', 'b']);
    expect(results[1]!.kind).toBe('other');
    expect(invalid).toBe(4);
    const text = nearbyAnswer(results, 'coffee', 'en-US');
    expect(text).toMatch(/^The closest is Near Cafe, about \d+ feet to the north\./);
    expect(nearbyAnswer(results, 'coffee', 'en-US', 'metric', true)).not.toContain('Also nearby');
    expect(nearbyAnswer([], 'parking', 'ru')).toContain('парковку');
  });
});

describe('logging hygiene', () => {
  it('strips tokens from URLs and redacts secrets/coordinates', () => {
    expect(sanitizeUrl('/v1/sessions/x/ws?token=abc.def&x=1')).toBe('/v1/sessions/x/ws?token=[redacted]&x=1');
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(['req.headers.authorization', '*.lat', '*.lng', '*.clientSecret']));
  });
});

describe('discovery cache key', () => {
  it('is coarse enough to pool nearby users but separates radius/locale', () => {
    const a = placesCacheKey({ center: { lat: 40.7, lng: -74 }, radiusM: 600, minSignificance: 0.2, locale: 'en-US' });
    const b = placesCacheKey({ center: { lat: 40.70001, lng: -74.00001 }, radiusM: 600, minSignificance: 0.2, locale: 'en-GB' });
    const c = placesCacheKey({ center: { lat: 40.7, lng: -74 }, radiusM: 600, minSignificance: 0.2, locale: 'ru' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
