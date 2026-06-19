#!/usr/bin/env python3
"""
tests/test_field_charsets.py
----------------------------
Phase 1 valid-character policy: charset_disallowed flags unexpected OCR symbols per
field type without ever stripping the value, and the config block loads with the
user-approved set (baseline + - ' # +). NO unicode printed (Windows cp1252).

    py -3.12 python_backend/tests/test_field_charsets.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import charset_disallowed  # noqa: E402

CONFIG = Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json"


def check(label, cond):
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def main():
    f = 0
    fc = json.loads(CONFIG.read_text(encoding="utf-8")).get("field_charsets", {})

    print("config: field_charsets present with the approved set")
    f += not check("has default/text/alphanumeric + multiline=null",
                   all(k in fc for k in ("default", "text", "alphanumeric")) and fc.get("multiline_text") is None)
    f += not check("default includes hyphen/apostrophe/#/+ (Reggie set)",
                   all(c in (fc.get("default") or "") for c in "-'#+"))
    f += not check("default includes a backslash (one char)", "\\" in (fc.get("default") or ""))
    f += not check("default includes the currency symbols", all(c in (fc.get("default") or "") for c in "£$€¥"))

    print("\ncharset_disallowed behaviour")
    f += not check("clean name passes", charset_disallowed("City Office NI", fc["text"]) == [])
    f += not check("name with apostrophe/ampersand passes", charset_disallowed("O'Brien & Sons", fc["text"]) == [])
    f += not check("OCR replacement char + tilde flagged",
                   charset_disallowed("Beaumont� Care~", fc["text"]) == ["~", "�"])
    f += not check("code 'INV-001' passes alphanumeric", charset_disallowed("INV-001", fc["alphanumeric"]) == [])
    f += not check("code with stray '*' flagged", charset_disallowed("INV*001", fc["alphanumeric"]) == ["*"])
    f += not check("multiline (null) = no constraint", charset_disallowed("anything %% @@ �", fc["multiline_text"]) == [])
    f += not check("digits+separators in default pass", charset_disallowed("Total 1,250.00 / ref", fc["default"]) == [])

    if f:
        print(f"\n{f} FAILED")
        return 1
    print("\nAll field-charset checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
