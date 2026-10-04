# Performance & Cost Report

> Follows `docs/PERFORMANCE_COST_TEMPLATE.md` section by section. Every value is labelled:
>
> - **MEASURED-tests**: an automated test that ran in this build (vitest / Playwright). Deterministic fakes stand in wherever a provider is involved.
> - **MEASURED-replay**: a deterministic replay of synthetic GPS traces over fixture POI/evidence packs, run through the production core (`@city/replay`).
> - **MEASURED-harness**: the real API in-process (Fastify + Postgres 16 + Redis 7 + WebSocket) on loopback. Every provider is a fake with **SIMULATED provider latency**.
> - **ESTIMATED**: a list-price model (`packages/providers/src/pricing.ts`, retrieved 2026-09-27).
> - **TARGET**: a budget proposed by the implementation team.
> - **NOT YET MEASURED / NOT RUN**: needs credentials, devices, field runs or human raters, none of which were available here.
>
> Nothing in this report is a production measurement or an invoice. No provider keys were supplied, and Wikipedia, Wikidata and Google are unreachable from the build sandbox.
>
> **Revision 2026-10-04 (D-018 – D-024).** Re-measured after the cost/latency work: shared story-body cache, tiered TTS + Google TTS adapter, streamed follow-up answers, prompt trim, realtime reconciliation, cross-session retell memory and density-probe backoff. Before figures are the 2026-09-28 run (commit `7e9934a`, kept in `benchmark/cost/cost_model.before_D018.json`); problems fixed by the work are marked **FIXED** with their evidence. Harness-measured hit rates and latencies are kept apart from assumed production rates throughout.
>
> Reproduce with `pnpm bench:acceptance` (about 7 min: suites, replay, harness and web e2e), `pnpm bench:cost` (seconds) and `pnpm bench:charts`.

## 0. Report Metadata

| Field | Value |
|---|---|
| Product / working brand | Telvey (Guides: Ida, Emil) |
| Repository | `city-ai-greenfield-claude`, branch `build/mvp` |
| Build / commit SHA | `e190bbb` (WIP checkpoint of D-018…D-024) plus the uncommitted completion of that work (`results.json` records `e190bbb+uncommitted`). Before figures: `7e9934a` |
| Report date | 2026-10-04 (revision of the 2026-09-28 report) |
| Prepared by | QA / Performance / Cost agent (implementation team) |
| Mobile versions tested | iOS: **NOT RUN** (no Apple account, D-016). Android: **NOT RUN** (no EAS token or SDK). JS bundles and `expo prebuild` verified (docs/MOBILE.md §3); mobile logic tests: 15/15 MEASURED-tests (the `say_append` UI paths in web and mobile are logic-tested only, not device-tested) |
| WebApp version tested | `apps/web` production build (Next.js 15) in offline demo mode, Chromium via Playwright: smoke suite 5/5 (MEASURED-e2e). The 5-test screenshot spec is not run by the bench because it rewrites committed screenshots |
| Backend environment | local (sandbox): Node 22.22, Postgres 16, Redis 7 on one Linux host; API in-process |
| Regions tested | Test geographies only, all replays: NYC (WTC), Chicago (Art Institute, highway to downtown), San Francisco (Golden Gate), I-40 in New Mexico. No live region |
| Network profiles tested | loopback only. Wi-Fi / 5G / LTE / degraded: **NOT YET MEASURED**. Network loss is simulated in E3 tests (socket drop, REST during outage, resume) |

## 1. Executive Summary

**What changed in this revision (D-018 – D-024).** A context-free story body is now cached across users (no LLM call on a hit); highway narration can use a cheap TTS tier through a new Google Cloud TTS adapter; follow-up answers stream per sentence with per-sentence grounding; real-provider prompts lost their JSON payload block; realtime budget is reconciled; places told in earlier sessions are not retold for 30 days; highway density probes back off. All of it is covered by tests (460 green) and re-measured below. Label discipline is unchanged: latencies are MEASURED-harness with SIMULATED providers, dollars are ESTIMATED list prices, production cache hit rates are ASSUMED.

| Headline | Before (2026-09-28) | After (this run) | Label |
|---|---:|---:|---|
| Follow-up speech end → first answer audio p50 / p95 (target 2.0 / 3.5 s) | 2.84 s / **4.92 s (missed)** | 1.95 s / 3.38 s (met, 3% margin) | MEASURED-harness, SIMULATED providers; first-token share of LLM latency is an ASSUMPTION |
| Approved moment → first audio p50 / p95 (uncached) | 1.88 s / 3.77 s | 1.66 s / 2.68 s | MEASURED-harness |
| Cached story → first audio p50 / p95 | 1.06 s / 2.91 s (LLM still ran) | **448 ms / 883 ms** (body cached, all audio evicted); **6 ms / 28 ms** (fully warm, loopback) | MEASURED-harness |
| 30-min walk (default mix, 0% cache) | $0.318 | $0.306 (walking stays on the standard TTS tier by default) | ESTIMATED |
| 30-min urban drive | $0.137 | $0.110 | ESTIMATED |
| 30-min highway drive | $0.0186 | $0.0167 default mix; **$0.0040 with the tiered routing** | ESTIMATED |
| Truck month (176 h) at 0 / 50 / 80% shared cache, default mix | $8.76 / $5.49 / $3.53 | $8.08 / $5.36 / $3.73 | ESTIMATED; 50/80% are ASSUMED production rates |
| Truck month, tiered routing (highway on WaveNet) at 0 / 50 / 80% | not available (no adapter) | **$3.61 / $2.96 / $2.57** ($0.0205 / 0.0168 / 0.0146 per hour; target < $0.03/h) | ESTIMATED; needs `GOOGLE_TTS_API_KEY` and an audition of the PENDING-BENCHMARK voices |
| Highway density probes per replay (105 min) | 44 | 19 (25.1 → 10.8 per hour) | MEASURED-replay |
| Story LLM input tokens, walking / highway | 915 / 812 | 544 / 512 (−41% / −37%); follow-up 981 → 556 (−43%) | ESTIMATED (chars/4 over the real prompt builders) |

- **Responsiveness (simulated providers).** Every p95 budget is now inside target, including contextual follow-ups (3.38 s against 3.5 s). The margin is thin and rests on one assumption: that the LLM's first token arrives after 45% of its simulated total latency (`ttftShare`). Real provider latency is **NOT YET MEASURED**.
- **Largest latency bottleneck.** Provider time dominates. Our own overhead is small: frame ingest ~0.1 ms, loopback `stop_audio` round trip ~1 ms.
- **Largest variable-cost driver: TTS, still 95–99% of every walking or driving session** (ESTIMATED). `gpt-4o-mini-tts` costs about $0.015 per narrated minute. The economy tier ($4 per 1M characters, ≈ 4× cheaper) is applied to highway narration by default; walking stays on the standard voice unless `TTS_TIER_WALKING=economy` is set, because a cheaper voice in the city is a product decision (voice quality is unbenchmarked). Walking at ≈ $0.07 per 30 minutes needs that decision.
- **Defaults.** gpt-6-luna for stories and intent, gpt-4o-mini-tts, gpt-4o-mini-transcribe, Wikimedia for discovery and evidence, Google Places Nearby Search Pro only for questions the user asks, and (new, optional) Google Cloud WaveNet for the economy tier. These are provisional until the D-010 benchmark (`pnpm bench:providers`) runs with keys.
- **Strongest cost controls** (all MEASURED-tests): discovery refresh throttle and (new) density-probe backoff (18–77 place queries per hour against 3,600 GPS fixes per hour); Wikimedia-first discovery; 15-minute shared place cache and 7-day evidence cache; the shared story-body cache; ProviderGuard (budget, breaker, timeout, one retry); reduced mode when Redis is down. Every failure test shows bounded calls (§13).
- **Long-haul driver month** (176 h, ESTIMATED): **$8.08 on the default mix against $8.49 net from a $9.99 driver plan (HYPOTHESIS), still break-even and above the $0.03/h target ($0.046/h)**; with the tiered routing it is **$3.61 ($0.021/h), under target even at 0% cache**. Using Google Places for automatic discovery would still cost **$111/mo** (it was $192 before probe backoff).
- **Unit economics (HYPOTHESES).** A paying Explorer user has a positive variable margin, about 41%. **Free users are still not fundable at 2.1% conversion:** revenue covers 0.21 sessions per MAU per month. Tight free caps and the walking-tier decision are prerequisites for launch.
- **Main scaling risk.** Wikimedia rate limits, not money. A session makes 55–154 Wikipedia/Wikidata HTTP requests per hour (was 84–175), against 5,000 per hour per IP even with a token.
- **What is real and what is estimated.** Real: test results, replay call counts, server-side overhead, harness cache counters. Simulated: every provider latency. Estimated: every dollar figure. Assumed: production cache hit rates, `ttftShare`, usage mixes. Not run: everything involving a device, a field run, live providers or the realtime D-section.
- **Top open items:** (1) audition and benchmark the economy voices (guide JSONs mark them PENDING BENCHMARK, and the Google pricing page could not be re-fetched in this session, so prices are the existing 2026-09-27 rows); (2) decide the walking tier; (3) measure production cache hit rates once there is traffic; (4) real-provider latency and streaming behaviour (`pnpm bench:providers` extension); (5) a self-hosted Wikidata/OSM extract.

## 2. Performance Objectives

The owner's template contains **no numeric targets** (D-017). Every value below is a **TARGET proposed by the implementation team** and needs owner sign-off. "Hard failure" is the point at which the UX treats the interaction as failed: fallback, error phrase or skip.

