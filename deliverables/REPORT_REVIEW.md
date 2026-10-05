# Independent review of `INVESTOR_REPORT.md` (Telvey)

Reviewer: an independent agent that did not write the report. Date: 2026-10-04. Verdict: **SHIP AFTER FIXES**. Findings: 0 Critical, 9 High, 15 Medium, 8 Low (32). The orchestrator applied the fixes marked **Applied** below (text edits to the report, the competitor figure and the build scripts, then rebuilt the PDF and packet and re-ran the number check, 117/117). Items marked **Open** were not changed in this pass.

The review found no fabricated users, traction, revenue, partners or retention. Every headline number traced to `benchmark/**/*.json` and reproduced in independent Python arithmetic (test counts, latency pairs, per-session costs, truck month, unit economics, TAM/SAM/SOM chain). The problems were a competitor fact marked "not verified" that a fetch contradicts, headline economics resting on single usage assumptions, one security count that did not reproduce, provenance and legal silences, and wording that let fixture-driven results read as proof of the moat.

## Top five problems

1. **F-01 Waytale.** A verified, shipping, GPS-proactive AI city guide with cheaper passes; the report said "nothing else verified".
2. **F-02 Truck month.** Assumes 100% sparse-highway hours. With 10% urban hours the month costs about $7.12; with 25%, about $12.39 against $8.49 net.
3. **F-03 Trip Pass.** The "unlimited" $9.99 pass and its 75% margin assume 30 minutes of walking a day; break-even is about 2.0 hours a day.
4. **F-04 / F-05.** `pnpm audit` gives 16 advisories (2 critical, 5 high, 9 moderate), not 9. The report never says the code, tests, fixtures, benchmarks and the report were all AI-agent authored with no stated human review.
5. **F-06 / F-07.** "Grounded in cited sources" is not shown to users and CC BY-SA is absent from the report. Silence evidence is driven by fixture density with no baseline comparator.

## Findings

