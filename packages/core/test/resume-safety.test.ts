import { describe, expect, it } from 'vitest';
import type { ActiveStoryState, CandidateGeometry, RegimeState } from '../src/index.js';
import { decideResume, decideTool, emptyToolHistory, evaluateSafety, recordToolCall } from '../src/index.js';
import { baseRegime } from './helpers.js';

const NOW = 1_000_000;

function story(over: Partial<ActiveStoryState> = {}): ActiveStoryState {
  return { planId: 'p1', placeId: 'x', status: 'interrupted', startedAt: NOW - 60_000, segmentIndex: 2, offsetMs: 4200, segmentCount: 6, interruptedAt: NOW - 3000, interruptionCause: 'user_speech', ...over };
}
function geo(over: Partial<CandidateGeometry> = {}): CandidateGeometry {
  return { distanceM: 100, bearingDeg: 0, relativeBearingDeg: 0, alongTrackM: null, crossTrackM: null, etaS: null, relative: 'ahead', side: 'center', ...over };
}
const walk = { now: NOW, regime: baseRegime('walking', 1.4, 0) };
const drive = { now: NOW, regime: baseRegime('highway_driving', 30, 0) };

describe('ResumePolicy', () => {
  it('resumes at the start of the interrupted segment, no bridge for a short pause', () => {
    expect(decideResume(story(), walk, geo())).toEqual({ action: 'resume', fromSegment: 2, bridge: false });
  });
  it('bridge after > 8 s', () => {
    expect(decideResume(story({ interruptedAt: NOW - 9000 }), walk, geo())).toEqual({ action: 'resume', fromSegment: 2, bridge: true });
  });
  it('bridge when an answer was spoken in between', () => {
    expect(decideResume(story(), walk, geo(), { answerSpokenSince: true })).toEqual({ action: 'resume', fromSegment: 2, bridge: true });
  });
  it('superseded when a new plan started', () => {
    expect(decideResume(story(), walk, geo(), { currentPlanId: 'p2' })).toEqual({ action: 'abandon', reason: 'superseded' });
  });
  it('driving: target behind beyond tolerance → target_passed', () => {
    expect(decideResume(story(), drive, geo({ alongTrackM: -200, relative: 'behind' }))).toEqual({ action: 'abandon', reason: 'target_passed' });
    // within tolerance → still resumable
    expect(decideResume(story(), drive, geo({ alongTrackM: -20, relative: 'beside' })).action).toBe('resume');
    // large feature: its extent counts
    expect(decideResume(story(), drive, geo({ alongTrackM: -2000 }), { targetExtentM: 5000 }).action).toBe('resume');
  });
  it('walking: target > 400 m away → target_passed', () => {
    expect(decideResume(story(), walk, geo({ distanceM: 450 }))).toEqual({ action: 'abandon', reason: 'target_passed' });
  });
  it('stale: > 3 min walking, > 90 s driving', () => {
    expect(decideResume(story({ interruptedAt: NOW - 181_000 }), walk, geo())).toEqual({ action: 'abandon', reason: 'stale' });
    expect(decideResume(story({ interruptedAt: NOW - 170_000 }), walk, geo()).action).toBe('resume');
    expect(decideResume(story({ interruptedAt: NOW - 91_000 }), drive, geo({ alongTrackM: 5000 }))).toEqual({ action: 'abandon', reason: 'stale' });
  });
  it('nearly_done at ≥ 85 % of segments', () => {
    expect(decideResume(story({ segmentIndex: 6, segmentCount: 7 }), walk, geo())).toEqual({ action: 'abandon', reason: 'nearly_done' });
    expect(decideResume(story({ segmentIndex: 5, segmentCount: 7 }), walk, geo()).action).toBe('resume');
  });
  it('unknown target geometry still resumes (e.g. evidence cached, place not in latest query)', () => {
    expect(decideResume(story(), walk, null).action).toBe('resume');
  });
});

