#!/usr/bin/env python3
"""Build deliverables/INVESTOR_REPORT.pdf from deliverables/INVESTOR_REPORT.md.

Pipeline: markdown -> (figure numbering, path rewrite) -> pandoc HTML5 -> post-process (labels, status badges,
cover, TOC) -> Chromium print-to-PDF (Playwright) -> two passes so the table of contents carries real page numbers.

Usage:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 scripts/report/build_report.py [--no-pdf]
Reads only repository files; no network; no secrets.
"""
from __future__ import annotations

import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "deliverables"
B = D / "report-build"
SRC = D / "INVESTOR_REPORT.md"
OUT_PDF = D / "INVESTOR_REPORT.pdf"
DATE = "2026-10-04"

SHOTS = {
    "s01": "s01-guest-entry-mobile.png",
    "s02": "s02-guide-selection-mobile.png",
    "s03": "s03-explore-idle-quiet-mobile.png",
    "s04": "s04-approaching-target-mobile.png",
    "s05": "s05-active-story-mobile.png",
    "s06": "s06-listening-mobile.png",
    "s07": "s07-nearby-result-mobile.png",
    "s08": "s08-resumed-story-mobile.png",
    "s09": "s09-drive-safe-mobile.png",
    "s10": "s10-history-mobile.png",
    "s11": "s11-settings-mobile.png",
    "s12": "s12-degraded-text-only-mobile.png",
    "s13": "s13-webapp-desktop.png",
    "s13b": "s13b-webapp-debug-explain-desktop.png",
    "s14": "s14-website-desktop-fold.png",
    "s15": "s15-admin-overview-demo-desktop.png",
}
GIMG = {
    "ida-portrait": "assets/guides/ida/portrait-1200.png",
    "ida-scene": "assets/guides/ida/scene-1200.png",
    "ida-avatar": "assets/guides/ida/avatar-512.png",
    "emil-portrait": "assets/guides/emil/portrait-1200.png",
    "emil-scene": "assets/guides/emil/scene-1200.png",
    "emil-avatar": "assets/guides/emil/avatar-512.png",
}


def prep_assets() -> None:
    for sub in ("shots", "gimg", "img", "figures"):
        (B / sub).mkdir(parents=True, exist_ok=True)
    for key, fn in SHOTS.items():
        im = Image.open(D / "screenshots/web" / fn).convert("RGB")
        if key == "s11":  # settings is a tall page: keep the top, same frame as the other phone captures
            im = im.crop((0, 0, im.width, min(im.height, 1688)))
        w = 560 if im.width <= 800 else 1280
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(B / "shots" / f"{key}.jpg", quality=86, optimize=True)
    for key, fn in GIMG.items():
        im = Image.open(ROOT / fn).convert("RGB")
        w = 700 if im.width > 700 else im.width
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(B / "gimg" / f"{key}.jpg", quality=88, optimize=True)
    im = Image.open(ROOT / "assets/brand/brand-board-2400.png").convert("RGB")
    im = im.resize((1700, round(im.height * 1700 / im.width)), Image.LANCZOS)
    im.save(B / "img/brand-board.png", optimize=True)
    for p in (D / "charts").glob("*.png"):
        im = Image.open(p).convert("RGB")
        if im.width > 1700:
            im = im.resize((1700, round(im.height * 1700 / im.width)), Image.LANCZOS)
        im.save(B / "img" / p.name, optimize=True)
    for p in (D / "figures").glob("*.svg"):
        shutil.copy(p, B / "figures" / p.name)
    shutil.copy(ROOT / "assets/brand/logo-lockup-dark.svg", B / "img/logo-lockup-dark.svg")


def transform(md: str) -> tuple[str, list[str]]:
    md = re.sub(r"^<!--.*?-->\s*", "", md, count=1, flags=re.S)
    md = re.sub(r"\s*\{\.tablecap\}", "", md)
    md = md.replace("](../assets/brand/brand-board-2400.png)", "](img/brand-board.png)")
    md = re.sub(r"\]\(\.\./deliverables/charts/([\w\-]+\.png)\)", r"](img/\1)", md)
    md = re.sub(r'src="shots/(s\w+)\.png"', r'src="shots/\1.jpg"', md)
    md = re.sub(r"\]\(shots/(s\w+)\.png\)", r"](shots/\1.jpg)", md)
    md = re.sub(r'src="gimg/([\w\-]+)\.png"', r'src="gimg/\1.jpg"', md)
    # figure numbering
    keys = re.findall(r"\{#fig:(\w+)\}", md)
    num = {k: i + 1 for i, k in enumerate(keys)}

    def cap(m: re.Match) -> str:
        k = m.group(3)
        return f"![**Figure {num[k]}.** {m.group(1)}]({m.group(2)}){{#fig:{k}}}"

    md = re.sub(r"!\[(.*)\]\((.*?)\)\{#fig:(\w+)\}", cap, md)
    md = re.sub(
        r"\{\{fig:(\w+)\}\}",
        lambda m: f'<a class="xref" href="#fig:{m.group(1)}">Figure {num[m.group(1)]}</a>',
        md,
    )
    return md, keys


