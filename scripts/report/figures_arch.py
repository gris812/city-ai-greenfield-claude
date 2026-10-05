"""Architecture / flow figures for the investor report (system context, modules, pipeline, state, providers, caches, surfaces, user flow)."""
from __future__ import annotations

import json
from pathlib import Path

from svgkit import C, INK, INK2, INK3, ROOT, Svg, wrap, tw

OUT = ROOT / "deliverables" / "figures"
RES = json.loads((ROOT / "benchmark/acceptance/results.json").read_text())
LAT = json.loads((ROOT / "benchmark/acceptance/latency.json").read_text())


def fig_system_context() -> Svg:
    s = Svg(920, 640, "System context", "People, client surfaces, the Telvey API and its external providers, with exercised-live status")
    s.header("System context", "Who uses it, what runs where, and what has been exercised against real providers")
    s.text(24, 92, "PEOPLE", 12, 700, INK3, spacing=1.2)
    s.text(184, 92, "CLIENT SURFACES", 12, 700, INK3, spacing=1.2)
    s.text(418, 92, "TELVEY BACKEND", 12, 700, INK3, spacing=1.2)
    s.text(668, 92, "EXTERNAL PROVIDERS", 12, 700, INK3, spacing=1.2)
    people = [("Explorer on foot", "walk / tourist / local"), ("Driver or trucker", "audio-first, hands-free"), ("Owner / operator", "ops, cost, health"), ("Evaluator / investor", "web demo, no install")]
    for i, (t, sub) in enumerate(people):
        s.box(24, 106 + i * 88, 140, 70, t, [sub], "plain", tsize=14, ssize=12)
    s.text(94, 470, "Any person can use any", 11.5, 500, INK3, "middle")
    s.text(94, 485, "surface they are entitled to", 11.5, 500, INK3, "middle")
    surf = [
        ("Native app (Expo)", ["iOS + Android; bundles build,", "no device run yet"], "warn"),
        ("WebApp / PWA  /app", ["real core in-browser (demo) or live"], "ok"),
        ("Public website", ["value prop, guides, legal"], "ok"),
        ("Admin console  /admin", ["passkey login, RBAC, metrics"], "ok"),
        ("Mobile admin (in app)", ["device pairing; no device run"], "warn"),
    ]
    for i, (t, sub, k) in enumerate(surf):
        s.box(184, 106 + i * 74, 200, 64, t, sub, k, tsize=13.5, ssize=11.5)
    s.rect(418, 106, 220, 330, C["petrol-50"], C["petrol-700"], r=14, sw=2)
    s.text(528, 132, "Telvey API", 16, 700, INK, "middle")
    s.text(528, 150, "Fastify + WebSocket", 12, 500, INK2, "middle")
    for i, (t, sub) in enumerate([("MomentDirector (core)", "what, when, whether to speak"), ("Narrative pipeline", "brief, LLM prose, grounding"), ("Conversation + tools", "intent, nearby, resume"), ("Provider router + guard", "budget, breaker, metering"), ("Auth + RBAC + audit", "guest, user, analyst, admin, owner")]):
        s.box(430, 162 + i * 53, 196, 46, t, [sub], "det", tsize=13, ssize=11, r=7, sw=1.2)
    for i in range(5):
        s.arrow([(384, 138 + i * 74), (418, 138 + i * 74)], INK3, 1.3)
    s.box(418, 456, 106, 58, "Postgres 16", ["system of record"], "store", tsize=13, ssize=11)
    s.box(532, 456, 106, 58, "Redis 7", ["hot state, caches"], "store", tsize=13, ssize=11)
    s.box(418, 524, 220, 44, "Audio store (disk)", ["content-addressed mp3"], "store", tsize=13, ssize=11)
    s.arrow([(490, 436), (471, 456)], INK3, 1.3)
    s.arrow([(566, 436), (585, 456)], INK3, 1.3)
    prov = [
        ("Wikimedia", "discovery + evidence; free; unreachable here", "warn"),
        ("Google Places Nearby", "only on user question; Google map only", "warn"),
        ("LLM", "OpenAI > Gemini > Anthropic", "warn"),
        ("TTS", "OpenAI; Google Cloud (economy tier)", "warn"),
        ("STT", "device first, else OpenAI / Gemini", "warn"),
        ("Realtime voice", "OpenAI | Gemini Live: NOT RUN", "warn"),
        ("Maps", "Google SDK/JS; MapLibre fallback", "warn"),
        ("Navigation hand-off", "Google / Apple Maps / Waze links", "ext"),
    ]
    for i, (t, sub, k) in enumerate(prov):
        s.box(668, 106 + i * 56, 228, 48, t, [sub], k, tsize=13, ssize=11, r=7, sw=1.2)
    s.rect(646, 106, 10, 442, C["sand-100"], "none", r=5)
    s.arrow([(638, 271), (646, 271)], INK3, 1.4)
    s.legend(24, 584, [("det", "Product code (tested)"), ("ok", "Built, run locally"), ("warn", "Not exercised live"), ("store", "Data store")], size=12)
    s.footer("Source: docs/API.md, DECISIONS.md D-001..D-016, benchmark/acceptance/results.json. Status 2026-10-04: every provider call in tests uses deterministic fakes; no live provider, device or deployment run exists.")
    return s


