/** Guest tokens, guide profiles, health/readiness, end-user history and deletion. */
import type { FastifyInstance } from 'fastify';
import { GUIDES } from '@city/core';
import { describeSet } from '@city/providers';
import { TOKEN_TTL, requireAuth } from '../auth.js';
import { dbHealthy } from '../db.js';
import type { AppDeps } from '../deps.js';
import { publicGuide } from './sessions.js';

export function publicRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/v1/guest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_req, reply) => {
    let guestId: string = crypto.randomUUID();
    if (deps.sql) guestId = (await deps.sql<{ id: string }[]>`INSERT INTO guests DEFAULT VALUES RETURNING id`)[0]!.id;
    const token = await deps.auth.sign({ sub: guestId, role: 'guest', guestId }, TOKEN_TTL.guest);
    return reply.code(201).send({ guestId, token });
  });

  app.get('/v1/guides', async () => ({ guides: GUIDES.map((g) => publicGuide(g.id)) }));

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));

  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    const db = deps.sql ? await dbHealthy(deps.sql) : false;
    const redis = await deps.kv.ping();
    const reduced = deps.kv.reduced;
    const providers = describeSet(deps.providers);
    const status = !db ? 'unavailable' : reduced || !redis ? 'degraded' : 'ok';
    return reply.code(db ? 200 : 503).send({
      status,
      db,
      redis,
      // F5: cache down → reduced mode (stricter discovery throttle, in-process state), never a provider storm.
      reducedMode: reduced,
      demoMode: deps.config.demoMode,
      providers,
      breakers: deps.guard.breakerStates(),
      build: deps.config.buildSha,
    });
  });

  const endUser = requireAuth(deps.auth, ['guest', 'user']);

  app.get('/v1/me/history', { preHandler: endUser }, async (req) => {
    const p = req.principal!;
    const ids = [p.userId, p.guestId].filter((x): x is string => !!x);
    if (!deps.sql || ids.length === 0) return { places: [] };
    const rows = await deps.sql<{ memory: { discussed: Record<string, { placeId: string; placeName: string; at: number; depth: string; completed: boolean; angle?: string }> }; session_id: string }[]>`
      SELECT jm.memory, jm.session_id FROM journey_memory jm
      JOIN sessions s ON s.id = jm.session_id
      WHERE (s.guest_id = ANY(${ids}::uuid[]) OR s.user_id = ANY(${ids}::uuid[]))
      ORDER BY jm.updated_at DESC LIMIT 200`;
    const byPlace = new Map<string, { placeId: string; placeName: string; lastAt: number; depth: string; completed: boolean; sessions: number }>();
    for (const r of rows) {
      for (const d of Object.values(r.memory.discussed ?? {})) {
        const prev = byPlace.get(d.placeId);
        if (!prev) byPlace.set(d.placeId, { placeId: d.placeId, placeName: d.placeName, lastAt: d.at, depth: d.depth, completed: d.completed, sessions: 1 });
        else {
          prev.sessions++;
          prev.completed ||= d.completed;
          if (d.at > prev.lastAt) prev.lastAt = d.at;
        }
      }
    }
    return { places: [...byPlace.values()].sort((a, b) => b.lastAt - a.lastAt) };
  });

  app.delete('/v1/me', { preHandler: endUser }, async (req, reply) => {
    const p = req.principal!;
    if (deps.sql) {
      await deps.sql.begin(async (tx) => {
        // D-023: cross-session history is keyed by user/guest id (no FK) → delete explicitly.
        const ids = [p.userId, p.guestId].filter((x): x is string => !!x);
        if (ids.length > 0) await tx`DELETE FROM place_history WHERE owner_id = ANY(${ids}::uuid[])`;
        if (p.userId) {
          await tx`DELETE FROM sessions WHERE user_id = ${p.userId}`;
          await tx`UPDATE guests SET user_id = NULL WHERE user_id = ${p.userId}`;
          await tx`DELETE FROM users WHERE id = ${p.userId}`;
        }
        if (p.guestId) {
          await tx`DELETE FROM sessions WHERE guest_id = ${p.guestId}`;
          await tx`DELETE FROM guests WHERE id = ${p.guestId}`;
        }
      });
    }
    return reply.code(204).send();
  });
}
