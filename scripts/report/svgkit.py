"""Tiny SVG drawing kit for the investor-report figures.

Brand tokens come from assets/brand/tokens.json (petrol/ember/amber/sand/ink). Fonts: Onest (UI/labels).
All figures are plain SVG (no external assets) so they render identically in Chromium (PDF) and cairosvg (PNG).
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOK = json.loads((ROOT / "assets/brand/tokens.json").read_text())
C = {}
for grp in ("brand", "accent", "neutral", "semantic", "guide"):
    C.update(TOK["color"][grp])

INK = C["ink"]
INK2 = C["stone-600"]
INK3 = C["stone-500"]
PAPER = C["paper"]
LINE = C["sand-200"]
FONT = "Onest, 'Helvetica Neue', Arial, sans-serif"
SERIF = "Literata, Georgia, serif"
MONO = "'JetBrains Mono', 'DejaVu Sans Mono', monospace"

# semantic box kinds -> (fill, stroke, text, dash)
KIND = {
    "det": (C["petrol-50"], C["petrol-700"], INK, None),  # deterministic product code
    "llm": (C["ember-100"], C["ember-ink"], INK, None),  # generative model / LLM
    "ext": ("#FFFFFF", INK3, INK, "5 4"),  # paid or third-party external provider
    "store": (C["sand-100"], C["stone-600"], INK, None),  # data store / cache
    "client": (C["emil-soft"], C["emil-ink"], INK, None),  # client surface
    "warn": (C["warn-bg"], C["warn"], INK, "5 4"),  # blocked / not exercised live
    "ok": (C["success-bg"], C["success"], INK, None),
    "plain": ("#FFFFFF", C["stone-400"], INK, None),
    "dark": (C["petrol-800"], C["petrol-900"], "#FFFFFF", None),
}


_FONTS = {}


def tw(s: str, size: float, weight: int = 500) -> float:
    """Measured text width (px) using the Onest TTFs so boxes can auto-fit."""
    from PIL import ImageFont

    f = "/root/.fonts/Onest-Bold.ttf" if weight >= 650 else ("/root/.fonts/Onest-SemiBold.ttf" if weight >= 600 else "/root/.fonts/Onest-Medium.ttf")
    key = f
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(f, 100)
    return _FONTS[key].getlength(s) * size / 100.0


def fit(lines, size, weight, maxw, minsize=8.5):
    w = max(tw(l, size, weight) for l in lines) if lines else 0
    if w <= maxw:
        return size
    return max(minsize, size * maxw / w)


def wrap(s: str, size: float, weight: int, maxw: float):
    words, out, cur = s.split(), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if tw(t, size, weight) <= maxw or not cur:
            cur = t
        else:
            out.append(cur)
            cur = wd
    if cur:
        out.append(cur)
    return out


def esc(s: str) -> str:
    return html.escape(str(s), quote=False)


class Svg:
    def __init__(self, w: int, h: int, title: str, desc: str = ""):
        self.w, self.h = w, h
        self.title, self.desc = title, desc
        self.parts: list[str] = []
        self.defs: list[str] = []
        self._mk = 0

    # ---- primitives -------------------------------------------------------
    def rect(self, x, y, w, h, fill="#fff", stroke="none", r=10, sw=1.5, dash=None, opacity=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        o = f' opacity="{opacity}"' if opacity is not None else ""
        self.parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}{o}/>'
        )

    def text(self, x, y, s, size=14, weight=500, fill=INK, anchor="start", family=FONT, italic=False, spacing=None, opacity=None):
        st = ' font-style="italic"' if italic else ""
        ls = f' letter-spacing="{spacing}"' if spacing else ""
        o = f' opacity="{opacity}"' if opacity is not None else ""
        self.parts.append(
            f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{st}{ls}{o}>{esc(s)}</text>'
        )

    def lines(self, x, y, lines, size=14, weight=500, fill=INK, anchor="start", lh=1.3, family=FONT, maxw=None):
        if maxw:
            size = fit(lines, size, weight, maxw)
        for i, s in enumerate(lines):
            self.text(x, y + i * size * lh, s, size, weight, fill, anchor, family)

    def line(self, x1, y1, x2, y2, stroke=INK3, sw=1.5, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def circle(self, cx, cy, r, fill="#fff", stroke="none", sw=1.5):
        self.parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def _marker(self, color):
        self._mk += 1
        mid = f"ah{self._mk}"
        self.defs.append(
            f'<marker id="{mid}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>'
        )
        return mid

    def arrow(self, pts, stroke=INK2, sw=1.6, dash=None, both=False, label=None, lsize=12, lpos=0.5, lanchor="middle", loff=(0, -6), lfill=None):
        """Polyline arrow through pts [(x,y),...]. Optional label placed at fraction lpos of the first segment."""
        mid = self._marker(stroke)
        d = " ".join(("M" if i == 0 else "L") + f"{x:.1f},{y:.1f}" for i, (x, y) in enumerate(pts))
        da = f' stroke-dasharray="{dash}"' if dash else ""
        ms = f' marker-start="url(#{mid})"' if both else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}"{da} marker-end="url(#{mid})"{ms} stroke-linejoin="round"/>')
        if label:
            (x1, y1), (x2, y2) = pts[0], pts[1]
            lx, ly = x1 + (x2 - x1) * lpos + loff[0], y1 + (y2 - y1) * lpos + loff[1]
            if lfill:
                tw = len(label) * lsize * 0.52 + 8
                ax = lx - tw / 2 if lanchor == "middle" else lx - 4
                self.rect(ax, ly - lsize + 1, tw, lsize + 5, fill=lfill, r=3)
            self.text(lx, ly, label, lsize, 500, INK2, lanchor)

    def box(self, x, y, w, h, title, sub=None, kind="det", tsize=15, ssize=12.5, r=10, align="center", bold=True, sw=1.6, ty=None):
        fill, stroke, tcol, dash = KIND[kind]
        self.rect(x, y, w, h, fill, stroke, r=r, sw=sw, dash=dash)
        sub = sub or []
        tl = title if isinstance(title, list) else [title]
        tsize = fit(tl, tsize, 700 if bold else 500, w - 16)
        ssize = fit(sub, ssize, 500, w - 16) if sub else ssize
        total = len(tl) * tsize * 1.2 + len(sub) * ssize * 1.3
        cy = y + (h - total) / 2 + tsize * 0.95 if ty is None else ty
        cx = x + w / 2 if align == "center" else x + 12
        anc = "middle" if align == "center" else "start"
        for i, t in enumerate(tl):
            self.text(cx, cy + i * tsize * 1.2, t, tsize, 700 if bold else 500, tcol, anc)
        base = cy + (len(tl) - 1) * tsize * 1.2 + ssize * 1.45
        sc = INK2 if kind != "dark" else "#DCECEE"
        for i, s in enumerate(sub):
            self.text(cx, base + i * ssize * 1.3, s, ssize, 500, sc, anc)

    def pill(self, x, y, label, kind="plain", size=12, h=22, padx=10):
        fill, stroke, tcol, dash = KIND[kind]
        w = tw(label, size, 600) + padx * 2
        self.rect(x, y, w, h, fill, stroke, r=h / 2, sw=1.2, dash=dash)
        self.text(x + w / 2, y + h / 2 + size * 0.35, label, size, 600, tcol, "middle")
        return w

    def legend(self, x, y, items, size=12.5, gap=18):
        cx = x
        for kind, label in items:
            fill, stroke, _, dash = KIND[kind]
            self.rect(cx, y, 18, 14, fill, stroke, r=3, sw=1.4, dash=dash)
            self.text(cx + 25, y + 11.5, label, size, 500, INK2)
            cx += 25 + tw(label, size) + gap

    # ---- output -------------------------------------------------------------
    def header(self, title, subtitle=None, x=24, y=34):
        self.text(x, y, title, 22, 700, INK)
        if subtitle:
            self.text(x, y + 22, subtitle, 13, 500, INK2)

    def footer(self, prov, y=None, x=24):
        ls = wrap(prov, 11.5, 500, self.w - 2 * x)
        y0 = self.h - 12 - 14 * (len(ls) - 1) if y is None else y
        for i, l in enumerate(ls):
            self.text(x, y0 + i * 14, l, 11.5, 500, INK3)

    def render(self, bg=PAPER):
        body = "\n".join(self.parts)
        defs = "<defs>" + "".join(self.defs) + "</defs>" if self.defs else ""
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" role="img" aria-label="{esc(self.title)}">'
            f"<title>{esc(self.title)}</title><desc>{esc(self.desc)}</desc>{defs}"
            f'<rect width="{self.w}" height="{self.h}" fill="{bg}"/>\n{body}\n</svg>'
        )


def save(svg: Svg, name: str, outdir: Path, scale=2.4):
    import cairosvg

    outdir.mkdir(parents=True, exist_ok=True)
    s = svg.render()
    (outdir / f"{name}.svg").write_text(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=str(outdir / f"{name}.png"), scale=scale)
