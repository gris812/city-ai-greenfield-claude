/** Pure view-model helpers for the operator screens (unit-tested). */
import type { AdminCost, AdminHealth, AdminLatency, AdminOverview } from '@city/client';

export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  if (Math.abs(v) < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

export interface Kpis {
  sessions: number | null;
  dau: number | null;
  simulated: number | null;
  funnel: Array<{ key: string; n: number }>;
}

const FUNNEL = ['story_offered', 'story_started', 'story_completed', 'story_skipped', 'story_interrupted', 'story_resumed'] as const;

export function kpisFrom(o: AdminOverview | null): Kpis {
  if (!o) return { sessions: null, dau: null, simulated: null, funnel: [] };
  return {
    sessions: o.sessions?.sessions ?? null,
    dau: o.active?.dau ?? null,
    simulated: o.sessions?.simulated ?? null,
    funnel: FUNNEL.map((k) => ({ key: k, n: Number(o.funnel?.[k] ?? 0) })),
  };
}

/** Cost today (UTC day of `now`) and over the 7-day range. */
export function costSummary(c: AdminCost | null, now: number): { today: number | null; week: number | null; perSession: number | null; note: string | null } {
  if (!c) return { today: null, week: null, perSession: null, note: null };
  const day = new Date(now).toISOString().slice(0, 10);
  const today = (c.byDay ?? []).filter((d) => String(d.day).slice(0, 10) === day).reduce((s, d) => s + Number(d.usd || 0), 0);
  return { today, week: Number(c.totalUsd ?? 0), perSession: c.perSessionUsd ?? null, note: c.note ?? null };
}

/** Interactions that matter on a phone-sized screen, in a stable order. */
const LATENCY_ORDER = ['trigger_to_first_audio', 'speech_end_to_first_audio', 'barge_in_stop', 'nearby_to_result', 'stt'];

export function latencyRows(l: AdminLatency | null): Array<{ key: string; n: number; p50: number; p95: number }> {
  if (!l) return [];
  const rows = (l.interactions ?? []).map((r) => ({ key: r.interaction, n: r.n, p50: Number(r.p50), p95: Number(r.p95) }));
  return rows.sort((a, b) => {
    const ia = LATENCY_ORDER.indexOf(a.key);
    const ib = LATENCY_ORDER.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.key.localeCompare(b.key);
  });
}

export function healthLines(h: AdminHealth | null): Array<{ label: string; ok: boolean; value: string }> {
  if (!h) return [];
  const redisOk = h.redis === true || h.redis === 'ok';
  return [
    { label: 'API', ok: h.api === 'ok', value: h.api },
    { label: 'Database', ok: !!h.db, value: h.db ? 'ok' : 'down' },
    { label: 'Redis', ok: redisOk, value: typeof h.redis === 'string' ? h.redis : h.redis ? 'ok' : 'down' },
    ...(h.reducedMode ? [{ label: 'Mode', ok: false, value: 'reduced' }] : []),
    ...(h.build ? [{ label: 'Build', ok: true, value: h.build.slice(0, 12) }] : []),
  ];
}

export function errorLines(h: AdminHealth | null, max = 8): Array<{ at: string; text: string }> {
  if (!h) return [];
  return (h.recentErrors ?? []).slice(0, max).map((e) => {
    const p = e.props ?? {};
    const text = [p.provider, p.kind, p.message ?? p.code].filter((x) => typeof x === 'string' && x.length > 0).join(' · ') || 'error';
    const at = typeof e.at === 'number' ? new Date(e.at).toISOString() : String(e.at);
    return { at: at.replace('T', ' ').slice(0, 16), text };
  });
}