def fig_modules() -> Svg:
    s = Svg(840, 560, "Service and module diagram", "Monorepo packages and apps with dependency direction and test counts")
    s.header("Service and module map", "One TypeScript monorepo; the same decision code runs in the API, the browser, the phone and the replay harness")
    suites = {x["suite"]: x["passed"] for x in RES["suites"]}
    # core
    s.rect(24, 86, 792, 140, C["petrol-50"], C["petrol-700"], r=14, sw=2)
    s.text(40, 110, f"packages/core  ·  pure, deterministic product brain  ·  {suites['core']} tests", 15, 700, INK)
    mods = ["geo", "regime", "density", "discovery", "refresh", "director", "policy", "safety", "resume", "brief", "story-primitive", "grounding", "segment", "intent", "journey", "memory", "guides"]
    x, y = 40, 124
    for m in mods:
        w = len(m) * 7.4 + 18
        if x + w > 804:
            x, y = 40, y + 32
        s.rect(x, y, w, 24, "#FFFFFF", C["petrol-500"], r=12, sw=1.1)
        s.text(x + w / 2, y + 16.5, m, 12, 600, INK, "middle")
        x += w + 7
    s.text(40, 214, "No I/O, no clock, no randomness: time and ids are injected. A build-time test forbids city names and fixture imports.", 11.5, 500, INK2)

    # providers + replay + client
    s.box(24, 262, 250, 92, "packages/providers", [f"adapters + router + guard + fakes · {suites['providers']} tests", "OpenAI, Gemini, Anthropic, Google TTS/Places,", "Wikimedia"], "det", tsize=14, ssize=11.5)
    s.box(294, 262, 250, 92, "packages/client", [f"typed API client, channel, sequencer, LocalEngine · {suites['client']} tests", "shared by web and mobile"], "det", tsize=14, ssize=11.5)
    s.box(566, 262, 250, 92, "packages/replay", [f"replay harness + acceptance asserts · {suites['replay']} tests", "synthetic traces over fixture packs"], "det", tsize=14, ssize=11.5)
    for x0 in (149, 419, 691):
        s.arrow([(x0, 262), (x0, 226)], INK2, 1.5)

    # apps
    s.box(24, 392, 250, 118, "apps/api", [f"Fastify, WebSocket, Postgres, Redis · {suites['api']} tests", "sessions, directives, tools, admin API,", "telemetry + cost ledger, migrations"], "det", tsize=14.5, ssize=11.5)
    s.box(294, 392, 250, 118, "apps/web", ["Next.js 15: site + /app + /admin", "5 Playwright smoke tests (+5 screenshot specs)", "runs LocalEngine in-browser for offline demo"], "ok", tsize=14.5, ssize=11.5)
    s.box(566, 392, 250, 118, "apps/mobile", [f"Expo SDK 57 / RN, dev-client · {suites['mobile']} logic tests", "Explore, Drive HUD, History, Settings, admin", "bundles build; no device run"], "warn", tsize=14.5, ssize=11.5)
    s.arrow([(149, 392), (149, 354)], INK2, 1.5)
    s.arrow([(419, 392), (419, 354)], INK2, 1.5)
    s.arrow([(691, 392), (691, 374), (480, 374), (480, 354)], INK2, 1.5)
    s.text(24, 534, "Arrows point from a package to what it depends on. fixtures/ is loaded only by tests, replay and a labelled demo mode (D-005).", 11.5, 500, INK2)
    s.footer(f"Source: DECISIONS.md D-001; `pnpm -r test` run 2026-10-04 ({sum(suites.values())} tests, 0 failures). Web e2e: 5/5 smoke tests pass (Playwright, offline demo).")
    return s