LABEL_RE = re.compile(
    r"\b(MEASURED-(?:tests|replay|harness|e2e)|ESTIMATED|ASSUMED|HYPOTHESIS|DERIVED|NOT YET MEASURED)\b"
)


def label_class(t: str) -> str:
    if t.startswith("MEASURED"):
        return "t-measured"
    if t in ("ESTIMATED",):
        return "t-estimated"
    if t in ("ASSUMED", "HYPOTHESIS"):
        return "t-assumed"
    if t == "DERIVED":
        return "t-derived"
    return "t-notrun"


def tag_labels(body: str) -> str:
    parts = re.split(r"(<[^>]+>)", body)
    out, skip = [], []  # skip stack of tag names we do not touch
    for p in parts:
        if p.startswith("<"):
            m = re.match(r"<(/?)(\w+)([^>]*)>", p)
            if m:
                closing, name, attrs = m.group(1) == "/", m.group(2).lower(), m.group(3)
                if not closing and name in ("code", "h1", "h2", "h3", "title", "caption", "figcaption", "a") and not p.endswith("/>"):
                    skip.append(name)
                elif closing and skip and skip[-1] == name:
                    skip.pop()
                elif not closing and name == "span" and 'class="tag' in attrs:
                    skip.append("span")
                elif closing and name == "span" and skip and skip[-1] == "span":
                    skip.pop()
            out.append(p)
        else:
            if skip:
                out.append(p)
            else:
                out.append(LABEL_RE.sub(lambda m: f'<span class="tag {label_class(m.group(1))}">{m.group(1)}</span>', p))
    return "".join(out)


def explicit_tags(body: str) -> str:
    def f(m: re.Match) -> str:
        t = m.group(1)
        c = "t-notrun" if t.startswith("NOT") else label_class(t)
        return f'<span class="tag {c}">{t}</span>'

    return re.sub(r'<span class="tag">([^<]+)</span>', f, body)


def status_cells(body: str) -> str:
    cls = {"PASS": "st-pass", "PARTIAL": "st-part", "FAIL": "st-fail", "NOT RUN": "st-nr"}

    def f(m: re.Match) -> str:
        return f'{m.group(1)}<span class="st {cls[m.group(2)]}">{m.group(2)}</span></td>'

    return re.sub(r"(<td[^>]*>)(?:<strong>)?(PASS|PARTIAL|FAIL|NOT RUN)(?:</strong>)?</td>", f, body)


def wide_tables(body: str) -> str:
    def f(m: re.Match) -> str:
        t = m.group(0)
        head = re.search(r"<thead>.*?</thead>", t, re.S)
        n = len(re.findall(r"<th", head.group(0))) if head else 0
        cls = "wide" if n >= 6 else ("mid" if n == 5 else "")
        return t.replace("<table", f'<table class="{cls}"', 1) if cls else t

    return re.sub(r"<table.*?</table>", f, body, flags=re.S)


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def headings(body: str) -> list[tuple[int, str, str]]:
    out = []
    for m in re.finditer(r'<h([12]) id="([^"]+)"[^>]*>(.*?)</h\1>', body, re.S):
        out.append((int(m.group(1)), m.group(2), strip_tags(m.group(3))))
    return out


def toc_html(hs: list[tuple[int, str, str]], pages: dict[str, int | str]) -> str:
    rows = []
    for lvl, hid, text in hs:
        pg = pages.get(hid, "")
        rows.append(f'<li class="l{lvl}"><a href="#{hid}"><span class="tt">{html.escape(text)}</span><span class="dots"></span><span class="pg">{pg}</span></a></li>')
    return '<nav class="toc"><h2 class="toc-title">Contents</h2><ul>' + "".join(rows) + "</ul></nav>"


