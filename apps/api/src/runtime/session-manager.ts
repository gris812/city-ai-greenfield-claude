/**
 * SessionManager: hot SessionRuntime objects in this process (a session's WebSocket is
 * pinned to one API instance), snapshotted to Redis after every event so a restart or
 * reconnect to another instance resumes exactly (E3). Journey memory (place ids/names only)
 * is persisted to Postgres periodically and on end (D-012), and every place told as a story or
 * follow-up is upserted into the owner's cross-session `place_history` (D-023: place id + time
 * only; not for simulated sessions).
 */
import { RETELL, toldPlaces } from '@city/core';
import type { Sql } from '../db.js';
import type { KV } from '../kv.js';
import { SessionRuntime, type RuntimeDeps, type RuntimeSnapshot, type SessionInfo } from './session-runtime.js';

export class SessionManager {
  private runtimes = new Map<string, SessionRuntime>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly deps: RuntimeDeps,
    private readonly kv: KV,
    private readonly sql: Sql | null,
    private readonly idleEvictMs = 30 * 60_000,
  ) {
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref();
  }

  create(info: SessionInfo, history?: Readonly<Record<string, number>>): SessionRuntime {
    const rt = new SessionRuntime(info, this.deps);
    if (history && !info.simulated) rt.seedHistory(history);
    this.runtimes.set(info.id, rt);
    void rt.persist();
    return rt;
  }

  /**
   * Cross-session history of an owner (user id and/or guest id): place id → last told (epoch ms),
   * newest first, within the 90-day retention (D-012/D-023). Best effort: {} on any error.
   */
  async loadHistory(ownerIds: readonly string[]): Promise<Record<string, number>> {
    if (!this.sql || ownerIds.length === 0) return {};
    try {
      const rows = await this.sql<{ place_id: string; at: number }[]>`
        SELECT place_id, (extract(epoch FROM max(last_told_at)) * 1000)::float8 AS at
        FROM place_history
        WHERE owner_id = ANY(${ownerIds as string[]}::uuid[]) AND last_told_at > now() - interval '90 days'
        GROUP BY place_id ORDER BY at DESC LIMIT ${RETELL.MAX_ENTRIES}`;
      return Object.fromEntries(rows.map((r) => [r.place_id, Number(r.at)]));
    } catch {
      return {};
    }
  }

  /** Hot runtime, or hydrate from the Redis snapshot, or rebuild from the Postgres row. */
  async get(id: string): Promise<SessionRuntime | null> {
    const hot = this.runtimes.get(id);
    if (hot) return hot;
    const raw = await this.kv.get(SessionRuntime.snapshotKey(id));
    if (raw) {
      try {
        const snap = JSON.parse(raw) as RuntimeSnapshot;
        const rt = new SessionRuntime(snap.info, this.deps, snap);
        this.runtimes.set(id, rt);
        return rt;
      } catch {
        /* corrupt snapshot → rebuild below */
      }
    }
    if (!this.sql) return null;
    const rows = await this.sql<{ id: string; guide_id: string; locale: string; units: string; simulated: boolean; guest_id: string | null; user_id: string | null; ended_at: Date | null }[]>`
      SELECT id, guide_id, locale, units, simulated, guest_id, user_id, ended_at FROM sessions WHERE id = ${id}`;
    const r = rows[0];
    if (!r || r.ended_at) return null;
    const rt = new SessionRuntime({ id: r.id, guideId: r.guide_id, locale: r.locale, units: r.units as 'metric' | 'imperial', simulated: r.simulated, ownerId: r.user_id ?? r.guest_id ?? r.id }, this.deps);
    if (!r.simulated) rt.seedHistory(await this.loadHistory([r.user_id, r.guest_id].filter((x): x is string => !!x)));
    this.runtimes.set(id, rt);
    return rt;
  }

  hot(id: string): SessionRuntime | undefined {
    return this.runtimes.get(id);
  }

  get size(): number {
    return this.runtimes.size;
  }

  async saveMemory(rt: SessionRuntime): Promise<void> {
    if (!this.sql) return;
    // The cross-session history lives in place_history, not in every session's memory row.
    const { history: _history, ...memory } = rt.state.memory;
    try {
      await this.sql`
        INSERT INTO journey_memory (session_id, owner_id, memory, updated_at)
        VALUES (${rt.info.id}, ${rt.info.ownerId}, ${this.sql.json(memory as never)}, now())
        ON CONFLICT (session_id) DO UPDATE SET memory = EXCLUDED.memory, updated_at = now()`;
    } catch {
      /* best effort */
    }
    if (rt.info.simulated) return;
    const told = toldPlaces(rt.state.memory);
    if (told.length === 0) return;
    try {
      // Journey time is the client clock domain: clamp to server now (a fast client clock must not
      // extend retention); a telling counts once (times += 1 only when last_told_at moves forward).
      await this.sql`
        INSERT INTO place_history (owner_id, place_id, last_told_at, times)
        SELECT ${rt.info.ownerId}::uuid, t.place_id, LEAST(to_timestamp(t.at / 1000.0), now()), 1
        FROM unnest(${told.map((t) => t.placeId)}::text[], ${told.map((t) => t.at)}::float8[]) AS t(place_id, at)
        ON CONFLICT (owner_id, place_id) DO UPDATE SET
          times = place_history.times + CASE WHEN EXCLUDED.last_told_at > place_history.last_told_at THEN 1 ELSE 0 END,
          last_told_at = GREATEST(place_history.last_told_at, EXCLUDED.last_told_at)`;
    } catch {
      /* best effort */
    }
  }

  async end(id: string): Promise<SessionRuntime | null> {
    const rt = await this.get(id);
    if (!rt) return null;
    await rt.idle();
    await this.saveMemory(rt);
    rt.close();
    this.runtimes.delete(id);
    await this.kv.del(SessionRuntime.snapshotKey(id));
    this.deps.router.guard.budget.forgetSession(id);
    return rt;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, rt] of this.runtimes) {
      if (rt.connected === 0 && now - rt.lastActivityAt > this.idleEvictMs) {
        await rt.persist();
        await this.saveMemory(rt);
        rt.close();
        this.runtimes.delete(id);
      } else if (now - rt.lastActivityAt < 5 * 60_000) {
        await this.saveMemory(rt);
      }
    }
  }

  async closeAll(): Promise<void> {
    clearInterval(this.sweeper);
    for (const rt of this.runtimes.values()) {
      await rt.persist();
      await this.saveMemory(rt);
      rt.close();
    }
    this.runtimes.clear();
  }
}
