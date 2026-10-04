"""
Benchmark charts (pnpm bench:charts) -> deliverables/charts/*.png + *.svg

Inputs: benchmark/cost/cost_model.json, benchmark/acceptance/latency.json,
        benchmark/replay/{interstate,transition}.json, benchmark/replay/summary.json
Every chart carries a provenance subtitle (MEASURED-replay / SIMULATED latency / ESTIMATED list price).

Palette: brand tokens (assets/brand/tokens.json) snapped to pass the dataviz validator on white:
petrol #00809A (petrol-500 hue, chroma raised), ember-600 #E0492A, emil #5B5BD6, amber #D9A21E,
green #3A9A5B, magenta #B0508F. Amber is < 3:1 on white, so every series is also direct-labelled
or in the legend, and values sit in ink text.
"""
import json
import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Patch  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "deliverables" / "charts"
OUT.mkdir(parents=True, exist_ok=True)
tokens = json.loads((ROOT / "assets" / "brand" / "tokens.json").read_text())
T = tokens["theme"]["light"]

CAT = ["#00809A", "#E0492A", "#5B5BD6", "#D9A21E", "#3A9A5B", "#B0508F"]
INK = T["text"]  # #131A1D
INK2 = T["text-2"]  # #5F5A53
MUTED = T["text-3"]
GRID = T["line"]  # #E2DBCF
SURFACE = "#FFFFFF"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 10.5,
        "axes.edgecolor": GRID,
        "axes.linewidth": 1,
        "axes.labelcolor": INK2,
        "xtick.color": INK2,
        "ytick.color": INK2,
        "xtick.major.size": 0,
        "ytick.major.size": 0,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "axes.axisbelow": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "svg.fonttype": "none",
        "legend.frameon": False,
        "text.parse_math": False,
    }
)

cost = json.loads((ROOT / "benchmark" / "cost" / "cost_model.json").read_text())
lat = json.loads((ROOT / "benchmark" / "acceptance" / "latency.json").read_text())
DATE = cost["generatedAt"]


def titled(fig, title, subtitle):
    fig.text(0.012, 0.975, title, ha="left", va="top", fontsize=14, fontweight="bold", color=INK)
    fig.text(0.012, 0.925, subtitle, ha="left", va="top", fontsize=9.5, color=INK2)


def save(fig, name):
    for ext in ("png", "svg"):
        fig.savefig(OUT / f"{name}.{ext}", dpi=160 if ext == "png" else None, facecolor=SURFACE)
    plt.close(fig)
    print(f"wrote deliverables/charts/{name}.png/.svg")


def rounded_barh(ax, y, left, width, height, color):
    """Horizontal bar segment; data-end rounding is approximated by a small-radius box."""
    if width <= 0:
        return
    ax.add_patch(
        FancyBboxPatch((left, y - height / 2), width, height, boxstyle="round,pad=0,rounding_size=0.0", linewidth=0, facecolor=color, edgecolor=SURFACE)
    )


