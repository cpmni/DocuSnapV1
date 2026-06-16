"""
Regression: the learned-format qualification gate must work for DOCUMENT-AGNOSTIC
(supplier-empty) learning.

getFieldFormats emits doc-type-scoped groups keyed ('', doc_type, field). A guard
in build_format_class_index used to reject every empty-supplier entry, so those
groups never entered the index and _make_format_lookup's ('', d, fk) fallback
always missed — the gate was silently OFF for any supplier-independent setup, and
a drifted/clipped scan's wrong-row crop ("nl Sa rt phn…", "ae") committed instead
of being rejected + relocated. These tests lock the fix and document the remaining
fail-open (null lookup) the slug-resolution work addresses separately.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import anchor, format_anomaly_checker as fac


def _num_formats_data():
    samples = ["2604-0511-1", "2605-0849-1", "2605-0815-1", "2002-0705-1"]
    return [{
        "supplier_name": "",            # doc-type-scoped (document-agnostic)
        "document_type": "worksheet",
        "field_key": "num",
        "sample_values": samples,
        "value_counts": {v: 1 for v in samples},
        "confirmed_count": len(samples),
    }]


def test_doctype_scoped_entry_is_indexed():
    idx = fac.build_format_class_index(_num_formats_data())
    assert ("", "worksheet", "num") in idx, \
        "empty-supplier doc-type-scoped format must enter the index"
    assert idx[("", "worksheet", "num")]["class"] != "freetext"


def test_supplier_scoped_entry_still_indexed():
    data = _num_formats_data()
    data[0]["supplier_name"] = "Acme"
    idx = fac.build_format_class_index(data)
    assert ("acme", "worksheet", "num") in idx, "supplier-scoped entries still indexed"


def test_gate_rejects_garbage_when_doctype_format_present():
    idx = fac.build_format_class_index(_num_formats_data())
    lookup = lambda fk: idx.get(("", "worksheet", fk))   # mimics _make_format_lookup('', 'worksheet')
    # The clipped-scan garbage must be REJECTED (None) now that the gate is live.
    assert anchor._qualify_against_format("nl Sa rt phn meni n cn", "num", lookup) is None
    assert anchor._qualify_against_format("ae", "num", lookup) is None
    # A correctly-shaped value passes unchanged.
    assert anchor._qualify_against_format("2604-0511-1", "num", lookup) == "2604-0511-1"


def test_null_lookup_is_documented_fail_open():
    # When the slug is unresolved the lookup is None and qualification cannot run,
    # so the value passes through unchanged. This is the fail-open the slug fix
    # (honour assigned doc-type on reprocess + template fallback) closes upstream.
    assert anchor._qualify_against_format("nl Sa rt phn", "num", None) == "nl Sa rt phn"


if __name__ == "__main__":
    test_doctype_scoped_entry_is_indexed()
    test_supplier_scoped_entry_still_indexed()
    test_gate_rejects_garbage_when_doctype_format_present()
    test_null_lookup_is_documented_fail_open()
    print("All doc-type-scoped format-gate checks passed")
