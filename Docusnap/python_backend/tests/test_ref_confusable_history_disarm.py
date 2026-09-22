"""Pins for D1 — REF_CONFUSABLE_HISTORY_DISARM (mig 201, 2026-09-22; gary+reggie -> Oracle SIGN-OFF-W/COND).

A Rule-A PREFIX glyph (a stable letter in a mixed alpha/digit head with a pure-digit body, e.g. the 'S' of
'W2S8745899') disarms the ref-confusable flag on the sender's CONFIRMED HEAD convention (length-agnostic) —
the case the length-EXACT Rule-A attestation gets wrong for a variable-length numeric body. These cases are
the EFFICACY proof (the corpus can't build a variable-length mixed-prefix repeat sender) and each is proven
to FAIL with the guard removed: the poison guard (case 5) and the rival check (case 4) keep a genuine 5<->S
slip held. Run: py -3.12 tests/test_ref_confusable_history_disarm.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction.engine import ExtractionEngine

FCI_KEY = ("vellum & crane", "sales_order", "sales_order_number")
_FLAG = ExtractionEngine._flag_ref_confusable_ambiguous


class _Stub:
    def __init__(self, fci=None, labels=("Sales Order No",)):
        self.patterns = {"field_patterns": {"sales_order_number": {"labels": list(labels)}}}
        self.prefix_index = {}
        self.format_class_index = fci or {}
        self._trace = False

    def log(self, *a, **k):
        pass

    def _t(self, *a, **k):
        pass


def _run(disarm_on, value, *, fci=None, conf=88):
    os.environ["REF_CONFUSABLE_FLAG"] = "1"                 # HARD dep — the base flag must be on
    if disarm_on:
        os.environ["REF_CONFUSABLE_HISTORY_DISARM"] = "1"
    else:
        os.environ.pop("REF_CONFUSABLE_HISTORY_DISARM", None)
    data = {"value": value, "confidence": conf, "method": "keyword"}
    results = {"sales_order_number": data}
    _FLAG(_Stub(fci=fci), results, [{"key": "sales_order_number", "type": "text"}],
          "Vellum & Crane", "sales_order", "sales_order_number", ["ocr"])
    return results["sales_order_number"]


def _noted(d):
    return bool(str(d.get("validation_note") or "").strip())


# varying-length W2S… heads (NO length-10 sibling — the exact case _confusion_from_attested can't disarm)
VARY   = {FCI_KEY: {"value_counts": {"W2S874589": 3, "W2S87458999": 2}}}
RIVAL  = {FCI_KEY: {"value_counts": {"W2587": 3}}}               # only the digit-head form confirmed
POISON = {FCI_KEY: {"value_counts": {"W2S8888": 2, "W258888": 2}}}  # BOTH head forms confirmed
HEAD   = {FCI_KEY: {"value_counts": {"W2S123": 2}}}


def test_1_varying_length_head_disarms_on():
    d = _run(True, "W2S8745899", fci=VARY)
    assert not _noted(d) and d["confidence"] == 88, d


def test_2_off_byte_identical_still_fires():
    # D1 off -> the length-EXACT attestation never matches a variable-length W2S… series -> still flags.
    d = _run(False, "W2S8745899", fci=VARY)
    assert _noted(d) and d["confidence"] <= 69, d


def test_3_interior_no_head_still_fires():
    # A per-doc-number interior outlier ('123S456') has no confirmed head-sharing series -> stays flagged
    # (the PINNED TRADE-OFF: D1 must not over-reach into genuine interior outliers).
    fci = {FCI_KEY: {"value_counts": {"12340678": 2, "12341678": 2}}}
    d = _run(True, "123S456", fci=fci)
    assert _noted(d) and d["confidence"] <= 69, d


def test_4_rival_only_history_still_fires():
    # The sender's confirmed convention is the DIGIT head (W25…); a read of W2S… is a genuine 5->S slip.
    d = _run(True, "W2S8745899", fci=RIVAL)
    assert _noted(d) and d["confidence"] <= 69, d


def test_5_poison_both_forms_still_fires():
    # LOAD-BEARING poison guard: both W2S… and W25… confirmed -> genuinely ambiguous -> stay flagged.
    d = _run(True, "W2S8745899", fci=POISON)
    assert _noted(d) and d["confidence"] <= 69, d


def test_6_head_confirmed_new_body_disarms():
    # Disarm keys on the HEAD glyph, not the (per-doc-unique) body.
    d = _run(True, "W2S9999999", fci=HEAD)
    assert not _noted(d) and d["confidence"] == 88, d


def test_7_token_relative_head_no_cross_token():
    # Multi-token value: the head is the hit TOKEN's 'W2S', never a cross-token 'AB12 W2S' -> disarms on W2S.
    d = _run(True, "AB12 W2S8745899", fci=HEAD)
    assert not _noted(d) and d["confidence"] == 88, d


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    fails = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS {fn.__name__}")
        except AssertionError as e:
            fails += 1
            print(f"  FAIL {fn.__name__}: {e}")
        except Exception as e:
            fails += 1
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - fails}/{len(fns)} passed")
    sys.exit(1 if fails else 0)
