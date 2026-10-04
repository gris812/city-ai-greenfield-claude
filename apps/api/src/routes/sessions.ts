/**
 * Session lifecycle, WebSocket channel and REST fallbacks (docs/API.md).
 * WS protocol: client → {type: context|audio_progress|utterance|control|ack|resume|ping}
 *              server → {type:'directive', seq, turn, ref?, at, directive} | pong | error.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { ContextFrame } from '@city/core';
import { GUIDES, geohashEncode, guideById, unitsForLocale } from '@city/core';
import { requireAuth, type Principal } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { POLICY_VERSION, type Envelope, type SessionRuntime } from '../runtime/session-runtime.js';
import { AudioProgressSchema, ContextFrameSchema, ControlSchema, CreateSessionSchema, UtteranceSchema, WsMessageSchema } from '../schemas.js';
import { UUID_RE, ownerIds, parseOr400 } from '../util.js';

/** Client capabilities the server acts on (D-020). */
export const KNOWN_CAPABILITIES = ['say_append'];

export function publicGuide(id: string) {
  const g = guideById(id) ?? GUIDES[0]!;
  return { id: g.id, name: g.name, tagline: g.tagline, personality: g.personality, visual: g.visual };
}

function wsBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/^http/, 'ws');
}

export async function ownedRuntime(deps: AppDeps, p: Principal, id: string, reply: FastifyReply): Promise<SessionRuntime | null> {
  if (!UUID_RE.test(id)) {
    void reply.code(404).send({ error: 'not_found' });
    return null;
  }
  const rt = await deps.sessions.get(id);
  if (!rt) {
    void reply.code(404).send({ error: 'not_found' });
    return null;
  }
  if (!ownerIds(p).includes(rt.info.ownerId)) {
    void reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return rt;
}

export function toFrame(sessionId: string, f: ReturnType<typeof ContextFrameSchema.parse>): ContextFrame {
  return {
    sessionId,
    seq: f.seq,
    fixes: f.fixes.map((x) => ({ lat: x.lat, lng: x.lng, t: x.t, source: x.source, accuracyM: x.accuracyM ?? null, speedMps: x.speedMps ?? null, headingDeg: x.headingDeg ?? null, altitudeM: x.altitudeM ?? null })),
    ...(f.route !== undefined ? { route: f.route ? { polyline: f.route.polyline, source: f.route.source, ...(f.route.destinationName ? { destinationName: f.route.destinationName } : {}) } : null } : {}),
    appState: f.appState,
    audio: { playing: f.audio.playing, planId: f.audio.planId ?? null, segmentIndex: f.audio.segmentIndex ?? null, offsetMs: f.audio.offsetMs ?? null, outputRoute: f.audio.outputRoute },
    lastInteractionAt: f.lastInteractionAt ?? null,
    clientTime: f.clientTime,
    simulated: f.simulated,
  };
}

export function sessionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const endUser = requireAuth(deps.auth, ['guest', 'user']);

  app.post('/v1/sessions', { preHandler: endUser }, async (req, reply) => {
    const body = parseOr400(CreateSessionSchema, req.body ?? {}, reply);
    if (!body) return;
    const p = req.principal!;
    const guide = guideById(body.guideId);
    if (!guide) return reply.code(400).send({ error: 'unknown_guide' });
    const units = body.units ?? unitsForLocale(body.locale);
    let id: string;
    if (deps.sql) {
      const rows = await deps.sql<{ id: string }[]>`
        INSERT INTO sessions (guest_id, user_id, guide_id, locale, units, simulated, platform, app_version, policy_version)
        VALUES (${p.guestId ?? null}, ${p.userId ?? null}, ${guide.id}, ${body.locale}, ${units}, ${body.simulated}, ${body.client.platform ?? null}, ${body.client.appVersion ?? null}, ${POLICY_VERSION})
        RETURNING id`;
      id = rows[0]!.id;
    } else id = crypto.randomUUID();
    const capabilities = (body.client.capabilities ?? []).filter((c) => KNOWN_CAPABILITIES.includes(c));
    // D-023: returning users/guests start with their cross-session history (place ids + last told).
    const history = body.simulated ? {} : await deps.sessions.loadHistory(ownerIds(p));
    deps.sessions.create({ id, guideId: guide.id, locale: body.locale, units, simulated: body.simulated, ownerId: p.userId ?? p.guestId!, ...(capabilities.length ? { capabilities } : {}) }, history);
    deps.telemetry.event({ name: 'session_start', sessionId: id, at: Date.now(), geohash5: null, props: { guideId: guide.id, locale: body.locale, simulated: body.simulated, platform: body.client.platform ?? null, account: !!p.userId } });
    deps.telemetry.event({ name: 'guide_selected', sessionId: id, at: Date.now(), geohash5: null, props: { guideId: guide.id } });
    return reply.code(201).send({ sessionId: id, wsUrl: `${wsBase(deps.config.apiBaseUrl)}/v1/sessions/${id}/ws`, guide: publicGuide(guide.id), policyVersion: POLICY_VERSION });
  });

  app.get<{ Params: { id: string } }>('/v1/sessions/:id', { preHandler: endUser }, async (req, reply) => {
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    return rt.summary();
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/end', { preHandler: endUser }, async (req, reply) => {
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    const firstGeohash = rt.state.position ? geohashEncode(rt.state.position, 5) : null;
    const usage = deps.budget.sessionUsage(rt.info.id);
    await deps.sessions.end(rt.info.id);
    await deps.telemetry.flush();
    const mem = rt.state.memory;
    const stories = Object.values(mem.discussed).filter((d) => d.depth !== 'mention').length;
    let durationS = 0;
    let costUsd = usage.usd;
    if (deps.sql) {
      const [c] = await deps.sql<{ cost: string | null }[]>`SELECT sum(cost_usd)::text AS cost FROM cost_ledger WHERE session_id = ${rt.info.id}`;
      costUsd = Number(c?.cost ?? costUsd) || 0;
      const [r] = await deps.sql<{ duration_s: number }[]>`
        UPDATE sessions SET ended_at = now(), duration_s = extract(epoch FROM now() - started_at)::int, stories = ${stories}, cost_usd = ${costUsd}, start_geohash5 = COALESCE(start_geohash5, ${firstGeohash})
        WHERE id = ${rt.info.id} RETURNING duration_s`;
      durationS = r?.duration_s ?? 0;
    }
    deps.telemetry.event({ name: 'session_end', sessionId: rt.info.id, at: Date.now(), geohash5: null, props: { durationS, stories, costUsd } });
    return { durationS, stories, costUsdEstimate: Math.round(costUsd * 1e6) / 1e6 };
  });

  // ── REST fallbacks (same semantics as WS messages; return the directives produced)
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/context', { preHandler: endUser }, async (req, reply) => {
    const f = parseOr400(ContextFrameSchema, req.body, reply);
    if (!f) return;
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    return { directives: await rt.context(toFrame(rt.info.id, f)) };
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/utterance', { preHandler: endUser }, async (req, reply) => {
    const u = parseOr400(UtteranceSchema, req.body, reply);
    if (!u) return;
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    return { directives: await rt.utterance(u) };
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/control', { preHandler: endUser }, async (req, reply) => {
    const c = parseOr400(ControlSchema, req.body, reply);
    if (!c) return;
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    return { directives: await rt.control(c.action) };
  });

  /** Additive REST twin of the WS `audio_progress` message. */
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/audio_progress', { preHandler: endUser }, async (req, reply) => {
    const a = parseOr400(AudioProgressSchema, req.body, reply);
    if (!a) return;
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    return { directives: await rt.audioProgress(a) };
  });

  /** Additive REST twin of WS `resume`: directives after lastDirectiveSeq that were not acked. */
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/v1/sessions/:id/directives', { preHandler: endUser }, async (req, reply) => {
    const rt = await ownedRuntime(deps, req.principal!, req.params.id, reply);
    if (!rt) return;
    const after = Number(req.query.after ?? 0);
    return { directives: rt.resumeFrom(Number.isFinite(after) ? after : 0) };
  });

  // ── WebSocket
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/ws', { websocket: true, preHandler: endUser }, (socket: WebSocket, req: FastifyRequest<{ Params: { id: string } }>) => {
    const p = req.principal!;
    const id = req.params.id;
    let detach: (() => void) | null = null;
    let rt: SessionRuntime | null = null;
    let sentUpTo = 0;
    const pending: string[] = [];
    let ready = false;
    const send = (x: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(x));
    };
    const sendEnv = (e: Envelope) => {
      if (e.seq <= sentUpTo) return; // never twice on one connection
      sentUpTo = e.seq;
      send(e);
    };
    const handle = async (raw: string) => {
      if (!rt) return;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return send({ type: 'error', code: 'bad_json', retryable: false });
      }
      const m = WsMessageSchema.safeParse(json);
      if (!m.success) return send({ type: 'error', code: 'invalid_message', retryable: false });
      const msg = m.data;
      try {
        switch (msg.type) {
          case 'ping':
            return send({ type: 'pong', t: msg.t ?? null, serverTime: Date.now() });
          case 'ack':
            return rt.ack(msg.seq);
          case 'resume': {
            sentUpTo = msg.lastDirectiveSeq;
            for (const e of rt.resumeFrom(msg.lastDirectiveSeq)) sendEnv(e);
            return;
          }
          case 'context': {
            const { type: _t, ...frame } = msg;
            await rt.context(toFrame(rt.info.id, frame as never));
            return;
          }
          case 'utterance':
            await rt.utterance(msg);
            return;
          case 'control':
            await rt.control(msg.action);
            return;
          case 'audio_progress':
            await rt.audioProgress(msg);
            return;
        }
      } catch {
        send({ type: 'error', code: 'internal', retryable: true });
      }
    };
    socket.on('message', (data: Buffer) => {
      const raw = data.toString('utf8');
      if (raw.length > 256_000) return send({ type: 'error', code: 'too_large', retryable: false });
      if (!ready) pending.push(raw);
      else void handle(raw);
    });
    socket.on('close', () => detach?.());
    void (async () => {
      if (!UUID_RE.test(id)) return socket.close(4404, 'not_found');
      rt = await deps.sessions.get(id);
      if (!rt) return socket.close(4404, 'not_found');
      if (!ownerIds(p).includes(rt.info.ownerId)) return socket.close(4403, 'forbidden');
      // A fresh connection starts from "now"; missed directives are delivered only on `resume` (E3).
      sentUpTo = rt.lastSeq;
      detach = rt.attach({ send: sendEnv });
      ready = true;
      send({ type: 'hello', sessionId: id, lastDirectiveSeq: rt.lastSeq, serverTime: Date.now() });
      for (const raw of pending.splice(0)) await handle(raw);
    })();
  });
}
