/**
 * Operator access on the phone (D-013): no passwords, no static secrets. An authorized web admin
 * issues a 5-minute pairing code/QR; the phone redeems it for a revocable, role-scoped device
 * token (role ≤ issuer's), stored in the OS keystore (expo-secure-store). Every admin read is
 * live — nothing is cached to disk — and "Sign out" revokes the device server-side.
 */
import { ApiError, createApiClient, roleAtLeast, type AdminCost, type AdminHealth, type AdminLatency, type AdminOverview, type AdminRole, type AdminUsers } from '@city/client';
import { fetch as expoFetch } from 'expo/fetch';
import { config } from '../config';
import { pairingApiAllowed } from '../logic/config';
import { KEYS, secure } from '../storage';

export interface AdminSession {
  token: string;
  deviceId: string;
  role: AdminRole;
  apiBaseUrl: string;
  deviceName: string;
  pairedAt: number;
}

export interface AdminSnapshot {
  loaded: boolean;
  session: AdminSession | null;
  status: 'idle' | 'loading' | 'ready' | 'unreachable' | 'error';
  error: string | null;
  health: AdminHealth | null;
  overview1d: AdminOverview | null;
  cost7d: AdminCost | null;
  latency: AdminLatency | null;
  users: AdminUsers | null;
  fetchedAt: number | null;
}

export type PairResult = { ok: true } | { ok: false; reason: 'invalid' | 'api_mismatch' | 'no_api' | 'unreachable' | 'error' };

function apiFor(base: string | null) {
  return createApiClient({ baseUrl: base, fetch: (url, init) => expoFetch(url, init as never) as never });
}

export class AdminStore {
  private snap: AdminSnapshot = { loaded: false, session: null, status: 'idle', error: null, health: null, overview1d: null, cost7d: null, latency: null, users: null, fetchedAt: null };
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): AdminSnapshot => this.snap;

  private set(p: Partial<AdminSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  async load(): Promise<void> {
    if (this.snap.loaded) return;
    const session = await secure.get<AdminSession>(KEYS.admin);
    this.set({ loaded: true, session: session && session.token ? session : null });
  }

  can(min: AdminRole): boolean {
    return roleAtLeast(this.snap.session?.role, min);
  }

  async pair(code: string, deviceName: string, qrApi: string | null = null): Promise<PairResult> {
    const allowed = pairingApiAllowed(qrApi, config.apiBaseUrl, __DEV__);
    if (!allowed.ok || !allowed.api) return { ok: false, reason: allowed.reason === 'api_mismatch' ? 'api_mismatch' : 'no_api' };
    const api = apiFor(allowed.api);
    try {
      const r = await api.redeemPairing(code, deviceName.trim() || 'Phone');
      const session: AdminSession = { token: r.token, deviceId: r.deviceId, role: r.role, apiBaseUrl: allowed.api, deviceName: deviceName.trim() || 'Phone', pairedAt: Date.now() };
      await secure.set(KEYS.admin, session);
      this.set({ session, status: 'idle', error: null });
      void this.refresh();
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) return { ok: false, reason: 'invalid' };
      if (e instanceof ApiError && e.unreachable) return { ok: false, reason: 'unreachable' };
      return { ok: false, reason: 'error' };
    }
  }

  async refresh(): Promise<void> {
    const s = this.snap.session;
    if (!s) return;
    const api = apiFor(s.apiBaseUrl);
    this.set({ status: 'loading', error: null });
    const guard = async <T>(p: Promise<T>): Promise<T | null> => {
      try {
        return await p;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e; // token revoked/expired
        if (e instanceof ApiError && e.unreachable) throw e;
        return null; // 403 (role) or 503 (no DB): section shows its empty state
      }
    };
    try {
      const [health, overview1d, cost7d, latency, users] = await Promise.all([
        guard(api.adminHealth(s.token)),
        guard(api.adminOverview(s.token, '1d')),
        guard(api.adminCost(s.token, '7d')),
        guard(api.adminLatency(s.token, '1d')),
        roleAtLeast(s.role, 'owner') ? guard(api.adminUsers(s.token)) : Promise.resolve(null),
      ]);
      this.set({ status: 'ready', health, overview1d, cost7d, latency, users, fetchedAt: Date.now() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.forget();
        this.set({ status: 'error', error: 'revoked' });
        return;
      }
      // Never show stale operator data: clear everything when the API cannot be reached.
      this.set({ status: 'unreachable', error: e instanceof Error ? e.message : 'unreachable', health: null, overview1d: null, cost7d: null, latency: null, users: null });
    }
  }

  async revokeDevice(id: string): Promise<boolean> {
    const s = this.snap.session;
    if (!s) return false;
    try {
      await apiFor(s.apiBaseUrl).revokeDevice(s.token, id);
      if (id === s.deviceId) await this.forget();
      else void this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Sign out: revoke this device server-side (best effort), then wipe the local token. */
  async signOut(): Promise<void> {
    const s = this.snap.session;
    if (s) {
      try {
        await apiFor(s.apiBaseUrl).revokeDevice(s.token, s.deviceId);
      } catch {
        /* offline: the token still expires server-side; local copy is wiped below */
      }
    }
    await this.forget();
  }

  private async forget(): Promise<void> {
    await secure.set(KEYS.admin, null);
    this.set({ session: null, status: 'idle', health: null, overview1d: null, cost7d: null, latency: null, users: null, fetchedAt: null });
  }
}

let singleton: AdminStore | null = null;
export function adminStore(): AdminStore {
  singleton ??= new AdminStore();
  return singleton;
}
