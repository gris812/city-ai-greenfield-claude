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
