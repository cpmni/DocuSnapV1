"""Pins for the REF-ROLE confusable flag (Chris Card 1, 2026-09-11; mig 159 ref_confusable_flag, DARK).

Each ON assertion is proven to FAIL with the guard removed (env OFF == the pre-fix behaviour): case 1 ON
flags, case 2 OFF is byte-identical. C1 disarm is pinned length-AGNOSTICally (case 6 — the case the
length-blind _confusion_from_attested would get wrong); a letter-only-attested scope still flags (case 7).
C3 born-digital never flags (case 8). Run: py -3.12 tests/test_ref_confusable_flag.py
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


def _run(env_on, value, *, method="keyword", conf=88, note=None, fci=None,
         prov=("ocr",), labels=("Sales Order No",)):
    if env_on:
        os.environ["REF_CONFUSABLE_FLAG"] = "1"
    else:
        os.environ.pop("REF_CONFUSABLE_FLAG", None)
    data = {"value": value, "confidence": conf, "method": method}
    if note is not None:
        data["validation_note"] = note
    results = {"sales_order_number": data}
    _FLAG(_Stub(fci=fci, labels=labels), results,
          [{"key": "sales_order_number", "type": "text"}],
          "Vellum & Crane", "sales_order", "sales_order_number", list(prov))
    return results["sales_order_number"]


def _noted(d):
    return bool(str(d.get("validation_note") or "").strip())


def test_1_on_flags_s0():
    d = _run(True, "S0-47966")
    assert _noted(d) and d["confidence"] <= 69, d


def test_2_off_byte_identical():
    d = _run(False, "S0-47966")
    assert not _noted(d) and d["confidence"] == 88, d


def test_3_legit_all_digit_no_flag():
    d = _run(True, "0047966")
    assert not _noted(d) and d["confidence"] == 88, d


def test_4_human_literal_exempt():
    d = _run(True, "S0-47966", method="template_fixed")
    assert not _noted(d) and d["confidence"] == 88, d


def test_5_one_note_per_field():
    d = _run(True, "S0-47966", note="already noted")
    assert d["validation_note"] == "already noted", d


def test_6_disarm_length_agnostic():
    # A confirmed sibling of a DIFFERENT length shares the head 'S0' -> disarm (the case the
    # same-total-length _confusion_from_attested would get WRONG).
    fci = {FCI_KEY: {"value_counts": {"S0-9": 2}}}
    d = _run(True, "S0-47966", fci=fci)
    assert not _noted(d) and d["confidence"] == 88, d


def test_7_letter_only_history_still_flags():
    # History attests only the LETTER form 'SO' -> head 'S0' not shared -> still flags.
    fci = {FCI_KEY: {"value_counts": {"SO-12345": 3, "SO-99887": 2}}}
    d = _run(True, "S0-47966", fci=fci)
    assert _noted(d) and d["confidence"] <= 69, d


def test_8_born_digital_never_flags():
    d = _run(True, "S0-47966", prov=("digital",))
    assert not _noted(d) and d["confidence"] == 88, d


def test_9_rule_a_interior():
    d = _run(True, "1O02003")   # letter O interior in a digit run
    assert _noted(d) and d["confidence"] <= 69, d


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
