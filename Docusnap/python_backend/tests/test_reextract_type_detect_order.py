#!/usr/bin/env python3
"""
tests/test_reextract_type_detect_order.py
-----------------------------------------
SOURCE-ORDER pin for the QUIET REDETECT (2026-09-24, gary Q4 / Oracle premise check): the imageless
`--reextract` run reuses the cached page text and renders nothing, and `detect_document_type(...)` must
run OUTSIDE (after) that branch so a type that became available is detected on the Quick road exactly as
on a Full read. A refactor that moves the detection call inside the render branch (or gates it on page
images) would silently turn every quiet redetect into a no-op with the JS pins still green.

    py -3.12 python_backend/tests/test_reextract_type_detect_order.py
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).parent.parent / "process_docs.py"
lines = SRC.read_text(encoding="utf-8").splitlines()

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{(' - ' + extra) if (extra and not cond) else ''}")
    if not cond:
        fails += 1


def indent(s):
    return len(s) - len(s.lstrip(" "))


# the imageless branch: `if getattr(args, 'reextract', False):` that assigns ocr_text/page_images
br = [i for i, l in enumerate(lines) if re.search(r"if getattr\(args, 'reextract', False\):", l)
      and any("page_images = " in x or "ocr_text, page_images" in x for x in lines[i:i + 8])]
det = [i for i, l in enumerate(lines) if "engine.detect_document_type(" in l]
check("the imageless branch exists", len(br) >= 1, "no `if getattr(args, 'reextract', False):` branch found")
check("exactly one detect_document_type call site", len(det) == 1, f"found {len(det)}")
if br and len(det) == 1:
    b, d = br[0], det[0]
    # the branch body: the following lines indented deeper than the `if`
    bi = indent(lines[b])
    end = b + 1
    while end < len(lines) and (not lines[end].strip() or indent(lines[end]) > bi):
        end += 1
    # an `else:` at the same indent belongs to the same construct
    if end < len(lines) and lines[end].strip().startswith("else:") and indent(lines[end]) == bi:
        end += 1
        while end < len(lines) and (not lines[end].strip() or indent(lines[end]) > bi):
            end += 1
    check("detect_document_type is called AFTER the imageless branch (same block level, not nested in it)",
          d >= end and indent(lines[d]) <= bi, f"branch {b + 1}-{end}, detect at {d + 1}, indents {bi}/{indent(lines[d])}")
    body = "\n".join(lines[d - 3:d + 1])
    check("the detection call is not gated on page images", "page_images" not in body, body)
    check("the imageless branch renders nothing (page_images = [])", any("page_images = (_cached or ''), []" in l or "ocr_text, page_images = (_cached or ''), []" in l for l in lines[b:end]))

print("\nALL OK" if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
