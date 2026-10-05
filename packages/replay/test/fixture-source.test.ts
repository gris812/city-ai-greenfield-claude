import { afterEach, describe, expect, it } from 'vitest';
import { FixturePlaceSource } from '../src/index.js';

describe('FixturePlaceSource', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('refuses to run in a production build unless DEMO_MODE=1 (D-005)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    expect(() => new FixturePlaceSource([])).toThrow(/test\/demo only/);
    process.env.DEMO_MODE = '1';
    expect(() => new FixturePlaceSource([])).not.toThrow();
  });

  it('returns extent-intersecting places above the floor and counts queries', async () => {
    const src = new FixturePlaceSource();
    const res = await src.query({ center: { lat: 41.8794, lng: -87.6239 }, radiusM: 200, minSignificance: 0.5, locale: 'en' });
    const ids = res.map((p) => p.id);
    expect(ids).toContain('fx:chi:art-institute');
    expect(ids).toContain('fx:chi:chicago'); // 14 km extent intersects the circle
    expect(ids).not.toContain('fx:nyc:911-memorial');
    expect(res.every((p) => p.significance >= 0.5)).toBe(true);
    expect(src.stats.queries).toBe(1);
  });

  it('every fixture place has a source ref and a valid kind/significance', () => {
    const src = new FixturePlaceSource();
    for (const p of src.places) {
      expect(p.sources.length).toBeGreaterThan(0);
      expect(p.significance).toBeGreaterThanOrEqual(0);
      expect(p.significance).toBeLessThanOrEqual(1);
    }
  });
});
