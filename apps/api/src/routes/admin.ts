/**
 * Admin API (role-gated, RBAC): analyst ⊂ admin ⊂ owner. Metrics are SQL aggregates
 * (percentile_cont for p50/p95); geo is geohash-5 with k-anonymity (≥ 5 sessions per cell).
 * Every mutation is written to the append-only audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_BUDGET, describeSet, type BudgetLimits } from '@city/providers';
import { requireAdmin, oneTimeCode, sha256 } from '../auth.js';
import { dbHealthy } from '../db.js';
import type { AppDeps } from '../deps.js';
import { UUID_RE, audit, parseOr400 } from '../util.js';

export const K_ANONYMITY = 5;

function rangeDays(r: unknown): number {
  const m = /^(\d{1,3})d$/.exec(String(r ?? '7d'));
  return m ? Math.min(400, Math.max(1, Number(m[1]))) : 7;
}

const Category = z.enum(['llm', 'tts', 'stt', 'realtime', 'maps', 'knowledge']);
const BudgetSchema = z.object({
  perSession: z.partialRecord(Category, z.number().int().nonnegative().max(100_000)).optional(),
  perMinuteGlobal: z.partialRecord(Category, z.number().int().nonnegative().max(1_000_000)).optional(),
  realtimeSecondsPerSession: z.number().nonnegative().max(24 * 3600).optional(),
  usdPerSession: z.number().nonnegative().max(100).optional(),
  killed: z.array(z.string().max(40)).max(50).optional(),
});

/**
 * Live cache-layer hit/miss counters of THIS API process since start (D-018): complements the
 * ledger-based `cacheByLayer` (which needs the telemetry flush and covers the selected range).
 */
export function cacheCounters(deps: AppDeps) {
  const rate = (h: number, m: number) => (h + m > 0 ? h / (h + m) : null);
  const n = deps.narration?.stats;
  const a = deps.audio.stats;
  const d = deps.discovery.stats;
  return {
    scope: 'process since start',
    narrationBody: n ? { enabled: true, hits: n.hits, misses: n.misses, inflightJoins: n.inflightJoins, writes: n.writes, notCached: n.notCached, hitRate: rate(n.hits, n.misses) } : { enabled: false },
    ttsAudio: { hits: a.hits, misses: a.misses, failures: a.failures, hitRate: rate(a.hits, a.misses) },
    places: { hits: d.placeHits, misses: d.placeMisses, hitRate: rate(d.placeHits, d.placeMisses) },
    evidence: { hits: d.evidenceHits, misses: d.evidenceMisses, hitRate: rate(d.evidenceHits, d.evidenceMisses) },
  };
}

