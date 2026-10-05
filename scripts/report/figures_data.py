"""Data-driven investor figures: competitor matrix, TAM/SAM/SOM bridge, roadmap, acceptance status, unit economics.
Every number is read from benchmark/*.json at build time."""
from __future__ import annotations

import json
import math
from pathlib import Path

from svgkit import C, INK, INK2, INK3, ROOT, Svg, save, tw, wrap

OUT = ROOT / "deliverables/figures"
COMP = json.loads((ROOT / "benchmark/research/competitors.json").read_text())
MKT = json.loads((ROOT / "benchmark/research/market.json").read_text())
RES = json.loads((ROOT / "benchmark/acceptance/results.json").read_text())
COST = json.loads((ROOT / "benchmark/cost/cost_model.json").read_text())


def money(v: float) -> str:
    if v >= 1e9:
        return f"${v/1e9:.2f}B" if v < 1e10 else f"${v/1e9:.0f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M" if v < 1e8 else f"${v/1e6:.0f}M"
    return f"${v/1e3:.0f}K"


# ---------------------------------------------------------------- fig08
def fig_matrix() -> Svg:
    cols = COMP["featureMatrix"]["columns"]
    heads = {
        "dynamicAnyPlace": ["Any place", "(dynamic)"],
        "proactiveNarration": ["Proactive", "narration"],
        "voiceQA": ["Voice", "Q&A"],
        "drivingMode": ["Driving", "mode"],
        "trajectoryAhead": ["Looks", "ahead"],
        "walkingMode": ["Walking", "mode"],
        "journeyMemory": ["Journey", "memory"],
        "explicitSilencePolicy": ["Silence", "policy"],
        "selectablePersonas": ["Choice of", "voices"],
        "carPlayOrAndroidAuto": ["CarPlay /", "Andr. Auto"],
        "offline": ["Offline"],
        "globalCoverage": ["Global", "coverage"],
    }
    names = {
        "google-maps-gemini": "Google Maps + Gemini",
        "gemini-android-auto": "Gemini in Android Auto",
        "apple-siri-maps": "Apple Siri AI + Maps",
        "chatgpt": "ChatGPT voice",
        "autio": "Autio",
        "voicemap": "VoiceMap",
        "guidealong": "GuideAlong",
        "shaka-guide": "Shaka Guide",
        "smartguide": "SmartGuide",
        "izi-travel": "izi.TRAVEL",
        "roadwhisper": "RoadWhisper",
        "nextour": "Nextour",
        "narrativ": "Narrativ",
    }
    rows = COMP["featureMatrix"]["rows"]
    # Telvey as built (this report's own assessment; Y = works end to end in tests/harness with fakes)
    built = dict(zip(cols, ["P", "Y", "P", "P", "Y", "Y", "Y", "Y", "P", "N", "P", "P"]))
    waytale = {c: "?" for c in cols}
    waytale["selectablePersonas"] = "Y"
    waytale["proactiveNarration"] = "Y"  # App Store listing 2026-10-04: "Companion Mode" plays stories automatically
    waytale["voiceQA"] = "N"  # no Q&A listed (not found in the listing)
    waytale["carPlayOrAndroidAuto"] = "N"  # not listed
    order = [("BUILT", "Telvey as built (fixtures, fakes)"), ("TARGET", "Telvey target (not built)")]
    order += [(k, names[k]) for k in names]
    order += [("WAYTALE", "Waytale (listing read 2026-10-04)")]

    def val(key):
        if key == "BUILT":
            return [built[c] for c in cols]
        if key == "WAYTALE":
            return [waytale[c] for c in cols]
        k = "ourProduct(target)" if key == "TARGET" else key
        return [(x or "?")[0] for x in rows[k]]

    x0, lw, cw = 24, 190, 52.2
    top = 112
    rh = 27
    H = top + rh * len(order) + 150
    s = Svg(840, H, "Competitor feature matrix", "Feature matrix from competitors.json plus Telvey as built")
    s.header("Competitor feature matrix", "Sourced competitor cells (as of 2026-09-27) next to what Telvey actually has today")
    for i, c in enumerate(cols):
        cx = x0 + lw + i * cw + cw / 2
        for j, t in enumerate(heads[c]):
            s.text(cx, 76 + j * 13 + (6 if len(heads[c]) == 1 else 0), t, 10, 700, INK2, "middle")
    sym = {"Y": (C["success"], "#FFFFFF"), "P": (C["amber-500"] if "amber-500" in C else "#D99A1E", "#FFFFFF"), "N": ("#FFFFFF", C["stone-400"]), "?": ("#FFFFFF", C["stone-400"])}
    for r, (key, label) in enumerate(order):
        y = top + r * rh
        if key == "BUILT":
            s.rect(x0 - 6, y - 3, 792 + 12, rh, C["petrol-50"], C["petrol-700"], r=6, sw=1.6)
        elif key == "TARGET":
            s.rect(x0 - 6, y - 3, 792 + 12, rh, "#FFFFFF", C["stone-400"], r=6, sw=1.2, dash="5 4")
        elif r % 2 == 0:
            s.rect(x0 - 6, y - 3, 792 + 12, rh, "#FFFFFF", "none", r=4, opacity=0.55)
        s.text(x0, y + 14, label, 12, 700 if key in ("BUILT", "TARGET") else 600, INK)
        if key in ("GOOGLE", ) or r == 2:
            pass
        for i, v in enumerate(val(key)):
            cx, cy = x0 + lw + i * cw + cw / 2, y + 10.5
            if v == "Y":
                s.circle(cx, cy, 7, C["success"], C["success"], 1)
            elif v == "P":
                s.circle(cx, cy, 7, "#FFFFFF", "#B7791F", 1.8)
                s.parts.append(f'<path d="M{cx:.1f},{cy-7:.1f} A7,7 0 0 0 {cx:.1f},{cy+7:.1f} Z" fill="#B7791F"/>')
            elif v == "N":
                s.circle(cx, cy, 7, "#FFFFFF", C["stone-400"], 1.4)
                s.line(cx - 4, cy, cx + 4, cy, C["stone-400"], 1.4)
            else:
                s.text(cx, cy + 4.5, "?", 13, 700, INK3, "middle")
    ly = top + rh * len(order) + 14
    s.circle(30, ly, 6, C["success"], C["success"])
    s.text(42, ly + 4, "Yes (sourced for competitors)", 11.5, 500, INK2)
    s.circle(215, ly, 6, "#FFFFFF", "#B7791F", 1.8)
    s.parts.append(f'<path d="M215,{ly-6} A6,6 0 0 0 215,{ly+6} Z" fill="#B7791F"/>')
    s.text(227, ly + 4, "Partial", 11.5, 500, INK2)
    s.circle(290, ly, 6, "#FFFFFF", C["stone-400"], 1.4)
    s.line(286, ly, 294, ly, C["stone-400"], 1.4)
    s.text(302, ly + 4, "No / not found", 11.5, 500, INK2)
    s.text(410, ly + 4.5, "?", 13, 700, INK3)
    s.text(422, ly + 4, "Unknown", 11.5, 500, INK2)
    notes = [
        "Telvey as built: Yes = works end to end in tests, replay or the harness with fake providers; Partial = built but not proven live, on a device or with real providers; No = not built. Our own assessment.",
        "Telvey target row is the aspiration from the earlier feature matrix and is NOT what exists today (CarPlay / Android Auto: not built, needs an Apple entitlement; offline: prefetch only).",
        "Waytale (AI audio city guide, first released 2025-09-03): proactive, voices and the No cells come from its App Store listing read on 2026-10-04; whether stories are generated live is unknown. No / not found means not found in public sources, not proof of absence. Voice choice for Telvey is Partial because no voice has been heard.",
    ]
    yy = ly + 28
    for n in notes:
        for l in wrap(n, 11, 500, 790):
            s.text(24, yy, l, 11, 500, INK3)
            yy += 13.5
        yy += 2
    s.text(24, yy + 6, "Source: benchmark/research/competitors.json (featureMatrix, retrieved 2026-09-27); Telvey as-built row from results.json and docs/STATUS.md.", 11, 500, INK3)
    s.h = int(yy + 20)
    return s