| Interaction | Target p50 | Target p95 | Hard failure / UX threshold | Rationale |
|---|---:|---:|---:|---|
| App launch → usable Explore shell | 1.5 s | 3.0 s | 5 s | Cold start on a mid-range Android. Android vitals treats a cold start ≥ 5 s as excessive. The shell must render before location or API are ready (offline demo fallback exists). |
| Map interaction / camera response | 16 ms/frame | 33 ms/frame | 100 ms input delay | 60 fps pan and zoom. Above 100 ms, input feels laggy. |
| Approved moment → first audible speech | 2.5 s | 4.5 s | 8 s (story skipped if its lead time is gone) | Stories are decided ahead of the place (`minLeadS` 20 s walking, 60 s highway; `LEAD_MARGIN_S` 10 s), so a few seconds are absorbed by lead time. TTS timeout is 9 s and story LLM timeout is 9 s. |
| Cached story → first audio | **0.5 s (revised from 1.5 s)** | **1.0 s (revised from 3.0 s)** | 6 s | Since D-018 a body-cache hit makes no LLM call; first audio is the short prefix segment (cached or synthesized). The old 1.5 / 3.0 s targets described a cache that still ran the LLM. |
| User begins interruption → old audio stopped | 150 ms | 300 ms | 500 ms | Local stop in the app (the client stops first, then tells the server). Responses slower than ~200 ms are perceived as unresponsive. |
| End of simple utterance → first response audio | 2.0 s | 3.5 s | 6 s (then a "one moment" phrase) | Hybrid STT → intent → tool/LLM → TTS loop (D-010). Realtime providers are expected to beat this, which is part of the D-010 decision. |
| Nearby-search request → usable result | 1.5 s | 2.5 s | 4 s (router `nearby` timeout) | Speech end to results on the map. The spoken answer follows. |
| Tool action → map update | 100 ms | 250 ms | 1 s | Server-side map directive after validation, before TTS. |
| Realtime session connect → ready | 1.0 s | 2.0 s | 8 s (router `realtime` timeout) | Token issuance plus WebRTC/WS handshake. |
| Realtime reconnect | 1.5 s | 3.0 s | 10 s | Clean reopen after an idle close (D-B6). |
| Admin dashboard initial useful paint | 1.5 s | 3.0 s | 6 s | Internal tool on desktop broadband. |

**Cost targets** (also implementation-team proposals, used in §17):
- 30-min walk ≤ $0.15. At six sessions a month, this keeps a $39.99/yr payer at ≥ 65% variable margin.
- 30-min urban drive ≤ $0.10.
- Highway < $0.03 per active hour (MARKET.md §2).
- Realtime ≤ $0.02 per active minute.
- (Unchanged by this revision; §17 reports the actuals against them.)

**Inherited vs revised.** Nothing is inherited, because the specification has no numbers. The only inherited quantitative requirements are qualitative ones from ACCEPTANCE_BENCHMARK (for example "no paid request loop at GPS frequency"), and the tests turn those into numbers: ≤ 60 queries/h on the highway and ≥ 20 frames per query.

## 3. Test Methodology

- **Devices and OS versions.** None. No native build exists (D-016). Mobile logic runs in vitest on Node 22.
- **Browsers.** Chromium from Playwright 1.56 (`/opt/pw-browsers`), desktop 1280×800 plus a 390 px viewport check, against a `next build` production build in offline demo mode.
- **Server.** A single Linux sandbox host (see `benchmark/acceptance/results.json → environment` for the CPU count). Postgres 16 and Redis 7 are local. The API runs in the same Node process as the harness client.
- **Provider regions.** Not applicable: no live providers.
- **Network.** Loopback only. RTT and degraded profiles are **NOT YET MEASURED**. E3 simulates loss by closing the socket and sending REST calls during the outage.
- **Cold vs warm.** One warm-up session is excluded before measuring; it primes JIT, DB pools and caches.
  - "Uncached narration" means the narration audio directory is emptied before each session, while evidence and discovery caches stay warm (production TTLs are 7 days and 15 minutes).
  - "Cached story" (D-018) has two phases. *Body cached, audio evicted*: the shared body prose is in the cache, all audio is deleted before each session, so first audio is the synthesis of the short prefix (conservative). *Fully warm*: body prose, prefix audio and body audio all cached (a repeat landmark or corridor), so first audio is a cache read. Cold sessions clear both the audio directory and the shared `nb:v1:*` body keys.
- **Sample count.** 36 measured sessions per metric (`--samples`, minimum 30), plus 36 body-cached sessions and 36 fully-warm sessions. The follow-up and nearby metrics have 36 each, pooled to 72. Cache-layer counters are read from the in-process caches before and after each phase (`latency.json → cacheRates` is also in `results.json`).
- **p50 / p95.** Linear interpolation between closest ranks (Hyndman–Fan type 7, the numpy default).
- **Clocks.**
  - Server intervals come from API telemetry (`telemetry.latency`, `Date.now()` / `performance.now()`).
  - Client intervals come from WebSocket message-arrival time with `performance.now()` in the same process, so there is no clock skew.
- **Audio start.** Defined as "first audio bytes available to the client": the play or say directive has been received and a GET of the segment file has completed. Device decode and playback start are **excluded**.
- **Barge-in.** Measured as client `control interrupt` → `stop_audio` directive received.
  - The apps stop locally before this round trip, so press → silence on a device is **NOT YET MEASURED**.
  - `packages/client/src/bargein.ts` records it on devices.
- **End of speech.** Defined as the start of the `POST /v1/stt` upload of the push-to-talk clip. It therefore includes STT, intent, the tool or LLM call, TTS and the audio fetch.
- **Synthetic vs live.** Replay and harness use fixture places and evidence and fake LLM/TTS/STT/Nearby providers. The harness wraps each fake in a seeded log-normal delay (`LATENCY_PROFILE` in `scripts/bench/acceptance.ts`):

| Simulated provider class | p50 | p95 | Represents |
|---|---:|---:|---|
| LLM story | 1,100 ms | 2,600 ms | small hosted LLM, ~0.9k input / ~200 output tokens, non-streamed |
| LLM follow-up | 700 ms | 1,600 ms | ~100 output tokens; streamed: first delta after **45% of the total (`ttftShare`, an ASSUMPTION)**, then evenly spaced per-word deltas |
| LLM intent | 450 ms | 1,000 ms | JSON, ~30 tokens (only when rules miss) |
| TTS | 250 ms + 2.5 ms/char | ×2.4 | hosted TTS returning a complete file |
| STT | 450 ms | 1,100 ms | ~3 s clip, batch |
| Nearby (Places) | 250 ms | 650 ms | Nearby Search Pro, narrow field mask |
| Wikimedia discovery | 500 ms | 1,500 ms | geosearch + SPARQL |
| Wikimedia evidence | 400 ms | 1,200 ms | REST summary + SPARQL |

These figures are **implementation-team assumptions** chosen to be representative of those API classes. The streamed follow-up number is the most assumption-sensitive result in this report: it depends on `ttftShare` and on TTS being started per sentence. They are **not measurements** of any provider. `pnpm bench:providers` replaces them when keys arrive.

### 3.1 Measurement integrity

- The dominant latency terms are simulated. The harness proves the orchestration: serial vs parallel steps, stale-turn dropping, and no hidden waits. It does not prove real provider speed, tail behaviour, cold starts or rate limiting.
- **Fake prose is template-length.** A real LLM fills its word budget, which lengthens TTS latency and cost. The cost model corrects for this (`llmFillOfMaxWords` 0.85). The harness TTS delay grows per character but uses the fake's shorter text, so the TTS terms are **optimistic**.
- **Loopback hides network cost.** Add about 2 × RTT per round trip (LTE is typically 40–120 ms).
- **The WTC walk is a single dense-urban trace,** so every harness session starts the same first story.
- **Replays are synthetic traces over hand-curated fixture packs,** not the Wikipedia candidate density of a real downtown. Real candidate counts will be larger. Ranking was tested for order-independence (A1 reversed-order test), but not for scale.
- **The cost model's usage patterns are assumptions:** questions per hour, session mix, sessions per user and conversion.

## 4. Measured Client Performance

### 4.1 Native iOS

No iOS build exists: Apple Developer credentials are missing (D-016). Every row is **NOT RUN**.

| Metric | Cold/Warm | Sample size | p50 | p95 | Target | Result | Evidence reference |
|---|---|---:|---:|---:|---:|---|---|
| App launch → usable Explore | cold | 0 | – | – | 1.5 s / 3.0 s | NOT RUN | D-016, docs/MOBILE.md §6 |
| Map ready | cold | 0 | – | – | 2.0 s / 4.0 s | NOT RUN | – |
| Explore interaction responsiveness | warm | 0 | – | – | 16 / 33 ms per frame | NOT RUN | – |
| Audio playback start | warm | 0 | – | – | ≤ 300 ms after bytes | NOT RUN | – |
| Background/foreground recovery | – | 0 | – | – | resume ≤ 2 s | NOT RUN (logic only: mobile `FixBuffer`, client `FrameBatcher` tests) | docs/MOBILE.md §2 |
| Memory footprint | – | 0 | – | – | < 250 MB | NOT RUN | – |
| Battery impact during 30 min Explore | – | 0 | – | – | < 8% per 30 min | NOT RUN | – |

### 4.2 Native Android

Same table and status: **NOT RUN**. No EAS token and no Android SDK in the sandbox; the JS bundle (Hermes, 4.3 MB) and `prebuild` pass.
- Expected platform differences to measure: foreground-service survival on OEM battery optimisers (Samsung, Xiaomi) and audio-focus ducking.
- The checklist is in docs/MOBILE.md §4.