def fig_pipeline() -> Svg:
    s = Svg(840, 548, "Narrative pipeline", "Evidence to spoken audio, with deterministic and LLM stages distinguished")
    s.header("Narrative pipeline: evidence to audio", "The model writes sentences; deterministic code decides everything else and checks the model's work")
    y = 112
    # row 1
    bw, bh, gap = 120, 78, 12
    xs = [24 + i * (bw + gap) for i in range(6)]
    steps1 = [
        ("Discovery", ["corridor / radius,", "regime x density"], "det"),
        ("Rank + decide", ["significance, safety,", "silence policy"], "det"),
        ("EvidencePack", ["facts + provenance", "Wikimedia (cached 7 d)"], "det"),
        ("StoryBrief", ["angle, fact subset,", "word budget, guide"], "det"),
        ("Body cache?", ["key = place, angle,", "facts, guide, locale"], "store"),
        ("LLM prose", ["temperature 0,", "no listener context"], "llm"),
    ]
    for (t, sub, k), x in zip(steps1, xs):
        s.box(x, y, bw, bh, t, sub, k, tsize=13.5, ssize=11)
    for i in range(5):
        s.arrow([(xs[i] + bw, y + bh / 2), (xs[i + 1], y + bh / 2)], INK2, 1.5)
    s.text(xs[4] + bw / 2, y - 8, "hit: no LLM call", 11.5, 600, C["success"], "middle")
    # row 2
    y2 = 262
    steps2 = [
        ("GroundingCheck", ["numbers, years, names", "must be in the evidence"], "det"),
        ("Retry once, then", ["deterministic template", "from the same facts"], "det"),
        ("Prefix template", ["spatial cue + place", "+ optional callback"], "det"),
        ("NarrativePlan", ["ordered segments,", "stable id + hash"], "det"),
        ("TTS per segment", ["content-addressed,", "tiered voice"], "llm"),
        ("Play directive", ["client plays, reports", "segment progress"], "det"),
    ]
    xs2 = [24 + i * (bw + gap) for i in range(6)]
    # connect row1 end -> row2 start (down, then left)
    s.arrow([(xs[5] + bw / 2, y + bh), (xs[5] + bw / 2, y2 - 30), (xs2[0] + bw / 2, y2 - 30), (xs2[0] + bw / 2, y2)], INK2, 1.5)
    s.arrow([(xs[4] + bw / 2, y + bh), (xs[4] + bw / 2, y2 - 14), (xs2[3] + bw / 2, y2 - 14), (xs2[3] + bw / 2, y2)], C["success"], 1.6)
    s.text(xs2[3] + bw / 2 - 8, y2 - 17, "cached body is already grounded: straight to the plan", 11, 600, C["success"], "end")
    for (t, sub, k), x in zip(steps2, xs2):
        s.box(x, y2, bw, bh, t, sub, k, tsize=13.5, ssize=11)
    for i in range(5):
        s.arrow([(xs2[i] + bw, y2 + bh / 2), (xs2[i + 1], y2 + bh / 2)], INK2, 1.5)
    # bottom notes
    s.rect(24, 372, 792, 108, "#FFFFFF", LINE_C := C["sand-200"], r=10, sw=1.2)
    s.text(40, 396, "Why this shape matters commercially", 13.5, 700, INK)
    s.lines(40, 416, [
        "1. The cacheable unit is the context-free story body: one LLM + TTS spend can serve many listeners (production hit rate NOT YET MEASURED).",
        "2. A model outage degrades to template text for the same target; the model never picks the place, the timing or the length.",
        "3. Every spoken sentence is checked against evidence before it is voiced, so the failure mode is bland, not invented.",
    ], 12, 500, INK2, lh=1.4, maxw=752)
    s.legend(24, 496, [("det", "Deterministic code"), ("llm", "Generative model (paid)"), ("store", "Cache / store")], size=12)
    s.footer("Source: DECISIONS.md D-003, D-009, D-018; packages/core (brief, story-primitive, grounding, segment). TTS is a generative provider call even though text is fixed.")
    return s


