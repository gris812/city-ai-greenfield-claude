'use client';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Panel } from '@/components/admin/charts';
import { PageHead } from '@/components/admin/PageHead';
import type { AuditResp } from '@/lib/admin/types';

export default function AuditPage() {
  const [q, reload] = useAdminQuery<AuditResp>('/v1/admin/audit?limit=200');
  return (
    <>
      <PageHead title="Audit log" lede="Append-only record of every admin action (D-013).">
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
          Refresh
        </button>
      </PageHead>
      <Panel title="Latest 200 entries" state={q} wide>
        {(d) => (
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={String(e.id)}>
                    <td className="mono t-caption">{new Date(e.at).toLocaleString()}</td>
                    <td className="t-caption">
                      <span className="mono">{e.actor_id?.slice(0, 8) ?? '—'}</span> {e.actor_role}
                    </td>
                    <td>{e.action}</td>
                    <td className="mono t-caption">{e.target ?? '—'}</td>
                    <td className="mono t-caption audit-details">{e.details ? JSON.stringify(e.details) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.entries.length === 0 ? <p className="muted">No entries yet.</p> : null}
          </div>
        )}
      </Panel>
    </>
  );
}
