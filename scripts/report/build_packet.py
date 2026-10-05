#!/usr/bin/env python3
"""Assemble deliverables/packet/ and deliverables/telvey-comparison-packet.zip (comparison packet, template section 21).

Copies only existing repository artefacts (report, screenshots, brand, guides, figures, charts, benchmark and cost data,
docs, demo, build scripts), writes acceptance/latency CSVs derived from the JSON, a README index and a MANIFEST.json with
a SHA-256 per file, then zips everything (must stay under 40 MB). No secrets are read or copied.
Usage: python3 scripts/report/build_packet.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "deliverables"
P = D / "packet"
ZIP = D / "telvey-comparison-packet.zip"
LIMIT = 40 * 1024 * 1024


def cp(src: Path, dst_rel: str) -> None:
    dst = P / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main() -> None:
    if P.exists():
        shutil.rmtree(P)
    P.mkdir(parents=True)

    # 1 report
    cp(D / "INVESTOR_REPORT.pdf", "INVESTOR_REPORT.pdf")
    cp(D / "INVESTOR_REPORT.md", "report-source/INVESTOR_REPORT.md")
    for f in ("build_report.py", "render-pdf.mjs", "check-numbers.py", "rasterize.py", "build_packet.py", "svgkit.py", "figures_arch.py", "figures_data.py", "capture-screenshots.mjs", "record-demo.mjs"):
        cp(ROOT / "scripts/report" / f, f"report-source/scripts/{f}")
    cp(D / "REPORT_REVIEW.md", "REPORT_REVIEW.md")

    # 2 screenshots (the template's 16 items; item 16 was not capturable and is documented in INDEX.md)
    shots = sorted((D / "screenshots/web").glob("s[0-9]*.png"))
    for s in shots:
        cp(s, f"screenshots/{s.name}")
    cp(D / "screenshots/INDEX.md", "screenshots/INDEX.md")

    # 3 brand board, logos, icons, tokens
    for f in ("brand-board-2400.png", "brand-board.svg", "logo-lockup.svg", "logo-lockup-dark.svg", "logo-lockup-1600.png", "logo-lockup-dark-1600.png", "logo-mark.svg", "logo-mark-512.png", "wordmark.svg", "wordmark-light.svg", "wordmark-1200.png", "app-icon.svg", "app-icon-1024.png", "app-icon-512.png", "favicon.svg", "favicon-180.png", "tokens.json"):
        cp(ROOT / "assets/brand" / f, f"brand/{f}")

    # 4 guide visuals
    for g in ("ida", "emil"):
        for f in (ROOT / "assets/guides" / g).iterdir():
            cp(f, f"guides/{g}/{f.name}")

    # 5 figures and charts
    for f in sorted((D / "figures").iterdir()):
        cp(f, f"figures/{f.name}")
    for f in sorted((D / "charts").iterdir()):
        cp(f, f"charts/{f.name}")

    # 6 data: benchmark and cost model, JSON + CSV
    res = json.loads((ROOT / "benchmark/acceptance/results.json").read_text())
    lat = json.loads((ROOT / "benchmark/acceptance/latency.json").read_text())
    for src, dst in (
        ("benchmark/acceptance/results.json", "data/benchmark/acceptance_results.json"),
        ("benchmark/acceptance/latency.json", "data/benchmark/latency.json"),
        ("benchmark/replay/summary.json", "data/benchmark/replay_summary.json"),
        ("benchmark/cost/cost_model.json", "data/cost/cost_model.json"),
        ("benchmark/research/market.json", "data/research/market.json"),
        ("benchmark/research/competitors.json", "data/research/competitors.json"),
        ("benchmark/research/provider_pricing.json", "data/research/provider_pricing.json"),
        ("benchmark/brand/domain_checks.json", "data/research/domain_checks.json"),
    ):
        cp(ROOT / src, dst)
    for name in ("cost_model.csv", "truck_driver_month.csv", "unit_economics.csv"):
        f = ROOT / "benchmark/cost" / name
        if f.exists():
            cp(f, f"data/cost/{name}")
    out = P / "data/benchmark"
    with open(out / "acceptance_scenarios.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "section", "title", "status", "evidence"])
        for s in res["scenarios"]:
            w.writerow([s["id"], s["section"], s["title"], s["status"], s["evidence"]])
    with open(out / "latency_summary.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["metric", "n", "p50_ms", "p95_ms", "target_p50_ms", "target_p95_ms", "definition", "label"])
        for k, v in lat["metrics"].items():
            t = v.get("target") or {}
            w.writerow([k, v["n"], v["p50"], v["p95"], t.get("p50", ""), t.get("p95", ""), v["definition"], "MEASURED-harness, SIMULATED provider latency, loopback"])

    # 7 docs
    cp(ROOT / "docs/MOBILE.md", "docs/MOBILE.md")
    cp(ROOT / "docs/DEPLOY.md", "docs/DEPLOY.md")

    # 8 demo
    cp(D / "demo/telvey-web-demo.mp4", "demo/telvey-web-demo.mp4")

    (P / "README.md").write_text(README)

    # manifest
    files = sorted(p for p in P.rglob("*") if p.is_file() and p.name != "MANIFEST.json")
    manifest = {
        "name": "telvey-comparison-packet",
        "generated": "2026-10-04",
        "note": "SHA-256 per file; paths relative to the packet root. No secrets are included.",
        "files": [
            {"path": str(f.relative_to(P)), "bytes": f.stat().st_size, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
            for f in files
        ],
    }
    (P / "MANIFEST.json").write_text(json.dumps(manifest, indent=1))

    # zip
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(p for p in P.rglob("*") if p.is_file()):
            z.write(f, Path("telvey-comparison-packet") / f.relative_to(P))
    size = ZIP.stat().st_size
    print(f"packet files: {len(files) + 1}; zip {size / 1e6:.1f} MB")
    if size >= LIMIT:
        print("ERROR: zip exceeds 40 MB; downscale PNGs", file=sys.stderr)
        sys.exit(1)


README = """# Telvey comparison packet

