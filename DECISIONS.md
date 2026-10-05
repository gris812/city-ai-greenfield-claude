# Architecture & Product Decisions

Decisions are numbered, dated, and never silently rewritten: superseded decisions are marked and linked. Owner clarifications that drive decisions are in `docs/CLARIFICATIONS.md`.

Status legend: **Accepted** · **Provisional** (pending evidence/benchmark or owner input) · **Superseded**

---

## D-001 Monorepo, one language — Accepted (2026-09-27)
pnpm workspaces, TypeScript (strict) across server, web and mobile; Node 22 LTS.
- `packages/core` — pure, deterministic product brain (no I/O, no clock, no randomness; time and IDs are injected). Shared by API, replay harness and tests.
- `packages/contracts` is folded into `core/src/contracts.ts` to keep one source of truth.
- `packages/providers` — provider adapters (maps/places, knowledge, LLM, TTS, STT, realtime) behind interfaces, plus deterministic fakes.
- `apps/api` — Fastify HTTP/WebSocket API, Postgres, Redis.
- `apps/web` — public website + WebApp/PWA + web admin console (one Next.js app, three route groups — avoids three deployments and duplicated design system).
- `apps/mobile` — Expo (dev-client / EAS) React Native app for iOS and Android.
- `fixtures/` — replay traces and fixture POI packs (test/demo only, see D-005).
- `benchmark/` — acceptance scenarios, replay runner outputs, provider benchmarks.

*Why:* one type system for the contracts that cross every boundary; the replay harness exercises the exact production decision code.

## D-002 Product authority lives on the server — Accepted
The mobile/web clients are sensors, renderers and audio players. They send `ContextFrame`s and user intents; the server's `MomentDirector` returns `Directive`s (speak segment N, show map action, stay silent, open listening, resume at segment K). Ranking, speak-now timing, safety policy, duration budgets, resume/abandon and provider permissions are all computed server-side by `packages/core`.
- The client holds a bounded **prefetch** of already-decided audio segments so playback survives short connectivity drops (degraded mode), but it never picks targets.
- *Rejected:* on-device ranking (explicitly prohibited, and it would fork policy across two runtimes).

## D-003 LLM boundary — Accepted
LLMs are used only for: (a) turning an already-decided `StoryBrief` into speech-ready prose, (b) interpreting free-form user questions into a closed `Intent` enum + slots, (c) answering follow-ups **from the supplied evidence**. Every LLM output is post-validated deterministically (`GroundingCheck`: numbers, years, proper nouns must appear in evidence; length within budget; banned-content rules). On failure: one constrained retry, then a deterministic template fallback built from the same evidence. LLMs never receive tool permissions they can execute themselves; tool calls they propose are requests that `ToolPolicy` may deny.

## D-004 Location-first global discovery, no city coupling — Accepted (owner clarification C-001)
Discovery starts from the live `JourneyContext` (position, heading, speed, movement regime, route/trajectory, local density, journey memory). Nothing in production code knows city names or boundaries. Place candidates come from global providers (Google Places, Wikidata/Wikipedia geosearch) through the `PlaceSource` interface.
- Radii, look-ahead, cadence, max story length and safety rules are functions of **movement regime × local density**, never of city.
- A build-time test forbids production source from importing `fixtures/` or mentioning fixture city names.

## D-005 Fixtures are strictly separated — Accepted (C-001)
City POI packs and route traces (WTC/Ground Zero, Art Institute of Chicago, Golden Gate Bridge, U.S. Interstate routes, a highway→downtown→walking transition trace) live in `fixtures/` and are loaded only by `FixturePlaceSource` in tests, replay, and an explicitly labeled demo mode. Production configs cannot select `FixturePlaceSource` unless `DEMO_MODE=1`, and the UI labels demo/simulated data.

## D-006 Movement regimes with hysteresis — Accepted
Regimes: `stationary`, `walking`, `cycling`, `urban_driving`, `highway_driving` (+ `unknown`). Derived deterministically from a smoothed speed window, speed variance, stop frequency and (when available) road class. Entry/exit thresholds differ (hysteresis) and a regime must persist for a dwell time before switching, so a red light doesn't flip "driving" to "stationary". Local density (`sparse` / `suburban` / `urban` / `dense`) is derived from candidate counts per km² returned by the place source, smoothed over time. The transition chain highway → outskirts → urban → downtown → stationary/walking is therefore emergent, not configured.

