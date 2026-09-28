/**
 * Resilience primitives (acceptance F2/F5, D-010 ProviderBudget):
 *  - CircuitBreaker: opens after N consecutive failures (auth/quota open immediately with a
 *    long cooldown), half-open admits exactly one probe.
 *  - retryOnce: at most ONE retry, jittered, only for retryable kinds (timeout/5xx/network).
 *  - ProviderBudget: per-session and per-minute global caps per category, plus kill switches.
 *
 * Together they guarantee a bounded number of paid calls under any failure — there is no
 * loop anywhere that retries until success.
 */
import type { ProviderCategory } from '@city/core';
import { ProviderError, type ProviderErrorKind } from './errors.js';

export type Clock = () => number;
export const systemClock: Clock = () => Date.now();

// ─────────────────────────────────────────────── circuit breaker

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** Cooldown before a half-open probe. */
  cooldownMs: number;
  /** Cooldown for auth/quota failures (credential/billing problems do not heal in seconds). */
  hardCooldownMs: number;
  clock?: Clock;
}

export const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 3, cooldownMs: 30_000, hardCooldownMs: 10 * 60_000 };

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private cooldown = 0;
  private probeInFlight = false;
  readonly opts: Required<BreakerOptions>;
  /** Diagnostics. */
  stats = { opened: 0, rejected: 0, probes: 0 };

  constructor(opts: Partial<BreakerOptions> = {}) {
    this.opts = { ...DEFAULT_BREAKER, clock: systemClock, ...opts } as Required<BreakerOptions>;
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.opts.clock() - this.openedAt >= this.cooldown ? 'half_open' : 'open';
  }

  /** May a call proceed now? Half-open admits a single probe. */
  tryAcquire(): boolean {
    const s = this.state;
    if (s === 'closed') return true;
    if (s === 'half_open' && !this.probeInFlight) {
      this.probeInFlight = true;
      this.stats.probes++;
      return true;
    }
    this.stats.rejected++;
    return false;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }

  onFailure(kind: ProviderErrorKind): void {
    // Our own cancellations and budget refusals say nothing about provider health.
    if (kind === 'aborted' || kind === 'budget' || kind === 'circuit_open' || kind === 'bad_request') {
      this.probeInFlight = false;
      return;
    }
    const hard = kind === 'auth' || kind === 'quota';
    this.failures++;
    if (hard || this.probeInFlight || this.failures >= this.opts.failureThreshold) {
      this.openedAt = this.opts.clock();
      this.cooldown = hard ? this.opts.hardCooldownMs : this.opts.cooldownMs;
      this.stats.opened++;
    }
    this.probeInFlight = false;
  }
}

// ─────────────────────────────────────────────── retry

export interface RetryOptions {
  /** Maximum extra attempts. Hard-capped at 1 (F2: bounded retry). */
  retries?: number;
  baseDelayMs?: number;
  /** Deterministic jitter source in tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retryOnce<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = Math.min(1, Math.max(0, opts.retries ?? 1));
  const base = opts.baseDelayMs ?? 150;
  const rnd = opts.random ?? Math.random;
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      if (!pe || !pe.retryable || attempt >= retries) throw e;
      attempt++;
      const delay = pe.retryAfterMs !== null ? Math.min(pe.retryAfterMs, 2000) : base * (0.5 + rnd());
      await sleep(delay);
    }
  }
}

// ─────────────────────────────────────────────── budget

export interface BudgetLimits {
  /** Max calls per session per category (null = unlimited). */
  perSession: Partial<Record<ProviderCategory, number>>;
  /** Max calls per rolling minute across the whole API process, per category. */
  perMinuteGlobal: Partial<Record<ProviderCategory, number>>;
  /** Max realtime seconds per session. */
  realtimeSecondsPerSession: number;
  /** Max USD per session (estimated at call time from the price table). */
  usdPerSession: number;
  /** Kill switches: category or provider name → disabled. */
  killed: string[];
}

/** Provisional defaults (docs/PERFORMANCE_COST.md §12): generous for real use, tight enough to stop storms. */
export const DEFAULT_BUDGET: BudgetLimits = {
  perSession: { maps: 240, knowledge: 600, llm: 200, tts: 600, stt: 200, realtime: 6 },
  perMinuteGlobal: { maps: 600, knowledge: 1200, llm: 600, tts: 1200, stt: 300, realtime: 60 },
  realtimeSecondsPerSession: 15 * 60,
  usdPerSession: 1.0,
  killed: [],
};

