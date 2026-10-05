#!/usr/bin/env python3
"""Assert that the headline numbers in deliverables/INVESTOR_REPORT.md appear identically to the benchmark JSON.

Reads benchmark/acceptance/{results,latency}.json, benchmark/cost/cost_model.json and benchmark/research/market.json,
formats each headline value the way the report prints it, and fails (exit 1) if the report does not contain that exact
string. Also fails on a few known-bad strings that earlier drafts used. Usage: python3 scripts/report/check-numbers.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = (ROOT / "deliverables/INVESTOR_REPORT.md").read_text()
R = json.loads((ROOT / "benchmark/acceptance/results.json").read_text())
L = json.loads((ROOT / "benchmark/acceptance/latency.json").read_text())
C = json.loads((ROOT / "benchmark/cost/cost_model.json").read_text())
M = json.loads((ROOT / "benchmark/research/market.json").read_text())

results: list[tuple[bool, str, str]] = []


def need(label: str, needle: str) -> None:
    results.append((needle in REPORT, label, needle))


def forbid(label: str, needle: str) -> None:
    results.append((needle not in REPORT, f"(must not appear) {label}", needle))


def ms(x: float) -> str:
    # Round half up (1544.5 -> 1,545), as a reader would; Python's round() is half-to-even.
    from decimal import ROUND_HALF_UP, Decimal
    return f"{int(Decimal(str(x)).quantize(Decimal('1'), rounding=ROUND_HALF_UP)):,}"


def pair_ms(m: dict) -> str:
    return f"{ms(m['p50'])} / {ms(m['p95'])}"


def usd(x: float, nd: int = 3) -> str:
    return f"{x:.{nd}f}"


# ---- tests and acceptance ---------------------------------------------------------------------------------------
total = sum(s["passed"] for s in R["suites"])
assert all(s["failed"] == 0 for s in R["suites"]), "a suite has failures; update the report"
need("total tests", f"{total}")
for s in R["suites"]:
    need(f"suite {s['suite']}", f"| {s['passed']} |")
sc = R["statusCounts"]
need("acceptance counts", f"{sc['PASS']} PASS, {sc['PARTIAL']} PARTIAL, 0 FAIL, {sc['NOT RUN']} NOT RUN")
need("acceptance counts (exec)", f"{sc['PASS']} PASS, {sc['PARTIAL']} PARTIAL, 0 FAIL, {sc['NOT RUN']} NOT RUN")
need("scenario count", f"{sum(sc.values())} scenarios")
for s in R["scenarios"]:  # every scenario id is in the report with its status next to it
    row = next((ln for ln in REPORT.splitlines() if ln.startswith(f"| {s['id']} |")), "")
    results.append((s["status"] in row, f"scenario {s['id']} status", f"{s['id']} {s['status']}"))
need("web e2e", f"| Web end-to-end (Playwright, Chromium, offline demo) | {R['web']['passed']} |")
need("wrong-target", "0 of 33 stories")
need("relevance assertions", "26 of 26")
need("guide packs", f"{R['replay']['guideDifferentiation']['packs']} of {R['replay']['guideDifferentiation']['packs']}")

# ---- latency ------------------------------------------------------------------------------------------------------
m = L["metrics"]
need("trigger to first audio", pair_ms(m["triggerToFirstAudio"]))
need("trigger to first audio (exec)", f"{ms(m['triggerToFirstAudio']['p50'])} ms / {ms(m['triggerToFirstAudio']['p95'])} ms")
need("cached body-only", pair_ms(m["cachedStoryToFirstAudio"]))
need("cached warm", f"{round(m['cachedWarmStoryToFirstAudio']['p50'])} / {round(m['cachedWarmStoryToFirstAudio']['p95'])}")
need("coffee", pair_ms(m["speechEndToFirstAudioNearby"]))
need("follow-up", pair_ms(m["speechEndToFirstAudioFollowup"]))
need("nearby to map", pair_ms(m["nearbySearch"]))
need("barge-in", f"{m['bargeInStop']['p50']:.1f} / {m['bargeInStop']['p95']:.1f}")
need("context ingest", f"{m['contextIngest']['p50']:.1f} / {m['contextIngest']['p95']:.1f}")

# ---- replay -------------------------------------------------------------------------------------------------------
rs = {s["scenario"]: s for s in R["replay"]["scenarios"]}
inter = rs["interstate"]
need("I-40 silence", f"{inter['silenceRatio'] * 100:.1f}%")
need("I-40 longest gap", f"{round(inter['maxSilentGapS'] / 60)} min")
need("I-40 queries/h", f"{inter['providerQueries']['perHour']}")
need("I-40 stories", f"{inter['storiesStarted']} stories")

# ---- cost ---------------------------------------------------------------------------------------------------------
sess = {(r["scenario"], r["mix"], r["sharedStoryCacheHit"], r["realtimeProvider"]): r for r in C["sessionCosts"]}


def tot(scn: str, mix: str, hit: float, rt=None) -> float:
    return sess[(scn, mix, hit, rt)]["total"]


need("walk30 default", usd(tot("walk30", "default", 0)))
need("walk30 default 50%", usd(tot("walk30", "default", 0.5)))
need("urban default", usd(tot("drive30_urban", "default", 0)))
need("highway default", usd(tot("drive30_highway", "default", 0), 4))
need("highway tiered", usd(tot("drive30_highway", "tiered", 0), 4))
need("walk60 default", usd(tot("walk60_interactive", "default", 0)))
need("rt walk (openai mini)", usd(tot("walk30_rt5", "default", 0, "openai:gpt-realtime-2.1-mini")))
need("stress default", usd(tot("stress30", "default", 0)))
for rt in C["realtimeActiveMinute"]:
    need(f"realtime/min {rt['provider']}", usd(rt["usdPerActiveMinute"], 4))
truck = {(r["mix"], r["sharedStoryCacheHit"]): r for r in C["truckDriverMonth"]["rows"] if r["trace"] == "interstate"}
for mix in ("default", "tiered", "economy", "gemini2027", "premium", "wavenet_all", "places_discovery"):
    for hit in (0, 0.5, 0.8):
        need(f"truck {mix} {hit}", f"${truck[(mix, hit)]['monthlyUsd']:,.2f}")
need("truck net revenue", f"${C['truckDriverMonth']['plan']['net']:.2f}")
need("truck default per hour", usd(truck[("default", 0)]["usdPerHour"]))
need("truck tiered per hour", usd(truck[("tiered", 0)]["usdPerHour"]))
ue = {c["case"]: c for c in C["unitEconomics"]["cases"]}
need("paid-user margin", f"{round(ue['Small']['paidUser']['variableMargin'] * 100)}%")
need("net revenue per payer month", f"${ue['Small']['paidUser']['netRevenuePerMonth']:.2f}")
need("variable cost per payer month", f"${ue['Small']['paidUser']['variableCostPerMonth']:.2f}")
need("revenue per MAU", f"{C['unitEconomics']['revenue']['revenuePerMauUsd']:.3f}")
need("fundable sessions", f"{ue['Medium']['fundableSessionsPerMauPerMonth']:.2f} sessions")
be = sorted(c["breakEvenPayingShareDefault0"] for c in ue.values())
need("break-even range", f"{round(be[0] * 100)}% to {round(be[-1] * 100)}%")
for name, c in ue.items():
    need(f"{name} variable default@0%", f"${round(c['default@0%']['monthlyVariableUsd']):,}")
    need(f"{name} variable default@50%", f"${round(c['default@50%']['monthlyVariableUsd']):,}")
    need(f"{name} revenue", f"${round(c['revenueUsd']):,}")

# ---- market -------------------------------------------------------------------------------------------------------
s = M["summary"]
need("consumer TAM", f"${s['consumerTamUsd'] / 1e9:.2f}B")
need("consumer SAM", f"${s['consumerSamUsd'] / 1e9:.2f}B")
need("consumer SOM", f"${s['consumerSomYear3Usd'] / 1e6:.1f}M")
need("SOM range", f"${s['consumerSomYear3RangeUsd'][0] / 1e6:.1f}M to ${s['consumerSomYear3RangeUsd'][1] / 1e6:.1f}M")
for seg in M["consumer"][:3]:
    need(f"TAM {seg['segment']}", f"${seg['tam']['usd'] / 1e9:.2f}B" if seg["tam"]["usd"] >= 1e9 else f"${round(seg['tam']['usd'] / 1e6)}M")

# ---- cache counters (harness) ---------------------------------------------------------------------------------------
cr = R["cacheRates"]["phases"]
need("body cold", f"{cr['cold']['narrationBody']['hits']} of {cr['cold']['narrationBody']['hits'] + cr['cold']['narrationBody']['misses']}")
need("audio warm", f"{cr['cachedWarm']['ttsAudio']['hits']} of {cr['cachedWarm']['ttsAudio']['hits'] + cr['cachedWarm']['ttsAudio']['misses']}")

# ---- strings earlier drafts used that must not return ---------------------------------------------------------------
forbid("old line count", "29,000 lines")
forbid("invented competitor names", "Travel Tales")
forbid("unsourced quote", "full of trivia")
forbid("unverified domain claim", "domains are registered")

bad = [r for r in results if not r[0]]
for ok, label, needle in results:
    if not ok:
        print(f"FAIL  {label}: expected report to contain {needle!r}")
print(f"{len(results) - len(bad)}/{len(results)} checks pass")
sys.exit(1 if bad else 0)
