'use client';
import { useMemo } from 'react';
import { IconClose } from '@/components/companion/icons';
import { formatDuration } from '@/lib/i18n';
import type { DebugEntry } from '@/lib/session/types';
import { useCompanion } from './CompanionProvider';

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

const DECISION_CLASS: Record<string, string> = {
  start_story: 'chip-ok',
  orientation: 'chip-brand',
  resume_story: 'chip-ok',
  abandon_story: 'chip-err',
  silence: '',
  continue_story: 'chip-brand',
  barge_in: 'chip-warn',
};

export function DebugDrawer({ onClose }: { onClose: () => void }) {
  const [s] = useCompanion();
  const entries = s.debug;
  const t0 = useMemo(() => (entries.length ? Math.min(...entries.map((e) => e.t)) : 0), [entries]);
  const current: DebugEntry | undefined = entries.find((e) => e.policy);
  const lat = s.bargeIns.map((b) => b.ms);
  const p50 = percentile(lat, 50);
  const p95 = percentile(lat, 95);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.decision] = (c[e.decision] ?? 0) + 1;
    return c;
  }, [entries]);

  return (
    <aside className="debug" aria-label="Decision timeline" data-testid="debug-drawer">
      <header className="debug-head">
        <div>
          <p className="t-overline">Decision timeline</p>
          <p className="t-caption muted">
            {s.transport?.kind === 'live' ? 'Server directives (full explain: admin › Sessions)' : '@city/core running in this tab'} · session <span className="mono">{s.transport?.sessionId?.slice(-8) ?? '—'}</span>
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close debug" onClick={onClose}>
          <IconClose />
        </button>
      </header>

      <section className="debug-now">
        <dl className="kv">
          <div>
            <dt>Regime</dt>
            <dd>{s.regime}</dd>
          </div>
          <div>
            <dt>Density</dt>
            <dd>{s.density}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{current ? `${current.speedMps} m/s` : '—'}</dd>
          </div>
          <div>
            <dt>Discovery</dt>
            <dd>{current?.trajectory ?? '—'}</dd>
          </div>
          <div>
            <dt>Drive-safe</dt>
            <dd>{s.driveSafe ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>Directives</dt>
            <dd className="mono">{s.directiveCount}</dd>
          </div>
        </dl>
        {current?.policy ? (
          <p className="t-caption muted mono debug-policy">
            near {current.policy.nearRadiusM} m · look-ahead ≤{Math.round(current.policy.lookAheadMaxM / 100) / 10} km · gap {current.policy.minGapS}s · threshold {current.policy.speakThreshold} · story ≤{current.policy.maxStoryS}s
          </p>
        ) : null}
        <p className="t-caption">
          <strong>Barge-in stop</strong>{' '}
          <span className="mono">{lat.length ? `last ${lat[0]} ms · p50 ${p50} ms · p95 ${p95} ms · n=${lat.length}` : 'press the mic while a story plays'}</span>
        </p>
        <p className="t-caption muted">
          {Object.entries(counts)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ') || 'No decisions yet'}
        </p>
      </section>

      {current?.top && current.top.length > 0 ? (
        <section>
          <p className="t-overline debug-sub">Candidates now</p>
          <table className="debug-table">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Score</th>
                <th scope="col">Why not</th>
              </tr>
            </thead>
            <tbody>
              {current.top.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    <span className="muted t-caption"> · {c.relative} {c.distanceM} m</span>
                  </td>
                  <td className="mono">{c.score.toFixed(2)}</td>
                  <td className="t-caption">{c.eligible ? <span className="chip chip-ok">eligible</span> : c.reasons.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section>
        <p className="t-overline debug-sub">Timeline (newest first)</p>
        <ol className="timeline">
          {entries.map((e, i) => (
            <li key={`${e.wall}-${i}`}>
              <span className="mono t-caption muted tl-t">{formatDuration(e.t - t0)}</span>
              <span className={`chip ${DECISION_CLASS[e.decision] ?? ''}`}>{e.decision.replace('_', ' ')}</span>
              <span className="tl-body">
                {e.target ? <strong>{e.target}</strong> : null}
                {e.reason ? <span className="muted"> {e.reason.replace(/_/g, ' ')}</span> : null}
                {e.best ? (
                  <span className="muted t-caption">
                    {' '}
                    · best {e.best} ({e.bestScore})
                  </span>
                ) : null}
                <span className="t-caption muted-3 tl-meta">
                  {e.regime} · {e.density}
                  {typeof e.eligible === 'number' ? ` · ${e.eligible} eligible` : ''}
                  {e.suppressed
                    ? ' · ' +
                      Object.entries(e.suppressed)
                        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                        .slice(0, 3)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(', ')
                    : ''}
                  {e.refresh ? ` · refresh: ${e.refresh}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
