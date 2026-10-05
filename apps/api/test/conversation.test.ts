/**
 * Conversation runtime over the real WebSocket channel with Postgres + Redis:
 * C1 coffee interruption, C2 contextual follow-up, C3 change topic, B3 barge-in,
 * E3 reconnect without duplicates. Latencies are measured in-process and printed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkGrounding, extractEntities, type GeoFix } from '@city/core';
import { FakeNearbySearch } from '@city/providers';
import { frameOf, guest, http, newSession, resetDatabase, servicesAvailable, startTestApp, traceFixes, WsClient, type TestApp } from './helpers.js';

const ok = await servicesAvailable();
if (!ok) console.warn('[api tests] Postgres/Redis not available — integration suites skipped');

const fixes = traceFixes('wtc-walk');
const LAT: Record<string, number[]> = {};
const lat = (k: string, ms: number) => (LAT[k] ??= []).push(ms);

/** Stream trace frames until a `play` directive appears; returns it and the next frame index. */
async function untilStory(c: WsClient, start = 0, max = 80): Promise<{ play: any; i: number }> {
  for (let i = start; i < start + max; i++) {
    const from = c.messages.length;
    c.send({ type: 'context', ...frameOf(fixes[i]!, i) });
    const got = await c.next((m) => m.type === 'directive' && m.directive.type === 'play', 80, from).catch(() => null);
    if (got) return { play: got, i: i + 1 };
  }
  throw new Error('no story started');
}

async function setup(t: TestApp) {
  const token = await guest(t.base);
  const sid = await newSession(t.base, token);
  const c = await WsClient.connect(`${t.ws}/v1/sessions/${sid}/ws?token=${token}`);
  return { token, sid, c };
}