def cover_html() -> str:
    return f"""
<section class="cover">
  <img class="lockup" src="img/logo-lockup-dark.svg" alt="Telvey">
  <div class="cover-main">
    <div class="eyebrow">Investor report and comparison packet</div>
    <h1 class="cover-title">A companion that knows when to talk</h1>
    <p class="cover-sub">Voice-first, location-aware storytelling for people who walk and drive. What was built, what was measured, what is still unproven.</p>
  </div>
  <div class="cover-box">
    <div><b>Status of the evidence.</b> The product has had <b>zero real users</b>, zero runs on a real device and zero runs against a live provider. Performance figures come from real code against fake providers with simulated latency; dollar figures are list-price estimates; market figures are bottom-up assumptions. Every number in this report carries a label saying which.</div>
  </div>
  <div class="cover-foot">
    <div><b>Telvey</b> is a working brand name, not legally cleared; its domains are unregistered.</div>
    <div>Report date {DATE} · Repository branch <code>build/mvp</code> · Commit <code>51a787e</code> plus uncommitted report files</div>
  </div>
</section>
"""


CSS = r"""
:root{--petrol:#0F4C5C;--petrol800:#0B3942;--petrol50:#EAF3F5;--ember:#FF6A4D;--emberink:#B23A1E;--paper:#F7F4EE;
--sand100:#EFEAE1;--sand200:#E2DBCF;--ink:#131A1D;--s600:#5F5A53;--s500:#726C63;--ok:#1A6B45;--okbg:#DDF1E6;
--warn:#8F5B00;--warnbg:#FCEBC7;--err:#B42318;--errbg:#FDE1DD;}
@page{size:A4;margin:19mm 16mm 19mm 16mm;
 @top-left{content:"Telvey · Investor report";font:600 7pt Onest,sans-serif;color:#726C63;vertical-align:bottom;padding-bottom:3mm}
 @top-right{content:"Working brand · pre-user evidence · 2026-10-04";font:500 7pt Onest,sans-serif;color:#726C63;vertical-align:bottom;padding-bottom:3mm}
 @bottom-center{content:counter(page);font:600 8pt Onest,sans-serif;color:#5F5A53;vertical-align:top;padding-top:3mm}}
@page cover{margin:0;@top-left{content:none}@top-right{content:none}@bottom-center{content:none}}
html{font-size:9.3pt}
body{font-family:Literata,Georgia,serif;font-size:9.3pt;line-height:1.46;color:var(--ink);margin:0;background:#fff;font-variant-numeric:lining-nums;hyphens:manual}
.cover{page:cover;position:relative;height:296mm;width:210mm;box-sizing:border-box;background:var(--petrol800);color:#F7F4EE;overflow:hidden;break-after:page;break-inside:avoid}
.cover .lockup{position:absolute;left:16mm;top:22mm;width:92mm}
.cover .cover-main{position:absolute;left:20mm;right:20mm;top:98mm}
.cover .cover-box{position:absolute;left:20mm;right:20mm;bottom:44mm}
.cover .cover-foot{position:absolute;left:20mm;right:20mm;bottom:18mm}
.cover .eyebrow{font:600 10pt Onest;letter-spacing:.14em;text-transform:uppercase;color:#FFC857;margin-bottom:6mm}
.cover-title{font:700 38pt/1.06 Onest;margin:0 0 8mm;color:#fff;border:none;padding:0;break-before:auto}
.cover-sub{font:500 13pt/1.45 Onest;color:#DCECEE;max-width:150mm;margin:0}
.cover-box{border:1pt solid #FFC857;border-radius:3mm;padding:5mm 6mm;font:500 9.5pt/1.5 Onest;color:#F7F4EE;background:rgba(255,200,87,.08)}
.cover-foot{font:500 8.5pt/1.6 Onest;color:#B9D3D8}
.cover-foot code{color:#fff;background:none;font-size:8.5pt}
h1,h2,h3,h4{font-family:Onest,sans-serif;color:var(--ink);break-after:avoid;orphans:3;widows:3}
h1{font-size:19pt;font-weight:700;color:var(--petrol);margin:11mm 0 3mm;padding-bottom:2mm;border-bottom:1.4pt solid var(--petrol);line-height:1.15;break-before:auto}
h1.pb{break-before:page;margin-top:0}
h2{font-size:12.2pt;font-weight:700;color:var(--petrol);margin:6.5mm 0 1.6mm}
h3{font-size:10pt;font-weight:700;margin:4mm 0 1mm}
p{margin:0 0 2.4mm;orphans:3;widows:3}
ul,ol{margin:0 0 2.6mm;padding-left:5.2mm}
li{margin-bottom:1mm}
a{color:var(--petrol);text-decoration:none}
a.xref{font-family:Onest;font-weight:600}
code{font-family:'JetBrains Mono','DejaVu Sans Mono',monospace;font-size:7.7pt;background:var(--sand100);padding:0 1.2mm;border-radius:1mm;word-break:break-word}
strong{font-weight:700}
.part{font:700 7.8pt Onest;letter-spacing:.14em;text-transform:uppercase;color:var(--emberink);margin:-1mm 0 3mm}
.callout{border-left:2.4pt solid var(--petrol);background:var(--petrol50);padding:2.6mm 3.6mm;margin:3mm 0 3.6mm;font-family:Onest;font-size:8.4pt;line-height:1.46;border-radius:0 1.5mm 1.5mm 0;break-inside:avoid}
.callout p{margin:0}
.callout.warn{border-color:var(--warn);background:var(--warnbg)}
.callout.bad{border-color:var(--err);background:var(--errbg)}
.callout.note{border-color:var(--petrol);background:var(--petrol50)}
.tag{font:700 6.6pt Onest;letter-spacing:.02em;padding:.3mm 1.5mm;border-radius:1.2mm;white-space:nowrap;display:inline-block;line-height:1.35;vertical-align:.5pt}
.t-measured{background:var(--okbg);color:var(--ok)}
.t-estimated{background:var(--warnbg);color:var(--warn)}
.t-assumed{background:#E4E4FA;color:#3F3FB0}
.t-derived{background:var(--sand100);color:var(--s600)}
.t-notrun{background:var(--errbg);color:var(--err)}
.st{font:700 7pt Onest;padding:.4mm 1.8mm;border-radius:1.2mm;display:inline-block}
.st-pass{background:var(--okbg);color:var(--ok)}.st-part{background:var(--warnbg);color:var(--warn)}
.st-fail{background:var(--err);color:#fff}.st-nr{background:#fff;color:var(--s600);border:.6pt dashed var(--s500)}
table{border-collapse:collapse;width:100%;margin:2.4mm 0 3.4mm;font-family:Onest;font-size:7.7pt;line-height:1.36;break-inside:auto}
table.mid{font-size:7.3pt}table.wide{font-size:7pt}
caption{caption-side:bottom;text-align:left;font:500 7.3pt/1.4 Onest;color:var(--s600);padding-top:1.4mm;counter-increment:tbl}
caption::before{content:"Table " counter(tbl) ". ";font-weight:700;color:var(--ink)}
thead{display:table-header-group}
th{background:var(--petrol);color:#fff;font-weight:600;text-align:left;padding:1.4mm 1.8mm;vertical-align:bottom}
td{padding:1.2mm 1.8mm;border-bottom:.5pt solid var(--sand200);vertical-align:top}
tr{break-inside:avoid}
tbody tr:nth-child(even) td{background:#FBF9F5}
td strong,th strong{font-weight:700}
figure{margin:3.4mm 0 4mm;break-inside:avoid;text-align:center}
figure img{max-width:100%;max-height:178mm;height:auto}
figcaption{font:500 7.6pt/1.42 Onest;color:var(--s600);text-align:left;margin-top:1.6mm}
figcaption b{color:var(--ink)}
.prov{display:block;color:var(--s500);font-style:italic;margin-top:.6mm}
figure>img[src$=".svg"]{box-sizing:border-box;width:100%;border:.5pt solid var(--sand200);border-radius:1.6mm}
.phones{display:grid;grid-template-columns:repeat(4,1fr);gap:3.2mm 3mm;margin:2mm 0 3mm}
.phones figure{margin:0;break-inside:avoid;text-align:left}
.phones img{width:100%;border:.6pt solid var(--sand200);border-radius:2.4mm;display:block;max-height:none}
.phones figcaption{font-size:6.5pt;line-height:1.36;margin-top:1mm}
.guides{display:grid;grid-template-columns:1fr 1.7fr .8fr;gap:3mm;margin:2mm 0 3mm;align-items:end}
.guides figure{margin:0;text-align:left}
.guides img{width:100%;height:52mm;object-fit:cover;border:.5pt solid var(--sand200);border-radius:1.6mm;display:block}
.guides figure.av img{object-fit:contain;background:var(--sand100)}
.guides figcaption{font-size:6.8pt}
nav.toc{break-after:page}
.toc-title{font-size:19pt;color:var(--petrol);border-bottom:1.4pt solid var(--petrol);padding-bottom:2mm;margin:0 0 4mm}
.toc ul{list-style:none;padding:0;margin:0}
.toc li{margin:0}
.toc a{display:flex;align-items:baseline;color:var(--ink)}
.toc li.l1{font:700 9pt Onest;margin-top:2.3mm}
.toc li.l2{font:500 8pt Onest;padding-left:5mm;color:var(--s600)}
.toc .tt{flex:0 1 auto}
.toc .dots{flex:1 1 auto;border-bottom:.6pt dotted #A8A196;margin:0 1.6mm;transform:translateY(-.8mm)}
.toc .pg{flex:0 0 auto;font-variant-numeric:tabular-nums}
hr{border:none;border-top:.6pt solid var(--sand200);margin:3mm 0}
em{font-style:italic}
"""


