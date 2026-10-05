'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { BarList, Panel, fmtMs, fmtNum, fmtPct } from '@/components/admin/charts';
import { PageHead, RangePicker } from '@/components/admin/PageHead';
import type { ProvidersResp } from '@/lib/admin/types';

export default function ProvidersPage() {
  const [range, setRange] = useState('7d');
  const [q] = useAdminQuery<ProvidersResp>(`/v1/admin/metrics/providers?range=${range}`);
  return (
    <>
      <PageHead title="Providers" lede="Calls, errors, fallbacks and cache hit rates by layer.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="grid">
        <Panel title="Calls by provider and task" state={q} wide>
          {(d) => (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Task</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Errors</th>
                    <th scope="col">Error rate</th>
                    <th scope="col">Cache hits</th>
                    <th scope="col">p50</th>
                    <th scope="col">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {d.calls.map((c) => (
                    <tr key={`${c.provider}-${c.task}`}>
                      <td>
                        {c.provider} <span className="muted t-caption">{c.category}</span>
                      </td>
                      <td>{c.task}</td>
                      <td className="num">{fmtNum(c.calls)}</td>
                      <td className="num">{fmtNum(c.errors)}</td>
                      <td className="num">{c.calls ? fmtPct(c.errors / c.calls) : '—'}</td>
                      <td className="num">{fmtNum(c.cache_hits)}</td>
                      <td className="num">{fmtMs(c.p50_ms)}</td>
                      <td className="num">{fmtMs(c.p95_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.calls.length === 0 ? <p className="muted">No provider calls in this range.</p> : null}
            </div>
          )}
        </Panel>
        <Panel title="Cache hit rate by layer" state={q}>
          {(d) => <BarList rows={d.cacheByLayer.map((c) => ({ label: c.layer, value: c.hit_rate ?? 0, note: `${c.hits}/${c.lookups}` }))} format={(n) => fmtPct(n)} valueHead="Hit rate" />}
        </Panel>
        <Panel title="Errors & fallbacks" state={q}>
          {(d) => <BarList rows={d.errors.map((e) => ({ label: `${e.provider ?? '?'} · ${e.kind ?? 'error'}`, value: e.n }))} series={2} valueHead="Count" />}
        </Panel>
      </div>
    </>
  );
}
