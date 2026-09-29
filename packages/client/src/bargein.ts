/**
 * Barge-in / listening state machine (C1, B3). Tracks the press → audio silent → listening →
 * utterance/cancel sequence and measures the stop latency (mic press → output verified silent),
 * which the client reports to the server (`control interrupt {bargeInStopMs}`) and shows in debug.
 *
 *   idle ──press──▶ stopping ──silent──▶ listening ──submit──▶ awaiting ──answer/timeout──▶ idle
 *                                          └──cancel──▶ idle
 */

export type ListenPhase = 'idle' | 'stopping' | 'listening' | 'awaiting';

export interface BargeInSample {
  at: number;
  stopMs: number;
  /** Whether audio was actually playing when the user pressed. */
  wasPlaying: boolean;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo]! + (s[hi]! - s[lo]!) * (rank - lo);
}

export class BargeInTracker {
  phase: ListenPhase = 'idle';
  private pressAt = 0;
  private wasPlaying = false;
  private submitAt = 0;
  readonly samples: BargeInSample[] = [];
  /** speech end → first answer audio (ms), measured when the answer starts. */
  readonly responseMs: number[] = [];

  constructor(
    private readonly now: () => number,
    private readonly maxSamples = 50,
  ) {}

  /** Mic pressed. Returns false when a press is already in progress (debounce). */
  press(wasPlaying: boolean): boolean {
    if (this.phase === 'stopping' || this.phase === 'listening') return false;
    this.phase = 'stopping';
    this.pressAt = this.now();
    this.wasPlaying = wasPlaying;
    return true;
  }

  /** Output verified silent; returns the measured stop latency (ms). */
  silent(): number {
    const ms = Math.max(0, this.now() - this.pressAt);
    if (this.phase === 'stopping') {
      this.phase = 'listening';
      if (this.wasPlaying) {
        this.samples.unshift({ at: this.now(), stopMs: Math.round(ms * 10) / 10, wasPlaying: true });
        if (this.samples.length > this.maxSamples) this.samples.pop();
      }
    }
    return ms;
  }

  submit(): void {
    if (this.phase !== 'listening' && this.phase !== 'stopping') return;
    this.phase = 'awaiting';
    this.submitAt = this.now();
  }

  cancel(): void {
    this.phase = 'idle';
  }

  /** First audio of the answer started (or any reply arrived). */
  answered(): number | null {
    if (this.phase !== 'awaiting') return null;
    const ms = this.now() - this.submitAt;
    this.phase = 'idle';
    this.responseMs.unshift(ms);
    if (this.responseMs.length > this.maxSamples) this.responseMs.pop();
    return ms;
  }

  /** Awaiting too long (network): return to idle so the UI never sticks. */
  expire(timeoutMs: number): boolean {
    if (this.phase === 'awaiting' && this.now() - this.submitAt > timeoutMs) {
      this.phase = 'idle';
      return true;
    }
    return false;
  }

  get stopP50(): number | null {
    return percentile(this.samples.map((s) => s.stopMs), 50);
  }
  get stopP95(): number | null {
    return percentile(this.samples.map((s) => s.stopMs), 95);
  }
}
