/**
 * `metered()` (D-014) and the ProviderGuard that composes budget → circuit breaker →
 * timeout → bounded retry → metering around every provider call.
 */
import type { CostRecord, ProviderCategory } from '@city/core';
import { ProviderError, toProviderError } from './errors.js';
import { computeCost } from './pricing.js';
import { CircuitBreaker, ProviderBudget, retryOnce, systemClock, type BreakerOptions, type Clock, type RetryOptions } from './resilience.js';
import type { CallContext, CostSink, ProviderInfo } from './types.js';

export interface MeterMeta {
  provider: string;
  model: string | null;
  category: ProviderCategory;
  task: string;
  sessionId: string | null;
}

export interface MeteredOptions<T> {
  units: (r: T) => CostRecord['units'];
  cacheHit?: boolean;
  /** Explicit cost (e.g. realtime sessions priced by direction). */
  costUsd?: (r: T) => number;
  clock?: Clock;
}

/** Run `fn`, record one CostRecord (success or failure) into `sink`, return/rethrow. */
export async function metered<T>(sink: CostSink, meta: MeterMeta, fn: () => Promise<T>, opts: MeteredOptions<T>): Promise<T> {
  const clock = opts.clock ?? systemClock;
  const t0 = performance.now();
  const at = clock();
  try {
    const r = await fn();
    const units = opts.units(r);
    const costUsd = opts.costUsd ? opts.costUsd(r) : computeCost(meta.provider, meta.model, units, at, meta.category);
    sink.record({ ...meta, units, costUsd, latencyMs: Math.round(performance.now() - t0), cacheHit: opts.cacheHit ?? false, ok: true, at });
    return r;
  } catch (e) {
    sink.record({ ...meta, units: { requests: 1 }, costUsd: 0, latencyMs: Math.round(performance.now() - t0), cacheHit: false, ok: false, at });
    throw e;
  }
}

export interface GuardOptions {
  sink: CostSink;
  budget: ProviderBudget;
  breaker?: Partial<BreakerOptions>;
  retry?: RetryOptions;
  clock?: Clock;
  /** Observer for provider errors / breaker refusals (telemetry). */
  onError?: (e: ProviderError, meta: MeterMeta) => void;
}

export interface GuardedCall<T> {
  provider: ProviderInfo;
  category: ProviderCategory;
  task: string;
  ctx?: CallContext;
  timeoutMs: number;
  units: (r: T) => CostRecord['units'];
  costUsd?: (r: T) => number;
  /** Disable retry for this call (e.g. latency-critical interactive calls with a fallback). */
  noRetry?: boolean;
}

export class ProviderGuard {
  readonly budget: ProviderBudget;
  readonly sink: CostSink;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly opts: GuardOptions;
  private readonly clock: Clock;
  /** Attempts actually sent to providers, per `provider:category` (tests assert bounds). */
  readonly attempts = new Map<string, number>();

  constructor(opts: GuardOptions) {
    this.opts = opts;
    this.budget = opts.budget;
    this.sink = opts.sink;
    this.clock = opts.clock ?? systemClock;
  }

  breaker(provider: string, category: ProviderCategory): CircuitBreaker {
    const k = `${provider}:${category}`;
    let b = this.breakers.get(k);
    if (!b) {
      b = new CircuitBreaker({ ...this.opts.breaker, clock: this.clock });
      this.breakers.set(k, b);
    }
    return b;
  }

  /** True when the provider could be tried now (breaker not open, not killed). */
  available(provider: ProviderInfo, category: ProviderCategory): boolean {
    if (this.budget.isKilled(category, provider.name)) return false;
    return this.breaker(provider.name, category).state !== 'open';
  }

  breakerStates(): Record<string, string> {
    return Object.fromEntries([...this.breakers].map(([k, b]) => [k, b.state]));
  }

  async call<T>(c: GuardedCall<T>, fn: (ctx: CallContext) => Promise<T>): Promise<T> {
    const meta: MeterMeta = { provider: c.provider.name, model: c.provider.model, category: c.category, task: c.task, sessionId: c.ctx?.sessionId ?? null };
    const breaker = this.breaker(c.provider.name, c.category);
    const key = `${c.provider.name}:${c.category}`;
    const attempt = async (): Promise<T> => {
      const b = this.budget.acquire(c.category, c.provider.name, meta.sessionId);
      if (!b.ok) throw new ProviderError(c.provider.name, 'budget', `budget refused (${b.reason})`);
      if (!breaker.tryAcquire()) throw new ProviderError(c.provider.name, 'circuit_open', 'circuit open');
      this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
      const ac = new AbortController();
      const parent = c.ctx?.signal;
      const onParentAbort = () => ac.abort(parent?.reason);
      if (parent) {
        if (parent.aborted) ac.abort(parent.reason);
        else parent.addEventListener('abort', onParentAbort, { once: true });
      }
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort(new DOMException('timeout', 'TimeoutError'));
          reject(new ProviderError(c.provider.name, 'timeout', `exceeded ${c.timeoutMs} ms`));
        }, c.timeoutMs);
      });
      try {
        const r = await metered(
          this.sink,
          meta,
          () => Promise.race([fn({ sessionId: meta.sessionId, signal: ac.signal }), timeout]),
          { units: c.units, ...(c.costUsd ? { costUsd: c.costUsd } : {}), clock: this.clock },
        );
        breaker.onSuccess();
        if (meta.sessionId) {
          // Spend accounting for the per-session USD cap.
          const units = c.units(r);
          const cost = c.costUsd ? c.costUsd(r) : computeCost(meta.provider, meta.model, units, this.clock(), meta.category);
          this.budget.addSpend(meta.sessionId, cost);
        }
        return r;
      } catch (e) {
        const pe = parent?.aborted ? new ProviderError(c.provider.name, 'aborted', 'caller aborted') : toProviderError(c.provider.name, e);
        breaker.onFailure(pe.kind);
        throw pe;
      } finally {
        clearTimeout(timer);
        parent?.removeEventListener('abort', onParentAbort);
      }
    };
    try {
      return await retryOnce(() => attempt(), { ...this.opts.retry, ...(c.noRetry ? { retries: 0 } : {}) });
    } catch (e) {
      const pe = toProviderError(c.provider.name, e);
      this.opts.onError?.(pe, meta);
      throw pe;
    }
  }
}