### 4.3 WebApp/PWA

| Metric | Browser/device | Sample size | p50 | p95 | Target | Result | Evidence reference |
|---|---|---:|---:|---:|---:|---|---|
| First useful paint | Chromium 1280×800 | 0 | – | – | 1.5 s / 3.0 s | NOT YET MEASURED (functional e2e only) | `apps/web/e2e/smoke.spec.ts` |
| Explore shell ready | Chromium | 0 | – | – | 2.0 s / 3.5 s | NOT YET MEASURED | – |
| Map ready | Chromium | 0 | – | – | 2.5 s / 4.5 s | NOT YET MEASURED | – |
| Story start | Chromium, offline demo, 20× replay speed | 1 functional run | – | – | – | Functional PASS (story shown within the 30 s test timeout) | e2e "tells the 9/11 Memorial story" |

The Playwright smoke suite (5 tests) passed in this run: `results.json → web`. It checks behaviour, not timings. Adding `performance.getEntriesByType('paint')` capture to the e2e is a small follow-up.

## 5. Backend & API Performance

These are MEASURED-harness numbers, loopback, n = 36 sessions, with SIMULATED provider latency where a provider is called. The source is `benchmark/acceptance/latency.json`.

| Service / endpoint | Scenario | Sample size | p50 | p95 | Error rate | Cache status | Result |
|---|---|---:|---:|---:|---:|---|---|
| Context ingestion (`ingestFrame` per frame) | WTC walk frames until first story | 648 | 0.1 ms | 0.1 ms | 0 | – | Deterministic, local. Negligible |
| Discovery | Density probe + discovery per tick | – | sim 500 ms | sim 1,500 ms | 0 | Warm (15-min shared cache) after the warm-up session: 90/91 place hits in the cold phase | Paid only when throttle + cache miss (18–77/h in replays; was 33–87/h before D-024) |
| Evidence retrieval | Per decided target | – | sim 400 ms | sim 1,200 ms | 0 | Warm (7-day cache) | Free (Wikimedia); cached per place + language |
| Narrative planning (brief, grounding, segments) | Per story | – | not instrumented separately | – | 0 | – | Deterministic, local; included in the trigger → play interval below |
| Narrative generation + TTS seg 0 → `play` | `trigger_to_first_audio` (server), cold body + cold audio | 36 | 1,660 ms | 2,680 ms | 0 | Body + audio cold | Provider-bound (sim). Before: 1,875 / 3,763 ms |
| Cached story → `play` (body hit, audio evicted) | `cached_story_to_first_audio` | 36 | 448 ms | 883 ms | 0 | Body hit, prefix synthesized | No LLM call. Before (LLM still ran): 1,059 / 2,910 ms |
| Cached story → `play` (fully warm) | `cached_story_to_first_audio` | 36 | 3 ms server (6 ms at client incl. fetch) | 21 ms server (28 ms client) | 0 | Body + audio hit | No LLM, no TTS. Loopback; device/network not included |
| TTS audio serving | GET `/v1/audio/<seg0>` | 36 | 2.8 ms | 4.7 ms | 0 | Local volume | Local |
| Nearby Search | provider call → zod-validated (`nearby_to_result`) | 36 | 207 ms | 604 ms | 0 (invalid rows dropped 36/36) | Not cached (Places terms) | Paid, ~$0.032/call (ESTIMATED) |
| Utterance → first answer audio (server) | `speech_end_to_first_audio`, excl. STT + fetch (pooled coffee + streamed follow-up) | 36 | 786 ms | 1,476 ms | 0 | – | Provider-bound (sim). Before: 976 / 1,523 ms |
| Admin metrics | `/v1/admin/metrics/*` | 0 | – | – | – | – | NOT YET MEASURED (functional tests only: admin.test.ts 8/8) |

### 5.1 Latency before / after (MEASURED-harness, SIMULATED providers, loopback, n = 36 each)

| Metric | Target p50 / p95 | Before p50 / p95 | After p50 / p95 | Result |
|---|---:|---:|---:|---|
| Approved moment → first audio bytes (cold body, cold audio) | 2.5 / 4.5 s | 1,878 / 3,765 ms | 1,663 / 2,683 ms | met |
| Cached story → first audio, body cached, audio evicted | 0.5 / 1.0 s (revised) | 1,059 / 2,910 ms | 448 / 883 ms | met (conservative case) |
| Cached story → first audio, fully warm | 0.5 / 1.0 s (revised) | n/a | 6 / 28 ms | met (loopback; cache read only) |
| Speech end → answer audio, coffee | 2.0 / 3.5 s | 1,471 / 2,346 ms | 1,250 / 2,328 ms | met |
| Speech end → answer audio, **follow-up** | 2.0 / 3.5 s | 2,840 / **4,915 ms (missed)** | **1,950 / 3,380 ms** | **met (3% p95 margin)** |
| Speech end → nearby results on map | 1.5 / 2.5 s | 699 / 1,544 ms | 701 / 1,545 ms | met |
| Interrupt → `stop_audio` (server) | 150 / 300 ms | 0.6 / 1.4 ms | 1.0 / 1.5 ms | met (device not measured) |

*Why the follow-up improved:* the answer now streams, each completed sentence is validated and sent to TTS immediately, and first audio is the first sentence's audio instead of the whole answer's. The improvement is the structure; its size depends on `ttftShare = 0.45` (assumption) and on real TTS per-sentence latency, so treat 3.38 s as "inside target in simulation with a thin margin", not as a guarantee. The pooled `speechEndToFirstAudio` metric (coffee + follow-up) is 1,624 / 3,059 ms.

**Deterministic and local:** frame ingest, regime and density, scoring, director, brief, grounding, segmentation, resume and safety policies, tool policy, directive sequencing and audio serving.

**Dependent on paid external providers:** LLM (story, follow-up, intent fallback), TTS, server STT, Places Nearby Search, and realtime.

Wikimedia discovery and evidence are free but rate-limited (§14).

## 6. Voice & Realtime Performance

**No provider was benchmarked.** No OpenAI or Gemini key was supplied. The last provider run (`benchmark/providers/2026-09-28T02-42-01-826Z.json`) reports `keysPresent: all false`, so every story, TTS, STT and realtime run was skipped.

| Metric | OpenAI gpt-realtime-2.1-mini | Google gemini-3.8-live | Hybrid (STT → LLM → TTS), default mix |
|---:|---:|---:|---:|
| Connect p50 / p95 | NOT RUN — credentials not supplied | NOT RUN — credentials not supplied | n/a (no session) |
| Speech-end → final recognized turn p50 / p95 | NOT RUN — credentials not supplied | NOT RUN — credentials not supplied | NOT RUN (harness STT sim 450 / 1,100 ms) |
| Speech-end → first response audio p50 / p95 | NOT RUN — credentials not supplied | NOT RUN — credentials not supplied | harness (sim): coffee 1,250 / 2,328 ms; follow-up 1,950 / 3,380 ms (streamed; was 2,840 / 4,915 ms) |
| Barge-in → output stopped p50 / p95 | NOT RUN — credentials not supplied | NOT RUN — credentials not supplied | server round trip 1.0 / 1.5 ms (loopback); device NOT YET MEASURED |
| Tool-call success rate | NOT RUN — credentials not supplied | NOT RUN — credentials not supplied | fakes: 36/36 validated results, invalid rows dropped |
| False-start rate under road noise | NOT RUN — credentials + noise fixture | NOT RUN | NOT RUN |
| Missed-turn rate under road noise | NOT RUN | NOT RUN | NOT RUN |
| English quality (1–5 rubric) | NOT RUN — human rubric | NOT RUN | NOT RUN |
| Russian quality (1–5 rubric) | NOT RUN — human rubric | NOT RUN | NOT RUN |
| Reconnect success rate | NOT RUN — credentials not supplied | NOT RUN | WS resume: E3 test PASS (exactly-once) |
| Client integration complexity | WebRTC/WS token issuer implemented (`OpenAIRealtimeTokenIssuer`) | Ephemeral token issuer implemented (`GeminiLiveTokenIssuer`) | implemented end to end |
| Realtime cost per active minute (ESTIMATED) | $0.0117 | $0.0087 | ≈ $0.001–0.015 (dominated by answer TTS) |

The realtime cost row assumes 30% user and 40% assistant audio per active minute, with OpenAI history re-billing counted as cached input. `gpt-realtime-2.1` (full) is $0.037 per active minute.

### 6.1 Provider decision

- **Selected default:** none yet. D-010 stays **Provisional**. The hybrid loop is the running default because it works without realtime credentials. Its interim components are the configured defaults: gpt-6-luna, gpt-4o-mini-tts, gpt-4o-mini-transcribe, and Places Nearby Pro for tools; Google Cloud TTS (WaveNet) is the optional economy tier (D-019) and is also an unmeasured candidate for the D-010 benchmark.
- **Fallbacks (configured):**
  - Story and intent: OpenAI, then Gemini, then Anthropic.
  - TTS and STT: OpenAI, then Gemini.
  - Realtime: OpenAI, then Gemini.
  - Every provider has a template (story) and device-voice (TTS) floor.
- **Rejected alternatives:**
  - Always-on realtime: cost grows with open-session time, and the risk and complexity of an open microphone while driving (D-010).
  - GPT-Live-1 at $0.05 per session-minute: billed during silence.
  - Google Places for automatic discovery: $0.53–1.54 per 30-min session, $192 per driver-month (ESTIMATED), and Places content cannot be pooled across users.
