'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Panel, fmtMs } from '@/components/admin/charts';
import { PageHead, RangePicker } from '@/components/admin/PageHead';
import type { LatencyResp } from '@/lib/admin/types';

/** PROVISIONAL targets (D-017): docs/PERFORMANCE_COST.md from the owner is still pending. */
const TARGETS: Record<string, { label: string; p50: number; p95: number }> = {
  trigger_to_first_audio: { label: 'Approved moment → first audio', p50: 1500, p95: 3000 },
  cached_story_to_first_audio: { label: 'Cached story → first audio', p50: 300, p95: 800 },
  bargein_stop: { label: 'Barge-in → audio stopped', p50: 150, p95: 300 },
  speech_end_to_first_audio: { label: 'Speech end → first answer audio', p50: 1500, p95: 3000 },
  nearby_to_result: { label: 'Nearby search → result', p50: 1000, p95: 2500 },
  tool_to_map: { label: 'Tool action → map update', p50: 300, p95: 800 },
  realtime_connect: { label: 'Realtime connect → ready', p50: 1000, p95: 2500 },
};

export default function LatencyPage() {
  const [range, setRange] = useState('7d');
  const [q] = useAdminQuery<LatencyResp>(`/v1/admin/metrics/latency?range=${range}`);
  return (
    <>
      <PageHead title="Latency" lede="p50 / p95 per interaction against targets. Targets are provisional until the owner’s performance budget document lands (D-017).">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <Panel title="Interactions" subtitle="Bars: p50 (solid) and p95 (light). Tick: p95 target." state={q} wide testId="panel-latency">
        {(d) => {
          const rows = d.interactions;
          if (rows.length === 0) return <p className="muted">No latency samples in this range.</p>;
          const max = Math.max(...rows.map((r) => Math.max(r.p95, TARGETS[r.interaction]?.p95 ?? 0))) * 1.08;
          return (
            <>
              <ul className="legend">
                <li>
                  <span className="swatch" style={{ background: 'var(--series-1)' }} /> p50
                </li>
                <li>
                  <span className="swatch" style={{ background: 'var(--series-1)', opacity: 0.35 }} /> p95
                </li>
                <li>
                  <span className="swatch swatch-tick" /> p95 target
                </li>
              </ul>
              <ul className="latency">
                {rows.map((r) => {
                  const t = TARGETS[r.interaction];
                  const ok = t ? r.p95 <= t.p95 : null;
                  return (
                    <li key={r.interaction}>
                      <div className="latency-label">
                        <strong>{t?.label ?? r.interaction.replace(/_/g, ' ')}</strong>
                        <span className="t-caption muted">n={r.n}</span>
                      </div>
                      <div className="latency-track" title={`p50 ${fmtMs(r.p50)} · p95 ${fmtMs(r.p95)}${t ? ` · target p50 ${fmtMs(t.p50)} / p95 ${fmtMs(t.p95)}` : ''}`}>
                        <span className="latency-p95" style={{ width: `${(r.p95 / max) * 100}%` }} />
                        <span className="latency-p50" style={{ width: `${(r.p50 / max) * 100}%` }} />
                        {t ? <span className="latency-target" style={{ left: `${(t.p95 / max) * 100}%` }} /> : null}
                      </div>
                      <div className="latency-vals mono t-caption">
                        {fmtMs(r.p50)} / {fmtMs(r.p95)}
                      </div>
                      <div>{ok === null ? <span className="chip">no target</span> : ok ? <span className="chip chip-ok">✓ within</span> : <span className="chip chip-err">! over</span>}</div>
                    </li>
                  );
                })}
              </ul>
              <details className="tableview">
                <summary className="t-caption">Table view</summary>
                <table className="dtable">
                  <thead>
                    <tr>
                      <th scope="col">Interaction</th>
                      <th scope="col">n</th>
                      <th scope="col">p50</th>
                      <th scope="col">p95</th>
                      <th scope="col">max</th>
                      <th scope="col">Target p50 / p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.interaction}>
                        <td>{r.interaction}</td>
                        <td className="num">{r.n}</td>
                        <td className="num">{fmtMs(r.p50)}</td>
                        <td className="num">{fmtMs(r.p95)}</td>
                        <td className="num">{fmtMs(r.max)}</td>
                        <td className="num">{TARGETS[r.interaction] ? `${fmtMs(TARGETS[r.interaction]!.p50)} / ${fmtMs(TARGETS[r.interaction]!.p95)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          );
        }}
      </Panel>
    </>
  );
}
