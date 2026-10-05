/** Wiring: config → stores → providers (router/guard/budget) → services → session manager. */
import {
  ProviderBudget,
  ProviderGuard,
  ProviderRouter,
  buildProviderSet,
  providerConfigFromEnv,
  type BreakerOptions,
  type BudgetLimits,
  type ProviderSet,
  type TaskTimeouts,
} from '@city/providers';
import { AudioStore } from './audio-store.js';
import { Auth } from './auth.js';
import type { AppConfig } from './config.js';
import { createSql, type Sql } from './db.js';
import { DiscoveryService } from './discovery-service.js';
import { NarrationCache } from './narration-cache.js';
import { ResilientKV, type KV } from './kv.js';
import { ReducedModeLimiter } from './runtime/session-runtime.js';
import { SessionManager } from './runtime/session-manager.js';
import { Telemetry } from './telemetry.js';

export interface AppDeps {
  config: AppConfig;
  sql: Sql | null;
  kv: KV;
  auth: Auth;
  telemetry: Telemetry;
  budget: ProviderBudget;
  guard: ProviderGuard;
  router: ProviderRouter;
  providers: ProviderSet;
  discovery: DiscoveryService;
  audio: AudioStore;
  /** Shared story-body cache (D-018); null when NARRATION_CACHE=0. */
  narration: NarrationCache | null;
  sessions: SessionManager;
  /** Redis client for rate limiting (null → in-memory store). */
  redis: import('ioredis').Redis | null;
  close(): Promise<void>;
}

export interface DepsOverrides {
  sql?: Sql | null;
  kv?: KV;
  providers?: Partial<ProviderSet>;
  budget?: Partial<BudgetLimits>;
  breaker?: Partial<BreakerOptions>;
  timeouts?: Partial<TaskTimeouts>;
  telemetryFlushMs?: number;
  /** Use fixture places/evidence (DEMO_MODE or tests). */
  fixtures?: boolean;
}

export async function createDeps(config: AppConfig, o: DepsOverrides = {}): Promise<AppDeps> {
  const sql = o.sql !== undefined ? o.sql : createSql(config.databaseUrl);
  let redis: import('ioredis').Redis | null = null;
  let kv: KV;
  if (o.kv) kv = o.kv;
  else {
    const r = new ResilientKV(config.redisUrl);
    redis = r.redis;
    kv = r;
  }
  if (o.kv && 'redis' in o.kv) redis = (o.kv as ResilientKV).redis;
  const telemetry = new Telemetry(sql, o.telemetryFlushMs ?? 1000);
  let persisted: Partial<BudgetLimits> = {};
  if (sql) {
    try {
      const rows = await sql<{ limits: BudgetLimits }[]>`SELECT limits FROM provider_budgets WHERE id = 1`;
      if (rows[0]) persisted = rows[0].limits;
    } catch {
      /* table may not exist before migrations */
    }
  }
  const budget = new ProviderBudget({ ...persisted, ...(o.budget ?? {}) });
  const guard = new ProviderGuard({
    sink: telemetry,
    budget,
    ...(o.breaker ? { breaker: o.breaker } : {}),
    onError: (e, meta) => telemetry.event({ name: 'provider_error', sessionId: meta.sessionId ?? '', at: Date.now(), geohash5: null, props: { provider: meta.provider, task: meta.task, kind: e.kind } }),
  });
  const providers = buildProviderSet(providerConfigFromEnv());
  if (o.fixtures || config.demoMode) {
    const { fixtureProviders } = await import('./demo.js');
    const f = await fixtureProviders();
    providers.places = [f.places];
    providers.knowledge = [f.knowledge];
  }
  Object.assign(providers, o.providers ?? {});
  const router = new ProviderRouter(providers, guard, o.timeouts ?? {});
  const discovery = new DiscoveryService(router, kv, telemetry);
  const audio = new AudioStore(config.audioDir, router, telemetry);
  const auth = new Auth(config.jwtKey, sql);
  const narration = config.narrationCache ? new NarrationCache(kv, telemetry) : null;
  const sessions = new SessionManager({ router, discovery, audio, telemetry, kv, reducedLimiter: new ReducedModeLimiter(30), narration, ttsTiers: config.ttsTiers, retellAfterDays: config.retellAfterDays }, kv, sql);
  return {
    config,
    sql,
    kv,
    auth,
    telemetry,
    budget,
    guard,
    router,
    providers,
    discovery,
    audio,
    narration,
    sessions,
    redis,
    async close() {
      await sessions.closeAll();
      await telemetry.close();
      await kv.close();
      if (sql) await sql.end({ timeout: 2 });
    },
  };
}
