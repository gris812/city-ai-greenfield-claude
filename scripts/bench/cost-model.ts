/**
 * Deterministic per-session variable-cost model (docs/PERFORMANCE_COST.md §7–§10).
 *
 *   pnpm bench:cost      → benchmark/cost/cost_model.json + cost_model.csv
 *                           + truck_driver_month.csv + unit_economics.csv
 *
 * Everything here is ESTIMATED from list prices (packages/providers/src/pricing.ts, retrieved
 * 2026-09-27; SKUs not in the runtime price table are read from
 * benchmark/research/provider_pricing.json with an explicit reference). Nothing is a bill.
 *
 * Call counts are MEASURED from deterministic replays of the production core (the same
 * runScenario the acceptance suite uses), including trace slices for pure urban driving.
 * LLM input tokens come from the real prompt builders (storySystemPrompt/storyPrompt/
 * followUpPrompt/intent prompts) applied to the replayed briefs. Output length, retry rate,
 * question mix, audio bitrate and usage patterns are explicit ASSUMPTIONS (see `assumptions`).
 * Revenue/pricing values are HYPOTHESES from docs/research/MONETIZATION.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../packages/core/src/index.ts';
import * as P from '../../packages/providers/src/index.ts';
import { FixtureEvidence, FixturePlaceSource, loadTrace, runScenario, SCENARIOS, type Scenario, type TraceFile } from '../../packages/replay/src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'benchmark', 'cost');
/** Price evaluation date: after the Gemini 2027-01-01 promo end (conservative, PROVIDER_PRICING.md). */
const PRICE_AT = Date.parse('2027-01-01T00:00:00Z');
const PRICE_AT_LABEL = '2027-01-01 (post-promo list prices; everything else as retrieved 2026-09-27)';
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ───────────────────────────────────────────── assumptions (explicit, all ESTIMATED)

export const A = {
  charsPerToken: 4, // same heuristic the fakes and PROVIDER_PRICING.md use (EN)
  tokensPerWordOut: 1.35, // EN prose
  llmFillOfMaxWords: 0.85, // an LLM story lands near its word budget (template output is shorter)
  groundingRetryRate: 0.1, // share of LLM stories needing the one constrained retry (unmeasured: no LLM keys)
  followupFillOfMaxWords: 0.85,
  nearbyAnswerWords: 28, // "The closest is X, about 300 feet to the north. Also nearby: A and B. They're on the map."
  questionAudioS: 3, // push-to-talk clip length per question (STT billing)
  audioKbps: 64, // mp3 narration bitrate for storage/egress
  egressUsdPerGB: 0.01, // VPS overage-class price (assumption; most VPS plans include multi-TB)
  webMapLoadUsd: 7 / 1000, // Dynamic Maps per load (WebApp only; native Maps SDK is free)
  realtime: { userShareOfActiveMinute: 0.3, assistantShareOfActiveMinute: 0.4, turnsPer5Min: 10 },
  truck: { hoursPerDay: 8, daysPerMonth: 22, questionsPerHour: 1, nearbyPerHour: 0.25 },
  storeFee: 0.15, // Apple Small Business / Google Play subscriptions (MONETIZATION.md §1)
};

// ───────────────────────────────────────────── price helpers

type Unit = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; characters?: number; audioSeconds?: number; requests?: number };
interface Sku {
  label: string;
  cost: (u: Unit) => number;
  ref: string;
}
const pricingRows = JSON.parse(readFileSync(join(ROOT, 'benchmark', 'research', 'provider_pricing.json'), 'utf8')) as Array<{ provider: string; product: string; sku: string; unit: string; priceUsd: number; sourceUrl?: string; retrievedAt?: string }>;
function jsonRow(product: string, sku?: string) {
  const r = pricingRows.find((x) => x.product === product && (sku === undefined || x.sku === sku));
  if (!r) throw new Error(`price row missing: ${product} / ${sku}`);
  return r;
}
const table = (provider: string, model: string, category: 'llm' | 'tts' | 'stt' | 'maps'): Sku => {
  if (!P.priceFor(provider, model)) throw new Error(`not in pricing.ts: ${provider}:${model}`);
  return { label: `${provider}:${model}`, cost: (u) => P.computeCost(provider, model, u, PRICE_AT, category), ref: `pricing.ts ${provider}:${model}` };
};
const perKChars = (product: string, sku: string): Sku => {
  const r = jsonRow(product, sku);
  const per = r.unit.includes('1M') ? r.priceUsd / 1e6 : r.priceUsd / 1e3;
  return { label: product, cost: (u) => (u.characters ?? 0) * per, ref: `provider_pricing.json "${product}" ${r.priceUsd} ${r.unit} (${r.retrievedAt ?? ''})` };
};
const free = (label: string): Sku => ({ label, cost: () => 0, ref: 'free (no per-call price)' });