# ─────────────────────────────────────────── 1. per-session cost, stacked by component
def chart_cost_stacked():
    rows = [r for r in cost["sessionCosts"] if r["mix"] == "default" and r["sharedStoryCacheHit"] == 0 and r["realtimeProvider"] in (None, "openai:gpt-realtime-2.1-mini")]
    order = ["drive30_highway", "drive30_urban", "walk30", "walk30_rt5", "stress30", "walk60_interactive"]
    rows = sorted(rows, key=lambda r: order.index(r["scenario"]))
    comps = [("tts", "TTS (narration + answers)"), ("llm", "LLM (stories, follow-ups, intent)"), ("nearby_search", "Places NearbySearch (user asked)"), ("realtime_stt", "STT + realtime")]  # audio egress < $0.001/session: in the table, not drawn
    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    fig.subplots_adjust(left=0.25, right=0.9, top=0.78, bottom=0.2)
    labels = []
    gap = 0.0015  # 2px-ish surface gap in data units at this scale
    for i, r in enumerate(rows):
        left = 0.0
        for k, (key, _) in enumerate(comps):
            w = r[key]
            if w > 0:
                ax.barh(i, max(0, w - gap if w > 3 * gap else w), left=left, height=0.56, color=CAT[k], linewidth=0)
            left += w
        ax.text(left + 0.01, i, f"${r['total']:.2f}  ·  {r['spokenMinutes']:.0f} narrated min", va="center", ha="left", fontsize=9.5, color=INK)
        labels.append(r["scenarioLabel"])
    ax.set_yticks(range(len(rows)), labels)
    ax.set_xlim(0, max(r["total"] for r in rows) * 1.38)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:.2f}"))
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("Estimated variable cost per session (USD)")
    handles = [Patch(color=CAT[k], label=lab) for k, (_, lab) in enumerate(comps)]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.36, -0.14), ncol=4, fontsize=9, handlelength=1.2)
    titled(fig, "Per-session variable cost is almost all TTS", f"ESTIMATED list-price model, configured default mix (gpt-6-luna, gpt-4o-mini-tts, gpt-4o-mini-transcribe, Places Nearby Pro), 0% shared cache.\nCall counts MEASURED from deterministic replays. Prices retrieved 2026-09-27, evaluated at 2027-01-01. Model run {DATE}.")
    save(fig, "cost_per_session_by_component")


# ─────────────────────────────────────────── 2. truck driver month vs cache hit rate
def chart_truck():
    tm = cost["truckDriverMonth"]
    rows = [r for r in tm["rows"] if r["trace"] == "interstate"]
    mixes = [("wavenet_all", "All-WaveNet (sensitivity)"), ("tiered", "Tiered: highway on WaveNet"), ("economy", "Economy (tts-1)"), ("default", "Configured default"), ("gemini2027", "Gemini, 2027 prices"), ("premium", "Premium (ElevenLabs)")]
    fig, ax = plt.subplots(figsize=(10.5, 5.6))
    fig.subplots_adjust(left=0.08, right=0.66, top=0.8, bottom=0.12)
    color = {"wavenet_all": CAT[5], "tiered": CAT[4], "economy": CAT[0], "default": CAT[2], "gemini2027": CAT[3], "premium": CAT[1]}
    ends = []
    for key, lab in mixes:
        pts = sorted([(r["sharedStoryCacheHit"] * 100, r["monthlyUsd"]) for r in rows if r["mix"] == key])
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color=color[key], linewidth=2, solid_capstyle="round", zorder=3)
        ax.scatter([xs[0], xs[-1]], [ys[0], ys[-1]], s=36, color=color[key], edgecolor=SURFACE, linewidth=2, zorder=4)
        ends.append((ys[-1], ys[0], lab, color[key]))
    plan = tm["plan"]
    net = plan["net"]
    target = plan["targetUsdPerHour"] * tm["hours"]
    ax.axhline(9.99, color=INK2, linewidth=1, zorder=2)
    ax.axhline(net, color=INK, linewidth=1.4, zorder=2)
    ax.axhline(target, color=INK2, linewidth=1, linestyle=(0, (4, 3)), zorder=2)
    # reference-line key in the empty upper-right area (never on top of the data lines)
    for k, (yy, style, lw, col, txt) in enumerate([
        (21.8, "-", 1, INK2, "Driver plan price $9.99/mo (HYPOTHESIS)"),
        (20.4, "-", 1.4, INK, f"Net after 15% store fee ${net:.2f}/mo"),
        (19.0, (0, (4, 3)), 1, INK2, f"Target < $0.03/h = ${target:.2f}/mo (TARGET)"),
    ]):
        ax.plot([52, 57], [yy, yy], linestyle=style, linewidth=lw, color=col)
        ax.text(58, yy, txt, va="center", fontsize=9, color=INK)
    # direct labels at the right end with leader room
    ends.sort()
    last = -99
    for y90, y0, lab, c in ends:
        yl = max(y90, last + 1.1)
        last = yl
        ax.plot([90, 93], [y90, yl], color=c, linewidth=1, clip_on=False)
        ax.text(93.6, yl, f"{lab}: ${y0:.2f} → ${y90:.2f}", va="center", fontsize=9, color=INK, clip_on=False)
    ax.set_xlim(0, 90)
    ax.set_ylim(0, 26)
    ax.set_xticks([0, 25, 50, 65, 80, 90], ["0%", "25%", "50%", "65%", "80%", "90%"])
    ax.set_xlabel("Shared story-body cache hit rate (ASSUMED production rate; the cache itself is built, D-018)")
    ax.set_ylabel("Variable cost per driver-month (USD)")
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:.0f}"))
    pd = [r for r in rows if r["mix"] == "places_discovery" and r["sharedStoryCacheHit"] == 0][0]
    ax.text(52, 23.6, f"Off-scale: Google Places for automatic discovery ≈ ${pd['monthlyUsd']:.0f}/mo", ha="left", fontsize=9, color=INK)
    ax.set_clip_on(False)
    titled(fig, f"Long-haul driver month ({tm['hours']} h): tiered TTS + shared cache vs plan price", f"ESTIMATED list prices (2026-09-27, evaluated 2027-01-01); call rates MEASURED from the I-40 replay ({cost['replayRates']['highway']['storiesPerHour']} stories/h, {cost['replayRates']['highway']['placeQueriesPerHour']} free Wikimedia queries/h);\nafter D-024 probe backoff; 1 question/h and 1 NearbySearch per 4 h ASSUMED. Plan price and store fee are HYPOTHESES. Model run {DATE}.")
    save(fig, "truck_driver_month_vs_cache")


