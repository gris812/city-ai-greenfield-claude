/**
 * Auth + RBAC + admin API + audit log + privacy + tool endpoints (STT, realtime, feedback).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/auth.js';
import { frameOf, guest, http, newSession, resetDatabase, servicesAvailable, startTestApp, traceFixes, type TestApp } from './helpers.js';

const ok = await servicesAvailable();
const fixes = traceFixes('wtc-walk');

describe.skipIf(!ok)('auth, RBAC, admin, privacy, tools', () => {
  let t: TestApp;
  let owner: string;
  let analyst: string;
  let analystId: string;
  beforeAll(async () => {
    await resetDatabase();
    t = await startTestApp();
    const sql = t.deps.sql!;
    const [o] = await sql<{ id: string }[]>`INSERT INTO admin_users (email, role) VALUES ('owner@example.org', 'owner') RETURNING id`;
    const [a] = await sql<{ id: string }[]>`INSERT INTO admin_users (email, role) VALUES ('analyst@example.org', 'analyst') RETURNING id`;
    analystId = a!.id;
    owner = await t.deps.auth.sign({ sub: o!.id, role: 'owner', adminId: o!.id }, '1h');
    analyst = await t.deps.auth.sign({ sub: a!.id, role: 'analyst', adminId: a!.id }, '1h');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('public endpoints', async () => {
    expect((await http(t.base, 'GET', '/healthz')).body).toEqual({ ok: true });
    const r = await http(t.base, 'GET', '/readyz');
    expect(r.body).toMatchObject({ status: 'ok', db: true, redis: true, reducedMode: false });
    const g = await http(t.base, 'GET', '/v1/guides');
    expect(g.body.guides.map((x: any) => x.id)).toEqual(['ida', 'emil']);
  });

  it('RBAC: no token 401, guest 403 on admin, analyst reads metrics but cannot PUT budgets', async () => {
    const g = await guest(t.base);
    expect((await http(t.base, 'GET', '/v1/admin/metrics/overview')).status).toBe(401);
    expect((await http(t.base, 'GET', '/v1/admin/metrics/overview', undefined, g)).status).toBe(403);
    expect((await http(t.base, 'GET', '/v1/admin/metrics/overview', undefined, analyst)).status).toBe(200);
    expect((await http(t.base, 'PUT', '/v1/admin/config/budgets', { usdPerSession: 5 }, analyst)).status).toBe(403);
    expect((await http(t.base, 'GET', '/v1/admin/audit', undefined, analyst)).status).toBe(403);
    expect((await http(t.base, 'GET', '/v1/admin/sessions/00000000-0000-0000-0000-000000000000/explain', undefined, analyst)).status).toBe(403);
    // admin tokens cannot drive end-user sessions
    expect((await http(t.base, 'POST', '/v1/sessions', { guideId: 'ida' }, analyst)).status).toBe(403);
    // forged token
    expect((await http(t.base, 'GET', '/v1/admin/metrics/overview', undefined, g.slice(0, -4) + 'AAAA')).status).toBe(401);
  });

  it('owner updates budgets (live + persisted + audited); audit log is append-only', async () => {
    const r = await http(t.base, 'PUT', '/v1/admin/config/budgets', { perSession: { maps: 100 }, killed: [] }, owner);
    expect(r.status).toBe(200);
    expect(t.deps.budget.current.perSession.maps).toBe(100);
    const [row] = await t.deps.sql!`SELECT limits FROM provider_budgets WHERE id = 1`;
    expect((row as any).limits.perSession.maps).toBe(100);
    const audit = await http(t.base, 'GET', '/v1/admin/audit', undefined, owner);
    expect(audit.body.entries.some((e: any) => e.action === 'config.budgets_updated')).toBe(true);
    await expect(t.deps.sql!`UPDATE audit_log SET action = 'x'`).rejects.toThrow(/append-only/);
    await expect(t.deps.sql!`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
    const bad = await http(t.base, 'PUT', '/v1/admin/config/budgets', { usdPerSession: -1 }, owner);
    expect(bad.status).toBe(400);
  });

  it('mobile pairing: device role ≤ issuer, revocable', async () => {
    const p = await http(t.base, 'POST', '/v1/admin/pairing', {}, analyst);
    expect(p.status).toBe(200);
    expect(p.body.qrPayload).toContain('telvey://pair?code=');
    const redeem = await http(t.base, 'POST', '/v1/admin/pairing/redeem', { code: p.body.code, deviceName: 'Test phone' });
    expect(redeem.status).toBe(200);
    expect(redeem.body.role).toBe('analyst');
    const dev = redeem.body.token;
    expect((await http(t.base, 'GET', '/v1/admin/metrics/cost', undefined, dev)).status).toBe(200);
    expect((await http(t.base, 'PUT', '/v1/admin/config/budgets', {}, dev)).status).toBe(403);
    // single use
    expect((await http(t.base, 'POST', '/v1/admin/pairing/redeem', { code: p.body.code, deviceName: 'again' })).status).toBe(401);
    // devices cannot mint further pairings
    expect((await http(t.base, 'POST', '/v1/admin/pairing', {}, dev)).status).toBe(403);
    const rev = await http(t.base, 'DELETE', `/v1/admin/devices/${redeem.body.deviceId}`, undefined, owner);
    expect(rev.status).toBe(204);
    expect((await http(t.base, 'GET', '/v1/admin/metrics/cost', undefined, dev)).status).toBe(401);
    void analystId;
  });

  it('WebAuthn registration is gated by a one-time code; OTP returns 501 without email provider', async () => {
    expect((await http(t.base, 'POST', '/v1/admin/webauthn/register/options', { email: 'new@example.org', code: 'WRONGCODE1' })).status).toBe(401);
    await t.deps.sql!`INSERT INTO admin_invites (kind, email, role, code_hash, expires_at) VALUES ('bootstrap', 'new@example.org', 'owner', ${sha256('ABCDEFGHJK')}, now() + interval '5 minutes')`;
    const o = await http(t.base, 'POST', '/v1/admin/webauthn/register/options', { email: 'new@example.org', code: 'abcdefghjk' });
    expect(o.status).toBe(200);
    expect(o.body.challenge).toBeTruthy();
    expect(o.body.rp.id).toBe('localhost');
    const v = await http(t.base, 'POST', '/v1/admin/webauthn/register/verify', { email: 'new@example.org', code: 'ABCDEFGHJK', response: { id: 'x', rawId: 'x', type: 'public-key', response: {} } });
    expect(v.status).toBe(400);
    const lo = await http(t.base, 'POST', '/v1/admin/webauthn/login/options', { email: 'owner@example.org' });
    expect(lo.status).toBe(200);
    expect((await http(t.base, 'POST', '/v1/auth/otp/start', { email: 'a@b.co' })).status).toBe(501);
  });

  it('tools: STT (hybrid voice) → utterance, realtime token budget, feedback', async () => {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    for (let i = 0; i < 20; i++) await http(t.base, 'POST', `/v1/sessions/${sid}/context`, frameOf(fixes[i]!, i), token);
    const res = await fetch(`${t.base}/v1/stt?sessionId=${sid}&submit=1&durationS=2`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: `Bearer ${token}` }, body: Buffer.from('TEXT:Where can I get coffee nearby?') });
    const stt = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(stt.text).toBe('Where can I get coffee nearby?');
    expect(stt.directives.some((d: any) => d.directive.type === 'map')).toBe(true);

    const nb = await http(t.base, 'POST', '/v1/nearby', { sessionId: sid, query: 'parking', location: { lat: fixes[19]!.lat, lng: fixes[19]!.lng } }, token);
    expect(nb.status).toBe(200);
    expect(nb.body.results.length).toBeGreaterThan(0);
    expect(nb.body.invalidDropped).toBe(2);
    expect(nb.body.fake).toBe(true);

    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push(await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token));
    expect(tokens[0]!.status).toBe(200);
    expect(tokens[0]!.body).toMatchObject({ provider: 'fake', maxSeconds: 300, idleTimeoutS: 20 });
    expect(tokens[3]!.status).toBe(429); // 15 min/session budget reserved by three 5-min bursts
    const usage = await http(t.base, 'POST', '/v1/realtime/usage', { sessionId: sid, provider: 'gemini', model: 'gemini-3.8-live', userAudioS: 60, assistantAudioS: 60, connectMs: 420 }, token);
    expect(usage.body.costUsd).toBeCloseTo(0.023, 6);

    expect((await http(t.base, 'POST', '/v1/feedback', { sessionId: sid, rating: 5 }, token)).status).toBe(201);
    expect((await http(t.base, 'POST', '/v1/feedback', { sessionId: sid, rating: 9 }, token)).status).toBe(400);
    await http(t.base, 'POST', `/v1/sessions/${sid}/end`, undefined, token);
  });

  it('admin metrics: latency percentiles, cost, providers/cache, quality, explain, geo k-anonymity', async () => {
    await t.deps.telemetry.flush();
    const lat = await http(t.base, 'GET', '/v1/admin/metrics/latency?range=1d', undefined, analyst);
    const names = lat.body.interactions.map((r: any) => r.interaction);
    expect(names).toEqual(expect.arrayContaining(['context_ingest', 'trigger_to_first_audio', 'speech_end_to_first_audio', 'nearby_to_result']));
    for (const r of lat.body.interactions) expect(r.p95).toBeGreaterThanOrEqual(r.p50);
    console.log('[metrics] latency p50/p95 (ms):', JSON.stringify(lat.body.interactions.map((r: any) => [r.interaction, Math.round(r.p50 * 10) / 10, Math.round(r.p95 * 10) / 10, r.n])));
    const cost = await http(t.base, 'GET', '/v1/admin/metrics/cost?range=1d', undefined, analyst);
    expect(cost.status).toBe(200);
    expect(cost.body.byTask.some((x: any) => x.task === 'realtime_session')).toBe(true);
    const prov = await http(t.base, 'GET', '/v1/admin/metrics/providers?range=1d', undefined, analyst);
    expect(prov.body.calls.length).toBeGreaterThan(0);
    expect(prov.body.cacheByLayer.length).toBeGreaterThan(0);
    const q = await http(t.base, 'GET', '/v1/admin/metrics/quality?range=1d', undefined, analyst);
    expect(q.body.stories).toBeGreaterThan(0);
    const ov = await http(t.base, 'GET', '/v1/admin/metrics/overview?range=1d', undefined, analyst);
    expect(ov.body.sessions.sessions).toBeGreaterThan(0);
    const health = await http(t.base, 'GET', '/v1/admin/health', undefined, analyst);
    expect(health.body).toMatchObject({ api: 'ok', db: true, redis: true });

    // geo: 4 sessions in one cell stay hidden, 5 in another are shown
    const sql = t.deps.sql!;
    for (let i = 0; i < 4; i++) await sql`INSERT INTO events (name, session_id, at, geohash5, props) VALUES ('story_started', gen_random_uuid(), now(), 'aaaaa', '{}')`;
    for (let i = 0; i < 5; i++) await sql`INSERT INTO events (name, session_id, at, geohash5, props) VALUES ('story_started', gen_random_uuid(), now(), 'bbbbb', '{}')`;
    const geo = await http(t.base, 'GET', '/v1/admin/metrics/geo?range=1d', undefined, analyst);
    const cells = geo.body.cells.map((c: any) => c.geohash5);
    expect(cells).toContain('bbbbb');
    expect(cells).not.toContain('aaaaa');
    await expect(sql`INSERT INTO events (name, at, geohash5) VALUES ('x', now(), 'toolong')`).rejects.toThrow();

    // explain (admin+)
    const [s] = await sql<{ id: string }[]>`SELECT id FROM sessions ORDER BY started_at LIMIT 1`;
    const adminTok = await t.deps.auth.sign({ sub: 'x', role: 'admin', adminId: '00000000-0000-0000-0000-000000000001' }, '1h');
    const ex = await http(t.base, 'GET', `/v1/admin/sessions/${s!.id}/explain`, undefined, adminTok);
    expect(ex.status).toBe(200);
    expect(ex.body.timeline.length).toBeGreaterThan(0);
  });

  it('privacy (D-012): no precise coordinates in Postgres; retention job runs; DELETE /v1/me', async () => {
    const sql = t.deps.sql!;
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    for (let i = 0; i < 25; i++) await http(t.base, 'POST', `/v1/sessions/${sid}/context`, frameOf(fixes[i]!, i), token);
    await http(t.base, 'POST', `/v1/sessions/${sid}/end`, undefined, token);
    await t.deps.telemetry.flush();
    const dump = JSON.stringify(await sql`SELECT (SELECT json_agg(e) FROM events e) AS ev, (SELECT json_agg(m) FROM journey_memory m) AS jm, (SELECT json_agg(s) FROM stories s) AS st, (SELECT json_agg(x) FROM sessions x) AS se`);
    const lat = fixes[10]!.lat.toFixed(4);
    expect(dump).not.toContain(lat);
    expect(dump).not.toMatch(/"lat"\s*:/);
    const [r] = await sql`SELECT run_retention() AS r`;
    expect((r as any).r).toHaveProperty('events');
    const del = await http(t.base, 'DELETE', '/v1/me', undefined, token);
    expect(del.status).toBe(204);
    const left = await sql`SELECT 1 FROM sessions WHERE id = ${sid}`;
    expect(left.length).toBe(0);
  });
});