- **Evidence for the decision:** none measured. Only list-price estimates exist (§7, §9).
- **The decision process that runs when keys arrive:**
  1. Put keys in the environment. They are never written to the repo; see `API-Credentials.example.md`.
  2. Run `pnpm bench:providers`. It verifies model IDs against each provider's list endpoint (OpenAI docs disagreed on model names), then measures story latency, tokens, cost and grounding pass rate on the fixed brief corpus (both Guides, EN and RU), TTS time-to-first-byte and $/min, STT latency, and realtime token issuance.
  3. Run the D-section scripts (D-B1…B6) on each realtime candidate using the same utterances as C1–C3 and a recorded road-noise fixture. Two raters score the EN/RU 1–5 rubric.
  4. Choose by: (a) grounding pass rate ≥ 95% after one retry; (b) meeting the §2 p95 targets; (c) lowest $/narrated minute among those that pass (a) and (b); (d) persona distinctness ≥ 3.5/5. Record the result in D-010, with the losing providers kept as fallbacks.
- **Re-evaluation triggers:**
  - A price change of ±25% (the Gemini promo ends 2027-01-01).
  - Grounding pass rate below 90% over 7 days.
  - p95 regressing past a hard threshold.
  - A new TTS SKU below $0.005/min.
  - Russian quality below 3/5.

## 7. Cost Model Inputs

Pricing is taken from `benchmark/research/provider_pricing.json` (retrieved 2026-09-27) through `packages/providers/src/pricing.ts`. Promotional Gemini prices are **evaluated at 2027-01-01** (after the promo).

| Provider | Service | Pricing unit | Unit price | Source/date | Notes |
|---|---|---|---:|---|---|
| OpenAI | gpt-6-luna (story, intent) | 1M tokens in / out | $0.10 / $0.50 | developers.openai.com, 2026-09-27 | configured default LLM |
| Anthropic | Claude Sonnet 5 (premium prose) | 1M tokens in / out | $2.00 / $10.00 | platform.claude.com, 2026-09-27 | premium mix |
| Google | gemini-3.1-flash-lite | 1M tokens in / out | $0.25 / $1.50 | ai.google.dev, 2026-09-27 | Gemini mix |
| OpenAI | gpt-4o-mini-tts | 1M text tok in / audio tok out | $0.60 / $12 (≈20.8 audio tok/s) | model page, 2026-09-27 | configured default TTS, ≈ $0.015/min |
| OpenAI | tts-1 | 1M characters | $15 | model page, 2026-09-27 | economy TTS, ≈ $0.0135/min |
| Google | gemini-3.8-flash-lite-tts | 1M text / audio tokens (25 tok/s) | $1.00 / $12 (2027) | ai.google.dev, 2026-09-27 | promo halves this until 2027-01-01 |
| ElevenLabs | Flash/Turbo TTS | 1K characters | $0.05 | elevenlabs.io/pricing/api, 2026-09-27 | premium voice, ≈ $0.045/min |
| Google Cloud | TTS Standard / WaveNet | 1M characters | $4 | cloud.google.com, 2026-09-27 (existing `provider_pricing.json` row; the official page could not be re-fetched in the 2026-10-04 revision, so the retrieval date is unchanged) | **adapter implemented** (`google_tts`, D-019); economy tier; entries `google_tts:standard`, `google_tts:wavenet` in `pricing.ts` |
| Google Cloud | TTS Neural2 | 1M characters | $16 | same JSON row, 2026-09-27 | adapter supports it (`GOOGLE_TTS_VOICE_TYPE=neural2`); entry `google_tts:neural2`; no Russian Neural2 voice in the guide candidates |
| OpenAI | gpt-4o-mini-transcribe | minute | $0.003 | pricing page, 2026-09-27 | configured default STT |
| OpenAI | gpt-4o-transcribe | minute | $0.006 | pricing page, 2026-09-27 | premium STT |
| Google | gemini-3.5-transcribe | minute | $0.005 | ai.google.dev, 2026-09-27 | – |
| OpenAI | gpt-realtime-2.1-mini | min user audio / min assistant audio | $0.006 / $0.024 (cached in $0.30/1M) | model page, 2026-09-27 | derived per minute |
| OpenAI | gpt-realtime-2.1 | min in / min out | $0.0192 / $0.0768 | pricing page, 2026-09-27 | derived |
| Google | gemini-3.8-live | min in / min out | $0.005 / $0.018 | ai.google.dev, 2026-09-27 | published per-minute |
| Google Maps | Places Nearby Search Pro | 1,000 requests | $32 (5,000 free/mo ignored) | developers.google.com, 2026-09-27 | NearbySearch tool (and risk variant) |
| Google Maps | Dynamic Maps (web) | 1,000 loads | $7 | same | WebApp only; native Maps SDK free |
| Wikimedia | Wikipedia / Wikidata APIs | request | $0 (500 req/h anon, 5,000 req/h token) | api.wikimedia.org (page marked draft) | rate limit is the constraint |
| (assumption) | VPS egress | GB | $0.01 | not sourced | 64 kbps mp3 audio |

## 8. Variable Cost Taxonomy

| Category | In the current build | Model treatment |
|---|---|---|
| Map SDK / map loads | Native Google Maps SDK (free); web Dynamic Maps | $0 native; +$0.007 per WebApp session (not in totals) |
| Automatic place discovery | Wikimedia geosearch + SPARQL, throttled and cached | $0; call counts from replay; rate-limit risk (§14) |
| Explicit nearby search | Google Places Nearby Search Pro, narrow field mask | $0.032/call |
| Place details / enrichment | Not called (Details adapter exists, unused) | $0 |
| Geocoding | Not used | $0 |
| Routes / distance / ETA | Not used (hand-off to Google/Apple/Waze) | $0 |
| Search / grounding / evidence | Wikipedia REST + Wikidata SPARQL, cached 7 days | $0 |
| LLM text input | Real prompt builders: ~544 tokens per walking story body (915 before the payload block was removed and the body prompt became context-free, §15) | gpt-6-luna $0.10/1M |
| LLM text output | 0.85 × maxWords × 1.35 tokens per word | $0.50/1M |
| Realtime audio / session duration | Token issuer and usage ledger implemented; minutes reported by client | per-minute in/out, plus OpenAI history re-billing |
| STT | Device STT preferred (Auto); server STT fallback | $0.003/min × 3 s per question |
| TTS | Content-addressed per segment; prefix (≈10 words) + body per story; answers per sentence; standard or economy tier | chars × SKU; **dominant line** |
| Media / object storage and egress | Local volume behind the API | ≈ $0.0001 per session |
| Transactional email / OTP | Not configured | $0 |
| Observability | Self-hosted (Postgres telemetry, admin console) | $0 variable |

## 9. Per-Session Cost Scenarios

All figures are **ESTIMATED** (list price, 0% shared cache unless stated). Call counts are MEASURED from replays (regenerated after D-024). The CSV is `benchmark/cost/cost_model.csv` (6 scenarios × 7 mixes × 3 cache rates, plus realtime variants). Before figures come from `benchmark/cost/cost_model.before_D018.json`.

**Configured default mix, no Google TTS key** (`default`), 0% shared cache:

| Cost component | 30-min Walk | 30-min Drive (urban) | 30-min Drive (highway) | 60-min Interactive Walk | 30-min + 5 min Realtime | High-density stress case |
|---|---:|---:|---:|---:|---:|---:|
| Maps / map loads | $0 | $0 | $0 | $0 | $0 | $0 |
| Places / discovery (auto) | $0 (22.9 Wikimedia queries) | $0 (38.6) | $0 (9.1) | $0 (45.8) | $0 (22.9) | $0 (150) |
| Places / NearbySearch (asked) | $0 | $0 | $0 | $0.032 | $0 | $0.096 |
| Place details / Routes / Evidence | $0 | $0 | $0 | $0 | $0 | $0 |
| LLM generation | $0.0027 | $0.0013 | $0.0002 | $0.0057 | $0.0027 | $0.0035 |
| TTS | $0.3034 | $0.1087 | $0.0165 | $0.6222 | $0.3034 | $0.3426 |
| Realtime/STT | $0.0002 | $0 | $0 | $0.0008 | $0.0626 (gpt-realtime-2.1-mini) | $0.0014 |
| Storage/egress | $0.0001 | $0.00004 | $0.00001 | $0.0002 | $0.0001 | $0.0001 |
| **Total variable cost** | **$0.306** | **$0.110** | **$0.0167** | **$0.661** | **$0.369** (Gemini Live $0.350; gpt-realtime-2.1 $0.496) | **$0.444** |
| Narrated minutes (body + prefix) | 20.1 | 7.2 | 1.1 | 41.2 | 20.1 (+5 realtime) | 22.7 |

**Scenario assumptions** (unchanged unless noted):
- **30-min walk.** Dense-urban walking and stationary rates from the WTC and Art Institute replays: 18.6 stories/h and 45.8 place queries/h; stories capped at the director cadence with LLM-length prose; 1 follow-up question, EN, 0 realtime minutes.
- **Urban drive.** The urban-driving slices of the Golden Gate replay (0–565 s) and the transition replay (992–1,826 s): 20.6 stories/h, **77.2 queries/h (was 87.5)**, no questions.
- **Highway drive.** I-40 replay, 2.85 stories/h, **18.25 queries/h (was 32.5)**, no questions.
- **60-min interactive walk.** Walking rates plus 4 questions, 2 of which fall through the rules to the LLM intent, plus 1 NearbySearch (coffee, handled by rules).
- **30 min + 5 min realtime.** 30-min walk plus one 5-minute burst: 30% user and 40% assistant audio per active minute, 10 turns.
- **Stress case (policy upper bound, not replayed).** Dense walking with every throttle at its floor: 300 queries/h and 19.7 maximum-length Ida stories/h; 6 questions, all via the LLM, and 3 NearbySearch.
- **Common to all:** LLM prose fills 85% of the body budget, 10% grounding retry rate, 6.0 characters per word (measured from replay prose); the body budget is the decided story budget minus the 20-word prefix reserve, rounded down to 10 words; the prefix (≈ 8–10 words) is a separate TTS call, modeled as never cached.