# ─────────────────────────────────────────── 3. latency p50/p95 vs targets
def chart_latency():
    m = lat["metrics"]
    items = [
        ("triggerToFirstAudio", "Approved moment → first audio bytes"),
        ("cachedStoryToFirstAudio", "Cached body, audio evicted → first audio"),
        ("cachedWarmStoryToFirstAudio", "Cached story (all warm) → first audio"),
        ("speechEndToFirstAudioNearby", "Speech end → answer audio (coffee)"),
        ("speechEndToFirstAudioFollowup", "Speech end → answer audio (follow-up)"),
        ("nearbySearch", "Speech end → nearby results on map"),
        ("toolToMap", "Tool result → map directive"),
        ("bargeInStop", "Interrupt → stop_audio (server)"),
    ]
    fmt = lambda v: f"{v:,.0f} ms" if v >= 10 else f"{v:.1f} ms"
    fig, ax = plt.subplots(figsize=(10.5, 5.8))
    fig.subplots_adjust(left=0.3, right=0.66, top=0.8, bottom=0.19)
    misses = []
    for i, (k, lab) in enumerate(items):
        v = m[k]
        y = len(items) - 1 - i
        tgt = v.get("target")
        ax.barh(y + 0.17, v["p50"], height=0.3, color=CAT[0], linewidth=0, zorder=3)
        ax.barh(y - 0.17, v["p95"], height=0.3, color=CAT[2], linewidth=0, zorder=3)
        ax.text(1.02, y + 0.17, f"p50 {fmt(v['p50'])} · p95 {fmt(v['p95'])}", va="center", fontsize=8.5, color=INK, transform=ax.get_yaxis_transform())
        if tgt:
            over = v["p95"] > tgt["p95"]
            ax.text(1.02, y - 0.2, f"target p95 {fmt(tgt['p95'])}" + ("  — MISSED" if over else "  — met"), va="center", fontsize=8.5, color=INK if over else INK2, fontweight="bold" if over else "normal", transform=ax.get_yaxis_transform())
        if tgt:
            ax.plot([tgt["p95"], tgt["p95"]], [y - 0.38, y + 0.38], color=INK, linewidth=2, zorder=4, solid_capstyle="butt")
            if v["p95"] > tgt["p95"]:
                misses.append(lab.split("(")[-1].rstrip(")") if "(" in lab else lab)
    ax.set_xscale("log")
    ax.set_xlim(0.2, 12_000)
    ax.set_xticks([1, 10, 100, 1000, 10000])
    ax.set_yticks(range(len(items)), [lab for _, lab in reversed(items)])
    ax.grid(axis="y", visible=False)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f} ms"))
    ax.set_xlabel("Latency (log scale)")
    handles = [Patch(color=CAT[0], label="p50"), Patch(color=CAT[2], label="p95"), matplotlib.lines.Line2D([], [], color=INK, linewidth=2, label="Proposed p95 target (TARGET, §2)")]
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.3, -0.12), ncol=3, fontsize=9)
    head = "Hybrid voice path vs proposed targets: " + (f"p95 missed for {', '.join(misses)} answers" if misses else "all p95 inside targets")
    titled(fig, head, f"MEASURED in-process harness (real API + Postgres + Redis + WebSocket, loopback) with SIMULATED provider latency (seeded log-normal profile);\nexcludes mobile-network RTT and device audio start. n = {m['triggerToFirstAudio']['n']} per metric. Run {lat['generatedAt'][:10]}.")
    save(fig, "latency_p50_p95_vs_targets")


