'use client';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Panel } from '@/components/admin/charts';
import { PageHead } from '@/components/admin/PageHead';
import type { HealthResp } from '@/lib/admin/types';
import { config } from '@/lib/config';

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="health-item">
      <span className={`chip ${ok ? 'chip-ok' : 'chip-err'}`}>{ok ? '✓ OK' : '! Down'}</span>
      <span>{label}</span>
    </div>
  );
}

export default function HealthPage() {
  const [q, reload] = useAdminQuery<HealthResp>('/v1/admin/health');
  return (
    <>
      <PageHead title="Health" lede="API, database and cache status, recent provider errors, build.">
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
          Refresh
        </button>
      </PageHead>
      <div className="grid">
        <Panel title="Services" state={q}>
          {(d) => (
            <div className="health">
              <Status ok={d.api === 'ok'} label="API" />
              <Status ok={Boolean(d.db)} label="Postgres" />
              <Status ok={d.redis === true || d.redis === 'ok' || d.redis === 'PONG'} label={`Redis${d.reducedMode ? ' (reduced mode)' : ''}`} />
              <p className="t-caption muted">
                API build <span className="mono">{d.build ?? '—'}</span> · web build <span className="mono">{config.buildSha}</span> · hot sessions {d.hotSessions ?? '—'}
              </p>
            </div>
          )}
        </Panel>
        <Panel title="Recent provider errors" state={q}>
          {(d) =>
            d.recentErrors.length === 0 ? (
              <p className="muted">No recent provider errors.</p>
            ) : (
              <ul className="loglist">
                {d.recentErrors.map((e, i) => (
                  <li key={i}>
                    <span className="mono t-caption muted">{new Date(e.at).toLocaleString()}</span>
                    <span className="mono t-caption">{JSON.stringify(e.props)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </Panel>
      </div>
    </>
  );
}
