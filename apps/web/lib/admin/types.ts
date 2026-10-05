/** Response shapes of apps/api/src/routes/admin.ts (kept in sync by hand; parsed defensively). */
export type AdminRole = 'owner' | 'admin' | 'analyst';

export interface OverviewResp {
  rangeDays: number;
  active?: { dau: number; wau: number; mau: number } | null;
  sessions?: { sessions: number; guest_sessions: number; account_sessions: number; avg_duration_s: number | null; simulated: number } | null;
  funnel: Record<string, number>;
  guideMix: Array<{ guide_id: string; n: number }>;
  regimeMix: Array<{ regime: string; n: number }>;
}
export interface LatencyResp {
  interactions: Array<{ interaction: string; n: number; p50: number; p95: number; max: number }>;
}
export interface CostResp {
  note?: string;
  totalUsd: number;
  perSessionUsd: number | null;
  perActiveUserUsd: number | null;
  byProvider: Array<{ provider: string; category: string; usd: number; calls: number }>;
  byTask: Array<{ task: string; usd: number; calls: number }>;
  byDay: Array<{ day: string; usd: number }>;
}
export interface ProvidersResp {
  calls: Array<{ provider: string; category: string; task: string; calls: number; errors: number; cache_hits: number; p50_ms: number | null; p95_ms: number | null }>;
  cacheByLayer: Array<{ layer: string; hits: number; lookups: number; hit_rate: number | null }>;
  errors: Array<{ provider: string | null; kind: string | null; n: number }>;
  breakers?: unknown;
  configured?: unknown;
}
export interface QualityResp {
  not_that_one: number | null;
  skips: number | null;
  stories: number | null;
  grounding_failures: number | null;
  template_fallbacks: number | null;
  avg_rating: number | null;
  feedback_count: number | null;
}
export interface GeoResp {
  kAnonymity: number;
  precision: number;
  cells: Array<{ geohash5: string; sessions: number; events: number }>;
}
export interface HealthResp {
  api: string;
  db: boolean;
  redis: boolean | string;
  reducedMode?: boolean;
  build?: string;
  hotSessions?: number;
  telemetry?: Record<string, unknown>;
  breakers?: unknown;
  recentErrors: Array<{ at: string | number; props: Record<string, unknown> }>;
}
export interface ExplainResp {
  sessionId: string;
  timeline: Array<{
    t: number;
    regime: string;
    density: string;
    decision: string;
    reason?: string;
    target?: { id: string; name: string; score: number };
    top: Array<{ id: string; name: string; score: number; eligible: boolean; suppressedBy: string[]; distanceBucketM: number }>;
    providerCalls?: number;
  }>;
  events: Array<{ name: string; at: string; regime: string | null; props: Record<string, unknown> }>;
  stories: Array<{ id: string; place_name: string; place_kind: string; angle: string; mode: string; generated_by: string; grounding_ok: boolean | null; fallback_reason: string | null; status: string; created_at: string }>;
  summary: unknown;
}
export interface BudgetLimits {
  perSession: Partial<Record<string, number>>;
  perMinuteGlobal: Partial<Record<string, number>>;
  realtimeSecondsPerSession: number;
  usdPerSession: number;
  killed: string[];
}
export interface BudgetsResp {
  limits: BudgetLimits;
  defaults?: BudgetLimits;
}
export interface AuditResp {
  entries: Array<{ id: number | string; at: string; actor_id: string | null; actor_role: string | null; action: string; target: string | null; details: unknown }>;
}
export interface UsersResp {
  users: Array<{ id: string; email: string; role: AdminRole; created_at: string; disabled_at: string | null }>;
  devices: Array<{ id: string; admin_user_id: string; name: string; role: AdminRole; created_at: string; last_seen_at: string | null; revoked_at: string | null }>;
  invites: Array<{ id: string; kind: string; email: string; role: AdminRole; expires_at: string; used_at: string | null }>;
}
