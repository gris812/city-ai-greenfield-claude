/**
 * Location sources for the WebApp: replayed fixture traces (simulation, ×1–×20), a manually
 * dragged puck, or the device's real geolocation. Simulated fixes are always marked
 * `source: 'simulated'` and frames carry `simulated: true` (ContextFrame contract), and the
 * UI shows a "Simulated location" banner whenever one of the simulated sources is active.
 *
 * Time: simulation uses a virtual clock (epoch-based, rebased to wall time at start) so the
 * journey clock advances at the simulation speed; audio playback stays real-time.
 */
import type { GeoFix, LatLng } from '@city/core';
import { haversineM, initialBearingDeg } from '@city/core';
import type { TraceFile } from '../local/demo-data';

export type SourceMode = 'idle' | 'trace' | 'manual' | 'gps';

export interface DriverState {
  mode: SourceMode;
  scenario: string | null;
  playing: boolean;
  speed: number;
  elapsedMs: number;
  durationMs: number;
  done: boolean;
  position: (LatLng & { headingDeg: number | null }) | null;
  route: LatLng[] | null;
  gpsError?: string | null;
}

export interface DriverSink {
  fixes(fixes: GeoFix[], clientTime: number, route: LatLng[] | null): void;
  /** Empty frame so the director can re-evaluate while nothing moves (resume, cadence). */
  heartbeat(clientTime: number): void;
  state(s: DriverState): void;
}

export class LocationDriver {
  private s: DriverState = { mode: 'idle', scenario: null, playing: false, speed: 1, elapsedMs: 0, durationMs: 0, done: false, position: null, route: null };
  private trace: TraceFile | null = null;
  private idx = 0;
  private simEpoch = 0;
  private clockBase = 0;
  private lastWall = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEmit = 0;
  private lastHeartbeat = 0;
  private manualTarget: LatLng | null = null;
  private manualLast: { p: LatLng; t: number } | null = null;
  private gpsWatch: number | null = null;
  private useRoute = false;

  constructor(private readonly sink: DriverSink) {}

  /** Virtual now (ms epoch) used for clientTime and fix timestamps. */
  now(): number {
    if (this.s.mode === 'gps') return Date.now();
    return this.clockBase + this.s.elapsedMs;
  }

  get state(): DriverState {
    return this.s;
  }