## D-007 Trajectory-corridor discovery for driving — Accepted (C-001)
Radial search is used only for stationary/walking. For moving contexts the candidate area is a **corridor** ahead: along the route polyline when available, otherwise along a heading projection with widening cone. Each candidate gets along-track distance, cross-track offset and ETA. Candidates behind (along-track < 0, beyond a small tolerance) or materially off-course are suppressed. Look-ahead scales with speed **and** significance: a major city, river, mountain range or national landmark may be announced tens of kilometres ahead on a highway; a minor POI only within the walking/urban window. Silence is a first-class outcome: the `SilencePolicy` requires a minimum value score and enforces cadence gaps; long silent stretches on sparse highways are expected and tested.

## D-008 Driver safety policy — Accepted
In driving regimes: audio-first, no required screen interaction, no tap-to-choose prompts, no follow-up questions from the Guide, map shows glanceable state only, stories shortened to fit ETA-to-pass and capped by regime, no speech onset during high-maneuver signals (heading-change rate / deceleration spikes). Listening is only opened by an explicit user action (large tap target or voice button) — never automatically while driving at speed. These are `SafetyPolicy` rules with unit tests.

## D-009 Narrative pipeline with exact resume — Accepted
`EvidencePack` (normalized facts with provenance) → `StoryBrief` (deterministic: chosen angle, fact subset, duration budget, Guide persona, journey callbacks) → LLM prose → `GroundingCheck` → `NarrativePlan` (ordered **segments**, each a sentence-group with stable id and hash) → per-segment TTS (cached by hash+voice). Interruption records `{planId, segmentIndex, offsetMs}`; `ResumePolicy` deterministically chooses resume-from-segment-start, resume-with-bridge ("As I was saying…"), or abandon (target passed / stale / user moved on). Guides may differ in voice and phrasing but share the same facts.

## D-010 Hybrid voice, not always-on realtime — Provisional (benchmark pending)
Default loop: TTS narration + on-demand listening (push-to-talk or tap-to-interrupt) → STT → intent → answer → TTS. A realtime speech-to-speech session is opened only for active conversation bursts and closed after an idle timeout, gated by `ProviderBudget`. Candidates to benchmark when keys arrive: OpenAI Realtime vs Google Gemini Live for realtime; batch STT/TTS alternatives for the hybrid loop. Selection is recorded after the benchmark.

## D-011 Data stores — Accepted
Postgres 16 (system of record: users, devices, sessions, journey memory, stories, events, cost ledger, audit log), Redis 7 (hot session state, rate limits, place/evidence/story/audio caches with TTL). Audio segments are content-addressed and stored on a local volume behind the API (object storage optional later).

## D-012 Privacy-minimal telemetry — Accepted
Precise coordinates are processed in memory for the active session and kept in Redis only as a short rolling window. Postgres analytics store location as a coarse geohash (precision 5, ≈5 km) and movement regime only. Raw traces are never retained unless the user opts in to "save my journey". Retention: events 13 months, cost ledger 25 months, audit log 25 months, session memory 90 days for guests (deletable any time).

## D-013 Admin auth without static secrets — Accepted
No passwords in code. Admin console uses **WebAuthn passkeys**; the first owner is bootstrapped by a one-time code generated by a server-side CLI (`pnpm --filter api admin:bootstrap`) and tied to `OWNER_EMAIL`. Roles: `owner`, `admin`, `analyst` (read-only metrics). Mobile admin is enabled by **device pairing**: an authorized web admin issues a short-lived pairing code/QR; the phone exchanges it for a revocable, role-scoped token. Every admin action is written to an append-only audit log. (Email OTP is used for optional end-user accounts only when an email provider is configured.)

## D-014 Cost accounting at the call site — Accepted
Every provider call goes through `metered()` which records provider, task, units (input/output tokens, characters, audio seconds, requests), latency, cache hit, and computed cost from a dated price table (`packages/providers/src/pricing.ts`). Costs roll up per session, per user, per task and per provider in the admin console.

## D-015 Deployment — Provisional (awaiting VPS credentials)
Single VPS, Docker Compose: `caddy` (TLS, reverse proxy), `api`, `web`, `postgres`, `redis`. GitHub Actions: typecheck, unit tests, replay suite, image build to GHCR, SSH deploy on `main`. Nightly `pg_dump` with 14-day rotation; rollback = redeploy previous image tag.

## D-016 Native builds — Provisional (credential gap)
Expo dev-client + EAS Build for both platforms (native modules for background location/audio focus rule out Expo Go). Android: EAS `preview` profile → APK for sideloading. iOS: requires Apple Developer account (internal distribution / TestFlight). Neither Expo nor Apple credentials have been supplied yet (C-002); iOS distribution is currently **blocked**.

## D-017 Provisional budgets until owner documents arrive — Provisional
`docs/PERFORMANCE_COST.md` and `benchmark/ACCEPTANCE_BENCHMARK.md` are referenced by the master task but absent. Provisional versions (`*.provisional.md`) are used and will be replaced verbatim by the owner's files.

