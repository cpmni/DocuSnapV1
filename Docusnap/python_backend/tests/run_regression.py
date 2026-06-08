#!/usr/bin/env python3
"""
tests/run_regression.py
-----------------------
Minimal regression harness for the extraction pipeline (keyword/anchor/
hint/validation matching — the layer behind the recent anchoring bugs).

Each fixture in tests/fixtures/*.json supplies synthetic OCR text plus the
schema/learning data (field_defs, hints, anchors, templates) the engine
needs, and an `expected` block of field_key -> value (or `_metadata_key`
-> value). The runner feeds the fixture straight into
ExtractionEngine.extract() and diffs the result against `expected`.

Why bypass OCR/PDF rendering entirely:
  The bug class this guards against — collision-prone supplier matching,
  column-bleed parsing, stale-hint contamination of per-document fields,
  layout-drift handling — lives in the TEXT-matching/anchoring/learning
  layer, not in OCR accuracy. Synthetic OCR text makes fixtures
  deterministic and dependency-free (no Tesseract install/version pinning
  needed to run regressions) while still exercising the real matching code.
  engine.extract() already tolerates page_images=[] — every image-dependent
  stage (logo hash, template image-match, anchor crop+OCR) is None-guarded —
  so no test-only seam was added to engine.py for this harness.

Usage:
    py -3.12 python_backend/tests/run_regression.py

Exit code 0 = every fixture's expectations matched. Exit code 1 = at least
one field regressed — the printed diff shows fixture, field, expected, actual.
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import ExtractionEngine  # noqa: E402

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def run_fixture(path: Path):
    fixture = json.loads(path.read_text(encoding="utf-8"))
    name    = fixture.get("name", path.stem)

    engine = ExtractionEngine(mode=fixture.get("mode", "smart"), emit_fn=lambda *_a: None)
    result = engine.extract(
        ocr_text      = fixture["ocr_text"],
        page_images   = [],          # no images — forces text-based code paths
        filename      = f"{name}.pdf",
        field_defs    = fixture.get("field_defs", []),
        hints         = fixture.get("hints", []),
        anchors       = fixture.get("anchors", []),
        logos         = fixture.get("logos", []),
        templates     = fixture.get("templates", []),
        document_type = fixture.get("document_type"),
        document_slug = fixture.get("document_slug"),
        supplier_name = fixture.get("supplier_name"),
    )

    checks = []
    for key, expected_val in fixture.get("expected", {}).items():
        actual = result.get(key) if key.startswith("_") else (result.get(key) or {}).get("value")
        checks.append((key, actual == expected_val, expected_val, actual))
    return name, fixture.get("description", ""), checks


def main():
    fixtures = sorted(FIXTURES_DIR.glob("*.json"))
    if not fixtures:
        print(f"No fixtures found in {FIXTURES_DIR}")
        return 1

    total, failed, any_fixture_failed = 0, 0, False

    for path in fixtures:
        name, description, checks = run_fixture(path)
        bad = [c for c in checks if not c[1]]
        print(f"[{'PASS' if not bad else 'FAIL'}] {name}")
        if description:
            print(f"       {description}")
        for key, ok, expected, actual in checks:
            total += 1
            mark = "OK " if ok else "BAD"
            print(f"       {mark} {key}: expected {expected!r}, got {actual!r}")
            if not ok:
                failed += 1
        if bad:
            any_fixture_failed = True
        print()

    print(f"{total - failed}/{total} field checks passed across {len(fixtures)} fixtures")
    return 1 if any_fixture_failed else 0


if __name__ == "__main__":
    sys.exit(main())
