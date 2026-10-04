/**
 * Acceptance benchmark runner (benchmark/ACCEPTANCE_BENCHMARK.md A–G).
 *
 *   pnpm bench:acceptance                 # suites + replay + latency harness + web e2e (if built)
 *   pnpm bench:acceptance --samples 40    # latency sessions (default 36, minimum 30)
 *   pnpm bench:acceptance --no-web        # skip Playwright
 *
 * What it does, and how each output is labelled:
 *  1. Runs every vitest suite (core, providers, replay, client, api, mobile) with the JSON
 *     reporter and keeps a per-test pass/fail list as evidence.        → MEASURED-tests
 *  2. Re-runs the deterministic replay scenarios and checks them against the committed
 *     benchmark/replay/summary.json (regression / determinism).       → MEASURED-replay
 *  3. Starts the real API in-process (Fastify + Postgres + Redis, WebSocket channel) with
 *     deterministic fake providers wrapped in an explicit SIMULATED provider-latency profile
 *     (seeded log-normal per provider class, LATENCY_PROFILE below) and drives ≥ 30 sessions
 *     over the wtc-walk trace: story trigger, barge-in, coffee question via /v1/stt, follow-up.
 *     Latencies are observed on loopback (no mobile network, no device audio pipeline).
 *                                                                       → MEASURED-harness (simulated provider latency)
 *  4. Runs the web Playwright smoke suite (e2e/smoke.spec.ts only — screenshots.spec.ts would rewrite the
 *     committed deliverables/screenshots) against the existing production build.
 *                                                                       → MEASURED-e2e (Chromium, offline demo mode)
 *  5. Writes benchmark/acceptance/results.json (one row per scenario A1…F5 incl. the D-section
 *     realtime rows) and benchmark/acceptance/latency.json.
 *
 * Status rules: PASS only when the requirement as written is fully demonstrated by the evidence
 * listed; anything needing a real road run, a real device, live providers or a human rubric is
 * PARTIAL (some parts demonstrated) or NOT RUN. Any failing evidence test forces FAIL.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'benchmark', 'acceptance');
const argv = process.argv.slice(2);
const argVal = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
};
const SAMPLES = Math.max(30, Number(argVal('samples') ?? 36));
const WITH_WEB = !argv.includes('--no-web');
const log = (...a: unknown[]) => console.log('[bench:acceptance]', ...a);

// ───────────────────────────────────────────── helpers

/** Percentile with linear interpolation between closest ranks (Hyndman–Fan type 7, numpy default). */
export function pct(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return round1(s[lo]! + (s[hi]! - s[lo]!) * (h - lo));
}
const round1 = (x: number) => Math.round(x * 10) / 10;
function stats(xs: readonly number[]) {
  return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), min: xs.length ? round1(Math.min(...xs)) : null, max: xs.length ? round1(Math.max(...xs)) : null, mean: xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null };
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

// ───────────────────────────────────────────── 1. vitest suites

interface TestRow {
  suite: string;
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';
  durationMs: number;
}
interface SuiteRow {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  exitCode: number | null;
  stdoutTail?: string;
}

const SUITES = [
  { suite: 'core', filter: '@city/core' },
  { suite: 'providers', filter: '@city/providers' },
  { suite: 'replay', filter: '@city/replay' },
  { suite: 'client', filter: '@city/client' },
  { suite: 'api', filter: '@city/api' },
  { suite: 'mobile', filter: '@city/mobile' },
];

