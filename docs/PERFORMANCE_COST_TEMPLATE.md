# Performance & Cost Report

> **Required deliverable.** Create/update `docs/PERFORMANCE_COST.md` using this structure.  
> Do not delete required sections. Additional sections are allowed.  
> Distinguish **target**, **measured**, **estimated**, and **not yet measured** values.  
> Never present provider list prices, simulations, or forecasts as measured production cost.

## 0. Report Metadata

| Field | Value |
|---|---|
| Product / working brand | |
| Repository | |
| Build / commit SHA | |
| Report date | |
| Prepared by | |
| Mobile versions tested | iOS: / Android: |
| WebApp version tested | |
| Backend environment | local / staging / production-like |
| Regions tested | |
| Network profiles tested | Wi‑Fi / 5G / LTE / degraded |

## 1. Executive Summary

Summarize in no more than 12 bullets:

- whether the product meets the responsiveness goal;
- the largest latency bottleneck;
- the largest variable-cost driver;
- the default provider choices and why;
- the strongest cost-control mechanisms;
- the main scaling risk;
- which measurements are real and which are estimates;
- the three highest-priority optimizations still open.

## 2. Performance Objectives

Define the final target budgets. At minimum include the following product interactions.

| Interaction | Target p50 | Target p95 | Hard failure / UX threshold | Rationale |
|---|---:|---:|---:|---|
| App launch -> usable Explore shell | | | | |
| Map interaction / camera response | | | | |
| Approved moment -> first audible speech | | | | |
| Cached story -> first audio | | | | |
| User begins interruption -> old audio stopped | | | | |
| End of simple utterance -> first response audio | | | | |
| Nearby-search request -> usable result | | | | |
| Tool action -> map update | | | | |
| Realtime session connect -> ready | | | | |
| Realtime reconnect | | | | |
| Admin dashboard initial useful paint | | | | |

State which targets are inherited from the specification and which were revised by the implementation team. Any revision must be justified.

## 3. Test Methodology

Document:

- devices and OS versions;
- browser(s) for WebApp/PWA;
- server/VPS region and configuration;
- provider regions where applicable;
- test network conditions;
- cold vs warm run definition;
- sample count per benchmark;
- how p50/p95 were calculated;
- clock/timing instrumentation method;
- how audio-start, barge-in stop, and end-of-speech timestamps were captured;
- whether synthetic/replay tests differ from live-provider tests.

### 3.1 Measurement integrity

List known limitations or sources of bias.

## 4. Measured Client Performance

### 4.1 Native iOS

| Metric | Cold/Warm | Sample size | p50 | p95 | Target | Result | Evidence reference |
|---|---|---:|---:|---:|---:|---|---|
| App launch -> usable Explore | | | | | | PASS/PARTIAL/FAIL | |
| Map ready | | | | | | | |
| Explore interaction responsiveness | | | | | | | |
| Audio playback start | | | | | | | |
| Background/foreground recovery | | | | | | | |
| Memory footprint | | | | | | | |
| Battery impact during 30 min Explore | | | | | | | |

### 4.2 Native Android

Use the same table and explain meaningful platform differences.

### 4.3 WebApp/PWA

| Metric | Browser/device | Sample size | p50 | p95 | Target | Result | Evidence reference |
|---|---|---:|---:|---:|---:|---|---|
| First useful paint | | | | | | | |
| Explore shell ready | | | | | | | |
| Map ready | | | | | | | |
| Story start | | | | | | | |

## 5. Backend & API Performance

Report by endpoint/service rather than a single average.

| Service / endpoint | Scenario | Sample size | p50 | p95 | Error rate | Cache status | Result |
|---|---|---:|---:|---:|---:|---|---|
| Context ingestion | | | | | | | |
| Discovery | | | | | | | |
| Evidence retrieval | | | | | | | |
| Narrative planning | | | | | | | |
| Narrative generation | | | | | | | |
| TTS | | | | | | | |
| Nearby Search | | | | | | | |
| Admin metrics | | | | | | | |

Identify which parts are deterministic/local and which depend on paid external providers.

## 6. Voice & Realtime Performance

Compare every provider actually benchmarked using the same scripts.

| Metric | Provider / model A | Provider / model B | Additional provider |
|---|---:|---:|---:|
| Connect p50 / p95 | | | |
| Speech-end -> final recognized turn p50 / p95 | | | |
| Speech-end -> first response audio p50 / p95 | | | |
| Barge-in -> output stopped p50 / p95 | | | |
| Tool-call success rate | | | |
| False-start rate under road noise | | | |
| Missed-turn rate under road noise | | | |
| English quality | | | |
| Russian quality | | | |
| Reconnect success rate | | | |
| Client integration complexity | | | |

### 6.1 Provider decision

Document:

- selected default;
- fallback(s);
- rejected alternatives;
- evidence for the decision;
- conditions that would trigger reevaluation.

Do not select a provider only by reputation or convenience.

## 7. Cost Model Inputs

List pricing sources and the date checked.

| Provider | Service | Pricing unit | Unit price | Source/date | Notes |
|---|---|---|---:|---|---|
| | | | | | |

