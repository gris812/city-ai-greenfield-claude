#!/usr/bin/env python3
"""Rasterize every page of a PDF to PNG for layout QA (pypdfium2). Usage: rasterize.py in.pdf outdir [scale]"""
import sys
from pathlib import Path

import pypdfium2 as pdfium

pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.35
out.mkdir(parents=True, exist_ok=True)
doc = pdfium.PdfDocument(str(pdf))
for i in range(len(doc)):
    doc[i].render(scale=scale).to_pil().save(out / f"p{i + 1:02d}.png")
print(len(doc), "pages ->", out)
