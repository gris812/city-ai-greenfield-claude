'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Panel, fmtNum } from '@/components/admin/charts';
import { GeoMap } from '@/components/admin/GeoMap';
import { PageHead, RangePicker } from '@/components/admin/PageHead';
import type { GeoResp } from '@/lib/admin/types';

export default function GeoPage() {
  const [range, setRange] = useState('30d');
  const [q] = useAdminQuery<GeoResp>(`/v1/admin/metrics/geo?range=${range}`);
  return (
    <>
      <PageHead title="Geo" lede="Where sessions happen, at geohash-5 (≈5 km) resolution only (D-012).">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <p className="notice-inline">
        k-anonymity: cells with fewer than {q.status === 'ok' ? q.data.kAnonymity : 5} distinct sessions are withheld by the API. Precise coordinates are never stored, so they cannot be shown here.
      </p>
      <div className="grid">
        <Panel title="Session density" subtitle="Dot area ∝ sessions per cell" state={q} wide>
          {(d) => (d.cells.length ? <GeoMap cells={d.cells} /> : <p className="muted">No cells meet the k-anonymity threshold in this range.</p>)}
        </Panel>
        <Panel title="Cells" state={q} wide>
          {(d) => (
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th scope="col">Geohash-5</th>
                    <th scope="col">Sessions</th>
                    <th scope="col">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cells.map((c) => (
                    <tr key={c.geohash5}>
                      <td className="mono">{c.geohash5}</td>
                      <td className="num">{fmtNum(c.sessions)}</td>
                      <td className="num">{fmtNum(c.events)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
