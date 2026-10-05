/**
 * FrameBatcher — folds raw location fixes into ContextFrames at the cadence docs/API.md asks
 * for: every 1–2 s while moving, every 10 s while stationary (batched fixes). Pure: time is
 * passed in, so the same code drives the mobile foreground watcher, the background task
 * buffer and unit tests.
 *
 * It never filters fixes for *product* reasons (D-002: the server's regime tracker rejects
 * GPS jumps); it only de-duplicates (same or older timestamp) and caps the batch size to the
 * server schema limit.
 */
import type { ClientAudioState, ContextFrame, GeoFix, RouteHint } from '@city/core';

export const MAX_FIXES_PER_FRAME = 120;

export interface BatcherOptions {
  /** Flush interval while moving (ms). */
  movingIntervalMs: number;
  /** Flush interval while stationary / no new fixes (heartbeat, ms). */
  stationaryIntervalMs: number;
  /** Speed at or above which the user counts as moving (m/s). */
  movingSpeedMps: number;
}

export const DEFAULT_BATCHER: BatcherOptions = { movingIntervalMs: 1000, stationaryIntervalMs: 10_000, movingSpeedMps: 0.8 };

export interface FrameExtras {
  appState: ContextFrame['appState'];
  audio: ClientAudioState;
  lastInteractionAt: number | null;
  simulated: boolean;
  route?: RouteHint | null;
}

export type FrameBody = Omit<ContextFrame, 'sessionId' | 'seq'>;

export class FrameBatcher {
  private buf: GeoFix[] = [];
  private lastFixT = -Infinity;
  private lastFlushAt: number | null = null;
  private lastSpeed = 0;
  private forced = false;
  readonly opts: BatcherOptions;

  constructor(opts: Partial<BatcherOptions> = {}) {
    this.opts = { ...DEFAULT_BATCHER, ...opts };
  }

  /** Add one fix. Returns false when it was a duplicate / out of order. */
  push(fix: GeoFix): boolean {
    if (!(fix.t > this.lastFixT)) return false;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
    this.lastFixT = fix.t;
    this.buf.push(fix);
    if (this.buf.length > MAX_FIXES_PER_FRAME) this.buf.splice(0, this.buf.length - MAX_FIXES_PER_FRAME);
    const s = fix.speedMps;
    if (typeof s === 'number' && s >= 0) this.lastSpeed = s;
    return true;
  }

  pushAll(fixes: GeoFix[]): number {
    let n = 0;
    for (const f of [...fixes].sort((a, b) => a.t - b.t)) if (this.push(f)) n++;
    return n;
  }

  /** Something the server should hear about promptly (audio state change, interaction). */
  poke(): void {
    this.forced = true;
  }

  get pending(): number {
    return this.buf.length;
  }

  get moving(): boolean {
    return this.lastSpeed >= this.opts.movingSpeedMps;
  }

  /** Current flush interval (adaptive). */
  intervalMs(): number {
    return this.moving ? this.opts.movingIntervalMs : this.opts.stationaryIntervalMs;
  }

  /** Whether a frame should be sent now. */
  due(now: number): boolean {
    if (this.lastFlushAt === null) return this.buf.length > 0 || this.forced;
    if (this.forced) return true;
    const since = now - this.lastFlushAt;
    if (this.buf.length > 0) return since >= (this.moving ? this.opts.movingIntervalMs : Math.min(this.opts.stationaryIntervalMs, 2000));
    return since >= this.opts.stationaryIntervalMs; // heartbeat so the director can re-evaluate
  }

  /** Take the batch as a frame body (sessionId/seq are assigned by the transport). */
  take(now: number, extras: FrameExtras): FrameBody {
    const fixes = this.buf;
    this.buf = [];
    this.lastFlushAt = now;
    this.forced = false;
    return {
      fixes,
      route: extras.route ?? null,
      appState: extras.appState,
      audio: extras.audio,
      lastInteractionAt: extras.lastInteractionAt,
      clientTime: now,
      simulated: extras.simulated,
    };
  }

  reset(): void {
    this.buf = [];
    this.lastFixT = -Infinity;
    this.lastFlushAt = null;
    this.lastSpeed = 0;
    this.forced = false;
  }
}

/**
 * Merge two pending frame bodies (a transport that could not send yet keeps one pending frame,
 * appending fixes). Later scalar fields win; fixes stay ordered and capped.
 */
export function mergeFrames(a: FrameBody | null, b: FrameBody): FrameBody {
  if (!a) return { ...b, fixes: [...b.fixes] };
  const fixes = [...a.fixes, ...b.fixes];
  return { ...b, fixes: fixes.slice(Math.max(0, fixes.length - MAX_FIXES_PER_FRAME)), route: b.route ?? a.route ?? null };
}

/** Adaptive location sampling for the OS watcher: 1 Hz when moving, relaxed when still. */
export function locationSampling(speedMps: number | null | undefined, driving: boolean): { timeIntervalMs: number; distanceIntervalM: number } {
  if (driving) return { timeIntervalMs: 1000, distanceIntervalM: 0 };
  const v = typeof speedMps === 'number' && speedMps >= 0 ? speedMps : 0;
  if (v >= 0.8) return { timeIntervalMs: 1000, distanceIntervalM: 0 };
  return { timeIntervalMs: 5000, distanceIntervalM: 5 };
}
