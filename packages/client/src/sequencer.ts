/**
 * Exactly-once, in-order directive delivery on the client (E3).
 *
 * The server stamps every directive with a contiguous per-session `seq`. Directives can reach
 * the client over the WebSocket, as the reply to a REST fallback call, or as the replay that
 * answers `resume {lastDirectiveSeq}` — and those paths can interleave (a live directive can
 * overtake the resume replay on a fresh socket; REST replies only carry the directives of that
 * call). The sequencer applies `lastSeq + 1` immediately, buffers anything ahead of a gap,
 * and reports the gap so the transport can fill it via `GET /directives?after=lastSeq`. If the
 * gap cannot be filled (outbox already trimmed), `skipGap()` releases the buffered tail in order.
 * Anything with `seq <= lastSeq` is a duplicate and is dropped — a story or tool action is
 * therefore never applied twice across reconnects.
 */
import type { Directive } from '@city/core';

export interface Envelope {
  seq: number;
  turn: number | null;
  ref?: string | null;
  directive: Directive;
}

export class DirectiveSequencer {
  private last: number;
  private buf = new Map<number, Envelope>();
  duplicates = 0;
  skipped = 0;

  constructor(lastSeq = 0) {
    this.last = lastSeq;
  }

  get lastSeq(): number {
    return this.last;
  }

  get hasGap(): boolean {
    return this.buf.size > 0;
  }

  /** Lowest missing seq when there is a gap. */
  get missingFrom(): number | null {
    return this.buf.size > 0 ? this.last + 1 : null;
  }

  /** Offer envelopes (any order); returns those now ready to apply, in seq order. */
  accept(envs: Envelope | Envelope[]): Envelope[] {
    for (const e of Array.isArray(envs) ? envs : [envs]) {
      if (!Number.isInteger(e.seq) || e.seq <= this.last || this.buf.has(e.seq)) {
        this.duplicates++;
        continue;
      }
      this.buf.set(e.seq, e);
    }
    return this.drain();
  }

  private drain(): Envelope[] {
    const out: Envelope[] = [];
    for (;;) {
      const next = this.buf.get(this.last + 1);
      if (!next) break;
      this.buf.delete(next.seq);
      this.last = next.seq;
      out.push(next);
    }
    return out;
  }

  /** Give up on the missing range: release buffered envelopes in order. */
  skipGap(): Envelope[] {
    if (this.buf.size === 0) return [];
    const min = Math.min(...this.buf.keys());
    this.skipped += min - this.last - 1;
    this.last = min - 1;
    return this.drain();
  }

  reset(lastSeq = 0): void {
    this.last = lastSeq;
    this.buf.clear();
    this.duplicates = 0;
    this.skipped = 0;
  }
}

/**
 * Turn gate (docs/API.md: "clients drop audio for turns older than the latest stop_audio").
 * Also used for local barge-in: once the user presses the mic, any audio already in flight for
 * a turn we have seen is stale; the answer arrives in a newer turn.
 */
export class TurnGate {
  private maxTurn = -1;
  private floor = -1;

  /** Returns false when the directive must not be applied. */
  admit(d: Directive, turn: number | null): boolean {
    if (turn !== null) this.maxTurn = Math.max(this.maxTurn, turn);
    if (d.type === 'stop_audio' && turn !== null) this.floor = Math.max(this.floor, turn - 1);
    if ((d.type === 'play' || d.type === 'say') && turn !== null && turn <= this.floor) return false;
    return true;
  }

  /** Local barge-in: everything from turns seen so far is stale. */
  bargeIn(): void {
    this.floor = Math.max(this.floor, this.maxTurn);
  }

  reset(): void {
    this.maxTurn = -1;
    this.floor = -1;
  }
}
