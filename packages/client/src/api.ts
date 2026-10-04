/**
 * Platform-neutral typed client for the Telvey API (docs/API.md). The base URL and the fetch
 * implementation are injected, so the same code runs in the browser, React Native and Node tests.
 *
 * No secrets live here. Tokens are bearer JWTs issued by the API (guest / account / admin).
 */
import type { ContextFrame, Directive, GuideProfile, LatLng } from '@city/core';
import type { ControlAction } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** Network failure / CORS / no API configured. */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON body (serialized) … */
  body?: unknown;
  /** … or a raw body with its content type (audio upload). */
  raw?: { body: unknown; contentType: string };
  token?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function cleanBaseUrl(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t.replace(/\/+$/, '') : null;
}

/** Absolute URL for a `play`/`say` audio URL that may be API-relative (`/v1/audio/<hash>.mp3`). */
export function resolveAudioUrl(baseUrl: string | null, u: string | null): string | null {
  if (!u) return null;
  if (/^(https?:|blob:|data:|file:)/.test(u)) return u;
  return baseUrl ? `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}` : u;
}

/** Normalize wsUrl (may be relative) and attach the token as documented: `/v1/sessions/:id/ws?token=…`. */
export function wsUrlFor(baseUrl: string, created: { sessionId: string; wsUrl?: string | null }, token: string): string {
  const raw = created.wsUrl || `/v1/sessions/${encodeURIComponent(created.sessionId)}/ws`;
  const u = new URL(raw, baseUrl);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol === 'https:') u.protocol = 'wss:';
  if (!u.searchParams.has('token')) u.searchParams.set('token', token);
  return u.toString();
}


/**
 * Directive batches from REST fallbacks may be `Directive[]`, envelopes, or `{directives: [...]}`.
 * Items without a seq get `seq: null` in the legacy shape; see `parseEnvelopes` for the strict one.
 */
export function parseDirectives(x: unknown): Array<{ directive: Directive; seq: number | null; turn?: number | null; ref?: string | null }> {
  const arr = Array.isArray(x) ? x : x && typeof x === 'object' && Array.isArray((x as { directives?: unknown[] }).directives) ? (x as { directives: unknown[] }).directives : [];
  const out: Array<{ directive: Directive; seq: number | null; turn?: number | null; ref?: string | null }> = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const turn = typeof o.turn === 'number' ? o.turn : null;
    const ref = typeof o.ref === 'string' ? o.ref : null;
    if (o.directive && typeof o.directive === 'object')
      out.push({ directive: o.directive as Directive, seq: typeof o.seq === 'number' ? o.seq : typeof o.directiveSeq === 'number' ? o.directiveSeq : null, turn, ref });
    else if (typeof o.type === 'string') out.push({ directive: o as unknown as Directive, seq: typeof o.directiveSeq === 'number' ? o.directiveSeq : null, turn, ref });
  }
  return out;
}

// ─────────────────────────────────────────── response shapes

export interface GuestResponse {
  guestId: string;
  token: string;
}
export interface SessionCreated {
  sessionId: string;
  wsUrl: string;
  guide: GuideProfile | { id: string; name: string };
  policyVersion: string;
}
export interface SessionEnd {
  durationS: number;
  stories: number;
  costUsdEstimate: number;
}
export interface HistoryItem {
  placeId: string;
  placeName: string;
  at: number;
  depth?: string;
  completed?: boolean;
}
export interface SttResponse {
  text: string;
  provider: string;
  durationS?: number;
  directives?: unknown;
}
export type AdminRole = 'owner' | 'admin' | 'analyst';
export interface PairingRedeemed {
  token: string;
  deviceId: string;
  role: AdminRole;
}
/** Response shapes of apps/api/src/routes/admin.ts (parsed defensively by callers). */
export interface AdminOverview {
  rangeDays: number;
  active?: { dau: number; wau: number; mau: number } | null;
  sessions?: { sessions: number; guest_sessions: number; account_sessions: number; avg_duration_s: number | null; simulated: number } | null;
  funnel: Record<string, number>;
  guideMix?: Array<{ guide_id: string; n: number }>;
  regimeMix?: Array<{ regime: string; n: number }>;
}
export interface AdminLatency {
  interactions: Array<{ interaction: string; n: number; p50: number; p95: number; max: number }>;
}
export interface AdminCost {
  note?: string;
  totalUsd: number;
  perSessionUsd: number | null;
  perActiveUserUsd: number | null;
  byProvider: Array<{ provider: string; category: string; usd: number; calls: number }>;
  byTask?: Array<{ task: string; usd: number; calls: number }>;
  byDay: Array<{ day: string; usd: number }>;
}
export interface AdminHealth {
  api: string;
  db: boolean;
  redis: boolean | string;
  reducedMode?: boolean;
  build?: string;
  hotSessions?: number;
  recentErrors: Array<{ at: string | number; props: Record<string, unknown> }>;
}

