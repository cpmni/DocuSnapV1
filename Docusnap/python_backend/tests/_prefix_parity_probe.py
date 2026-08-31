"""Parity probe for database/modules/prefix_outlier.js (Slice 1 confirm gate).

Emits the PYTHON prefix-outlier predicate's verdicts for a set of (value_counts, read_prefix)
cases so the JS mirror can assert byte-parity against ocr_corrector.py. NOT a standalone test
(no asserts) — it is spawned by database/modules/test_prefix_outlier.js.

  argv[1] = path to a JSON file: [{"value_counts": {value: count}, "read_prefix": "IN"}, ...]
  stdout  = JSON: [{"dominant": str|None, "total": int|None, "outlier": bool}, ...]
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import ocr_corrector as oc

cases = json.load(open(sys.argv[1], encoding='utf-8'))
out = []
for case in cases:
    entry = {'field_key': 'reference_number', 'supplier_name': 'S', 'document_type': 'dt',
             'value_counts': case['value_counts']}
    idx = oc.build_prefix_index([entry])
    rec = oc.lookup_prefix(idx, 'reference_number', 'S', 'dt')
    outlier = bool(oc.is_prefix_outlier(case['read_prefix'], rec)) if rec else False
    out.append({'dominant': (rec or {}).get('dominant'),
                'total':    (rec or {}).get('total'),
                'outlier':  outlier})
print(json.dumps(out))