**With the tiered routing** (`tiered`: `GOOGLE_TTS_API_KEY` set, DEFAULT_TTS_TIERS: highway bodies and prefixes on WaveNet, everything else standard) only the highway column changes: **$0.0040** (TTS $0.0038). Walking, urban driving, answers and acks stay on the standard voice, so those totals equal the default mix. Walking narration on the economy tier is one setting (`TTS_TIER_WALKING=economy`); the all-WaveNet sensitivity row below bounds it at ≈ $0.07 per 30-minute walk.

### 9.1 Before / after (default mix unless stated; ESTIMATED)

| Scenario | Before 0% | After 0% | Before 50% | After 50% | After tiered 0% / 50% |
|---|---:|---:|---:|---:|---:|
| 30-min Walk | $0.318 | $0.306 | $0.162 | $0.161 | $0.306 / $0.161 |
| 30-min Drive (urban) | $0.137 | $0.110 | $0.068 | $0.059 | $0.110 / $0.059 |
| 30-min Drive (highway) | $0.0186 | $0.0167 | $0.0093 | $0.0090 | **$0.0040 / $0.0021** |
| 60-min Interactive Walk | $0.683 | $0.661 | $0.372 | $0.371 | $0.661 / $0.371 |
| Truck month (176 h) | $8.76 | $8.08 | $5.49 | $5.36 | **$3.61 / $2.96** |

What moved the numbers:
- **Prompt trim and the context-free body prompt** cut LLM input tokens 37–43%, but the LLM is under 2% of a session, so the effect on dollars is ≈ $0.001 per session. It matters more for latency and for premium LLMs.
- **Spoken words per story shrank.** The body budget deducts a 20-word prefix reserve and rounds down to a 10-word bucket, while the spoken prefix is only ≈ 8–10 words: walking 369 → 345 body + 10 prefix words, highway 144 → 120 + 8, urban 147 → 109 + 8. About half of the urban drop (147 → 133 words mean decided budget) is a side effect of the D-024 probe backoff changing decision timing in the replay slices (same targets, slightly different lead time), and the rest is the prefix reserve. Shorter bodies are product-visible (D-018 tradeoff) and cheaper; **walking barely moved** (−4% words) so its total barely moved.
- **The 80% truck cell is slightly worse than before ($3.73 vs $3.53)** because the prefix is a separate TTS call that the model treats as never cached (`prefixAudioHit = 0`, conservative). That is a real cost of the primitive split, ≈ $0.1–0.2 per month on a driver plan.
- **The big lever is the tier, not the cache:** tiered routing takes the truck month from $8.08 to $3.61 at 0% cache; the cache then takes it to $2.96 (50%) and $2.57 (80%). The remaining $1.41 of that is the assumed 0.25 explicit NearbySearch calls per hour.

**By mix and shared-cache rate** (total per session: 0% / 50% / 80%):

| Mix | 30-min Walk | 30-min Drive urban | 30-min Drive highway | 60-min Interactive | 30+5 Realtime | Stress |
|---|---|---|---|---|---|---|
| Economy (tts-1, device STT) | 0.264 / 0.139 / 0.064 | 0.092 / 0.050 / 0.024 | 0.014 / 0.008 / 0.004 | 0.573 / 0.323 / 0.173 | 0.326 / 0.201 / 0.126 | 0.394 / 0.270 / 0.195 |
| Configured default | 0.306 / 0.161 / 0.074 | 0.110 / 0.059 / 0.029 | 0.017 / 0.009 / 0.004 | 0.661 / 0.371 / 0.197 | 0.369 / 0.224 / 0.137 | 0.444 / 0.299 / 0.213 |
| **Tiered routing (highway on WaveNet; adapter implemented)** | 0.306 / 0.161 / 0.074 | 0.110 / 0.059 / 0.029 | **0.004 / 0.002 / 0.001** | 0.661 / 0.371 / 0.197 | 0.369 / 0.224 / 0.137 | 0.444 / 0.299 / 0.213 |
| Gemini stack (2027 prices) | 0.374 / 0.197 / 0.091 | 0.135 / 0.073 / 0.036 | 0.020 / 0.011 / 0.005 | 0.800 / 0.446 / 0.233 | 0.436 / 0.259 / 0.153 | 0.521 / 0.345 / 0.239 |
| Premium voice (Sonnet 5 + ElevenLabs) | 0.924 / 0.486 / 0.223 | 0.328 / 0.176 / 0.085 | 0.051 / 0.027 / 0.013 | 1.929 / 1.053 / 0.528 | 0.986 / 0.548 / 0.286 | 1.145 / 0.708 / 0.447 |
| All-WaveNet (sensitivity: every purpose on economy) | 0.073 / 0.038 / 0.018 | 0.025 / 0.014 / 0.007 | 0.004 / 0.002 / 0.001 | 0.181 / 0.113 / 0.072 | 0.135 / 0.101 / 0.080 | 0.179 / 0.145 / 0.125 |
| RISK: Places for auto discovery | 1.039 / 0.894 / 0.806 | 1.345 / 1.295 / 1.264 | 0.309 / 0.301 / 0.296 | 2.125 / 1.835 / 1.661 | 1.101 / 0.956 / 0.869 | 5.244 / 5.099 / 5.013 |

**The 50% and 80% columns are ASSUMED production hit rates.** The code can now reach them (D-018), and the in-process harness measures 100% body hits on a one-route repeat (§11), but that says nothing about how often real users share a place, angle, guide and budget bucket. Treat 50/80% as scenarios, not forecasts.

Two further consequences:
- **Premium voice exceeds the default `usdPerSession` budget of $1.00** in the 60-minute interactive walk (1.93 at 0% cache). The session would degrade to template or text-only output part-way through.
- **Walking narrates about 67% of the time with LLM-length stories:** 20.1 of 30 minutes. That is a product-policy observation as much as a cost one (§16).

![Per-session cost by component](../deliverables/charts/cost_per_session_by_component.png)

## 10. Unit Economics Scenarios

This is an engineering model. **Every revenue, pricing and usage input is a HYPOTHESIS.** Fixed infrastructure costs are **ASSUMPTIONS**, not sourced. Free-tier caps and Google free quotas are ignored. The CSV is `benchmark/cost/unit_economics.csv`.

| Assumption | Small | Medium | Large |
|---|---:|---:|---:|
| MAU | 1,000 | 25,000 | 250,000 |
| Active sessions/user/month | 2.08 (payers 6, free 2: HYPOTHESIS) | 2.08 | 2.08 |
| Avg session minutes | 34.8 (mix: 45% walk30, 20% urban drive, 15% highway, 15% interactive 60, 5% walk + realtime) | 34.8 | 34.8 |
| Avg variable cost/session | $0.280 (default, 0% cache) · $0.153 (50%) · $0.152 (tiered + 50%) | same | same |
| Monthly variable infrastructure cost | $583 · $318 · $316 | $14,585 · $7,952 · $7,899 | $145,849 · $79,525 · $78,991 |
| Fixed infrastructure estimate | $60 (1 VPS, backups, domain) | $450 (2–3 API VPS, managed PG + Redis) | $4,000 (multi-instance, managed data, CDN, self-hosted Wikidata/OSM) |
| Total technical COGS | $643 · $378 · $376 | $15,035 · $8,402 · $8,349 | $149,849 · $83,525 · $82,991 |
| Example subscription / revenue assumption* | 2.1% of MAU pay $39.99/yr, net of 15% store fee = $59/mo | $1,487/mo | $14,871/mo |
| Implied gross margin* | −982% · −536% · −532% | −911% · −465% · −461% | −908% · −462% · −458% |

\*These are hypotheses, not validated externally. The 2.1% is RevenueCat's median day-35 freemium conversion (MARKET.md); $39.99/yr is Explorer Annual (MONETIZATION.md §3).

**Reading the table:**
- **A paying user is profitable.** 6 sessions × $0.280 = $1.68/mo against $2.83/mo net revenue, a **41% variable margin** on the default mix at 0% cache (was 38%).
- **The free tier is not affordable at 2.1% conversion.** Revenue per MAU ($0.06) funds **0.21 default-mix sessions per MAU per month** (was 0.20). Break-even needs **≈ 34–36% paying users** at 0% cache (was ≈ 37%). The `tiered` column is almost identical to `default` here because this session mix is 80% walking and urban driving, which stay on the standard tier; the tier only pays off for highway-heavy (driver) users.
- **What fixes it (all in combination):**
  - Hard free caps well below the "~30 narrated min/day" in MONETIZATION.md, such as one short session per week.
  - A decision to put walking narration on the economy tier (`TTS_TIER_WALKING=economy`; ≈ 4× cheaper TTS, voice quality unbenchmarked).
  - The story-primitive cache at a real production hit rate (built; rate unmeasured).
  - Trip passes, which this model ignores.

## 11. Cache Strategy & Measured Effect

**Harness hit rates are MEASURED on a one-route, fixture-corpus, in-process run. They are not production hit rates and should not be read as forecasts.** Production hit rates are NOT YET MEASURED (no traffic); the admin endpoint `/v1/admin/metrics/providers` exposes process-since-start counters for every layer (`cacheCounters`) so they can be read once there is.

