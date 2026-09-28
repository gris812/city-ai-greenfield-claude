/**
 * Key-value layer for hot session state and caches (D-011). Redis when healthy; an
 * in-process LRU otherwise, with `reduced = true` so the runtime switches to its defined
 * reduced mode (F5: stricter discovery throttle, /readyz degraded) instead of storming
 * providers because every cache lookup misses.
 */
import { Redis } from 'ioredis';

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Push to a capped list (newest first). */
  pushCapped(key: string, value: string, max: number, ttlS?: number): Promise<void>;
  list(key: string, n: number): Promise<string[]>;
  readonly reduced: boolean;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  private m = new Map<string, { v: string; exp: number | null }>();
  private l = new Map<string, string[]>();
  constructor(
    private readonly maxEntries = 20_000,
    readonly reduced = false,
  ) {}

  async get(key: string): Promise<string | null> {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp !== null && Date.now() > e.exp) {
      this.m.delete(key);
      return null;
    }
    this.m.delete(key); // LRU touch
    this.m.set(key, e);
    return e.v;
  }
  async set(key: string, value: string, ttlS?: number): Promise<void> {
    this.m.delete(key);
    this.m.set(key, { v: value, exp: ttlS ? Date.now() + ttlS * 1000 : null });
    while (this.m.size > this.maxEntries) this.m.delete(this.m.keys().next().value!);
  }
  async del(key: string): Promise<void> {
    this.m.delete(key);
    this.l.delete(key);
  }
  async pushCapped(key: string, value: string, max: number): Promise<void> {
    const xs = this.l.get(key) ?? [];
    xs.unshift(value);
    this.l.set(key, xs.slice(0, max));
  }
  async list(key: string, n: number): Promise<string[]> {
    return (this.l.get(key) ?? []).slice(0, n);
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

export class ResilientKV implements KV {
  readonly redis: Redis;
  private readonly mem = new MemoryKV(20_000);
  private degradedSince: number | null = null;
  stats = { fallbacks: 0 };

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 750,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 250, 5000),
    });
    this.redis.on('error', () => {
      /* connection errors surface as reduced mode; never crash, never log the URL */
    });
  }

  get reduced(): boolean {
    return this.redis.status !== 'ready';
  }

  private async use<T>(op: (r: Redis) => Promise<T>, fallback: (m: MemoryKV) => Promise<T>): Promise<T> {
    if (this.redis.status === 'ready') {
      try {
        const r = await op(this.redis);
        this.degradedSince = null;
        return r;
      } catch {
        /* fall through */
      }
    }
    this.stats.fallbacks++;
    this.degradedSince ??= Date.now();
    return fallback(this.mem);
  }

  get(key: string) {
    return this.use(
      (r) => r.get(key),
      (m) => m.get(key),
    );
  }
  set(key: string, value: string, ttlS?: number) {
    return this.use(
      async (r) => {
        if (ttlS) await r.set(key, value, 'EX', Math.max(1, Math.round(ttlS)));
        else await r.set(key, value);
      },
      (m) => m.set(key, value, ttlS),
    );
  }
  del(key: string) {
    return this.use(
      async (r) => {
        await r.del(key);
      },
      (m) => m.del(key),
    );
  }
  pushCapped(key: string, value: string, max: number, ttlS?: number) {
    return this.use(
      async (r) => {
        const p = r.multi().lpush(key, value).ltrim(key, 0, max - 1);
        if (ttlS) p.expire(key, Math.round(ttlS));
        await p.exec();
      },
      (m) => m.pushCapped(key, value, max),
    );
  }
  list(key: string, n: number) {
    return this.use(
      (r) => r.lrange(key, 0, n - 1),
      (m) => m.list(key, n),
    );
  }
  async ping(): Promise<boolean> {
    if (this.redis.status !== 'ready') return false;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
