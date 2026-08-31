#!/usr/bin/env python3
"""Gate (c) — BLAST RADIUS of the pad-window LABELLED sub-slice.

How many taught template mappings does arming TEMPLATE_PAD_WINDOW_CODE_LABELLED actually expose?
That is: rows with a non-null anchor_text whose field resolves to a CODE validation type
('alphanumeric' / 'reference_code' — template_mapper._CODE_CROSSCHECK_TYPES).

Read-only. Run: py -3.12 scratchpad/labelled_code_population.py
"""
import json
import os
import sqlite3
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get("RR_DB") or os.path.join(os.environ["APPDATA"], "ScanFinder", "docusnap.db")
CODE_TYPES = {"alphanumeric", "reference_code"}

cfg = json.load(open(os.path.join(REPO, "config", "keyword_patterns.json"), encoding="utf-8"))
field_val = {k: (v or {}).get("validation") for k, v in (cfg.get("field_patterns") or {}).items()}

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
c.row_factory = sqlite3.Row

rows = list(c.execute("""
    SELECT m.template_id, m.field_key, m.anchor_text, m.enabled,
           t.name AS tpl_name, t.document_type_slug AS slug
      FROM template_field_mappings m
      LEFT JOIN templates t ON t.id = m.template_id
"""))

total = len(rows)
enabled = [r for r in rows if r["enabled"]]
labelled = [r for r in enabled if (r["anchor_text"] or "").strip()]
code_labelled = [r for r in labelled if field_val.get(r["field_key"]) in CODE_TYPES]
code_labelless = [r for r in enabled
                  if not (r["anchor_text"] or "").strip()
                  and field_val.get(r["field_key"]) in CODE_TYPES]

print(f"template_field_mappings rows      : {total}")
print(f"  enabled                         : {len(enabled)}")
print(f"  enabled + LABELLED              : {len(labelled)}")
print(f"  enabled + LABELLED + CODE type  : {len(code_labelled)}   <== sub-slice blast radius")
print(f"  enabled + label-less + CODE type: {len(code_labelless)}  (parent slice scope)")

print("\nBy field_key (labelled + code):")
for k, n in Counter(r["field_key"] for r in code_labelled).most_common():
    print(f"  {k:<22}{n}")
print("\nBy template (labelled + code):")
for k, n in Counter(f'{r["tpl_name"]} / {r["slug"]}' for r in code_labelled).most_common():
    print(f"  {k:<48}{n}")
print("\nDistinct anchor_text values in scope (the label tails C4 guards against):")
for k, n in Counter((r["anchor_text"] or "").strip() for r in code_labelled).most_common():
    print(f"  {k!r:<28}{n}")