# ─────────────────────────────────────────── 4. replay silence / story timeline
REG_COLOR = {"highway_driving": CAT[2], "urban_driving": CAT[0], "stationary": "#A39D93", "walking": CAT[4], "cycling": CAT[5], "unknown": "#D9D4CB"}
REG_LABEL = {"highway_driving": "Highway driving", "urban_driving": "Urban driving", "stationary": "Stationary", "walking": "Walking", "unknown": "Warm-up (unknown)"}


def regime_spans(summary):
    tr = summary["regimeTransitions"]
    spans = []
    cur, t0 = "unknown", 0
    for x in tr:
        spans.append((cur, t0, x["t"]))
        cur, t0 = x["to"], x["t"]
    spans.append((cur, t0, summary["durationS"]))
    return spans


def chart_timeline():
    fig, axes = plt.subplots(2, 1, figsize=(11, 6.2), gridspec_kw={"height_ratios": [1, 1], "hspace": 0.9})
    fig.subplots_adjust(left=0.04, right=0.98, top=0.76, bottom=0.14)
    used = set()
    for ax, name, title in [(axes[0], "interstate", "I-40 westbound, heading corridor (105 min)"), (axes[1], "transition", "Highway → outskirts → downtown → park → walk (38 min)")]:
        d = json.loads((ROOT / "benchmark" / "replay" / f"{name}.json").read_text())
        s = d["summary"]
        for reg, a, b in regime_spans(s):
            ax.axvspan(a / 60, b / 60, ymin=0, ymax=0.32, color=REG_COLOR.get(reg, "#ccc"), alpha=0.9, linewidth=0)
            used.add(reg)
        for st in d["stories"]:
            a = st["t"] / 60
            w = max(st["playedS"] / 60, 0.25)
            col = INK if st["kind"] == "story" else MUTED
            ax.add_patch(FancyBboxPatch((a, 0.45), w, 0.3, boxstyle="round,pad=0,rounding_size=0.05", facecolor=col, linewidth=0, mutation_aspect=0.3))
        # direct labels: every story on the sparse highway; alternate heights on the dense transition
        for j, st in enumerate(d["stories"]):
            if name == "transition" and st["kind"] != "story":
                continue
            yl = 0.85 if name == "interstate" else (0.85, 1.0, 1.15)[j % 3]
            near_end = j == len(d["stories"]) - 1 and st["t"] > 0.8 * s["durationS"]
            ax.text(st["t"] / 60 + (0.3 if near_end else 0), yl, st["name"].replace(" (Campbell Pass)", "").replace(" of Chicago", ""), fontsize=7.8, color=INK2, ha="right" if near_end else "left", va="bottom")
        ax.set_xlim(0, s["durationS"] / 60)
        ax.set_ylim(0, 1.4)
        ax.set_yticks([])
        ax.grid(False)
        ax.spines["left"].set_visible(False)
        ax.set_xlabel("minutes into the session", fontsize=9)
        ax.set_title(f"{title}: {s['storiesStarted']} stories, silence {s['silenceRatio']*100:.1f}%, longest gap {s['maxSilentGapS']/60:.0f} min, {s['providerQueries']['perHour']:.0f} place queries/h", loc="left", fontsize=10, color=INK, pad=24)
    handles = [Patch(color=INK, label="story (template-length playback)"), Patch(color=MUTED, label="orientation line")] + [Patch(color=REG_COLOR[r], label=REG_LABEL[r]) for r in ["unknown", "highway_driving", "urban_driving", "stationary", "walking"] if r in used]
    fig.legend(handles=handles, loc="lower center", ncol=7, fontsize=8.5, bbox_to_anchor=(0.5, 0.0))
    titled(fig, "Silence is the normal state on the highway; the regime adapts without a restart", "MEASURED-replay: synthetic traces over fixture POI/evidence packs through the production core (benchmark/replay, 2026-09-27).\nBand = movement regime; dark bars = narration at template length (LLM stories fill up to the regime budget).")
    save(fig, "replay_timeline_interstate_transition")