| ID | Sev | Where | Problem (evidence) | Recommended fix | Disposition |
|---|---|---|---|---|---|
| F-01 | High | §3.1, §6.1, §18, fig08, App. B | Waytale (App Store, checked 2026-10-04): "Companion Mode" auto-plays stories as you explore, 3 AI narrators, passes 3 d $3.99 / 7 d $5.99 / 14 d $9.99, first release 2025-09-03, no ratings, no Q&A or CarPlay listed. Report said "not verified". | Replace the row with the sourced facts; "proactive" and "AI voices" are not differentiators, silence, look-ahead and grounding are the unproven ones; raise the risk to High. | Applied (text, risk rating and fig08 regenerated) |
| F-02 | High | §12.4, exec table, App. C #6 | Truck month prices all 176 h at the I-40 replay rate. Tiered, 0% cache: 0% urban hours $3.61; 10% $7.12; 25% $12.39 (negative margin vs $8.49 net); 2.4× highway story rate $6.64. | Add sensitivity table; qualify the conclusion; real mix and rate NOT YET MEASURED. | Applied |
| F-03 | High | §13.1, §13.3 | Walking costs $0.613/h at 0% cache; Trip Pass break-even is 13.9 h (2.0 h/day; 3.8 h/day at 50% cache); a 3 h/day week costs $12.87 vs $8.49 net. Per day: Telvey $1.43, Autio $1.07, Waytale $0.86 (7-day) / $0.71 (14-day). | Replace "undercuts Autio"; add break-even; define fair use before testing the price. | Applied |
| F-04 | High | §16.2, §18, App. B/C, STATUS.md | `pnpm audit --json` today: 16 advisories (2 critical, 5 high, 9 moderate). Critical: maplibre-gl (runtime XSS), vitest (dev only). | Restate with run time and runtime vs tooling split. | Applied (re-run before publishing) |
| F-05 | High | passim | All commits authored by "Claude"; same agents wrote code, tests, fixtures, benchmarks and report; "team" language misleads on key-person risk. | Add a provenance statement; replace "implementation team" with "the build agents"; add an investor question. | Applied |
| F-06 | High | exec, §4, §7, §9 | "Cited" implies users see citations; no attribution UI exists; Wikipedia text is CC BY-SA 4.0 and spoken adaptations may carry ShareAlike into shared cached text and audio; default web map uses OSM raster tiles. | Reword; add the licensing and tile-policy paragraph; legal review required. | Applied |
| F-07 | High | §4, exec, §2.4, §10.3 | I-40 silence (98.7% on template-length speech, about 96% with model-length stories) is mostly few fixture candidates; walking narrates about two thirds of the time; no naive-trigger baseline was run. | Qualify; run baseline comparators. | Wording applied; baseline comparator run **Open** |
| F-08 | High | §3.3, fig09, exec | TAM/SAM/SOM re-derives exactly, but SOM is not conservative (about 106K paying subscribers is about 46% of Autio's registered base), omits ramp, CAC and about 72% first-year annual cancellation; filters mix bases (US-adult AI-payer share applied to foreign visitors and drivers; AAA 39.1M counts children; 68.3M inbound includes Canada and Mexico and counts visits). | Add notes and a 0.05% downside SOM. | Applied (notes and a described 0.05% downside; no chart) |
| F-09 | High | §9, §12.3–12.4, D-019 | Google TTS pricing page, 2026-10-04: Standard and WaveNet are $4/M but listed as Legacy; current Chirp 3 HD is $30/M. The driver plan's viability rests on a legacy voice family. | State legacy status; add a $30/M sensitivity row. | Applied (paragraph); a $30/M row in the §12.3/12.4 tables is **Open** |
| F-10 | Med | §13.3, App. B #12 | Free 30 min/day costs about $13.7–13.9/month, not $8. | Correct. | Applied |
| F-11 | Med | §15.2 | "0 of 33 stories" counts the I-40 trace twice: 28 distinct starts over 5 distinct traces. | Qualify. | Applied |
| F-12 | Med | §4, §15 | "36 of 36 sessions" is one scripted scenario repeated 36 times with seeded delays. | Disclose at first use. | Applied |
| F-13 | Med | fig08, §3.1 | Telvey row scored on fixtures, competitors on public evidence; "Choice of voices" green though no voice heard; "No" merged with "not found". | Hatch Telvey row; relabel "Not found in public sources". | Partly applied: Telvey row relabelled, voice choice Partial, caption says not-found is not absent; row hatching **Open** |
| F-14 | Med | §3.2, exec, §18 | Gemini in walking Navigation offers recommendations "based on your route"; Autio and GuideAlong auto-play by GPS. | Soften "none was found". | Applied |
| F-15 | Med | §12.3 vs §13.3 | "Economy voice" means tts-1 in one place and WaveNet in another. | Define once; rename. | Applied |
| F-16 | Med | §12 | Cache key includes Guide, locale, angle, mode, length bucket and fact set, so reuse splits; 50% hit rate untested. | Add caveat and a 20% column. | Caveat applied; a 20% cache column is **Open** |
| F-17 | Med | §9, App. C #11 | Google Places terms: 14.3 caches lat/lng ≤30 days; 14.2 bars non-Google maps; Places UI Kit exception (15.1) allows it. Whether TTS audio derived from Places fields is Maps Content is open. | Add exception and open question. | Applied |
| F-18 | Med | §13.1, §3.3 | 85% net assumes Apple Small Business Program (≤$1M); otherwise 30% in year 1. | Footnote. | Applied |
| F-19 | Med | §3.1 | Guidel (App Store) and CityTour AI (Google Play) also exist. | Add; "negligible public traction". | Applied |
| F-20 | Med | §21 | Report says a comparison packet zip accompanies it; none existed. | Build the packet or write "will accompany". | Applied (packet built: 120 files, 14.3 MB) |
| F-21 | Med | §14, §15.2, §21, App. B | Internal jargon ("Template area", "owner's section G"); App. B is internal corrections. | Plain wording; move App. B to engineering errata. | **Open** (jargon column and App. B not changed) |
| F-22 | Med | §15, exec, fig12 | PASS/PARTIAL are the agents' own labels; A1–A3 rest on hand-curated fixtures and fake LLMs; exec omits two missed cost budgets (walk $0.306 vs $0.15; urban drive $0.110 vs $0.10). | Reword. | Applied (text); fig12 legend **Open** |
| F-23 | Med | §12.5, §15.3 | Realtime worst case $0.024/min exceeds the $0.02 budget; only typical values shown. | Add. | Applied |
| F-24 | Med | §10.1 | "LTE typically 40–120 ms" has no source; p95 from 36 seeded samples is within noise of the target. | Mark ASSUMED. | Applied |
| F-25 | Low | §2.2, §3.1, §3.3 | App Store 2026-10-04: VoiceMap $4.99–$19.99 plus $24.99 pass; GuideAlong free–$39.99; Autio 1-yr $35.99, 30-day $29.99. | Date and update. | **Open** (prices not changed on one observation) |
| F-26 | Low | §10.3 | Longest gap 32 min is 31% of the trace. | Optional. | **Open** (optional) |
| F-27 | Low | §16.1 | Code size recount holds (about 28,000 source incl. scripts; 5,045 test lines). | Optional note. | Applied (28,000 correction made earlier) |
| F-28 | Low | fig12, App. B #7 | `results.json` labelled with an uncommitted tree. | Re-run on clean commit. | **Open** |
| F-29 | Low | §14 | "8 passing tests" not broken out. | Verify. | **Open** |
| F-30 | Low | §13.2, exec | FMCSA fines and BLS count traced only to repo research files. | None; listed as not verified live. | Noted |
| F-31 | Low | §3.3 | Autio founding year not in repo. | Cite or write "as of March 2023". | **Open** |
| F-32 | Low | App. D, check-numbers.py | The check script only tests that formatted strings appear; it does not verify placement, derived figures, audit counts or external facts. | State limits in App. D. | Applied |

## Claims verified, and how

Re-derived in Python from repo JSON (all matched unless a finding says otherwise): test counts (189+104+35+29+88+15 = 460); status counts 13/8/0/6 = 27; latency pairs and cache counters; I-40 replay (105 min, 5 stories, silence 0.987, longest gap 32.1 min, 18.2 queries/h); per-session costs and voice shares (99.0% walk, 94.1% 60-minute walk, model 0.89%); §12.3 ratios; truck month at 0/50/80% cache; unit economics (mix-weighted session $0.2799, paid-user margin 40.7%, break-even 33.6%–36.2%); TAM/SAM/SOM per segment and totals (B2B about $150M); Wikimedia ceiling of 32–90 sessions; code size; demo recording length; live `pnpm audit --json`.

External facts checked live on 2026-10-04: Autio App Store listing; Forbes on Autio in Ford/Lincoln; GuideAlong and VoiceMap listings; Waytale listing; Google Maps Platform service-specific terms; Google Cloud TTS pricing; Android Central on Gemini in Navigation; search confirmation of Guidel and CityTour AI.

Status honesty passes: the report states plainly that there is no real user, live provider, device run or deployment; realtime is NOT RUN; iOS is blocked; Wikimedia was unreachable; the Places display rule is unenforced; CI never ran; the brand is not cleared. Screenshots carry demo callouts; admin figures say DEMO DATA.

## Missing investor questions

| Question | Touched? | What to add |
|---|---|---|
| Who built and reviewed this; key-person risk; AI-agent provenance | No | Provenance statement (F-05) |
| Google Places display and caching | Yes, good | UI Kit exception; derived-audio question (F-17) |
| Wikipedia CC BY-SA attribution and ShareAlike for spoken adaptations and shared cache | No | F-06 |
| OSM tile policy and attribution; map cost at scale | Barely | Production tile source |
| Trademark | Yes, honest | None |
| Voice rights: TTS providers' AI-disclosure and voice-clone terms | Partly | Provider-terms review |
| Driver-distraction regulation and liability | Partly | Legal view, liability, insurance, carrier contracts |
| CarPlay and Android Auto entitlement path | Yes | Timeline and approval odds unknown |
| Go-to-market and CAC | "Not modelled" | CAC payback ceiling from about $34 net per annual subscriber |
| Retention evidence | Yes ("zero") | Add the about 72% first-year annual cancellation benchmark |
| Why now | Thin | Waytale since 2025-09 shows the window is crowded |
| Safety validation plan | Partly | Protocol, human-factors standard, incident process |
| Privacy law mapping (GDPR, CCPA, DPAs) | Partly | Legal mapping |
| App-store policy risk (background location, AI-content disclosure) | Barely | One line |
| Wrong-fact or defamation exposure; sensitive sites | Barely | Editorial policy and takedown process |
| Burn, runway, use of funds | Deliberately no | Order of magnitude for gates 1–3 |
| Moat if a platform ships a toggle | Yes | Baseline comparator (F-07) |

## Could not verify

Permission timed out for live checks of the Tech Brew review ("trivia" claim, §2.3), TechCrunch Ask Maps, MacRumors iOS 27, BLS, FMCSA, Roadtrippers, RevenueCat, AAA, Hotel News Resource, Wikipedia licence text and Google's Places policies page; these are repo-sourced only. Menlo, Verified Market Reports, Infinite Dial, U.S. Travel and UN Tourism figures were taken from repo JSON. Waytale's generation method (live vs pre-authored) is unknown; the summary came from a small model reading the App Store page. Post-cutoff model ids and prices were checked for internal consistency only. All real-world behaviour (live Wikimedia, device, real provider latency, voice quality, cache hit rate) has nothing to verify. PDF page rendering was not reviewed; the reviewer read the Markdown and rendered fig08 only.
