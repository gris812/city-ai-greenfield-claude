'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { BarList, Columns, Panel, StatTile, fmtUsd } from '@/components/admin/charts';
import { PageHead, RangePicker } from '@/components/admin/PageHead';
import type { CostResp } from '@/lib/admin/types';

export default function CostPage() {
  const [range, setRange] = useState('30d');
  const [q] = useAdminQuery<CostResp>(`/v1/admin/metrics/cost?range=${range}`);
  return (
    <>
      <PageHead title="Cost" lede="Estimated provider spend from the dated price table (D-014). Estimates, not invoices.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="grid">
        <Panel title="Totals" subtitle={q.status === 'ok' ? q.data.note : undefined} state={q} wide>
          {(d) => (
            <div className="stats">
              <StatTile label="Total" value={fmtUsd(d.totalUsd)} />
              <StatTile label="Per session" value={fmtUsd(d.perSessionUsd, 3)} />
              <StatTile label="Per active user" value={fmtUsd(d.perActiveUserUsd, 3)} />
            </div>
          )}
        </Panel>
        <Panel title="Cost by day" state={q} wide>
          {(d) => <Columns points={d.byDay.map((x) => ({ x: String(x.day).slice(0, 10), y: x.usd }))} format={(n) => fmtUsd(n, n < 10 ? 2 : 0)} />}
        </Panel>
        <Panel title="By provider" state={q}>
          {(d) => <BarList rows={d.byProvider.map((p) => ({ label: `${p.provider} · ${p.category}`, value: p.usd, note: `${p.calls} calls` }))} format={(n) => fmtUsd(n)} valueHead="USD" />}
        </Panel>
        <Panel title="By task" state={q}>
          {(d) => <BarList rows={d.byTask.map((p) => ({ label: p.task, value: p.usd, note: `${p.calls} calls` }))} format={(n) => fmtUsd(n)} valueHead="USD" />}
        </Panel>
      </div>
    </>
  );
}