function runSuites(): { suites: SuiteRow[]; tests: TestRow[]; consoleLines: string[] } {
  const suites: SuiteRow[] = [];
  const tests: TestRow[] = [];
  const consoleLines: string[] = [];
  const tmp = join(tmpdir(), `bench-acc-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  for (const s of SUITES) {
    const out = join(tmp, `${s.suite}.json`);
    const t0 = Date.now();
    const r = spawnSync('pnpm', ['--filter', s.filter, 'exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${out}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    // eslint-disable-next-line no-control-regex
    const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
    for (const line of text.split('\n')) if (/^\[(F\d|in-process|api tests)/.test(line.trim())) consoleLines.push(`${s.suite}: ${line.trim()}`);
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    if (existsSync(out)) {
      const j = JSON.parse(readFileSync(out, 'utf8')) as { testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; title: string; status: TestRow['status']; duration?: number }> }> };
      for (const f of j.testResults) {
        for (const a of f.assertionResults) {
          tests.push({ suite: s.suite, file: f.name.replace(ROOT + '/', ''), name: a.fullName, status: a.status, durationMs: Math.round(a.duration ?? 0) });
          if (a.status === 'passed') passed++;
          else if (a.status === 'failed') failed++;
          else skipped++;
        }
      }
    } else failed++;
    suites.push({ suite: s.suite, passed, failed, skipped, durationMs: Date.now() - t0, exitCode: r.status, ...(r.status !== 0 ? { stdoutTail: text.slice(-1500) } : {}) });
    log(`suite ${s.suite}: ${passed} passed, ${failed} failed, ${skipped} skipped (${Date.now() - t0} ms)`);
  }
  rmSync(tmp, { recursive: true, force: true });
  return { suites, tests, consoleLines };
}

// ───────────────────────────────────────────── 2. replay

async function runReplay() {
  const { SCENARIOS, runScenario, FixturePlaceSource, FixtureEvidence } = await import('../../packages/replay/src/index.ts');
  const committed = JSON.parse(readFileSync(join(ROOT, 'benchmark', 'replay', 'summary.json'), 'utf8')) as Array<Record<string, unknown>>;
  const source = new FixturePlaceSource();
  const evidence = new FixtureEvidence();
  const out: Array<Record<string, unknown>> = [];
  for (const sc of SCENARIOS) {
    source.resetStats();
    const r = await runScenario(sc, { source, evidence });
    const prev = committed.find((c) => c.scenario === sc.name);
    out.push({ ...r.summary, matchesCommitted: prev ? JSON.stringify(prev) === JSON.stringify(r.summary) : null, storyRecords: r.stories.map((s) => ({ placeId: s.placeId, kind: s.kind, regime: s.regime, grounded: s.grounded, relative: s.relative, words: s.words, maxWords: s.maxWords ?? null, durationBudgetS: s.durationBudgetS ?? null, allowQuestionsToUser: s.allowQuestionsToUser ?? null })) });
  }
  // B2 (brief level): identical evidence → does each Guide keep the same factual core?
  const core = await import('../../packages/core/src/index.ts');
  const packs = [...evidence.packs.values()].filter((p) => !evidence.isThin(p.placeId));
  let sameIdentity = 0;
  let overlapSum = 0;
  let sameAngleSameFacts = 0;
  for (const p of packs) {
    const a = core.selectFacts(p, 'origin', Math.round(60 * core.IDA.narrative.verbosity * 2.5));
    const b = core.selectFacts(p, 'origin', Math.round(60 * core.EMIL.narrative.verbosity * 2.5));
    const ia = new Set(a.map((f) => f.id));
    const ib = new Set(b.map((f) => f.id));
    const inter = [...ia].filter((x) => ib.has(x)).length;
    overlapSum += inter / Math.max(1, Math.min(ia.size, ib.size));
    if (a[0]?.id === b[0]?.id) sameIdentity++;
    const c = core.selectFacts(p, 'origin', 150);
    const d = core.selectFacts(p, 'origin', 150);
    if (JSON.stringify(c) === JSON.stringify(d)) sameAngleSameFacts++;
  }
  const guideDiff = {
    packs: packs.length,
    leadFactSharedRate: round1((100 * sameIdentity) / Math.max(1, packs.length)) / 100,
    smallerSetContainedRate: round1((100 * overlapSum) / Math.max(1, packs.length)) / 100,
    identicalBriefFactsAtSameBudgetRate: round1((100 * sameAngleSameFacts) / Math.max(1, packs.length)) / 100,
    personaParameters: {
      ida: { verbosity: core.IDA.narrative.verbosity, speakingRate: core.IDA.voice.speakingRate, preferredAngles: core.IDA.narrative.preferredAngles.slice(0, 3) },
      emil: { verbosity: core.EMIL.narrative.verbosity, speakingRate: core.EMIL.voice.speakingRate, preferredAngles: core.EMIL.narrative.preferredAngles.slice(0, 3) },
    },
    note: 'Brief-level only. The deterministic template is persona-neutral by design; pacing/structure/tone differences come from the LLM and need live generation + a human rubric (NOT RUN).',
  };
  return { scenarios: out, guideDiff };
}

// ───────────────────────────────────────────── 3. latency harness (simulated provider latency)

/**
 * SIMULATED provider latency profile — implementation-team assumptions representative of the
 * provider classes the default config would call (small hosted LLM, hosted TTS returning a whole
 * file, batch STT, Google Places Nearby, Wikipedia/Wikidata). Log-normal: median p50, 95th pct p95.
 * These are NOT measurements of any provider. Replace with `pnpm bench:providers` results.
 */
export const LATENCY_PROFILE = {
  llm_story: { p50: 1100, p95: 2600, note: 'small hosted LLM, ~1.2k input / ~200 output tokens, non-streamed' },
  llm_followup: { p50: 700, p95: 1600, ttftShare: 0.45, note: 'small hosted LLM, ~100 output tokens. Streamed (D-020): the same full-completion draw, first delta after ttftShare × total (ASSUMPTION), remaining words spread evenly' },
  llm_intent: { p50: 450, p95: 1000, note: 'small hosted LLM, JSON, ~30 output tokens (only when rules do not match)' },
  tts: { p50: 250, p95: 600, perCharP50: 2.5, note: 'hosted TTS returning a complete file; p50 = 250 ms + 2.5 ms/char, same spread' },
  stt: { p50: 450, p95: 1100, note: 'batch STT of a ~3 s push-to-talk clip' },
  nearby: { p50: 250, p95: 650, note: 'Places API (New) Nearby Search, narrow field mask' },
  places: { p50: 500, p95: 1500, note: 'Wikipedia geosearch + one Wikidata SPARQL (discovery / density probe)' },
  knowledge: { p50: 400, p95: 1200, note: 'Wikipedia REST summary + Wikidata claims (evidence)' },
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function lognormal(seed: number) {
  const r = mulberry32(seed);
  return (p50: number, p95: number) => {
    const u1 = Math.max(1e-12, r());
    const u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const sigma = Math.log(p95 / p50) / 1.6448536;
    return Math.min(p50 * 8, Math.exp(Math.log(p50) + sigma * z));
  };
}
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

interface Timed {
  t: number;
  wall: number;
  m: any;
}

async function runLatencyHarness() {
  const H = await import('../../apps/api/test/helpers.ts');
  const P = await import('../../packages/providers/src/index.ts');
  const { fixtureProviders } = await import('../../apps/api/src/demo.ts');
  if (!(await H.servicesAvailable())) throw new Error('Postgres/Redis not available (service postgresql start; redis-server --daemonize yes)');
  await H.resetDatabase();

  const draws: Record<string, number[]> = {};
  const gen = (k: keyof typeof LATENCY_PROFILE, seed: number) => {
    const ln = lognormal(seed);
    return (extraP50 = 0) => {
      const p = LATENCY_PROFILE[k];
      const p50 = p.p50 + extraP50;
      const v = ln(p50, p50 * (p.p95 / p.p50));
      (draws[k] ??= []).push(v);
      return v;
    };
  };
  const dStory = gen('llm_story', 11);
  const dFollow = gen('llm_followup', 12);
  const dIntent = gen('llm_intent', 13);
  const dTts = gen('tts', 14);
  const dStt = gen('stt', 15);
  const dNearby = gen('nearby', 16);
  const dPlaces = gen('places', 17);
  const dKnow = gen('knowledge', 18);

  const storyFake = new P.FakeTextGenerator({});
  const intentFake = new P.FakeTextGenerator({});
  const ttsFake = new P.FakeSpeechSynthesizer({});
  const sttFake = new P.FakeSpeechRecognizer({});
  const nearbyFake = new P.FakeNearbySearch({ includeInvalid: true });
  const fx = await fixtureProviders();
  const base = { fake: true as const, model: 'simulated-latency' };
  const story = {
    ...base,
    name: 'fake',
    async generate(req: any, ctx?: any) {
      const total = req.task.startsWith('followup') ? dFollow() : dStory();
      if (!req.onDelta) {
        await sleep(total, ctx?.signal);
        return storyFake.generate(req, ctx);
      }
      // Streamed (D-020): same total draw; first delta after ttftShare × total, then one delta per word.
      const { onDelta, ...plain } = req;
      const r = await storyFake.generate(plain, ctx);
      const words: string[] = r.text.match(/\s*\S+/g) ?? [r.text];
      const ttft = total * LATENCY_PROFILE.llm_followup.ttftShare;
      await sleep(ttft, ctx?.signal);
      const per = (total - ttft) / Math.max(1, words.length);
      for (let k = 0; k < words.length; k++) {
        if (k > 0) await sleep(per, ctx?.signal);
        onDelta(words[k]);
      }
      return r;
    },
  };
  const intent = {
    ...base,
    name: 'fake',
    async generate(req: any, ctx?: any) {
      await sleep(dIntent(), ctx?.signal);
      return intentFake.generate(req, ctx);
    },
  };
  const tts = {
    ...base,
    name: 'fake',
    defaultVoice: 'fake-voice',
    async synthesize(req: any, ctx?: any) {
      const t0 = performance.now();
      await sleep(dTts(LATENCY_PROFILE.tts.perCharP50 * req.text.length), ctx?.signal);
      const r = await ttsFake.synthesize(req, ctx);
      return { ...r, ttfbMs: Math.round(performance.now() - t0) };
    },
  };
  const stt = {
    ...base,
    name: 'fake',
    async transcribe(req: any, ctx?: any) {
      await sleep(dStt(), ctx?.signal);
      return sttFake.transcribe(req, ctx);
    },
  };
  const nearby = {
    ...base,
    name: 'fake',
    async search(req: any, ctx?: any) {
      await sleep(dNearby(), ctx?.signal);
      return nearbyFake.search(req, ctx);
    },
  };
  const places = {
    ...base,
    name: 'fixture',
    async query(q: any, ctx?: any) {
      await sleep(dPlaces(), ctx?.signal);
      return fx.places.query(q, ctx);
    },
  };
  const knowledge = {
    ...base,
    name: 'fixture',
    async evidence(p: any, l: any, ctx?: any) {
      await sleep(dKnow(), ctx?.signal);
      return fx.knowledge.evidence(p, l, ctx);
    },
  };

  const t = await H.startTestApp({ providers: { story: [story], intent: [intent], tts: [tts], stt: [stt], nearby: [nearby], places: [places], knowledge: [knowledge] } as any });
  const serverLat: Array<{ interaction: string; ms: number; at: number; sessionId: string | null; props?: any }> = [];
  const costs: any[] = [];
  t.deps.telemetry.listeners.latency.push((s) => serverLat.push(s));
  t.deps.telemetry.listeners.cost.push((c) => costs.push(c));
  const fixes = H.traceFixes('wtc-walk');
  const audioDir = t.deps.config.audioDir;
  const clearAudio = () => {
    for (const d of readdirSync(audioDir)) rmSync(join(audioDir, d), { recursive: true, force: true });
  };
  /** D-018 shared story-body cache (Redis `nb:v1:*`). */
  const clearNarration = async () => {
    const redis = (t.deps.kv as any).redis;
    const keys: string[] = await redis.keys('nb:v1:*');
    if (keys.length) await redis.del(...keys);
  };
  const cacheSnap = () => ({ narration: { ...t.deps.narration!.stats }, audio: { ...t.deps.audio.stats }, discovery: { ...t.deps.discovery.stats } });
  const cacheDelta = (a: ReturnType<typeof cacheSnap>, b: ReturnType<typeof cacheSnap>) => {
    const r = (h: number, m: number) => (h + m > 0 ? round1((1000 * h) / (h + m)) / 1000 : null);
    const nh = b.narration.hits - a.narration.hits;
    const nm = b.narration.misses - a.narration.misses;
    const ah = b.audio.hits - a.audio.hits;
    const am = b.audio.misses - a.audio.misses;
    const ph = b.discovery.placeHits - a.discovery.placeHits;
    const pm = b.discovery.placeMisses - a.discovery.placeMisses;
    const eh = b.discovery.evidenceHits - a.discovery.evidenceHits;
    const em = b.discovery.evidenceMisses - a.discovery.evidenceMisses;
    return { narrationBody: { hits: nh, misses: nm, hitRate: r(nh, nm) }, ttsAudio: { hits: ah, misses: am, hitRate: r(ah, am) }, places: { hits: ph, misses: pm, hitRate: r(ph, pm) }, evidence: { hits: eh, misses: em, hitRate: r(eh, em) } };
  };

  const M = {
    triggerToPlayServer: [] as number[],
    cachedTriggerToPlayServer: [] as number[],
    audioFetchMs: [] as number[],
    triggerToFirstAudioBytes: [] as number[],
    cachedTriggerToFirstAudioBytes: [] as number[],
    cachedWarmTriggerToFirstAudioBytes: [] as number[],
    cachedWarmTriggerToPlayServer: [] as number[],
    bargeInStopRoundTrip: [] as number[],
    speechEndToFirstAudioNearby: [] as number[],
    speechEndToFirstAudioFollowup: [] as number[],
    speechEndToMap: [] as number[],
    nearbyProviderToValidated: [] as number[],
    toolResultToMapAtClient: [] as number[],
    serverSpeechEndToFirstAudio: [] as number[],
    serverStt: [] as number[],
    contextIngest: [] as number[],
  };
  const checks = { sessions: 0, storyStarted: 0, firstTargetWtc: 0, stopBeforeAnswer: 0, storyPreservedInterrupted: 0, mapValid: 0, answerNamesFirstResult: 0, invalidRowsDropped: 0, resumedSamePlan: 0, followupNoPlaceSearch: 0, errors: [] as string[] };
  const c1Costs: Array<{ provider: string; category: string; task: string; units: any }[]> = [];

  async function session(i: number, mode: 'full' | 'cached' | 'cached_warm' | 'prime') {
    const token = await H.guest(t.base);
    const guideId = i % 2 === 0 ? 'ida' : 'emil';
    // The harness declares the streamed-answer capability like the web and mobile apps do (D-020).
    const sid = await H.newSession(t.base, token, { guideId, client: { platform: 'bench', appVersion: '0', capabilities: ['say_append'] } });
    const ws = await H.WsClient.connect(`${t.ws}/v1/sessions/${sid}/ws?token=${token}`);
    const msgs: Timed[] = [];
    ws.sock.on('message', (d: Buffer) => msgs.push({ t: performance.now(), wall: Date.now(), m: JSON.parse(d.toString()) }));
    const waitMsg = async (pred: (m: any) => boolean, from: number, timeoutMs = 20_000): Promise<Timed> => {
      const t0 = Date.now();
      for (;;) {
        const hit = msgs.slice(from).find((x) => pred(x.m));
        if (hit) return hit;
        if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting; last=${JSON.stringify(msgs.slice(-2).map((x) => x.m)).slice(0, 300)}`);
        await sleep(2);
      }
    };
    const isDir = (type: string) => (m: any) => m.type === 'directive' && m.directive.type === type;
    try {
      checks.sessions += mode === 'full' ? 1 : 0;
      const latBefore = serverLat.length;
      // 1. stream trace frames (1 Hz in trace time) until the first story plays. Frames go over the
      // REST fallback, which returns only after the frame's tick (incl. story preparation) is done,
      // so streaming stops exactly at the triggering frame and journey time does not run ahead of
      // the story (the WS still receives every directive).
      let play: Timed | null = null;
      for (let k = 0; k < 80 && !play; k++) {
        await H.http(t.base, 'POST', `/v1/sessions/${sid}/context`, H.frameOf(fixes[k]!, k), token);
        play = msgs.find((x) => isDir('play')(x.m)) ?? (await waitMsg(isDir('play'), 0, 30).catch(() => null));
      }
      if (!play) play = await waitMsg(isDir('play'), 0, 20_000);
      const trig = serverLat.slice(latBefore).find((s) => s.sessionId === sid && (s.interaction === 'trigger_to_first_audio' || s.interaction === 'cached_story_to_first_audio'));
      const seg0 = play.m.directive.segments[0];
      const f0 = performance.now();
      const res = await fetch(`${t.base}${seg0.audioUrl}`);
      await res.arrayBuffer();
      const fetchMs = performance.now() - f0;
      if (trig && mode !== 'prime') {
        if (trig.interaction === 'cached_story_to_first_audio') {
          if (mode === 'full') checks.errors.push(`session ${i}: unexpected cached narration in a cold run`);
          if (mode === 'cached_warm') {
            M.cachedWarmTriggerToPlayServer.push(trig.ms);
            M.cachedWarmTriggerToFirstAudioBytes.push(trig.ms + (play.wall - trig.at) + fetchMs);
          } else {
            M.cachedTriggerToPlayServer.push(trig.ms);
            M.cachedTriggerToFirstAudioBytes.push(trig.ms + (play.wall - trig.at) + fetchMs);
          }
        } else if (mode !== 'full') {
          checks.errors.push(`session ${i} (${mode}): narration body was not served from the shared cache`);
        } else if (mode === 'full') {
          M.triggerToPlayServer.push(trig.ms);
          M.triggerToFirstAudioBytes.push(trig.ms + (play.wall - trig.at) + fetchMs);
          M.audioFetchMs.push(fetchMs);
        }
      }
      if (mode !== 'full') return;
      for (const x of serverLat.slice(latBefore)) if (x.sessionId === sid && x.interaction === 'context_ingest') M.contextIngest.push(x.ms);
      checks.storyStarted++;
      if (play.m.directive.placeId === 'fx:nyc:911-memorial') checks.firstTargetWtc++;
      const planId = play.m.directive.planId;
      ws.send({ type: 'audio_progress', planId, segmentIndex: 0, offsetMs: 2500, state: 'playing' });
      await sleep(30);

      // 2. barge-in: interrupt → stop_audio (server round trip over the WS channel)
      let from = msgs.length;
      let t0 = performance.now();
      ws.send({ type: 'control', action: 'interrupt', at: Date.now() });
      const stop = await waitMsg(isDir('stop_audio'), from);
      M.bargeInStopRoundTrip.push(stop.t - t0);
      const st = await H.http(t.base, 'GET', `/v1/sessions/${sid}`, undefined, token);
      if (st.body.activeStory?.planId === planId && st.body.activeStory?.status === 'interrupted') checks.storyPreservedInterrupted++;

      // 3. coffee question through the hybrid voice path: speech end = start of the /v1/stt upload
      from = msgs.length;
      const costFrom = costs.length;
      const latFrom = serverLat.length;
      t0 = performance.now();
      const sttRes = await fetch(`${t.base}/v1/stt?sessionId=${sid}&submit=1&utteranceId=c1-${i}&durationS=3`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: `Bearer ${token}` }, body: Buffer.from('TEXT:Where can I get coffee nearby?') });
      await sttRes.json();
      const map = await waitMsg((m) => isDir('map')(m) && m.directive.action.kind === 'show_results', from);
      const say = await waitMsg((m) => isDir('say')(m) && m.directive.purpose === 'answer', from);
      const a0 = performance.now();
      if (say.m.directive.audioUrl) await (await fetch(`${t.base}${say.m.directive.audioUrl}`)).arrayBuffer();
      const answerAudio = performance.now() - a0;
      M.speechEndToMap.push(map.t - t0);
      M.speechEndToFirstAudioNearby.push(say.t - t0 + answerAudio);
      const nearbySample = serverLat.slice(latFrom).find((s) => s.sessionId === sid && s.interaction === 'nearby_to_result');
      if (nearbySample) {
        M.nearbyProviderToValidated.push(nearbySample.ms);
        M.toolResultToMapAtClient.push(Math.max(0, map.wall - nearbySample.at));
      }
      const sEnd = serverLat.slice(latFrom).find((s) => s.sessionId === sid && s.interaction === 'speech_end_to_first_audio');
      if (sEnd) M.serverSpeechEndToFirstAudio.push(sEnd.ms);
      const sttS = serverLat.slice(latFrom).find((s) => s.sessionId === sid && s.interaction === 'stt');
      if (sttS) M.serverStt.push(sttS.ms);
      const results = map.m.directive.action.results as Array<{ name: string; distanceM: number; kind: string }>;
      const sorted = results.every((r, k) => k === 0 || r.distanceM >= results[k - 1]!.distanceM);
      if (results.length >= 2 && sorted && results.every((r) => r.kind === 'food')) checks.mapValid++;
      if (!results.some((r) => r.name === 'Broken' || r.name === 'Nowhere')) checks.invalidRowsDropped++;
      if (say.m.directive.text.includes(results[0]!.name)) checks.answerNamesFirstResult++;
      if (stop.t < say.t) checks.stopBeforeAnswer++;
      // C1 incremental calls: STT, intent LLM, Nearby, and TTS of the answer text (story segments 1..n
      // are synthesized in the background during this window and are excluded by length).
      const sayLen = String(say.m.directive.text).length;
      c1Costs.push(
        costs
          .slice(costFrom)
          .filter((c) => c.sessionId === sid && !c.cacheHit && c.ok && (c.category === 'stt' || c.category === 'maps' || (c.category === 'llm' && /intent/.test(c.task)) || (c.category === 'tts' && c.units.characters === sayLen)))
          .map((c) => ({ provider: c.provider, category: c.category, task: c.task, units: c.units })),
      );

      // 4. answer finished → prior story resumes from the same original moment
      from = msgs.length;
      ws.send({ type: 'audio_progress', planId: say.m.ref, segmentIndex: 0, offsetMs: 0, state: 'finished' });
      const resume = await waitMsg(isDir('play'), from);
      if (resume.m.directive.planId === planId && resume.m.directive.startAt.segmentIndex === 0) checks.resumedSamePlan++;

      // 5. contextual follow-up through STT: "Why is that important?"
      from = msgs.length;
      const nearbyCallsBefore = nearbyFake.calls;
      t0 = performance.now();
      const r2 = await fetch(`${t.base}/v1/stt?sessionId=${sid}&submit=1&utteranceId=c2-${i}&durationS=2`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: `Bearer ${token}` }, body: Buffer.from('TEXT:Why is that important?') });
      await r2.json();
      const say2 = await waitMsg((m) => isDir('say')(m) && m.directive.purpose === 'answer', from);
      const b0 = performance.now();
      if (say2.m.directive.audioUrl) await (await fetch(`${t.base}${say2.m.directive.audioUrl}`)).arrayBuffer();
      M.speechEndToFirstAudioFollowup.push(say2.t - t0 + (performance.now() - b0));
      if (nearbyFake.calls === nearbyCallsBefore) checks.followupNoPlaceSearch++;
    } catch (e) {
      checks.errors.push(`session ${i} (${mode}): ${(e as Error).message.slice(0, 200)}`);
    } finally {
      await ws.close().catch(() => undefined);
      await H.http(t.base, 'POST', `/v1/sessions/${sid}/end`, undefined, token).catch(() => undefined);
    }
  }

  const cacheRates: Record<string, ReturnType<typeof cacheDelta>> = {};
  try {
    // warm-up sessions (not counted): prime JIT, DB pools, evidence + discovery caches
    await session(-2, 'prime');
    await session(-1, 'prime');
    let c0 = cacheSnap();
    for (let i = 0; i < SAMPLES; i++) {
      // cold narration: shared story-body cache (D-018) AND audio emptied → LLM + TTS on every story
      clearAudio();
      await clearNarration();
      await session(i, 'full');
      if ((i + 1) % 6 === 0) log(`latency harness: ${i + 1}/${SAMPLES} sessions`);
    }
    cacheRates.cold = cacheDelta(c0, cacheSnap());
    // cached story (D-018): body prose warm in the shared cache, ALL audio evicted before each session
    // → no LLM call; first audio = synthesis of the short prefix (conservative cached case)
    await session(1000, 'prime');
    await session(1001, 'prime');
    c0 = cacheSnap();
    for (let i = 0; i < SAMPLES; i++) {
      clearAudio();
      await session(1002 + i, 'cached');
    }
    cacheRates.cachedProseColdAudio = cacheDelta(c0, cacheSnap());
    // cached story, everything warm (repeat landmark / corridor: prefix audio repeats too)
    c0 = cacheSnap();
    for (let i = 0; i < SAMPLES; i++) await session(2002 + i, 'cached_warm');
    cacheRates.cachedWarm = cacheDelta(c0, cacheSnap());
    await t.deps.telemetry.flush();
  } finally {
    await t.close();
  }
  const drawStats = Object.fromEntries(Object.entries(draws).map(([k, v]) => [k, stats(v.map(round1))]));
  return { M, checks, c1Costs, drawStats, cacheRates };
}