---

## Cost / latency revision (D-018 – D-024)

Measurements for these decisions are in `docs/PERFORMANCE_COST.md` (before/after tables, harness-measured vs assumed production rates). All of them keep product authority deterministic (D-002/D-003): the LLM still only writes prose for server-chosen facts, every spoken sentence is grounding-checked, and nothing city-specific was added.

## D-018 Story primitive: shared context-free body + uncached template prefix — Accepted (production hit rates unmeasured)
A story is split in two. The **body** is the cacheable part: place + angle + approved fact-set + guide + locale + mode + word-budget bucket (rounded down to 10 words) → deterministic key (`stableId('body_sp1', …)`) (`packages/core/src/story-primitive.ts`), generated at temperature 0 from a brief that contains no session id, time, position, spatial cue or journey callback. The **prefix** is a short deterministic template (quantized spatial cue + place name, plus at most one journey callback when it fits a 20-word reserve) that is spoken as its own first segment. Segment 0 = prefix, segments 1..n = body sentences; plan, resume and barge-in semantics are unchanged.
- *Cache:* body prose in Redis (`nb:v1:<bodyKey>`, 30-day TTL), body segment audio in the content-addressed audio store (key = sha256(segment | provider | model | tier/language voice)). Prefix audio is cached by exact text (quantized cues repeat across users; hit rate expected to be low).
- *Why there is no leakage:* the key and the brief are built from fields of the public evidence pack and the guide only; nothing a user said, where they are, when, or what they heard earlier can reach the cached text. Personalisation is confined to the prefix, which is never cached as prose. A test asserts the cache entry contains no session/user ids and that two users' bodies are byte-identical. Only grounded LLM prose is cached; template fallbacks are never cached (an LLM outage must not pin a template); concurrent misses are de-duplicated (single flight). Grounding validates body and prefix independently and the composed plan.
- *A hit means no LLM call*, and first audio is the (cached) prefix audio; `cached_story_to_first_audio` latency is recorded separately.
- *Counters:* hit/miss/write/not-cached/in-flight-join counters for the narration layer sit next to the existing audio/discovery/evidence counters in `/v1/admin/metrics/providers` (`cacheCounters`, process-since-start).
- *Tradeoffs:* (1) the body cannot reference the listener's journey ("as we passed…") — that lives in the prefix and is deliberately short; (2) temperature 0 gives one canonical telling per (place, angle, guide) instead of variety — repeat listeners hear the same words (the retell policy, D-023, limits repeats per user); (3) the prefix/body seam is a second TTS call — audible only if the two are on different voices/tiers (default `prefix: match`); (4) a prefix-only call adds ~10 words of TTS per story that the cache cannot remove; (5) bump `STORY_PRIMITIVE.VERSION` when the body prompt/template changes.
- *Rejected:* caching the whole personalised story (≈0% cross-user hits); prompt-time "style variation" per user (breaks the key).

## D-019 Tiered TTS and a Google Cloud TTS adapter — Accepted (voices PENDING BENCHMARK)
Speech purposes (story body, story prefix, answer, ack) map to a tier (`standard` | `economy`) by regime in core (`DEFAULT_TTS_TIERS`, `ttsTierFor`): highway story bodies and prefixes default to **economy**, everything else (walking, cycling, urban driving, answers, acks) to **standard**; env overrides `TTS_TIER_WALKING|CYCLING|URBAN_DRIVING|HIGHWAY|PREFIX|ANSWER|ACK`. The economy chain is `TTS_ECONOMY_PROVIDERS` (default `google_tts`) followed by the standard chain as fallback, so a missing/failed economy provider degrades to the standard voice, never to silence.
- Adapter `google_tts` (`packages/providers/src/adapters/google-tts.ts`): `text:synthesize` REST, API key in `x-goog-api-key`, MP3, one instance per voice family (Standard / WaveNet / Neural2; default WaveNet via `GOOGLE_TTS_VOICE_TYPE`), billed per character. A voice of the wrong family or language is never sent.
- Pricing: `google_tts:standard|wavenet` $4 and `neural2` $16 per 1M characters, taken from the existing `benchmark/research/provider_pricing.json` rows (retrieved 2026-09-27); the official pricing page could not be re-fetched in this session (fetch denied), so no new price was added and the retrieval date is unchanged.
- Voices: `voice.byTier.economy` in `ida.json` / `emil.json` holds candidate Google voice ids per family and language with `tierStatus` = **PENDING BENCHMARK**; they are unverified against the live voice list (`googleTtsListVoices` is provided to check them) and must be auditioned before launch. Guides keep distinct voices per tier.
- *Tradeoff:* WaveNet is cheaper (≈$4/1M chars vs ≈$17/1M-characters-equivalent for gpt-4o-mini-tts at its ~$0.015/audio-minute list price, assuming 2.4 words/s and ~6 chars/word) but less expressive; mixing tiers within one journey changes the voice between highway teasers and city stories, which is why only the highway is economy by default and walking is a deliberate config choice (`TTS_TIER_WALKING=economy`).

