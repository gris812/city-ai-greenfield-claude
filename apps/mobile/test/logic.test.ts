import type { AdminCost, AdminHealth, AdminLatency, AdminOverview } from '@city/client';
import { parsePairingPayload, roleAtLeast } from '@city/client';
import { describe, expect, it } from 'vitest';
import { costSummary, errorLines, formatMs, formatUsd, healthLines, kpisFrom, latencyRows } from '../src/logic/admin';
import { apiBaseFromEnv, pairingApiAllowed } from '../src/logic/config';
import { FixBuffer, puckHeading, toGeoFix, type OsLocation } from '../src/logic/location';
import { addHistory, defaultSettingsFor, localeTag, mergeSettings, DEFAULT_SETTINGS } from '../src/logic/settings';
import { decodeTrace, type CompactTrace } from '../src/logic/trace';

const loc = (over: Partial<OsLocation['coords']> = {}, extra: Partial<OsLocation> = {}): OsLocation => ({
  timestamp: 1000,
  coords: { latitude: 41.88, longitude: -87.62, accuracy: 5, altitude: 180, speed: 1.4, heading: 90, ...over },
  ...extra,
});

describe('toGeoFix (OS sample → ContextFrame fix)', () => {
  it('maps a normal sample', () => {
    expect(toGeoFix(loc())).toEqual({ t: 1000, lat: 41.88, lng: -87.62, accuracyM: 5, speedMps: 1.4, headingDeg: 90, altitudeM: 180, source: 'gps' });
  });
  it('treats iOS -1 speed/heading and Android 0-heading-at-rest as unknown', () => {
    const f = toGeoFix(loc({ speed: -1, heading: -1 }))!;
    expect(f.speedMps).toBeNull();
    expect(f.headingDeg).toBeNull();
    expect(toGeoFix(loc({ speed: 0, heading: 0 }))!.headingDeg).toBeNull();
    expect(toGeoFix(loc({ speed: 12, heading: 0 }))!.headingDeg).toBe(0); // due north while driving is real
  });
  it('rejects impossible coordinates and marks mock providers as simulated', () => {
    expect(toGeoFix(loc({ latitude: 95 }))).toBeNull();
    expect(toGeoFix(loc({ longitude: Number.NaN }))).toBeNull();
    expect(toGeoFix(loc({}, { mocked: true }))!.source).toBe('simulated');
  });
});

describe('FixBuffer (background task before the store is attached)', () => {
  it('keeps order, drops duplicates, caps size', () => {
    const b = new FixBuffer(3);
    const f = (t: number) => ({ t, lat: 0, lng: 0, source: 'gps' as const });
    b.push([f(1), f(2)]);
    b.push([f(2), f(3), f(4)]);
    expect(b.drain().map((x) => x.t)).toEqual([2, 3, 4]);
    expect(b.size).toBe(0);
  });
});

describe('puckHeading', () => {
  it('uses course while moving and compass when still', () => {
    expect(puckHeading({ headingDeg: 180, speedMps: 5 }, 10)).toBe(180);
    expect(puckHeading({ headingDeg: 180, speedMps: 0.2 }, 10)).toBe(10);
    expect(puckHeading(null, null)).toBeNull();
  });
});

describe('config', () => {
  it('treats placeholder hosts as not configured', () => {
    expect(apiBaseFromEnv('https://api.telvey.example')).toEqual({ baseUrl: null, placeholder: true });
    expect(apiBaseFromEnv('')).toEqual({ baseUrl: null, placeholder: false });
    expect(apiBaseFromEnv('ftp://x.com')).toEqual({ baseUrl: null, placeholder: false });
    expect(apiBaseFromEnv('https://api.telvey.com/')).toEqual({ baseUrl: 'https://api.telvey.com', placeholder: false });
  });
  it('pairing QR may only target the build API (override in dev only)', () => {
    expect(pairingApiAllowed('https://api.telvey.com', 'https://api.telvey.com', false)).toEqual({ ok: true, api: 'https://api.telvey.com' });
    expect(pairingApiAllowed('https://evil.test', 'https://api.telvey.com', false).ok).toBe(false);
    expect(pairingApiAllowed('https://staging.telvey.com', 'https://api.telvey.com', true).api).toBe('https://staging.telvey.com');
    expect(pairingApiAllowed(null, null, false)).toMatchObject({ ok: false, reason: 'no_api' });
  });
  it('parses pairing QR payloads and bare codes', () => {
    expect(parsePairingPayload('telvey://pair?code=ab12cd34&api=https%3A%2F%2Fapi.telvey.com')).toEqual({ code: 'AB12CD34', api: 'https://api.telvey.com' });
    expect(parsePairingPayload('ab12cd34')).toEqual({ code: 'AB12CD34', api: null });
    expect(parsePairingPayload('https://example.com')).toBeNull();
    expect(parsePairingPayload('telvey://pair?code=x')).toBeNull();
  });
  it('role order', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('analyst', 'admin')).toBe(false);
    expect(roleAtLeast(null, 'analyst')).toBe(false);
  });
});

