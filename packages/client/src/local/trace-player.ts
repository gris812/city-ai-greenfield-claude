/**
 * TracePlayer — replays a fixture trace (simulation / demo) on a virtual clock, ×1–×20.
 * Pure: the caller advances it with wall-clock deltas. Every emitted fix is re-stamped onto the
 * virtual clock and marked `source: 'simulated'`; frames built from it must carry
 * `simulated: true` (ContextFrame contract) and the UI must show the simulation banner.
 */
import type { GeoFix, LatLng } from '@city/core';
import type { TraceFile } from './fixtures.js';

export interface TracePlayerState {
  playing: boolean;
  speed: number;
  elapsedMs: number;
  durationMs: number;
  done: boolean;
  position: (LatLng & { headingDeg: number | null; speedMps: number | null }) | null;
}

export class TracePlayer {
  private idx = 0;
  private readonly epoch: number;
  readonly clockBase: number;
  state: TracePlayerState;

  constructor(
    readonly trace: TraceFile,
    wallNow: number,
  ) {
    this.epoch = trace.fixes[0]?.t ?? 0;
    this.clockBase = wallNow;
    const first = trace.fixes[0];
    const dur = (trace.durationS || ((trace.fixes.at(-1)?.t ?? 0) - this.epoch) / 1000) * 1000;
    this.state = {
      playing: false,
      speed: 1,
      elapsedMs: 0,
      durationMs: dur,
      done: false,
      position: first ? { lat: first.lat, lng: first.lng, headingDeg: first.headingDeg ?? null, speedMps: first.speedMps ?? null } : null,
    };
  }

  /** Virtual now (epoch ms) — use for clientTime while simulating. */
  now(): number {
    return this.clockBase + this.state.elapsedMs;
  }

  play(): void {
    if (!this.state.done) this.state = { ...this.state, playing: true };
  }
  pause(): void {
    this.state = { ...this.state, playing: false };
  }
  setSpeed(n: number): void {
    this.state = { ...this.state, speed: Math.max(1, Math.min(20, Math.round(n))) };
  }

  /** Advance by a wall-clock delta; returns the fixes that became due (oldest first). */
  advance(wallDtMs: number): GeoFix[] {
    if (!this.state.playing || this.state.done) return [];
    const dt = Math.max(0, Math.min(1000, wallDtMs)) * this.state.speed;
    const elapsed = Math.min(this.state.durationMs, this.state.elapsedMs + dt);
    const upTo = this.epoch + elapsed;
    const out: GeoFix[] = [];
    const fixes = this.trace.fixes;
    while (this.idx < fixes.length && fixes[this.idx]!.t <= upTo) {
      const f = fixes[this.idx]!;
      out.push({ ...f, t: this.clockBase + (f.t - this.epoch), source: 'simulated' });
      this.idx++;
    }
    const done = this.idx >= fixes.length;
    const last = out.at(-1);
    this.state = {
      ...this.state,
      elapsedMs: elapsed,
      done,
      playing: done ? false : this.state.playing,
      position: last ? { lat: last.lat, lng: last.lng, headingDeg: last.headingDeg ?? this.state.position?.headingDeg ?? null, speedMps: last.speedMps ?? null } : this.state.position,
    };
    return out;
  }
}

/** Drop GPS jitter (points within `minM` of the previous kept point) for drawing a route band. */
export function simplifyPath(points: LatLng[], minM = 15, dist: (a: LatLng, b: LatLng) => number): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || dist(last, p) >= minM) out.push({ lat: p.lat, lng: p.lng });
  }
  return out;
}