| Cache layer | Key / scope | TTL/invalidation | Harness hit rate (MEASURED, 36 sessions per phase) | Assumed production rate (§9) | Cost avoided | Latency effect | Failure behavior |
|---|---|---|---:|---:|---|---|---|
| Discovery | `pl:v1:{geohash cell sized to radius}:{radius bucket}:{floor}:{kinds}:{lang}:{corridor fingerprint}`, shared across users (Wikimedia only; Google results never cached) | 15 min | places 90/91 (cold phase), 72/72 (cached phases) | not assumed (free, rate-limit headroom) | Wikimedia requests | sim 500 / 1,500 ms per miss avoided | Redis down → in-process LRU (20k) + reduced mode: no density probe, ≥ 90 s between discovery fetches, 30/min process-wide (F5: 1 call per 300 frames) |
| Evidence | `ev:v1:{placeId}:{lang}`, shared; negative results cached | 7 days; negative 6 h | evidence 36/36 in every phase | not assumed | Wikimedia requests | sim 400 / 1,200 ms per miss avoided | same fallback; transient failures are not cached as thin |
| **Narration body (D-018)** | `nb:v1:body_sp1…` = hash(place, name, angle, mode, guide, locale, budget bucket, fact ids + text hashes); no session, time, position or memory | 30 days; bump `STORY_PRIMITIVE.VERSION` to invalidate | cold 0/36; body-cached phases **36/36** | 50% / 80% (ASSUMED) | story LLM (input + output), shared across users | LLM call removed on a hit | LLM outage: template body is returned but **never cached**; concurrent misses are de-duplicated; Redis down → generate directly, counted as `notCached` |
| **TTS / media (content-addressed)** | sha256(segment text, provider, model, **tier/language voice**); immutable URL | Never expires (disk) | cold 0/290; body-cached/audio-evicted 5/132 (prefix text repeats); fully warm **140/144** | body audio shares the body's rate; prefix audio modeled at **0%** | TTS characters | cached prefix + body audio → first audio in 6 ms (loopback) | Fallback-provider audio held in memory 1 h and never stored under the planned key; synthesis failure → text + device TTS (F4) |
| Prefix (quantized cue + place) | exact text → same content-addressed audio store | same | 5/132 hits across 36 sessions in the audio-evicted phase | 0% (conservative) | ≈ 10 words of TTS per story | prefix is segment 0 and gates first audio | same |
| Routes/ETA | Not used | – | – | – | – | – | – |

Harness phases (counters read before/after each phase): **cold** (body and audio cleared before every session): body 0/36, audio 0/290. **Body cached, audio evicted:** body 36/36, audio 5/132, mean first audio 448 ms. **Fully warm:** body 36/36, audio 140/144, first audio 6 ms. A single WTC route repeated is the best case for any cache; the number to watch in production is the narration-body line of `cacheCounters`.

**Why sharing the body does not leak user data (D-018).** The cache key and the generation brief are built only from the public evidence pack, the place, the angle, the guide, the locale, the mode and a rounded word budget. They contain no session id, user id, timestamp, position or journey memory, so nothing a user said or where they are can reach cached text. Everything personal (the quantized spatial cue and an optional journey callback) is confined to a short deterministic **prefix** that is spoken as its own segment and is never stored as prose. A test asserts the cache entry contains no session or user ids and that two users get byte-identical bodies. Only grounded LLM output is cached; a template fallback caused by an LLM outage is never cached. **Residual risk:** the prefix audio URL is public but unguessable (sha256) and immutable; a prefix with a journey callback names a place this user passed earlier, so it is low risk and documented, not mitigated. The prefix/body split also adds a second TTS call per story and a seam that is audible only if the two use different voices (default: same tier).

## 12. Provider Call Budgets & Rate Controls

Values are the defaults from `DEFAULT_BUDGET` (`packages/providers/src/resilience.ts`). They can be changed in the admin console and persisted in `provider_budgets`.

| Paid operation | Per-session limit | Time-window limit | Deduplication | Fallback when exhausted |
|---|---:|---:|---|---|
| Automatic discovery | `maps` 240 / `knowledge` 600 calls (Wikimedia counts as knowledge); refresh throttle (20–60 s min interval, movement-based, empty-result backoff ×2 up to ×8) | 600/min `maps`, 1,200/min `knowledge` process-wide | 15-min shared place cache; per-session candidate reuse between refreshes | no new candidates → silence (director); reduced mode when cache is down |
| Place details | not called | – | – | – |
| Evidence/search | `knowledge` 600 | 1,200/min | 7-day cache + per-session pack map | place treated as unavailable (no story; not permanently thin) |
| LLM generations | `llm` 200 (≤ 2 per story body: one constrained retry; zero on a body-cache hit; streamed answers are one call) | 600/min | intent rules before LLM; retried `utteranceId` never re-runs | deterministic template (story) / deterministic answer (follow-up) / heuristic intent |
| TTS | `tts` 600 | 1,200/min | in-flight de-dup by audio key; content-addressed store | text in directive → device TTS (F4) |
| Realtime active minutes | `realtime` **30 tokens** (was 6), **900 s** per session, token `maxSeconds` 300 **reserved then reconciled** (D-022), idle close 20 s | 60 tokens/min | reservation id, reconciled once | 429 `realtime_budget_exhausted` → hybrid loop |
| All categories | **$1.00 estimated per session** (from the price table) | – | – | budget refusal stops the fallback chain (no fan-out) |
| NearbySearch (tool) | ToolPolicy 3 per 60 s | REST route 30/min/IP | `utteranceId` de-dup | spoken "limited" phrase |

**Two observations:**
1. **Realtime reservations are now reconciled. FIXED (D-022).** `/v1/realtime/token` reserves seconds and returns a `reservationId`; `/v1/realtime/usage` credits back unused reserved seconds exactly once (used = max(client-reported, wall time since the token), clamped to the reservation). Evidence: `apps/api/test/cost-latency.test.ts` "D-022" (12 short bursts are allowed up to the real cap; a capped session ends with `realtimeSecondsLeft` 620 → 340 → 60; unreported bursts stay reserved). The remaining caveat is that a client that never reports keeps its full reservation spent (fail-closed).
2. **Per-session caps assume sessions of normal length.** An 8-hour trucker session uses about 23 stories and 8 questions, which is well inside the caps. Configuring Google Places for discovery would exhaust the 240 `maps` calls in about 7 hours.

## 13. Failure-Loop Cost Tests

The evidence is `apps/api/test/resilience.test.ts` (REST frames at 1 Hz over the WTC trace; real Postgres, and Redis unless stated) plus `packages/providers/test/resilience.test.ts`. The call counts are the ones these tests printed in this run.

| Failure condition | Expected bounded behavior | Calls observed | Cost risk | Result | Evidence |
|---|---|---:|---|---|---|
| Empty discovery result | no paid refresh per GPS update; exponential backoff | 4 place calls / 300 frames (API); ≤ 40 / 3,158 frames on the empty 105-min highway replay | none | PASS | api "F1: empty discovery"; replay "F1 — Empty discovery result" |
| Maps quota exceeded (429) | single attempt, breaker opens with a 10-min hard cooldown | 1 / 300 frames | none | PASS | api "F2: quota exceeded" |
| Provider timeout | ≤ 1 retry, breaker after 3 failures, 30 s cooldown with a single half-open probe | 3 attempts / 300 frames (test bound ≤ 6) | low | PASS | api "F2: place provider timeouts" |
| Invalid credential (401) | single attempt, hard cooldown | 1 / 300 frames | none | PASS | api "invalid credential" |
| Redis/cache unavailable | explicit reduced mode; `/readyz` degraded; no storm | 1 place call / 300 frames; narration continues | none | PASS | api "F5: cache (Redis) unavailable" |
| LLM failure | template story for the same target; ≤ 2 LLM calls per story | ≤ 2 per story (hallucinating LLM); kill switch → 0 | none | PASS | api "F3" ×2 + kill-switch test; providers "never substitutes the target" |
| TTS failure | text delivered, `audioUrl` null, conversation continues | ≤ 4 TTS attempts total (breaker) | none | PASS | api "F4: TTS down" |
| Realtime connect failure | no retry (`noRetry`), breaker, budget | 1 attempt per token request (by construction; no dedicated API test) | low | PARTIAL | router code + providers ProviderGuard tests; no realtime-specific API test |
| Network flap | resume delivers only missed directives; retried utterance does not re-run the tool | 1 NearbySearch despite a retried `utteranceId`; 0 duplicate directives | none | PASS | api "E3: reconnect"; client "SessionChannel (E3 reconnect)" |

**No failure created an unbounded paid retry loop.** No unbounded retry exists in the code: `retryOnce` is hard-capped at one retry.

## 14. Scaling Model

- **State boundaries.** `SessionRuntime` is hot in one API process, and a WebSocket is pinned to that instance. After every event a snapshot goes to Redis (24 h TTL), so a restart or a reconnect to another instance resumes exactly (E3). Journey memory is saved to Postgres periodically.
  - Horizontal scaling needs sticky WS routing, or cross-instance directive fan-out. Today the outbox lives in the owning process; resume via snapshot works, but live fan-out does not.
- **Database.** Telemetry is buffered: flushed every second, 5,000-row buffer per stream, and dropped (with a count) on outage, never blocking. Postgres sees batched inserts of costs, events, latency samples and stories. It is not a hot-path dependency: sessions run in Redis and memory.
  - Load at scale is **NOT YET MEASURED**. Estimate: a few rows per session-minute.
