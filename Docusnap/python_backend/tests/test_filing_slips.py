#!/usr/bin/env python3
"""
tests/test_filing_slips.py -- separator-sheet PACK GENERATOR battery (slice 2,
docs/designs/FILING_SLIPS_2026-07-18.md #5/#7).

Proves: CLI JSON contract, duplex pairing (2 pages per sheet), A4 page geometry
(the resolution= kwarg is load-bearing -- without it sheets print off-A4), count
clamping, and the ROUND-TRIP: every generated page must decode as a separator via
the REAL detector (ocr/slip_detect.detect_slips) with the exact expected payload
sequence -- the artwork and the detector can never drift apart unnoticed. Also runs
the generator under -P (embeddable sys.path behaviour).

Run: cd python_backend && py -3.12 tests/test_filing_slips.py
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ocr.slip_detect import detect_slips  # noqa: E402

PB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(PB, "filing_slips.py")
TMP = tempfile.mkdtemp(prefix="slip_pack_")
fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1


def gen(name, *args, safepath=False):
    out = os.path.join(TMP, name)
    cmd = [sys.executable] + (["-P"] if safepath else []) + [GEN, "--out", out, *args]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    try:
        return out, json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return out, {"success": False, "error": f"stdout={p.stdout[:150]!r} stderr={p.stderr[-200:]!r}"}


print("#1 CLI contract + duplex pairing")
out, r = gen("pack.pdf", "--count", "3", "--start", "7")
check("generation succeeds", r.get("success") is True, json.dumps(r))
check("range reported 7-9", r.get("first") == 7 and r.get("last") == 9)
check("duplex: 2 pages per sheet", r.get("pages") == 6)

print("#2 page geometry (A4 via the resolution kwarg)")
import pypdfium2 as pdfium  # noqa: E402
doc = pdfium.PdfDocument(out)
check("page count 6", len(doc) == 6)
w, h = doc[0].get_size()   # PDF points
check("page is A4 (595x842pt +/-3)", abs(w - 595) <= 3 and abs(h - 842) <= 3, f"{w:.1f}x{h:.1f}")
doc.close()

print("#3 round-trip: every page decodes via the REAL detector, exact payload sequence")
d = detect_slips(out)
check("all 6 pages are separators", d["aborted"] is None and d["separator_pages"] == [0, 1, 2, 3, 4, 5],
      json.dumps(d))
check("payload sequence 0007,0007,0008,0008,0009,0009",
      d["separator_payloads"] == ["SFSEP-0007", "SFSEP-0007", "SFSEP-0008", "SFSEP-0008", "SFSEP-0009", "SFSEP-0009"])

print("#4 clamping")
out2, r = gen("clamp.pdf", "--count", "0", "--start", "12")
check("count 0 clamps to 1 (2 duplex pages)", r.get("success") is True and r.get("pages") == 2
      and r.get("first") == 12 and r.get("last") == 12, json.dumps(r))

print("#5 embeddable (-P) run")
out3, r = gen("embed.pdf", "--count", "1", safepath=True)
check("generator runs under -P (no sibling-import trap)", r.get("success") is True, json.dumps(r))

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
