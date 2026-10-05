/** Audio, NearbySearch, STT, realtime tokens/usage, feedback. */
import type { FastifyInstance } from 'fastify';
import { decideTool, emptyToolHistory, extractCategory, isDriving, type GuideProfile } from '@city/core';
import { realtimeCost, storySystemPrompt } from '@city/providers';
import { requireAuth } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { NEARBY_RADIUS_M, nearbyAnswer, showResults, validateNearby } from '../runtime/nearby.js';
import { FeedbackSchema, NearbyRequestSchema, RealtimeTokenSchema, RealtimeUsageSchema } from '../schemas.js';
import { ownedRuntime } from './sessions.js';
import { parseOr400 } from '../util.js';

export function toolRoutes(app: FastifyInstance, deps: AppDeps): void {
  const endUser = requireAuth(deps.auth, ['guest', 'user']);

  // Content-addressed TTS audio: immutable, public (keys are unguessable hashes of shared prose).
  app.get<{ Params: { file: string } }>('/v1/audio/:file', { config: { rateLimit: false } }, async (req, reply) => {
    const m = /^([a-f0-9]{40})\.(mp3|wav)$/.exec(req.params.file);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const a = await deps.audio.read(m[1]!);
    if (!a) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'not_found' });
    return reply.header('Content-Type', a.mime).header('Cache-Control', 'public, max-age=31536000, immutable').send(Buffer.from(a.bytes));
  });

  // NearbySearch tool (C1): independent of automatic discovery filtering; validated results.
  app.post('/v1/nearby', { preHandler: endUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parseOr400(NearbyRequestSchema, req.body, reply);
    if (!b) return;
    const rt = await ownedRuntime(deps, req.principal!, b.sessionId, reply);
    if (!rt) return;
    const regime = rt.state.regime.regime;
    const ctx = { now: Date.now(), regime: rt.state.regime, safety: rt.state.safety, position: { ...b.location, t: Date.now(), source: 'gps' as const } };
    const d = decideTool(ctx, { tool: 'nearby_search', args: { maxResults: 5 }, requestedBy: 'rules' }, emptyToolHistory());
    if (!d.allowed) return reply.code(429).send({ error: d.reason });
    const category = b.category ?? extractCategory(b.query);
    const radiusM = NEARBY_RADIUS_M[regime];
    const t0 = performance.now();
    try {
      const { result, provider } = await deps.router.nearby({ location: b.location, category, query: b.query, radiusM, maxResults: Number(d.request.args.maxResults ?? 5), locale: rt.info.locale }, { sessionId: rt.info.id });
      const { results, invalid } = validateNearby(result, b.location, radiusM, Number(d.request.args.maxResults ?? 5));
      deps.telemetry.latency({ sessionId: rt.info.id, interaction: 'nearby_to_result', ms: performance.now() - t0, at: Date.now(), props: { via: 'rest' } });
      return { provider: provider.name, fake: !!provider.fake, category, results, invalidDropped: invalid, answer: nearbyAnswer(results, category, String(rt.info.locale), rt.info.units, isDriving(regime)), map: showResults(results) };
    } catch {
      return reply.code(503).send({ error: 'nearby_unavailable', retryable: true });
    }
  });

  // Hybrid voice (D-010): push-to-talk audio → transcript (optionally submitted as an utterance).
  app.addContentTypeParser(/^audio\/.+|^application\/octet-stream$/, { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.post<{ Querystring: { sessionId?: string; locale?: string; durationS?: string; submit?: string; utteranceId?: string } }>(
    '/v1/stt',
    { preHandler: endUser, bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const audio = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(audio) || audio.length === 0) return reply.code(400).send({ error: 'audio_required' });
      const sessionId = req.query.sessionId ?? null;
      const rt = sessionId ? await ownedRuntime(deps, req.principal!, sessionId, reply) : null;
      if (sessionId && !rt) return;
      const locale = req.query.locale ?? rt?.info.locale ?? 'en';
      const durationS = Number(req.query.durationS ?? 0) || undefined;
      const t0 = performance.now();
      try {
        const { result, provider } = await deps.router.transcribe({ audio: new Uint8Array(audio), mime: String(req.headers['content-type'] ?? 'audio/webm'), locale, ...(durationS ? { durationS } : {}) }, { sessionId });
        deps.telemetry.latency({ sessionId, interaction: 'stt', ms: performance.now() - t0, at: Date.now(), props: { provider: provider.name } });
        const out: Record<string, unknown> = { text: result.text, provider: provider.name, durationS: result.durationS };
        if (rt && req.query.submit === '1') out.directives = await rt.utterance({ text: result.text, sttProvider: provider.name, ...(req.query.utteranceId ? { utteranceId: req.query.utteranceId } : {}) });
        return out;
      } catch {
        return reply.code(503).send({ error: 'stt_unavailable', retryable: true });
      }
    },
  );

  // Realtime burst (D-010): short-lived provider credential gated by ProviderBudget.
  app.post('/v1/realtime/token', { preHandler: endUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parseOr400(RealtimeTokenSchema, req.body, reply);
    if (!b) return;
    const rt = await ownedRuntime(deps, req.principal!, b.sessionId, reply);
    if (!rt) return;
    const left = deps.budget.realtimeSecondsLeft(rt.info.id);
    const maxSeconds = Math.floor(Math.min(deps.config.realtime.maxSeconds, left));
    if (maxSeconds < 15) return reply.code(429).send({ error: 'realtime_budget_exhausted' });
    const guide = rt.guide;
    const instructions = realtimeInstructions(guide, String(rt.info.locale));
    const t0 = performance.now();
    try {
      const { result } = await deps.router.issueRealtime({ instructions, voice: guide.voice.byProvider.openai ?? 'alloy', locale: rt.info.locale, maxSeconds, idleTimeoutS: deps.config.realtime.idleTimeoutS }, { sessionId: rt.info.id }, b.provider);
      // Reserve the token's full seconds; /v1/realtime/usage credits back what was not used (D-022).
      const reservationId = deps.budget.reserveRealtime(rt.info.id, maxSeconds);
      deps.telemetry.latency({ sessionId: rt.info.id, interaction: 'realtime_token', ms: performance.now() - t0, at: Date.now(), props: { provider: result.provider } });
      return { provider: result.provider, model: result.model, clientSecret: result.clientSecret, expiresAt: result.expiresAt, maxSeconds: result.maxSeconds, idleTimeoutS: result.idleTimeoutS, connectUrl: result.connectUrl, reservationId };
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      return reply.code(kind === 'budget' ? 429 : 503).send({ error: kind === 'budget' ? 'realtime_budget_exhausted' : 'realtime_unavailable', retryable: kind !== 'budget' });
    }
  });

  /** Additive: client reports realtime minutes at session close → cost ledger (D-014). */
  app.post('/v1/realtime/usage', { preHandler: endUser }, async (req, reply) => {
    const b = parseOr400(RealtimeUsageSchema, req.body, reply);
    if (!b) return;
    const rt = await ownedRuntime(deps, req.principal!, b.sessionId, reply);
    if (!rt) return;
    const cost = realtimeCost(b.provider, b.model, b.userAudioS, b.assistantAudioS);
    deps.telemetry.record({ sessionId: rt.info.id, provider: b.provider, model: b.model, category: 'realtime', task: 'realtime_session', units: { audioSeconds: b.userAudioS + b.assistantAudioS }, costUsd: cost, latencyMs: Math.round(b.connectMs ?? 0), cacheHit: false, ok: true, at: Date.now() });
    if (b.connectMs !== undefined) deps.telemetry.latency({ sessionId: rt.info.id, interaction: 'realtime_connect', ms: b.connectMs, at: Date.now(), props: { provider: b.provider } });
    // D-022: return unused reserved seconds to the session budget; count the spend toward the USD cap.
    const r = deps.budget.reconcileRealtime(rt.info.id, b.reservationId, Math.max(b.sessionS ?? 0, b.userAudioS + b.assistantAudioS));
    deps.budget.addSpend(rt.info.id, cost);
    return { costUsd: Math.round(cost * 1e6) / 1e6, reservationId: r.reservationId, reservedS: Math.round(r.reservedS), usedS: Math.round(r.usedS), creditedS: Math.round(r.creditedS), realtimeSecondsLeft: Math.floor(deps.budget.realtimeSecondsLeft(rt.info.id)) };
  });

  app.post('/v1/feedback', { preHandler: endUser }, async (req, reply) => {
    const b = parseOr400(FeedbackSchema, req.body, reply);
    if (!b) return;
    const rt = await ownedRuntime(deps, req.principal!, b.sessionId, reply);
    if (!rt) return;
    if (deps.sql) await deps.sql`INSERT INTO feedback (session_id, plan_id, rating, reason) VALUES (${b.sessionId}, ${b.planId ?? null}, ${b.rating}, ${b.reason ?? null})`;
    deps.telemetry.event({ name: 'feedback', sessionId: b.sessionId, at: Date.now(), geohash5: null, props: { rating: b.rating, planId: b.planId ?? null } });
    return reply.code(201).send({ ok: true });
  });
}

/** Realtime sessions get the same persona + D-003 boundaries (no invented facts, no tool authority). */
export function realtimeInstructions(guide: GuideProfile, locale: string): string {
  return [
    storySystemPrompt(guide, locale),
    'This is a short live conversation burst. Keep answers brief and spoken.',
    'Do not state names, dates or numbers about places unless the user just heard them from you in this session; if unsure, say you are not sure.',
    'You cannot search, navigate or change settings yourself; the app handles those requests.',
  ].join('\n');
}