Do not expose credentials or account-specific secret data.

## 8. Variable Cost Taxonomy

At minimum model these categories where applicable:

- map SDK / map loads;
- automatic place discovery;
- explicit nearby search;
- place details/enrichment;
- geocoding;
- routes/distance/ETA;
- search/grounding/evidence retrieval;
- LLM text input;
- LLM text output;
- realtime audio/input/output/session duration;
- STT;
- TTS;
- media/object storage and material egress;
- transactional email/OTP;
- observability if usage-priced.

## 9. Per-Session Cost Scenarios

Use actual configured providers and realistic call budgets.

| Cost component | 30-min Walk | 30-min Drive | 60-min Interactive Walk | 30-min + 5 min Realtime | High-density stress case |
|---|---:|---:|---:|---:|---:|
| Maps / map loads | | | | | |
| Places / discovery | | | | | |
| Place details | | | | | |
| Routes / ETA | | | | | |
| Evidence/search | | | | | |
| LLM generation | | | | | |
| TTS | | | | | |
| Realtime/STT | | | | | |
| Storage/egress | | | | | |
| Other | | | | | |
| **Total variable cost** | | | | | |

For every scenario specify assumptions: number of stories, user turns, searches, cache hit rate, movement density, language, and realtime minutes.

## 10. Unit Economics Scenarios

This is an engineering/economic model, not a fabricated business forecast.

Provide at least three scale cases.

| Assumption | Small | Medium | Large |
|---|---:|---:|---:|
| MAU | | | |
| Active sessions/user/month | | | |
| Avg session minutes | | | |
| Avg variable cost/session | | | |
| Monthly variable infrastructure cost | | | |
| Fixed infrastructure estimate | | | |
| Total technical COGS | | | |
| Example subscription / revenue assumption | | | |
| Implied gross margin* | | | |

\*Clearly label revenue/pricing values as hypotheses unless validated externally.

## 11. Cache Strategy & Measured Effect

| Cache layer | Key / scope | TTL/invalidation | Hit rate | Cost avoided | Latency effect | Failure behavior |
|---|---|---|---:|---:|---:|---|
| Discovery | | | | | | |
| Evidence | | | | | | |
| Story primitives | | | | | | |
| Final narration | | | | | | |
| TTS/media | | | | | | |
| Routes/ETA | | | | | | |

Explain why final contextual prose is or is not cached and how cross-user leakage is prevented.

## 12. Provider Call Budgets & Rate Controls

| Paid operation | Per-session limit | Time-window limit | Deduplication | Fallback when exhausted |
|---|---:|---:|---|---|
| Automatic discovery | | | | |
| Place details | | | | |
| Evidence/search | | | | |
| LLM generations | | | | |
| TTS | | | | |
| Realtime active minutes | | | | |

## 13. Failure-Loop Cost Tests

| Failure condition | Expected bounded behavior | Calls observed | Cost risk | Result | Evidence |
|---|---|---:|---|---|---|
| Empty discovery result | | | | PASS/PARTIAL/FAIL | |
| Maps quota exceeded | | | | | |
| Provider timeout | | | | | |
| Invalid credential | | | | | |
| Redis/cache unavailable | | | | | |
| LLM failure | | | | | |
| TTS failure | | | | | |
| Realtime connect failure | | | | | |
| Network flap | | | | | |

No failure may create an unbounded paid retry loop.

## 14. Scaling Model

Describe expected behavior at increasing concurrency, including:

- API statelessness/state boundaries;
- database bottlenecks;
- Redis/cache role;
- queue/background work if any;
- websocket/realtime connection limits;
- provider quotas;
- media storage/egress;
- horizontal scaling approach;
- single-VPS MVP limitations;
- migration triggers to managed/multi-instance infrastructure.

## 15. Optimization Decisions

For each meaningful optimization, record the tradeoff.

| Decision | Benefit | Cost / downside | Evidence | Status |
|---|---|---|---|---|
| | | | | accepted/rejected/deferred |

## 16. Open Performance / Cost Risks

Rank unresolved risks by impact and likelihood.

| Risk | Impact | Likelihood | Detection metric | Mitigation | Owner/status |
|---|---|---|---|---|---|
| | | | | | |

## 17. Final Scorecard

| Area | Target | Actual / estimate | Status | Notes |
|---|---|---|---|---|
| Native startup | | | PASS/PARTIAL/FAIL | |
| Trigger -> first audio | | | | |
| Barge-in stop | | | | |
| Simple follow-up latency | | | | |
| Nearby search latency | | | | |
| 30-min walking variable cost | | | | |
| 30-min driving variable cost | | | | |
| Realtime active-minute cost | | | | |
| Failure-loop containment | zero unbounded loops | | | |
| Provider replaceability | required | | | |

## 18. Evidence Index

List links/paths to:

- raw benchmark JSON/CSV;
- traces/log excerpts with secrets removed;
- screenshots;
- profiler captures;
- provider-pricing references;
- scripts used to reproduce calculations;
- dashboard screenshots;
- CI runs.

