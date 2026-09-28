/**
 * F2 / F5 / invalid-credential containment: every failure mode produces a bounded number of
 * provider attempts, no matter how many times the caller asks.
 */
import { describe, expect, it } from 'vitest';
import type { CostRecord } from '@city/core';
import { CircuitBreaker, ProviderBudget, retryOnce } from '../src/resilience.js';
import { ProviderError } from '../src/errors.js';
import { ProviderGuard } from '../src/metered.js';
import { ProviderRouter, type ProviderSet } from '../src/router.js';
import { FakeNearbySearch, FakeSpeechSynthesizer, StaticPlaceSource } from '../src/fakes.js';
import { IDA } from '@city/core';

function clock(start = 1_000_000) {
  let t = start;
  const c = () => t;
  c.advance = (ms: number) => {
    t += ms;
  };
  return c;
}

const q = { center: { lat: 0, lng: 0 }, radiusM: 500, minSignificance: 0, locale: 'en' };

function setWith(p: Partial<ProviderSet>): ProviderSet {
  return { story: [], intent: [], tts: [], stt: [], realtime: [], places: [], knowledge: [], nearby: [], ...p };
}

describe('CircuitBreaker', () => {
  it('opens after the threshold and admits exactly one half-open probe', () => {
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, clock: c });
    for (let i = 0; i < 3; i++) {
      expect(b.tryAcquire()).toBe(true);
      b.onFailure('server');
    }
    expect(b.state).toBe('open');
    expect(b.tryAcquire()).toBe(false);
    c.advance(1000);
    expect(b.state).toBe('half_open');
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false); // only one probe
    b.onFailure('server');
    expect(b.state).toBe('open');
    c.advance(1000);
    expect(b.tryAcquire()).toBe(true);
    b.onSuccess();
    expect(b.state).toBe('closed');
  });

  it('opens immediately with a long cooldown on auth/quota errors', () => {
    const c = clock();
    const b = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000, hardCooldownMs: 600_000, clock: c });
    b.onFailure('auth');
    expect(b.state).toBe('open');
    c.advance(1000);
    expect(b.state).toBe('open');
  });
});

