#!/usr/bin/env python3
"""
tests/test_doc_overrides_pin.py — Reprocess-All manifest carries the operator supplier PIN per-doc
WITHOUT a global leak (Part B3). Mirrors the known_doc_slug_authority no-leak rule (Oracle 2026-07-09):
a global --known-supplier must never leak onto a manifest-carried doc that has its own entry.

Run: cd python_backend && py -3.12 tests/test_doc_overrides_pin.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.argv = ['x']                                  # process_docs parses argv at import; keep it empty
from process_docs import doc_overrides

fails = 0
def check(label, cond):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond: fails += 1

# tuple layout: (enhance, known_template_id, known_doc_slug, cached_text, known_doc_slug_authority, known_supplier)
check('tuple grew to arity 6 (known_supplier appended)', len(doc_overrides(None, 'a.pdf')) == 6)
check('no manifest → the global --known-supplier applies (single-doc reprocess)',
      doc_overrides(None, 'a.pdf', known_supplier='Marlowe')[5] == 'Marlowe')
check('manifest entry with a pin → the PER-DOC value wins over the global',
      doc_overrides({'a.pdf': {'known_supplier': 'PerDoc'}}, 'a.pdf', known_supplier='GLOBAL')[5] == 'PerDoc')
check('manifest entry WITHOUT a pin → None (the global does NOT leak onto a batch-carried doc)',
      doc_overrides({'a.pdf': {}}, 'a.pdf', known_supplier='GLOBAL')[5] is None)
check('no pin anywhere → None (byte-identical, inert)',
      doc_overrides(None, 'a.pdf')[5] is None)

print(f"\n{'PASS' if not fails else 'FAIL'} — {fails} failure(s)")
sys.exit(1 if fails else 0)
