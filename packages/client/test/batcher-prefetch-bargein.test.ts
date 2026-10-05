import type { GeoFix } from '@city/core';
import { describe, expect, it } from 'vitest';
import { BargeInTracker, percentile } from '../src/bargein.js';
import { FrameBatcher, locationSampling, MAX_FIXES_PER_FRAME, mergeFrames } from '../src/batcher.js';
import { planPrefetch, PrefetchQueue } from '../src/prefetch.js';

const fix = (t: number, speedMps = 1.4): GeoFix => ({ t, lat: 40 + t * 1e-7, lng: -74, speedMps, source: 'gps' });
const extras = { appState: 'foreground' as const, audio: { playing: false, outputRoute: 'speaker' as const }, lastInteractionAt: null, simulated: false };

describe('FrameBatcher', () => {
  it('flushes every second while moving and batches the fixes', () => {
    const b = new FrameBatcher();
    b.push(fix(0));
    expect(b.due(0)).toBe(true);
    expect(b.take(0, extras).fixes).toHaveLength(1);
    b.push(fix(400));
    b.push(fix(800));
    expect(b.due(800)).toBe(false);
    expect(b.due(1000)).toBe(true);
    const f = b.take(1000, extras);
    expect(f.fixes.map((x) => x.t)).toEqual([400, 800]);
    expect(f.clientTime).toBe(1000);
  });

  it('heartbeats every 10 s while stationary with no new fixes', () => {
    const b = new FrameBatcher();
    b.push(fix(0, 0));
    b.take(0, extras);
    expect(b.due(9_000)).toBe(false);
    expect(b.due(10_000)).toBe(true);
    expect(b.take(10_000, extras).fixes).toEqual([]);
  });

  it('drops duplicate / out-of-order fixes (foreground watcher + background task overlap)', () => {
    const b = new FrameBatcher();
    expect(b.pushAll([fix(1000), fix(2000), fix(1000), fix(1500)])).toBe(3);
    expect(b.push(fix(2000))).toBe(false);
    expect(b.pending).toBe(3);
  });

  it('poke forces a prompt frame (audio state change)', () => {
    const b = new FrameBatcher();
    b.push(fix(0, 0));
    b.take(0, extras);
    b.poke();
    expect(b.due(10)).toBe(true);
  });

  it('caps a frame at the server schema limit', () => {
    const b = new FrameBatcher();
    for (let i = 1; i <= 200; i++) b.push(fix(i * 10));
    expect(b.take(5000, extras).fixes).toHaveLength(MAX_FIXES_PER_FRAME);
    const merged = mergeFrames(b.take(1, extras), { ...b.take(2, extras), fixes: Array.from({ length: 130 }, (_, i) => fix(9000 + i)) });
    expect(merged.fixes).toHaveLength(MAX_FIXES_PER_FRAME);
  });

  it('adaptive OS sampling: 1 Hz moving/driving, relaxed when still', () => {
    expect(locationSampling(12, true).timeIntervalMs).toBe(1000);
    expect(locationSampling(1.5, false).timeIntervalMs).toBe(1000);
    expect(locationSampling(0, false).timeIntervalMs).toBe(5000);
  });
});

describe('prefetch', () => {
  const segs = [0, 1, 2, 3, 4].map((i) => ({ index: i, url: `/v1/audio/${i}.mp3` }));

  it('plans current + next two', () => {
    expect(planPrefetch(segs, 1)).toEqual(['/v1/audio/1.mp3', '/v1/audio/2.mp3', '/v1/audio/3.mp3']);
    expect(planPrefetch([{ index: 0, url: null }, ...segs.slice(1)], 0)).toEqual(['/v1/audio/1.mp3', '/v1/audio/2.mp3']);
  });

  it('downloads the plan, resolves local URIs, and never re-downloads', async () => {
    const calls: string[] = [];
    const q = new PrefetchQueue({ download: async (u) => (calls.push(u), `file:///cache/${u.split('/').pop()}`) });
    q.update(segs, 0);
    await q.whenReady('/v1/audio/2.mp3', 1000);
    expect(q.resolve('/v1/audio/0.mp3')).toBe('file:///cache/0.mp3');
    q.update(segs, 1);
    await q.whenReady('/v1/audio/3.mp3', 1000);
    expect(calls).toEqual(['/v1/audio/0.mp3', '/v1/audio/1.mp3', '/v1/audio/2.mp3', '/v1/audio/3.mp3']);
    expect(q.resolve('/v1/audio/4.mp3')).toBe('/v1/audio/4.mp3'); // not planned → stream
  });

  it('failed downloads resolve to null (caller falls back to stream / device TTS) and retry is bounded', async () => {
    let n = 0;
    const q = new PrefetchQueue({ download: async () => (n++, Promise.reject(new Error('offline'))) }, { maxAttempts: 2 });
    q.update(segs.slice(0, 1), 0);
    expect(await q.whenReady('/v1/audio/0.mp3', 500)).toBeNull();
    q.update(segs.slice(0, 1), 0);
    await q.whenReady('/v1/audio/0.mp3', 500);
    q.update(segs.slice(0, 1), 0);
    q.update(segs.slice(0, 1), 0);
    expect(n).toBe(2);
  });

  it('evicts least-recently-used entries beyond the cap, never the pinned plan', async () => {
    const removed: string[] = [];
    const q = new PrefetchQueue({ download: async (u) => `file://${u}`, remove: (l) => removed.push(l) }, { maxEntries: 3, concurrency: 1 });
    const many = Array.from({ length: 8 }, (_, i) => ({ index: i, url: `/a/${i}` }));
    for (let i = 0; i < 6; i++) {
      q.update(many, i);
      await q.whenReady(`/a/${i + 2}`, 1000);
    }
    expect(q.size).toBeLessThanOrEqual(3 + 1);
    expect(q.state('/a/7')).toBe('ready');
    expect(removed.length).toBeGreaterThan(0);
  });
});

describe('BargeInTracker', () => {
  it('measures press → silent latency and response time', () => {
    let t = 1000;
    const b = new BargeInTracker(() => t);
    expect(b.press(true)).toBe(true);
    expect(b.press(true)).toBe(false); // debounced
    t += 42;
    expect(b.silent()).toBe(42);
    expect(b.phase).toBe('listening');
    b.submit();
    t += 900;
    expect(b.answered()).toBe(900);
    expect(b.phase).toBe('idle');
    expect(b.samples[0]!.stopMs).toBe(42);
  });

  it('does not record a stop sample when nothing was playing; cancel and expiry return to idle', () => {
    let t = 0;
    const b = new BargeInTracker(() => t);
    b.press(false);
    b.silent();
    expect(b.samples).toHaveLength(0);
    b.cancel();
    expect(b.phase).toBe('idle');
    b.press(false);
    b.silent();
    b.submit();
    t += 20_000;
    expect(b.expire(15_000)).toBe(true);
    expect(b.phase).toBe('idle');
  });

  it('percentiles', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 95)).toBeCloseTo(59.05, 1);
  });
});