# ─────────────────────────────────────────── 5. query rate per scenario vs F1 cap
def chart_query_rate():
    summ = json.loads((ROOT / "benchmark" / "replay" / "summary.json").read_text())
    stress = cost["stressUpperBound"]["placeQueriesPerHour"]
    rows = []
    for s in summ:
        h = s["durationS"] / 3600
        rows.append((s["scenario"], s["providerQueries"]["discovery"] / h, s["providerQueries"]["densityProbe"] / h))
    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    fig.subplots_adjust(left=0.22, right=0.95, top=0.78, bottom=0.2)
    rows.sort(key=lambda r: r[1] + r[2])
    for i, (n, disc, dens) in enumerate(rows):
        ax.barh(i, disc, height=0.56, color=CAT[0], linewidth=0)
        ax.barh(i, dens - 1.0, left=disc + 1.0, height=0.56, color=CAT[3], linewidth=0)
        ax.text(disc + dens + 3, i, f"{disc + dens:.0f}/h", va="center", fontsize=9, color=INK)
    i = len(rows)
    ax.barh(i, stress, height=0.56, color="none", edgecolor=INK2, hatch="///", linewidth=1)
    ax.text(stress / 2, i, f"  {stress:.0f}/h upper bound  ", va="center", ha="center", fontsize=9, color=INK, bbox=dict(facecolor=SURFACE, edgecolor="none", pad=1))
    hw = [k for k, r in enumerate(rows) if r[0].startswith("interstate")]
    ax.plot([60, 60], [min(hw) - 0.45, max(hw) + 0.45], color=INK, linewidth=1.6, zorder=5)
    ax.text(62, min(hw) - 0.75, "A5/F1 test cap for the highway: ≤ 60/h", fontsize=9, color=INK, va="center")
    ax.set_yticks(range(len(rows) + 1), [r[0] for r in rows] + ["policy floor, dense walk"])
    ax.set_ylim(-1, len(rows) + 0.6)
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("Automatic place-provider queries per session-hour")
    ax.legend(handles=[Patch(color=CAT[0], label="discovery"), Patch(color=CAT[3], label="density probe"), Patch(facecolor="none", edgecolor=INK2, hatch="///", label="policy upper bound (not replayed)")], loc="upper center", bbox_to_anchor=(0.4, -0.13), ncol=3, fontsize=9)
    titled(fig, "Place queries stay far below the 1 Hz GPS rate; density probes dominate on the highway", "MEASURED-replay (benchmark/replay/summary.json, 2026-09-27); GPS at 1 Hz would be 3,600 fixes/h. The 60/h cap is the A5/F1 test threshold\nfor highway runs only. Upper bound = core REFRESH minimum intervals (walking: discovery 20 s, density probe 30 s).")
    save(fig, "query_rate_vs_f1_cap")


if __name__ == "__main__":
    chart_cost_stacked()
    chart_truck()
    chart_latency()
    chart_timeline()
    chart_query_rate()