export function adminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const analyst = requireAdmin(deps.auth, 'analyst');
  const admin = requireAdmin(deps.auth, 'admin');
  const owner = requireAdmin(deps.auth, 'owner');
  const sql = deps.sql;
  const noDb = { error: 'database_unavailable' };

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/overview', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const days = rangeDays(req.query.range);
    const since = new Date(Date.now() - days * 86400_000);
    const [active] = await sql<{ dau: number; wau: number; mau: number }[]>`
      SELECT
        count(DISTINCT coalesce(user_id, guest_id)) FILTER (WHERE started_at > now() - interval '1 day')::int AS dau,
        count(DISTINCT coalesce(user_id, guest_id)) FILTER (WHERE started_at > now() - interval '7 days')::int AS wau,
        count(DISTINCT coalesce(user_id, guest_id)) FILTER (WHERE started_at > now() - interval '30 days')::int AS mau
      FROM sessions`;
    const [s] = await sql<{ sessions: number; guest_sessions: number; account_sessions: number; avg_duration_s: number | null; simulated: number }[]>`
      SELECT count(*)::int AS sessions,
             count(*) FILTER (WHERE user_id IS NULL)::int AS guest_sessions,
             count(*) FILTER (WHERE user_id IS NOT NULL)::int AS account_sessions,
             avg(duration_s)::float AS avg_duration_s,
             count(*) FILTER (WHERE simulated)::int AS simulated
      FROM sessions WHERE started_at > ${since}`;
    const funnel = await sql<{ name: string; n: number }[]>`
      SELECT name, count(*)::int AS n FROM events WHERE at > ${since}
        AND name IN ('story_offered','story_started','story_completed','story_skipped','story_interrupted','story_resumed','story_abandoned','question_asked','nearby_search','navigate_handoff')
      GROUP BY name`;
    const guides = await sql<{ guide_id: string; n: number }[]>`SELECT guide_id, count(*)::int AS n FROM sessions WHERE started_at > ${since} GROUP BY guide_id`;
    const regimes = await sql<{ regime: string; n: number }[]>`SELECT coalesce(regime, 'unknown') AS regime, count(*)::int AS n FROM stories WHERE created_at > ${since} GROUP BY 1`;
    return { rangeDays: days, active, sessions: s, funnel: Object.fromEntries(funnel.map((f) => [f.name, f.n])), guideMix: guides, regimeMix: regimes };
  });

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/latency', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const since = new Date(Date.now() - rangeDays(req.query.range) * 86400_000);
    const rows = await sql<{ interaction: string; n: number; p50: number; p95: number; max: number }[]>`
      SELECT interaction, count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
             max(ms) AS max
      FROM latency_samples WHERE at > ${since} GROUP BY interaction ORDER BY interaction`;
    return { interactions: rows };
  });

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/cost', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const since = new Date(Date.now() - rangeDays(req.query.range) * 86400_000);
    const byProvider = await sql`SELECT provider, category, sum(cost_usd)::float AS usd, count(*)::int AS calls FROM cost_ledger WHERE at > ${since} GROUP BY 1, 2 ORDER BY usd DESC`;
    const byTask = await sql`SELECT task, sum(cost_usd)::float AS usd, count(*)::int AS calls FROM cost_ledger WHERE at > ${since} GROUP BY 1 ORDER BY usd DESC`;
    const byDay = await sql`SELECT date_trunc('day', at)::date AS day, sum(cost_usd)::float AS usd FROM cost_ledger WHERE at > ${since} GROUP BY 1 ORDER BY 1`;
    const [per] = await sql<{ usd: number | null; sessions: number; users: number }[]>`
      SELECT (SELECT sum(cost_usd)::float FROM cost_ledger WHERE at > ${since}) AS usd,
             count(*)::int AS sessions, count(DISTINCT coalesce(user_id, guest_id))::int AS users
      FROM sessions WHERE started_at > ${since}`;
    const usd = per?.usd ?? 0;
    return {
      note: 'Estimated from list prices in packages/providers/src/pricing.ts (retrieved 2026-09-27); not an invoice.',
      totalUsd: usd,
      perSessionUsd: per && per.sessions > 0 ? usd / per.sessions : null,
      perActiveUserUsd: per && per.users > 0 ? usd / per.users : null,
      byProvider,
      byTask,
      byDay,
    };
  });

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/providers', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const since = new Date(Date.now() - rangeDays(req.query.range) * 86400_000);
    const calls = await sql`
      SELECT provider, category, task, count(*)::int AS calls,
             count(*) FILTER (WHERE NOT ok)::int AS errors,
             count(*) FILTER (WHERE cache_hit)::int AS cache_hits,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms
      FROM cost_ledger WHERE at > ${since} GROUP BY 1, 2, 3 ORDER BY calls DESC`;
    const cacheByLayer = await sql`
      SELECT task AS layer, count(*) FILTER (WHERE cache_hit)::int AS hits, count(*)::int AS lookups,
             (count(*) FILTER (WHERE cache_hit))::float / nullif(count(*), 0) AS hit_rate
      FROM cost_ledger WHERE at > ${since} AND task IN ('discovery', 'density_probe', 'evidence', 'narration_body', 'tts_segment') GROUP BY 1`;
    const errors = await sql`SELECT props->>'provider' AS provider, props->>'kind' AS kind, count(*)::int AS n FROM events WHERE name = 'provider_error' AND at > ${since} GROUP BY 1, 2 ORDER BY n DESC`;
    return { calls, cacheByLayer, cacheCounters: cacheCounters(deps), errors, breakers: deps.guard.breakerStates(), configured: describeSet(deps.providers) };
  });

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/quality', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const since = new Date(Date.now() - rangeDays(req.query.range) * 86400_000);
    const [q] = await sql<Record<string, number | null>[]>`
      SELECT
        (SELECT count(*)::int FROM events WHERE name = 'not_that_one' AND at > ${since}) AS not_that_one,
        (SELECT count(*)::int FROM events WHERE name = 'story_skipped' AND at > ${since}) AS skips,
        (SELECT count(*)::int FROM stories WHERE created_at > ${since}) AS stories,
        (SELECT count(*)::int FROM stories WHERE created_at > ${since} AND fallback_reason = 'grounding_failed') AS grounding_failures,
        (SELECT count(*)::int FROM stories WHERE created_at > ${since} AND generated_by = 'template') AS template_fallbacks,
        (SELECT avg(rating)::float FROM feedback WHERE created_at > ${since}) AS avg_rating,
        (SELECT count(*)::int FROM feedback WHERE created_at > ${since}) AS feedback_count`;
    return q;
  });

  app.get<{ Querystring: { range?: string } }>('/v1/admin/metrics/geo', { preHandler: analyst }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const since = new Date(Date.now() - rangeDays(req.query.range) * 86400_000);
    const cells = await sql`
      SELECT geohash5, count(DISTINCT session_id)::int AS sessions, count(*)::int AS events
      FROM events WHERE at > ${since} AND geohash5 IS NOT NULL
      GROUP BY geohash5 HAVING count(DISTINCT session_id) >= ${K_ANONYMITY} ORDER BY sessions DESC LIMIT 1000`;
    return { kAnonymity: K_ANONYMITY, precision: 5, cells };
  });

  app.get('/v1/admin/health', { preHandler: analyst }, async () => {
    const db = sql ? await dbHealthy(sql) : false;
    const recentErrors = sql && db ? await sql`SELECT at, props FROM events WHERE name = 'provider_error' ORDER BY at DESC LIMIT 20` : [];
    return { api: 'ok', db, redis: await deps.kv.ping(), reducedMode: deps.kv.reduced, build: deps.config.buildSha, hotSessions: deps.sessions.size, telemetry: deps.telemetry.stats, breakers: deps.guard.breakerStates(), recentErrors };
  });

  app.get<{ Params: { id: string } }>('/v1/admin/sessions/:id/explain', { preHandler: admin }, async (req, reply) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return reply.code(404).send({ error: 'not_found' });
    const hot = deps.sessions.hot(id);
    const timeline = hot ? hot.explain : (await deps.kv.list(`explain:${id}`, 500)).map((s) => JSON.parse(s)).reverse();
    const events = sql ? await sql`SELECT name, at, regime, props FROM events WHERE session_id = ${id} ORDER BY at LIMIT 1000` : [];
    const stories = sql ? await sql`SELECT id, place_id, place_name, place_kind, angle, mode, generated_by, provider, model, grounding_ok, fallback_reason, status, created_at FROM stories WHERE session_id = ${id} ORDER BY created_at` : [];
    await audit(sql, req.principal, 'admin.session_explain', id, {});
    return { sessionId: id, timeline, events, stories, summary: hot?.summary() ?? null };
  });

  app.get('/v1/admin/config/budgets', { preHandler: owner }, async () => ({ limits: deps.budget.current, defaults: DEFAULT_BUDGET }));

  app.put('/v1/admin/config/budgets', { preHandler: owner }, async (req, reply) => {
    const b = parseOr400(BudgetSchema, req.body, reply);
    if (!b) return;
    const before = deps.budget.current;
    deps.budget.update(b as Partial<BudgetLimits>);
    const after = deps.budget.current;
    if (sql) {
      await sql`INSERT INTO provider_budgets (id, limits, updated_by) VALUES (1, ${sql.json(after as never)}, ${req.principal!.adminId ?? null})
                ON CONFLICT (id) DO UPDATE SET limits = EXCLUDED.limits, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    }
    await audit(sql, req.principal, 'config.budgets_updated', 'provider_budgets', { before, after });
    return { limits: after };
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/admin/audit', { preHandler: owner }, async (req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
    return { entries: await sql`SELECT id, at, actor_id, actor_role, action, target, details FROM audit_log ORDER BY id DESC LIMIT ${limit}` };
  });

  app.get('/v1/admin/users', { preHandler: owner }, async (_req, reply) => {
    if (!sql) return reply.code(503).send(noDb);
    const users = await sql`SELECT id, email, role, created_at, disabled_at FROM admin_users ORDER BY created_at`;
    const devices = await sql`SELECT id, admin_user_id, name, role, created_at, last_seen_at, revoked_at FROM admin_devices ORDER BY created_at`;
    const invites = await sql`SELECT id, kind, email, role, expires_at, used_at FROM admin_invites WHERE used_at IS NULL AND expires_at > now()`;
    return { users, devices, invites };
  });

  app.post('/v1/admin/users/invites', { preHandler: owner }, async (req, reply) => {
    const b = parseOr400(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['owner', 'admin', 'analyst']) }), req.body, reply);
    if (!b || !sql) return;
    const code = oneTimeCode(10);
    const expiresAt = new Date(Date.now() + 48 * 3600_000);
    await sql`INSERT INTO admin_invites (kind, email, role, code_hash, created_by, expires_at) VALUES ('invite', ${b.email}, ${b.role}, ${sha256(code)}, ${req.principal!.adminId ?? null}, ${expiresAt})`;
    await audit(sql, req.principal, 'admin.invite_created', b.email, { role: b.role });
    return reply.code(201).send({ email: b.email, role: b.role, code, expiresAt: expiresAt.getTime() });
  });

  app.delete<{ Params: { id: string } }>('/v1/admin/users/:id', { preHandler: owner }, async (req, reply) => {
    if (!sql || !UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    if (req.params.id === req.principal!.adminId) return reply.code(400).send({ error: 'cannot_disable_self' });
    await sql`UPDATE admin_users SET disabled_at = now() WHERE id = ${req.params.id}`;
    const devs = await sql<{ id: string }[]>`UPDATE admin_devices SET revoked_at = now() WHERE admin_user_id = ${req.params.id} AND revoked_at IS NULL RETURNING id`;
    for (const d of devs) deps.auth.invalidateDevice(d.id);
    await audit(sql, req.principal, 'admin.user_disabled', req.params.id, { devicesRevoked: devs.length });
    return reply.code(204).send();
  });

  // Device revocation: owners revoke any device; others only their own.
  app.delete<{ Params: { id: string } }>('/v1/admin/devices/:id', { preHandler: analyst }, async (req, reply) => {
    if (!sql || !UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const p = req.principal!;
    const rows = p.role === 'owner'
      ? await sql`UPDATE admin_devices SET revoked_at = now() WHERE id = ${req.params.id} AND revoked_at IS NULL RETURNING id`
      : await sql`UPDATE admin_devices SET revoked_at = now() WHERE id = ${req.params.id} AND admin_user_id = ${p.adminId ?? null} AND revoked_at IS NULL RETURNING id`;
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
    deps.auth.invalidateDevice(req.params.id);
    await audit(sql, p, 'admin.device_revoked', req.params.id, {});
    return reply.code(204).send();
  });
}
