#!/usr/bin/env python3
"""
tests/test_generic_title_seam.py -- the REAL process_docs invocation of the Auto-Title
seam (yesterday's C1-class lesson: call-time wiring escapes module-load smokes).

Proves on actual spawns of process_docs.py over a synthetic scanned page:
  1. env off  -> no title row (kill switch honoured);
  2. AUTO_TITLE=1 + detection None -> extractions.title present, method 'auto_title',
     conf 60, picked from the page's own heading;
  3. AUTO_TITLE=1 + a TYPED doc (prints INVOICE) -> NO title row (PIN 5: typed docs
     never get one).

Needs Tesseract at the dev path. Run: cd python_backend && py -3.12 tests/test_generic_title_seam.py
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw  # noqa: E402
import filing_slips as FS  # noqa: E402  (font ladder reuse only)

PB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
CONFIG = os.path.join(os.path.dirname(PB), "config", "keyword_patterns.json")
PAGE = (1654, 2339)

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}" + (f"  [{extra}]" if extra and not cond else ""))
    if not cond:
        fails += 1


def make_page(heading, body_lines):
    img = Image.new("L", PAGE, 255)
    d = ImageDraw.Draw(img)
    d.text((PAGE[0] // 2, 380), heading, font=FS._font(84), fill=0, anchor="mm")
    y = 700
    for ln in body_lines:
        d.text((160, y), ln, font=FS._font(36), fill=40)
        y += 90
    return img


def run_folder(pages_by_name, env_extra):
    folder = tempfile.mkdtemp(prefix="title_seam_")
    for name, img in pages_by_name.items():
        img.save(os.path.join(folder, name), "PDF", resolution=200.0)
    env = {**os.environ, **env_extra}
    p = subprocess.run([sys.executable, os.path.join(PB, "process_docs.py"),
                        "--folder", folder, "--tesseract", TESS, "--config-file", CONFIG],
                       capture_output=True, text=True, timeout=600, env=env)
    done = {}
    for ln in p.stdout.splitlines():
        ln = ln.strip()
        if not ln.startswith("{"):
            continue
        try:
            m = json.loads(ln)
        except Exception:
            continue
        if m.get("type") == "file_done":
            done[m.get("original_filename")] = m
    return done, p


generic_page = make_page("BOILER SERVICE CERTIFICATE",
                         ["The appliance listed below was serviced by our engineer.",
                          "Appliance: gas combination boiler, kitchen.",
                          "All checks completed to the current standard."])
typed_page = make_page("INVOICE",
                       ["Invoice Number: INV-4410", "Invoice Date: 15/07/2026",
                        "Total: 240.00"])

print("#1 kill switch honoured (no env -> no title row)")
done, p = run_folder({"gen.pdf": generic_page}, {})
m = done.get("gen.pdf") or {}
check("file processed", bool(m), (p.stdout + p.stderr)[-300:])
check("detection None (the fallback class)", not m.get("document_type"), m.get("document_type"))
check("no title row without AUTO_TITLE", "title" not in (m.get("extractions") or {}))

print("#2 AUTO_TITLE=1 + detection None -> auto title from the page's own heading")
done, p = run_folder({"gen.pdf": generic_page}, {"AUTO_TITLE": "1"})
m = done.get("gen.pdf") or {}
t = (m.get("extractions") or {}).get("title") or {}
check("title row present", bool(t), json.dumps(list((m.get('extractions') or {}).keys())))
check("method auto_title @60", t.get("method") == "auto_title" and t.get("confidence") == 60, json.dumps(t))
check("picked the heading", "certificate" in str(t.get("value") or "").lower(), t.get("value"))

print("#3 PIN 5 — a TYPED doc never gets a title row, even with the env on")
done, p = run_folder({"inv.pdf": typed_page}, {"AUTO_TITLE": "1"})
m = done.get("inv.pdf") or {}
check("typed as an invoice", str(m.get("document_type") or "").lower() == "invoice", m.get("document_type"))
check("no title row on a typed doc", "title" not in (m.get("extractions") or {}))

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
