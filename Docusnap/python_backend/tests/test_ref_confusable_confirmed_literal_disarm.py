"""Pins for (b) — REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM (mig 204, 2026-09-22; gary+reggie -> Oracle
SIGN-OFF-W/COND, count-gated).

The ref-confusable flag can't see a 1-confirmed sender's exact literal: format_anomaly_checker.build_format_class_index
drops any scope with <3 DISTINCT confirmed values, so `confirmed_counts_index` / `format_class_index` are EMPTY for a
near-constant-ref sender (the owner's Print Tracker case: one prior identical confirmed value). The disarm reads a
SEPARATE index, `confirmed_literal_index`, built from the FULL formats_data (provisional included), so the literal IS
visible. Oracle C3 count-gate: >=2 confirms of the exact string -> full disarm; a SINGLE confirm -> drop the NAG but
KEEP the hold (cap <=69, no note). SUPPLIER-STRICT. Byte-identical OFF.

Run: py -3.12 tests/test_ref_confusable_confirmed_literal_disarm.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from extraction.engine import ExtractionEngine, _cmp_norm

SCOPE = ("vellum & crane", "sales_order", "sales_order_number")
_FLAG = ExtractionEngine._flag_ref_confusable_ambiguous
# A value the BASE flag fires on (proven by test_ref_confusable_history_disarm.test_2: W2S… with a
# varying-length confirmed series flags when no disarm is active). VARY keeps the length-exact
# attestation from disarming, so the ONLY thing that can disarm here is the (b) confirmed-literal path.
VAL = "W2S8745899"
VARY_FCI = {SCOPE: {"value_counts": {"W2S874589": 3, "W2S87458999": 2}}}


class _Stub:
    def __init__(self, cli=None, fci=None):
        self.patterns = {"field_patterns": {"sales_order_number": {"labels": ["Sales Order No"]}}}
        self.prefix_index = {}
        self.format_class_index = fci or {}
        self.confirmed_literal_index = cli or {}
        self._trace = False

    def log(self, *a, **k):
        pass

    def _t(self, *a, **k):
        pass


def _run(env_on, value, *, cli=None, fci=None, conf=88, supplier="Vellum & Crane"):
    os.environ["REF_CONFUSABLE_FLAG"] = "1"                       # HARD dep — base flag on
    os.environ.pop("REF_CONFUSABLE_HISTORY_DISARM", None)         # keep D1 out of the way
    if env_on:
        os.environ["REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM"] = "1"
    else:
        os.environ.pop("REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM", None)
    data = {"value": value, "confidence": conf, "method": "keyword"}
    results = {"sales_order_number": data}
    _FLAG(_Stub(cli=cli, fci=fci or VARY_FCI), results,
          [{"key": "sales_order_number", "type": "text"}],
          supplier, "sales_order", "sales_order_number", ["ocr"])
    return results["sales_order_number"]


def _noted(d):
    return bool(str(d.get("validation_note") or "").strip())


def _cli(count, value=VAL, scope=SCOPE):
    return {scope: {_cmp_norm(value): count}}


def test_1_two_confirms_full_disarm():
    d = _run(True, VAL, cli=_cli(2))
    assert not _noted(d) and d["confidence"] == 88, d


def test_2_one_confirm_soft_hold_no_note_capped():
    # C3: a SINGLE confirm drops the nag but the field is still HELD (cap <=69, no note).
    d = _run(True, VAL, cli=_cli(1))
    assert not _noted(d) and d["confidence"] == 69, d


def test_3_off_byte_identical_still_flags():
    # Env OFF: the confirmed_literal_index is ignored -> the base flag fires as before.
    d = _run(False, VAL, cli=_cli(2))
    assert _noted(d) and d["confidence"] <= 69, d


def test_4_exact_only_different_literal_still_flags():
    # The scope has confirmed a DIFFERENT value; this read is not it -> no disarm -> flags.
    d = _run(True, VAL, cli=_cli(2, value="W2S000111"))
    assert _noted(d) and d["confidence"] <= 69, d


def test_5_supplier_strict_other_scope_still_flags():
    # The literal is confirmed under ANOTHER supplier; this supplier's scope has none -> flags.
    other = ("brightwater ltd", "sales_order", "sales_order_number")
    d = _run(True, VAL, cli=_cli(2, scope=other))
    assert _noted(d) and d["confidence"] <= 69, d


def test_6_index_built_from_provisional_scope():
    # set_formats builds confirmed_literal_index from the FULL formats_data (provisional/<3-distinct included),
    # unlike confirmed_counts_index (built from `_solid`) — so a 1-confirm sender's literal is visible.
    stub = _Stub()
    entry = {
        "supplier_name": "Vellum & Crane", "document_type": "sales_order",
        "field_key": "sales_order_number", "provisional": True,
        "value_counts": {VAL: 1},
    }
    ExtractionEngine.set_formats(stub, [entry])
    assert stub.confirmed_literal_index.get(SCOPE, {}).get(_cmp_norm(VAL), 0) == 1, stub.confirmed_literal_index
    # and the provisional scope did NOT leak into the >=3-distinct format class index
    assert SCOPE not in stub.format_class_index, stub.format_class_index


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
