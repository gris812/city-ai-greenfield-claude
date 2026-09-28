/**
 * Telemetry writer: cost ledger (D-014), events (geohash-5 only, D-012), latency samples
 * and story rows. Buffered, batched inserts; a bounded buffer means a Postgres outage drops
 * telemetry (counted) rather than growing memory or blocking the session runtime.
 */
import type { CostRecord, TelemetryEvent } from '@city/core';
import type { CostSink } from '@city/providers';
import type { Sql } from './db.js';

export interface LatencySample {
  sessionId: string | null;
  interaction: string;
  ms: number;
  at: number;
  props?: Record<string, string | number | boolean | null>;
}

export interface StoryRow {
  id: string;
  sessionId: string;
  placeId: string;
  placeName: string;
  placeKind: string;
  angle: string | null;
  mode: string | null;
  guideId: string;
  locale: string;
  regime: string | null;
  geohash5: string | null;
  generatedBy: 'llm' | 'template';
  provider: string | null;
  model: string | null;
  groundingOk: boolean;
  fallbackReason: string | null;
  segments: number;
  words: number;
}

const MAX_BUFFER = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (s: string | null | undefined) => (s && UUID.test(s) ? s : null);

export class Telemetry implements CostSink {
  private costs: CostRecord[] = [];
  private events: TelemetryEvent[] = [];
  private latencies: LatencySample[] = [];
  private stories: StoryRow[] = [];
  private storyStatus: Array<{ id: string; status: string; at: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  stats = { dropped: 0, flushErrors: 0, written: 0 };
  /** In-process listeners (tests, explain timeline). */
  readonly listeners = { cost: [] as Array<(r: CostRecord) => void>, event: [] as Array<(e: TelemetryEvent) => void>, latency: [] as Array<(s: LatencySample) => void> };

  constructor(
    private readonly sql: Sql | null,
    private readonly flushMs = 1000,
  ) {
    if (sql) {
      this.timer = setInterval(() => void this.flush(), flushMs);
      this.timer.unref();
    }
  }

  private push<T>(buf: T[], x: T): void {
    if (buf.length >= MAX_BUFFER) {
      buf.shift();
      this.stats.dropped++;
    }
    buf.push(x);
  }

  record(r: CostRecord): void {
    this.push(this.costs, r);
    for (const l of this.listeners.cost) l(r);
  }

  event(e: TelemetryEvent): void {
    if (e.geohash5 && e.geohash5.length > 5) e = { ...e, geohash5: e.geohash5.slice(0, 5) };
    this.push(this.events, e);
    for (const l of this.listeners.event) l(e);
  }

  latency(s: LatencySample): void {
    this.push(this.latencies, s);
    for (const l of this.listeners.latency) l(s);
  }

  story(row: StoryRow): void {
    this.push(this.stories, row);
  }

  storyStatusChange(id: string, status: string, at: number): void {
    this.push(this.storyStatus, { id, status, at });
  }

  async flush(): Promise<void> {
    if (!this.sql) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const sql = this.sql!;
    const costs = this.costs.splice(0);
    const events = this.events.splice(0);
    const lat = this.latencies.splice(0);
    const stories = this.stories.splice(0);
    const statuses = this.storyStatus.splice(0);
    try {
      if (stories.length)
        await sql`INSERT INTO stories ${sql(
          stories.map((s) => ({
            id: s.id,
            session_id: s.sessionId,
            place_id: s.placeId,
            place_name: s.placeName,
            place_kind: s.placeKind,
            angle: s.angle,
            mode: s.mode,
            guide_id: s.guideId,
            locale: s.locale,
            regime: s.regime,
            geohash5: s.geohash5,
            generated_by: s.generatedBy,
            provider: s.provider,
            model: s.model,
            grounding_ok: s.groundingOk,
            fallback_reason: s.fallbackReason,
            segments: s.segments,
            words: s.words,
          })),
        )} ON CONFLICT (id) DO NOTHING`;
      for (const st of statuses) await sql`UPDATE stories SET status = ${st.status}, completed_at = CASE WHEN ${st.status} = 'completed' THEN ${new Date(st.at)} ELSE completed_at END WHERE id = ${st.id}`;
      if (costs.length)
        await sql`INSERT INTO cost_ledger ${sql(
          costs.map((c) => ({
            session_id: uuidOrNull(c.sessionId),
            provider: c.provider,
            model: c.model,
            category: c.category,
            task: c.task,
            units: sql.json(c.units as never),
            cost_usd: c.costUsd,
            latency_ms: Math.round(c.latencyMs),
            cache_hit: c.cacheHit,
            ok: c.ok,
            at: new Date(c.at),
          })),
        )}`;
      if (events.length)
        await sql`INSERT INTO events ${sql(
          events.map((e) => ({ name: e.name, session_id: uuidOrNull(e.sessionId), at: new Date(e.at), geohash5: e.geohash5 ?? null, regime: e.regime ?? null, props: sql.json(e.props as never) })),
        )}`;
      if (lat.length)
        await sql`INSERT INTO latency_samples ${sql(lat.map((l) => ({ session_id: uuidOrNull(l.sessionId), interaction: l.interaction, ms: l.ms, props: sql.json((l.props ?? {}) as never), at: new Date(l.at) })))}`;
      this.stats.written += costs.length + events.length + lat.length + stories.length;
    } catch {
      this.stats.flushErrors++;
      this.stats.dropped += costs.length + events.length + lat.length + stories.length;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