  private set(p: Partial<DriverState>): void {
    this.s = { ...this.s, ...p };
    this.sink.state(this.s);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.lastWall = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  loadTrace(name: string, trace: TraceFile, opts: { useRoute?: boolean } = {}): void {
    this.stopGps();
    this.trace = trace;
    this.idx = 0;
    this.useRoute = Boolean(opts.useRoute);
    this.simEpoch = trace.fixes[0]?.t ?? 0;
    this.clockBase = Date.now();
    const first = trace.fixes[0];
    this.set({
      mode: 'trace',
      scenario: name,
      playing: false,
      elapsedMs: 0,
      durationMs: (trace.durationS || ((trace.fixes.at(-1)?.t ?? 0) - this.simEpoch) / 1000) * 1000,
      done: false,
      position: first ? { lat: first.lat, lng: first.lng, headingDeg: first.headingDeg ?? null } : null,
      route: trace.route ?? trace.fixes.filter((_, i) => i % 5 === 0).map((f) => ({ lat: f.lat, lng: f.lng })),
    });
    this.ensureTimer();
  }

  play(): void {
    if (this.s.mode !== 'trace') return;
    this.lastWall = performance.now();
    this.set({ playing: true, done: false });
    this.ensureTimer();
  }
  pause(): void {
    this.set({ playing: false });
  }
  setSpeed(speed: number): void {
    this.set({ speed: Math.max(1, Math.min(20, speed)) });
  }

  /** Switch to manual puck mode at the current (or given) position. Time runs at ×1. */
  startManual(at?: LatLng): void {
    this.stopGps();
    const p = at ?? this.s.position ?? { lat: 40.7115, lng: -74.0125 };
    if (this.s.mode !== 'trace' && this.s.mode !== 'manual') this.clockBase = Date.now();
    this.manualTarget = p;
    this.manualLast = null;
    this.set({ mode: 'manual', playing: true, speed: 1, position: { ...p, headingDeg: this.s.position?.headingDeg ?? null }, done: false });
    this.ensureTimer();
  }

  dragTo(p: LatLng): void {
    if (this.s.mode !== 'manual') this.startManual(p);
    this.manualTarget = p;
  }

  startGps(): void {
    this.stopTimerOnly();
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.set({ gpsError: 'Geolocation is not available in this browser.' });
      return;
    }
    this.set({ mode: 'gps', scenario: null, playing: true, route: null, gpsError: null });
    this.gpsWatch = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const fix: GeoFix = {
          t: pos.timestamp || Date.now(),
          lat: c.latitude,
          lng: c.longitude,
          accuracyM: c.accuracy,
          speedMps: c.speed,
          headingDeg: c.heading,
          altitudeM: c.altitude,
          source: 'gps',
        };
        this.set({ position: { lat: fix.lat, lng: fix.lng, headingDeg: fix.headingDeg ?? null } });
        this.sink.fixes([fix], Date.now(), null);
      },
      (err) => this.set({ gpsError: err.message || 'Location permission denied.' }),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 },
    );
    this.timer = setInterval(() => {
      const wall = performance.now();
      if (wall - this.lastHeartbeat > 2000) {
        this.lastHeartbeat = wall;
        this.sink.heartbeat(Date.now());
      }
    }, 1000);
  }

  private stopTimerOnly(): void {
    this.stopTimer();
  }

  private stopGps(): void {
    if (this.gpsWatch !== null && typeof navigator !== 'undefined') navigator.geolocation.clearWatch(this.gpsWatch);
    this.gpsWatch = null;
    if (this.s.mode === 'gps') this.stopTimer();
  }

  stop(): void {
    this.stopGps();
    this.stopTimer();
    this.trace = null;
    this.set({ mode: 'idle', scenario: null, playing: false, elapsedMs: 0, durationMs: 0, done: false, route: null });
  }

  private tick(): void {
    const wall = performance.now();
    const dt = Math.min(1000, wall - this.lastWall);
    this.lastWall = wall;
    if (this.s.mode === 'trace' && this.trace) {
      if (this.s.playing && !this.s.done) {
        const elapsed = Math.min(this.s.durationMs, this.s.elapsedMs + dt * this.s.speed);
        const upTo = this.simEpoch + elapsed;
        const batch: GeoFix[] = [];
        const fixes = this.trace.fixes;
        while (this.idx < fixes.length && fixes[this.idx]!.t <= upTo) {
          const f = fixes[this.idx]!;
          batch.push({ ...f, t: this.clockBase + (f.t - this.simEpoch), source: 'simulated' });
          this.idx++;
        }
        const done = this.idx >= fixes.length;
        const last = batch.at(-1);
        this.s = {
          ...this.s,
          elapsedMs: elapsed,
          done,
          playing: done ? false : this.s.playing,
          position: last ? { lat: last.lat, lng: last.lng, headingDeg: last.headingDeg ?? this.s.position?.headingDeg ?? null } : this.s.position,
        };
        // One frame per fix, like the replay harness (1 Hz traces); the engine batches nothing.
        for (const f of batch) this.sink.fixes([f], f.t, this.useRoute ? this.trace.route : null);
        if (wall - this.lastEmit > 200 || done) {
          this.lastEmit = wall;
          this.sink.state(this.s);
        }
        if (batch.length === 0) this.maybeHeartbeat();
      } else this.maybeHeartbeat();
      return;
    }
    if (this.s.mode === 'manual') {
      this.s = { ...this.s, elapsedMs: this.s.elapsedMs + dt };
      const now = this.now();
      if (!this.manualLast || now - this.manualLast.t >= 1000) {
        const p = this.manualTarget ?? this.s.position;
        if (!p) return;
        const prev = this.manualLast?.p ?? null;
        const moved = prev ? haversineM(prev, p) : 0;
        const heading = prev && moved > 0.5 ? initialBearingDeg(prev, p) : (this.s.position?.headingDeg ?? null);
        const fix: GeoFix = { t: now, lat: p.lat, lng: p.lng, accuracyM: 5, speedMps: null, headingDeg: heading, source: 'simulated' };
        this.manualLast = { p, t: now };
        this.s = { ...this.s, position: { lat: p.lat, lng: p.lng, headingDeg: heading } };
        this.sink.fixes([fix], now, null);
        this.sink.state(this.s);
      }
    }
  }

  private maybeHeartbeat(): void {
    const wall = performance.now();
    if (wall - this.lastHeartbeat < 1000) return;
    this.lastHeartbeat = wall;
    this.sink.heartbeat(this.now());
  }

  dispose(): void {
    this.stopGps();
    this.stopTimer();
  }
}
