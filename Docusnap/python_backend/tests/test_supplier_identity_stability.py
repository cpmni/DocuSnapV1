#!/usr/bin/env python3
"""
tests/test_supplier_identity_stability.py
------------------------------------------
Direct unit test: re-running extraction on the SAME document must always
resolve to the SAME supplier identity.

Context: the live processing.log + database showed the identical physical
file (e.g. "...___002.pdf") persisted THREE DIFFERENT supplier_name values
across three successive reimports of the same folder — proof that the
pipeline's notion of "who is this" was not deterministic run-to-run. The
root cause was engine.py freezing `supplier_name` at whatever Stage 0
(template/logo) guessed first, then never re-syncing it to the value Stage 2
(anchor) subsequently resolved in results['supplier_name'] — so the final
answer depended on incidental per-run variance rather than on the most
reliable available signal.

This test reuses fixtures/07_supplier_identity_resync.json — which sets up
exactly that Stage 0 vs Stage 2 divergence — and runs ExtractionEngine.extract()
on it twice with byte-identical inputs. Both runs must:
  (a) resolve _supplier_name to the SAME value, and
  (b) resolve it to the anchor-derived value (the one the user actually sees
      and confirms), not the earlier template guess.

(a) alone would pass for a pipeline that consistently picks the WRONG value
on every run — that's still a bug, just a stable one. (b) is what proves the
resolution is anchored to the most-reliable signal rather than to whichever
stage happens to run first, which is what makes the result reproducible for
any future supplier/template, not just this fixture's exact data.

Usage:
    py -3.12 python_backend/tests/test_supplier_identity_stability.py

Exit code 0 = identity resolution is stable and correct. Exit code 1 = regression.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine  # noqa: E402

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "07_supplier_identity_resync.json"
EXPECTED_SUPPLIER = "Greenfield Logistics Ltd"   # the anchor-derived, user-visible value


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def run_once(fixture: dict) -> dict:
    engine = ExtractionEngine(mode=fixture.get("mode", "smart"), emit_fn=lambda *_a: None)
    return engine.extract(
        ocr_text      = fixture["ocr_text"],
        page_images   = [],
        filename      = f"{fixture.get('name', 'fixture')}.pdf",
        field_defs    = fixture.get("field_defs", []),
        hints         = fixture.get("hints", []),
        anchors       = fixture.get("anchors", []),
        logos         = fixture.get("logos", []),
        templates     = fixture.get("templates", []),
        document_type = fixture.get("document_type"),
        document_slug = fixture.get("document_slug"),
        supplier_name = fixture.get("supplier_name"),
    )


def main():
    failures = 0

    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    # Run extraction twice on identical input — simulates reimporting the
    # same folder/file a second time, exactly as the live regression did.
    result_a = run_once(fixture)
    result_b = run_once(fixture)

    sup_a = result_a.get("_supplier_name")
    sup_b = result_b.get("_supplier_name")
    field_a = (result_a.get("supplier_name") or {}).get("value")
    field_b = (result_b.get("supplier_name") or {}).get("value")

    print(f"Run 1: _supplier_name={sup_a!r}  field.supplier_name={field_a!r}")
    print(f"Run 2: _supplier_name={sup_b!r}  field.supplier_name={field_b!r}")

    if not check("_supplier_name identical across both runs", sup_a == sup_b):
        failures += 1
    if not check("field supplier_name.value identical across both runs", field_a == field_b):
        failures += 1
    if not check(f"_supplier_name resolves to the anchor-derived value ({EXPECTED_SUPPLIER!r}), "
                 f"not the earlier template guess", sup_a == EXPECTED_SUPPLIER):
        failures += 1
    if not check("_supplier_name matches the displayed/confirmed field value (no drift)",
                 sup_a == field_a):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — supplier identity resolution is unstable or drifted.")
        return 1
    print("All checks passed — supplier identity resolves identically and correctly across runs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
