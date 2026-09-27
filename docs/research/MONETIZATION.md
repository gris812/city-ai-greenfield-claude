# Monetization & Go-to-Market (as of 2026-09-27)

Inputs come from COMPETITORS.md, MARKET.md and PROVIDER_PRICING.md. Every price is sourced there. Recommendations are our judgment and are labelled as such.

## 1. Comparable consumer pricing (sourced)

| Product | Model | Price points |
|---|---|---|
| Autio | Time passes / subscription | 14-day $14.99 · 30-day $15.99–29.99 · 1-yr $35.99–49.99 · 3-yr $39.99–69.99 ([App Store](https://apps.apple.com/us/app/autio-road-trip-travel-app/id1300494609)) |
| Roadtrippers | Tiered subscription | $35.99 / $49.99 / $59.99 per year; monthly $11.99–19.99. Premium bundles Autio ([support](https://support.roadtrippers.com/hc/en-us/articles/360000831566-What-features-are-included-with-Roadtrippers-memberships)) |
| GuideAlong | Per tour | $14.99–39.99 ([App Store](https://apps.apple.com/us/app/guidealong-gps-audio-tours/id1460032075)) |
| VoiceMap | Per tour | $3.99–19.99 ([App Store](https://apps.apple.com/us/app/voicemap-audio-tours-guides/id852027939)) |
| Narrativ (AI) | Short pass | from €14.99 per 3 days ([Play](https://play.google.com/store/apps/details?id=com.narrativ.travelhistorian)) |
| RoadWhisper (AI) | Freemium | Free up to 1,000 stories/day; $2.99/mo ([site](https://roadwhisper.org/)) |
| Road Trip Voice Tour Guide AI | Credits | $0.99 (7 visits) to $54.99 (600 visits) ([App Store](https://apps.apple.com/us/app/road-trip-voice-tour-guide-ai/id1671354231)) |
| Trucker Path (utility) | Subscription | $29.99/mo or $249.99/yr ([pricing](https://truckerpath.com/pricing/trucker-path-individual)) |
| Ford/Lincoln connectivity (includes Autio) | OEM bundle | $14.99/mo · $149.95/yr · $745/7 yr ([Forbes](https://www.forbes.com/sites/edgarsten/2026/08/04/ford-lincoln-add-on-board-autio-tour-guide/)) |
| SmartGuide B2B | SaaS by visitor volume | €98 / 195 / 390 / 780 per month; €200 per AI language ([site](https://www.smartguide.app/tour-operators)) |

**Store economics.**
- Apple: 30% in year 1 and 15% after, or 15% throughout under the Small Business Program (≤ $1M proceeds) ([Apple](https://developer.apple.com/app-store/subscriptions/)).
- Google Play: 15% on subscriptions ([Play](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)).
- US link-out to web checkout is allowed, but Apple's 27% fee on it is still being litigated. As of 2026-04-06 the case was headed to the Supreme Court ([TechCrunch](https://techcrunch.com/2026/04/06/apple-epic-games-lawsuit-supreme-court-appeal-app-store-commission/)). **Do not plan around web checkout savings.**

## 2. Options evaluated

| Option | Fit with guest-first | Revenue potential | Cost-risk | Verdict |
|---|---|---|---|---|
| **Freemium with minutes cap** | High (guest gets real value first) | Medium. Median freemium conversion is 2.1% at day 35 [S] | Bounded by the cap | **Yes** (base layer) |
| **Subscription** (monthly/annual) | Needs an account or store ID | Medium–high for repeat road-trippers | Heavy users can exceed revenue (MARKET §2) | **Yes**, with fair-use limits |
| **Trip / day pass** (non-renewing) | Very high (travellers hate subscriptions) | Medium. Anchored by Autio 14-day $14.99 and Narrativ €14.99/3 days | Bounded by the time window | **Yes**, the primary offer for travellers |
| Per-tour purchase | Poor (we have no "tours") | – | – | No |
| Ads / sponsored POIs | Hurts trust and conflicts with grounding and silence | Low at our scale | Brand risk | **No** in v1. Revisit clearly labelled "partner stops" later |
| **B2B white-label** (DMOs, tourism boards, attractions) | n/a | Small ($8M TAM) but high-signal | Low. They pay per destination | **Pilot** as a channel, not a revenue pillar |
| **Fleet / driver wellbeing** | n/a | $80M TAM. ROI unproven | Heavy per-driver usage | **Pilot** with 1–2 carriers after the safety benchmark passes |
| **OEM / rental licensing** | n/a | Largest upside; Autio–Ford is the precedent | Long cycles; certification | **Year 2+**. Prepare with an audio-only API and CarPlay/AA |

## 3. Recommended initial model (our judgment)

**Guest-first freemium, plus a trip pass and an annual plan. A separate driver plan comes later.**

| Tier | Price (initial, to A/B test) | Includes | Rationale |
|---|---|---|---|
| **Guest / Free** | $0, no account | ~30 narrated min/day (count only spoken minutes; silence is free) and 5 questions/day. Both Guides | The magic moment must happen before any signup (guest-first). The daily cap bounds cost at about $0.15–0.50 per user per day at the cap (economy stack; PROVIDER_PRICING §6). The cap should be tuned against CAC |
| **Trip Pass** | **$9.99 / 7 days** (non-renewing) | Unlimited narration and Q&A (fair use), offline prefetch for a route | Undercuts Autio's 14-day $14.99. Matches how travellers buy |
| **Explorer Annual** | **$39.99/yr** (monthly $6.99 as decoy) | All of the above, year-round, journey history | Matches Autio's 1-yr band ($35.99–49.99) and Roadtrippers Basic ($35.99) |
| **Driver** (phase 2, after CarPlay/AA plus the safety benchmark) | $9.99/mo or $79.99/yr | Long-haul mode, extended silence controls, HOS-aware break prompts (only if legally reviewed) | Only viable if highway cost is below about $0.03/h via shared corridor caching (MARKET §2) |

**Why.**
1. Travellers are episodic. A pass converts better than a subscription for a one-off trip. This is the pattern Autio and Narrativ use.
2. Road-trippers and locals who come back justify the annual plan.
3. The spoken-minutes metric matches our cost driver (TTS plus Places) and keeps silence free, so the product has no incentive to over-talk.
4. Leave out B2B price lists until a single DMO pilot has proven the analytics value.

**Guardrails.**
- `ProviderBudget` (D-010/D-014) enforces per-tier daily cost ceilings.
- Degrade gracefully to shorter or template stories rather than hard-stopping mid-drive. Hard-stopping mid-drive is also a safety concern.

## 4. GTM channels & constraints

| Channel | Why | Constraints / requirements (sourced where possible) |
|---|---|---|
| **App Store / Google Play search** | Intent keywords: "road trip audio guide", "walking tour", "tour guide AI" | Crowded with scripted-tour apps rated 4.8–4.9★ (GuideAlong has 16K ratings). A new entrant needs early ratings, which is why guest-first matters. Screenshots must show "any place, not only tours" |
| **CarPlay** | Road-trippers and truckers live in the car | Apple **entitlement required** ([Apple](https://developer.apple.com/carplay/)). The voice-based conversational category (iOS 26.4+) requires voice as the primary modality and **no text or imagery in responses**. Apps cannot replace Siri or use a wake word ([9to5Mac](https://9to5mac.com/2026/02/18/ios-26-4-adds-support-for-voice-based-ai-apps-to-carplay/), [MacRumors](https://www.macrumors.com/2026/03/31/openai-chatgpt-carplay/)). An audio-app entitlement is the fallback for narration-as-media. **Blocked today** by the missing Apple Developer account (D-016) |
| **Android Auto** | Same audience on Android | There is no conversational-app category. Available routes are **Media** (MediaBrowserService/MediaLibraryService + MediaSession; "in-app media playback while driving isn't permitted" except in media and nav apps) or POI (map templates) ([Android](https://developer.android.com/training/cars/media), [categories](https://developer.android.com/training/cars)). A realistic path is a **media app** exposing narration as a live stream plus voice actions. Needs Play car-quality review |
| **Travel creators** (YouTube, TikTok van-life and road-trip creators) | The product demos well on video: drive past something and the Guide speaks | Affiliate or rev-share on passes. Content must never show on-screen interaction while driving (safety and brand) |
| **Road-trip planners / partnerships** (Roadtrippers-type, RV communities) | Roadtrippers already bundles Autio ([support](https://support.roadtrippers.com/hc/en-us/articles/360000831566-What-features-are-included-with-Roadtrippers-memberships)) | They can bundle us too, or treat us as a rival. Needs an API and a wholesale price |
| **Trucking communities** (forums, CB/YouTube trucker channels, Trucker Path-type apps, carriers) | Isolation over long hours (up to 11 h driving per shift per [FMCSA HOS](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations)) | FMCSA bans hand-held phone use: single-button or voice only, driver fines up to $2,750 and employer fines up to $11,000 ([FMCSA](https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet)). D-008 must guarantee **zero required touches** beyond a single large button. Carriers will ask for a legal review |
| **DMOs / tourism boards** | A "your destination, narrated everywhere" pitch plus heatmap analytics (SmartGuide sells this) | Bloomberg Connects is free for museums, and izi.TRAVEL lets institutions publish, so museums are a weak target. Focus on regions and scenic byways instead |
| **Rental cars / OEM** | Autio–Ford is the precedent | Needs an in-vehicle audio API, privacy review (D-012 helps), and long cycles |

### Launch sequence (our judgment)
1. **Months 0–3.** Android APK and WebApp beta; iOS waits on credentials. Acceptance cities: NYC, Chicago and SF walking plus one Interstate. Freemium only; instrument conversion intent.
2. **Months 3–6.** Store launch with Trip Pass and Annual. Creator seeding. File the CarPlay entitlement request and build an Android Auto media integration.
3. **Months 6–12.** Driver tier beta with 1–2 carriers once the highway silence and safety benchmark passes and cost per hour is below target. One DMO white-label pilot.
4. **Year 2.** Rental and OEM conversations using the pilot data.

## 5. Key risks to monetization
| Risk | Mitigation |
|---|---|
| Free platform voice AI (Gemini, Siri, ChatGPT) sets willingness to pay near $0 for "ask about this place" | Charge for proactive, curated narration and journey memory, not for Q&A. Keep Q&A generous in the free tier |
| Heavy-user cost exceeds revenue (truckers, locals) | Spoken-minutes metering, shared corridor caching, Wikidata/OSM-first discovery, fair-use caps |
| CarPlay entitlement denied or delayed | Phone-speaker/Bluetooth audio works without CarPlay. Apply early. Android Auto media path |
| Gemini price doubling on 2027-01-01 | Price table dated per D-014. Keep providers swappable |