describe('retryOnce', () => {
  it('retries retryable errors exactly once', async () => {
    let n = 0;
    await expect(
      retryOnce(
        async () => {
          n++;
          throw new ProviderError('x', 'timeout', 't');
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(2);
  });

  it('never retries auth / bad_request / quota', async () => {
    for (const kind of ['auth', 'bad_request', 'quota'] as const) {
      let n = 0;
      await expect(
        retryOnce(
          async () => {
            n++;
            throw new ProviderError('x', kind, 'e');
          },
          { sleep: async () => {} },
        ),
      ).rejects.toThrow();
      expect(n).toBe(1);
    }
  });

  it('caps retries at 1 even if more are requested', async () => {
    let n = 0;
    await expect(
      retryOnce(
        async () => {
          n++;
          throw new ProviderError('x', 'server', 'e');
        },
        { retries: 10, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(2);
  });
});

describe('ProviderBudget', () => {
  it('enforces per-session caps, global per-minute caps and kill switches', () => {
    const c = clock();
    const b = new ProviderBudget({ perSession: { maps: 2 }, perMinuteGlobal: { tts: 3 } }, c);
    expect(b.acquire('maps', 'p', 's1').ok).toBe(true);
    expect(b.acquire('maps', 'p', 's1').ok).toBe(true);
    expect(b.acquire('maps', 'p', 's1')).toEqual({ ok: false, reason: 'session_cap' });
    expect(b.acquire('maps', 'p', 's2').ok).toBe(true);
    for (let i = 0; i < 3; i++) expect(b.acquire('tts', 'p', `x${i}`).ok).toBe(true);
    expect(b.acquire('tts', 'p', 'x9').reason).toBe('global_rate');
    c.advance(60_000);
    expect(b.acquire('tts', 'p', 'x9').ok).toBe(true);
    b.update({ killed: ['llm'] });
    expect(b.acquire('llm', 'openai', 's1').reason).toBe('killed');
    b.update({ killed: ['openai'] });
    expect(b.acquire('tts', 'openai', 's1').reason).toBe('killed');
  });

  it('stops a session at its USD cap', () => {
    const b = new ProviderBudget({ usdPerSession: 0.01 });
    b.addSpend('s', 0.02);
    expect(b.acquire('llm', 'openai', 's').reason).toBe('session_usd');
  });
});

describe('ProviderGuard bounded call counts (F2 / F5 / invalid credential)', () => {
  const mk = (behaviour: ConstructorParameters<typeof StaticPlaceSource>[1]) => {
    const records: CostRecord[] = [];
    const c = clock();
    const guard = new ProviderGuard({ sink: { record: (r) => records.push(r) }, budget: new ProviderBudget({}, c), clock: c, retry: { sleep: async () => {} }, breaker: { failureThreshold: 3, cooldownMs: 30_000 } });
    const src = new StaticPlaceSource([], behaviour);
    const router = new ProviderRouter(setWith({ places: [src] }), guard, { places: 50 });
    return { records, c, guard, src, router };
  };

  it('timeouts: 100 requests → ≤ 3 failures × 2 attempts before the breaker opens', async () => {
    const { src, router, records } = mk({ failWith: 'timeout' });
    let refused = 0;
    for (let i = 0; i < 100; i++) {
      await router.queryPlaces(q, { sessionId: 's' }).catch((e: ProviderError) => {
        if (e.kind === 'circuit_open') refused++;
      });
    }
    expect(src.calls).toBeLessThanOrEqual(4); // attempt+retry, attempt(opens at 3rd failure)…
    expect(refused).toBeGreaterThanOrEqual(96);
    expect(records.filter((r) => !r.ok).length).toBe(src.calls);
  });

  it('quota (429): opens immediately, no retry, 1 paid attempt for 100 requests', async () => {
    const { src, router } = mk({ failWith: 'quota' });
    for (let i = 0; i < 100; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    expect(src.calls).toBe(1);
  });

  it('invalid credential (401): 1 attempt, breaker stays open for the hard cooldown', async () => {
    const { src, router, c } = mk({ failWith: 'auth' });
    for (let i = 0; i < 50; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    c.advance(60_000);
    for (let i = 0; i < 50; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    expect(src.calls).toBe(1);
  });

  it('half-open probing is bounded to one call per cooldown', async () => {
    const { src, router, c } = mk({ failWith: 'server' });
    for (let i = 0; i < 20; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    const afterOpen = src.calls;
    for (let k = 0; k < 5; k++) {
      c.advance(30_000);
      for (let i = 0; i < 20; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    }
    expect(src.calls - afterOpen).toBe(5); // one probe per cooldown window, no retries of probes beyond breaker
  });

  it('recovers after a successful probe', async () => {
    const { src, router, c } = mk({ failWith: 'server', failFirst: 3 });
    for (let i = 0; i < 10; i++) await router.queryPlaces(q, { sessionId: 's' }).catch(() => {});
    c.advance(30_000);
    const r = await router.queryPlaces(q, { sessionId: 's' });
    expect(r.result).toEqual([]);
    await router.queryPlaces(q, { sessionId: 's' });
    expect(src.calls).toBeLessThanOrEqual(7);
  });

  it('TTS falls back to the secondary provider when the primary fails, without looping', async () => {
    const records: CostRecord[] = [];
    const guard = new ProviderGuard({ sink: { record: (r) => records.push(r) }, budget: new ProviderBudget(), retry: { sleep: async () => {} } });
    const bad = new FakeSpeechSynthesizer({ failWith: 'server' }, 'primary');
    const good = new FakeSpeechSynthesizer({}, 'secondary');
    const router = new ProviderRouter(setWith({ tts: [bad, good] }), guard);
    for (let i = 0; i < 10; i++) {
      const r = await router.synthesize({ text: 'Hello there, friend.', locale: 'en', speakingRate: 1 }, IDA, { sessionId: 's' });
      expect(r.provider.name).toBe('secondary');
    }
    expect(bad.calls).toBeLessThanOrEqual(4);
    expect(good.calls).toBe(10);
  });

  it('a budget refusal does not fan out to fallback providers', async () => {
    const guard = new ProviderGuard({ sink: { record: () => {} }, budget: new ProviderBudget({ perSession: { maps: 1 } }) });
    const a = new FakeNearbySearch();
    const b = new FakeNearbySearch();
    const router = new ProviderRouter(setWith({ nearby: [a, b] }), guard);
    const req = { location: { lat: 0, lng: 0 }, category: 'coffee', query: 'coffee', radiusM: 500, maxResults: 3, locale: 'en' };
    await router.nearby(req, { sessionId: 's' });
    await expect(router.nearby(req, { sessionId: 's' })).rejects.toMatchObject({ kind: 'budget' });
    expect(a.calls + b.calls).toBe(1);
  });

  it('records a CostRecord per attempt, with cost for successful paid calls', async () => {
    const records: CostRecord[] = [];
    const guard = new ProviderGuard({ sink: { record: (r) => records.push(r) }, budget: new ProviderBudget() });
    const tts = new FakeSpeechSynthesizer();
    const router = new ProviderRouter(setWith({ tts: [tts] }), guard);
    await router.synthesize({ text: 'One two three four five.', locale: 'en', speakingRate: 1 }, IDA, { sessionId: 'sess' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ provider: 'fake', category: 'tts', task: 'tts_segment', ok: true, sessionId: 'sess', costUsd: 0 });
    expect(records[0]!.units.characters).toBe(24);
  });
});
