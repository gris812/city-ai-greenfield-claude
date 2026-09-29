import type { Directive } from '@city/core';
import { describe, expect, it } from 'vitest';
import { DirectiveSequencer, TurnGate, type Envelope } from '../src/sequencer.js';

const state: Directive = { type: 'state', regime: 'walking', density: 'urban', driveSafe: false, simulated: false, silence: null };
const env = (seq: number, turn: number | null = null, directive: Directive = state): Envelope => ({ seq, turn, directive });

describe('DirectiveSequencer (E3: exactly once, in order)', () => {
  it('applies contiguous envelopes immediately', () => {
    const s = new DirectiveSequencer();
    expect(s.accept([env(1), env(2)]).map((e) => e.seq)).toEqual([1, 2]);
    expect(s.lastSeq).toBe(2);
    expect(s.hasGap).toBe(false);
  });

  it('drops duplicates (resume replay overlapping live delivery)', () => {
    const s = new DirectiveSequencer();
    s.accept([env(1), env(2), env(3)]);
    expect(s.accept([env(2), env(3)])).toEqual([]);
    expect(s.duplicates).toBe(2);
  });

  it('buffers ahead of a gap and releases in order once filled', () => {
    const s = new DirectiveSequencer();
    s.accept(env(1));
    expect(s.accept([env(4), env(3)])).toEqual([]);
    expect(s.hasGap).toBe(true);
    expect(s.missingFrom).toBe(2);
    expect(s.accept(env(2)).map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(s.hasGap).toBe(false);
  });

  it('a live directive overtaking the resume replay is not lost', () => {
    // client had 5; socket reconnects; live #9 arrives before replay #6..#8
    const s = new DirectiveSequencer(5);
    expect(s.accept(env(9))).toEqual([]);
    expect(s.accept([env(6), env(7), env(8)]).map((e) => e.seq)).toEqual([6, 7, 8, 9]);
  });

  it('skipGap releases the buffered tail when the gap cannot be filled', () => {
    const s = new DirectiveSequencer(1);
    s.accept([env(5), env(6)]);
    expect(s.skipGap().map((e) => e.seq)).toEqual([5, 6]);
    expect(s.skipped).toBe(3);
    expect(s.lastSeq).toBe(6);
  });
});

describe('TurnGate', () => {
  const say: Directive = { type: 'say', text: 'x', audioUrl: null, purpose: 'answer' };
  const stop: Directive = { type: 'stop_audio', reason: 'barge_in' };

  it('drops audio of turns older than the latest stop_audio', () => {
    const g = new TurnGate();
    expect(g.admit(say, 1)).toBe(true);
    expect(g.admit(stop, 3)).toBe(true);
    expect(g.admit(say, 2)).toBe(false);
    expect(g.admit(say, 3)).toBe(true);
    expect(g.admit(state, 1)).toBe(true); // non-audio directives always pass
  });

  it('local barge-in makes in-flight answers of seen turns stale, newer turns pass', () => {
    const g = new TurnGate();
    g.admit(say, 4);
    g.bargeIn();
    expect(g.admit(say, 4)).toBe(false);
    expect(g.admit(say, 5)).toBe(true);
    expect(g.admit(say, null)).toBe(true); // ambient narration is not turn-scoped
  });
});