export interface BudgetDecision {
  ok: boolean;
  reason?: 'killed' | 'session_cap' | 'global_rate' | 'session_usd' | 'realtime_seconds';
}

export class ProviderBudget {
  private limits: BudgetLimits;
  private sessionCalls = new Map<string, Map<ProviderCategory, number>>();
  private sessionUsd = new Map<string, number>();
  private sessionRealtimeS = new Map<string, number>();
  private window: Array<{ at: number; category: ProviderCategory }> = [];
  private readonly clock: Clock;
  stats = { refused: 0 };

  constructor(limits: Partial<BudgetLimits> = {}, clock: Clock = systemClock) {
    this.limits = mergeLimits(DEFAULT_BUDGET, limits);
    this.clock = clock;
  }

  get current(): BudgetLimits {
    return structuredClone(this.limits);
  }

  update(limits: Partial<BudgetLimits>): void {
    this.limits = mergeLimits(this.limits, limits);
  }

  isKilled(category: ProviderCategory, provider: string): boolean {
    return this.limits.killed.includes(category) || this.limits.killed.includes(provider) || this.limits.killed.includes('all');
  }

  /** Check and reserve one call. */
  acquire(category: ProviderCategory, provider: string, sessionId: string | null): BudgetDecision {
    if (this.isKilled(category, provider)) return this.refuse('killed');
    const now = this.clock();
    this.window = this.window.filter((w) => now - w.at < 60_000);
    const g = this.limits.perMinuteGlobal[category];
    if (g !== undefined && this.window.filter((w) => w.category === category).length >= g) return this.refuse('global_rate');
    if (sessionId) {
      const m = this.sessionCalls.get(sessionId) ?? new Map<ProviderCategory, number>();
      const cap = this.limits.perSession[category];
      if (cap !== undefined && (m.get(category) ?? 0) >= cap) return this.refuse('session_cap');
      if ((this.sessionUsd.get(sessionId) ?? 0) >= this.limits.usdPerSession) return this.refuse('session_usd');
      if (category === 'realtime' && (this.sessionRealtimeS.get(sessionId) ?? 0) >= this.limits.realtimeSecondsPerSession) return this.refuse('realtime_seconds');
      m.set(category, (m.get(category) ?? 0) + 1);
      this.sessionCalls.set(sessionId, m);
    }
    this.window.push({ at: now, category });
    return { ok: true };
  }

  addSpend(sessionId: string | null, usd: number): void {
    if (!sessionId || !(usd > 0)) return;
    this.sessionUsd.set(sessionId, (this.sessionUsd.get(sessionId) ?? 0) + usd);
  }

  addRealtimeSeconds(sessionId: string, seconds: number): void {
    this.sessionRealtimeS.set(sessionId, (this.sessionRealtimeS.get(sessionId) ?? 0) + Math.max(0, seconds));
  }

  realtimeSecondsLeft(sessionId: string): number {
    return Math.max(0, this.limits.realtimeSecondsPerSession - (this.sessionRealtimeS.get(sessionId) ?? 0));
  }

  sessionUsage(sessionId: string): { calls: Partial<Record<ProviderCategory, number>>; usd: number } {
    return { calls: Object.fromEntries(this.sessionCalls.get(sessionId) ?? new Map()), usd: this.sessionUsd.get(sessionId) ?? 0 };
  }

  forgetSession(sessionId: string): void {
    this.sessionCalls.delete(sessionId);
    this.sessionUsd.delete(sessionId);
    this.sessionRealtimeS.delete(sessionId);
  }

  private refuse(reason: NonNullable<BudgetDecision['reason']>): BudgetDecision {
    this.stats.refused++;
    return { ok: false, reason };
  }
}

function mergeLimits(a: BudgetLimits, b: Partial<BudgetLimits>): BudgetLimits {
  return {
    perSession: { ...a.perSession, ...(b.perSession ?? {}) },
    perMinuteGlobal: { ...a.perMinuteGlobal, ...(b.perMinuteGlobal ?? {}) },
    realtimeSecondsPerSession: b.realtimeSecondsPerSession ?? a.realtimeSecondsPerSession,
    usdPerSession: b.usdPerSession ?? a.usdPerSession,
    killed: b.killed ?? a.killed,
  };
}