# ---------------------------------------------------------------- fig09
def fig_tam() -> Svg:
    cons = MKT["consumer"][:3]
    s = Svg(840, 650, "TAM, SAM and SOM bridge", "Bottom-up consumer TAM to SAM to year-3 SOM for three segments, log scale")
    s.header("TAM, SAM and SOM: a bottom-up bridge", "Annual revenue before store fees, USD, log scale; each step names its assumption and whether it is sourced")
    lo, hi = 2e5, 1e10
    px0, px1 = 215, 790

    def X(v):
        return px0 + (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * (px1 - px0)

    ticks = [1e6, 1e7, 1e8, 1e9, 1e10]
    for t in ticks:
        s.line(X(t), 96, X(t), 560, C["sand-200"], 1)
        s.text(X(t), 90, {1e6:"$1M",1e7:"$10M",1e8:"$100M",1e9:"$1B",1e10:"$10B"}[t], 11, 600, INK3, "middle")
    steps = [
        ("US leisure road-trippers", cons[0],
         ["120M adults x $39.99/yr [ASSUMED users, assumed price]", "x 64% use AI x 55% pay for AI [sourced, Menlo 2026]", "x 0.25% reached by year 3 [ASSUMED, range 0.15-0.5%]"]),
        ("Inbound visitors to US", cons[1],
         ["68.3M visits x 1 pass x $9.99 [sourced visits, assumed price]", "x 50% English-comfortable [ASSUMED] x 35.2% AI payers", "x 0.2% buy a pass [ASSUMED, range 0.1-0.4%]"]),
        ("US long-haul truck drivers", cons[2],
         ["2.22M (BLS) x 50% long-haul [ASSUMED] x $9.99 x 12", "x 35.2% AI payers [derived from Menlo]", "x 2% of SAM by year 3 [ASSUMED, range 1-4%]"]),
    ]
    y = 112
    for name, seg, notes in steps:
        tam, sam, som = seg["tam"]["usd"], seg["sam"]["usd"], seg["somYear3"]["usd"]
        s.text(24, y + 16, name, 13.5, 700, INK)
        for i, (lab, v, col) in enumerate([("TAM", tam, C["petrol-300"]), ("SAM", sam, C["petrol-500"] if "petrol-500" in C else C["petrol-700"]), ("SOM yr 3", som, C["ember-ink"])]):
            by = y + i * 24
            s.rect(px0, by, max(3, X(v) - px0), 17, col, "none", r=3)
            endx = px0 + max(3, X(v) - px0)
            if lab.startswith("SOM") and seg["somYear3"].get("range"):
                endx = max(endx, X(seg["somYear3"]["range"][1]))
            s.text(endx + 8, by + 13, f"{lab}  {money(v)}" + ("  (range " + money(seg["somYear3"]["range"][0]) + " to " + money(seg["somYear3"]["range"][1]) + ")" if lab.startswith("SOM") and seg["somYear3"].get("range") else ""), 11.5, 700, INK)
        if seg["somYear3"].get("range"):
            a, b = seg["somYear3"]["range"]
            by = y + 2 * 24 + 8.5
            s.line(X(a), by, X(b), by, INK, 1.6)
            s.line(X(a), by - 4, X(a), by + 4, INK, 1.6)
            s.line(X(b), by - 4, X(b), by + 4, INK, 1.6)
        for j, n in enumerate(notes):
            s.text(24, y + 36 + j * 13.5, n.split(" [")[0] if False else n, 9.8, 500, INK2) if False else None
        # notes under bars
        ny = y + 78
        for j, n in enumerate(notes):
            s.text(24, ny + j * 13.5, n, 10.3, 500, INK2)
        y += 148
    sm = MKT["summary"]
    s.rect(24, 560, 792, 52, C["warn-bg"], C["warn"], r=8, sw=1.2, dash="5 4")
    tt = (f"Consumer total (three sized segments): TAM {money(sm['consumerTamUsd'])}, SAM {money(sm['consumerSamUsd'])}, SOM year 3 {money(sm['consumerSomYear3Usd'])} "
          f"(range {money(sm['consumerSomYear3RangeUsd'][0])} to {money(sm['consumerSomYear3RangeUsd'][1])}). "
          "The SOM rests on penetration assumptions with no category benchmark; it is a planning number, not a forecast.")
    s.lines(36, 580, wrap(tt, 11.3, 600, 768), 11.3, 600, INK, lh=1.3)
    s.footer("Source: benchmark/research/market.json (asOf 2026-09-27), docs/research/MARKET.md. Third-party market-size headlines are context only and are not used here. Locals and non-US travellers are not sized.", y=H_FOOT(s, 630))
    return s


def H_FOOT(s, y):
    return y


# ---------------------------------------------------------------- fig11
def fig_roadmap() -> Svg:
    s = Svg(840, 566, "Roadmap: sequence of gates", "Gated roadmap from harness MVP to closed beta and a monetization decision")
    s.header("Roadmap: a sequence of gates, not a calendar", "Each phase removes a named blocker or tests one assumption; durations are ASSUMED")
    phases = [
        ("DONE", "0  Harness MVP", "ok", ["API, web, mobile bundle", "460 tests, 27 scenarios", "benchmark on fake providers"], "now"),
        ("1", "1  Unblock and measure", "warn", ["real provider smoke + model ids", "realtime B1-B6 voice benchmark", "live Wikimedia discovery, 3 cities", "economy TTS voice listening test", "name and trademark counsel"], "~2-4 wk ASSUMED"),
        ("2", "2  Devices and deploy", "plain", ["EAS iOS + Android builds", "real-road drive + walk field runs", "VPS + domain + TLS + backups", "mobile admin pairing on a phone"], "~4-8 wk ASSUMED"),
        ("3", "3  Closed beta", "plain", ["50-200 invited testers", "measure cache hit, cost/session", "retention + willingness to pay", "human rubric on story quality"], "~8-12 wk ASSUMED"),
        ("4", "4  Decide", "plain", ["price test vs the cost floor", "CarPlay / Android Auto entitlement", "B2B pilot (DMO, rental, fleet)", "go / narrow / stop"], "gate review"),
    ]
    bw, gap, y0 = 148, 13, 108
    for i, (tag, title, kind, items, dur) in enumerate(phases):
        x = 24 + i * (bw + gap)
        s.rect(x, y0, bw, 250, {"ok": C["success-bg"], "warn": C["warn-bg"], "plain": "#FFFFFF"}[kind], {"ok": C["success"], "warn": C["warn"], "plain": C["stone-400"]}[kind], r=10, sw=1.6, dash=None if kind == "ok" else "5 4")
        s.lines(x + 10, y0 + 24, [title], 13, 700, INK, maxw=bw - 18)
        yy = y0 + 50
        for it in items:
            ls = wrap(it, 11.2, 500, bw - 32)
            s.circle(x + 14, yy - 3.5, 2.2, INK3)
            for l in ls:
                s.text(x + 22, yy, l, 11.2, 500, INK2)
                yy += 14
            yy += 6
        s.pill(x + 10, y0 + 250 - 32, dur, "plain", size=10.5, h=20, padx=8)
        if i < len(phases) - 1:
            s.arrow([(x + bw, y0 + 125), (x + bw + gap, y0 + 125)], INK2, 1.6)
    s.rect(24, 372, 792, 150, "#FFFFFF", C["sand-200"], r=10, sw=1.2)
    s.text(40, 398, "Funding logic: what each scenario is meant to prove (no precise budget is claimed)", 13, 700, INK)
    sc = [
        ("Bridge (phases 1-2)", "Proves the product works with real providers, on real devices and on a real server. Output: a measured cost per session and a latency table replacing the estimates."),
        ("Beta (phase 3)", "Proves people use it twice and that the shared cache and tiered voice bring cost under the plan price. Output: first real hit rate, retention, conversion signal."),
        ("Scale (after phase 4)", "Only if the beta clears the cost floor and a channel (stores, OEM, fleet, DMO) is identified. Not proposed on current evidence."),
    ]
    yy = 422
    for a, b in sc:
        s.text(40, yy, a, 11.8, 700, INK)
        for l in wrap(b, 11.3, 500, 560):
            s.text(212, yy, l, 11.3, 500, INK2)
            yy += 14
        yy += 7
    s.footer("Source: this report's synthesis of docs/STATUS.md blockers (D-010, D-016) and benchmark gaps. Durations are planning assumptions, not commitments; no dates are promised.", y=544)
    return s


# ---------------------------------------------------------------- fig12 acceptance
def fig_accept() -> Svg:
    sc = RES["scenarios"]
    groups = {}
    for x in sc:
        groups.setdefault(x["section"], []).append(x)
    names = {"A": "A  Discovery and ranking", "B": "B  Narration quality", "C": "C  Conversation", "D": "D  Realtime voice", "E": "E  Driving and devices", "F": "F  Failure containment"}
    s = Svg(840, 480, "Acceptance scenarios status", "27 acceptance scenarios grouped by section with PASS, PARTIAL, NOT RUN")
    cnt = RES["statusCounts"]
    s.header("Acceptance status: 13 pass, 8 partial, 0 fail, 6 not run", "Every scenario is a tile; PARTIAL means the demonstrable part passed and a live, device or human check is missing")
    col = {"PASS": (C["success-bg"], C["success"]), "PARTIAL": (C["warn-bg"], "#B7791F"), "NOT RUN": ("#FFFFFF", C["stone-500"]), "FAIL": (C["error-bg"] if "error-bg" in C else "#FDE2E0", "#B42318")}
    y = 90
    for g in "ABCDEF":
        items = groups.get(g, [])
        s.text(24, y + 21, names[g], 12.5, 700, INK)
        for i, it in enumerate(items):
            fill, st = col[it["status"]]
            x = 250 + i * 80
            s.rect(x, y, 72, 30, fill, st, r=6, sw=1.5, dash="4 3" if it["status"] == "NOT RUN" else None)
            s.text(x + 36, y + 19.5, it["id"], 12, 700, INK, "middle")
        y += 46
    s.legend(24, y + 10, [("ok", f"PASS {cnt['PASS']}"), ("warn", f"PARTIAL {cnt['PARTIAL']}"), ("plain", f"NOT RUN {cnt['NOT RUN']} (credentials, devices)")], size=12.5)
    s.lines(24, y + 48, wrap("Zero FAIL does not mean zero risk: 14 of 27 scenarios (8 partial + 6 not run) lack a live-provider, on-device or human-rated check, and the fixtures use synthetic traces.", 12, 600, 790), 12, 600, INK, lh=1.35)
    s.footer(f"Source: benchmark/acceptance/results.json (generated {RES['generatedAt'][:10]}, commit {RES['commit']}); benchmark/ACCEPTANCE_BENCHMARK.md. MEASURED-tests / MEASURED-replay / MEASURED-harness.", y=458)
    return s


# ---------------------------------------------------------------- fig13 unit economics
def fig_unit() -> Svg:
    ue = COST["unitEconomics"]
    case = ue["cases"][1]
    spu = case["sessionsPerUserPerMonth"]
    rev = ue["revenue"]["revenuePerMauUsd"]
    c0 = case["default@0%"]["avgVariableCostPerSession"] * spu
    c50 = case["default@50%"]["avgVariableCostPerSession"] * spu
    fund = case["fundableSessionsPerMauPerMonth"]
    be = case["breakEvenPayingShareDefault0"]
    s = Svg(840, 432, "Free tier unit economics", "Per monthly active user: net revenue vs variable cost under the modelled usage")
    s.header("Why the free tier is unaffordable as specified", "Per monthly active user per month, USD; HYPOTHESIS revenue and usage, ESTIMATED cost (list prices)")
    mx = max(c0, c50, rev) * 1.15
    X0, X1 = 250, 760
    bars = [
        ("Net revenue per MAU", rev, C["success"], "HYPOTHESIS: 2.1% pay $39.99/yr, 15% store fee"),
        ("Variable cost, 50% shared-cache hit", c50, C["petrol-500"] if "petrol-500" in C else C["petrol-700"], f"ESTIMATED: {spu:.2f} sessions x ${case['default@50%']['avgVariableCostPerSession']:.3f}; 50% is ASSUMED"),
        ("Variable cost, no shared cache", c0, C["ember-ink"], f"ESTIMATED: {spu:.2f} sessions x ${case['default@0%']['avgVariableCostPerSession']:.3f}"),
    ]
    y = 110
    for lab, v, colr, note in bars:
        s.text(24, y + 15, lab, 12.5, 700, INK)
        w = (v / mx) * (X1 - X0)
        s.rect(X0, y, w, 24, colr, "none", r=4)
        s.text(X0 + w + 8, y + 17, f"${v:.3f}", 13, 700, INK)
        s.text(X0, y + 40, note, 10.8, 500, INK3)
        y += 66
    s.rect(24, 318, 792, 64, C["warn-bg"], C["warn"], r=8, sw=1.2, dash="5 4")
    t = (f"At the modelled usage a free user costs about {c50/rev:.1f} to {c0/rev:.1f} times the revenue they bring. Revenue funds only {fund:.2f} sessions per MAU per month at the default voice mix; "
         f"break-even needs {be*100:.0f}% of users paying with no shared cache (the 2.1% freemium median is the hypothesis). Free access must be capped to a few trial sessions.")
    s.lines(36, 340, wrap(t, 11.5, 600, 768), 11.5, 600, INK, lh=1.32)
    s.footer("Source: benchmark/cost/cost_model.json unitEconomics (Medium case, 25,000 MAU); label: engineering model, not telemetry. Free-tier caps and Google free quotas ignored.", y=404)
    return s


if __name__ == "__main__":
    for name, fn in [("fig08-competitor-matrix", fig_matrix), ("fig09-tam-sam-som", fig_tam), ("fig11-roadmap", fig_roadmap), ("fig12-acceptance-status", fig_accept), ("fig13-free-tier-economics", fig_unit)]:
        save(fn(), name, OUT)
        print("wrote", name)
