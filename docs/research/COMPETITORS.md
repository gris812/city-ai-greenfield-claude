# Competitive Landscape (as of 2026-09-27)

Machine-readable: `benchmark/research/competitors.json`. Every traction figure is linked to its source and was retrieved on 2026-09-27 unless another date is given. Store ratings and download counts are point-in-time snapshots. "n/a" means the figure was not found, and nothing here is estimated.

## TL;DR
- **No one ships our exact combination.** That combination is continuous, *proactive*, grounded narration of whatever is near or ahead, working globally across walking and highway driving, with conversational follow-ups, journey memory, and an explicit silence policy.
- **The biggest threat is the platforms, not the startups.** Google has shipped Gemini in Maps for driving, walking and cycling, Ask Maps, and Gemini Live in Android Auto. These already answer "what neighborhood am I in / what's along my route" by voice, for free. They are **pull** (the user must ask). Our differentiation is **push** done well: timing, silence, story quality, and memory.
- **Incumbent audio-tour apps are scripted.** Autio, VoiceMap, GuideAlong, Shaka Guide and SmartGuide all rely on authored tours, so they have no coverage off-route or outside their catalogues. They show willingness to pay: **$15–40 per tour** and **$36–50 per year** subscriptions.
- **AI-native lookalikes exist** (RoadWhisper, Roadguide, Nextour, Narrativ, Road Trip Voice Tour Guide AI). All have negligible traction (at most about 1K downloads). The concept is easy to copy, so any advantage has to come from execution quality: grounding, timing, safety, CarPlay/Android Auto, and cost.

## Top competitors