- **Redis.** Hot session snapshots, rate limits, and place/evidence caches. Loss of Redis puts the process in reduced mode (F5).
- **Queue / background work.** None. TTS for the body segment starts in parallel with the prefix, segments 2..n are pipelined in-process after `play`, and streamed follow-up sentences are synthesized as they complete.
- **WebSocket limits.** One socket per active session; Fastify/ws limits are **NOT YET MEASURED**. CPU per frame is small: context ingest is about 0.1 ms p95 over 648 frames (MEASURED-harness). Scoring is not instrumented separately.
- **Provider quotas.** **The binding constraint is the Wikimedia rate limit.** Per session-hour the replays make:

  | Mode | Wikipedia/Wikidata HTTP requests per hour |
  |---|---:|
  | Walking | 92 |
  | Highway (heading / route corridor) | 55 / 68 (was 84 / 97) |
  | Urban driving | 154 (was 175) |
  | Transition (highway → downtown → walk) | 105 (was 127) |

  Wikimedia allows 5,000 req/h per IP with a token and 500 without. One egress IP with a token therefore supports only **≈ 32–90 concurrent sessions** before cache sharing (was 30–55), or ≈ 3–9 anonymous. The page for these limits is marked draft and the SPARQL limits could not be fetched.
  - Migration trigger: more than ~20 concurrent sessions sustained.
  - Response: a self-hosted Wikidata/OSM extract or a Wikimedia Enterprise agreement, and pre-warming of popular corridors.
  - Paid-provider quotas (OpenAI, Google) are **NOT YET MEASURED**.
- **Process-local budget windows.** `ProviderBudget` per-minute windows are per process, so N instances allow N× the global cap. Moving the windows to Redis is required before going multi-instance.
- **Media storage and egress.** Audio is on a local volume. Multi-instance needs shared object storage behind a CDN: files are immutable and content-addressed, which suits a CDN. About 10 MB of mp3 per 30-min walk at 64 kbps.
- **Single-VPS MVP limits.** One process, one Redis, one Postgres, local audio. Expected ceiling: the Wikimedia limit (tens of concurrent sessions), well before CPU.
- **Migration triggers:**
  - > 20 concurrent sessions: Wikidata extract and Redis-backed budget windows.
  - > 1 instance: sticky WS routing, object storage, CDN.
  - > 1k DAU: managed Postgres and Redis, provider-quota review.

## 15. Optimization Decisions

| Decision | Benefit | Cost / downside | Evidence | Status |
|---|---|---|---|---|
| Wikimedia-first discovery; Places only for explicit questions | Automatic discovery $0 instead of $0.31–1.35 per 30 min ($111 per driver-month) | Rate limits; no business data (hours, ratings) in discovery | cost_model `places_discovery` mix | accepted |
| Discovery refresh throttle + empty backoff | 18–77 queries/h vs 3,600 GPS fixes/h | Staler candidates between refreshes (re-scored locally) | replay + F1 tests | accepted |
| Content-addressed segment audio | Cheap re-play and resume; CDN-friendly | – | §11 | accepted |
| **Story primitive: shared context-free body + uncached template prefix (D-018)** | No LLM call on a body hit; first audio = prefix (448 / 883 ms with audio evicted; 6 / 28 ms fully warm in the harness) | Body cannot reference the journey; one canonical telling (temperature 0); a second, short TTS call per story; production hit rate unmeasured | `cost-latency.test.ts` D-018 (3 tests), harness `cacheRates`, §11 | **FIXED** (was "deferred, highest priority"); hit rate in production NOT YET MEASURED |
| **Cheaper TTS tier + Google Cloud TTS adapter (D-019)** | Highway story TTS ≈ 4× cheaper: 30-min highway $0.0167 → $0.0040, truck month $8.08 → $3.61 at 0% cache | Voice quality unbenchmarked (guide voices PENDING BENCHMARK); pricing page not re-fetched in this revision; walking stays on the standard tier | `streaming.test.ts` (adapter, config, tier, fallback), `cost-latency.test.ts` D-019, cost_model `tiered` | **FIXED for the cost mechanism**; voices and walking-tier decision open |
| **Remove the JSON payload block from real-LLM prompts (D-021)** | Walking story input 915 → 544 tokens (−41%), highway 812 → 512 (−37%), follow-up 981 → 556 (−43%), intent 281 → 250 (−11%) | Fakes/tests read `structured`; LLM quality with the leaner prompt NOT YET MEASURED | `promptTrim` in cost_model.json; `streaming.test.ts` "prompt trim" | **FIXED** |
| **Stream follow-up answers with per-sentence grounding and TTS (D-020)** | Follow-up p50 / p95 2,840 / 4,915 → 1,950 / 3,380 ms (simulated) | No constrained retry on streams; first-token share assumed (`ttftShare` 0.45); new `say_append` client path | §5.1; `cost-latency.test.ts` D-020 (4 tests); adapters' SSE tests | **FIXED in simulation** (3% p95 margin; real providers NOT YET MEASURED) |
| **Fewer highway density probes (D-024)** | I-40: probes 44 → 19, queries 32.5 → 18.2 per hour; Wikimedia 84 → 55 req/h; Places-discovery risk $192 → $111 per driver-month | Density class can be stale for a few probe intervals; hints only prove "denser" | replay summary diff (stories, targets, silence unchanged); `story-primitive.test.ts` backoff + hint tests; F1 tests green | **FIXED** |
| **Realtime reservations reconciled (D-022)** | Many short bursts allowed up to the real 900 s cap (was 3 bursts) | Client must report usage; unreported bursts stay reserved | `cost-latency.test.ts` D-022 | **FIXED** |
| **Cross-session retell policy (D-023)** | A returning user is not told the same place within 30 days (`RETELL_AFTER_DAYS`, default 30); history is per user/guest, 90-day retention, deletable | Same-route users hear different places for 30 days; times are only as accurate as the client clock | `cost-latency.test.ts` D-023 (3 tests); `story-primitive.test.ts` retell tests | **FIXED** |
| Hybrid voice instead of always-on realtime | Cost bounded to spoken minutes | Slower turn-taking than realtime (unmeasured) | D-010 | accepted (provisional) |
| Per-session USD cap $1.00 | Hard stop on runaway sessions | Premium voice exceeds it in 60 min | §9 | accepted; tune per tier |

## 16. Open Performance / Cost Risks

| Risk | Impact | Likelihood | Detection metric | Mitigation | Owner/status |
|---|---|---|---|---|---|
| Free tier unaffordable at plausible conversion | High | High (model) | cost per MAU vs revenue per MAU (admin cost view) | hard free caps, walking-tier decision, primitive cache (built), passes | product + eng / **open** (0.21 sessions per MAU funded, was 0.20) |
| TTS price dominates (95%+ of cost) | High | Certain | $ per narrated minute | economy tier + adapter built (D-019); audition voices; decide walking tier; cache | eng / **partly fixed**: highway 4× cheaper; walking unchanged by default |
| Wikimedia rate limits cap concurrency at tens of sessions | High | High at launch | 429s from Wikimedia; `provider_error` events | token, Wikidata/OSM extract, corridor pre-warm | eng / open |
| Real provider latency exceeds simulated profile (follow-up now meets p95 in simulation with only 3% margin, resting on the `ttftShare` assumption) | Medium | Medium | `speech_end_to_first_audio` p95 in admin latency | streamed per-sentence TTS is built (D-020); measure real TTFT; smaller answer budgets; D-010 | eng / **partly fixed**, margin thin |
| Walking narration ~69% of the time with LLM-length stories | Medium (UX + cost) | Medium | narrated minutes per session-hour | revisit walking `maxStoryS` / `minGapS`; count narrated minutes toward the free cap | product / open |
| Driver-plan margin ≈ 0 without cache (default mix $0.046/h vs $0.03/h target) | Medium | High without the tier | cost per highway hour | tiered routing ($0.021/h at 0% cache, $0.015/h at 80%), primitive cache, fewer density probes (built) | eng / **FIXED** if `GOOGLE_TTS_API_KEY` is set and the economy voice passes the audition |
| Driving stories can exceed the regime's stated hard cap: highway `maxStoryS` 75 s × Ida verbosity 1.15 = 86 s (transition replay shows 86 s budgets) | Medium (E1 safety wording) | Certain for Ida | `durationBudgetS` in story events | clamped: verbosity can only shorten stories while driving (`storyBudget`, regression test `story-cap.test.ts`); transition replay now shows 75 s highway / 60 s urban | core / **fixed** (commit after benchmark run) |
| Realtime budget reserves 300 s per token and never reconciles (max 3 bursts per session) | Low (UX) | Certain | `realtime_budget_exhausted` 429s | credit unused seconds on `/v1/realtime/usage` | api / **FIXED** (D-022; test: 12 short bursts up to the real cap) |
| Repeat routes re-tell the same stories (memory is per session; new sessions start empty) | Medium for truckers | High on commutes | repeated place ids per user | `place_history` per user/guest, retell after 30 days (D-023) | api / **FIXED** (a stronger repeat-listener policy such as 'only new angles' is open) |
| Process-local budget windows under multi-instance | Medium | When scaling | provider spend per minute | Redis-backed windows | eng / open |
| Gemini promo ends 2027-01-01 (prices double) | Low–Medium | Certain | price table date | model already priced at 2027 | eng / accounted |
| Premium mix trips the $1 session cap mid-session | Low | If premium enabled | `session_usd` budget refusals | per-tier caps | eng / open |
| Economy voice ids are unverified candidates and the Google pricing/voices pages could not be re-fetched | Medium | Medium | `googleTtsListVoices`; audition rubric | verify ids against the live voice list, audition EN/RU, re-fetch pricing and update `pricing.ts` + JSON with a retrieval date | eng / open |
| Shared-body hit rate in production unknown; the harness 100% is a single-route repeat | Medium (cost) | Unknown | narration-body line of `cacheCounters` | measure; the 50/80% columns are scenarios only | eng / open |
| Streaming follow-ups: no constrained retry; web/mobile `say_append` paths not device-tested; client ordering relies on emission order | Medium | Low–Medium | `question_asked` telemetry, device QA | legacy clients keep one `say`; test on devices | client / open |
| `place_history` clamps told-times to server now; migration 003 replaces `run_retention()` | Low | Low | retention results in the ledger | review before deploying to an existing database | api / open |

