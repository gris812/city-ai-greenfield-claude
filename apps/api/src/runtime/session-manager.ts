/**
 * SessionManager: hot SessionRuntime objects in this process (a session's WebSocket is
 * pinned to one API instance), snapshotted to Redis after every event so a restart or
 * reconnect to another instance resumes exactly (E3). Journey memory (place ids/names only)
 * is persisted to Postgres periodically and on end (D-012).
 */
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

  create(info: SessionInfo): SessionRuntime {
    const rt = new SessionRuntime(info, this.deps);
    this.runtimes.set(info.id, rt);
    void rt.persist();
    return rt;
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
    const memory = rt.state.memory;
    try {
      await this.sql`
        INSERT INTO journey_memory (session_id, owner_id, memory, updated_at)
        VALUES (${rt.info.id}, ${rt.info.ownerId}, ${this.sql.json(memory as never)}, now())
        ON CONFLICT (session_id) DO UPDATE SET memory = EXCLUDED.memory, updated_at = now()`;
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