Date: 2026-10-04. Working brand: **Telvey** (not legally cleared; domains unregistered). Product status: **zero real users,
zero real-device runs, zero live-provider runs.** Every number in the report carries a label (MEASURED-tests, -replay,
-harness, -e2e; ESTIMATED; ASSUMED or HYPOTHESIS; DERIVED; NOT YET MEASURED or NOT RUN).

## Public URLs

| Surface | URL |
|---|---|
| Website | **Not deployed. Blocked on VPS and domain credentials.** |
| WebApp | **Not deployed. Blocked on VPS and domain credentials.** |
| Admin console | **Not deployed. Blocked on VPS and domain credentials.** |
| Native test builds (Android APK, iOS) | **No build exists.** Blocked on Expo, Apple Developer and Android SDK access. Instructions: `docs/MOBILE.md` section 5 |

No URL is given because none exists. The WebApp, website and admin console run locally from the repository in offline demo mode.

## Contents

| Path | What it is |
|---|---|
| `INVESTOR_REPORT.pdf` | The investor report (read this first) |
| `report-source/` | Editable Markdown source, the build script (Markdown to HTML to PDF with Chromium), the number-check script, and the scripts that made the figures, screenshots and demo |
| `REPORT_REVIEW.md` | Adversarial review of the report: unsupported claims found, inconsistencies, weak differentiation, missing investor questions, what was changed |
| `screenshots/` | The report's UX, web and admin captures (offline demo mode, simulated location, template prose, no voice, schematic map; admin images are DEMO DATA) and `INDEX.md` mapping them to the 16 template items. Item 16 (mobile admin) was not capturable and is not faked |
| `brand/` | Brand board, logo lockups, wordmark, mark, app icons, favicon, design tokens |
| `guides/` | Original Guides Ida and Emil: portraits, city-context scenes, avatars (SVG and PNG) |
| `figures/` | The 13 report figures as SVG and PNG: system context, modules, narrative pipeline, conversation state, provider routing, data and cache, surfaces, competitor matrix, TAM, SAM and SOM bridge, user flow, roadmap, acceptance status, free-tier economics |
| `charts/` | Five benchmark charts (cost per session, driver month, latency, replay timeline, query rate) |
| `data/benchmark/` | Acceptance results (JSON), per-scenario CSV, latency JSON and CSV, replay summary |
| `data/cost/` | Cost model JSON and CSVs (ESTIMATED list-price model) |
| `data/research/` | Market model, competitor research, provider pricing (retrieved 2026-09-27), domain checks (2026-09-27 UTC) |
| `docs/MOBILE.md`, `docs/DEPLOY.md` | Native build and device-test instructions; server deployment guide (never run on a real host) |
| `demo/telvey-web-demo.mp4` | 74-second screen recording of the offline demo (walk, interruption, resume, highway drive HUD). Same limits as the screenshots |
| `MANIFEST.json` | SHA-256 and size of every file |

## How to check the numbers

`python3 report-source/scripts/check-numbers.py` (run from the repository) asserts that the headline numbers in the report match
`data/benchmark/*.json`, `data/cost/cost_model.json` and `data/research/market.json`.
"""

if __name__ == "__main__":
    main()