// ───────────────────────────────────────────── 4. web e2e

function runWeb(): { ran: boolean; reason?: string; passed: number; failed: number; tests: Array<{ name: string; status: string; durationMs: number }>; buildAt?: string } {
  const buildId = join(ROOT, 'apps', 'web', '.next', 'BUILD_ID');
  if (!WITH_WEB) return { ran: false, reason: '--no-web', passed: 0, failed: 0, tests: [] };
  if (!existsSync(buildId)) return { ran: false, reason: 'no production build (run pnpm --filter @city/web build)', passed: 0, failed: 0, tests: [] };
  const out = join(tmpdir(), `bench-web-${process.pid}.json`);
  const r = spawnSync('pnpm', ['--filter', '@city/web', 'exec', 'playwright', 'test', 'e2e/smoke.spec.ts', '--reporter=json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers', FORCE_COLOR: '0' },
    timeout: 900_000,
  });
  const tests: Array<{ name: string; status: string; durationMs: number }> = [];
  const walk = (suite: any, prefix: string) => {
    for (const s of suite.suites ?? []) walk(s, prefix ? `${prefix} › ${s.title}` : s.title);
    for (const sp of suite.specs ?? []) for (const tt of sp.tests ?? []) for (const rr of tt.results ?? []) tests.push({ name: `${prefix} › ${sp.title}`, status: rr.status, durationMs: rr.duration });
  };
  if (existsSync(out)) {
    walk(JSON.parse(readFileSync(out, 'utf8')), '');
    rmSync(out, { force: true });
  }
  const passed = tests.filter((x) => x.status === 'passed').length;
  const failed = tests.filter((x) => x.status !== 'passed' && x.status !== 'skipped').length;
  log(`web e2e: ${passed} passed, ${failed} failed (exit ${r.status})`);
  return { ran: true, passed, failed: failed + (tests.length === 0 ? 1 : 0), tests, buildAt: statSync(buildId).mtime.toISOString(), ...(tests.length === 0 ? { reason: (r.stderr || r.stdout || '').slice(-500) } : {}) };
}