describe.skipIf(!ok)('conversation runtime (WS)', () => {
  let t: TestApp;
  beforeAll(async () => {
    await resetDatabase();
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
    const summary = Object.fromEntries(Object.entries(LAT).map(([k, xs]) => [k, { n: xs.length, p50: xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] }]));
    console.log('[in-process latencies ms]', JSON.stringify(summary));
  });

  it('C1: coffee interruption — stop, preserve, nearby (independent + validated), grounded answer, map, resume', async () => {
    const { token, sid, c } = await setup(t);
    const { play, i } = await untilStory(c);
    expect(play.directive.placeId).toBe('fx:nyc:911-memorial');
    expect(play.directive.segments[0].audioUrl).toMatch(/^\/v1\/audio\/[a-f0-9]{40}\.mp3$/);
    const planId = play.directive.planId;
    // audio served (segment 0 ready, later segments pipelined)
    for (const s of play.directive.segments) {
      const r = await fetch(`${t.base}${s.audioUrl}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toContain('immutable');
    }
    c.send({ type: 'audio_progress', planId, segmentIndex: 0, offsetMs: 2500, state: 'playing' });

    // 1. interruption → audio stop
    let from = c.messages.length;
    let t0 = performance.now();
    c.send({ type: 'control', action: 'interrupt', at: Date.now() });
    const stop = await c.directive('stop_audio', from);
    lat('bargein_stop_roundtrip', performance.now() - t0);
    expect(stop.directive.reason).toBe('user_speech');
    await c.directive('listen', from);

    // 2. story state preserved, not completed
    const s1 = await http(t.base, 'GET', `/v1/sessions/${sid}`, undefined, token);
    expect(s1.body.activeStory).toMatchObject({ planId, status: 'interrupted', segmentIndex: 0 });

    // 3–6. nearby search, validated, grounded answer, map highlight
    const discoveryCallsBefore = t.deps.guard.attempts.get('fixture:knowledge') ?? 0;
    from = c.messages.length;
    t0 = performance.now();
    c.send({ type: 'utterance', text: 'Where can I get coffee nearby?', utteranceId: 'u-c1', speechEndAt: Date.now() });
    const map = await c.directive('map', from, 5000, (e) => e.directive.action.kind === 'show_results');
    lat('tool_to_map_roundtrip', performance.now() - t0);
    const say = await c.directive('say', from);
    lat('speech_end_to_first_audio_roundtrip', performance.now() - t0);
    const results = map.directive.action.results;
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.map((r: any) => r.name)).not.toContain('Broken');
    expect(results.map((r: any) => r.name)).not.toContain('Nowhere');
    expect(results.every((r: any) => r.kind === 'food' && r.distanceM > 0)).toBe(true);
    for (let k = 1; k < results.length; k++) expect(results[k].distanceM).toBeGreaterThanOrEqual(results[k - 1].distanceM);
    expect(say.directive.purpose).toBe('answer');
    expect(say.directive.text).toContain(results[0].name);
    // grounded: every proper noun in the answer is a validated result name
    const names = results.map((r: any) => r.name).join(' ');
    for (const e of extractEntities(say.directive.text, 'en')) for (const w of e.split(' ').filter((x) => /^[A-Z]/.test(x))) expect(names).toContain(w);
    expect(say.directive.audioUrl).toMatch(/\.mp3$/);
    expect(say.turn).toBe(map.turn);
    // NearbySearch ran independently of discovery (no discovery/evidence call for the question)
    expect(t.deps.guard.attempts.get('fixture:knowledge') ?? 0).toBe(discoveryCallsBefore);

    // 7. resume from the same original moment (segment start) after the answer finishes
    from = c.messages.length;
    c.send({ type: 'audio_progress', planId: say.ref, segmentIndex: 0, offsetMs: 0, state: 'finished' });
    const resume = await c.directive('play', from);
    expect(resume.directive.planId).toBe(planId);
    expect(resume.directive.startAt).toEqual({ segmentIndex: 0, offsetMs: 0 });
    expect(resume.directive.bridgeText).toBeTruthy();
    const s2 = await http(t.base, 'GET', `/v1/sessions/${sid}`, undefined, token);
    expect(s2.body.activeStory.status).toBe('playing');
    void i;
    await c.close();
  });

  it('C2: "Why is that important?" uses the current brief/evidence, no place search, grounded', async () => {
    const { c } = await setup(t);
    const { play } = await untilStory(c);
    const nearbyBefore = t.fakes.nearby.calls;
    const placeCallsBefore = (t.deps.providers.places[0] as any).calls;
    const evidenceBefore = t.deps.discovery.stats.evidenceHits + t.deps.discovery.stats.evidenceMisses;
    const from = c.messages.length;
    c.send({ type: 'utterance', text: 'Why is that important?', utteranceId: 'u-c2' });
    const say = await c.directive('say', from);
    expect(say.directive.purpose).toBe('answer');
    expect(t.fakes.nearby.calls).toBe(nearbyBefore);
    expect((t.deps.providers.places[0] as any).calls).toBe(placeCallsBefore);
    expect(t.deps.discovery.stats.evidenceHits + t.deps.discovery.stats.evidenceMisses).toBe(evidenceBefore);
    // grounded against the active place's evidence (subject resolved without restatement)
    const rt = t.deps.sessions.hot(play.directive.planId ? [...(t.deps.sessions as any).runtimes.keys()].at(-1) : '')!;
    const subject = (rt as any).subject;
    expect(subject.placeId).toBe(play.directive.placeId);
    const brief = { ...subject.brief, facts: subject.pack.facts, spatialCue: null, journeyCallbacks: [], maxWords: 200 };
    expect(checkGrounding(say.directive.text, brief, { allow: ['Ida'] }).ok).toBe(true);
    await c.close();
  });

  it('C3: explicit topic change abandons the story — no auto-resume', async () => {
    const { token, sid, c } = await setup(t);
    const { play, i } = await untilStory(c);
    const planId = play.directive.planId;
    c.send({ type: 'control', action: 'interrupt' });
    let from = c.messages.length;
    c.send({ type: 'utterance', text: "Let's talk about something else", utteranceId: 'u-c3' });
    const ack = await c.directive('say', from);
    expect(ack.directive.purpose).toBe('ack');
    from = c.messages.length;
    c.send({ type: 'audio_progress', planId: ack.ref, segmentIndex: 0, offsetMs: 0, state: 'finished' });
    // keep walking for a while: the old plan must never be played again
    for (let k = i; k < i + 20; k++) c.send({ type: 'context', ...frameOf(fixes[k]!, k) });
    await new Promise((r) => setTimeout(r, 400));
    const replays = c.directives().slice(0).filter((m, idx) => idx >= 0 && m.directive.type === 'play' && m.directive.planId === planId);
    expect(replays).toHaveLength(1); // only the original start
    const s = await http(t.base, 'GET', `/v1/sessions/${sid}`, undefined, token);
    expect(s.body.activeStory?.planId === planId).toBe(false);
    expect(s.body.memory.storiesSkipped).toBe(1);
    void from;
    await c.close();
  });

  it('B3: barge-in "No, I meant parking" supersedes the in-flight coffee answer', async () => {
    const slow = new FakeNearbySearch({ latencyMs: 300 });
    const t2 = await startTestApp({ kv: 'memory', fakes: { nearby: slow } });
    try {
      const { c } = await setup(t2);
      await untilStory(c);
      const from = c.messages.length;
      c.send({ type: 'utterance', text: 'Where can I get coffee nearby?', utteranceId: 'b3-1' });
      await new Promise((r) => setTimeout(r, 60)); // coffee search in flight
      const t0 = performance.now();
      c.send({ type: 'utterance', text: 'No, I meant parking.', utteranceId: 'b3-2' });
      const say = await c.directive('say', from, 5000, (e) => /Garage|Parking|Lot/.test(e.directive.text));
      lat('bargein_new_turn_answer', performance.now() - t0);
      await new Promise((r) => setTimeout(r, 500)); // let the stale coffee call finish
      const after = c.directives().filter((m) => m.seq > 0 && c.messages.indexOf(m) >= from);
      const coffee = after.filter((m) => (m.directive.type === 'say' && /Cafe|Roastery|Bean/.test(m.directive.text)) || (m.directive.type === 'map' && m.directive.action.results?.some((r: any) => /Cafe|Roastery|Bean/.test(r.name))));
      expect(coffee).toEqual([]);
      const maps = after.filter((m) => m.directive.type === 'map' && m.directive.action.kind === 'show_results');
      expect(maps).toHaveLength(1);
      expect(maps[0]!.directive.action.results[0].name).toMatch(/Garage|Parking|Lot/);
      expect(say.turn).toBe(maps[0]!.turn);
      // the parking turn aborted the coffee turn (old output stopped: stop_audio for the story at turn 1)
      expect(after.some((m) => m.directive.type === 'stop_audio')).toBe(true);
      expect(slow.calls).toBe(2);
      await c.close();
    } finally {
      await t2.close();
    }
  });

  it('E3: reconnect delivers only missed directives, never duplicates; retried utterances do not re-run tools', async () => {
    const { token, sid, c } = await setup(t);
    await untilStory(c);
    const seen = c.directives();
    const lastSeen = seen.at(-1)!.seq;
    c.send({ type: 'ack', seq: lastSeen });
    await c.close();

    // While disconnected: REST utterance produces directives the socket never saw.
    const nearbyBefore = t.fakes.nearby.calls;
    const r = await http(t.base, 'POST', `/v1/sessions/${sid}/utterance`, { text: 'Where can I get coffee nearby?', utteranceId: 'e3-1' }, token);
    expect(r.status).toBe(200);
    const missed = r.body.directives.map((d: any) => d.seq);
    expect(missed.length).toBeGreaterThan(0);
    expect(t.fakes.nearby.calls).toBe(nearbyBefore + 1);

    const c2 = await WsClient.connect(`${t.ws}/v1/sessions/${sid}/ws?token=${token}`);
    c2.send({ type: 'resume', lastDirectiveSeq: lastSeen });
    await c2.next((m) => m.type === 'directive' && m.seq === missed.at(-1));
    const got = c2.directives().map((d) => d.seq);
    expect(got).toEqual(missed); // exactly the missed ones, in order
    expect(got.every((s) => s > lastSeen)).toBe(true);

    // Resume again (flaky network re-sends resume): nothing is sent twice on this connection.
    c2.send({ type: 'resume', lastDirectiveSeq: missed.at(-1) });
    // Retried utterance with the same id → no second nearby call, no directives.
    c2.send({ type: 'utterance', text: 'Where can I get coffee nearby?', utteranceId: 'e3-1' });
    await new Promise((res) => setTimeout(res, 200));
    expect(t.fakes.nearby.calls).toBe(nearbyBefore + 1);
    const seqs = c2.directives().map((d) => d.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    // and the story was not restarted by reconnecting
    expect(c2.directives().filter((d) => d.directive.type === 'play')).toHaveLength(0);
    await c2.close();
  });

  it('REST fallbacks mirror the WS semantics; wrong owner is rejected', async () => {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    let played: any = null;
    for (let i = 0; i < 60 && !played; i++) {
      const r = await http(t.base, 'POST', `/v1/sessions/${sid}/context`, frameOf(fixes[i] as GeoFix, i), token);
      expect(r.status).toBe(200);
      played = r.body.directives.find((d: any) => d.directive.type === 'play');
    }
    expect(played).toBeTruthy();
    const other = await guest(t.base);
    expect((await http(t.base, 'GET', `/v1/sessions/${sid}`, undefined, other)).status).toBe(403);
    expect((await http(t.base, 'POST', `/v1/sessions/${sid}/control`, { action: 'skip' }, token)).status).toBe(200);
    const bad = await http(t.base, 'POST', `/v1/sessions/${sid}/context`, { seq: 'x' }, token);
    expect(bad.status).toBe(400);
    const end = await http(t.base, 'POST', `/v1/sessions/${sid}/end`, undefined, token);
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ stories: 1 });
    expect(typeof end.body.costUsdEstimate).toBe('number');
    const hist = await http(t.base, 'GET', '/v1/me/history', undefined, token);
    expect(hist.body.places.map((p: any) => p.placeId)).toContain('fx:nyc:911-memorial');
  });
});