def fig_state() -> Svg:
    s = Svg(840, 570, "Conversation, interruption and resume states", "State machine for narration, listening, answering and resume decisions")
    s.header("Conversation, interruption and resume", "Barge-in stops audio first; the resume decision is a deterministic policy, not a model call")
    B = lambda x, y, w, h, t, sub, k: s.box(x, y, w, h, t, sub, k, tsize=14.5, ssize=11.8)
    B(24, 110, 150, 80, "Quiet", ["silence policy holds;", "nothing worth saying"], "plain")
    B(300, 110, 210, 80, "Telling story", ["segment k of n playing", "pause / OS call: held until tap"], "det")
    B(640, 110, 176, 80, "Listening", ["opened by a user press;", "never auto while driving"], "ok")
    B(24, 270, 150, 80, "Abandoned", ["passed, stale, superseded,", "nearly done, topic change"], "warn")
    B(300, 270, 210, 80, "Resume decision", ["ResumePolicy:", "resume | abandon"], "det")
    B(640, 270, 176, 80, "Answering", ["intent, tool (nearby),", "grounded sentence"], "det")
    s.arrow([(174, 150), (300, 150)], INK2, 1.7, label="moment approved", lsize=12, loff=(0, -9))
    s.arrow([(510, 150), (640, 150)], INK2, 1.7, label="mic / barge-in", lsize=12, loff=(0, -9))
    s.text(575, 176, "audio stops first", 11.5, 700, C["ember-ink"], "middle")
    s.arrow([(728, 190), (728, 270)], INK2, 1.7)
    s.text(738, 235, "utterance", 12, 500, INK2)
    s.arrow([(640, 310), (510, 310)], INK2, 1.7, label="answer finished", lsize=12, loff=(0, -9))
    s.arrow([(405, 270), (405, 190)], C["success"], 2, )
    s.text(415, 235, "resume at segment k", 12, 700, C["success"])
    s.arrow([(300, 310), (174, 310)], INK2, 1.7, label="abandon", lsize=12, loff=(0, -9))
    s.rect(24, 376, 792, 112, "#FFFFFF", C["sand-200"], r=10, sw=1.2)
    s.text(40, 400, "Deterministic rules behind the arrows (packages/core/src/resume.ts, safety.ts)", 13.5, 700, INK)
    s.lines(40, 420, [
        "Resume restarts at the START of the interrupted segment (a sentence group); a bridge phrase is added if the pause exceeded 8 s or an answer was spoken.",
        "Abandon when: a newer plan exists; the target is passed (driving: more than 50 m behind; walking: more than 400 m away); the pause is stale",
        "(walking 3 min, driving 90 s); or 85% of the segments were already told. An explicit topic change never auto-resumes the old story (acceptance C3).",
        "If listening closes with no utterance, the same policy decides on the next tick.",
    ], 11.8, 500, INK2, lh=1.4, maxw=752)
    s.legend(24, 504, [("det", "Server policy state"), ("ok", "User-initiated"), ("warn", "Terminal")], size=12)
    s.footer("Source: DECISIONS.md D-008/D-009; acceptance C1, C3, E3. Exercised in tests with fake providers; not yet on a physical device.")
    return s


