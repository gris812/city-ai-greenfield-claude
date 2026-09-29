import type { Directive } from '@city/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/api.js';
import { SessionChannel, type WebSocketLike } from '../src/channel.js';
import type { TransportStatus } from '../src/types.js';

class FakeWS implements WebSocketLike {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  server(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
}

const play = (planId: string): Directive => ({ type: 'play', planId, placeId: 'x', placeName: 'X', segments: [], startAt: { segmentIndex: 0, offsetMs: 0 } });
const envelope = (seq: number, directive: Directive, turn: number | null = null) => ({ type: 'directive', seq, turn, at: 0, directive });

function fakeFetch(online: { up: boolean }, calls: string[]): FetchLike {
  return async (url, init) => {
    calls.push(`${String(init?.method ?? 'GET')} ${url.replace('https://api.test', '')}`);
    if (!online.up) throw new Error('offline');
    const path = url.replace('https://api.test', '');
    const json = (b: unknown) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(b) });
    if (path === '/v1/guest') return json({ guestId: 'g', token: 'tok' });
    if (path === '/v1/sessions') return json({ sessionId: 's1', wsUrl: '/v1/sessions/s1/ws', guide: { id: 'ida', name: 'Ida' }, policyVersion: '1' });
    if (path.startsWith('/v1/sessions/s1/directives')) return json({ directives: [] });
    return json({ directives: [] });
  };
}

describe('SessionChannel (E3 reconnect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it('resumes after a drop, never re-applies a directive, and retries the utterance with the same id', async () => {
    const online = { up: true };
    const calls: string[] = [];
    const applied: Array<{ seq: number; type: string }> = [];
    const statuses: TransportStatus[] = [];
    let guest: { guestId: string; token: string } | null = null;
    const ch = new SessionChannel(
      { directive: (d, seq) => applied.push({ seq, type: d.type }), debug: () => undefined, status: (s) => statuses.push(s) },
      {
        api: createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch(online, calls) }),
        guest: { get: async () => guest, set: async (g) => void (guest = g) },
        platform: 'test',
        appVersion: '0',
        WebSocket: FakeWS,
        newId: () => 'utt-1',
      },
    );
    await ch.start({ guideId: 'ida', locale: 'en-US', units: 'imperial', simulated: true, talkativeness: 0 });
    expect(FakeWS.all[0]!.url).toBe('wss://api.test/v1/sessions/s1/ws?token=tok');

    const ws1 = FakeWS.all[0]!;
    ws1.open();
    expect(ws1.sent[0]).toEqual({ type: 'resume', lastDirectiveSeq: 0 });
    ws1.server({ type: 'hello', sessionId: 's1', lastDirectiveSeq: 0 });
    ws1.server(envelope(1, { type: 'state', regime: 'walking', density: 'urban', driveSafe: false, simulated: true, silence: null }));
    ws1.server(envelope(2, play('story-A')));
    ws1.server(envelope(2, play('story-A'))); // duplicate on the same socket
    expect(applied.map((a) => a.seq)).toEqual([1, 2]);
    expect(ws1.sent.filter((m) => m.type === 'ack').at(-1)).toEqual({ type: 'ack', seq: 2 });

    // Network loss: socket drops, REST fails; the utterance stays queued.
    online.up = false;
    ch.setNetworkAvailable(false);
    ws1.drop();
    ch.sendUtterance('where can I get coffee', 123, 'device');
    await vi.advanceTimersByTimeAsync(10);
    expect(ch.pendingUtterances).toBe(1);
    expect(statuses.at(-1)?.connected).toBe(false);

    // Network back: immediate reconnect, resume from 2, outbox flushed with the same utteranceId.
    online.up = true;
    ch.setNetworkAvailable(true);
    const ws2 = FakeWS.all.at(-1)!;
    expect(ws2).not.toBe(ws1);
    ws2.open();
    expect(ws2.sent[0]).toEqual({ type: 'resume', lastDirectiveSeq: 2 });
    const utt = ws2.sent.find((m) => m.type === 'utterance');
    expect(utt).toMatchObject({ text: 'where can I get coffee', utteranceId: 'utt-1' });
    expect(ch.pendingUtterances).toBe(0);

    // A live directive overtakes the resume replay; the replay also repeats #2.
    ws2.server(envelope(5, { type: 'say', text: 'The closest is…', audioUrl: null, purpose: 'answer' }, 1));
    ws2.server(envelope(2, play('story-A')));
    ws2.server(envelope(3, { type: 'stop_audio', reason: 'interrupt' }, 1));
    ws2.server(envelope(4, { type: 'map', action: { kind: 'follow_user' } }));
    expect(applied.map((a) => a.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(applied.filter((a) => a.type === 'play')).toHaveLength(1); // story never replayed
    expect(ch.stats.duplicates).toBeGreaterThanOrEqual(2);
    ch.close();
  });

  it('fills a gap through GET /directives?after= and otherwise skips it', async () => {
    const online = { up: true };
    const calls: string[] = [];
    const applied: number[] = [];
    const ch = new SessionChannel(
      { directive: (_d, seq) => applied.push(seq), debug: () => undefined, status: () => undefined },
      {
        api: createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch(online, calls) }),
        guest: { get: async () => ({ guestId: 'g', token: 'tok' }), set: async () => undefined },
        platform: 'test',
        appVersion: '0',
        WebSocket: FakeWS,
        gapFillMs: 100,
      },
    );
    await ch.start({ guideId: 'ida', locale: 'en-US', units: 'metric', simulated: false, talkativeness: 0 });
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.server(envelope(1, play('a')));
    ws.server(envelope(3, play('c')));
    expect(applied).toEqual([1]);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls.some((c) => c.includes('/v1/sessions/s1/directives?after=1'))).toBe(true);
    expect(applied).toEqual([1, 3]); // server had nothing for #2 → skipped, #3 released
    ch.close();
  });

  it('interrupt drops in-flight answer audio of earlier turns (barge-in)', async () => {
    const applied: string[] = [];
    const ch = new SessionChannel(
      { directive: (d) => applied.push(d.type), debug: () => undefined, status: () => undefined },
      {
        api: createApiClient({ baseUrl: 'https://api.test', fetch: fakeFetch({ up: true }, []) }),
        guest: { get: async () => ({ guestId: 'g', token: 'tok' }), set: async () => undefined },
        platform: 'test',
        appVersion: '0',
        WebSocket: FakeWS,
      },
    );
    await ch.start({ guideId: 'ida', locale: 'en-US', units: 'metric', simulated: false, talkativeness: 0 });
    const ws = FakeWS.all.at(-1)!;
    ws.open();
    ws.server(envelope(1, { type: 'say', text: 'first answer', audioUrl: null, purpose: 'answer' }, 2));
    ch.sendControl('interrupt');
    ws.server(envelope(2, { type: 'say', text: 'rest of first answer', audioUrl: null, purpose: 'answer' }, 2));
    ws.server(envelope(3, { type: 'say', text: 'new answer', audioUrl: null, purpose: 'answer' }, 3));
    expect(applied).toEqual(['say', 'say']);
    ch.close();
  });
});
