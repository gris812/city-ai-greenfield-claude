# Provider Pricing (list prices, retrieved 2026-09-27)

Machine-readable: `benchmark/research/provider_pricing.json` (`{provider, product, sku, unit, priceUsd, notes, sourceUrl, retrievedAt}`). Feeds the dated price table in `packages/providers/src/pricing.ts` (D-014).

**How this was gathered.** Official pricing pages, fetched live on 2026-09-27. The fetch tool summarizes each page, so figures were cross-checked against a second official page where one existed (model detail pages versus the pricing index). **Before the first production bill, re-verify everything against the provider consoles.** Specific caveats:
- OpenAI: `openai.com/api/pricing` and `developers.openai.com/api/docs/pricing` returned different flagship model names ("GPT-5.6 Sol/Terra/Luna" versus "GPT-6 Astra/Sol/Luna"). The developer docs and the individual model pages agree with each other, so this doc uses them. Confirm model IDs with `GET /v1/models` once keys arrive.
- Gemini Flash and Gemini TTS prices marked **PROMO** double on 2027-01-01. Budget at the 2027 price.
- Azure's official page renders prices dynamically, so they could not be read. The Azure figure below comes from a third party and is marked as unverified.

Derived per-minute figures use these **assumptions**: 1 min of narration ≈ 150 words ≈ **900 characters** ≈ ~200 LLM output tokens. OpenAI Realtime counts 600 audio tokens per min of user input and 1,200 per min of assistant output ([source](https://developers.openai.com/api/docs/guides/realtime-costs)). Gemini TTS counts 25 audio tokens/s ([source](https://cloud.google.com/text-to-speech/pricing)).

## 1. LLMs (story prose from StoryBrief, intent parsing, grounded follow-ups)

| Provider | Model | Input $/1M | Cached in $/1M | Output $/1M | Batch | Source |
|---|---|---|---|---|---|---|
| OpenAI | gpt-6-luna (small/fast) | 0.10 | 0.01 | 0.50 | −50% | [model page](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| OpenAI | gpt-6-sol (mid flagship) | 2.00 | 0.20 | 10.00 | −50% | [model page](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| OpenAI | gpt-6-astra (top) | 10.00 | 1.00 | 50.00 | −50% | [pricing](https://developers.openai.com/api/docs/pricing) |
| Google | gemini-3.1-flash-lite | 0.25 (audio 0.50) | 0.025 | 1.50 | −50% | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Google | gemini-3.5-flash-lite | 0.30 | – | 2.50 | −50% | same |
| Google | gemini-3.8-flash | 0.75 → **1.50 from 2027-01-01** | 0.075 → 0.15 (+storage) | 3.75 → **7.50** | −50% | same |
| Google | gemini-3.5-flash | 1.50 | 0.15 | 9.00 | −50% | same |
| Google | gemini-3.1-pro-preview (≤200k) | 2.00 | – | 12.00 | −50% | same |
| Anthropic | Claude Haiku 4.5 | 1.00 | 0.10 (write 1.25) | 5.00 | −50% | [pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Anthropic | Claude Sonnet 5 | 2.00 | 0.20 (write 2.50) | 10.00 | −50% | same |
| Anthropic | Claude Opus 5.5 | 4.00 | 0.20 (write 5.00) | 20.00 | −50% | same |

**Cost per ~1-min story** (assumed 1,500 input + 250 output tokens): gpt-6-luna ≈ **$0.0003**, gemini-3.1-flash-lite ≈ $0.0008, gemini-3.8-flash ≈ $0.002 (then ≈ $0.004 from 2027), Haiku 4.5 ≈ $0.0028, Sonnet 5 / gpt-6-sol ≈ $0.0055. **The LLM is not the cost driver.** The provider choice should come down to grounding pass-rate and latency in the D-010 benchmark. Batch pricing only helps offline pre-generation, for example of high-significance landmarks.

## 2. TTS (narration)

| Provider | Product | List price | ≈ $/narrated min (derived) | Free tier | Source |
|---|---|---|---|---|---|
| Google Cloud | Standard / WaveNet | $4 / 1M chars | 0.0036 | 4M chars/mo | [pricing](https://cloud.google.com/text-to-speech/pricing) |
| Google Gemini API | gemini-3.8-flash-lite-tts | $0.50 in / **$6 audio out** per 1M tok (→ $12 in 2027) | 0.009 (→ 0.018) | – | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| OpenAI | tts-1 | $15 / 1M chars | 0.0135 | – | [model](https://developers.openai.com/api/docs/models/tts-1) |
| Google Gemini API | gemini-3.8-flash-tts | $0.50 in / **$9 out** per 1M tok (→ $18 in 2027) | 0.0135 (→ 0.027) | – | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Deepgram | Aura-1 | $0.015 / 1K chars | 0.0135 | $200 credit | [pricing](https://deepgram.com/pricing) |
| OpenAI | gpt-4o-mini-tts | $0.60 in / $12 audio out per 1M tok | ≈0.015 | – | [model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) |
| Google Cloud | Gemini 2.5 Flash TTS | $0.50 in / $10 out per 1M tok | 0.015 | – | [pricing](https://cloud.google.com/text-to-speech/pricing) |
| Google Cloud | Neural2 | $16 / 1M chars | 0.0144 | 1M chars/mo | same |
| Azure | Neural (prebuilt) | $16 / 1M chars, HD $22 (**unverified on official page**) | 0.0144 | 0.5M chars/mo (official) | [3rd-party](https://texttolab.com/blog/azure-text-to-speech-pricing), [official](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/) |
| Google Cloud | Chirp 3: HD | $30 / 1M chars | 0.027 | 1M chars/mo | [pricing](https://cloud.google.com/text-to-speech/pricing) |
| Deepgram | Aura-2 | $0.030 / 1K chars | 0.027 | – | [pricing](https://deepgram.com/pricing) |
| Cartesia | Sonic (Startup plan) | $49/mo for 1.25M credits (~1,667 min) | ≈0.029 | 20K credits | [pricing](https://cartesia.ai/pricing) |
| ElevenLabs | Flash/Turbo | $0.05 / 1K chars (PAYG and overage on every plan) | 0.045 | – | [API pricing](https://elevenlabs.io/pricing/api) |
| ElevenLabs | Multilingual v2/v3 | $0.10 / 1K chars | 0.09 | – | same |

## 3. STT (push-to-talk questions)

| Provider | Product | $/min | Source |
|---|---|---|---|
| Google Gemini API | gemini-3.5-transcribe | 0.003 audio in + 0.002 text out | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| OpenAI | gpt-4o-mini-transcribe | 0.003 | [pricing](https://developers.openai.com/api/docs/pricing) |
| ElevenLabs | Scribe v2 / v2 Realtime | 0.0037 / 0.0065 | [API pricing](https://elevenlabs.io/pricing/api) |
| Deepgram | Nova-3 pre-recorded / streaming (mono) | 0.0043 / 0.0048 (multi 0.0052/0.0058); Flux 0.0065 | [pricing](https://deepgram.com/pricing) |
| OpenAI | gpt-transcribe / gpt-4o-transcribe | 0.0045 / 0.006 | [pricing](https://developers.openai.com/api/docs/pricing) |
| Google Cloud | STT V2 standard | 0.016 (0–500k min), 0.004 at 2M+; dynamic batch 0.003 | [pricing](https://cloud.google.com/speech-to-text/pricing) |
| OpenAI | gpt-live-transcribe / gpt-realtime-whisper (streaming) | 0.017 | [pricing](https://developers.openai.com/api/docs/pricing) |

A typical question is about 5–10 s of audio, so it costs well under $0.001 to transcribe.

## 4. Realtime speech-to-speech (conversation bursts only, D-010)

| Provider | Model | Audio in | Audio out | ≈ $/min user speech | ≈ $/min assistant speech | Notes |
|---|---|---|---|---|---|---|
| Google | gemini-3.8-live | $3/1M tok = **$0.005/min** | $12/1M = **$0.018/min** | 0.005 | 0.018 | Per-min figures published by Google. [src](https://ai.google.dev/gemini-api/docs/pricing) |
| OpenAI | gpt-realtime-2.1-mini | $10/1M (cached $0.30) | $20/1M | 0.006 | 0.024 | Derived. [src](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) |
| OpenAI | gpt-realtime-2.1 | $32/1M (cached $0.40) | $64/1M | 0.019 | 0.077 | Derived. Text $4/$24. [src](https://developers.openai.com/api/docs/pricing) |
| OpenAI | GPT-Live-1 (full duplex) | – | – | – | – | **$0.05 per session-minute**, backend model billed separately. Costly if left open during silence. [src](https://developers.openai.com/api/docs/models/gpt-live-1) |

On OpenAI Realtime, each turn re-bills the conversation history as (cached) input, so real cost rises with session length. That is a strong reason to close idle sessions quickly (D-010). The **hybrid loop** (STT → LLM → TTS) costs roughly $0.015–0.02 per answered minute on the economy stack, which is comparable to Gemini Live and cheaper than gpt-realtime-2.1.

## 5. Maps, places and knowledge

### Google Maps Platform (per-SKU free caps replaced the $200 monthly credit on 2025-03-01)
Sources: [pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [March-2025 change](https://developers.google.com/maps/billing-and-pricing/march-2025)

| SKU | Free / month | $/1,000 (0–100k) | Volume tiers (100k–500k / 500k–1M / 1M–5M / 5M+) |
|---|---|---|---|
| Nearby Search **Pro** (no Essentials tier exists) | 5,000 | **32.00** | 25.60 / 19.20 / 9.60 / 2.40 |
| Nearby Search Enterprise | 1,000 | 35.00 | 28.00 / 21.00 / 10.50 / 2.63 |
| Nearby Search Enterprise + Atmosphere | 1,000 | 40.00 | 32.00 / 24.00 / 12.00 / 3.40 |
| Text Search Essentials (IDs only) | unlimited | 0 | – |
| Text Search Pro / Enterprise / +Atmosphere | 5,000 / 1,000 / 1,000 | 32 / 35 / 40 | as Nearby |
| Place Details Essentials (IDs only) | unlimited | 0 | – |
| Place Details Essentials | 10,000 | 5.00 | 4.00 / 3.00 / 1.50 / 0.38 |
| Place Details Pro | 5,000 | 17.00 | 13.60 / 10.20 / 5.10 / 1.28 |
| Place Details Enterprise / +Atmosphere | 1,000 | 20.00 / 25.00 | … / 1.51 / 2.28 |
| Place Details Photos | 1,000 | 7.00 | … / 0.53 |
| Autocomplete Requests | 10,000 | 2.83 | … / 0.21 |
| Compute Routes Essentials / Pro / Enterprise | 10,000 / 5,000 / 1,000 | 5 / 10 / 15 | … |
| Dynamic Maps (JS, WebApp) | 10,000 | 7.00 | … / 0.53 |
| **Maps SDK (mobile native)** | **unlimited, free (verified)** | 0 | – |
| Map Tiles 2D / Street View tiles | 100,000 | 0.60 / 2.00 | … |
| Geocoding | 10,000 | 5.00 | … |

Each request is billed at the **highest SKU its field mask triggers**, so the field mask must be kept narrow.

**Terms that shape the architecture** ([Service Specific Terms §14](https://cloud.google.com/maps-platform/terms/maps-service-terms)):
- Only **lat/lng** from Places may be cached, for at most 30 consecutive days.
- **Place IDs are exempt** from caching limits; refresh them if older than 12 months, which is free via Details IDs-only ([source](https://developers.google.com/maps/documentation/places/web-service/place-id)).
- Places content **must not be used with a non-Google map**. If Places is a source, the mobile map must be Google Maps SDK (free) and the web map must be Google Dynamic Maps. Places data rules out a Mapbox map.
- Because Places content cannot be pooled across users, Places cost grows linearly with active usage.
- Legal should review whether generated narration that derives from Places fields may be cached.

Gemini API **Grounding with Google Maps** costs $14 / 1,000 grounded prompts after 5,000 free per month, and the same holds for Google Search grounding ([pricing](https://ai.google.dev/gemini-api/docs/pricing)). It is an alternative to calling Places directly for Q&A.

### Alternatives
| Source | Price / limit | Notes | Source |
|---|---|---|---|
| Mapbox Maps SDK mobile | 25,000 MAU free, then $4 / 1,000 MAU | Can't be combined with Google Places content | [pricing](https://www.mapbox.com/pricing) |
| Mapbox web map loads | 50,000 free, then $5 / 1,000 | | same |
| Mapbox Search Box / Geocoding (temporary) / Directions | 500 sessions free then $3/1k; 100k free then $0.75/1k; 100k free then $2/1k | | same |
| Wikimedia APIs (Wikipedia/Wikidata) | Free; 500 req/h per IP anonymous, 5,000 req/h with a personal token (page marked *draft*) | Content is CC BY-SA, so attribution is required. Cacheable and poolable across users, which makes it the best fit for significance and history. The WDQS SPARQL limits and the Wikimedia API usage-guideline pages **could not be fetched** and must be verified. | [rate limits](https://api.wikimedia.org/wiki/Documentation/Getting_started/Rate_limits) |
| OSM Overpass (public) | Free; ~10,000 requests/day and <1 GB/day per user | Heavy users are expected to self-host. For production, use a self-hosted instance or pre-extracted OSM data. | [policy](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) |

## 6. Cost-to-serve implications (inputs for `docs/PERFORMANCE_COST.provisional.md`)

The mix per active hour is an **assumption**: walking has about 20 narrated minutes, 10 place queries and 5 Q&A turns; highway driving has about 8 narrated minutes and 6 corridor queries.

| Stack | Walking $/active hr | Highway $/active hr | Dominant line |
|---|---|---|---|
| Economy (gpt-6-luna or flash-lite; TTS $0.0036–0.0135/min; every discovery query is Nearby Pro at $0.032) | ≈ 0.41–0.67 | ≈ 0.22–0.32 | **Google Places ($0.32/hr walking)** |
| Economy with Wikidata/OSM-first discovery and Places only on demand (~2 calls/hr) | ≈ 0.15–0.41 | ≈ 0.10–0.19 | TTS + residual Places |
| Premium voice (ElevenLabs Flash replaces economy TTS) | TTS line ≈ 0.90 | TTS line ≈ 0.36 | TTS |

Monthly free caps are ignored above. They matter at pilot scale (5,000 Nearby Pro calls ≈ 500 walking hours per month) but not at scale.

Levers, in order of impact:
1. Use free and poolable knowledge sources (Wikidata/Wikipedia, self-hosted OSM) for discovery, and call Places only for a candidate that is shortlisted and needs business context.
2. Cache TTS audio for shared content. D-009 already content-addresses segments by hash. Our own prose built from Wikidata facts can be reused across users, which matters most on repeated Interstate corridors.
3. Keep realtime sessions short.
4. Budget Gemini prices at the 2027 rates.