def fig_providers() -> Svg:
    s = Svg(840, 590, "Provider abstraction, routing, fallback and budget", "Interfaces, router chains, guard and adapters")
    s.header("Provider abstraction, routing and budget", "Every paid or external call passes one guard; a refusal stops the chain instead of fanning out")
    # left: interfaces
    s.text(24, 92, "CORE INTERFACES", 12, 700, INK3, spacing=1.2)
    ifs = ["TextGenerator", "SpeechSynthesizer", "SpeechRecognizer", "RealtimeTokenIssuer", "PlaceSource", "KnowledgeSource", "NearbySearch"]
    for i, n in enumerate(ifs):
        s.box(24, 104 + i * 52, 170, 42, n, None, "det", tsize=13, r=8)
    # center: router + guard
    s.rect(236, 104, 250, 358, C["petrol-50"], C["petrol-700"], r=14, sw=2)
    s.text(361, 130, "ProviderRouter", 16, 700, INK, "middle")
    s.text(361, 148, "ordered chain per task", 12, 500, INK2, "middle")
    s.box(252, 164, 218, 120, "ProviderGuard", ["per-session call caps + global per-minute caps", "$1.00 estimated per-session USD cap", "circuit breaker, 1 retry max, timeout", "metered(): cost + latency + cache flag"], "det", tsize=13.5, ssize=11, r=8)
    s.box(252, 296, 218, 62, "Fallback rule", ["provider error: next in chain", "budget refusal / abort: STOP"], "warn", tsize=13, ssize=11, r=8)
    s.box(252, 370, 218, 78, "Floors (always available)", ["story: deterministic template", "voice: text + device TTS", "intent: heuristic rules"], "ok", tsize=13, ssize=11, r=8)
    for i in range(7):
        s.arrow([(194, 125 + i * 52), (236, 125 + i * 52 if i < 6 else 125 + 6 * 52)], INK3, 1.1)
    # right: adapters
    s.text(530, 92, "ADAPTERS (chain order)", 12, 700, INK3, spacing=1.2)
    chains = [
        ("Story / intent / follow-up", "OpenAI  >  Gemini  >  Anthropic"),
        ("TTS standard", "OpenAI gpt-4o-mini-tts  >  Gemini"),
        ("TTS economy (highway)", "Google Cloud WaveNet  >  standard chain"),
        ("STT", "device  >  OpenAI  >  Gemini"),
        ("Realtime token", "OpenAI Realtime  >  Gemini Live  (NOT RUN)"),
        ("Discovery + evidence", "Wikimedia  (Google Places: opt-in, never cached)"),
        ("Nearby search (tool)", "Google Places Nearby Pro, on user question"),
    ]
    for i, (a, b) in enumerate(chains):
        s.box(530, 104 + i * 52, 286, 44, a, [b], "ext" if i != 4 else "warn", tsize=12.5, ssize=11, r=8, sw=1.2)
        s.arrow([(486, 213), (530, 126 + i * 52)], INK3, 1.0, dash="3 3")
    # bottom: fakes
    s.rect(24, 478, 792, 76, "#FFFFFF", C["sand-200"], r=10, sw=1.2)
    s.lines(40, 502, ["Deterministic fakes implement every interface, with injectable simulated latency. All 460 tests and the whole benchmark run on fakes:", "no real provider has been exercised."], 12.2, 700, INK, lh=1.35, maxw=752)
    s.lines(40, 540, ["Model ids are env-configurable; `pnpm bench:providers` checks ids against each provider's model list before any switch (NOT YET RUN: no keys)."], 11.8, 500, INK2, maxw=752)
    s.footer("Source: packages/providers (router.ts, resilience.ts, metered.ts, pricing.ts), docs/PERFORMANCE_COST.md §12.")
    return s


