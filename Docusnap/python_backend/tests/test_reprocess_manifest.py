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
# doc_overrides returns a 4-tuple: (enhance, known_template_id, known_doc_slug, cached_text).
# No manifest -> globals (byte-identical to today)
e, k, s, ct = doc_overrides({}, "a.pdf", enhance={"x": 1}, known_template_id=5, known_doc_slug="invoice")
check("no manifest -> global enhance", e == {"x": 1})
check("no manifest -> global template id", k == 5)
check("no manifest -> global slug", s == "invoice")
check("no manifest -> cached_text None (no global cache)", ct is None)

# Manifest entry overrides per-doc
man = {"a.pdf": {"known_template_id": 9, "known_doc_slug": "sales_order", "enhance_params": {"y": 2}}}
e, k, s, ct = doc_overrides(man, "a.pdf", enhance=None, known_template_id=None, known_doc_slug=None)
check("manifest enhance wins", e == {"y": 2})
check("manifest template id wins", k == 9)
check("manifest slug wins", s == "sales_order")
check("entry without ocr_text -> cached_text None", ct is None)

# A file NOT in the manifest falls back to globals
e, k, s, ct = doc_overrides(man, "b.pdf", enhance=None, known_template_id=7, known_doc_slug="invoice")
check("absent file -> global template id", k == 7)
check("absent file -> global slug", s == "invoice")

# An explicit null enhance in the manifest is respected (don't fall back)
man2 = {"a.pdf": {"enhance_params": None, "known_template_id": 3}}
e, k, s, ct = doc_overrides(man2, "a.pdf", enhance={"g": 1}, known_template_id=None, known_doc_slug=None)
check("explicit manifest enhance None respected", e is None)
check("template id alongside None enhance", k == 3)
check("missing slug in entry -> global (None)", s is None)

# cached_text (reprocess OCR-cache reuse): manifest ocr_text wins; otherwise the global
# cached_text falls through; a per-entry ocr_text overrides a global.
man3 = {"a.pdf": {"ocr_text": "PER DOC TEXT"}}
_, _, _, ct = doc_overrides(man3, "a.pdf", cached_text="GLOBAL TEXT")
check("manifest ocr_text wins over global cached_text", ct == "PER DOC TEXT")
_, _, _, ct = doc_overrides(man3, "other.pdf", cached_text="GLOBAL TEXT")
check("absent file -> global cached_text", ct == "GLOBAL TEXT")
_, _, _, ct = doc_overrides({}, "a.pdf")
check("no manifest, no global -> cached_text None", ct is None)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
