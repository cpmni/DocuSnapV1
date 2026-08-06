#!/usr/bin/env python3
"""tests/test_template_pad_window_code.py — PAD-WINDOW CODE READ, Slice 1b (gary -> Oracle
SIGN-OFF-W/COND 2026-08-09).

The code sibling of the date pad-window. A LABEL-LESS taught code box (no anchor_text) too tight for
its value CLIPS the leading glyphs ('PO-40351' -> '40351') or garbles ('IM.ANKI1'); the clip is
FORMAT-VALID so the merge-layer TEMPLATE_FORMAT_FAIL_YIELD declines it and the containment ladder is
skipped (needs a label). A row-bounded padded re-read of the SAME box recovers the fuller code.

THE SEAM THIS PINS (`_maybe_pad_code`):
  • SWAP (adopt padded, clean tier, NO note) ONLY on a STRICT SUFFIX containment (recovered clipped
    prefix) + substantial-overlap floor + a CONSENT gate (confirmed/provisional shape). A COLD read
    never clean-swaps — Oracle's fork (B), the defense against the label-glue false-swap.
  • FLAG (keep committed, cap<=70 + note) on any other confident disagreement (garble, or a cold suffix).
  • ABSTAIN (byte-identical no-op) on: an already-noted result (never erase the edge-cut/shape flag),
    prefix-containment (right over-read — the tight read was correct), weak margin, empty tight, OFF.

Run: py -3.12 python_backend/tests/test_template_pad_window_code.py
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm

VP = {"reference_code": json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
                                   .read_text(encoding="utf-8"))["validation_patterns"]["reference_code"]}
_BOX = {"x_norm": 0.8, "y_norm": 0.13, "w_norm": 0.08, "h_norm": 0.015}

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

def run(committed, pad, *, pad_conf=95, tight_conf=70, consent="provisional",
        note=None, flag_on=True, val_type="alphanumeric", field_key="po_number"):
    """Drive _maybe_pad_code with a STUBBED padded read + a stubbed consent ladder."""
    tm._PAD_WINDOW_CODE_ON = flag_on
    tm._read_pad_window_code = (lambda page, box, vp: (pad, pad_conf)) if pad is not None else (lambda *a: None)
    prov = (lambda fk, v: True) if consent in ("provisional",) else (lambda fk, v: False)
    fmt = None   # 'confirmed'/'refused' come via format_lookup; provisional via provisional_lookup
    res = {"value": committed, "confidence": 90, "method": "template_mapping"}
    if note: res["validation_note"] = note
    return tm._maybe_pad_code(object(), _BOX, val_type, res, tight_conf,
                              False, field_key, False, field_key, VP, fmt, prov)

# ── SWAP: consented strict-suffix clipped-prefix recovery ──────────────────────────────────────
r = run("40351", "PO-40351", consent="provisional")
check("SWAP: consented '40351' <- padded 'PO-40351' adopts the fuller code",
      r.get("value") == "PO-40351")
check("SWAP: no review note (auto-fileable tier, not a flag)", r.get("validation_note") is None)
check("SWAP: method tagged _padunclip", str(r.get("method", "")).endswith("_padunclip"))
check("SWAP: label-less clean tier is 78 (< the 88 critical floor — review-bound, honest ceiling)",
      r.get("confidence") == 78)
check("SWAP: breadcrumb records the clipped read", r.get("pad_unclipped_from") == "40351")

# ── FORK (B) PIN: a COLD strict-suffix does NOT clean-swap — it FLAGS ───────────────────────────
r = run("40351", "PO-40351", consent="none")
check("FORK-B PIN: cold '40351'<-'PO-40351' FLAGS (never a cold clean swap)",
      r.get("value") == "40351" and r.get("confidence") <= 70
      and "PO-40351" in (r.get("validation_note") or "") and str(r.get("method")).endswith("_padcodeflag"))

# ── LABEL-GLUE PIN: 'PONo40351' endswith '40351' passes the floor, but the glued shape is COLD ──
r = run("40351", "PONo40351", consent="none")
check("GLUE PIN: cold 'PONo40351' does NOT swap the correct '40351' (consent, not the floor, blocks it)",
      r.get("value") == "40351" and str(r.get("method")).endswith("_padcodeflag"))

# ── GARBLE → FLAG (non-containment), even with consent ─────────────────────────────────────────
r = run("IM.ANKI1", "PO-90621", consent="provisional")
check("GARBLE: 'IM.ANKI1' vs 'PO-90621' (no containment) FLAGS, keeps committed",
      r.get("value") == "IM.ANKI1" and "PO-90621" in (r.get("validation_note") or "")
      and str(r.get("method")).endswith("_padcodeflag"))

# ── MIN-SUFFIX FLOOR: a 1-char suffix never swaps (dirty-bootstrap guard) ───────────────────────
r = run("1", "PO-90621", consent="provisional")
check("FLOOR: 1-char suffix '1' of 'PO-90621' does NOT swap (min-suffix floor)",
      r.get("value") != "PO-90621")

# ── PREFIX-containment (right over-read) → ABSTAIN (tight was correct) ──────────────────────────
r = run("PO-40351", "PO-40351X", consent="provisional")
check("ABSTAIN: prefix-containment 'PO-40351' is a prefix of 'PO-40351X' -> no-op (tight was correct)",
      r.get("value") == "PO-40351" and r.get("validation_note") is None
      and r.get("method") == "template_mapping")

# ── NOTE-FIRST short-circuit: never erase an existing review flag (edge-cut / shape-warn) ───────
r = run("40351", "PO-40351", consent="provisional", note="already flagged by the edge guard")
check("NOTE-FIRST: an already-noted result is byte-identical no-op (edge-cut flag not erased)",
      r.get("value") == "40351" and r.get("validation_note") == "already flagged by the edge guard")

# ── WEAK MARGIN → no-op (fail toward max auto-file) ─────────────────────────────────────────────
r = run("40351", "PO-40351", pad_conf=80, tight_conf=70, consent="provisional")   # margin 10 < 15
check("MARGIN: padded conf within 15 of tight is a no-op (weak disagreement kept)",
      r.get("value") == "40351" and r.get("validation_note") is None)

# ── EMPTY tight → no-op (Oracle C1 — the keyword/relocate path owns it) ─────────────────────────
r = run("", "PO-40351", consent="provisional")
check("EMPTY: empty tight read is a no-op (keyword path owns it)", r.get("value") == "")

# ── OFF → byte-identical ────────────────────────────────────────────────────────────────────────
r = run("40351", "PO-40351", consent="provisional", flag_on=False)
check("OFF: TEMPLATE_PAD_WINDOW_CODE off is byte-identical (no swap, no note)",
      r.get("value") == "40351" and r.get("validation_note") is None
      and r.get("method") == "template_mapping")

# ── non-code val_type → no-op (dates own the date slice) ─────────────────────────────────────────
r = run("40351", "PO-40351", consent="provisional", val_type="date")
check("SCOPE: a date val_type is a no-op here (owned by _maybe_pad_date_flag)",
      r.get("value") == "40351")

check("flag defaults OFF at import (env unset -> byte-identical)",
      os.environ.get("TEMPLATE_PAD_WINDOW_CODE") in (None, "0"))

print()
print(f"{fails} FAILED" if fails else "All PAD-WINDOW CODE pins passed")
sys.exit(1 if fails else 0)