def fig_cache() -> Svg:
    cr = RES["cacheRates"]["phases"]
    def hm(phase, layer):
        d = cr[phase][layer]
        return f"{d['hits']}/{d['hits'] + d['misses']}"
    s = Svg(840, 656, "Data and cache layers", "Cache layers with keys, TTLs and measured harness hit counters")
    s.header("Data and cache layers", "Five layers keep expensive calls late and shared; harness counters shown, production rates NOT YET MEASURED")
    cols = [("LAYER", 34), ("KEY / SCOPE", 182), ("TTL", 416), ("COLD", 484), ("PROSE WARM", 548), ("ALL WARM", 650), ("SAVES", 728)]
    for t, x in cols:
        s.text(x, 92, t, 11, 700, INK3, spacing=0.6)
    rows = [
        ("Discovery places", ["pl:v1:geohash cell + radius bucket", "+ kinds + lang; shared; Wikimedia only"], "15 min", "places", "Wikimedia calls", "store"),
        ("Evidence", ["ev:v1:placeId:lang, shared;", "negative results cached 6 h"], "7 days", "evidence", "Wikimedia calls", "store"),
        ("Narration body", ["nb:v1:hash(place, angle, facts, guide,", "locale, mode, budget bucket); no user data"], "30 days", "narrationBody", "LLM call", "llm"),
        ("TTS audio", ["sha256(segment, provider, model, voice);", "immutable URL, disk"], "no expiry", "ttsAudio", "TTS characters", "llm"),
    ]
    y = 104
    for name, key, ttl, layer, saves, kind in rows:
        s.rect(24, y, 804, 70, "#FFFFFF", C["sand-200"], r=8, sw=1.2)
        s.text(34, y + 28, name, 14, 700, INK)
        s.lines(182, y + 26, key, 11.5, 500, INK2, lh=1.35)
        s.text(416, y + 28, ttl, 12.5, 600, INK)
        s.text(484, y + 28, hm("cold", layer), 13, 700, INK)
        s.text(548, y + 28, hm("cachedProseColdAudio", layer), 13, 700, INK)
        s.text(650, y + 28, hm("fullyWarm" if "fullyWarm" in cr else list(cr.keys())[-1], layer), 13, 700, INK)
        s.text(728, y + 28, saves, 11.5, 600, INK2)
        s.text(34, y + 52, "hits / lookups, harness", 10.5, 500, INK3)
        y += 80
    # prefix row
    s.rect(24, y, 804, 56, C["warn-bg"], C["warn"], r=8, sw=1.2, dash="5 4")
    s.text(34, y + 24, "Prefix (cue + place)", 14, 700, INK)
    s.lines(182, y + 24, ["Personal part of every story, spoken as segment 0. Modelled as never cached (0%): conservative."], 11.5, 500, INK2, maxw=636)
    s.lines(182, y + 42, [f"Harness: prefix-text repeats gave audio hits {hm('cachedProseColdAudio','ttsAudio')} when body audio was evicted."], 11.5, 500, INK2, maxw=636)
    y += 68
    s.rect(24, y, 804, 76, C["ember-100"], C["ember-ink"], r=8, sw=1.4)
    s.text(36, y + 24, "Read this honestly", 13.5, 700, INK)
    s.lines(36, y + 44, [
        "These counters come from ONE fixture route (WTC walk) replayed 36 times in one process. A repeated route is the best case for any cache.",
        "They prove the mechanism works; they say nothing about how often real users share a place, angle, guide and budget bucket.",
    ], 11.8, 500, INK2, lh=1.35)
    y += 92
    s.lines(24, y, ["Store of record: Postgres 16 (sessions, journey memory, stories, events, cost ledger, audit).", "Hot state and rate limits: Redis 7. Redis loss = explicit reduced mode, not outage."], 11.8, 500, INK2, maxw=792)
    s.footer("Source: benchmark/acceptance/results.json cacheRates (MEASURED-harness, 36 sessions per phase); DECISIONS.md D-011, D-018. Google Places results are never cached (terms).")
    return s


