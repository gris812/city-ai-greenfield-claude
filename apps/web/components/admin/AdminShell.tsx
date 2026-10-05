'use client';
/**
 * Admin console shell: passkey login (D-013, no static passwords), role-aware nav, and a
 * data hook that NEVER fabricates numbers — when the API is unreachable every view shows an
 * explicit "No data — API not connected" state. A "Demo data" toggle exists only in the
 * disconnected preview and labels every chart.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Lockup } from '@/components/brand';
import { IconKey, IconLock } from '@/components/companion/icons';
import { ApiError, apiConfigured, request } from '@/lib/api';
import { config } from '@/lib/config';
import { DEMO } from '@/lib/admin/demo';
import type { AdminRole } from '@/lib/admin/types';

interface Session {
  token: string | null;
  role: AdminRole;
  email: string;
  preview: boolean;
  exp: number;
}
interface AdminCtx {
  session: Session;
  demo: boolean;
  setDemo(v: boolean): void;
  logout(): void;
}
const Ctx = createContext<AdminCtx | null>(null);
const KEY = 'telvey.admin.v1';
const RANK: Record<AdminRole, number> = { analyst: 1, admin: 2, owner: 3 };

export function hasRole(role: AdminRole, need: AdminRole): boolean {
  return RANK[role] >= RANK[need];
}

function jwtExp(token: string): number {
  try {
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return p.exp ? p.exp * 1000 : Date.now() + 12 * 3600_000;
  } catch {
    return Date.now() + 12 * 3600_000;
  }
}

const NAV: Array<{ href: string; label: string; role: AdminRole; group: string }> = [
  { href: '/admin', label: 'Overview', role: 'analyst', group: 'Metrics' },
  { href: '/admin/latency', label: 'Latency', role: 'analyst', group: 'Metrics' },
  { href: '/admin/cost', label: 'Cost', role: 'analyst', group: 'Metrics' },
  { href: '/admin/providers', label: 'Providers', role: 'analyst', group: 'Metrics' },
  { href: '/admin/quality', label: 'Quality', role: 'analyst', group: 'Metrics' },
  { href: '/admin/geo', label: 'Geo', role: 'analyst', group: 'Metrics' },
  { href: '/admin/health', label: 'Health', role: 'analyst', group: 'Operations' },
  { href: '/admin/sessions', label: 'Session explain', role: 'admin', group: 'Operations' },
  { href: '/admin/budgets', label: 'Budgets & kill switches', role: 'owner', group: 'Control' },
  { href: '/admin/audit', label: 'Audit log', role: 'owner', group: 'Control' },
  { href: '/admin/admins', label: 'Admins & devices', role: 'owner', group: 'Control' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [demo, setDemo] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Session;
        if (s.exp > Date.now()) setSession(s);
        else sessionStorage.removeItem(KEY);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => setNavOpen(false), [path]);

  const save = (s: Session | null) => {
    setSession(s);
    try {
      if (s && !s.preview) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };
  const logout = useCallback(() => {
    save(null);
    setDemo(false);
  }, []);

  if (!loaded) return <div className="admin-loading" aria-busy="true" />;
  if (!session) return <AdminLogin onSession={save} />;

  const items = NAV;
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <Ctx.Provider value={{ session, demo, setDemo, logout }}>
      <div className="admin" data-testid="admin-console">
        <aside className={`admin-nav${navOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
          <div className="admin-brand">
            <Lockup height={22} />
            <span className="chip chip-brand">Admin</span>
          </div>
          {groups.map((g) => (
            <div key={g} className="admin-nav-group">
              <p className="t-overline muted-3">{g}</p>
              {items
                .filter((i) => i.group === g)
                .map((i) => {
                  const allowed = hasRole(session.role, i.role);
                  const active = path === i.href;
                  return allowed ? (
                    <Link key={i.href} href={i.href} className={`admin-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                      {i.label}
                    </Link>
                  ) : (
                    <span key={i.href} className="admin-link is-locked" title={`Requires ${i.role}`}>
                      {i.label} <IconLock size={13} />
                    </span>
                  );
                })}
            </div>
          ))}
          <div className="admin-me">
            <p className="t-caption">
              <strong>{session.preview ? 'Preview (not signed in)' : session.email}</strong>
              <br />
              <span className="muted">role: {session.preview ? 'none — no API' : session.role}</span>
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              {session.preview ? 'Exit preview' : 'Sign out'}
            </button>
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-top">
            <button type="button" className="icon-btn admin-menu" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen((x) => !x)}>
              ☰
            </button>
            {session.preview ? (
              <span className="chip chip-warn chip-dot" data-testid="no-api-chip">
                API not connected
              </span>
            ) : (
              <span className="chip chip-ok chip-dot">Connected · {new URL(config.apiBaseUrl ?? 'http://api').host}</span>
            )}
            <span className="admin-top-spacer" />
            {session.preview ? (
              <label className="demo-toggle">
                <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} data-testid="demo-toggle" />
                <span>Demo data</span>
              </label>
            ) : null}
          </header>
          {demo ? (
            <div className="demo-banner" role="status">
              DEMO DATA — synthetic sample values for layout review. Nothing on this screen is a real measurement.
            </div>
          ) : null}
          <main className="admin-content">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function useAdmin(): AdminCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside AdminShell');
  return c;
}

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T; demo: boolean }
  | { status: 'no_api'; detail: string }
  | { status: 'no_db' }
  | { status: 'forbidden' }
  | { status: 'error'; detail: string };

export function useAdminQuery<T>(path: string | null, deps: unknown[] = []): [QueryState<T>, () => void] {
  const { session, demo, logout } = useAdmin();
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const base = path.split('?')[0]!;
    if (session.preview) {
      if (demo && DEMO[base]) setState({ status: 'ok', data: DEMO[base] as T, demo: true });
      else setState({ status: 'no_api', detail: apiConfigured() ? 'The API did not respond.' : 'NEXT_PUBLIC_API_BASE_URL is not set for this build.' });
      return;
    }
    setState({ status: 'loading' });
    request<T>(path, { token: session.token })
      .then((data) => !cancelled && setState({ status: 'ok', data, demo: false }))
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          if (e.status === 401) return logout();
          if (e.status === 403) return setState({ status: 'forbidden' });
          if (e.status === 503) return setState({ status: 'no_db' });
          if (e.unreachable) return setState({ status: 'no_api', detail: e.message });
          return setState({ status: 'error', detail: `${e.status} ${e.code}` });
        }
        setState({ status: 'error', detail: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, session, demo, nonce, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, () => setNonce((n) => n + 1)];
}

// ─────────────────────────────────────────────── login

function AdminLogin({ onSession }: { onSession: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [api, setApi] = useState<'checking' | 'up' | 'down' | 'unset'>(apiConfigured() ? 'checking' : 'unset');
  const [webauthn, setWebauthn] = useState(true);

  useEffect(() => {
    setWebauthn(browserSupportsWebAuthn());
    if (!apiConfigured()) return;
    request('/healthz', { timeoutMs: 3000 })
      .then(() => setApi('up'))
      .catch(() => setApi('down'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      let res: { token: string; role: AdminRole };
      if (mode === 'login') {
        const opts = await request<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/v1/admin/webauthn/login/options', { body: { email } });
        const assertion = await startAuthentication({ optionsJSON: opts });
        res = await request('/v1/admin/webauthn/login/verify', { body: { email, response: assertion } });
      } else {
        const opts = await request<Parameters<typeof startRegistration>[0]['optionsJSON']>('/v1/admin/webauthn/register/options', { body: { email, code } });
        const att = await startRegistration({ optionsJSON: opts });
        res = await request('/v1/admin/webauthn/register/verify', { body: { email, code, response: att } });
      }
      onSession({ token: res.token, role: res.role, email, preview: false, exp: jwtExp(res.token) });
    } catch (e2) {
      if (e2 instanceof ApiError) setErr(e2.unreachable ? 'The API could not be reached.' : e2.code === 'invalid_code' ? 'That code is invalid or expired.' : 'Sign-in failed. Check your email and passkey.');
      else if (e2 instanceof Error && e2.name === 'NotAllowedError') setErr('Passkey prompt was cancelled or timed out.');
      else setErr('Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = api !== 'up' || !webauthn || busy;
  return (
    <div className="admin-login" data-testid="admin-login">
      <div className="admin-login-card card">
        <Lockup height={28} />
        <h1 className="t-title2">Admin console</h1>
        <p className="muted t-body-sm">Sign in with your passkey. There are no passwords. New admins need an invite code from an owner (or the one-time bootstrap code for the first owner).</p>
        {api === 'unset' || api === 'down' ? (
          <div className="admin-alert" role="alert" data-testid="admin-no-api">
            <strong>API not connected.</strong> {api === 'unset' ? 'This build has no NEXT_PUBLIC_API_BASE_URL.' : 'The API did not respond to a health check.'} Sign-in is unavailable and no metrics can be shown.
          </div>
        ) : null}
        {!webauthn ? <div className="admin-alert">This browser does not support passkeys (WebAuthn).</div> : null}
        <div className="segmented" role="tablist" aria-label="Sign-in mode">
          <button type="button" role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
            Register passkey
          </button>
        </div>
        <form className="admin-form" onSubmit={submit}>
          <label className="field">
            <span className="label">Work email</span>
            <input className="input" type="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === 'register' ? (
            <label className="field">
              <span className="label">Invite or bootstrap code</span>
              <input className="input mono" required minLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="one-time-code" />
            </label>
          ) : null}
          {err ? (
            <p className="admin-err" role="alert">
              {err}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            <IconKey /> {busy ? 'Waiting for passkey…' : mode === 'login' ? 'Sign in with passkey' : 'Create passkey'}
          </button>
        </form>
        {api === 'unset' || api === 'down' ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSession({ token: null, role: 'owner', email: '', preview: true, exp: Date.now() + 3600_000 })} data-testid="admin-preview">
            Preview the console layout (no data)
          </button>
        ) : null}
        <p className="t-caption muted-3">Mobile admin: pair your phone from “Admins & devices” after signing in.</p>
      </div>
    </div>
  );
}