interface Mix {
  id: string;
  label: string;
  story: Sku;
  intent: Sku;
  tts: Sku;
  stt: Sku;
  nearby: Sku;
  discovery: Sku;
}
const NEARBY = table('google_places', 'nearby_search_pro', 'maps');
export const MIXES: Mix[] = [
  { id: 'economy', label: 'Cheapest viable: gpt-6-luna + OpenAI tts-1 + on-device STT + Wikimedia discovery', story: table('openai', 'gpt-6-luna', 'llm'), intent: table('openai', 'gpt-6-luna', 'llm'), tts: table('openai', 'tts-1', 'tts'), stt: free('on-device STT'), nearby: NEARBY, discovery: free('Wikimedia (free, rate-limited)') },
  { id: 'default', label: 'Configured default: gpt-6-luna + gpt-4o-mini-tts + gpt-4o-mini-transcribe + Wikimedia discovery', story: table('openai', 'gpt-6-luna', 'llm'), intent: table('openai', 'gpt-6-luna', 'llm'), tts: table('openai', 'gpt-4o-mini-tts', 'tts'), stt: table('openai', 'gpt-4o-mini-transcribe', 'stt'), nearby: NEARBY, discovery: free('Wikimedia (free, rate-limited)') },
  { id: 'gemini2027', label: 'Gemini stack at 2027 prices: gemini-3.1-flash-lite + gemini-3.8-flash-lite-tts + gemini-3.5-transcribe', story: table('gemini', 'gemini-3.1-flash-lite', 'llm'), intent: table('gemini', 'gemini-3.1-flash-lite', 'llm'), tts: table('gemini', 'gemini-3.8-flash-lite-tts', 'tts'), stt: table('gemini', 'gemini-3.5-transcribe', 'stt'), nearby: NEARBY, discovery: free('Wikimedia (free, rate-limited)') },
  { id: 'premium', label: 'Premium voice: Claude Sonnet 5 prose + ElevenLabs Flash TTS + gpt-4o-transcribe', story: table('anthropic', 'claude-sonnet-5', 'llm'), intent: table('openai', 'gpt-6-luna', 'llm'), tts: perKChars('TTS Flash/Turbo', 'characters (PAYG / overage)'), stt: table('openai', 'gpt-4o-transcribe', 'stt'), nearby: NEARBY, discovery: free('Wikimedia (free, rate-limited)') },
  { id: 'wavenet_hypothetical', label: 'NOT IMPLEMENTED (no adapter): default mix with Google Cloud TTS Standard/WaveNet ($4/1M chars) — sensitivity only', story: table('openai', 'gpt-6-luna', 'llm'), intent: table('openai', 'gpt-6-luna', 'llm'), tts: perKChars('Cloud Text-to-Speech Standard / WaveNet', 'characters'), stt: table('openai', 'gpt-4o-mini-transcribe', 'stt'), nearby: NEARBY, discovery: free('Wikimedia (free, rate-limited)') },
  { id: 'places_discovery', label: 'RISK VARIANT: default mix but automatic discovery + density probes via Google Nearby Search Pro', story: table('openai', 'gpt-6-luna', 'llm'), intent: table('openai', 'gpt-6-luna', 'llm'), tts: table('openai', 'gpt-4o-mini-tts', 'tts'), stt: table('openai', 'gpt-4o-mini-transcribe', 'stt'), nearby: NEARBY, discovery: NEARBY },
];
const REALTIME = [
  { id: 'openai:gpt-realtime-2.1-mini', cachedInputPerMAudioTok: 0.3 },
  { id: 'gemini:gemini-3.8-live', cachedInputPerMAudioTok: 0 },
  { id: 'openai:gpt-realtime-2.1', cachedInputPerMAudioTok: 0.4 },
];

// ───────────────────────────────────────────── replay-derived rates

interface Rates {
  source: string;
  hours: number;
  stories: number;
  orientations: number;
  discoveryQueries: number;
  densityProbes: number;
  wikimediaHttpRequests: number;
  storyTokensIn: number[]; // per story, with production prompt builders
  storyTokensInNoPayload: number[];
  storyMaxWords: number[];
  orientationWords: number[];
  charsPerWord: number;
  regimes: string[];
}

class CountingSource extends FixturePlaceSource {
  http = 0;
  override querySync(q: core.DiscoveryQuery) {
    this.http += P.coverageCircles(q).length + 1; // geosearch circles + one Wikidata SPARQL batch
    return super.querySync(q);
  }
}

function slice(trace: TraceFile, fromS: number, toS: number): TraceFile {
  const t0 = trace.fixes[0]!.t;
  const fixes = trace.fixes.filter((f) => f.t - t0 >= fromS * 1000 && f.t - t0 <= toS * 1000);
  return { ...trace, name: `${trace.name}[${fromS}-${toS}s]`, durationS: toS - fromS, fixes, route: null };
}