def fig_surfaces() -> Svg:
    s = Svg(840, 480, "Web, mobile and admin surface relationship", "How the surfaces share one backend and one decision core")
    s.header("Surfaces: web, mobile, admin", "One backend and one decision core; each surface is a sensor, a renderer and an audio player")
    s.box(24, 100, 250, 130, "apps/web (Next.js)", ["route group (site): public website", "route group (app): WebApp / PWA", "route group (admin): operations console", "built, 5/5 smoke e2e, locally only"], "ok", tsize=15, ssize=11.5)
    s.box(566, 100, 250, 130, "apps/mobile (Expo)", ["Explore + Drive HUD, History, Settings", "hidden Operator entry (long-press version)", "native location, background audio", "bundles build; no device run"], "warn", tsize=15, ssize=11.5)
    s.rect(24, 290, 792, 74, C["petrol-50"], C["petrol-700"], r=12, sw=2)
    s.text(420, 316, "Telvey API  ·  one contract (docs/API.md), one WebSocket per session, REST fallback", 15, 700, INK, "middle")
    s.text(420, 338, "ContextFrames up, Directives down (play, stop_audio, map, listen, say, navigate_handoff, state, card)", 12.5, 500, INK2, "middle")
    s.text(420, 355, "server-side ranking, timing, safety, budgets and resume; clients never choose targets", 12.5, 500, INK2, "middle")
    s.arrow([(149, 230), (149, 290)], INK2, 1.6, both=True)
    s.arrow([(691, 230), (691, 290)], INK2, 1.6, both=True)
    s.box(298, 100, 244, 56, "packages/client", ["LocalEngine, channel, sequencer, i18n"], "det", tsize=13.5, ssize=11)
    s.box(298, 172, 244, 58, "packages/core (in the browser too)", ["offline demo runs the real pipeline"], "det", tsize=13, ssize=11)
    s.arrow([(274, 128), (298, 128)], INK3, 1.2)
    s.arrow([(542, 128), (566, 128)], INK3, 1.2)
    s.arrow([(420, 156), (420, 172)], INK3, 1.2)
    # pairing flow
    s.rect(24, 384, 792, 64, "#FFFFFF", C["sand-200"], r=10, sw=1.2)
    adm = "Admin access: web console uses WebAuthn passkeys (first owner bootstrapped by a one-time server CLI code). A signed-in admin issues a 5-minute pairing QR; the phone redeems it for a revocable, role-scoped device token kept in secure storage. No static password or secret ships in any client. Every admin action is audited."
    s.lines(40, 406, wrap(adm, 12, 500, 760), 12, 500, INK2, lh=1.4)
    s.footer("Source: docs/API.md auth model, docs/MOBILE.md §1, DECISIONS.md D-002, D-013. Mobile admin has not been run on a device.")
    return s