## 17. Final Scorecard

| Area | Target | Actual / estimate | Status | Notes |
|---|---|---|---|---|
| Native startup | 1.5 s / 3.0 s | NOT RUN (no builds) | NOT RUN | D-016 credentials |
| Trigger -> first audio | 2.5 s / 4.5 s | 1.66 s / 2.68 s (MEASURED-harness, simulated providers; was 1.88 / 3.77) | PARTIAL | inside target in simulation; real providers and device playback not measured |
| Cached story -> first audio | 0.5 s / 1.0 s (revised) | 0.45 s / 0.88 s (body cached, audio evicted); 6 ms / 28 ms fully warm (MEASURED-harness, loopback) | PARTIAL | inside target in simulation; production hit rate and device playback not measured |
| Barge-in stop | 150 / 300 ms (device) | server round trip 1.0 / 1.5 ms (loopback); device NOT YET MEASURED | PARTIAL | local stop precedes the round trip; B3 stale-output test passes |
| Simple follow-up latency | 2.0 s / 3.5 s | follow-up 1.95 s / 3.38 s (was 2.84 / 4.92); coffee 1.25 s / 2.33 s (MEASURED-harness, simulated) | PARTIAL (was FAIL) | **FIXED in simulation** by streamed per-sentence TTS; 3% p95 margin, assumes first-token at 45% of LLM latency; real providers NOT YET MEASURED |
| Nearby search latency | 1.5 s / 2.5 s | 0.70 s / 1.54 s speech end → map (simulated) | PARTIAL | inside target in simulation |
| 30-min walking variable cost | ≤ $0.15 | $0.306 (ESTIMATED, default, 0% cache; was $0.318); $0.161 at an ASSUMED 50% body-cache hit; ≈ $0.07 if walking narration moves to the economy tier | FAIL (default) | TTS 99%; the walking tier decision, not the cache, closes the gap |
| 30-min driving variable cost | ≤ $0.10 urban; < $0.03/h highway | $0.110 urban (was $0.137); highway $0.0167 per 30 min = $0.033/h default, **$0.0040 = $0.008/h tiered** (ESTIMATED; session-model hourly, excludes the truck model's questions and nearby calls) | urban FAIL (slightly above); highway PASS with the tier | truck-month model including questions: $0.046/h default, $0.021/h tiered |
| Realtime active-minute cost | ≤ $0.02 | $0.0117 (gpt-realtime-2.1-mini), $0.0087 (gemini-3.8-live), ESTIMATED | PARTIAL | list-price estimate only; realtime NOT RUN |
| Failure-loop containment | zero unbounded loops | 0 unbounded; all 8 failure tests bounded (1–4 calls) | PASS | §13 |
| Provider replaceability | required | Interfaces + ordered fallback chains + fakes; all tests swap providers | PARTIAL | no real provider exercised or swapped live |

**Acceptance summary** (`benchmark/acceptance/results.json`, run 2026-10-04): PASS 13 · PARTIAL 8 · FAIL 0 · NOT RUN 6 (unchanged counts; the scenario evidence strings were refreshed: A5 now shows 18.2 queries/h instead of 32.5, and every harness-session check still passes 36/36). No acceptance row changed status because none depended on the numbers that moved; the changes show up in the scorecard above.

| ID | Status | Evidence (one line) |
|---|---|---|
| A1 | PASS | 9/11 Memorial first story at 361 m; local targets precede distant; reversed provider order gives identical selection (replay) |
| A2 | PASS | Bridge first story at 5.8 km (reach 12.2 km) vs small-POI reach; Vista Point suppressed with reasons |
| A3 | PASS | Art Institute first at 426 m; farther objects never precede; enclosing city is ambient |
| A4 | PASS | Thin evidence → ≤ 1 fact-free orientation line, never a story; 0 grounding failures |
| A5 | PARTIAL | I-40: 5 stories, 0 behind, 98.7% silence, 18.2 queries/h (was 32.5; D-024), rejections with reasons; real-road run NOT RUN |
| A6 | PASS | highway→urban→stationary→walking in one session, 0 restarts, no re-tells; drive HUD e2e |
| A7 | PARTIAL | Same code and config in three cities (fixture source); live Wikimedia flow NOT RUN (no egress) |
| B1 | PARTIAL | Follow-up draws unspoken facts from the same pack; LLM non-repetition NOT RUN |
| B2 | PARTIAL | Same lead fact for both Guides in 31/31 packs; persona prose + human rubric NOT RUN |
| B3 | PARTIAL | Callbacks only from structured memory; LLM coherence NOT RUN |
| C1 | PASS | 36/36 harness sessions: stop, preserve, validated map, grounded answer, resume same plan; ≈ $0.035 per coffee turn (ESTIMATED) |
| C2 | PASS | No place or nearby call on follow-up (36/36); grounded against the active brief |
| C3 | PASS | Topic change abandons the story; old plan never replays |
| D-B1…B6 | NOT RUN | Realtime credentials not supplied (hybrid-path B3 analogue passes) |
| E1 | PARTIAL | Drive HUD, stricter cadence, holds on manoeuvre and touch; real vehicle/device NOT RUN |
| E2 | PARTIAL | Background logic unit-tested, OS table documented; devices NOT RUN |
| E3 | PARTIAL | Exactly-once resume, no tool re-run; on-device playback during outage NOT RUN |
| F1–F5 | PASS | Bounded calls in every failure test (§13) |

**Section G metrics** are in `results.json → sectionG`, each with its label:
- Relevance regression: 100% of replay relevance assertions passed.
- Wrong-target rate: 0/33 replay stories.
- Weak-evidence grounding failures: 0.
- Latency percentiles as above (§5.1).
- Session costs as in §9.
- Cache hit rates by layer: harness-measured per phase (§11, `results.json → cacheRates`); production NOT YET MEASURED.

## 18. Evidence Index

- **Raw benchmark JSON/CSV:**
  - `benchmark/acceptance/results.json`: scenario rows A1…F5 + D, per-test evidence, suites, web e2e, harness checks, section G, C1 cost.
  - `benchmark/acceptance/latency.json`: p50/p95 (incl. `cachedStoryToFirstAudio`, `cachedWarmStoryToFirstAudio`), method, simulated latency profile (incl. `ttftShare`), observed draws.
  - `benchmark/cost/cost_model.json` (now with `promptTrim` and `beforeAfter`), `cost_model.csv`, `truck_driver_month.csv`, `unit_economics.csv`, and `cost_model.before_D018.json` (the committed 2026-09-28 output, for before/after).
  - `benchmark/replay/*.json`: replay summaries, stories and timelines.
  - `benchmark/providers/2026-09-28T02-42-01-826Z.json`: provider bench with no keys.
- **Traces / logs:** replay timelines (`benchmark/replay/<scenario>.json → timeline`) with per-decision reasons and rejections. Test console counts are in `results.json → testConsole`. No secrets exist in any artifact.
- **Screenshots:** `deliverables/screenshots/web/*` (drive mode, debug timeline, admin demo views, labelled as demo).
- **Charts** (PNG + SVG), in `deliverables/charts/`:
  - `cost_per_session_by_component`
  - `truck_driver_month_vs_cache`
  - `latency_p50_p95_vs_targets`
  - `replay_timeline_interstate_transition`
  - `query_rate_vs_f1_cap`
- **Profiler captures:** none (NOT YET MEASURED).
- **Decisions:** D-018 … D-024 in `DECISIONS.md` (story primitive and cache, tiered TTS, streaming, prompt trim, realtime reconciliation, cross-session memory, density-probe backoff), each with its tradeoffs.
- **Provider-pricing references:** `docs/research/PROVIDER_PRICING.md`, `benchmark/research/provider_pricing.json`, `packages/providers/src/pricing.ts`.
- **Scripts that reproduce the calculations:**
  - `scripts/bench/acceptance.ts` (`pnpm bench:acceptance`)
  - `scripts/bench/cost-model.ts` (`pnpm bench:cost`)
  - `scripts/bench/charts.py` (`pnpm bench:charts`)
  - `scripts/bench/providers.ts` (`pnpm bench:providers`)
  - `pnpm replay`
- **Dashboard screenshots:** `deliverables/screenshots/web/admin-*-demo-labelled.png`. These show demo data, not measurements.
- **CI runs:** none yet (D-015 awaiting VPS/GitHub setup). Local `pnpm -r test` (2026-10-04): core 189, providers 104, replay 35, client 29, api 88, mobile 15 = **460 green** (was 409; the new files are `packages/core/test/story-primitive.test.ts`, `packages/providers/test/streaming.test.ts` and `apps/api/test/cost-latency.test.ts`); `pnpm -r typecheck` clean; web smoke e2e 5/5 in the bench run (the screenshot spec is deliberately not run by the bench because it rewrites committed screenshots).

![Latency vs targets](../deliverables/charts/latency_p50_p95_vs_targets.png)
![Truck driver month](../deliverables/charts/truck_driver_month_vs_cache.png)
![Replay timeline](../deliverables/charts/replay_timeline_interstate_transition.png)
![Query rate](../deliverables/charts/query_rate_vs_f1_cap.png)
