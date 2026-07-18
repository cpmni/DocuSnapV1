#!/usr/bin/env python3
"""
tests/test_slip_embeddable_import.py — embeddable-Python import pin for Filing Slips
(mirrors tests/test_region_embeddable_import.py; Oracle C5).

The PACKAGED app's embeddable Python (python312._pth) suppresses the automatic
script-directory sys.path entry, so a spawned CLI whose sibling imports are bare
(`import slip_detect`) crashes in the built app while dev's system Python masks it.
segment_docs.py must keep its own sys.path.insert + `from ocr.slip_detect import …`
package-style import. `python -P` (PYTHONSAFEPATH) reproduces the embeddable behaviour
in dev; against the packaged build, run the same check with
dist/win-unpacked/resources/vendor/python/python.exe (no -P needed — the _pth does it).

Run: cd python_backend && py -3.12 tests/test_slip_embeddable_import.py
     (optionally: set SLIP_EMBED_PY=<path to vendor python.exe> to test a build)
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slip_fixtures import make_slip_page, make_content_page, build_pdf  # noqa: E402

PB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEG = os.path.join(PB, "segment_docs.py")

fails = 0
def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1

fixture = os.path.join(tempfile.mkdtemp(prefix="slip_embed_"), "fx.pdf")
build_pdf([make_content_page(0), make_slip_page(7), make_content_page(1)], fixture)

override = os.environ.get("SLIP_EMBED_PY")
cmd = [override, SEG] if override else [sys.executable, "-P", SEG]
r = subprocess.run([*cmd, "--file", fixture, "--slips"], capture_output=True, text=True, timeout=180)

check("segment_docs.py --slips runs under -P / embeddable (no ModuleNotFoundError)",
      r.returncode == 0 and "ModuleNotFoundError" not in (r.stderr or ""), (r.stderr or "")[:200])
try:
    res = json.loads(r.stdout.strip().splitlines()[-1])
    check("slip chain imported + decoded under -P (separator page found)",
          res.get("success") is True and res.get("separator_pages") == [1], r.stdout[:200])
except Exception as e:
    check("slip chain imported + decoded under -P (separator page found)", False, f"{e}: {r.stdout[:120]!r}")

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
