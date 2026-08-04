"""Pins for DESKEW_RAW_CROPS — the Straighten-arc frame election (gary+007 → Oracle
SIGN-OFF-W/COND C1-C7, 2026-08-05 evening). Taught boxes are stored RAW-frame; under
Straighten the crop machinery read them against the DESKEWED page (misplaced + degraded
pixels). The election feeds the crop-family stages the RAW pages below the angle cap.

Run: py -3.12 python_backend/tests/test_deskew_raw_crops.py
"""
import importlib
import inspect
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


os.environ.pop('DESKEW_RAW_CROPS', None)
os.environ.pop('DESKEW_RAW_CROP_MAX_ANGLE', None)
import extraction.engine as E
importlib.reload(E)

P = ["deskewed0", "deskewed1", "deskewed2"]     # stand-in page objects (identity is the contract)
R = ["raw0", "raw1", "raw2"]

# ── default OFF: identity by object (C1/byte-identity) ───────────────────────
check("switch default OFF", E.DESKEW_RAW_CROPS is False)
check("OFF: election returns page_images BY IDENTITY",
      E._elect_crop_pages(P, R, [1.0, 1.0, 1.0]) is P)

# ── armed ────────────────────────────────────────────────────────────────────
os.environ['DESKEW_RAW_CROPS'] = '1'
importlib.reload(E)
check("switch arms; cap default 2.0", E.DESKEW_RAW_CROPS is True
      and E.DESKEW_RAW_CROP_MAX_ANGLE == 2.0)

check("no raw pages -> identity (deskew off path)", E._elect_crop_pages(P, None, None) is P)
check("empty raw list -> identity", E._elect_crop_pages(P, [], None) is P)
check("length mismatch -> identity (defensive fail-to-status-quo)",
      E._elect_crop_pages(P, R[:2], [1.0, 1.0]) is P)

sel = E._elect_crop_pages(P, R, [1.9, 0.0, 4.0])
check("per-page cap: 1.9° -> raw, 0.0° -> raw, 4.0° -> deskewed (above-cap = status quo)",
      sel[0] is R[0] and sel[1] is R[1] and sel[2] is P[2])
check("missing angles -> treated as 0.0 -> raw",
      E._elect_crop_pages(P, R, None) == R)
check("junk angle entry -> 0.0 -> raw (never a crash)",
      E._elect_crop_pages(P, R, ["x", None, 1.0])[0] is R[0])

# cap override env
os.environ['DESKEW_RAW_CROP_MAX_ANGLE'] = '2.5'
importlib.reload(E)
check("cap env override honoured (2.5)",
      E._elect_crop_pages(P, R, [2.4, 0, 0])[0] is R[0])
os.environ.pop('DESKEW_RAW_CROP_MAX_ANGLE', None)
importlib.reload(E)

# ── C1 wiring pin: ONE elected list feeds every crop site ────────────────────
src = inspect.getsource(E.ExtractionEngine.extract)
check("election computed once (crop_pages = _elect_crop_pages...)",
      src.count("_elect_crop_pages(") == 1)
check("mapper call receives crop_pages",
      re.search(r"extract_with_mappings\(\s*crop_pages", src) is not None)
check("registration fit receives crop_pages[0]",
      "_fit_page_transform(\n                            crop_pages[0]" in src
      or "_fit_page_transform(crop_pages[0]" in src.replace("\n", " ").replace("  ", " ") or
      re.search(r"_fit_page_transform\(\s*crop_pages\[0\]", src) is not None)
check("ALL THREE anchor calls receive crop_pages (main + rescue + corroboration)",
      len(re.findall(r"page_images=crop_pages", src)) == 3)
check("no crop site still receives the raw page_images kwarg",
      "page_images=page_images" not in src)

# ── C2 pin: the Stage-2.5 raw witness stays LIVE (global disable FORBIDDEN — the
# above-cap band still serves deskewed crops and the witness is its only guard) ──
check("raw witness still gated ONLY on raw_page0 + DESKEW_RAW_WITNESS (not on the election)",
      re.search(r"raw_page0 is not None and os\.environ\.get\('DESKEW_RAW_WITNESS'", src)
      is not None and "DESKEW_RAW_CROPS" not in src.split("DESKEW_RAW_WITNESS")[0][-400:])

# ── site 6: pre-extract identify queries raw under the same switch ───────────
pd = (Path(__file__).resolve().parents[1] / "process_docs.py").read_text(encoding="utf-8")
check("process_docs threads deskew_angles_out + raw_pages + deskew_angles",
      "deskew_angles_out=_deskew_angles" in pd and "raw_pages       = (_raw_pages or None)" in pd
      and "deskew_angles   = (_deskew_angles or None)" in pd)
check("site 6: pre-extract identify elects the raw page under DESKEW_RAW_CROPS",
      "DESKEW_RAW_CROPS" in pd and "_idpage = _raw_pages[0]" in pd)

os.environ.pop('DESKEW_RAW_CROPS', None)
importlib.reload(E)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All DESKEW_RAW_CROPS election checks passed.")
