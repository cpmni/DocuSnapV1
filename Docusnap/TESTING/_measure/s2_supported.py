"""Slice 2 histogram helper: build the REAL format_class_index from a getFieldFormats dump
and emit the supported keys per (supplier_lower, slug_lower) — exactly the set engine.py:9182
derives `supported_keys` from. Usage: py -3.12 s2_supported.py formats.json out.json"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'python_backend'))
from extraction.format_anomaly_checker import build_format_class_index  # noqa: E402

formats = json.load(open(sys.argv[1], encoding='utf-8'))
index = build_format_class_index(formats)
out = {}
for (s, d, k) in index:
    out.setdefault(f"{s}|{d}", []).append(k)
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), indent=1)
print(f"index entries={len(index)} scopes={len(out)}")