def build_html(body: str, pages: dict[str, int | str]) -> str:
    hs = headings(body)
    toc = toc_html([h for h in hs], pages)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Telvey investor report</title><meta name="viewport" content="width=device-width">
<style>{CSS}</style></head><body>
{cover_html()}
{toc}
{body}
</body></html>"""


def pandoc(md_path: Path) -> str:
    r = subprocess.run(
        ["pandoc", str(md_path), "-f", "markdown+smart", "-t", "html5", "--wrap=none", "--no-highlight"],
        capture_output=True,
        text=True,
        check=True,
    )
    return r.stdout


def render_pdf(html_path: Path, pdf_path: Path) -> None:
    js = ROOT / "scripts/report/render-pdf.mjs"
    env = {"PLAYWRIGHT_BROWSERS_PATH": "/opt/pw-browsers", "PATH": "/usr/local/bin:/usr/bin:/bin"}
    subprocess.run(["node", str(js), str(html_path), str(pdf_path)], check=True, env=env)


def pdf_pages_text(pdf: Path) -> list[str]:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    out = []
    for i in range(len(doc)):
        tp = doc[i].get_textpage()
        out.append(re.sub(r"\s+", " ", tp.get_text_range()))
    return out


def locate(hs: list[tuple[int, str, str]], texts: list[str]) -> dict[str, int]:
    start = next((i for i, t in enumerate(texts) if "What it is." in t), 2)
    pages: dict[str, int] = {}
    cur = start
    for lvl, hid, text in hs:
        key = re.sub(r"\s+", " ", text)
        key = key.replace("’", "'")
        found = None
        for i in range(cur, len(texts)):
            t = texts[i].replace("’", "'")
            if key in t:
                found = i
                break
        if found is None:  # try a shorter prefix (wrapped or ligatured heading)
            short = key[:28]
            for i in range(cur, len(texts)):
                if short in texts[i].replace("’", "'"):
                    found = i
                    break
        if found is not None:
            pages[hid] = found + 1
            cur = found
    return pages


def main() -> None:
    no_pdf = "--no-pdf" in sys.argv
    B.mkdir(parents=True, exist_ok=True)
    prep_assets()
    md, _ = transform(SRC.read_text())
    tmp_md = B / "report.md"
    tmp_md.write_text(md)
    body = pandoc(tmp_md)
    body = explicit_tags(body)
    body = tag_labels(body)
    body = status_cells(body)
    body = wide_tables(body)
    # first h1 follows the TOC page; later appendix A starts a page
    body = body.replace('<h1 id="exec"', '<h1 class="pb" id="exec"', 1)
    body = body.replace('<h1 id="appendixa"', '<h1 class="pb" id="appendixa"', 1)
    hs = headings(body)
    html1 = build_html(body, {})
    p = B / "report.html"
    p.write_text(html1)
    if no_pdf:
        print("html written", p)
        return
    tmp_pdf = B / "pass1.pdf"
    render_pdf(p, tmp_pdf)
    texts = pdf_pages_text(tmp_pdf)
    pages = locate(hs, texts)
    p.write_text(build_html(body, pages))
    render_pdf(p, OUT_PDF)
    texts2 = pdf_pages_text(OUT_PDF)
    pages2 = locate(hs, texts2)
    if pages2 != pages:  # TOC length changed between passes: one more settle pass
        p.write_text(build_html(body, pages2))
        render_pdf(p, OUT_PDF)
        pages = pages2
    missing = [h for h in hs if h[1] not in pages]
    print(f"pages: {len(pdf_pages_text(OUT_PDF))}; headings located: {len(pages)}/{len(hs)}; missing: {[m[2] for m in missing]}")
    (B / "toc-pages.json").write_text(__import__("json").dumps(pages, indent=1))


if __name__ == "__main__":
    main()
