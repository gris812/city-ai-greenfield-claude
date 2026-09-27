/**
 * D-004 / C-001: production core must not know any city. Fails the build if any file in
 * packages/core/src mentions a fixture city/landmark or imports from fixtures/.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FORBIDDEN = ['New York', 'Manhattan', 'Chicago', 'San Francisco', 'Golden Gate', 'World Trade', 'Art Institute', 'Нью-Йорк', 'Чикаго'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no city coupling in packages/core/src', () => {
  const files = walk(SRC);

  it('scans a non-trivial set of source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const f of files) {
    it(`${relative(SRC, f)} has no city names and no fixture imports`, () => {
      const text = readFileSync(f, 'utf8');
      const lower = text.toLowerCase();
      const hits = FORBIDDEN.filter((w) => lower.includes(w.toLowerCase()));
      expect(hits).toEqual([]);
      expect(/from\s+['"][^'"]*fixtures/.test(text) || /import\(\s*['"][^'"]*fixtures/.test(text) || /require\(\s*['"][^'"]*fixtures/.test(text)).toBe(false);
    });
  }
});