export interface AdminUsers {
  users: Array<{ id: string; email: string; role: AdminRole; created_at: string; disabled_at: string | null }>;
  devices: Array<{ id: string; admin_user_id: string; name: string; role: AdminRole; created_at: string; last_seen_at: string | null; revoked_at: string | null }>;
}

/** Role order for UI gating (the server enforces; the client only hides what would 403). */
export function roleAtLeast(role: AdminRole | null | undefined, min: AdminRole): boolean {
  const rank: Record<AdminRole, number> = { analyst: 1, admin: 2, owner: 3 };
  return role ? rank[role] >= rank[min] : false;
}

// ─────────────────────────────────────────── client

export interface ApiClientOptions {
  baseUrl: string | null;
  fetch?: FetchLike;
  defaultTimeoutMs?: number;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ApiClientOptions) {
  const baseUrl = cleanBaseUrl(opts.baseUrl);
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));

  function url(path: string): string {
    if (!baseUrl) throw new ApiError(0, 'not_configured', 'API base URL is not configured.');
    return `${baseUrl}${path}`;
  }

  async function request<T>(path: string, o: RequestOptions = {}): Promise<T> {
    const target = url(path);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? opts.defaultTimeoutMs ?? 10_000);
    o.signal?.addEventListener('abort', () => ctrl.abort());
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      const hasJson = o.body !== undefined;
      res = await doFetch(target, {
        method: o.method ?? (hasJson || o.raw ? 'POST' : 'GET'),
        headers: {
          Accept: 'application/json',
          ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
          ...(o.raw ? { 'Content-Type': o.raw.contentType } : {}),
          ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
        },
        body: o.raw ? o.raw.body : hasJson ? JSON.stringify(o.body) : undefined,
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(0, 'unreachable', e instanceof Error ? e.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json ?? {}) as { code?: string; error?: string; message?: string };
      throw new ApiError(res.status, err.code ?? err.error ?? `http_${res.status}`, err.message ?? (typeof err.error === 'string' ? err.error : res.statusText));
    }
    return json as T;
  }

  const sid = (id: string) => encodeURIComponent(id);

  return {
    baseUrl,
    configured: baseUrl !== null,
    request,
    resolveAudioUrl: (u: string | null) => resolveAudioUrl(baseUrl, u),
    wsUrlFor: (created: SessionCreated, token: string) => wsUrlFor(url(''), created, token),

    health: (timeoutMs = 2500) => request<{ ok?: boolean; status?: string }>('/healthz', { timeoutMs }),
    guest: () => request<GuestResponse>('/v1/guest', { method: 'POST', body: {} }),
    guides: () => request<GuideProfile[] | { guides: GuideProfile[] }>('/v1/guides'),
    createSession: (token: string, body: { guideId: string; locale: string; units: 'metric' | 'imperial'; simulated: boolean; client: { platform: string; appVersion: string; capabilities?: string[] } }) =>
      request<SessionCreated>('/v1/sessions', { body, token }),
    endSession: (token: string, id: string) => request<SessionEnd>(`/v1/sessions/${sid(id)}/end`, { method: 'POST', body: {}, token }),
    context: (token: string, id: string, frame: ContextFrame) => request<unknown>(`/v1/sessions/${sid(id)}/context`, { body: frame, token, timeoutMs: 8000 }),
    utterance: (token: string, id: string, body: { text: string; speechEndAt: number; sttProvider?: string; utteranceId?: string }) =>
      request<unknown>(`/v1/sessions/${sid(id)}/utterance`, { body, token }),
    control: (token: string, id: string, body: { action: ControlAction; at: number } & Record<string, unknown>) => request<unknown>(`/v1/sessions/${sid(id)}/control`, { body, token }),
    audioProgress: (token: string, id: string, body: { planId: string; segmentIndex: number; offsetMs: number; state: 'playing' | 'finished' | 'stopped' }) =>
      request<unknown>(`/v1/sessions/${sid(id)}/audio_progress`, { body, token }),
    directivesAfter: (token: string, id: string, after: number) => request<unknown>(`/v1/sessions/${sid(id)}/directives?after=${after}`, { token }),
    /** Hybrid voice (D-010): raw audio body → transcript; `submit` also runs it as an utterance. */
    stt: (token: string, audio: unknown, contentType: string, q: { sessionId?: string; locale?: string; durationS?: number; submit?: boolean; utteranceId?: string }) => {
      const qs = new URLSearchParams();
      if (q.sessionId) qs.set('sessionId', q.sessionId);
      if (q.locale) qs.set('locale', q.locale);
      if (q.durationS) qs.set('durationS', String(Math.round(q.durationS * 10) / 10));
      if (q.submit) qs.set('submit', '1');
      if (q.utteranceId) qs.set('utteranceId', q.utteranceId);
      return request<SttResponse>(`/v1/stt?${qs.toString()}`, { raw: { body: audio, contentType }, token, timeoutMs: 20_000 });
    },
    nearby: (token: string, body: { sessionId: string; query: string; category?: string; location: LatLng }) => request<unknown>('/v1/nearby', { body, token }),
    feedback: (token: string, body: { sessionId: string; planId?: string; rating: number; reason?: string }) => request<void>('/v1/feedback', { body, token }),
    history: (token: string) => request<HistoryItem[] | { items: HistoryItem[] }>('/v1/me/history', { token }),
    deleteMe: (token: string) => request<void>('/v1/me', { method: 'DELETE', token }),

    // ── admin (D-013 device pairing; role-gated endpoints)
    redeemPairing: (code: string, deviceName: string) => request<PairingRedeemed>('/v1/admin/pairing/redeem', { body: { code: code.trim().toUpperCase(), deviceName } }),
    revokeDevice: (token: string, deviceId: string) => request<void>(`/v1/admin/devices/${sid(deviceId)}`, { method: 'DELETE', token }),
    adminHealth: (token: string) => request<AdminHealth>('/v1/admin/health', { token }),
    adminOverview: (token: string, range: string) => request<AdminOverview>(`/v1/admin/metrics/overview?range=${encodeURIComponent(range)}`, { token }),
    adminLatency: (token: string, range: string) => request<AdminLatency>(`/v1/admin/metrics/latency?range=${encodeURIComponent(range)}`, { token }),
    adminCost: (token: string, range: string) => request<AdminCost>(`/v1/admin/metrics/cost?range=${encodeURIComponent(range)}`, { token }),
    adminUsers: (token: string) => request<AdminUsers>('/v1/admin/users', { token }),
  };
}

/** Parse a pairing QR payload: `telvey://pair?code=XXXX&api=https%3A%2F%2F…` or a bare code. */
export function parsePairingPayload(raw: string): { code: string; api: string | null } | null {
  const s = raw.trim();
  if (/^[A-Za-z0-9-]{6,20}$/.test(s)) return { code: s.toUpperCase(), api: null };
  const m = /^[a-z][a-z0-9+.-]*:\/\/pair\/?\?(.*)$/i.exec(s);
  if (!m) return null;
  const qs = new URLSearchParams(m[1] ?? '');
  const code = qs.get('code');
  if (!code || !/^[A-Za-z0-9-]{6,20}$/.test(code)) return null;
  return { code: code.toUpperCase(), api: cleanBaseUrl(qs.get('api')) };
}