describe('SafetyPolicy + ToolPolicy', () => {
  const hwy: RegimeState = baseRegime('highway_driving', 30, 0);
  const safe = evaluateSafety({ regime: hwy, now: NOW, audioRoute: 'unknown' });

  it('drive-safe in driving regimes; unknown audio route at highway speed is not a hold', () => {
    expect(safe).toEqual({ driveSafe: true, maneuvering: false, speechHoldReasons: [] });
    expect(evaluateSafety({ regime: baseRegime('walking', 1.4, 0), now: NOW, audioRoute: 'unknown' }).driveSafe).toBe(false);
  });

  it('maneuvering on turn rate or hard braking at speed only', () => {
    expect(evaluateSafety({ regime: { ...hwy, turnRateDegPerS: 15 }, now: NOW, audioRoute: 'carplay' }).maneuvering).toBe(true);
    expect(evaluateSafety({ regime: { ...hwy, accelMps2: -3 }, now: NOW, audioRoute: 'carplay' }).maneuvering).toBe(true);
    expect(evaluateSafety({ regime: { ...baseRegime('urban_driving', 2, 0), turnRateDegPerS: 30 }, now: NOW, audioRoute: 'carplay' }).maneuvering).toBe(false);
    expect(evaluateSafety({ regime: { ...baseRegime('walking', 1.4, 0), turnRateDegPerS: 50 }, now: NOW, audioRoute: 'speaker' }).maneuvering).toBe(false);
  });

  it('show_on_map interactive lists at highway speed → allowed as audio-only', () => {
    const d = decideTool({ now: NOW, regime: hwy, safety: safe, position: null }, { tool: 'show_on_map', args: { interactive: true, list: true }, requestedBy: 'llm' });
    expect(d.allowed).toBe(true);
    expect(d.request.args).toEqual({ presentation: 'audio_only' });
  });

  it('navigate_handoff denied while maneuvering; allowed otherwise with destination', () => {
    const man = evaluateSafety({ regime: { ...hwy, turnRateDegPerS: 20 }, now: NOW, audioRoute: 'carplay' });
    expect(decideTool({ now: NOW, regime: hwy, safety: man }, { tool: 'navigate_handoff', args: { lat: 1, lng: 2 }, requestedBy: 'rules' })).toMatchObject({ allowed: false, reason: 'maneuvering' });
    expect(decideTool({ now: NOW, regime: hwy, safety: safe }, { tool: 'navigate_handoff', args: { lat: 1, lng: 2 }, requestedBy: 'rules' }).allowed).toBe(true);
    expect(decideTool({ now: NOW, regime: hwy, safety: safe }, { tool: 'navigate_handoff', args: {}, requestedBy: 'llm' })).toMatchObject({ allowed: false, reason: 'missing_destination' });
  });

  it('nearby_search is rate-limited and audio-first while driving', () => {
    const pos = { lat: 0, lng: 0, t: NOW, source: 'simulated' as const };
    let h = emptyToolHistory();
    for (let i = 0; i < 3; i++) {
      const d = decideTool({ now: NOW + i * 1000, regime: hwy, safety: safe, position: pos }, { tool: 'nearby_search', args: { category: 'coffee' }, requestedBy: 'rules' }, h);
      expect(d.allowed).toBe(true);
      if (d.allowed) expect(d.request.args.presentation).toBe('audio_first');
      h = recordToolCall(h, 'nearby_search', NOW + i * 1000);
    }
    expect(decideTool({ now: NOW + 5000, regime: hwy, safety: safe, position: pos }, { tool: 'nearby_search', args: {}, requestedBy: 'rules' }, h)).toMatchObject({ allowed: false, reason: 'rate_limited' });
    expect(decideTool({ now: NOW + 61_000, regime: hwy, safety: safe, position: pos }, { tool: 'nearby_search', args: {}, requestedBy: 'rules' }, h).allowed).toBe(true);
  });
});
