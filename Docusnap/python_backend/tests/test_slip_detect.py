#!/usr/bin/env python3
"""
tests/test_slip_detect.py -- Filing Slips detection battery (design #7,
docs/designs/FILING_SLIPS_2026-07-18.md). Builds every fixture at runtime with
segno + PIL (tests/slip_fixtures.py) -- no binary fixtures in git.

Covers: every #4 edge case (mid/leading/trailing/consecutive/only-slips/none), the
namespace firewall (payment/URL QRs and near-miss payloads never split), a degradation
battery (rotation, masked band, smaller sheet), abort semantics (garbage file, page cap
-- abort is WHOLE-file, never a partial map), the segments_excluding pure battery,
PIN #2 (slips present => template segmentation skipped, via the segment_docs CLI), and
PIN #3 (pdf_splitter.parse_ranges comma-group EXCLUSION semantics the feature relies on).

Run: cd python_backend && py -3.12 tests/test_slip_detect.py
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # python_backend/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))                    # tests/

from slip_fixtures import make_slip_page, make_content_page, build_pdf  # noqa: E402
from ocr.slip_detect import detect_slips, segments_excluding, SLIP_PAYLOAD_RE  # noqa: E402

PB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="slip_test_")
fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1


def pdf(name, pages):
    return build_pdf(pages, os.path.join(TMP, name))


C = make_content_page

print("#1 payload namespace regex")
check("SFSEP-0007 accepted", bool(SLIP_PAYLOAD_RE.fullmatch("SFSEP-0007")))
check("SFSEP-1 and SFSEP-123456 accepted (1-6 digits)",
      bool(SLIP_PAYLOAD_RE.fullmatch("SFSEP-1")) and bool(SLIP_PAYLOAD_RE.fullmatch("SFSEP-123456")))
check("bare/over-long/prefixed/url payloads rejected",
      not any(SLIP_PAYLOAD_RE.fullmatch(p) for p in
              ["SFSEP-", "SFSEP-1234567", "XSFSEP-0001", "SFSEP-0001X", "https://pay.example/x", "sfsep-0001"]))

print("#2 detection -- edge-case layouts (design #4 table)")
r = detect_slips(pdf("mid.pdf", [C(0), make_slip_page(7), C(1)]))
check("mid slip: page found + payload", r["aborted"] is None and r["separator_pages"] == [1]
      and r["separator_payloads"] == ["SFSEP-0007"], json.dumps(r))
check("mid slip: exclusion segments", segments_excluding(r["page_count"], r["separator_pages"]) == [[0, 0], [2, 2]])

r = detect_slips(pdf("lead.pdf", [make_slip_page(1), C(0), C(1)]))
check("leading slip dropped", r["separator_pages"] == [0]
      and segments_excluding(3, r["separator_pages"]) == [[1, 2]])

r = detect_slips(pdf("trail.pdf", [C(0), C(1), make_slip_page(2)]))
check("trailing slip (the REWRITE fixture)", r["separator_pages"] == [2]
      and segments_excluding(3, r["separator_pages"]) == [[0, 1]])

r = detect_slips(pdf("duplex.pdf", [C(0), make_slip_page(3), make_slip_page(3), C(1)]))
check("consecutive slips (duplex pack) both excluded, one boundary",
      r["separator_pages"] == [1, 2] and segments_excluding(4, r["separator_pages"]) == [[0, 0], [3, 3]])

r = detect_slips(pdf("onlyslips.pdf", [make_slip_page(4), make_slip_page(5)]))
check("only-slips file: no segments remain", r["separator_pages"] == [0, 1]
      and segments_excluding(2, r["separator_pages"]) == [])

r = detect_slips(pdf("none.pdf", [C(0), C(1)]))
check("no slips: clean empty result", r["aborted"] is None and r["separator_pages"] == [])

print("#3 namespace firewall on real pages")
r = detect_slips(pdf("foreign.pdf", [C(0), make_slip_page(9, payload="https://pay.example/inv/123"),
                                     make_slip_page(9, payload="XSFSEP-0001")]))
check("foreign/near-miss QR pages are NOT separators", r["aborted"] is None and r["separator_pages"] == [])

print("#4 degradation battery (ECC-H margin)")
r = detect_slips(pdf("rot.pdf", [C(0), make_slip_page(7, rotate_deg=3.0), C(1)]))
check("+/-3° rotated sheet decodes", r["separator_pages"] == [1], json.dumps(r))
r = detect_slips(pdf("mask.pdf", [C(0), make_slip_page(7, mask_band_frac=0.03), C(1)]))
check("thin masked band (3% - toner-banding class) decodes (ECC-H)", r["separator_pages"] == [1], json.dumps(r))
r = detect_slips(pdf("small.pdf", [C(0), make_slip_page(7, qr_mm=45), C(1)]))
check("45 mm sheet QR still decodes at the 150 DPI render", r["separator_pages"] == [1], json.dumps(r))

print("#5 abort semantics -- whole-file or nothing")
garbage = os.path.join(TMP, "garbage.pdf")
with open(garbage, "w", encoding="utf-8") as fh:
    fh.write("this is not a pdf")
r = detect_slips(garbage)
check("garbage file aborts (never partial)", bool(r["aborted"]) and r["separator_pages"] == [])
r = detect_slips(pdf("cap.pdf", [C(0), make_slip_page(7), C(1)]), max_pages=2)
check("page-cap aborts whole file", bool(r["aborted"]) and r["separator_pages"] == [], json.dumps(r))

print("#6 segments_excluding pure battery")
check("no seps -> whole file", segments_excluding(3, []) == [[0, 2]])
check("all seps -> empty", segments_excluding(2, [0, 1]) == [])
check("first+last", segments_excluding(5, [0, 4]) == [[1, 3]])
check("interior pair", segments_excluding(7, [3]) == [[0, 2], [4, 6]])
check("adjacent seps merge runs", segments_excluding(6, [2, 3]) == [[0, 1], [4, 5]])
check("zero pages", segments_excluding(0, []) == [])

print("#7 PIN #3 -- pdf_splitter.parse_ranges comma-group EXCLUSION (relied-on upstream invariant)")
from pdf_splitter import parse_ranges  # noqa: E402
check("'1-3,5-7' on 7 pages drops page 4 entirely",
      parse_ranges("1-3,5-7", 7) == [[0, 1, 2], [4, 5, 6]])
check("single-page groups honoured", parse_ranges("1,3", 3) == [[0], [2]])

print("#8 segment_docs.py CLI -- orchestration + PIN #2 (slips beat templates) + OFF byte-identical")
SEG = os.path.join(PB, "segment_docs.py")
slipfx = pdf("cli.pdf", [C(0), make_slip_page(7), C(1)])
fake_templates = os.path.join(TMP, "templates.json")
with open(fake_templates, "w", encoding="utf-8") as fh:
    json.dump([{"id": 1, "name": "T", "keyword_fingerprint": ["acme", "invoice"], "logo_phash": None}], fh)


def run_seg(*extra):
    p = subprocess.run([sys.executable, SEG, "--file", slipfx, *extra],
                       capture_output=True, text=True, timeout=120)
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {"_stdout": p.stdout, "_stderr": p.stderr[-300:]}


r = run_seg("--slips")
check("--slips, no templates: slips-only result", r.get("success") is True
      and r.get("separator_pages") == [1] and r.get("segments") == [[0, 0], [2, 2]]
      and r.get("first_pages") == [0, 2], json.dumps(r)[:200])
check("--slips: reasons say separator sheet", r.get("reasons") == ["separator sheet"])

r2 = run_seg("--slips", "--templates-file", fake_templates)
check("PIN #2: slips present => template segmentation SKIPPED even with templates",
      r2.get("separator_pages") == [1] and r2.get("segments") == [[0, 0], [2, 2]]
      and r2.get("reasons") == ["separator sheet"], json.dumps(r2)[:200])

r3 = run_seg()   # no --slips: legacy shape, byte-identical contract (no separator keys)
check("no --slips: legacy result carries NO separator keys",
      r3.get("success") is True and "separator_pages" not in r3 and "slip_aborted" not in r3,
      json.dumps(r3)[:200])

noslip = pdf("cli_noslip.pdf", [C(0), C(1)])
p = subprocess.run([sys.executable, SEG, "--file", noslip, "--slips"], capture_output=True, text=True, timeout=120)
r4 = json.loads(p.stdout.strip().splitlines()[-1])
check("--slips on a slip-free file: falls through to the legacy whole-document sentinel",
      r4.get("success") is True and r4.get("segments") == [[0, 0]] and "separator_pages" not in r4,
      json.dumps(r4)[:200])

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
