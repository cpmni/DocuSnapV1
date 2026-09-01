"""
test_error_payload.py — _build_error_payload, the comprehensive per-file error record (2026-09-01).
Both the manual import and the watch folder emit through this, so its detail is parity-free.

Run:  py -3.12 python_backend/tests/test_error_payload.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import process_docs as pd

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1

# ── exception path: stage + error_type + truncated traceback ──────────────────
try:
    raise ValueError("bad ref INV-12345")
except Exception as exc:
    p = pd._build_error_payload("doc1_Acme.pdf", exc, stage="extract")
check("keeps the minimal shape", p["type"] == "file_done" and p["success"] is False and p["status"] == "error")
check("names the file", p["original_filename"] == "doc1_Acme.pdf")
check("carries error_type", p.get("error_type") == "ValueError")
check("carries stage", p.get("stage") == "extract")
check("carries the message", "bad ref" in p.get("error", ""))
check("carries a traceback", "traceback" in p and "ValueError" in p["traceback"])

# traceback is length-capped (~2KB)
try:
    def deep(n):
        if n <= 0:
            raise RuntimeError("x" * 500)
        deep(n - 1)
    deep(60)
except Exception as exc:
    p2 = pd._build_error_payload("d.pdf", exc, stage="ocr")
check("traceback truncated to <= 2000 chars", len(p2.get("traceback", "")) <= 2000)

# ── watchdog/timeout path ─────────────────────────────────────────────────────
pt = pd._build_error_payload("slow.pdf", None, stage="ocr", timeout_s=300)
check("timeout: stage=timeout", pt.get("stage") == "timeout")
check("timeout: timeout_s numeric", pt.get("timeout_s") == 300)
check("timeout: records stage at wedge", pt.get("stage_at_timeout") == "ocr")
check("timeout: human message", "timed out after 300s" in pt.get("error", ""))
check("timeout: no traceback (nothing threw)", "traceback" not in pt)

# ── defensive fallback: a broken exc-like object never aborts ─────────────────
class Boom:
    def __str__(self): raise RuntimeError("nope")
p3 = pd._build_error_payload("d.pdf", Boom(), stage="extract")
check("fallback keeps minimal shape on a hostile exc", p3["status"] == "error" and "error" in p3)

print(f"\n{fails} FAILED" if fails else "\nAll error-payload pins passed")
sys.exit(1 if fails else 0)
