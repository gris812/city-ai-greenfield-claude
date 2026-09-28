'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAdmin, useAdminQuery } from '@/components/admin/AdminShell';
import { Panel } from '@/components/admin/charts';
import { PageHead } from '@/components/admin/PageHead';
import { request } from '@/lib/api';
import type { AdminRole, UsersResp } from '@/lib/admin/types';

export default function AdminsPage() {
  const { session } = useAdmin();
  const [q, reload] = useAdminQuery<UsersResp>('/v1/admin/users');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('analyst');
  const [invite, setInvite] = useState<{ email: string; code: string; expiresAt: number } | null>(null);
  const [pair, setPair] = useState<{ code: string; qrPayload: string; expiresAt: number; svg: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ kind: 'device' | 'user'; id: string; label: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const doInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      setInvite(await request('/v1/admin/users/invites', { body: { email, role }, token: session.token }));
      setEmail('');
      reload();
    } catch (e2) {
      setErr(`Invite failed: ${e2 instanceof Error ? e2.message : 'error'}`);
    }
  };
  const doPair = async () => {
    setErr(null);
    try {
      const r = await request<{ code: string; qrPayload: string; expiresAt: number }>('/v1/admin/pairing', { body: {}, token: session.token });
      const svg = await QRCode.toString(r.qrPayload, { type: 'svg', margin: 1, color: { dark: '#0B3942', light: '#FFFFFF' } });
      setPair({ ...r, svg });
    } catch (e2) {
      setErr(`Pairing failed: ${e2 instanceof Error ? e2.message : 'error'}`);
    }
  };
  const doRevoke = async () => {
    if (!revoke) return;
    try {
      await request(revoke.kind === 'device' ? `/v1/admin/devices/${revoke.id}` : `/v1/admin/users/${revoke.id}`, { method: 'DELETE', token: session.token });
      reload();
    } catch (e2) {
      setErr(`Revoke failed: ${e2 instanceof Error ? e2.message : 'error'}`);
    }
    setRevoke(null);
  };

  const left = pair ? Math.max(0, Math.round((pair.expiresAt - now) / 1000)) : 0;
  return (
    <>
      <PageHead title="Admins & devices" lede="Invite admins (passkey sign-up), pair a phone for mobile admin, revoke access. All actions are audited." />
      {err ? <p className="chip chip-err">{err}</p> : null}
      <div className="grid">
        <section className="panel card">
          <h2 className="panel-title">Invite an admin</h2>
          <form className="admin-form" onSubmit={doInvite}>
            <label className="field">
              <span className="label">Email</span>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={session.preview} />
            </label>
            <label className="field">
              <span className="label">Role</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)} disabled={session.preview}>
                <option value="analyst">Analyst — read-only metrics</option>
                <option value="admin">Admin — metrics + session explain</option>
                <option value="owner">Owner — everything, incl. budgets</option>
              </select>
            </label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={session.preview}>
              Create invite code
            </button>
          </form>
          {invite ? (
            <div className="secret">
              <p className="t-caption muted">One-time code for {invite.email} (shown once, expires {new Date(invite.expiresAt).toLocaleString()}):</p>
              <p className="mono secret-code">{invite.code}</p>
              <p className="t-caption muted">They open /admin → “Register passkey”, enter their email and this code.</p>
            </div>
          ) : null}
        </section>
        <section className="panel card">
          <h2 className="panel-title">Pair a phone</h2>
          <p className="t-caption muted">Issues a 5-minute code. The phone gets a revocable token with a role no higher than yours.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void doPair()} disabled={session.preview}>
            Generate pairing code
          </button>
          {pair ? (
            <div className="pair">
              <div className="pair-qr" dangerouslySetInnerHTML={{ __html: pair.svg }} aria-label="Pairing QR code" role="img" />
              <div>
                <p className="mono secret-code">{pair.code}</p>
                <p className={`t-caption ${left === 0 ? 'err-text' : 'muted'}`}>{left === 0 ? 'Expired — generate a new code.' : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</p>
              </div>
            </div>
          ) : null}
        </section>
        <Panel title="Admins" state={q} wide>
          {(d) => (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Since</th>
                    <th scope="col">Status</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {d.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td className="t-caption">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td>{u.disabled_at ? <span className="chip chip-err">disabled</span> : <span className="chip chip-ok">active</span>}</td>
                      <td>
                        {!u.disabled_at && u.email !== session.email ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoke({ kind: 'user', id: u.id, label: u.email })}>
                            Disable
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.invites.length ? <p className="t-caption muted">{d.invites.length} pending invite(s).</p> : null}
            </div>
          )}
        </Panel>
        <Panel title="Paired devices" state={q} wide>
          {(d) => (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Role</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Status</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {d.devices.map((dv) => (
                    <tr key={dv.id}>
                      <td>{dv.name}</td>
                      <td>{dv.role}</td>
                      <td className="t-caption">{dv.last_seen_at ? new Date(dv.last_seen_at).toLocaleString() : '—'}</td>
                      <td>{dv.revoked_at ? <span className="chip chip-err">revoked</span> : <span className="chip chip-ok">active</span>}</td>
                      <td>
                        {!dv.revoked_at ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoke({ kind: 'device', id: dv.id, label: dv.name })}>
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.devices.length === 0 ? <p className="muted t-body-sm">No paired devices.</p> : null}
            </div>
          )}
        </Panel>
      </div>
      {revoke ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="rv-title">
            <h2 id="rv-title" className="t-headline">
              {revoke.kind === 'device' ? 'Revoke device' : 'Disable admin'}
            </h2>
            <p>
              {revoke.kind === 'device' ? 'The device loses admin access immediately: ' : 'This admin and all their devices lose access immediately: '}
              <strong>{revoke.label}</strong>
            </p>
            <div className="sim-row">
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void doRevoke()}>
                Confirm
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoke(null)} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