async function rates(label: string, runs: Array<{ sc: Scenario; trace?: TraceFile }>): Promise<Rates> {
  const evidence = new FixtureEvidence();
  const out: Rates = { source: label, hours: 0, stories: 0, orientations: 0, discoveryQueries: 0, densityProbes: 0, wikimediaHttpRequests: 0, storyTokensIn: [], storyTokensInNoPayload: [], storyMaxWords: [], orientationWords: [], charsPerWord: 0, regimes: [] };
  let chars = 0;
  let words = 0;
  for (const { sc, trace } of runs) {
    const src = new CountingSource();
    const r = await runScenario(sc, { source: src, evidence, ...(trace ? { trace } : {}) });
    const s = r.summary;
    out.hours += s.durationS / 3600;
    out.stories += s.storiesStarted;
    out.orientations += s.orientations;
    out.discoveryQueries += s.providerQueries.discovery;
    out.densityProbes += s.providerQueries.densityProbe;
    out.wikimediaHttpRequests += src.http;
    for (const x of s.regimeSequence) if (!out.regimes.includes(x)) out.regimes.push(x);
    for (const st of r.stories) {
      chars += st.text.length;
      words += st.words;
      if (st.kind === 'orientation') {
        out.orientationWords.push(st.words);
        continue;
      }
      const pack = evidence.get(st.placeId)!;
      const brief: core.StoryBrief = {
        id: `cost_${st.placeId}`,
        placeId: st.placeId,
        placeName: pack.placeName,
        placeKind: st.placeKind as core.PlaceKind,
        angle: st.angle as core.StoryAngle,
        mode: st.mode as core.StoryMode,
        facts: core.selectFacts(pack, st.angle as core.StoryAngle, st.maxWords!),
        durationBudgetS: st.durationBudgetS!,
        maxWords: st.maxWords!,
        guideId: sc.guide.id,
        locale: sc.locale,
        regime: st.regime,
        spatialCue: st.spatialCue ?? null,
        journeyCallbacks: [],
        allowQuestionsToUser: st.allowQuestionsToUser ?? false,
      };
      const sys = P.storySystemPrompt(sc.guide, sc.locale);
      const prompt = P.storyPrompt(brief);
      const noPayload = prompt.replace(/```json[\s\S]*```/, '');
      out.storyTokensIn.push(Math.ceil((sys.length + prompt.length) / A.charsPerToken));
      out.storyTokensInNoPayload.push(Math.ceil((sys.length + noPayload.length) / A.charsPerToken));
      out.storyMaxWords.push(st.maxWords!);
    }
  }
  out.charsPerWord = chars / Math.max(1, words);
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ───────────────────────────────────────────── per-session cost

interface Usage {
  hours: number;
  stories: number;
  orientations: number;
  placeQueries: number;
  evidenceLookups: number;
  storyTokensIn: number;
  storyMaxWords: number;
  orientationWords: number;
  charsPerWord: number;
  followups: number;
  llmIntentCalls: number;
  nearby: number;
  realtimeMinutes: number;
  followupMaxWords: number;
}

const COMPONENTS = ['maps', 'places_discovery', 'place_details', 'routes', 'evidence', 'llm', 'tts', 'realtime_stt', 'storage_egress', 'other'] as const;
type Component = (typeof COMPONENTS)[number];

function sessionCost(u: Usage, mix: Mix, cacheHit: number, realtimeId = 'openai:gpt-realtime-2.1-mini') {
  const c: Record<Component, number> = { maps: 0, places_discovery: 0, place_details: 0, routes: 0, evidence: 0, llm: 0, tts: 0, realtime_stt: 0, storage_egress: 0, other: 0 };
  const miss = 1 - cacheHit;
  // discovery + density probes (automatic)
  c.places_discovery = mix.discovery.cost({ requests: 1 }) * u.placeQueries;
  // LLM: stories (+ constrained retry: prompt + previous draft again), shared-cache hits skip generation
  const outWords = A.llmFillOfMaxWords * u.storyMaxWords;
  const outTok = outWords * A.tokensPerWordOut;
  const perStory = mix.story.cost({ inputTokens: u.storyTokensIn, outputTokens: outTok, requests: 1 }) + A.groundingRetryRate * mix.story.cost({ inputTokens: u.storyTokensIn + outTok, outputTokens: outTok, requests: 1 });
  const fuWords = A.followupFillOfMaxWords * u.followupMaxWords;
  const fuIn = FOLLOWUP_BASE_TOKENS;
  const perFollowup = mix.story.cost({ inputTokens: fuIn, outputTokens: fuWords * A.tokensPerWordOut, requests: 1 });
  const perIntent = mix.intent.cost({ inputTokens: INTENT_TOKENS_IN, outputTokens: 40, requests: 1 });
  c.llm = u.stories * perStory * miss + u.followups * perFollowup + u.llmIntentCalls * perIntent;
  // TTS: narration (story + orientation) is cacheable; answers are not
  const ttsFor = (words: number) => mix.tts.cost({ characters: Math.round(words * u.charsPerWord), audioSeconds: words / 2.4, requests: 1 });
  c.tts = (u.stories * ttsFor(outWords) + u.orientations * ttsFor(u.orientationWords)) * miss + u.followups * ttsFor(fuWords) + u.nearby * ttsFor(A.nearbyAnswerWords);
  // STT per question + realtime minutes
  const questions = u.followups + u.nearby;
  c.realtime_stt = questions * mix.stt.cost({ audioSeconds: A.questionAudioS, requests: 1 });
  if (u.realtimeMinutes > 0) c.realtime_stt += realtimeCost(realtimeId, u.realtimeMinutes);
  // explicit NearbySearch tool (a Places call, reported in its own column)
  const nearbyUsd = u.nearby * NEARBY.cost({ requests: 1 });
  // storage/egress: audio bytes delivered
  const spokenMin = (u.stories * outWords + u.orientations * u.orientationWords + u.followups * fuWords + u.nearby * A.nearbyAnswerWords) / 2.4 / 60;
  c.storage_egress = ((spokenMin * 60 * A.audioKbps * 1000) / 8 / 1e9) * A.egressUsdPerGB;
  const total = Object.values(c).reduce((a, b) => a + b, 0) + nearbyUsd;
  return { components: { ...c, nearby_search: nearbyUsd }, total, spokenMinutes: spokenMin };
}

function realtimeCost(id: string, minutes: number): number {
  const [provider, model] = id.split(':') as [string, string];
  const user = minutes * A.realtime.userShareOfActiveMinute * 60;
  const asst = minutes * A.realtime.assistantShareOfActiveMinute * 60;
  let usd = P.realtimeCost(provider, model, user, asst);
  // OpenAI Realtime re-bills conversation history as cached audio input on every turn.
  const rt = REALTIME.find((x) => x.id === id)!;
  if (rt.cachedInputPerMAudioTok > 0) {
    const turns = Math.round((A.realtime.turnsPer5Min * minutes) / 5);
    const tokPerMin = 600 * A.realtime.userShareOfActiveMinute + 1200 * A.realtime.assistantShareOfActiveMinute;
    let hist = 0;
    for (let k = 1; k <= turns; k++) hist += (tokPerMin * minutes * k) / turns;
    usd += (hist * rt.cachedInputPerMAudioTok) / 1e6;
  }
  return usd;
}

const INTENT_TOKENS_IN = Math.ceil((P.intentSystemPrompt().length + P.intentPrompt('Is there somewhere to sit down around here?', 'en-US', { activeSubject: 'National September 11 Memorial & Museum', previousIntent: null }).length) / A.charsPerToken);
/** Follow-up prompt size (system + followUpPrompt with ≤3 facts), computed once in main() from a real brief. */
let FOLLOWUP_BASE_TOKENS = 0;

// ───────────────────────────────────────────── main

async function main() {
  mkdirSync(OUT, { recursive: true });
  const S = (n: string) => SCENARIOS.find((s) => s.name === n)!;
  // Follow-up prompt size from a real brief (walking budget, 3 facts max).
  {
    const ev = new FixtureEvidence();
    const pack = ev.get('fx:nyc:911-memorial')!;
    const base: core.StoryBrief = { id: 'b', placeId: pack.placeId, placeName: pack.placeName, placeKind: 'memorial', angle: 'origin', mode: 'full', facts: core.selectFacts(pack, 'origin', 300), durationBudgetS: 120, maxWords: 300, guideId: 'ida', locale: 'en-US', regime: 'walking', spatialCue: null, journeyCallbacks: [], allowQuestionsToUser: true };
    const fb = P.followUpBrief(base, pack, 'Why is that important?', 'ask_question', new Set(base.facts.slice(0, 2).map((f) => f.id)), 70);
    FOLLOWUP_BASE_TOKENS = Math.ceil((P.storySystemPrompt(core.IDA, 'en-US').length + P.followUpPrompt(fb, 'Why is that important?').length) / A.charsPerToken);
  }
  const gg = loadTrace('golden-gate-drive-walk');
  const tr = loadTrace('highway-to-downtown-walk');
  const R = {
    walk: await rates('replay: wtc-walk + art-institute-walk (dense walking/stationary)', [{ sc: S('wtc-walk') }, { sc: S('art-institute-walk') }]),
    urban: await rates('replay slices: golden-gate 0–565 s + transition 992–1826 s (urban driving only)', [
      { sc: S('golden-gate'), trace: slice(gg, 0, 565) },
      { sc: S('transition'), trace: slice(tr, 992, 1826) },
    ]),
    highway: await rates('replay: interstate (I-40, heading corridor, 105 min)', [{ sc: S('interstate') }]),
    highwayRouted: await rates('replay: interstate-routed (I-40, route corridor)', [{ sc: S('interstate-routed') }]),
    transition: await rates('replay: transition (highway→downtown→walk)', [{ sc: S('transition') }]),
  };
  const per = (r: Rates): Record<string, unknown> => ({
    hours: r4(r.hours),
    storiesPerHour: r2(r.stories / r.hours),
    orientationsPerHour: r2(r.orientations / r.hours),
    discoveryPerHour: r2(r.discoveryQueries / r.hours),
    densityProbesPerHour: r2(r.densityProbes / r.hours),
    placeQueriesPerHour: r2((r.discoveryQueries + r.densityProbes) / r.hours),
    wikimediaHttpPerHour: r2(r.wikimediaHttpRequests / r.hours),
    meanStoryTokensIn: Math.round(mean(r.storyTokensIn)),
    meanStoryTokensInWithoutJsonPayload: Math.round(mean(r.storyTokensInNoPayload)),
    meanStoryMaxWords: Math.round(mean(r.storyMaxWords)),
    meanOrientationWords: r2(mean(r.orientationWords)),
    charsPerWord: r2(r.charsPerWord),
    regimes: r.regimes,
    cadenceBoundStoriesPerHourWithLlmLength: r2(cadenceBoundPerHour(r)),
    modelStoriesPerHour: r2(Math.min(r.stories / r.hours, cadenceBoundPerHour(r))),
  });

  // Stress: policy upper bound (dense downtown walking, every throttle at its floor).
  const pw = core.policyFor('walking', 'dense');
  const stressStoryS = pw.maxStoryS * core.IDA.narrative.verbosity;
  const stress = {
    source: 'POLICY UPPER BOUND (not replayed): dense walking, discovery at REFRESH.MIN_INTERVAL_S.walking, density probe at DENSITY_MIN_INTERVAL_S.walking, back-to-back max-length Ida stories separated by minGapS',
    placeQueriesPerHour: 3600 / core.REFRESH.MIN_INTERVAL_S.walking + 3600 / core.REFRESH.DENSITY_MIN_INTERVAL_S.walking,
    storiesPerHour: r2(3600 / (pw.minGapS + stressStoryS)),
    storyMaxWords: Math.round(stressStoryS * pw.wordsPerSecond),
  };

  /**
   * Replayed story counts come from template-length prose (≈12–40 s); an LLM fills its word budget
   * (A.llmFillOfMaxWords), so stories/h is capped by the director's cadence with LLM-length stories:
   * 3600 / (story duration + minGapS) for the scenario's dominant regime × density.
   */
  const dominant = (r: Rates): [core.MovementRegime, core.DensityClass] => (r.regimes.includes('highway_driving') ? ['highway_driving', 'sparse'] : r.regimes.includes('urban_driving') ? ['urban_driving', 'urban'] : ['walking', 'dense']);
  const cadenceBoundPerHour = (r: Rates) => {
    const pol = core.policyFor(...dominant(r));
    const durS = (A.llmFillOfMaxWords * mean(r.storyMaxWords)) / pol.wordsPerSecond;
    return 3600 / (durS + pol.minGapS);
  };
  const usageFromRates = (r: Rates, hours: number, extra: Partial<Usage> = {}): Usage => ({
    hours,
    stories: Math.min(r.stories / r.hours, cadenceBoundPerHour(r)) * hours,
    orientations: (r.orientations / r.hours) * hours,
    placeQueries: ((r.discoveryQueries + r.densityProbes) / r.hours) * hours,
    evidenceLookups: ((r.stories + r.orientations) / r.hours) * hours,
    storyTokensIn: mean(r.storyTokensIn),
    storyMaxWords: mean(r.storyMaxWords),
    orientationWords: mean(r.orientationWords) || 10,
    charsPerWord: r.charsPerWord,
    followups: 0,
    llmIntentCalls: 0,
    nearby: 0,
    realtimeMinutes: 0,
    followupMaxWords: core.isDriving(r.regimes.includes('highway_driving') ? 'highway_driving' : r.regimes.includes('urban_driving') && !r.regimes.includes('walking') ? 'urban_driving' : 'walking') ? 40 : 70,
    ...extra,
  });

  // Question mix: which scripted questions fall through the deterministic rules to the LLM interpreter?
  const QUESTIONS = ['Why is that important?', 'Tell me more', 'What is that building?', 'Who built it?'];
  const llmIntents = QUESTIONS.filter((q) => core.interpretUtterance(q, 'en-US') === null).length;
  const nearbyRule = core.interpretUtterance('Where can I get coffee nearby?', 'en-US') !== null;

  const SCEN: Array<{ id: string; label: string; usage: Usage; assumptions: string; realtimeProviders?: boolean }> = [
    { id: 'walk30', label: '30-min Walk', usage: usageFromRates(R.walk, 0.5, { followups: 1 }), assumptions: 'dense-urban walking/stationary rates from 2 replays (35 min total); 1 follow-up question; EN; no realtime' },
    { id: 'drive30_urban', label: '30-min Drive (urban)', usage: usageFromRates(R.urban, 0.5), assumptions: 'urban-driving slices of 2 replays (23 min); no questions (driver); EN' },
    { id: 'drive30_highway', label: '30-min Drive (highway)', usage: usageFromRates(R.highway, 0.5), assumptions: 'I-40 replay (105 min, sparse); no questions; EN' },
    { id: 'walk60_interactive', label: '60-min Interactive Walk', usage: usageFromRates(R.walk, 1, { followups: QUESTIONS.length, llmIntentCalls: llmIntents + (nearbyRule ? 0 : 1), nearby: 1 }), assumptions: `walking rates × 1 h; 4 questions (${QUESTIONS.join(' / ')}; ${llmIntents} need the LLM intent fallback) + 1 NearbySearch (coffee)` },
    { id: 'walk30_rt5', label: '30-min + 5 min Realtime', usage: usageFromRates(R.walk, 0.5, { followups: 1, realtimeMinutes: 5 }), assumptions: `walk30 + one 5-min realtime burst: ${A.realtime.userShareOfActiveMinute * 100}% user / ${A.realtime.assistantShareOfActiveMinute * 100}% assistant audio per active minute, ${A.realtime.turnsPer5Min} turns (OpenAI history re-billing as cached input)`, realtimeProviders: true },
    {
      id: 'stress30',
      label: 'High-density stress case (30 min)',
      usage: usageFromRates(R.walk, 0.5, { stories: stress.storiesPerHour * 0.5, placeQueries: stress.placeQueriesPerHour * 0.5, storyMaxWords: stress.storyMaxWords, followups: 6, llmIntentCalls: 6, nearby: 3 }),
      assumptions: `policy upper bound: ${stress.placeQueriesPerHour} place queries/h, ${stress.storiesPerHour} max-length stories/h, 6 questions (all via LLM intent), 3 NearbySearch (per-session tool cap is 3/min)`,
    },
  ];

  const CACHE = [0, 0.5, 0.8];
  const sessionRows: Array<Record<string, unknown>> = [];
  for (const s of SCEN) {
    for (const mix of MIXES) {
      for (const h of CACHE) {
        const rts = s.realtimeProviders ? REALTIME.map((r) => r.id) : [undefined];
        for (const rt of rts) {
          const c = sessionCost(s.usage, mix, h, rt);
          sessionRows.push({ scenario: s.id, scenarioLabel: s.label, mix: mix.id, sharedStoryCacheHit: h, realtimeProvider: rt ?? null, ...Object.fromEntries(Object.entries(c.components).map(([k, v]) => [k, r6(v)])), total: r6(c.total), spokenMinutes: r2(c.spokenMinutes) });
        }
      }
    }
  }

  // Realtime active-minute cost per provider.
  const realtimeMinute = REALTIME.map((r) => ({ provider: r.id, usdPerActiveMinute: r6(realtimeCost(r.id, 1)), usdPer5MinBurst: r6(realtimeCost(r.id, 5)), worstCaseAllAssistantMinute: r6(P.realtimeCost(r.id.split(':')[0]!, r.id.split(':')[1]!, 0, 60)) }));

  // ── Long-haul truck driver month
  const truckHours = A.truck.hoursPerDay * A.truck.daysPerMonth;
  const truckRows: Array<Record<string, unknown>> = [];
  const plan = { driverMonthly: 9.99, label: 'HYPOTHESIS: Driver plan $9.99/mo (MONETIZATION.md §3); net after 15% store fee', net: r2(9.99 * (1 - A.storeFee)), targetUsdPerHour: 0.03, targetLabel: 'TARGET < $0.03/active hour (MARKET.md §2 sensitivity)' };
  for (const src of [R.highway, R.highwayRouted]) {
    for (const mix of MIXES) {
      for (const h of [0, 0.25, 0.5, 0.65, 0.8, 0.9]) {
        const u = usageFromRates(src, truckHours, { followups: A.truck.questionsPerHour * truckHours, llmIntentCalls: 0, nearby: A.truck.nearbyPerHour * truckHours });
        const c = sessionCost(u, mix, h);
        truckRows.push({ trace: src === R.highway ? 'interstate' : 'interstate-routed', mix: mix.id, sharedStoryCacheHit: h, hoursPerMonth: truckHours, ...Object.fromEntries(Object.entries(c.components).map(([k, v]) => [k, r4(v)])), monthlyUsd: r2(c.total), usdPerHour: r4(c.total / truckHours), vsPlanNet: r2(plan.net - c.total), meetsHourTarget: c.total / truckHours < plan.targetUsdPerHour });
      }
    }
  }

  // ── Unit economics (engineering model; revenue values are HYPOTHESES)
  const sessionMix = [
    { id: 'walk30', share: 0.45, minutes: 30 },
    { id: 'drive30_urban', share: 0.2, minutes: 30 },
    { id: 'drive30_highway', share: 0.15, minutes: 30 },
    { id: 'walk60_interactive', share: 0.15, minutes: 60 },
    { id: 'walk30_rt5', share: 0.05, minutes: 35 },
  ];
  const costOf = (scenario: string, mix: string, h: number) => sessionRows.find((r) => r.scenario === scenario && r.mix === mix && r.sharedStoryCacheHit === h && (r.realtimeProvider === null || r.realtimeProvider === 'openai:gpt-realtime-2.1-mini'))!.total as number;
  const avgSessionCost = (mix: string, h: number) => sessionMix.reduce((s, x) => s + x.share * costOf(x.id, mix, h), 0);
  const avgMinutes = sessionMix.reduce((s, x) => s + x.share * x.minutes, 0);
  const cases = [
    { id: 'Small', mau: 1_000, fixedUsd: 60, fixedNote: 'ASSUMPTION: 1 VPS (4 vCPU/8 GB) + backups + domain' },
    { id: 'Medium', mau: 25_000, fixedUsd: 450, fixedNote: 'ASSUMPTION: 2–3 API VPS + managed Postgres + Redis' },
    { id: 'Large', mau: 250_000, fixedUsd: 4_000, fixedNote: 'ASSUMPTION: multi-instance API, managed PG/Redis, object storage + CDN, observability, self-hosted Wikidata/OSM extract' },
  ];
  const revenue = { payingShare: 0.021, annualPrice: 39.99, label: 'HYPOTHESIS: 2.1% of MAU pay (RevenueCat median freemium day-35 conversion, MARKET.md) for Explorer Annual $39.99/yr (MONETIZATION.md §3), net of 15% store fee; trip passes ignored' };
  const revPerMau = (revenue.payingShare * revenue.annualPrice * (1 - A.storeFee)) / 12;
  const SESS = { paying: 6, free: 2, label: 'HYPOTHESIS: paying users 6 sessions/month, free users 2 sessions/month (no data yet)' };
  const unit = cases.map((c) => {
    const sessionsPerUser = revenue.payingShare * SESS.paying + (1 - revenue.payingShare) * SESS.free;
    const sessions = c.mau * sessionsPerUser;
    const rows: Record<string, unknown> = { case: c.id, mau: c.mau, sessionsPerUserPerMonth: r2(sessionsPerUser), avgSessionMinutes: r2(avgMinutes), fixedInfraUsd: c.fixedUsd, fixedNote: c.fixedNote, revenueUsd: r2(revPerMau * c.mau) };
    for (const [mix, h] of [['default', 0], ['default', 0.5], ['wavenet_hypothetical', 0.5]] as const) {
      const v = avgSessionCost(mix, h);
      const variable = v * sessions;
      const cogs = variable + c.fixedUsd;
      rows[`${mix}@${h * 100}%`] = { avgVariableCostPerSession: r4(v), monthlyVariableUsd: r2(variable), totalCogsUsd: r2(cogs), impliedGrossMargin: r4((revPerMau * c.mau - cogs) / (revPerMau * c.mau)) };
    }
    const v0 = avgSessionCost('default', 0);
    const netPerPayer = (revenue.annualPrice * (1 - A.storeFee)) / 12;
    rows.paidUser = { netRevenuePerMonth: r2(netPerPayer), variableCostPerMonth: r2(v0 * SESS.paying), variableMargin: r4((netPerPayer - v0 * SESS.paying) / netPerPayer) };
    rows.fundableSessionsPerMauPerMonth = r4(revPerMau / v0);
    // paying share p where p·net·MAU = cost(p): cost = MAU·(p·6 + (1−p)·2)·v0 + fixed
    rows.breakEvenPayingShareDefault0 = r4((c.mau * SESS.free * v0 + c.fixedUsd) / (c.mau * (netPerPayer - (SESS.paying - SESS.free) * v0)));
    return rows;
  });

  const report = {
    generatedBy: 'scripts/bench/cost-model.ts (pnpm bench:cost)',
    generatedAt: new Date().toISOString().slice(0, 10),
    label: 'ESTIMATED — list-price model. Call counts MEASURED from deterministic replays of the production core; token counts from the production prompt builders; everything else is an explicit assumption. Not a bill, not production telemetry.',
    priceDate: PRICE_AT_LABEL,
    pricesRetrievedAt: P.PRICES_RETRIEVED_AT,
    assumptions: A,
    skus: Object.fromEntries(MIXES.map((m) => [m.id, { label: m.label, story: m.story.ref, intent: m.intent.ref, tts: m.tts.ref, stt: m.stt.ref, nearby: m.nearby.ref, discovery: m.discovery.ref }])),
    replayRates: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, { source: v.source, ...per(v) }])),
    stressUpperBound: stress,
    promptTokens: { intentCallTokensIn: INTENT_TOKENS_IN, followupCallTokensIn: FOLLOWUP_BASE_TOKENS, llmIntentFallbacksIn4ScriptedQuestions: llmIntents, coffeeHandledByRules: nearbyRule },
    scenarios: SCEN.map((s) => ({ id: s.id, label: s.label, assumptions: s.assumptions, usage: Object.fromEntries(Object.entries(s.usage).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])) })),
    sessionCosts: sessionRows,
    realtimeActiveMinute: realtimeMinute,
    truckDriverMonth: { hours: truckHours, assumptions: A.truck, plan, rows: truckRows },
    unitEconomics: { label: 'Engineering model. Revenue/pricing and usage are HYPOTHESES; fixed infra are ASSUMPTIONS (not sourced). Free-tier caps and Google free monthly quotas ignored.', sessionsPerUser: SESS, sessionMix, revenue: { ...revenue, revenuePerMauUsd: r4(revPerMau) }, cases: unit },
    notes: [
      'Shared story/audio cache hit rates of 50% and 80% are HYPOTHETICAL for the current code: narration audio is content-addressed by the exact prose, and LLM prose is regenerated per session (temperature 0.7, session-specific spatial cue), so cross-user narration hits are ~0% today. A story-primitive cache (prose keyed by place+angle+guide+locale+mode, spatial cue synthesized separately) is required to reach them.',
      'Wikimedia discovery is free but rate-limited (500 req/h per IP anonymous, 5,000 req/h with a token; PROVIDER_PRICING.md §5): see replayRates.*.wikimediaHttpPerHour for the per-session request rate.',
      'Google free monthly caps (e.g. 5,000 Nearby Search Pro) are ignored: per-call list price is charged from the first call (conservative).',
      'Native Maps SDK is free; a WebApp session adds one Dynamic Maps load ($0.007) — not included in the totals (native assumed).',
    ],
  };
  writeFileSync(join(OUT, 'cost_model.json'), JSON.stringify(report, null, 1) + '\n');

  const csv = (rows: Array<Record<string, unknown>>) => {
    const cols = Object.keys(rows[0]!).filter((k) => typeof rows[0]![k] !== 'object' || rows[0]![k] === null);
    return [cols.join(','), ...rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c]).includes(',') ? `"${String(r[c])}"` : String(r[c]))).join(','))].join('\n') + '\n';
  };
  writeFileSync(join(OUT, 'cost_model.csv'), csv(sessionRows));
  writeFileSync(join(OUT, 'truck_driver_month.csv'), csv(truckRows));
  const ueFlat = unit.flatMap((u) =>
    (['default@0%', 'default@50%', 'wavenet_hypothetical@50%'] as const).map((k) => ({ case: u.case, mau: u.mau, sessionsPerUserPerMonth: u.sessionsPerUserPerMonth, avgSessionMinutes: u.avgSessionMinutes, scenario: k, ...(u[k] as Record<string, number>), fixedInfraUsd: u.fixedInfraUsd, revenueUsd: u.revenueUsd })),
  );
  writeFileSync(join(OUT, 'unit_economics.csv'), csv(ueFlat));

  // console summary
  const pick = (s: string, m: string, h = 0) => sessionRows.find((r) => r.scenario === s && r.mix === m && r.sharedStoryCacheHit === h && (r.realtimeProvider === null || r.realtimeProvider === 'openai:gpt-realtime-2.1-mini'))!.total;
  console.log('ESTIMATED per-session variable cost (USD, list prices, 0% shared cache):');
  for (const s of SCEN) console.log(`  ${s.label.padEnd(34)} ${MIXES.map((m) => `${m.id}=${pick(s.id, m.id)}`).join('  ')}`);
  console.log('replay rates:', JSON.stringify(Object.fromEntries(Object.entries(R).map(([k, v]) => [k, per(v)])), null, 0).slice(0, 1200));
  const t = (mix: string, h: number) => truckRows.find((r) => r.trace === 'interstate' && r.mix === mix && r.sharedStoryCacheHit === h)!;
  console.log(`truck month (${truckHours} h): default 0% = $${t('default', 0).monthlyUsd} ($${t('default', 0).usdPerHour}/h), default 80% = $${t('default', 0.8).monthlyUsd}, premium 0% = $${t('premium', 0).monthlyUsd}, places_discovery 0% = $${t('places_discovery', 0).monthlyUsd}; plan net $${plan.net}`);
  console.log('wrote benchmark/cost/cost_model.json, cost_model.csv, truck_driver_month.csv, unit_economics.csv');
}

await main();
