'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Funnel, Panel, ShareBar, StatTile, fmtNum } from '@/components/admin/charts';
import type { OverviewResp } from '@/lib/admin/types';
import { PageHead, RangePicker } from '@/components/admin/PageHead';

export default function OverviewPage() {
  const [range, setRange] = useState('7d');
  const [q] = useAdminQuery<OverviewResp>(`/v1/admin/metrics/overview?range=${range}`);
  return (
    <>
      <PageHead title="Overview" lede="Who is using Telvey, how long, and what happens to the stories it offers.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="grid">
        <Panel title="Active users" subtitle="Distinct guests + accounts with a session" state={q} testId="panel-active">
          {(d) => (
            <div className="stats">
              <StatTile label="DAU" value={fmtNum(d.active?.dau)} />
              <StatTile label="WAU" value={fmtNum(d.active?.wau)} />
              <StatTile label="MAU" value={fmtNum(d.active?.mau)} />
            </div>
          )}
        </Panel>
        <Panel title="Sessions" subtitle={`Last ${range}`} state={q}>
          {(d) => (
            <div className="stats">
              <StatTile label="Sessions" value={fmtNum(d.sessions?.sessions)} sub={d.sessions ? `${fmtNum(d.sessions.simulated)} simulated` : undefined} />
              <StatTile label="Avg duration" value={d.sessions?.avg_duration_s ? `${Math.round(d.sessions.avg_duration_s / 60)} min` : '—'} />
              <StatTile label="Guest share" value={d.sessions && d.sessions.sessions ? `${Math.round((d.sessions.guest_sessions / d.sessions.sessions) * 100)}%` : '—'} sub={d.sessions ? `${fmtNum(d.sessions.account_sessions)} with account` : undefined} />
            </div>
          )}
        </Panel>
        <Panel title="Stories funnel" subtitle="Offered → started → completed; skips and interruptions" state={q} wide>
          {(d) => (
            <Funnel
              stages={[
                { label: 'Offered', value: d.funnel.story_offered ?? 0 },
                { label: 'Started', value: d.funnel.story_started ?? 0 },
                { label: 'Completed', value: d.funnel.story_completed ?? 0 },
                { label: 'Skipped', value: d.funnel.story_skipped ?? 0 },
                { label: 'Interrupted', value: d.funnel.story_interrupted ?? 0 },
              ]}
            />
          )}
        </Panel>
        <Panel title="Conversation" subtitle="Questions and nearby searches per session" state={q}>
          {(d) => {
            const n = d.sessions?.sessions || 0;
            return (
              <div className="stats">
                <StatTile label="Questions" value={fmtNum(d.funnel.question_asked ?? 0)} sub={n ? `${((d.funnel.question_asked ?? 0) / n).toFixed(2)} / session` : undefined} />
                <StatTile label="Nearby searches" value={fmtNum(d.funnel.nearby_search ?? 0)} sub={n ? `${((d.funnel.nearby_search ?? 0) / n).toFixed(2)} / session` : undefined} />
              </div>
            );
          }}
        </Panel>
        <Panel title="Guide mix" subtitle="Sessions by guide" state={q}>
          {(d) => <ShareBar parts={d.guideMix.map((g) => ({ label: g.guide_id === 'ida' ? 'Ida' : g.guide_id === 'emil' ? 'Emil' : g.guide_id, value: g.n }))} />}
        </Panel>
        <Panel title="Regime mix" subtitle="Stories by movement regime" state={q} wide>
          {(d) => <ShareBar parts={[...d.regimeMix].sort((a, b) => b.n - a.n).map((r) => ({ label: r.regime.replace('_', ' '), value: r.n }))} />}
        </Panel>
      </div>
    </>
  );
}
