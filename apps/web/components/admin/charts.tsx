'use client';
/**
 * Small, dependency-free SVG/HTML charts for the admin console (dataviz method: thin marks,
 * 4px rounded data-ends, single axis, recessive grid, text in text tokens, legend for ≥2
 * series, a table view for every chart, hover tooltips). Brand categorical palette validated
 * with the dataviz validator for light (#FFF) and dark (#0B3942) surfaces.
 */
import { useState } from 'react';
import type { QueryState } from './AdminShell';

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export const fmtUsd = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export const fmtMs = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`);

/** Wraps a chart/table with the explicit non-data states. Never renders numbers unless status=ok. */
export function Panel<T>({
  title,
  subtitle,
  state,
  children,
  wide,
  testId,
}: {
  title: string;
  subtitle?: string;
  state: QueryState<T>;
  children: (data: T) => React.ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <section className={`panel card${wide ? ' panel-wide' : ''}`} data-testid={testId}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle ? <p className="t-caption muted">{subtitle}</p> : null}
        </div>
        {state.status === 'ok' && state.demo ? <span className="chip chip-sim">Demo data</span> : null}
      </header>
      {state.status === 'ok' ? <div className="panel-body">{children(state.data)}</div> : <NoData state={state} />}
    </section>
  );
}

export function NoData({ state }: { state: QueryState<unknown> }) {
  if (state.status === 'loading') return <div className="nodata" aria-busy="true"><span className="muted">Loading…</span></div>;
  const [title, body] =
    state.status === 'no_api'
      ? ['No data — API not connected', state.detail]
      : state.status === 'no_db'
        ? ['No data — database unavailable', 'The API is up but reports that Postgres is not reachable.']
        : state.status === 'forbidden'
          ? ['Not available for your role', 'Ask an owner for access.']
          : state.status === 'error'
            ? ['Could not load', state.detail]
            : ['', ''];
  return (
    <div className="nodata" role="status" data-testid="nodata">
      <svg viewBox="0 0 48 24" width="48" height="24" aria-hidden>
        <path d="M2 20 H46" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 4" />
      </svg>
      <p className="nodata-title">{title}</p>
      <p className="t-caption muted">{body}</p>
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub ? <p className="t-caption muted">{sub}</p> : null}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: Array<Array<string>> }) {
  return (
    <details className="tableview">
      <summary className="t-caption">Table view</summary>
      <table className="dtable">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j > 0 ? 'num' : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Horizontal bars, one hue (magnitude by category). Value at the bar tip. */
export function BarList({ rows, format = (n) => fmtNum(n), valueHead = 'Value', series = 1 }: { rows: Array<{ label: string; value: number; note?: string }>; format?: (n: number) => string; valueHead?: string; series?: number }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted t-body-sm">No rows in this range.</p>;
  return (
    <>
      <ul className="barlist">
        {rows.map((r) => (
          <li key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
            <span className="barlist-label">{r.label}</span>
            <span className="barlist-track">
              <span className="barlist-bar" style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%`, background: `var(--series-${series})` }} />
              <span className="barlist-val">{format(r.value)}</span>
            </span>
          </li>
        ))}
      </ul>
      <TableView head={['Label', valueHead]} rows={rows.map((r) => [r.label, format(r.value)])} />
    </>
  );
}

/** Funnel: each stage as a bar relative to the first stage, with conversion %. */
export function Funnel({ stages }: { stages: Array<{ label: string; value: number }> }) {
  const first = stages[0]?.value || 0;
  return (
    <>
      <ol className="funnel">
        {stages.map((s) => (
          <li key={s.label}>
            <span className="barlist-label">{s.label}</span>
            <span className="barlist-track">
              <span className="barlist-bar" style={{ width: `${first ? Math.max(0.5, (s.value / first) * 100) : 0}%`, background: 'var(--series-1)' }} />
              <span className="barlist-val">
                {fmtNum(s.value)} <span className="muted">{first ? `· ${Math.round((s.value / first) * 100)}%` : ''}</span>
              </span>
            </span>
          </li>
        ))}
      </ol>
      <TableView head={['Stage', 'Count', '% of first']} rows={stages.map((s) => [s.label, fmtNum(s.value), first ? `${((s.value / first) * 100).toFixed(1)}%` : '—'])} />
    </>
  );
}

/** Columns over time (single series), with hover tooltip, clean y ticks, direct label on the last column. */
export function Columns({ points, format }: { points: Array<{ x: string; y: number }>; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <p className="muted t-body-sm">No rows in this range.</p>;
  const W = 640;
  const H = 200;
  const padL = 44;
  const padB = 22;
  const max = Math.max(...points.map((p) => p.y), 1e-9);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const bw = Math.min(24, ((W - padL) / points.length) * 0.6);
  const x = (i: number) => padL + ((i + 0.5) * (W - padL)) / points.length;
  const y = (v: number) => (H - padB) * (1 - v / top);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <>
      <div className="colchart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Column chart" preserveAspectRatio="none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" />
              <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const h = Math.max(1, (H - padB) - y(p.y));
            const r = Math.min(4, bw / 2, h);
            const x0 = x(i) - bw / 2;
            const y0 = y(p.y);
            return (
              <g key={p.x} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={x(i) - (W - padL) / points.length / 2} y={0} width={(W - padL) / points.length} height={H - padB} fill="transparent" />
                <path d={`M${x0},${H - padB} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${H - padB} Z`} fill="var(--series-1)" opacity={hover === null || hover === i ? 1 : 0.55} />
                {i % Math.ceil(points.length / 7) === 0 ? (
                  <text x={x(i)} y={H - 6} className="axis" textAnchor="middle">
                    {p.x.slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text x={x(points.length - 1)} y={y(points.at(-1)!.y) - 6} className="axis axis-strong" textAnchor="middle">
            {format(points.at(-1)!.y)}
          </text>
        </svg>
        {hover !== null ? (
          <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{points[hover]!.x}</strong>
            <br />
            {format(points[hover]!.y)}
          </div>
        ) : null}
      </div>
      <TableView head={['Day', 'Value']} rows={points.map((p) => [p.x, format(p.y)])} />
    </>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Stacked share bar (mix): segments with 2px surface gaps + legend (identity never colour-only). */
export function ShareBar({ parts }: { parts: Array<{ label: string; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <p className="muted t-body-sm">No rows in this range.</p>;
  const shown = parts.slice(0, 4);
  const other = parts.slice(4).reduce((s, p) => s + p.value, 0);
  const all = other > 0 ? [...shown, { label: 'Other', value: other }] : shown;
  return (
    <>
      <div className="sharebar" role="img" aria-label={all.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        {all.map((p, i) => (
          <span key={p.label} style={{ flexGrow: p.value, background: `var(--series-${Math.min(i + 1, 5)})` }} title={`${p.label}: ${fmtNum(p.value)} (${Math.round((p.value / total) * 100)}%)`} />
        ))}
      </div>
      <ul className="legend">
        {all.map((p, i) => (
          <li key={p.label}>
            <span className="swatch" style={{ background: `var(--series-${Math.min(i + 1, 5)})` }} />
            {p.label} <span className="muted">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
      <TableView head={['Segment', 'Count', 'Share']} rows={all.map((p) => [p.label, fmtNum(p.value), `${((p.value / total) * 100).toFixed(1)}%`])} />
    </>
  );
}
