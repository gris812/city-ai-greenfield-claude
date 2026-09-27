# Market (as of 2026-09-27)

Machine-readable: `benchmark/research/market.json`. Each input is tagged **[S]** (sourced, linked, retrieved 2026-09-27) or **[A]** (assumption, with a rationale). The sizing is bottom-up. Third-party "market size" headlines appear only as context at the end.

## 1. Demand signals and trends

| Category | Data point | Tag / source |
|---|---|---|
| US domestic travel | 2.40B person-trips in 2025 (leisure 1.96B), 2.45B forecast for 2026 | [S] [U.S. Travel Fall 2025 forecast](https://www.ustravel.org/sites/default/files/2025-10/US_Travel-Forecast_2025_Fall_v3.pdf) |
| | Domestic leisure spend forecast of $909B in 2026 (+1% real total spend) | [S] [U.S. Travel, May 2026](https://www.ustravel.org/research/travel-forecasts) |
| Road trips | 39.1M people traveled by car over Memorial Day 2026 (87% of 45M travelers) | [S] [AAA](https://newsroom.aaa.com/2026/05/45-million-americans-planning-memorial-day-weekend-getaways/) |
| Inbound to US | 68.3M international visits in 2025 (−5.5%). Overseas-only 34.3M (−2.5%). Forecast 70.6M in 2026 | [S] [NTTO via HNR](https://www.hotelnewsresource.com/article140416.html), [U.S. Travel](https://www.ustravel.org/research/travel-forecasts) |
| Global tourism | 1.52B international arrivals in 2025 (+4%) | [S] UN Tourism via [Forbes](https://www.forbes.com/sites/greatspeculations/2026/02/24/global-tourism-hits-15-billion-travelers-as-airlines-post-record-revenue/). The UN Tourism page itself returned 403 |
| Truck drivers | **2,221,200** heavy and tractor-trailer jobs (BLS, 2025). Median $58,640. +4% projected 2025–35 | [S] [BLS OOH](https://www.bls.gov/ooh/transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers.htm) |
| | 3.58M truck drivers of all kinds (ATA, 2024). Average age 47, 4.1% women | [S] [ATA](https://www.trucking.org/economics-and-industry-data), [ATRI](https://truckingresearch.org/2025/07/new-atri-research-highlights-evolving-truck-driver-demographics/) |
| | Up to 11 h driving per shift (14-h window). Hand-held phone use is banned: single-touch or voice only, driver fines up to $2,750 | [S] [FMCSA HOS](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations), [FMCSA phones](https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet) |
| | Long-haul share of heavy-truck drivers: **no authoritative figure found**. We use 50% (range 35–65%) | [A] |
| In-car audio | Past-month in-car listening: AM/FM 73%, online audio 48%, **podcasts 37%** (55% among ages 18–34) | [S] [Infinite Dial 2026 via Radio Ink](https://radioink.com/2026/03/13/infinite-dial-2026-radios-biggest-audience-is-going-digital/) |
| Podcasts | 58% of Americans 12+ (167M) listened to a podcast in the past month | [S] [Infinite Dial 2026](https://podnews.net/press-release/infinite-dial-us-2026) |
| AI adoption | 64% of US adults use AI. Daily use 25%. **55% of AI users pay** for at least one AI product (≈90M people). The typical payer spends $20–49/mo | [S] [Menlo Ventures 2026](https://menlovc.com/perspective/2026-the-state-of-consumer-ai/) (n=5,067, July 2026) |
| Voice assistants | Alexa usage fell 32%→22% and Siri 25%→20%. About half of AI users talk to AI by voice | [S] same |
| Subscription benchmarks | Median day-35 conversion: freemium 2.1%, hard paywall 10.7%. About 72% of annual subscriptions cancel in year 1 | [S] [RevenueCat SOSA 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026) (no travel breakdown) |
| Platform shift | Voice AI apps are allowed in CarPlay (iOS 26.4). Gemini replaces Assistant in Android Auto | [S] [9to5Mac](https://9to5mac.com/2026/02/18/ios-26-4-adds-support-for-voice-based-ai-apps-to-carplay/), [Google](https://blog.google/products-and-platforms/platforms/android/android-auto-gemini-tips/) |

**How we read the trends.**
- Voice AI is going mainstream, and cars are now an open surface for it. That helps us.
- The same trend puts free Gemini/Siri/ChatGPT voice in every dashboard. That hurts us (see COMPETITORS.md).
- US inbound travel is soft. Domestic road travel is resilient.

## 2. Bottom-up TAM / SAM / SOM (US-first, since the US is the acceptance geography)

Definitions:
- **TAM** = everyone in the segment × price.
- **SAM** = the reachable share that is already inclined to pay for AI. For consumers this is 64% × 55% = **35.2%** [S].
- **SOM** = a plausible year-3 paid penetration [A].

Figures are gross, before the ~15% store fee ([Apple](https://developer.apple.com/app-store/subscriptions/), [Google Play](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)).

### Consumer
| Segment | Population [tag] | Price [A] | TAM | SAM | SOM y3 (base; range) |
|---|---|---|---|---|---|
| US leisure road-trippers | **120M** unique adults/yr [A: range 90–150M. No sourced count exists. The floor is 39.1M on a single holiday weekend] | $39.99/yr (Autio 1-yr is $35.99–49.99 [S]) | **$4.80B** (3.6–6.0) | 42.2M × $39.99 = **$1.69B** | 0.25% of SAM → 106K payers → **$4.2M** (0.15–0.5% → $2.5–8.4M) |
| Inbound international visitors | 68.3M visits [S] | $9.99 trip pass | **$0.68B** | × 50% English-comfortable [A] × 35.2% → 12.0M → **$0.12B** | 0.2% of visits → 137K passes → **$1.4M** ($0.7–2.7M) |
| US long-haul truck drivers | 2.22M [S] × 50% long-haul [A] = 1.11M | $9.99/mo | **$133M** | 391K → **$47M** | 2% of SAM → 7.8K → **$0.94M** ($0.47–1.87M) |
| Locals exploring | not sized: no defensible usage or willingness-to-pay input | – | – | – | Treat as free-tier/retention audience |
| Non-US travellers (global) | 1.52B arrivals [S] as context | – | not sized | – | Depends on multilingual quality benchmarks |
| **Consumer total** | | | **≈ $5.6B** | **≈ $1.86B** | **≈ $6.5M** (3.7–13.0) |

### B2B (TAM only: order-of-magnitude, deliberately conservative)
| Segment | Formula | TAM | Notes |
|---|---|---|---|
| Tourism boards / DMOs (white-label) | 658 Destinations International members [S] × $12k/yr [A] | ~$8M | Understated, since not all DMOs are members. SmartGuide charges €98–780/mo [S], which anchors the price. This is more useful as a **distribution channel** than as revenue |
| Car rental | 1.16M rental vehicles bought in 2025 [S] (proxy for fleet) × $1/vehicle-mo [A] | ~$14M | Fleet size is not sourced. US rental revenue is $40.6B [S] |
| Fleet / trucking driver wellbeing | 2.22M drivers [S] × $3/driver-mo [A] | ~$80M | Needs evidence of retention or fatigue ROI. Must stay hands-free compliant |
| Automotive OEM licensing | 16.2M new US light vehicles in 2025 [S] × $3 one-time [A] | ~$49M/yr | Comparable deal: Autio embedded by Ford/Lincoln [S]. Sales cycles of 18–36 months [A] |
| Hotels / concierge | not sized | – | No sourced count or price input |

### Sensitivity (what moves the answer)
1. **Road-tripper count and penetration.** This segment is about 85% of consumer TAM. A survey question could resolve it cheaply: "took ≥1 leisure road trip of 2h+ in the last 12 months".
2. **Price.** Autio's discounting across 30-day tiers ($15.99–29.99) suggests elastic demand.
3. **Cost-to-serve versus price.** A $39.99/yr subscriber nets about $34 after store fees. At about $0.20 per active hour (economy stack; see PROVIDER_PRICING §6) that covers roughly **170 active hours/yr**. Heavy users such as truckers at ~50 h/week (≈215 h/mo, assumption) would cost **≈ $20–40/month** to serve at uncached highway rates of $0.10–0.19/h. That is **more than a $9.99 driver tier**. The driver tier works only if two things happen:
- Corridor stories and TTS are shared and cached across users. Interstates repeat.
- Google Places is almost never called on highways, where Wikidata/OSM is enough.

The target is < $0.03/h. This is the most important cost assumption for the benchmark to validate.

**Verdict.** Consumer TAM is large on paper. The realistic 3-year obtainable market is **single-digit $M** without a distribution partner. The upside lies in channels: OEM, rental, and road-trip planners (Roadtrippers already bundles Autio [S]).

## 3. Third-party headlines (context only, not used above)
| Headline | Publisher | Caveat |
|---|---|---|
| Self-guided audio tour market $2.86B (2025) → $5.71B (2034), 7.99% CAGR | [Verified Market Reports](https://www.verifiedmarketreports.com/product/self-guided-audio-tour-market/) | Paywalled methodology. Unclear whether it counts hardware rental headsets. Numbers of this kind vary widely between publishers |
| Consumer AI spend $40B in 2026 (from $12B) | [Menlo Ventures](https://www.globenewswire.com/news-release/2026/09/16/3363086/0/en/menlo-ventures-report-consumer-ai-spend-tripled-to-40b-this-year-even-as-user-growth-barely-budged.html) | VC-authored. 14% of payers make up 60% of spend |

## 4. Biggest market risk
**Free platform substitution.** Gemini in Maps and Android Auto, Siri AI, and ChatGPT in CarPlay already answer location questions by voice at no cost. If Google adds a proactive "tour guide" mode, the consumer willingness to pay assumed above collapses for casual users.

Mitigations:
- Build proof of superior editorial timing and grounding into the acceptance benchmark.
- Pursue B2B and white-label channels that platforms don't serve.
- Build a trucker-specific safety-first product.

**Secondary risk:** unit economics for heavy users, driven by Places API cost and always-on usage (PROVIDER_PRICING §6).

## 5. Gaps (not found, or not fetchable)
- Unique annual count of US road-trippers.
- Long-haul share of truck drivers.
- Travel-category conversion benchmarks.
- A total count of US DMOs.
- US rental fleet size.
- Census adult population figure: the release page gave no number.
- The UN Tourism primary page (403).

All of these are marked [A] above and should be replaced when data arrives.