describe('settings', () => {
  it('defaults from device locale', () => {
    expect(defaultSettingsFor('ru', 'RU')).toMatchObject({ locale: 'ru', units: 'metric' });
    expect(defaultSettingsFor('en', 'US')).toMatchObject({ locale: 'en', units: 'imperial' });
    expect(defaultSettingsFor('en', 'GB').units).toBe('metric');
  });
  it('sanitises stored values', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { guideId: 'bob' as never, talkativeness: 9, stt: 'x' as never, backgroundLocation: false });
    expect(s).toMatchObject({ guideId: 'ida', talkativeness: 2, stt: 'auto', backgroundLocation: false });
    expect(localeTag({ locale: 'en', units: 'metric' })).toBe('en-GB');
    expect(localeTag({ locale: 'ru', units: 'imperial' })).toBe('ru-RU');
  });
  it('history is de-duplicated per plan and capped', () => {
    const e = (id: string) => ({ planId: id, placeName: id, guideId: 'ida', at: 0, simulated: false, excerpt: '' });
    let h = addHistory([], e('a'));
    h = addHistory(h, e('a'));
    expect(h).toHaveLength(1);
    for (let i = 0; i < 5; i++) h = addHistory(h, e(`p${i}`), 3);
    expect(h.map((x) => x.planId)).toEqual(['p4', 'p3', 'p2']);
  });
});

describe('compact trace decoding', () => {
  it('restores fixes on the original clock, marked replay', () => {
    const c: CompactTrace = { name: 'x', description: '', synthetic: true, hz: 1, durationS: 1, t0: 5000, route: [[1, 2]], fixes: [[0, 1, 2, 5, 1.2, 90], [1000, 1.0001, 2, null, null, null]] };
    const t = decodeTrace(c);
    expect(t.route).toEqual([{ lat: 1, lng: 2 }]);
    expect(t.fixes[1]).toEqual({ t: 6000, lat: 1.0001, lng: 2, accuracyM: null, speedMps: null, headingDeg: null, source: 'replay' });
  });
});

describe('operator view models', () => {
  it('formats money and latency', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(0.004)).toBe('$0.0040');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(1234)).toBe('$1,234');
    expect(formatMs(840)).toBe('840 ms');
    expect(formatMs(1500)).toBe('1.5 s');
  });
  it('KPIs, cost today vs 7d, latency order, health and errors', () => {
    const o: AdminOverview = { rangeDays: 1, active: { dau: 7, wau: 9, mau: 12 }, sessions: { sessions: 11, guest_sessions: 10, account_sessions: 1, avg_duration_s: 600, simulated: 3 }, funnel: { story_started: 5, story_completed: 3 } };
    const k = kpisFrom(o);
    expect(k).toMatchObject({ sessions: 11, dau: 7, simulated: 3 });
    expect(k.funnel.find((f) => f.key === 'story_started')?.n).toBe(5);
    expect(kpisFrom(null).sessions).toBeNull();
    const now = Date.parse('2026-09-28T12:00:00Z');
    const cost: AdminCost = { totalUsd: 4.5, perSessionUsd: 0.4, perActiveUserUsd: 0.6, byProvider: [], byDay: [{ day: '2026-09-27', usd: 3 }, { day: '2026-09-28', usd: 1.5 }] };
    expect(costSummary(cost, now)).toMatchObject({ today: 1.5, week: 4.5 });
    const lat: AdminLatency = { interactions: [{ interaction: 'stt', n: 2, p50: 400, p95: 900, max: 1000 }, { interaction: 'barge_in_stop', n: 5, p50: 40, p95: 80, max: 90 }] };
    expect(latencyRows(lat).map((r) => r.key)).toEqual(['barge_in_stop', 'stt']);
    const h: AdminHealth = { api: 'ok', db: true, redis: false, reducedMode: true, build: 'abcdef1234567890', recentErrors: [{ at: '2026-09-28T10:00:00Z', props: { provider: 'tts', kind: 'timeout' } }] };
    expect(healthLines(h).find((x) => x.label === 'Redis')?.ok).toBe(false);
    expect(healthLines(h).find((x) => x.label === 'Mode')?.value).toBe('reduced');
    expect(errorLines(h)[0]).toEqual({ at: '2026-09-28 10:00', text: 'tts · timeout' });
  });
});
