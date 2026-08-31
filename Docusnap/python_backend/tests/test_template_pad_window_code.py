#!/usr/bin/env python3
"""tests/test_template_pad_window_code.py — PAD-WINDOW CODE READ, Slice 1b.

Two scopes, two sign-offs:
  • LABEL-LESS (gary -> Oracle SIGN-OFF-W/COND 2026-08-09, flag TEMPLATE_PAD_WINDOW_CODE).
    A taught code box with no anchor_text, too tight for its value, CLIPS the leading glyphs
    ('PO-40351' -> '40351') or garbles ('IM.ANKI1'). Commits at 78 — below the 88 critical floor, so
    review-bound regardless; the slice makes that review CORRECT + EXPLAINED.
  • LABELLED (gary -> Oracle SIGN-OFF-W/COND 2026-08-06, sub-flag TEMPLATE_PAD_WINDOW_CODE_LABELLED,
    a STRICT SUBSET of the parent). The 08-09 sign-off scoped the slice to label-less boxes because
    "a labelled box is served by _inline_code_reconcile" — WRONG: on the Larkspur purchase_order
    template the reconcile's page-wide locate picks a FOOTER prose line over the true caption (the
    caption OCRs 'Order'->'Orden' = 0.75 vs the sentence's 0.875 partial credit), so it declines on
    7 of 8 docs and the clipped read commits at the LABELLED tier — 90, no note, a SILENT WRONG
    AUTO-FILE. This scope is auto-fileable, hence the extra conditions pinned below.

THE SEAM THIS PINS:
  • SWAP (adopt padded, NO note) only on STRICT SUFFIX containment + overlap floor + margin +
    TWO-SIDED consent (padded consented AND the tight read NOT positively consented) + no label-tail
    glue. Consent STRENGTH tiers the result: 'confirmed' keeps the full tier, 'provisional' caps
    below the 88 auto-file floor.
  • FLAG (keep committed, cap<=70 + note) on any other confident disagreement.
  • ABSTAIN (byte-identical no-op) on: an already-noted result, prefix-containment, weak margin,
    empty tight, OFF, non-code type.
  • SCOPE (caller-side): the labelled box is admitted ONLY on the pure absolute read and ONLY when
    the inline reconcile never formed an opinion — see the _extract_one pins at the end.

Run: py -3.12 python_backend/tests/test_template_pad_window_code.py
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import template_mapper as tm
from extraction import format_anomaly_checker as fac

VP = {"reference_code": json.loads((Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json")
                                   .read_text(encoding="utf-8"))["validation_patterns"]["reference_code"]}
_BOX = {"x_norm": 0.8, "y_norm": 0.13, "w_norm": 0.08, "h_norm": 0.015}
_REAL_SHAPE_CONSENTS = tm._shape_consents      # kept so the vacuous pins can use the REAL ladder

fails = 0
def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond: fails += 1

def run(committed, pad, *, pad_conf=95, tight_conf=70, consent="provisional",
        tight_consent="none", note=None, flag_on=True, val_type="alphanumeric",
        field_key="po_number", full_confidence=False, anchor_text=None,
        format_entry=None):
    """Drive _maybe_pad_code with a STUBBED padded read + a VALUE-DISCRIMINATING consent ladder.

    C6 (Oracle): the old stub was `lambda fk, v: True` — value-BLIND. Under the two-sided rule the
    committed value would also consent and every SWAP pin would silently flip to FLAG. The consent
    stub MUST distinguish the padded value from the committed one.

    `format_entry` bypasses the stub entirely and drives the REAL _shape_consents -> check_value
    path, so the vacuous-consent pins exercise the actual mechanism rather than a mock of it."""
    tm._PAD_WINDOW_CODE_ON = flag_on
    tm._read_pad_window_code = (lambda page, box, vp: (pad, pad_conf)) if pad is not None else (lambda *a: None)
    if format_entry is not None:
        # REAL ladder: _shape_consents -> check_value, so the vacuous-consent pins test the mechanism.
        tm._shape_consents = _REAL_SHAPE_CONSENTS
        fmt, prov = (lambda fk: format_entry), None
    else:
        # A learned entry is per-FIELD, so format_lookup cannot answer differently for the two values.
        # Stub the ladder itself with a value->verdict map (C6: must be value-DISCRIMINATING).
        verdict = {pad: consent, committed: tight_consent}
        tm._shape_consents = lambda value, fk, fl, pl: verdict.get(value, "none")
        fmt, prov = None, None
    res = {"value": committed, "confidence": 90 if full_confidence else 78,
           "method": "template_mapping"}
    if note: res["validation_note"] = note
    return tm._maybe_pad_code(object(), _BOX, val_type, res, tight_conf,
                              full_confidence, field_key, False, field_key, VP, fmt, prov,
                              anchor_text=anchor_text)

# ── SWAP: consented strict-suffix clipped-prefix recovery (LABEL-LESS scope) ────────────────────
r = run("40351", "PO-40351", consent="provisional")
check("SWAP: consented '40351' <- padded 'PO-40351' adopts the fuller code",
      r.get("value") == "PO-40351")
check("SWAP: no review note (auto-fileable tier, not a flag)", r.get("validation_note") is None)
check("SWAP: method tagged _padunclip", str(r.get("method", "")).endswith("_padunclip"))
check("SWAP: breadcrumb records the clipped read", r.get("pad_unclipped_from") == "40351")
check("SWAP: breadcrumb records the consent tier (gate (b) swap census)",
      r.get("pad_consent") == "provisional")

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

# ── EMPTY tight → no-op (Oracle C1 2026-08-09 — the keyword/relocate path owns it) ──────────────
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
check("LABELLED sub-flag defaults OFF at import",
      os.environ.get("TEMPLATE_PAD_WINDOW_CODE_LABELLED") in (None, "0"))

# ══ TIER PINS — the honest ceiling is SCOPE-SPECIFIC, not a global property ═════════════════════
r = run("40351", "PO-40351", consent="confirmed", full_confidence=False)
check("TIER: label-less clean swap is 78 (< the 88 critical floor — review-bound, honest ceiling)",
      r.get("confidence") == 78)
r = run("-48009", "PO-48009", consent="confirmed", full_confidence=True, anchor_text="Order No.")
check("TIER: a LABELLED confirmed swap takes the full 90 tier (auto-fileable — the accepted risk)",
      r.get("value") == "PO-48009" and r.get("confidence") == 90
      and r.get("validation_note") is None and r.get("pad_consent") == "confirmed")

# ── C3: PROVISIONAL consent swaps the VALUE but may not auto-file ───────────────────────────────
r = run("-48009", "PO-48009", consent="provisional", full_confidence=True, anchor_text="Order No.")
check("C3: a LABELLED PROVISIONAL swap adopts the value but caps BELOW the 88 auto-file floor",
      r.get("value") == "PO-48009" and r.get("confidence") < 88
      and r.get("confidence") == tm._PAD_CODE_PROVISIONAL_CAP)
check("C3: the provisional cap is genuinely under the critical floor (cold-start channel closed)",
      tm._PAD_CODE_PROVISIONAL_CAP < 88)

# ── C5: TWO-SIDED CONSENT — a tight read the history ACCEPTS is not a clip ──────────────────────
r = run("PO-48009", "PO-2024-48009", consent="confirmed", tight_consent="confirmed",
        full_confidence=True, anchor_text="Order No.")
check("C5: padded consented BUT tight ALSO consented -> no swap, FLAG instead",
      r.get("value") == "PO-48009" and str(r.get("method")).endswith("_padcodeflag"))

# ── C5 cold start: no confirmed history at all -> tight is 'none', so a swap is still reachable ─
r = run("40351", "PO-40351", consent="provisional", tight_consent="none")
check("C5: COLD START still heals (tight 'none' is not positive consent, so the swap survives)",
      r.get("value") == "PO-40351")

# ── C5 VACUOUS CONSENT (the real reason the two-sided rule exists) — REAL check_value path ──────
# `check_value` returns "accepted" for a FREETEXT class and for an entry whose shape set is empty.
# Under such a history BOTH sides consent, so a one-sided rule would have swapped freely.
r = run("PO-48009", "No.PO-48009", full_confidence=True, anchor_text="Order No.",
        format_entry={"class": fac.FREETEXT})
check("C5 VACUOUS: a FREETEXT learned entry consents to EVERYTHING -> two-sided rule blocks the swap",
      r.get("value") == "PO-48009" and str(r.get("method")).endswith("_padcodeflag"))
r = run("PO-48009", "PO-2024-48009", full_confidence=True, anchor_text="Order No.",
        format_entry={"class": fac.ALPHANUM_SEP, "separators": frozenset("-"), "shapes": set()})
check("C5 VACUOUS: an EMPTY learned shape set consents to everything -> blocked the same way",
      r.get("value") == "PO-48009" and str(r.get("method")).endswith("_padcodeflag"))

# ── C4: label-tail GLUE never clean-swaps, even when the glued shape is consented ───────────────
r = run("PO-48009", "No.PO-48009", consent="confirmed", tight_consent="none",
        full_confidence=True, anchor_text="Order No.")
check("C4: 'No.PO-48009' begins with the tail of 'Order No.' -> rejected as glue, FLAG not swap",
      r.get("value") == "PO-48009" and str(r.get("method")).endswith("_padcodeflag"))
check("C4 helper: 'nopo48009' is glue for 'Order No.'", tm._pad_label_glued("nopo48009", "Order No."))
check("C4 helper: a clean 'po48009' is NOT glue (the real recovery must survive)",
      not tm._pad_label_glued("po48009", "Order No."))
check("C4 helper: no anchor text -> never glue (label-less scope unaffected)",
      not tm._pad_label_glued("po48009", None))

# ══ SCOPE PINS (caller side, _extract_one) — behavioural, NOT source inspection ═════════════════
# The 2026-08-05 lesson: a pin that inspects source text can go dead silently. These drive the real
# function and count calls.
_ANCHOR = {"x_norm": 0.71, "y_norm": 0.140, "w_norm": 0.079, "h_norm": 0.0098}
_TARGET = {"x_norm": 0.806, "y_norm": 0.1376, "w_norm": 0.083, "h_norm": 0.0150}

def _mapping(labelled=True):
    m = {"field_key": "po_number", "target_x_norm": _TARGET["x_norm"], "target_y_norm": _TARGET["y_norm"],
         "target_w_norm": _TARGET["w_norm"], "target_h_norm": _TARGET["h_norm"],
         "anchor_x_norm": _ANCHOR["x_norm"], "anchor_y_norm": _ANCHOR["y_norm"],
         "anchor_w_norm": _ANCHOR["w_norm"], "anchor_h_norm": _ANCHOR["h_norm"],
         "search_expansion": 0.0}
    if labelled:
        m["anchor_text"] = "Order No."
    return m

def drive(*, labelled=True, labelled_on=True, witness=False, clipped="-48009",
          pad=("PO-48009", 95), icr_result=None):
    """Run _extract_one over a stubbed page. Returns (result, pad_reader_call_count)."""
    calls = {"pad": 0}
    tm._PAD_WINDOW_CODE_ON = True
    tm._PAD_CODE_LABELLED_ON = labelled_on
    tm._ABS_EDGE_GUARD_ON = False          # keep the abs rung pure for these pins
    tm._INLINE_CODE_RECONCILE_ON = True

    def _pad_reader(page, box, vp):
        calls["pad"] += 1
        return pad
    tm._read_pad_window_code = _pad_reader

    def _icr(*a, **kw):
        if witness and kw.get("meta") is not None:
            kw["meta"]["witness"] = True
        return icr_result
    tm._inline_code_reconcile = _icr
    tm._crop_and_ocr = lambda page, box, vt, fn, capture=None, meta=None: clipped
    tm._gate_value = lambda text, vt, fk, vp, fl, shape_mode=None, ocr_conf=None: (text, False, False)
    tm._shape_consents = lambda value, fk, fl, pl: ("confirmed" if value == pad[0] else "none")
    res = tm._extract_one(object(), _mapping(labelled), {"po_number": {"validation": "alphanumeric"}},
                          lambda crop: [], lambda *a, **kw: clipped,
                          located=None, validation_patterns=VP)
    return res, calls["pad"]

_orig = {k: getattr(tm, k) for k in
         ("_read_pad_window_code", "_inline_code_reconcile", "_crop_and_ocr", "_gate_value",
          "_shape_consents", "_PAD_WINDOW_CODE_ON", "_PAD_CODE_LABELLED_ON", "_ABS_EDGE_GUARD_ON",
          "_INLINE_CODE_RECONCILE_ON")}
try:
    # ANTI-RESTORE PIN: the labelled box must reach the pad backstop — AND only after the reconcile
    # has been consulted. Goes red the moment someone restores `if not mapping.get("anchor_text")`.
    res, n = drive(labelled=True, labelled_on=True, witness=False)
    check("ANTI-RESTORE: a LABELLED box reaches the pad backstop and swaps ('-48009' -> 'PO-48009')",
          res and res.get("value") == "PO-48009" and n == 1)

    # C1: the reconcile FORMED an opinion (located + read a value) and still kept the rigid read.
    # That is an arbitration by a stronger independent witness — the pad must not even LOOK.
    res, n = drive(labelled=True, labelled_on=True, witness=True)
    check("C1: an inline-reconcile WITNESS suppresses the pad entirely (no swap, no flag, 0 reads)",
          res and res.get("value") == "-48009" and res.get("validation_note") is None and n == 0)

    # Sub-flag OFF -> the labelled box is byte-identical to today.
    res, n = drive(labelled=True, labelled_on=False)
    check("SUB-FLAG: LABELLED off leaves a labelled box byte-identical (0 pad reads)",
          res and res.get("value") == "-48009" and n == 0)

    # The label-less scope must NOT depend on the sub-flag (it was signed off separately).
    res, n = drive(labelled=False, labelled_on=False)
    check("SUBSET: a LABEL-LESS box still pads with the sub-flag off (parent flag owns it)",
          res and res.get("value") == "PO-48009" and n == 1)
finally:
    for k, v in _orig.items():
        setattr(tm, k, v)

check("SUBSET: the labelled sub-flag can never arm without the parent",
      not (tm._PAD_CODE_LABELLED_ON and not tm._PAD_WINDOW_CODE_ON))

print()
print(f"{fails} FAILED" if fails else "All PAD-WINDOW CODE pins passed")
sys.exit(1 if fails else 0)
