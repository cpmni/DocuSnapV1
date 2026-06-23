#!/usr/bin/env python3
"""
tests/test_reprocess_manifest.py
--------------------------------
process_docs.doc_overrides — per-document overrides for batched Reprocess All.
Each batched doc keeps its OWN template/doc-slug/enhance (accuracy guarantee);
when there's no manifest entry the global args apply (single-doc reprocess and
folder import are byte-identical).

    py -3.12 python_backend/tests/test_reprocess_manifest.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from process_docs import doc_overrides  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


print("doc_overrides:")
# No manifest -> globals (byte-identical to today)
e, k, s = doc_overrides({}, "a.pdf", enhance={"x": 1}, known_template_id=5, known_doc_slug="invoice")
check("no manifest -> global enhance", e == {"x": 1})
check("no manifest -> global template id", k == 5)
check("no manifest -> global slug", s == "invoice")

# Manifest entry overrides per-doc
man = {"a.pdf": {"known_template_id": 9, "known_doc_slug": "sales_order", "enhance_params": {"y": 2}}}
e, k, s = doc_overrides(man, "a.pdf", enhance=None, known_template_id=None, known_doc_slug=None)
check("manifest enhance wins", e == {"y": 2})
check("manifest template id wins", k == 9)
check("manifest slug wins", s == "sales_order")

# A file NOT in the manifest falls back to globals
e, k, s = doc_overrides(man, "b.pdf", enhance=None, known_template_id=7, known_doc_slug="invoice")
check("absent file -> global template id", k == 7)
check("absent file -> global slug", s == "invoice")

# An explicit null enhance in the manifest is respected (don't fall back)
man2 = {"a.pdf": {"enhance_params": None, "known_template_id": 3}}
e, k, s = doc_overrides(man2, "a.pdf", enhance={"g": 1}, known_template_id=None, known_doc_slug=None)
check("explicit manifest enhance None respected", e is None)
check("template id alongside None enhance", k == 3)
check("missing slug in entry -> global (None)", s is None)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