def fig_userflow() -> Svg:
    s = Svg(840, 600, "User flow", "Guest entry, walk or drive, story, interrupt, nearby, resume")
    s.header("User flow", "From first open to resumed story, with the driving branch")
    xs = [24 + i * 162 for i in range(5)]
    bw, bh = 144, 70
    r1 = [
        ("1  Open as guest", ["no account, no card;", "explains permissions"], "ok"),
        ("2  Pick a Guide", ["Ida or Emil;", "same facts, other voice"], "ok"),
        ("3  Start exploring", ["real location or a", "labelled simulated trip"], "ok"),
        ("4  Quiet unless worth it", ["director scores candidates;", "silence is a state"], "plain"),
        ("5  Story begins", ["cue + place, then body;", "ahead / near / passed"], "det"),
    ]
    for (t, sub, k), x in zip(r1, xs):
        s.box(x, 100, bw, bh, t, sub, k, tsize=12.5, ssize=10.8)
    for i in range(4):
        s.arrow([(xs[i] + bw, 135), (xs[i + 1], 135)], INK2, 1.5)
    # second row (right to left)
    r2 = [
        ("6  User interrupts", ["press mic or say name;", "audio stops first"], "ok"),
        ("7  Intent + tool", ["'coffee nearby' runs a", "separate NearbySearch"], "det"),
        ("8  Answer + map", ["validated rows only;", "spoken + highlighted"], "det"),
        ("9  Resume or let go", ["ResumePolicy decides;", "never silently restarts"], "det"),
        ("10  Hand off", ["'navigate there' opens", "Google/Apple Maps"], "plain"),
    ]
    xs2 = list(reversed(xs))
    for (t, sub, k), x in zip(r2, xs2):
        s.box(x, 220, bw, bh, t, sub, k, tsize=12.5, ssize=10.8)
    s.arrow([(xs[4] + bw / 2, 170), (xs[4] + bw / 2, 195), (xs2[0] + bw / 2, 195), (xs2[0] + bw / 2, 220)], INK2, 1.5)
    # arrows between row 2 (right to left)
    for i in range(4):
        s.arrow([(xs2[i], 255), (xs2[i + 1] + bw, 255)], INK2, 1.5)
    # fix: row 2 order: 6 at right ... 10 at left
    # drive branch
    s.rect(24, 330, 792, 190, C["petrol-800"], C["petrol-900"], r=14, sw=1.5)
    s.text(40, 358, "Driving branch (automatic, regime-driven; no mode switch)", 15, 700, "#FFFFFF")
    para = [
        "Speed and road class move the regime from walking to urban or highway driving. Look-ahead grows with speed and significance; stories shorten (highway cap 75 s, urban 60 s).",
        "The screen becomes a dark HUD: one status line, one 96 dp mic, no lists, no typing, no Guide questions. Listening opens only on an explicit press.",
        "On a quiet highway the correct output is silence (replay: 98.7% silent over 105 minutes, longest gap 32 min). Speech onset is held during manoeuvres.",
        "Walking again later: the same session continues; thresholds and cadence fall back to the walking set without a restart (acceptance A6, replay).",
    ]
    ls = []
    for t in para:
        ls += wrap(t, 12.2, 500, 752)
    s.lines(40, 380, ls, 12.2, 500, "#DCECEE", lh=1.5)
    s.legend(24, 540, [("ok", "User action"), ("det", "Server decision"), ("plain", "State / hand-off")], size=12)
    s.footer("Source: DECISIONS.md D-006..D-009; benchmark/replay/summary.json (interstate, transition); docs/MOBILE.md. Flow exercised in the web demo and in tests with fakes.")
    return s


if __name__ == "__main__":
    from svgkit import save

    for name, fn in [
        ("fig01-system-context", fig_system_context),
        ("fig02-service-modules", fig_modules),
        ("fig03-narrative-pipeline", fig_pipeline),
        ("fig04-conversation-state", fig_state),
        ("fig05-provider-routing", fig_providers),
        ("fig06-data-cache-layers", fig_cache),
        ("fig07-surfaces", fig_surfaces),
        ("fig10-user-flow", fig_userflow),
    ]:
        save(fn(), name, OUT)
        print("wrote", name)