| # | Competitor | Type | Discovery model | Voice / AI | Platforms | Business model & price | Traction (sourced) | Weakness vs us |
|---|---|---|---|---|---|---|---|---|
| 1 | **Google Maps + Gemini** (Ask Maps, Gemini nav, Lens) | Platform | Dynamic, user-initiated | Gemini, hands-free | Android, iOS, CarPlay, Android Auto, Google built-in | Free | Ask Maps launched US+India 2026-03-12 with CarPlay/AA support ([TC](https://techcrunch.com/2026/03/12/google-maps-is-getting-an-ai-ask-maps-feature-and-upgraded-immersive-navigation/)). Gemini walking/cycling nav worldwide Feb 2026 ([AlternativeTo](https://alternativeto.net/news/2026/2/google-maps-expands-gemini-s-hand-free-ai-navigation-to-walking-and-cycling-worldwide/)). Reviewer: "full of trivia", weak on route edits ([Tech Brew](https://www.techbrew.com/stories/2026/02/17/google-gemini-navigation-test)) | Pull-only. Task-oriented. No evidence of proactive storytelling cadence, silence policy, or personas |
| 2 | **Gemini in Android Auto / Gemini Live** | Platform | Dynamic, user-initiated | Gemini Live (beta), 45 languages | Android Auto, Google built-in | Free | Global rollout ([Google](https://blog.google/products-and-platforms/platforms/android/android-auto-gemini-tips/)) | Must be asked. No ahead-of-trajectory significance ranking |
| 3 | **Autio** | Direct | Scripted library of 20,000+ stories, GPS-triggered | None (human/celebrity narration) | iOS, Android, CarPlay, Ford/Lincoln head units | 14-day $14.99; 30-day $15.99–29.99; 1-yr $35.99–49.99; 3-yr $39.99–69.99 ([App Store](https://apps.apple.com/us/app/autio-road-trip-travel-app/id1300494609)). Bundled in Roadtrippers Premium and Ford connectivity ($14.99/mo) | iOS 4.8★ / 4.3K ratings. Play 3.5★, 10K+ downloads ([Play](https://play.google.com/store/apps/details?id=autio.audio.travel.guide.stories&hl=en_US)). $10.7M raised, 230K+ registered users (2023, [TC](https://techcrunch.com/2023/03/29/kevin-costners-location-based-audio-storytelling-app-autio-raises-5-6m/)). In 2025+ Ford/Lincoln vehicles ([Forbes](https://www.forbes.com/sites/edgarsten/2026/08/04/ford-lincoln-add-on-board-autio-tour-guide/)) | US-centric catalogue. No Q&A. Not walking. Play reviews cite billing and audio-ducking bugs |
| 4 | **Apple Siri AI (iOS 27) + Maps + Visual Intelligence** | Platform | User-initiated | Siri AI built with Gemini | iOS, CarPlay | Free | Unveiled at WWDC 2026-06-08 ([Quartz](https://qz.com/apple-siri-ai-google-gemini-wwdc-2026-060826)). iOS 27 released Sept 2026 ([MacRumors](https://www.macrumors.com/2026/09/23/50-new-things-iphone-can-do-ios-27/)) | No proactive narration found. Apple also gatekeeps the CarPlay entitlement |
| 5 | **ChatGPT** (location sharing + CarPlay voice) | Platform | User-initiated | OpenAI voice | iOS, Android, Web, CarPlay | Freemium | Location sharing Mar 2026 ([SER](https://www.seroundtable.com/chatgpt-location-sharing-41128.html)). CarPlay on iOS 26.4+, audio-only, no wake word ([MacRumors](https://www.macrumors.com/2026/03/31/openai-chatgpt-carplay/)) | No continuous location or trajectory. Not proactive. Local facts not grounded |
| 6 | **VoiceMap** | Direct | Scripted tours (2,100+ in 600+ destinations) | Some AI content (labelled) | iOS, Android | $3.99–19.99 per tour | iOS 4.8★ / 3.4K ([App Store](https://apps.apple.com/us/app/voicemap-audio-tours-guides/id852027939)). Play 4.6★, 100K+ ([Play](https://play.google.com/store/apps/details?id=me.voicemap.android&hl=en)) | Fixed routes. No conversation |
| 7 | **GuideAlong** | Direct | Scripted driving tours (100+) | None | iOS, Android, CarPlay | $14.99–39.99 per tour | iOS 4.9★ / 16K ratings ([App Store](https://apps.apple.com/us/app/guidealong-gps-audio-tours/id1460032075)) | Only on authored routes |
| 8 | **Shaka Guide** | Direct | Scripted (105+ tours, 55 national parks) | None | iOS, Android | Per tour (official price not shown. A secondary source cites ~$18.99) | Play 4.8★, 2,310 reviews, 100K+ ([Play](https://play.google.com/store/apps/details?id=com.shakaguide.android&hl=en_US)) | Destination-bound |
| 9 | **SmartGuide** | Direct + B2B | Scripted, AI-voiced | AI TTS and translation | iOS, Android | B2B €98 / 195 / 390 / 780 per month by annual pax (<3k / <10k / <30k / <100k). AI translation €200 per language ([site](https://www.smartguide.app/tour-operators)) | Play 4.7★, 6,250+ reviews, 1M+ ([Play](https://play.google.com/store/apps/details?id=org.smart_guide.smartguide.T_00007)). Clients include Deutsche Bahn and Thames River Sightseeing | Reviews criticize AI pronunciation. Walking only |
| 10 | **izi.TRAVEL** | Direct + museum B2B | Scripted (25K tours, 2,500 cities, 3,000 museums) | AI itinerary | iOS, Android | Free with ads plus membership | Play 1M+, **2.3★** (15K reviews, complaints about ads) ([Play](https://play.google.com/store/apps/details?id=travel.opas.client)) | Inconsistent UGC. Monetization backlash |
| 11 | **Le Walk** | Direct | Scripted cinematic walks (Paris, Rome…) | n/a | iOS, Android | Paid experiences (price n/a) | $4.1M seed; 110K beta downloads (2025-09-19, [PR](https://www.prnewswire.com/news-releases/le-walk-a-tour-guide-in-your-headphones-raises-4-1m-seed-led-by-adverb-ventures-and-lerer-hippeau-302561276.html)) | Few cities. No driving |
| 12 | **GPSmyCity** | Direct | Scripted walks (1,800+ cities) | Read-aloud | iOS, Android | Freemium IAP | Play 4.3★, 500K+ ([Play](https://play.google.com/store/apps/details?id=com.gpsmycity.iwtmaster&hl=en_US&gl=US)) | Text-first |
| 13 | **AI-native narrators**: RoadWhisper, Roadguide, Nextour, Narrativ, Road Trip Voice Tour Guide AI | Direct (closest concept) | Dynamic AI generation | LLM+TTS. Nextour has personas and voice Q&A | iOS/Android. No CarPlay/AA found | RoadWhisper $2.99/mo ([site](https://roadwhisper.org/)). Narrativ €14.99/3 days ([Play](https://play.google.com/store/apps/details?id=com.narrativ.travelhistorian)). Road Trip AI credit packs $0.99–54.99 ([App Store](https://apps.apple.com/us/app/road-trip-voice-tour-guide-ai/id1671354231)). Roadguide and Nextour free | RoadWhisper 100+ downloads. Nextour 1K+ ([Play](https://play.google.com/store/apps/details?id=com.tripxai.nextour&hl=en)). Narrativ 100+ | Radial or interval triggers, no trajectory reasoning. No grounding checks described. No traction |
| 14 | **Roadtrippers** (Autopilot AI) | Planning, indirect | Pre-trip | AI planner (text) | iOS, Android, Web | $35.99 / $49.99 / $59.99 per year ([support](https://support.roadtrippers.com/hc/en-us/articles/360000831566-What-features-are-included-with-Roadtrippers-memberships)) | – | Not an in-drive companion. Could be a partner (already bundles Autio) |
| 15 | **Bloomberg Connects** | Museums, indirect | Institution-authored | – | iOS, Android | Free (philanthropy) | 1,000+ institutions. iOS 4.8★ / 7.4K ([App Store](https://apps.apple.com/us/app/connects-arts-culture/id1476456847)) | Indoor only. Offers free competition for museum B2B deals |
| 16 | **OEM assistants**: Mercedes MBUX + Google; Ford/Lincoln + Autio | Channel / platform | POI Q&A; scripted | Gemini (MBUX) | In-vehicle | Bundled. Ford connectivity $14.99/mo | MBUX conversational POI search, CLA first ([eWeek](https://www.eweek.com/news/mercedes-gemini-ai-navigation/)) | Brand-locked. Shows that OEMs buy this category |
| 17 | **Trucker Path** | Trucker utility (channel) | – | – | iOS, Android, CarPlay | Diamond $29.99/mo or $249.99/yr ([pricing](https://truckerpath.com/pricing/trucker-path-individual)) | 450K MAU, about 30% of Class 8 drivers (2016, dated) ([Wiki](https://en.wikipedia.org/wiki/Trucker_Path)) | No companionship. Possible partner |
| 18 | **Layla** (AI travel agent) | Planning, indirect | Pre-trip chat | LLM | Web/app | Freemium | 5M+ users (2026-03-17, [Yahoo/PR](https://finance.yahoo.com/news/layla-surpasses-1-billion-trips-165400507.html)) | No in-journey audio |

Also tracked: Ray-Ban Meta glasses identify landmarks via Meta AI in early-access beta ([PhoneArena](https://www.phonearena.com/news/ask-your-glasses-ray-ban-meta-smart-glasses-to-double-as-your-virtual-tour-guide_id156181)). This is a future hands-free form factor to consider.

## Feature matrix
Y = sourced yes · P = partial · N = no / not found · ? = unknown

| Capability | **Us (target)** | Google Maps+Gemini | Gemini in AA | Siri/Apple Maps | ChatGPT | Autio | VoiceMap | GuideAlong | SmartGuide | RoadWhisper | Nextour |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Works at any place (not only authored) | Y | Y | Y | P | P | N | N | N | N | Y | Y |
| **Proactive narration (push)** | **Y** | N | N | N | N | Y | Y (route) | Y (route) | Y (route) | Y | P |
| Voice Q&A follow-ups | Y | Y | Y | Y | Y | N | N | N | N | N | Y |
| Driving mode | Y | Y | Y | Y | P | Y | P | Y | N | Y | N |
| **Trajectory-ahead discovery** | **Y** | P (route Q&A) | P | N | N | P | N | N | N | N (radial) | N |
| Walking / landmark mode | Y | Y | N | P | P | N | Y | P | Y | N | Y |
| **Journey memory ("already told you")** | **Y** | ? | ? | ? | P | P (unheard) | N | N | N | ? | ? |
| **Explicit silence / cadence policy** | **Y** | N | N | N | N | ? | N | N | N | P | N |
| Selectable Guide personas | Y (2) | N | N | N | N | N | N | N | N | P (6 styles) | Y |
| CarPlay / Android Auto | P (planned) | Y | Y | Y | Y (CarPlay) | Y (CarPlay) | ? | Y | ? | N | ? |
| Offline | P (prefetch) | P | N | P | N | ? | Y | Y | Y | N | N |
| Global coverage | Y | Y | Y | Y | Y | P | P | P | P | Y | Y |

## Big-platform risk

| Actor | What has shipped (sourced) | Gap left for us | Likelihood of closing the gap within 12 months (our judgment) |
|---|---|---|---|
| Google | Gemini in Maps for driving, walking and cycling. Ask Maps. Gemini Live in Android Auto. Landmark-based guidance. Lens "what is this place" | Proactive, well-timed story narration. Silence policy. Personas. Cross-session memory. Trucker-grade safety tuning | **Medium–high.** Google has the data, the distribution, and a "trivia" behaviour already in reviews. One "tour guide mode" toggle would commoditize the core |
| Apple | Siri AI (Gemini-based) in iOS 27. Visual Intelligence. Apple controls the CarPlay voice-conversational entitlement | Location-proactive narration | Low–medium |
| OpenAI | Location sharing. CarPlay voice | Background location. Proactive triggers. Maps grounding | Medium |
| OEMs | MBUX + Google POI conversation. Ford/Lincoln + Autio | Cross-brand, phone-based product | These are channels as much as threats |

**Implications for the product:**
1. Do not compete on "answer my question about this place". That is table stakes and free.
2. Compete on proactive editorial judgment. That means the StoryBrief/SilencePolicy, whether a story is worth interrupting for, grounding with no hallucinated years or names, and resume-exactness. Measure it in the acceptance benchmark.
3. Own verticals the platforms under-serve: long-haul drivers (safety-constrained, hours of solitude), white-label for DMOs and tourism boards, and fleets.
4. Treat each platform's model API as a supplier. Build a provider-agnostic stack, per D-003/D-010.
