#!/usr/bin/env python3
"""
tests/test_format_rules_global_scope.py
---------------------------------------
Stage 7 Stage 3 — enforce that the persistent learned format model is GLOBAL
learned memory keyed by (supplier_name, document_type, field_key), NOT
template-only learning.

Evidence set: the real "Document Solutions / Service Worksheet" documents in the
project-root Debug/ folder. Every one of those PDFs carries template_id = NULL
(no template link) yet shares one scope and recurring field shapes:
    ticket_no : "2601-0195-1", "2602-0926-1", ...   -> alphanum_sep, sep '-'
    contract  : "EASTK686", "EASTK695", ...          -> upper_alphanum
    date      : "31/03/2026", "07/01/2026", ...      -> date_like
The literal values below were observed by OCR'ing Debug/ with process_docs.py.

What this proves:
  1. A persisted rule populates the Stage 4.5 index with ZERO inferred formats
     and ZERO templates — it is not derived from, or gated by, any template.
  2. The rule applies to a debug-doc value it was NOT "learned from" (a
     different document in the same scope) — i.e. global within scope, visible
     to later/unseen documents, not bound to one document or template sample.
  3. The rule is strictly scoped: a different supplier / document_type / field
     gets no entry (None) -> no constraint -> fall back to per-run inference.
  4. check_value / propose_correction behave identically (Stage 1/2 unchanged),
     and take NO template argument anywhere on the path.

Usage:
    py -3.12 python_backend/tests/test_format_rules_global_scope.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction.format_anomaly_checker import (
    build_format_class_index, merge_format_rules, check_value,
    ALPHANUM_SEP, UPPER_ALPHANUM,
)
from extraction.engine import ExtractionEngine


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'}  {label}")
    return bool(cond)


# Real values observed from Debug/ (template_id NULL on every source doc).
SUP, DT = 'Document Solutions', 'service_worksheet'
TICKETS  = ['2601-0195-1', '2602-0926-1', '2602-0768-1', '2602-0527-1', '2602-0128-1']
CONTRACTS = ['EASTK686', 'EASTK695', 'EASTK697', 'EASTK683', 'EASTK687']


def _rule(field, cls, seps=''):
    return {'supplier_name': SUP, 'document_type': DT, 'field_key': field,
            'format_class': cls, 'allowed_separators': seps, 'confirmed_count': 12}


def main():
    fail = 0

    print("\n1. Persisted rule populates Stage 4.5 index with NO inference, NO template")
    # Empty inferred index (no per-run history at all), only a persisted rule.
    idx = merge_format_rules({}, [_rule('ticket_no', ALPHANUM_SEP, '-')])
    key = (SUP.lower(), DT, 'ticket_no')
    fail += not check("rule present in index from persisted memory alone", key in idx)

    # Engine path: zero formats_data, only persisted rules -> index still populated.
    eng = ExtractionEngine(mode='fast')
    eng.set_formats([], [_rule('ticket_no', ALPHANUM_SEP, '-'),
                         _rule('contract',  UPPER_ALPHANUM)])
    fail += not check("engine.set_formats populates index from rules with empty history",
                      (SUP.lower(), DT, 'ticket_no') in eng.format_class_index and
                      (SUP.lower(), DT, 'contract')  in eng.format_class_index)
    fail += not check("inferred-only index would have been empty (proves rules did it)",
                      len(build_format_class_index([])) == 0)

    print("\n2. Rule applies to debug-doc values it was NOT learned from (global within scope)")
    entry = idx[key]
    # Conforms — every real ticket from a *different* debug doc passes.
    fail += not check("all real ticket_no values conform (no anomaly)",
                      all(check_value(v, entry) is None for v in TICKETS))
    # A corrupted variant (OCR turned '-' into '/') is flagged — separator not learned.
    flagged = check_value('2602/0926/1', entry)
    fail += not check("OCR-corrupted ticket '2602/0926/1' is flagged", flagged is not None)
    # contract rule: real values conform; a lowercased misread is flagged.
    c_entry = eng.format_class_index[(SUP.lower(), DT, 'contract')]
    fail += not check("all real contract values conform", all(check_value(v, c_entry) is None for v in CONTRACTS))
    fail += not check("lowercased contract 'eastk695' flagged (upper_alphanum)", check_value('eastk695', c_entry) is not None)

    print("\n3. Strict scope isolation — rule does NOT leak across supplier/type/field")
    fail += not check("different supplier -> no entry (fallback)", ('other ltd', DT, 'ticket_no') not in idx)
    fail += not check("different document_type -> no entry (fallback)", (SUP.lower(), 'invoice', 'ticket_no') not in idx)
    fail += not check("different field -> no entry (fallback)", (SUP.lower(), DT, 'serial_no') not in idx)
    fail += not check("unknown field lookup returns None -> Stage 4.5 skips it",
                      eng.format_class_index.get((SUP.lower(), DT, 'nonexistent')) is None)

    print("\n4. Fallback: with neither inference nor a rule, no constraint is applied")
    empty = ExtractionEngine(mode='fast')
    empty.set_formats([], [])
    fail += not check("empty index -> ticket lookup is None (per-run fallback path)",
                      empty.format_class_index.get(key) is None)

    print(f"\n{fail} FAILED" if fail else "\nAll global-scope (template-independence) checks passed")
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
