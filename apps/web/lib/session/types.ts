import type { ContextFrame, DensityClass, Directive, MovementRegime, SuppressionReason } from '@city/core';

export type TransportKind = 'local' | 'live';

export type ControlAction = 'skip' | 'pause' | 'resume' | 'stop' | 'repeat' | 'not_that_one' | 'quieter' | 'chattier' | 'interrupt';

export interface AudioProgressMsg {
  planId: string;
  segmentIndex: number;
  offsetMs: number;
  state: 'playing' | 'finished' | 'stopped';
}

/** One row of the live decision timeline (debug drawer). */
export interface DebugEntry {
  /** Wall clock (ms) when logged. */
  wall: number;
  /** Journey time (ms); simulation time when simulated. */
  t: number;
  regime: MovementRegime;
  density: DensityClass;
  speedMps: number;
  decision: string;
  reason?: string | null;
  target?: string | null;
  best?: string | null;
  bestScore?: number | null;
  eligible?: number;
  suppressed?: Partial<Record<SuppressionReason, number>>;
  trajectory?: string;
  refresh?: string | null;
  policy?: { nearRadiusM: number; lookAheadMaxM: number; minGapS: number; speakThreshold: number; maxStoryS: number };
  /** Top candidates (for the map "ahead" rings and debug). */
  top?: Array<{ id: string; name: string; score: number; eligible: boolean; reasons: string[]; lat: number; lng: number; relative: string; distanceM: number }>;
  source: 'local-core' | 'server';
  note?: string;
}

export interface TransportEvents {
  directive: (d: Directive, seq: number) => void;
  debug: (e: DebugEntry) => void;
  status: (s: TransportStatus) => void;
}

export interface TransportStatus {
  kind: TransportKind;
  connected: boolean;
  sessionId: string | null;
  detail?: string;
  /** Live: using REST fallback because WS is down. */
  degraded?: boolean;
}

export interface SessionOptions {
  guideId: string;
  locale: string;
  units: 'metric' | 'imperial';
  simulated: boolean;
  talkativeness: number;
}

export interface Transport {
  readonly kind: TransportKind;
  start(opts: SessionOptions): Promise<void>;
  sendContext(frame: Omit<ContextFrame, 'sessionId' | 'seq'>): void;
  sendControl(action: ControlAction, extra?: Record<string, unknown>): void;
  sendUtterance(text: string, speechEndAt: number): void;
  sendAudioProgress(p: AudioProgressMsg): void;
  setGuide(guideId: string): void;
  setTalkativeness(n: number): void;
  setLocale(locale: string, units: 'metric' | 'imperial'): void;
  /** Wipe server-side journey memory (new session). */
  reset(opts: SessionOptions): Promise<void>;
  close(): void;
  readonly sessionId: string | null;
}
