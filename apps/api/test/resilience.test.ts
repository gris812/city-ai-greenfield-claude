/**
 * F1–F5 + invalid credential through the full runtime (REST frames at 1 Hz trace rate):
 * bounded provider calls, safe degraded behaviour, the session never collapses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlaceCandidate } from '@city/core';
import { FakeSpeechSynthesizer, FakeTextGenerator, StaticPlaceSource } from '@city/providers';
import { FixturePlaceSource } from '@city/replay';
import { frameOf, guest, http, newSession, resetDatabase, servicesAvailable, startTestApp, traceFixes, type TestAppOptions } from './helpers.js';

const ok = await servicesAvailable();
const fixes = traceFixes('wtc-walk');
const allPlaces: PlaceCandidate[] = new FixturePlaceSource().places;

async function drive(o: TestAppOptions, frames: number, after?: (x: { base: string; token: string; sid: string; directives: any[] }) => Promise<void>) {
  const t = await startTestApp({ kv: 'memory', ...o });
  try {
    const token = await guest(t.base);
    const sid = await newSession(t.base, token);
    const directives: any[] = [];
    for (let i = 0; i < frames; i++) {
      const r = await http(t.base, 'POST', `/v1/sessions/${sid}/context`, frameOf(fixes[i]!, i), token);
      expect(r.status).toBe(200);
      directives.push(...r.body.directives);
    }
    await after?.({ base: t.base, token, sid, directives });
    await t.deps.telemetry.flush();
    return { t, directives, sid };
  } finally {
    await t.close();
  }
}

describe.skipIf(!ok)('failure containment (F1–F5)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });
  afterAll(() => {});

  it('F1: empty discovery → no paid refresh on every GPS update (300 frames)', async () => {
    const src = new StaticPlaceSource([]);
    await drive({ providers: { places: [src] } }, 300);
    console.log('[F1] place-source calls for 300 frames:', src.calls);
    expect(src.calls).toBeLessThanOrEqual(12);
  });

  it('F2: place provider timeouts → bounded retry + breaker, session keeps running', async () => {
    const src = new StaticPlaceSource([], { failWith: 'timeout' });
    await drive({ providers: { places: [src] }, overrides: { timeouts: { places: 40 } } }, 300);
    console.log('[F2 timeout] attempts for 300 frames:', src.calls);
    expect(src.calls).toBeLessThanOrEqual(6);
  });

  it('F2: quota exceeded (429) → one attempt, breaker open, no billing loop', async () => {
    const src = new StaticPlaceSource([], { failWith: 'quota' });
    await drive({ providers: { places: [src] } }, 300);
    expect(src.calls).toBe(1);
  });

  it('invalid credential (401) → single attempt', async () => {
    const src = new StaticPlaceSource([], { failWith: 'auth' });
    await drive({ providers: { places: [src] } }, 300);
    expect(src.calls).toBe(1);
  });

  it('F3: LLM keeps hallucinating → template fallback, same target, ≤ 2 LLM calls per story', async () => {
    const story = new FakeTextGenerator({ mode: 'hallucinate' });
    const { directives } = await drive({ fakes: { story } }, 40);
    const play = directives.find((d) => d.directive.type === 'play');
    expect(play.directive.placeId).toBe('fx:nyc:911-memorial');
    const text = play.directive.segments.map((s: any) => s.text).join(' ');
    expect(text).not.toContain('Fakename');
    expect(text).not.toContain('1492');
    const stories = directives.filter((d) => d.directive.type === 'play').length;
    expect(story.calls).toBeLessThanOrEqual(2 * stories);
  });

  it('F3: LLM down → template story for the decided target', async () => {
    const story = new FakeTextGenerator({ failWith: 'server' });
    const { directives } = await drive({ fakes: { story } }, 40);
    const play = directives.find((d) => d.directive.type === 'play');
    expect(play.directive.placeId).toBe('fx:nyc:911-memorial');
    expect(play.directive.segments.length).toBeGreaterThan(0);
  });

  it('F4: TTS down → text still delivered (audioUrl null), conversation continues', async () => {
    const tts = new FakeSpeechSynthesizer({ failWith: 'server' });
    await drive({ fakes: { tts } }, 40, async ({ base, token, sid, directives }) => {
      const play = directives.find((d) => d.directive.type === 'play');
      expect(play).toBeTruthy();
      expect(play.directive.segments.every((s: any) => s.audioUrl === null && s.text.length > 0)).toBe(true);
      const r = await http(base, 'POST', `/v1/sessions/${sid}/utterance`, { text: 'Where can I get coffee nearby?' }, token);
      const say = r.body.directives.find((d: any) => d.directive.type === 'say');
      expect(say.directive.audioUrl).toBeNull();
      expect(say.directive.text.length).toBeGreaterThan(10);
    });
    expect(tts.calls).toBeLessThanOrEqual(4); // breaker opens; no per-segment hammering
  });

  it('F5: cache (Redis) unavailable → explicit reduced mode, readiness degraded, no provider storm', async () => {
    const src = new StaticPlaceSource(allPlaces);
    const t = await startTestApp({ kv: 'broken', providers: { places: [src] } });
    try {
      const ready = await http(t.base, 'GET', '/readyz');
      expect(ready.body).toMatchObject({ status: 'degraded', reducedMode: true, db: true });
      const token = await guest(t.base);
      const sid = await newSession(t.base, token);
      let played = false;
      for (let i = 0; i < 300; i++) {
        const r = await http(t.base, 'POST', `/v1/sessions/${sid}/context`, frameOf(fixes[i]!, i), token);
        expect(r.status).toBe(200);
        played ||= r.body.directives.some((d: any) => d.directive.type === 'play');
      }
      console.log('[F5] place-source calls in reduced mode for 300 frames:', src.calls);
      expect(src.calls).toBeLessThanOrEqual(3);
      expect(played).toBe(true); // still narrates from what it has
    } finally {
      await t.close();
    }
  });

  it('kill switch: owner-disabled LLM category → template narration, zero LLM calls', async () => {
    const story = new FakeTextGenerator();
    const { directives } = await drive({ fakes: { story }, overrides: { budget: { killed: ['llm'] } } }, 40);
    expect(directives.some((d) => d.directive.type === 'play')).toBe(true);
    expect(story.calls).toBe(0);
  });
});