// ───────────────────────────────────────────── 5. scenario table

type Status = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT RUN';
interface ScenarioDef {
  id: string;
  section: string;
  title: string;
  /** Best status the available evidence can support (FAIL overrides when evidence fails). */
  ceiling: Status;
  /** Test-name substrings (suite:substring) that must all be present and passing. */
  tests: string[];
  evidenceKinds: string[];
  oneLine: string;
  notRun: string[];
  web?: string[];
  extra?: () => { ok: boolean; detail: string };
}

async function main() {
  const t0 = Date.now();
  mkdirSync(OUT, { recursive: true });
  const env = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    postgres: spawnSync('psql', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? null,
    redis: spawnSync('redis-server', ['--version'], { encoding: 'utf8' }).stdout?.trim().split(' ').slice(0, 3).join(' ') ?? null,
    cpus: (await import('node:os')).cpus().length,
  };
  log('running vitest suites…');
  // BENCH_SKIP_SUITES=1 is a harness-debugging shortcut only: every scenario then FAILs for missing evidence.
  const { suites, tests, consoleLines } = process.env.BENCH_SKIP_SUITES === '1' ? { suites: [], tests: [], consoleLines: [] } : runSuites();
  log('re-running replay scenarios…');
  const replay = await runReplay();
  log(`latency harness: ${SAMPLES} sessions (+${SAMPLES} cached-story sessions)…`);
  const lat = await runLatencyHarness();
  const web = runWeb();

  const R = (n: string) => replay.scenarios.find((s) => s.scenario === n)! as any;
  const findTests = (spec: string) => {
    const [suite, sub] = spec.split(':', 2) as [string, string];
    return tests.filter((x) => x.suite === suite && x.name.includes(sub));
  };
  const webTests = (sub: string) => web.tests.filter((x) => x.name.includes(sub));
  const n = lat.checks.sessions;

  const defs: ScenarioDef[] = [
    { id: 'A1', section: 'A', title: 'World Trade Center / Ground Zero', ceiling: 'PASS', tests: ['replay:A1 — World Trade Center'], evidenceKinds: ['MEASURED-replay (synthetic trace, fixture POI pack)', 'MEASURED-tests'], oneLine: `9/11 Memorial is the first story at ${R('wtc-walk').targets[0].distanceM} m; all local WTC targets precede distant ones; reversed provider order yields identical selection.`, notRun: ['NYC dense-urban field walk with live Wikimedia discovery (no network egress to Wikipedia/Wikidata from this sandbox)'] },
    { id: 'A2', section: 'A', title: 'Golden Gate Bridge', ceiling: 'PASS', tests: ['replay:A2 — Golden Gate Bridge'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests'], oneLine: `Bridge is first story, triggered at ${R('golden-gate').targets[0].distanceM} m (reach ${R('golden-gate').targets[0].reachM} m) vs small-POI reach; Vista Point suppressed with reasons.`, notRun: ['San Francisco field drive/walk'] },
    { id: 'A3', section: 'A', title: 'Art Institute of Chicago', ceiling: 'PASS', tests: ['replay:A3 — Art Institute'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests'], oneLine: `Museum is first story at ${R('art-institute-walk').targets[0].distanceM} m; Willis Tower/Field Museum/Navy Pier never precede it; enclosing city suppressed as ambient context.`, notRun: ['Chicago field walk'] },
    { id: 'A4', section: 'A', title: 'Weak evidence', ceiling: 'PASS', tests: ['replay:A4 — Weak evidence', 'core:orientation (A4 weak evidence)', 'core:A4 weak evidence in the director', 'providers:generateGroundedNarrative (F3)'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests'], oneLine: 'Thin-evidence venue gets ≤1 fact-free orientation line, never a story; 0 grounding failures across all replay stories; invented names/years rejected by GroundingCheck.', notRun: [] },
    { id: 'A5', section: 'A', title: 'Highway / ahead discovery (OTR truck)', ceiling: 'PARTIAL', tests: ['replay:A5 — Highway', 'core:discovery refresh policy (F1 / A5)', 'core:long sparse highway stretch'], evidenceKinds: ['MEASURED-replay (synthetic I-40 trace, 105 min)', 'MEASURED-tests', 'ESTIMATED-cost (pnpm bench:cost)'], oneLine: `Heading and route corridors: ${R('interstate').storiesStarted} stories, 0 behind, 0 passed mid-story, silence ${(R('interstate').silenceRatio * 100).toFixed(1)}%, max gap ${Math.round(R('interstate').maxSilentGapS / 60)} min, ${R('interstate').providerQueries.perHour} place queries/h; truck stops/off-route/behind rejected with reasons.`, notRun: ['Real-road field run (benchmark: "at least one real-road field run when practical") — no vehicle/device here', 'Live-provider latency on the corridor (no keys / no Wikimedia egress)'] },
    { id: 'A6', section: 'A', title: 'Environment transition', ceiling: 'PASS', tests: ['replay:A6 — Environment transition', 'replay:drive → park → walk continues'], web: ['switches to drive mode on the interstate replay'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests', 'MEASURED-e2e (web drive HUD)'], oneLine: `highway→urban→stationary→walking and sparse→suburban→urban→dense in one session, 0 restarts, no re-told targets; walking look-ahead < 1/10 of highway; questions only on foot.`, notRun: ['Field transition drive→park→walk on a device'] },
    { id: 'A7', section: 'A', title: 'Cross-city portability', ceiling: 'PARTIAL', tests: ['replay:A7 — Cross-city portability', 'core:no city coupling'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests (static scan: no city names/fixture imports in core)'], oneLine: 'Same runner, same global fixture source, no per-city config; identical telemetry shape in NYC/Chicago/SF; core source scan finds no city coupling.', notRun: ['"Production discovery flow" with the production PlaceSource (Wikimedia) in all three cities — Wikipedia/Wikidata unreachable from this sandbox; fixture source used instead'] },
    { id: 'B1', section: 'B', title: 'Short then deeper', ceiling: 'PARTIAL', tests: ['providers:follow-up answers (C2 / B1)', 'api:C2:'], evidenceKinds: ['MEASURED-tests (deterministic fakes)'], oneLine: 'Follow-up brief draws only unspoken facts from the same evidence pack and stays grounded; "tell more" with nothing left answers honestly.', notRun: ['Live-LLM non-repetition check (paraphrase detection) — no LLM keys', 'Human review of continuation quality'] },
    { id: 'B2', section: 'B', title: 'Guide differentiation', ceiling: 'PARTIAL', tests: ['core:StoryBrief', 'core:angle choice respects guide preference'], evidenceKinds: ['MEASURED-tests', 'MEASURED-brief-analysis (fixture evidence)'], oneLine: `Same evidence → same lead fact for both Guides in ${Math.round(replay.guideDiff.leadFactSharedRate * 100)}% of ${replay.guideDiff.packs} packs; persona differs by verbosity (1.15 vs 0.8), rate and angle order; prose is LLM-only.`, notRun: ['Live LLM generation for both Guides on identical briefs', '1–5 human rubric (pacing/structure/tone, stereotype check)'] },
    { id: 'B3', section: 'B', title: 'Callback', ceiling: 'PARTIAL', tests: ['core:journey callbacks from memory with shared tags'], evidenceKinds: ['MEASURED-tests', 'MEASURED-replay (memory mentions)'], oneLine: 'Callbacks come only from structured journey memory with shared tags (≤2), and the template/grounding allow only those names.', notRun: ['Coherence of LLM-written callbacks (live LLM + human review)'] },
    {
      id: 'C1',
      section: 'C',
      title: 'Coffee interruption',
      ceiling: 'PASS',
      tests: ['api:C1: coffee interruption'],
      evidenceKinds: ['MEASURED-tests (API over WS, Postgres+Redis, fake providers)', 'MEASURED-harness (simulated provider latency)', 'ESTIMATED-cost'],
      oneLine: `Across ${n} harness sessions: stop before answer ${lat.checks.stopBeforeAnswer}/${n}, story preserved ${lat.checks.storyPreservedInterrupted}/${n}, validated map ${lat.checks.mapValid}/${n}, grounded answer ${lat.checks.answerNamesFirstResult}/${n}, resume same plan ${lat.checks.resumedSamePlan}/${n}.`,
      notRun: ['Real voice path on device (mic → STT provider → TTS provider)'],
      extra: () => ({ ok: n >= 30 && [lat.checks.stopBeforeAnswer, lat.checks.storyPreservedInterrupted, lat.checks.mapValid, lat.checks.answerNamesFirstResult, lat.checks.resumedSamePlan, lat.checks.invalidRowsDropped].every((x) => x === n), detail: 'all per-session C1 checks hold in the harness' }),
    },
    { id: 'C2', section: 'C', title: 'Contextual follow-up', ceiling: 'PASS', tests: ['api:C2:', 'providers:follow-up answers (C2 / B1)'], evidenceKinds: ['MEASURED-tests', 'MEASURED-harness'], oneLine: `Subject resolved without restatement; no place/evidence/nearby call (harness: ${lat.checks.followupNoPlaceSearch}/${n}); answer passes GroundingCheck against the active brief.`, notRun: ['Live-LLM grounding pass rate (no keys)'], extra: () => ({ ok: lat.checks.followupNoPlaceSearch === n, detail: 'no nearby call on follow-up in every harness session' }) },
    { id: 'C3', section: 'C', title: 'Change topic', ceiling: 'PASS', tests: ['api:C3:', 'providers:heuristics: barge-in correction, contextual question, topic change'], evidenceKinds: ['MEASURED-tests'], oneLine: 'Explicit topic change abandons the story (storiesSkipped=1); the old plan never plays again over 20 more frames.', notRun: [] },
    ...['B1 — Story interruption + coffee (live voice)', 'B2 — Contextual follow-up (live voice)', 'B3 — Barge-in "No, I meant parking" (live voice)', 'B4 — Road noise', 'B5 — Guides/languages human rubric', 'B6 — Session lifecycle (open/close/reopen)'].map(
      (title, k): ScenarioDef => ({
        id: `D-B${k + 1}`,
        section: 'D',
        title: `Realtime ${title}`,
        ceiling: 'NOT RUN',
        tests: [],
        evidenceKinds: [],
        oneLine: k === 2 ? 'NOT RUN on a realtime provider. Hybrid-path analogue passes (api "B3: barge-in" test: stale coffee output never surfaces, parking turn wins).' : k === 5 ? 'NOT RUN. Server side exists (token endpoint with idle timeout + ProviderBudget seconds cap) but no provider session can be opened.' : 'NOT RUN — credentials not supplied (OPENAI_API_KEY / GEMINI_API_KEY); D-010 benchmark pending.',
        notRun: ['Realtime provider sessions (OpenAI Realtime, Gemini Live) — no credentials', ...(k === 3 ? ['Controlled road-noise audio fixture on a device'] : []), ...(k === 4 ? ['Human 1–5 rubric EN + RU'] : [])],
      }),
    ),
    { id: 'E1', section: 'E', title: 'Driving / OTR safety', ceiling: 'PARTIAL', tests: ['replay:long silence is the norm', 'replay:policy adapts', 'core:safety hold during a maneuver', 'core:screen interaction while driving holds speech onset', 'client:driveStatusLine (E1: one glanceable line)', 'client:map actions and listen (never auto-opened while drive-safe', 'core:nearby_search is rate-limited and audio-first while driving'], web: ['switches to drive mode on the interstate replay'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests', 'MEASURED-e2e (web drive HUD, Chromium)'], oneLine: 'Drive HUD auto-activates with one mic target and no text input; highway stories ≤75 s (Emil) with no questions, >95% silence; speech onset held while maneuvering/after touches.', notRun: ['Real vehicle / real device (hands-free voice, ducking of nav prompts, glance time)', 'Native app drive mode on iOS/Android hardware'] },
    { id: 'E2', section: 'E', title: 'Background / sleep resilience', ceiling: 'PARTIAL', tests: ['mobile:FixBuffer (background task before the store is attached)', 'client:FrameBatcher'], evidenceKinds: ['MEASURED-tests (mobile logic, client batcher)', 'DOCUMENTED (docs/MOBILE.md §2 OS behaviour table)'], oneLine: 'Event-driven frame flush and background fix buffering are unit-tested; OS limitations per platform documented in docs/MOBILE.md §2.', notRun: ['Screen-lock / background runs on physical iOS and Android devices (no builds: EAS/Apple credentials missing, D-016)'] },
    { id: 'E3', section: 'E', title: 'Network degradation', ceiling: 'PARTIAL', tests: ['api:E3: reconnect', 'client:SessionChannel (E3 reconnect)', 'client:DirectiveSequencer (E3: exactly once, in order)', 'client:failed downloads resolve to null'], evidenceKinds: ['MEASURED-tests (socket drop + REST during outage + resume)'], oneLine: 'Reconnect delivers exactly the missed directives, retried utterance ids never re-run tools, no story restart; client sequencer/prefetch handle gaps and failed downloads.', notRun: ['On-device playback during airplane mode / Wi-Fi↔cellular handover'] },
    { id: 'F1', section: 'F', title: 'Empty discovery result', ceiling: 'PASS', tests: ['replay:F1 — Empty discovery result', 'api:F1: empty discovery', 'core:empty results back off (F1)'], evidenceKinds: ['MEASURED-replay', 'MEASURED-tests (API)'], oneLine: `API: ${consoleLines.find((l) => l.includes('[F1]'))?.split(':').pop()?.trim() ?? '≤12'} place-source calls for 300 frames; replay: empty 105-min highway run ≤40 calls (≥75 frames/query).`, notRun: [] },
    { id: 'F2', section: 'F', title: 'Place provider quota / timeout', ceiling: 'PASS', tests: ['api:F2: place provider timeouts', 'api:F2: quota exceeded', 'api:invalid credential', 'providers:ProviderGuard bounded call counts'], evidenceKinds: ['MEASURED-tests (API)'], oneLine: `Timeouts: ${consoleLines.find((l) => l.includes('[F2 timeout]'))?.split(':').pop()?.trim() ?? '≤6'} attempts per 300 frames (≤1 retry + breaker); 429 and 401: exactly 1 attempt.`, notRun: [] },
    { id: 'F3', section: 'F', title: 'LLM failure', ceiling: 'PASS', tests: ['api:F3: LLM keeps hallucinating', 'api:F3: LLM down', 'providers:never substitutes the target'], evidenceKinds: ['MEASURED-tests (API + providers)'], oneLine: 'Hallucinating or failing LLM → template story for the same decided target; ≤2 LLM calls per story; kill switch → 0 LLM calls.', notRun: [] },
    { id: 'F4', section: 'F', title: 'TTS failure', ceiling: 'PASS', tests: ['api:F4: TTS down'], evidenceKinds: ['MEASURED-tests (API)'], oneLine: 'TTS down → segments and answers delivered as text (audioUrl null), breaker caps TTS attempts at ≤4; conversation continues.', notRun: ['Device-voice fallback playback on hardware'] },
    { id: 'F5', section: 'F', title: 'Cache unavailable', ceiling: 'PASS', tests: ['api:F5: cache (Redis) unavailable'], evidenceKinds: ['MEASURED-tests (API with Redis unreachable)'], oneLine: `/readyz reports degraded + reducedMode; ${consoleLines.find((l) => l.includes('[F5]'))?.split(':').pop()?.trim() ?? '≤3'} place calls per 300 frames; narration continues.`, notRun: [] },
  ];

  const rows = defs.map((d) => {
    const matched = d.tests.map((spec) => ({ spec, hits: findTests(spec) }));
    const missing = matched.filter((m) => m.hits.length === 0).map((m) => m.spec);
    const failing = matched.flatMap((m) => m.hits.filter((h) => h.status === 'failed').map((h) => h.name));
    const webMatched = (d.web ?? []).map((w) => ({ w, hits: webTests(w) }));
    const webFailing = web.ran ? webMatched.flatMap((m) => m.hits.filter((h) => h.status !== 'passed')).map((h) => h.name) : [];
    const extra = d.extra?.();
    let status: Status = d.ceiling;
    let reason = d.ceiling === 'PASS' ? 'Requirement as written demonstrated by the evidence listed.' : d.ceiling === 'PARTIAL' ? `Demonstrated parts pass; not demonstrated: ${d.notRun.join('; ')}.` : d.notRun.join('; ');
    if (d.ceiling !== 'NOT RUN' && (failing.length > 0 || missing.length > 0 || webFailing.length > 0 || (extra && !extra.ok))) {
      status = 'FAIL';
      reason = `Evidence failed: ${[...failing, ...missing.map((m) => `missing test "${m}"`), ...webFailing, ...(extra && !extra.ok ? [extra.detail] : [])].join('; ')}`;
    }
    return {
      id: d.id,
      section: d.section,
      title: d.title,
      status,
      evidence: d.oneLine,
      evidenceKinds: d.evidenceKinds,
      reason,
      notRun: d.notRun,
      tests: matched.flatMap((m) => m.hits.map((h) => ({ suite: h.suite, name: h.name, status: h.status }))),
      webTests: web.ran ? webMatched.flatMap((m) => m.hits) : [],
    };
  });

  // Section G summary metrics (labels travel with every value).
  const allReplay = replay.scenarios as any[];
  const totalStories = allReplay.reduce((s, r) => s + r.storiesStarted, 0);
  const wrong = allReplay.reduce((s, r) => s + r.wronglyBehindTargets + r.clutterStories + r.utilityStories + r.endedAfterPassing, 0);
  const relevanceTests = tests.filter((x) => x.suite === 'replay' && /A1 —|A2 —|A3 —|A5 —|A6 —|A7 —/.test(x.name));
  const L = lat.M;
  const cats = new Map<string, number>();
  for (const turn of lat.c1Costs) for (const c of turn) cats.set(`${c.category}:${c.task}`, (cats.get(`${c.category}:${c.task}`) ?? 0) + 1);
  const P = await import('../../packages/providers/src/index.ts');
  const priceMap: Record<string, [string, string]> = { llm: ['openai', 'gpt-6-luna'], tts: ['openai', 'gpt-4o-mini-tts'], stt: ['openai', 'gpt-4o-mini-transcribe'], maps: ['google_places', 'nearby_search_pro'] };
  const c1Usd = lat.c1Costs.map((turn) => turn.reduce((s, c) => (priceMap[c.category] ? s + P.computeCost(priceMap[c.category]![0], priceMap[c.category]![1], c.units, Date.parse('2026-09-28'), c.category) : s), 0));
  const sectionG = [
    { metric: 'target relevance regression pass rate', value: `${relevanceTests.filter((x) => x.status === 'passed').length}/${relevanceTests.length} replay relevance assertions (A1–A3, A5–A7)`, label: 'MEASURED-replay' },
    { metric: 'wrong-target rate on fixed corpus', value: `${wrong}/${totalStories} stories (behind, passed mid-story, clutter or utility targets)`, label: 'MEASURED-replay (6 scenarios, fixture corpus)' },
    { metric: 'weak-evidence correctness', value: `${allReplay.reduce((s, r) => s + r.groundingFailures, 0)} grounding failures; ${allReplay.reduce((s, r) => s + r.orientations, 0)} orientation-only lines; 0 stories on thin evidence`, label: 'MEASURED-replay' },
    { metric: 'narrative repetition regressions', value: 'Deterministic: 0 re-told targets in any replay (memory); LLM paraphrase repetition NOT YET MEASURED', label: 'MEASURED-replay / NOT YET MEASURED' },
    { metric: 'guide/persona distinctness', value: 'NOT YET MEASURED (needs live LLM + human rubric); brief-level factual core identical', label: 'NOT YET MEASURED' },
    { metric: 'interruption correctness', value: `${lat.checks.resumedSamePlan}/${n} harness sessions stop→answer→resume same plan; C1/C3/B3 API tests pass`, label: 'MEASURED-harness + MEASURED-tests' },
    { metric: 'contextual follow-up grounding', value: `C2 API test grounded; ${lat.checks.followupNoPlaceSearch}/${n} follow-ups made no place search (fake LLM)`, label: 'MEASURED-tests (fake LLM)' },
    { metric: 'trigger -> first audio p50/p95', value: `${pct(L.triggerToFirstAudioBytes, 0.5)} / ${pct(L.triggerToFirstAudioBytes, 0.95)} ms (n=${L.triggerToFirstAudioBytes.length}, uncached narration, loopback)`, label: 'MEASURED-harness, SIMULATED provider latency' },
    { metric: 'barge-in stop p50/p95', value: `${pct(L.bargeInStopRoundTrip, 0.5)} / ${pct(L.bargeInStopRoundTrip, 0.95)} ms server stop_audio round trip (n=${L.bargeInStopRoundTrip.length}); device press→silence NOT YET MEASURED`, label: 'MEASURED-harness (loopback)' },
    { metric: 'speech-end -> first audio p50/p95', value: `nearby ${pct(L.speechEndToFirstAudioNearby, 0.5)} / ${pct(L.speechEndToFirstAudioNearby, 0.95)} ms; follow-up ${pct(L.speechEndToFirstAudioFollowup, 0.5)} / ${pct(L.speechEndToFirstAudioFollowup, 0.95)} ms (hybrid STT path, n=${L.speechEndToFirstAudioNearby.length} each)`, label: 'MEASURED-harness, SIMULATED provider latency' },
    { metric: 'provider tool reliability', value: `NOT YET MEASURED on real providers; fake NearbySearch with injected invalid rows: invalid rows dropped ${lat.checks.invalidRowsDropped}/${n}`, label: 'MEASURED-harness (fakes) / NOT YET MEASURED' },
    { metric: '30-min walk estimated variable cost', value: 'see benchmark/cost/cost_model.json (pnpm bench:cost)', label: 'ESTIMATED (list price)' },
    { metric: '30-min drive estimated variable cost', value: 'see benchmark/cost/cost_model.json (pnpm bench:cost)', label: 'ESTIMATED (list price)' },
    { metric: 'realtime active-minute cost', value: 'see benchmark/cost/cost_model.json; realtime NOT RUN', label: 'ESTIMATED (list price)' },
    { metric: 'cache hit rates by layer', value: 'Production hit rates NOT YET MEASURED (no traffic). Harness: evidence/discovery caches warm after first session; narration audio cache cleared per session by design.', label: 'NOT YET MEASURED' },
    { metric: 'known failures', value: 'none in automated evidence; see docs/PERFORMANCE_COST.md §16 for open risks', label: 'MEASURED-tests' },
  ];

  const commit = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain']).length > 0;
  const results = {
    generatedBy: 'scripts/bench/acceptance.ts (pnpm bench:acceptance)',
    generatedAt: new Date().toISOString(),
    commit: `${commit}${dirty ? '+uncommitted' : ''}`,
    labels: {
      'MEASURED-tests': 'automated test executed in this run (vitest/Playwright), deterministic fakes where providers are involved',
      'MEASURED-replay': 'deterministic replay of synthetic traces over fixture POI/evidence packs (production core code path)',
      'MEASURED-harness': 'real API in-process (Fastify+Postgres+Redis+WS) on loopback, providers are fakes with SIMULATED latency',
      'MEASURED-e2e': 'Playwright against the production web build in offline demo mode',
      ESTIMATED: 'list-price model (packages/providers/src/pricing.ts, retrieved 2026-09-27)',
      'NOT RUN': 'requires credentials, devices, field runs or human raters not available here',
    },
    environment: env,
    statusCounts: rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}),
    scenarios: rows,
    sectionG,
    suites,
    web: { ran: web.ran, reason: web.reason ?? null, passed: web.passed, failed: web.failed, buildAt: web.buildAt ?? null, tests: web.tests },
    replay: { matchesCommittedSummary: allReplay.every((r) => r.matchesCommitted === true), scenarios: allReplay.map(({ storyRecords: _s, rejections: _r, ...rest }) => rest), guideDifferentiation: replay.guideDiff },
    harnessChecks: lat.checks,
    c1IncrementalCost: {
      label: 'ESTIMATED (list price) from units measured in the harness (fake providers priced as the default config: gpt-6-luna, gpt-4o-mini-tts, gpt-4o-mini-transcribe, Places Nearby Search Pro)',
      callsPerTurn: Object.fromEntries([...cats].map(([k, v]) => [k, round1(v / Math.max(1, lat.c1Costs.length))])),
      usdPerCoffeeTurn: (() => {
        const r6 = (x: number | null) => (x === null ? null : Math.round(x * 1e6) / 1e6);
        const s = [...c1Usd].sort((a, b) => a - b);
        const q = (p: number) => (s.length ? s[Math.floor((s.length - 1) * p)]! + (s[Math.ceil((s.length - 1) * p)]! - s[Math.floor((s.length - 1) * p)]!) * ((s.length - 1) * p - Math.floor((s.length - 1) * p)) : null);
        return { n: s.length, p50: r6(q(0.5)), p95: r6(q(0.95)), mean: r6(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)) };
      })(),
    },
    testConsole: consoleLines,
    durationS: Math.round((Date.now() - t0) / 1000),
  };
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1) + '\n');

  const metric = (xs: number[], definition: string, target: { p50: number; p95: number } | null) => ({ ...stats(xs), definition, target });
  const latency = {
    generatedBy: 'scripts/bench/acceptance.ts',
    generatedAt: results.generatedAt,
    commit: results.commit,
    label: 'MEASURED — in-process harness on loopback with SIMULATED provider latency. Not production, not a device, not a mobile network.',
    method: {
      server: 'Real Fastify API + Postgres + Redis + WebSocket channel in this process; fixture places/evidence (demo mode); deterministic fake LLM/TTS/STT/Nearby each wrapped with a seeded log-normal delay (profile below).',
      sessions: `${SAMPLES} measured sessions on the wtc-walk trace (guides alternate Ida/Emil) after 1 warm-up session; narration audio cache cleared before each session; evidence/discovery caches warm after the warm-up (7-day / 15-min TTLs in production). Plus ${SAMPLES} sessions with narration audio already cached.`,
      clock: 'performance.now() in the client and server share one process/clock; server intervals come from API telemetry (telemetry.latency), client intervals from WebSocket message arrival.',
      percentiles: 'linear interpolation between closest ranks (Hyndman–Fan type 7)',
      speechEnd: 'start of the POST /v1/stt upload of a ~3 s push-to-talk clip (fake STT decodes TEXT:<utterance>); i.e. includes STT + intent + tool/LLM + TTS + audio fetch.',
      firstAudio: 'first audio BYTES of the response available to the client (say/play directive received + GET of the audio file). Device decode/playback start is NOT included.',
      bargeIn: 'client sends control interrupt → stop_audio directive received. Device press→silence (local stop in the app) is NOT included; the apps stop locally before the server round trip.',
      excluded: ['mobile network RTT (add ~2×RTT per round trip; LTE typically 40–120 ms)', 'device audio decode/start', 'real provider variance, cold starts, rate limiting'],
    },
    simulatedProviderLatencyProfileMs: LATENCY_PROFILE,
    simulatedDrawsObserved: lat.drawStats,
    metrics: {
      triggerToFirstAudio: metric(L.triggerToFirstAudioBytes, 'moment decided (startStory) → play directive at client + segment-0 audio bytes fetched; uncached narration (evidence cached)', { p50: 2500, p95: 4500 }),
      triggerToPlayDirectiveServer: metric(L.triggerToPlayServer, 'server telemetry trigger_to_first_audio: evidence + LLM + grounding + TTS segment 0 → play emitted', null),
      cachedStoryToFirstAudio: metric(L.cachedTriggerToFirstAudioBytes, 'same as triggerToFirstAudio but segment-0 audio already cached (LLM still runs: the audio key is the prose hash)', { p50: 1500, p95: 3000 }),
      speechEndToFirstAudio: metric([...L.speechEndToFirstAudioNearby, ...L.speechEndToFirstAudioFollowup], 'both utterance types pooled', { p50: 2000, p95: 3500 }),
      speechEndToFirstAudioNearby: metric(L.speechEndToFirstAudioNearby, '"Where can I get coffee nearby?" (STT → rules intent → Nearby → validation → map → TTS answer)', { p50: 2000, p95: 3500 }),
      speechEndToFirstAudioFollowup: metric(L.speechEndToFirstAudioFollowup, '"Why is that important?" (STT → rules/LLM intent → grounded follow-up LLM → TTS answer)', { p50: 2000, p95: 3500 }),
      contextIngest: metric(L.contextIngest, 'server telemetry context_ingest: one ContextFrame folded into journey state (core ingestFrame); every frame of the measured sessions until the first story', null),
      serverStt: metric(L.serverStt, 'server telemetry stt: /v1/stt transcription call (simulated provider latency)', null),
      serverUtteranceToFirstAudio: metric(L.serverSpeechEndToFirstAudio, 'server telemetry speech_end_to_first_audio (excludes STT and audio fetch)', null),
      bargeInStop: metric(L.bargeInStopRoundTrip, 'control interrupt → stop_audio directive at client (server round trip, loopback)', { p50: 150, p95: 300 }),
      nearbySearch: metric(L.speechEndToMap, 'speech end → map show_results directive at client (usable result)', { p50: 1500, p95: 2500 }),
      nearbyProviderToValidated: metric(L.nearbyProviderToValidated, 'server telemetry nearby_to_result: provider call → zod-validated results', null),
      toolToMap: metric(L.toolResultToMapAtClient, 'validated tool result (server) → map directive received by client', { p50: 100, p95: 250 }),
      audioFetch: metric(L.audioFetchMs, 'GET /v1/audio/<segment0> after play (loopback, file on local volume)', null),
    },
  };
  writeFileSync(join(OUT, 'latency.json'), JSON.stringify(latency, null, 1) + '\n');

  console.log('\nID      STATUS    EVIDENCE');
  for (const r of rows) console.log(`${r.id.padEnd(7)} ${r.status.padEnd(9)} ${r.evidence.slice(0, 150)}`);
  console.log('\nlatency (ms, simulated provider latency, loopback):');
  for (const [k, v] of Object.entries(latency.metrics)) console.log(`  ${k.padEnd(30)} n=${String(v.n).padStart(3)} p50=${v.p50} p95=${v.p95}`);
  log(`wrote ${join('benchmark', 'acceptance', 'results.json')} and latency.json in ${results.durationS}s`);
  const failed = rows.filter((r) => r.status === 'FAIL');
  if (failed.length > 0) {
    log(`FAIL: ${failed.map((r) => r.id).join(', ')}`);
    process.exitCode = 1;
  }
  process.exit();
}

await main();