## D-020 Streamed follow-up answers, per-sentence grounding and TTS — Accepted
The follow-up path streams the LLM (SSE for OpenAI, Gemini and Anthropic; word-delta streaming in fakes), cuts the stream into sentences, **grounds each sentence before it is spoken**, and starts TTS for each completed sentence immediately. An unsupported sentence is replaced by the next unspoken approved fact (deterministic), or dropped if none is left; total length stays within the word budget. Barge-in / turn-abort semantics are unchanged: output from a superseded turn is never emitted.
- *Client contract:* clients declare capability `say_append` at session creation; they receive the first sentence as a normal `say` and later sentences as `say` with `append: true` (and `final: true` on the last, with the pending-answer bookkeeping deferred until audio finishes). Clients without the capability still get exactly one complete `say` (generated by the non-streaming path), so old builds keep working.
- *Router safety:* once text has been emitted, the router does not retry or fall back to another provider (no double speech); before the first token it behaves as before.
- *Tradeoffs:* no constrained retry for streamed answers (a bad sentence is replaced, not re-prompted); sentence-level grounding cannot see cross-sentence contradictions (facts are still only from the approved set); first audio now depends on time-to-first-sentence, not total generation time; the web and mobile append paths are unit/logic-tested but not device-tested.

## D-021 Remove the JSON payload block from real-provider prompts — Accepted
Prompts used to embed a ```json copy of the brief so that the fakes could parse it; real providers paid for those tokens on every call. `GenerateRequest.structured` now carries the payload for fakes/tests and the prompt text carries only what a model needs (`readPayload` is kept for legacy prompts). Mean story input fell ≈37–41%, follow-up ≈43%, intent ≈11% (`cost_model.json` → `promptTrim`, chars/4 heuristic over the real prompt builders).
- *Tradeoff:* tests that previously asserted on prompt contents now assert on `structured`; a real-LLM quality regression from the shorter prompt is NOT YET MEASURED (no keys).

## D-022 Realtime budget reconciliation — Accepted
`/v1/realtime/token` now reserves seconds and returns a `reservationId`; `/v1/realtime/usage` reconciles that reservation exactly once, crediting back unused reserved seconds (used = max(client-reported, elapsed wall time since the token), clamped to the reservation). Many short bursts therefore consume only what they use, up to the real per-session cap; the per-session token cap rose 6 → 30 so a legitimate burst pattern is not blocked by the count.
- *Tradeoff:* credit relies on the client reporting usage; if it never reports, the full reservation stays spent (fail-closed, safe for cost) and wall-time is the floor, so a client cannot under-report to get free time.

## D-023 Cross-session journey memory (per user/guest, 90 days) — Accepted
New table `place_history(owner_id, place_id, last_told_at, times)` (migration 003); no coordinates, no text. Written at session end for non-simulated sessions, read at session start, erased by `DELETE /v1/me` and by `run_retention()` after 90 days (D-012). The core brain gets a deterministic knob `RETELL.AFTER_DAYS` (30; env `RETELL_AFTER_DAYS`, 0 = off, max 90): a place told within the window is suppressed with reason `told_recently`.
- *Tradeoffs:* last-told times are clamped to server `now` (a fast client clock cannot extend retention) so the window is only as accurate as client time; a returning user on the same route hears *different* places for 30 days (good for variety, bad if they wanted a repeat — they can still ask); `place_history` is per owner id, so a guest who clears their token starts fresh. Simulated/demo/replay sessions neither read nor write it.

## D-024 Density-probe backoff and discovery hints — Accepted
Highway density probes were ≈25/h and each is a (potentially paid) places call. The refresh policy now (a) backs off after consecutive probes that confirm the same density class (`DENSITY_STABLE_MAX_STEPS`: highway 2, walking/cycling/urban 1, stationary/unknown 0), (b) derives a free "density hint" from discovery results inside the probe circle (a lower bound — it can only prove *denser*, never sparser), and (c) pulls the next probe forward when the hint contradicts the current class; a regime change resets the streak. Replay: interstate probes 44 → 19 (25.1 → 10.8/h), transition 25 → 18, golden-gate 12 → 10; stories, targets, silence and every F1/A-series assertion are unchanged.
- *Tradeoff:* after a long stable stretch the density class can be stale by up to a few probe intervals; the hint and regime-change reset bound this, and the density class only moves speaking thresholds, not target eligibility.
