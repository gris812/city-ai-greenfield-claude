/**
 * Typed client for the Telvey API (docs/API.md). Contract types come from @city/core; admin
 * response shapes are defined in lib/admin/types.ts and parsed defensively, because the
 * admin metrics payloads are not yet pinned down in docs/API.md.
 *
 * No secrets live here. Tokens are bearer JWTs issued by the API (guest / account / admin).
 */
import type { ContextFrame, GuideProfile, LatLng } from '@city/core';
import { config } from './config';
import type { ControlAction } from './session/types';

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

export function apiConfigured(): boolean {
  return config.apiBaseUrl !== null;
}

export function apiUrl(path: string): string {
  if (!config.apiBaseUrl) throw new ApiError(0, 'not_configured', 'API base URL is not configured (NEXT_PUBLIC_API_BASE_URL).');
  return `${config.apiBaseUrl}${path}`;
}

/** Absolute URL for a `play`/`say` audio URL that may be API-relative (`/v1/audio/<hash>.mp3`). */
export function resolveAudioUrl(u: string | null): string | null {
  if (!u) return null;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  return config.apiBaseUrl ? `${config.apiBaseUrl}${u.startsWith('/') ? '' : '/'}${u}` : u;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = apiUrl(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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

// ─────────────────────────────────────────── public / session API

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

/** Directive batches from REST fallbacks — shared parser (@city/client). */
export { parseDirectives } from '@city/client';

export const api = {
  health: (timeoutMs = 2500) => request<{ ok?: boolean; status?: string }>('/healthz', { timeoutMs }),
  guest: () => request<GuestResponse>('/v1/guest', { method: 'POST', body: {} }),
  otpStart: (email: string) => request<void>('/v1/auth/otp/start', { body: { email } }),
  otpVerify: (email: string, code: string, token: string | null) => request<{ token: string; user: { id: string; email: string } }>('/v1/auth/otp/verify', { body: { email, code }, token }),
  guides: () => request<GuideProfile[] | { guides: GuideProfile[] }>('/v1/guides'),
  createSession: (
    token: string,
    body: { guideId: string; locale: string; units: 'metric' | 'imperial'; simulated: boolean; client: { platform: string; appVersion: string } },
  ) => request<SessionCreated>('/v1/sessions', { body, token }),
  endSession: (token: string, id: string) => request<SessionEnd>(`/v1/sessions/${encodeURIComponent(id)}/end`, { method: 'POST', body: {}, token }),
  context: (token: string, id: string, frame: ContextFrame) => request<unknown>(`/v1/sessions/${encodeURIComponent(id)}/context`, { body: frame, token, timeoutMs: 8000 }),
  utterance: (token: string, id: string, body: { text: string; speechEndAt: number; sttProvider?: string }) =>
    request<unknown>(`/v1/sessions/${encodeURIComponent(id)}/utterance`, { body, token }),
  control: (token: string, id: string, body: { action: ControlAction; at: number } & Record<string, unknown>) =>
    request<unknown>(`/v1/sessions/${encodeURIComponent(id)}/control`, { body, token }),
  nearby: (token: string, body: { sessionId: string; query: string; category?: string; location: LatLng }) => request<unknown>('/v1/nearby', { body, token }),
  feedback: (token: string, body: { sessionId: string; planId?: string; rating: number; reason?: string }) => request<void>('/v1/feedback', { body, token }),
  history: (token: string) => request<HistoryItem[] | { items: HistoryItem[] }>('/v1/me/history', { token }),
  deleteMe: (token: string) => request<void>('/v1/me', { method: 'DELETE', token }),
};

/** Normalize wsUrl (may be relative) and attach the token as documented: `/v1/sessions/:id/ws?token=…`. */
export function wsUrlFor(created: SessionCreated, token: string): string {
  const raw = created.wsUrl || `/v1/sessions/${encodeURIComponent(created.sessionId)}/ws`;
  const base = config.apiBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const u = new URL(raw, base);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol === 'https:') u.protocol = 'wss:';
  if (!u.searchParams.has('token')) u.searchParams.set('token', token);
  return u.toString();
}
