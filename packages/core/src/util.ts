/** Small pure helpers: deterministic hashing/ids and numeric utilities. */

/** 32-bit FNV-1a over UTF-16 code units, returned as 8 lowercase hex chars. */
export function fnv1a32(input: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 64-bit-ish stable hash (two FNV-1a passes with different seeds) — 16 hex chars. */
export function stableHash(input: string): string {
  return fnv1a32(input) + fnv1a32(input, 0x01234567);
}

/** Deterministic id: `${prefix}_${hash(parts)}`. Same inputs → same id. */
export function stableId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  return `${prefix}_${stableHash(parts.map((p) => (p === null || p === undefined ? '∅' : String(p))).join('␟'))}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Least-squares slope of y over x (0 when degenerate). */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Deterministic comparison for tie-breaking. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Round to n decimals (stable output in logs/json). */
export function round(x: number, n = 2): number {
  const k = 10 ** n;
  return Math.round(x * k) / k;
}
