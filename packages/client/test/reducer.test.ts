import type { Directive } from '@city/core';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../src/i18n.js';
import { driveStatusLine, initialView, reduceDirective, reducePlayback } from '../src/reducer.js';

const play: Directive = {
  type: 'play',
  planId: 'p1',
  placeId: 'x',
  placeName: 'Old Mill',
  segments: [
    { segmentId: 's1', index: 1, text: 'b', audioUrl: '/v1/audio/b.mp3', durationMs: 3000 },
    { segmentId: 's0', index: 0, text: 'a', audioUrl: '/v1/audio/a.mp3', durationMs: 2000 },
  ],
  startAt: { segmentIndex: 0, offsetMs: 0 },
};
const card: Directive = { type: 'card', placeId: 'x', name: 'Old Mill', kind: 'building', location: { lat: 1, lng: 2 }, spatialCue: 'ahead on your right' };

describe('reduceDirective', () => {
  it('play → now playing (segments ordered, cue from matching card, server audio)', () => {
    let v = reduceDirective(initialView(), card, 0);
    v = reduceDirective(v, play, 1);
    expect(v.nowPlaying?.segments.map((s) => s.index)).toEqual([0, 1]);
    expect(v.nowPlaying?.spatialCue).toBe('ahead on your right');
    expect(v.nowPlaying?.audio).toBe('server');
    expect(v.directiveCount).toBe(2);
  });

  it('stop_audio: pause keeps the story, preempt keeps it for the next play, others clear it', () => {
    const v = reduceDirective(initialView(), play, 0);
    expect(reduceDirective(v, { type: 'stop_audio', reason: 'user_pause' }, 1).nowPlaying?.status).toBe('paused');
    expect(reduceDirective(v, { type: 'stop_audio', reason: 'preempt' }, 1).nowPlaying).not.toBeNull();
    expect(reduceDirective(v, { type: 'stop_audio', reason: 'skip' }, 1).nowPlaying).toBeNull();
  });

  it('map actions and listen (never auto-opened while drive-safe — D-008)', () => {
    let v = reduceDirective(initialView(), { type: 'map', action: { kind: 'focus_place', placeId: 'x', name: 'n', location: { lat: 0, lng: 0 } } }, 0);
    expect(v.focus?.placeId).toBe('x');
    v = reduceDirective(v, { type: 'map', action: { kind: 'show_results', results: [{ placeId: 'c', name: 'Cafe', location: { lat: 0, lng: 0 }, distanceM: 120, kind: 'food' }] } }, 0);
    expect(v.results).toHaveLength(1);
    v = reduceDirective(v, { type: 'map', action: { kind: 'clear' } }, 0);
    expect(v.focus).toBeNull();
    expect(v.results).toBeNull();
    v = reduceDirective(v, { type: 'listen', mode: 'push_to_talk', timeoutMs: 5000 }, 7);
    expect(v.listenRequest?.at).toBe(7);
    let d = reduceDirective(initialView(), { type: 'state', regime: 'highway_driving', density: 'sparse', driveSafe: true, simulated: false, silence: 'nothing_worth_it' }, 0);
    d = reduceDirective(d, { type: 'listen', mode: 'open', timeoutMs: 5000 }, 1);
    expect(d.listenRequest).toBeNull();
  });

  it('playback feedback advances segments and finishes', () => {
    let v = reduceDirective(initialView(), play, 0);
    v = reducePlayback(v, { planId: 'p1', segmentIndex: 1, audio: 'device' });
    expect(v.nowPlaying?.segmentIndex).toBe(1);
    expect(v.nowPlaying?.audio).toBe('device');
    expect(reducePlayback(v, { planId: 'other', status: 'finished' }).nowPlaying).not.toBeNull();
    expect(reducePlayback(v, { planId: 'p1', status: 'finished' }).nowPlaying).toBeNull();
  });
});

describe('driveStatusLine (E1: one glanceable line)', () => {
  const t = DICTS.en;
  it('prioritises listening, then the story, then silence, then regime', () => {
    const base = reduceDirective(initialView(), { type: 'state', regime: 'highway_driving', density: 'sparse', driveSafe: true, simulated: false, silence: 'nothing_worth_it' }, 0);
    expect(driveStatusLine(base, t, true)).toBe('Listening…');
    expect(driveStatusLine(reduceDirective(base, play, 0), t, false)).toBe('Old Mill');
    expect(driveStatusLine(base, t, false)).toBe('Nothing worth interrupting for');
    expect(driveStatusLine({ ...base, silence: null }, t, false)).toBe('Highway');
    expect(driveStatusLine(base, DICTS.ru, true)).toBe('Слушаю…');
  });
});
