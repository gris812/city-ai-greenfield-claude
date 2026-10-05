/**
 * Live provider benchmark (D-010 / docs/PERFORMANCE_COST.md §6). Runs with ZERO keys: every
 * provider without a key is reported as skipped. `--fake` additionally runs the deterministic
 * fakes to validate the harness end-to-end (clearly labelled, never mixed into real results).
 *
 *   pnpm bench:providers            # real providers whose keys are set
 *   pnpm bench:providers --fake     # + fakes (harness self-test)
 *
 * Measures: story generation latency / tokens / cost / grounding pass rate on a fixed
 * StoryBrief corpus (fixtures/evidence, both Guides, EN + RU), TTS time-to-first-byte and
 * $/min, STT latency on a synthesized utterance, realtime token issuance latency, and verifies
 * configured model ids against the provider model lists (never done at request time).
 * Output: benchmark/providers/<timestamp>.json. No secrets are written.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CostRecord, EvidencePack, GuideProfile, StoryBrief } from '../../packages/core/src/index.ts';
import { EMIL, IDA, checkGrounding, wordCount } from '../../packages/core/src/index.ts';
import {
  FakeRealtimeTokenIssuer,
  FakeSpeechRecognizer,
  FakeSpeechSynthesizer,
  FakeTextGenerator,
  PRICES_RETRIEVED_AT,
  ProviderBudget,
  ProviderGuard,
  ProviderRouter,
  buildProviderSet,
  computeCost,
  describeConfig,
  generateGroundedNarrative,
  geminiListModels,
  openaiListModels,
  providerConfigFromEnv,
  type ProviderSet,
  type SpeechSynthesizer,
  type TextGenerator,
} from '../../packages/providers/src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const withFakes = process.argv.includes('--fake');
const perProviderStories = Number(process.env.BENCH_STORIES ?? 8);

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]! * 10) / 10;
};

function corpus(): StoryBrief[] {
  const dir = join(ROOT, 'fixtures', 'evidence');
  const packs = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as EvidencePack[])
    .filter((p) => !p.thin && p.facts.length >= 3)
    .slice(0, Math.max(1, Math.ceil(perProviderStories / 4)));
  const briefs: StoryBrief[] = [];
  for (const p of packs)
    for (const guide of [IDA, EMIL])
      for (const locale of ['en-US', 'ru']) {
        briefs.push({
          id: `bench_${p.placeId}_${guide.id}_${locale}`,
          placeId: p.placeId,
          placeName: p.placeName,
          placeKind: 'landmark',
          angle: 'origin',
          mode: 'short',
          facts: p.facts.slice(0, 4),
          durationBudgetS: 45,
          maxWords: 110,
          guideId: guide.id,
          locale,
          regime: 'walking',
          spatialCue: locale === 'ru' ? 'впереди слева, примерно в 300 метрах' : 'ahead on your left, about 300 metres',
          journeyCallbacks: [],
          allowQuestionsToUser: false,
        });
      }
  return briefs.slice(0, perProviderStories);
}

async function main() {
  const cfg = providerConfigFromEnv({ ...process.env, NODE_ENV: 'production', DEMO_MODE: '0', ALLOW_FAKE_PROVIDERS: '0' });
  const real = buildProviderSet(cfg);
  const costs: CostRecord[] = [];
  const guard = new ProviderGuard({ sink: { record: (r) => costs.push(r) }, budget: new ProviderBudget({ usdPerSession: 5, perSession: { llm: 500, tts: 500, stt: 100, realtime: 20 } }) });
  const keys = { openai: !!cfg.keys.openai, gemini: !!cfg.keys.gemini, anthropic: !!cfg.keys.anthropic, googleMaps: !!cfg.keys.googleMaps };
  const skipped = Object.entries(keys)
    .filter(([, v]) => !v)
    .map(([k]) => `${k}: no key (${k === 'openai' ? 'OPENAI_API_KEY' : k === 'gemini' ? 'GEMINI_API_KEY' : k === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GOOGLE_MAPS_SERVER_KEY'})`);
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    pricesRetrievedAt: PRICES_RETRIEVED_AT,
    keysPresent: keys,
    configured: describeConfig(cfg),
    skipped,
    fakesIncluded: withFakes,
    note: 'Latencies are from this machine/network; costs are list-price estimates (pricing.ts), not invoices.',
  };

  // Model id verification (research found conflicting model names) — list endpoints only.
  const modelCheck: Record<string, unknown> = {};
  if (cfg.keys.openai) {
    try {
      const ids = await openaiListModels(cfg.keys.openai);
      modelCheck.openai = Object.fromEntries(['openaiStory', 'openaiIntent', 'openaiTts', 'openaiStt', 'openaiRealtime'].map((k) => [k, { id: (cfg.models as Record<string, string>)[k], available: ids.includes((cfg.models as Record<string, string>)[k]!) }]));
    } catch (e) {
      modelCheck.openai = { error: (e as Error).message.slice(0, 200) };
    }
  }
  if (cfg.keys.gemini) {
    try {
      const ids = await geminiListModels(cfg.keys.gemini);
      modelCheck.gemini = Object.fromEntries(['geminiStory', 'geminiTts', 'geminiStt', 'geminiLive'].map((k) => [k, { id: (cfg.models as Record<string, string>)[k], available: ids.includes((cfg.models as Record<string, string>)[k]!) }]));
    } catch (e) {
      modelCheck.gemini = { error: (e as Error).message.slice(0, 200) };
    }
  }
  report.modelCheck = modelCheck;

  const sets: Array<{ label: string; set: ProviderSet }> = [{ label: 'real', set: real }];
  if (withFakes) sets.push({ label: 'fake', set: { ...real, story: [new FakeTextGenerator({ latencyMs: 20 })], tts: [new FakeSpeechSynthesizer({ latencyMs: 30 })], stt: [new FakeSpeechRecognizer()], realtime: [new FakeRealtimeTokenIssuer()] } });

  const briefs = corpus();
  const story: unknown[] = [];
  const tts: unknown[] = [];
  const stt: unknown[] = [];
  const realtime: unknown[] = [];

  for (const { label, set } of sets) {
    // ── story generation (each provider separately, no fallback mixing)
    for (const gen of set.story.filter((g) => (label === 'fake') === !!g.fake)) {
      const router = new ProviderRouter({ ...set, story: [gen as TextGenerator] }, guard);
      const lat: number[] = [];
      let grounded = 0;
      let llmAccepted = 0;
      let retries = 0;
      let inTok = 0;
      let outTok = 0;
      const samples: unknown[] = [];
      for (const b of briefs) {
        const guide: GuideProfile = b.guideId === EMIL.id ? EMIL : IDA;
        const t0 = performance.now();
        const r = await generateGroundedNarrative(b, guide, router.generator('story', { sessionId: 'bench' }));
        lat.push(performance.now() - t0);
        if (checkGrounding(r.text, b, { allow: [guide.name] }).ok) grounded++;
        if (r.generatedBy.kind === 'llm') llmAccepted++;
        if (r.attempts > 1) retries++;
        inTok += r.usage.inputTokens;
        outTok += r.usage.outputTokens;
        if (samples.length < 4) samples.push({ brief: b.id, generatedBy: r.generatedBy, fallback: r.fallbackReason, words: wordCount(r.text), text: r.text });
      }
      const usd = computeCost(gen.name, gen.model, { inputTokens: inTok, outputTokens: outTok }, Date.now(), 'llm');
      story.push({ set: label, provider: gen.name, model: gen.model, n: briefs.length, p50Ms: pct(lat, 0.5), p95Ms: pct(lat, 0.95), llmAcceptedRate: llmAccepted / briefs.length, finalGroundedRate: grounded / briefs.length, retryRate: retries / briefs.length, avgInputTokens: Math.round(inTok / briefs.length), avgOutputTokens: Math.round(outTok / briefs.length), usdPerStory: usd / briefs.length, samples });
    }
    // ── TTS
    const texts = ['Ahead on your left, about 300 metres: the old harbour lighthouse.', 'Впереди слева, примерно в трёхстах метрах, старый маяк.', 'The bridge opened to traffic after four years of construction, and its towers still mark the skyline.'];
    let sttAudio: { bytes: Uint8Array; mime: string; text: string } | null = null;
    for (const p of set.tts.filter((x) => (label === 'fake') === !!x.fake)) {
      const router = new ProviderRouter({ ...set, tts: [p as SpeechSynthesizer] }, guard);
      const ttfb: number[] = [];
      const total: number[] = [];
      let audioS = 0;
      let chars = 0;
      let errors = 0;
      for (const guide of [IDA, EMIL])
        for (const text of texts) {
          const t0 = performance.now();
          try {
            const { result } = await router.synthesize({ text, locale: /[а-я]/i.test(text) ? 'ru' : 'en', speakingRate: guide.voice.speakingRate }, guide, { sessionId: 'bench' });
            total.push(performance.now() - t0);
            if (result.ttfbMs !== undefined) ttfb.push(result.ttfbMs);
            audioS += result.durationMs / 1000;
            chars += text.length;
            if (!sttAudio && !/[а-я]/i.test(text)) sttAudio = { bytes: result.audio, mime: result.mime, text };
          } catch (e) {
            errors++;
            void e;
          }
        }
      const usd = computeCost(p.name, p.model, { characters: chars, audioSeconds: audioS }, Date.now(), 'tts');
      tts.push({ set: label, provider: p.name, model: p.model, n: total.length, errors, ttfbP50Ms: pct(ttfb, 0.5), ttfbP95Ms: pct(ttfb, 0.95), totalP50Ms: pct(total, 0.5), usdPerAudioMinute: audioS > 0 ? usd / (audioS / 60) : null });
    }
    // ── STT on a synthesized utterance
    for (const p of set.stt.filter((x) => (label === 'fake') === !!x.fake)) {
      const router = new ProviderRouter({ ...set, stt: [p] }, guard);
      const audio = label === 'fake' ? { bytes: new TextEncoder().encode('TEXT:Where can I get coffee nearby?'), mime: 'audio/webm', text: 'Where can I get coffee nearby?' } : sttAudio;
      if (!audio) {
        stt.push({ set: label, provider: p.name, skipped: 'no TTS audio available to transcribe' });
        continue;
      }
      const lat: number[] = [];
      let text = '';
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        try {
          text = (await router.transcribe({ audio: audio.bytes, mime: audio.mime, locale: 'en' }, { sessionId: 'bench' })).result.text;
          lat.push(performance.now() - t0);
        } catch {
          /* counted by n */
        }
      }
      stt.push({ set: label, provider: p.name, model: p.model, n: lat.length, p50Ms: pct(lat, 0.5), reference: audio.text, transcript: text });
    }
    // ── Realtime token issuance (connect-to-ready needs a WebRTC/WS client: measured in the apps)
    for (const p of set.realtime.filter((x) => (label === 'fake') === !!x.fake)) {
      const router = new ProviderRouter({ ...set, realtime: [p] }, guard);
      const t0 = performance.now();
      try {
        const { result } = await router.issueRealtime({ instructions: 'benchmark', voice: 'alloy', locale: 'en', maxSeconds: 60, idleTimeoutS: 20 }, { sessionId: 'bench' });
        realtime.push({ set: label, provider: p.name, model: result.model, tokenIssueMs: Math.round(performance.now() - t0), connect: 'not measured here (client-side WebRTC/WebSocket)' });
      } catch (e) {
        realtime.push({ set: label, provider: p.name, error: (e as Error).message.slice(0, 200) });
      }
    }
  }

  Object.assign(report, { story, tts, stt, realtime, totalEstimatedUsd: costs.reduce((s, c) => s + c.costUsd, 0), calls: costs.length, finishedAt: new Date().toISOString() });
  const outDir = join(ROOT, 'benchmark', 'providers');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(`providers benchmark → ${file}`);
  console.log(`keys: ${JSON.stringify(keys)}`);
  if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);
  console.log(`story runs: ${story.length}, tts runs: ${tts.length}, stt runs: ${stt.length}, realtime runs: ${realtime.length}`);
}

await main();
