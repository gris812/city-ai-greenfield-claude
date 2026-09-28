'use client';
import { useState } from 'react';
import { useAdminQuery } from '@/components/admin/AdminShell';
import { Panel, StatTile, fmtNum, fmtPct } from '@/components/admin/charts';
import { PageHead, RangePicker } from '@/components/admin/PageHead';
import type { QualityResp } from '@/lib/admin/types';

export default function QualityPage() {
  const [range, setRange] = useState('7d');
  const [q] = useAdminQuery<QualityResp>(`/v1/admin/metrics/quality?range=${range}`);
  const rate = (a: number | null, b: number | null) => (a !== null && b ? fmtPct(a / b) : '—');
  return (
    <>
      <PageHead title="Quality" lede="Wrong-target signals, skips, feedback and grounding failures.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="grid">
        <Panel title="Wrong target & skips" state={q}>
          {(d) => (
            <div className="stats">
              <StatTile label="“Not that one”" value={fmtNum(d.not_that_one)} sub={`${rate(d.not_that_one, d.stories)} of stories`} />
              <StatTile label="Skips" value={fmtNum(d.skips)} sub={`${rate(d.skips, d.stories)} of stories`} />
            </div>
          )}
        </Panel>
        <Panel title="Grounding" subtitle="LLM output rejected by GroundingCheck → template fallback" state={q}>
          {(d) => (
            <div className="stats">
              <StatTile label="Grounding failures" value={fmtNum(d.grounding_failures)} sub={`${rate(d.grounding_failures, d.stories)} of stories`} />
              <StatTile label="Template stories" value={fmtNum(d.template_fallbacks)} sub={`${rate(d.template_fallbacks, d.stories)} of stories`} />
            </div>
          )}
        </Panel>
        <Panel title="Feedback" state={q}>
          {(d) => (
            <div className="stats">
              <StatTile label="Average rating" value={d.avg_rating !== null ? `${d.avg_rating.toFixed(2)} / 5` : '—'} />
              <StatTile label="Responses" value={fmtNum(d.feedback_count)} />
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
