/**
 * Cost + latency work (D-018 … D-024) over the real API (Postgres + Redis + WS, fake providers):
 *  - shared story-body cache: second user → no LLM call, same body audio, no user data in the cache;
 *  - tiered TTS routing (economy tier by regime config);
 *  - streamed follow-ups: first say after sentence 1, appended sentences, per-sentence grounding,
 *    legacy clients still get one say, barge-in drops the rest;
 *  - cross-session memory: told places suppressed for the same guest, deletable, retention;
 *  - realtime reconciliation: many short bursts up to the seconds cap.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeSpeechSynthesizer, FakeTextGenerator } from '@city/providers';
import { NarrationCache } from '../src/narration-cache.js';
import { frameOf, guest, http, newSession, resetDatabase, servicesAvailable, startTestApp, traceFixes, WsClient, type TestApp } from './helpers.js';

const ok = await servicesAvailable();
const fixes = traceFixes('wtc-walk');

async function untilStory(c: WsClient, start = 0, max = 80): Promise<{ play: any; i: number }> {
  for (let i = start; i < start + max; i++) {
    const from = c.messages.length;
    c.send({ type: 'context', ...frameOf(fixes[i]!, i) });
    const got = await c.next((m) => m.type === 'directive' && m.directive.type === 'play', 80, from).catch(() => null);
    if (got) return { play: got, i: i + 1 };
  }
  throw new Error('no story started');
}

async function open(t: TestApp, body: Record<string, unknown> = {}, token?: string) {
  const tok = token ?? (await guest(t.base));
  const sid = await newSession(t.base, tok, body);
  const c = await WsClient.connect(`${t.ws}/v1/sessions/${sid}/ws?token=${tok}`);
  return { token: tok, sid, c };
}

const storyCalls = (f: FakeTextGenerator) => f.requests.filter((r) => r.task.startsWith('story')).length;

describe.skipIf(!ok)('D-018 shared story-body cache', () => {
  let t: TestApp;
  beforeAll(async () => {
    await resetDatabase();
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('a second user hears the same body with no LLM call; prefix is its own segment; no user data in the cache', async () => {
    const a = await open(t);
    const pa = (await untilStory(a.c)).play.directive;
    const llmAfterFirst = storyCalls(t.fakes.story);
    expect(llmAfterFirst).toBeGreaterThanOrEqual(1);
    expect(pa.segments.length).toBeGreaterThanOrEqual(2);
    // segment 0 is the deterministic prefix: spatial cue + place name
    expect(pa.segments[0].text).toContain(pa.placeName);
    expect(pa.segments[0].text).toMatch(/metres|meters|feet|mile|here|ahead|left|right|nearby|This is/i);

    const b = await open(t);
    const pb = (await untilStory(b.c)).play.directive;
    expect(pb.placeId).toBe(pa.placeId);
    expect(storyCalls(t.fakes.story)).toBe(llmAfterFirst); // body served from the shared cache
    // body segments (1..n) are identical → identical content-addressed audio
    expect(pb.segments.slice(1).map((s: any) => s.text)).toEqual(pa.segments.slice(1).map((s: any) => s.text));
    expect(pb.segments.slice(1).map((s: any) => s.audioUrl)).toEqual(pa.segments.slice(1).map((s: any) => s.audioUrl));
    expect(pb.planId).not.toBe(pa.planId); // plans stay per session

    // cache entries contain no session / guest ids
    const keys = await (t.deps.kv as any).redis.keys('nb:v1:*');
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) {
      const v = await t.deps.kv.get(k);
      for (const id of [a.sid, b.sid, a.token.split('.')[1]!]) expect(`${k}${v}`).not.toContain(id);
      expect(v).not.toMatch(/sessionId|guest/i);
    }
    // telemetry: cached story latency + admin counters
    await t.deps.telemetry.flush();
    const rows = await t.deps.sql!<{ interaction: string }[]>`SELECT interaction FROM latency_samples WHERE session_id = ${b.sid}`;
    expect(rows.map((r) => r.interaction)).toContain('cached_story_to_first_audio');
    expect(t.deps.narration!.stats.hits).toBeGreaterThanOrEqual(1);
    const sql = t.deps.sql!;
    const [adm] = await sql<{ id: string }[]>`INSERT INTO admin_users (email, role) VALUES ('an@example.org', 'analyst') RETURNING id`;
    const analyst = await t.deps.auth.sign({ sub: adm!.id, role: 'analyst', adminId: adm!.id }, '1h');
    const prov = await http(t.base, 'GET', '/v1/admin/metrics/providers?range=1d', undefined, analyst);
    expect(prov.body.cacheCounters.narrationBody).toMatchObject({ enabled: true });
    expect(prov.body.cacheCounters.narrationBody.hits).toBeGreaterThanOrEqual(1);
    expect(prov.body.cacheByLayer.some((r: any) => r.layer === 'narration_body' && r.hits >= 1)).toBe(true);
    await a.c.close();
    await b.c.close();
  });

  it('template fallbacks are never cached (an LLM outage must not pin the template)', async () => {
    const down = new FakeTextGenerator({ failWith: 'server' });
    const t2 = await startTestApp({ kv: 'memory', fakes: { story: down } });
    try {
      const a = await open(t2);
      await untilStory(a.c);
      expect(t2.deps.narration!.stats.notCached).toBeGreaterThanOrEqual(1);
      expect(t2.deps.narration!.stats.writes).toBe(0);
      await a.c.close();
    } finally {
      await t2.close();
    }
  });

  it('NarrationCache de-duplicates concurrent generation of one key', async () => {
    const t2 = await startTestApp({ kv: 'memory' });
    try {
      const nc = new NarrationCache(t2.deps.kv, t2.deps.telemetry);
      let calls = 0;
      const gen = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return { text: 'A body.', generatedBy: { kind: 'llm' as const, provider: 'fake', model: 'fake' }, grounding: { ok: true, unsupportedNumbers: [], unsupportedEntities: [], wordCount: 2, overBudget: false }, fallbackReason: null };
      };
      const [x, y] = await Promise.all([nc.getOrGenerate('k1', 's1', gen), nc.getOrGenerate('k1', 's2', gen)]);
      expect(calls).toBe(1);
      expect(x.text).toBe(y.text);
      expect((await nc.getOrGenerate('k1', 's3', gen)).source).toBe('hit');
      expect(calls).toBe(1);
    } finally {
      await t2.close();
    }
  });
});

describe.skipIf(!ok)('D-019 tiered TTS routing', () => {
  it('walking stories on the economy tier use the economy provider; answers stay on the standard tier', async () => {
    const economy = new FakeSpeechSynthesizer({ latencyMs: 2 }, 'fake_economy');
    const t = await startTestApp({ kv: 'memory', env: { TTS_TIER_WALKING: 'economy' }, providers: { ttsEconomy: [economy] } });
    try {
      const a = await open(t);
      const { play } = await untilStory(a.c);
      for (const s of play.directive.segments) expect((await fetch(`${t.base}${s.audioUrl}`)).status).toBe(200);
      expect(economy.calls).toBe(play.directive.segments.length); // prefix matches the body tier by default
      const standardBefore = t.fakes.tts.calls;
      const from = a.c.messages.length;
      a.c.send({ type: 'utterance', text: 'Where can I get coffee nearby?', utteranceId: 'tier-1' });
      await a.c.directive('say', from, 5000, (e) => e.directive.purpose === 'answer');
      expect(t.fakes.tts.calls).toBe(standardBefore + 1);
      expect(economy.calls).toBe(play.directive.segments.length);
      await a.c.close();
    } finally {
      await t.close();
    }
  });
});

describe.skipIf(!ok)('D-020 streamed follow-up answers', () => {
  const question = async (t: TestApp, capabilities: string[] | null) => {
    const a = await open(t, capabilities ? { client: { platform: 'test', appVersion: '0', capabilities } } : {});
    await untilStory(a.c);
    const from = a.c.messages.length;
    a.c.send({ type: 'utterance', text: 'Why is that important?', utteranceId: `q-${Math.random()}` });
    await a.c.directive('say', from, 5000, (e) => e.directive.purpose === 'answer');
    await new Promise((r) => setTimeout(r, 400));
    const says = a.c.directives().filter((m) => a.c.messages.indexOf(m) >= from && m.directive.type === 'say' && m.directive.purpose === 'answer');
    return { a, says, from };
  };

  it('say_append clients get sentence-by-sentence says (first before the answer is complete), grounded, in order', async () => {
    const story = new FakeTextGenerator({ latencyMs: 5, ttftMs: 20, interDeltaMs: 25 });
    const t = await startTestApp({ kv: 'memory', fakes: { story } });
    try {
      const { a, says } = await question(t, ['say_append']);
      expect(says.length).toBeGreaterThanOrEqual(2);
      expect(says[0]!.directive.append).toBeUndefined();
      for (const s of says.slice(1)) expect(s.directive.append).toBe(true);
      expect(new Set(says.map((s) => s.turn)).size).toBe(1);
      // first sentence was emitted while the model was still streaming (before the last say)
      expect(says[0]!.seq).toBeLessThan(says.at(-1)!.seq);
      const req = story.requests.find((r) => r.task === 'followup_answer')!;
      expect(req.onDelta).toBeTypeOf('function');
      await a.c.close();
    } finally {
      await t.close();
    }
  });

  it('an unsupported sentence is replaced by an approved fact before it is spoken', async () => {
    const story = new FakeTextGenerator({ latencyMs: 5, mode: 'hallucinate' });
    const t = await startTestApp({ kv: 'memory', fakes: { story } });
    try {
      const { a, says } = await question(t, ['say_append']);
      expect(says.length).toBeGreaterThanOrEqual(1);
      for (const s of says) {
        expect(s.directive.text).not.toContain('1492');
        expect(s.directive.text).not.toContain('Fakename');
      }
      await a.c.close();
    } finally {
      await t.close();
    }
  });

  it('legacy clients (no capability) still receive exactly one complete answer say', async () => {
    const t = await startTestApp({ kv: 'memory' });
    try {
      const { a, says } = await question(t, null);
      expect(says).toHaveLength(1);
      expect(says[0]!.directive.append).toBeUndefined();
      await a.c.close();
    } finally {
      await t.close();
    }
  });

  it('barge-in during a streamed answer: nothing from the old turn is emitted after the new turn starts', async () => {
    const story = new FakeTextGenerator({ latencyMs: 5, ttftMs: 10, interDeltaMs: 60 });
    const t = await startTestApp({ kv: 'memory', fakes: { story } });
    try {
      const a = await open(t, { client: { platform: 'test', appVersion: '0', capabilities: ['say_append'] } });
      await untilStory(a.c);
      const from = a.c.messages.length;
      a.c.send({ type: 'utterance', text: 'Why is that important?', utteranceId: 'bi-1' });
      const first = await a.c.directive('say', from, 5000, (e) => e.directive.purpose === 'answer');
      a.c.send({ type: 'control', action: 'interrupt' });
      const stop = await a.c.directive('stop_audio', from, 3000, (e) => e.turn !== first.turn);
      await new Promise((r) => setTimeout(r, 1500)); // the old stream would still be producing sentences
      const late = a.c.directives().filter((m) => m.seq > stop.seq && m.turn === first.turn);
      expect(late).toEqual([]);
      await a.c.close();
    } finally {
      await t.close();
    }
  });
});

describe.skipIf(!ok)('D-023 cross-session memory (returning guests)', () => {
  let t: TestApp;
  beforeAll(async () => {
    await resetDatabase();
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('a place told in an earlier session is not retold within the retell window; DELETE /v1/me erases the history', async () => {
    const token = await guest(t.base);
    const s1 = await open(t, { simulated: false }, token);
    const first = (await untilStory(s1.c)).play.directive;
    await s1.c.close();
    await http(t.base, 'POST', `/v1/sessions/${s1.sid}/end`, undefined, token);
    const rows = await t.deps.sql!<{ place_id: string; times: number }[]>`SELECT place_id, times FROM place_history`;
    expect(rows.map((r) => r.place_id)).toContain(first.placeId);
    // no coordinates anywhere in the history table
    const cols = await t.deps.sql!<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'place_history'`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(['last_told_at', 'owner_id', 'place_id', 'times']);

    // same guest, same route, new session → the first story is a different place
    const s2 = await open(t, { simulated: false }, token);
    const second = (await untilStory(s2.c)).play.directive;
    expect(second.placeId).not.toBe(first.placeId);
    await s2.c.close();

    // a different guest on the same route still hears it (history is per user/guest)
    const s3 = await open(t, { simulated: false });
    expect((await untilStory(s3.c)).play.directive.placeId).toBe(first.placeId);
    await s3.c.close();

    // simulated (demo/replay) sessions neither read nor write history
    const s4 = await open(t, { simulated: true }, token);
    expect((await untilStory(s4.c)).play.directive.placeId).toBe(first.placeId);
    await s4.c.close();

    const guestId = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')).sub as string;
    expect((await t.deps.sql!`SELECT 1 FROM place_history WHERE owner_id = ${guestId}`).length).toBeGreaterThan(0);
    expect((await http(t.base, 'DELETE', '/v1/me', undefined, token)).status).toBe(204);
    expect((await t.deps.sql!`SELECT 1 FROM place_history WHERE owner_id = ${guestId}`).length).toBe(0);
  });

  it('retention deletes history older than 90 days', async () => {
    const sql = t.deps.sql!;
    const owner = '00000000-0000-4000-8000-000000000001';
    await sql`INSERT INTO place_history (owner_id, place_id, last_told_at) VALUES (${owner}, 'old', now() - interval '91 days'), (${owner}, 'new', now() - interval '10 days')`;
    const [r] = await sql<{ run_retention: Record<string, number> }[]>`SELECT run_retention()`;
    expect(r!.run_retention.place_history).toBeGreaterThanOrEqual(1);
    const left = await sql<{ place_id: string }[]>`SELECT place_id FROM place_history WHERE owner_id = ${owner}`;
    expect(left.map((x) => x.place_id)).toEqual(['new']);
  });

  it('RETELL_AFTER_DAYS=0 retells immediately (policy knob)', async () => {
    const t2 = await startTestApp({ env: { RETELL_AFTER_DAYS: '0' } });
    try {
      const token = await guest(t2.base);
      const s1 = await open(t2, { simulated: false }, token);
      const first = (await untilStory(s1.c)).play.directive;
      await s1.c.close();
      await http(t2.base, 'POST', `/v1/sessions/${s1.sid}/end`, undefined, token);
      const s2 = await open(t2, { simulated: false }, token);
      expect((await untilStory(s2.c)).play.directive.placeId).toBe(first.placeId);
      await s2.c.close();
    } finally {
      await t2.close();
    }
  });
});

describe.skipIf(!ok)('D-022 realtime budget reconciliation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp({ kv: 'memory' });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('many short bursts are allowed: unused reserved seconds return to the session budget', async () => {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    const cap = t.deps.budget.current.realtimeSecondsPerSession;
    let used = 0;
    for (let i = 0; i < 12; i++) {
      const tok = await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token);
      expect(tok.status).toBe(200);
      expect(tok.body.reservationId).toBeTruthy();
      const u = await http(t.base, 'POST', '/v1/realtime/usage', { sessionId: sid, reservationId: tok.body.reservationId, provider: 'fake', model: 'fake-realtime', userAudioS: 8, assistantAudioS: 10, sessionS: 20 }, token);
      used += 20;
      expect(u.body).toMatchObject({ usedS: 20, creditedS: tok.body.maxSeconds - 20 });
      expect(u.body.realtimeSecondsLeft).toBe(cap - used);
      // reconciling the same reservation twice never credits twice
      const again = await http(t.base, 'POST', '/v1/realtime/usage', { sessionId: sid, reservationId: tok.body.reservationId, provider: 'fake', model: 'fake-realtime', userAudioS: 0, assistantAudioS: 0 }, token);
      expect(again.body.creditedS).toBe(0);
    }
    expect(used).toBeGreaterThan(3 * 20); // the old code allowed only three tokens (3 × 300 s reserved)
  });

  it('the real cap still binds: long bursts exhaust the 15-minute budget, then 429', async () => {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    const lefts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const tok = await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token);
      expect(tok.status).toBe(200);
      const u = await http(t.base, 'POST', '/v1/realtime/usage', { sessionId: sid, reservationId: tok.body.reservationId, provider: 'fake', model: 'fake-realtime', userAudioS: 100, assistantAudioS: 150, sessionS: 280 }, token);
      lefts.push(u.body.realtimeSecondsLeft);
    }
    expect(lefts).toEqual([620, 340, 60]);
    const fourth = await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token);
    expect(fourth.status).toBe(200);
    expect(fourth.body.maxSeconds).toBe(60); // only what is left
    // usage over the reservation is clamped (no negative credit, no extra budget)
    const u = await http(t.base, 'POST', '/v1/realtime/usage', { sessionId: sid, reservationId: fourth.body.reservationId, provider: 'fake', model: 'fake-realtime', userAudioS: 300, assistantAudioS: 300 }, token);
    expect(u.body).toMatchObject({ usedS: 60, creditedS: 0, realtimeSecondsLeft: 0 });
    expect((await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token)).status).toBe(429);
  });

  it('an unreported burst stays fully reserved (cost-safe default)', async () => {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    for (let i = 0; i < 3; i++) expect((await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token)).status).toBe(200);
    expect((await http(t.base, 'POST', '/v1/realtime/token', { sessionId: sid }, token)).status).toBe(429);
  });
});
