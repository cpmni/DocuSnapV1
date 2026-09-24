"""test_name_value_label_flag.py — the NAME_VALUE_LABEL_FLAG value-equals-label guard (mig 213, DARK; 2026-09-24,
Chris 09-23 teach round card 1; gary -> Oracle SIGN-OFF-W/COND C5-C8).

A taught box for an OPTIONAL name-like field (customer_name) drifted onto the LABEL line and the app auto-filed
the word "Customer" as the customer's name (twice, at overall 100, "Checked by you"). No guard compared a value
to its own caption. This pins:
  1. the pure predicate value_quality.value_is_own_label — exact whole-value equality to the field label / the
     mapping's anchor caption / a generic caption, plus the ONE fuzzy leg (a clipped >=4-char PREFIX of the
     label/anchor), and the anti-over-hold negatives (real names that CONTAIN a caption word are never flagged;
     the prefix leg never applies to the generic list — Oracle C5/C6);
  2. the engine wiring (source-scan): env-gated, after the mig-156 block, name-like keys only, defers to an
     existing note, exempts curated/human methods + accepted_names, caps <=69, its OWN note text, the mig-156
     `+nonname_flag` sentinel, a trace event, and OFF is byte-identical.
    py -3.12 python_backend/tests/test_name_value_label_flag.py
"""
import sys, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python_backend"))
from extraction.value_quality import value_is_own_label, _GENERIC_CAPTIONS
fails = 0
def check(label, cond):
    global fails
    print(("  OK  " if cond else "  BAD ") + label)
    if not cond:
        fails += 1

print("predicate - positives (the value IS its caption):")
check("'Customer' == label 'Customer'",                 value_is_own_label("Customer", "Customer", "Customer"))
check("'Customer:' (colon) == label",                   value_is_own_label("Customer:", "Customer", None))
check("'customer' (case) == label",                     value_is_own_label("customer", "Customer", None))
check("'CUSTOMER ' (space) == label",                   value_is_own_label("CUSTOMER ", "Customer", None))
check("'Customer Name' == label 'Customer Name'",       value_is_own_label("Customer Name", "Customer Name", None))
check("'Bill To' == anchor 'Bill To' (label differs)",  value_is_own_label("Bill To", "Customer", "Bill To"))
check("'Bill To' generic caption (no label/anchor)",    value_is_own_label("Bill To", None, None))
check("'Attention' generic caption",                    value_is_own_label("Attention", "Contact", None))
check("'Supplier' on supplier_name label 'Document Issuer'", value_is_own_label("Supplier", "Document Issuer", None))
check("clipped 'Custome' = prefix of anchor 'Customer Name' (>=4 chars)", value_is_own_label("Custome", "Customer", "Customer Name"))
check("clipped 'Cust' = 4-char prefix of label 'Customer'", value_is_own_label("Cust", "Customer", None))
print("predicate - negatives (real names must NEVER flag):")
for name in ["Kingfisher Print Studio", "Custom Joinery Ltd", "Client Services Ltd", "Attention Ltd", "Vendor Systems",
             "Order Solutions Ltd", "Total Office Supplies", "Ashcombe Care Homes Ltd", "Bill Toner Ltd", "Customer First Bank"]:
    check(f"{name!r} -> False", not value_is_own_label(name, "Customer", "Customer"))
check("'Cus' (3 chars) is NOT a prefix hit (floor 4)",       not value_is_own_label("Cus", "Customer", None))
check("'Att' vs generic 'Attention' -> False (prefix leg never applies to the generic list)", not value_is_own_label("Att", "Contact", None))
check("'Atten' vs generic 'Attention' -> False (ditto)",     not value_is_own_label("Atten", "Contact", None))
check("empty -> False",                                      not value_is_own_label("", "Customer", "Customer"))
check("None -> False",                                       not value_is_own_label(None, "Customer", None))
check("no label, no anchor, a real name -> False",           not value_is_own_label("Kingfisher Print Studio", None, None))
check("the generic list is exact whole-value entries (no bare 'to')", "to" not in _GENERIC_CAPTIONS and "customer" in _GENERIC_CAPTIONS and "bill to" in _GENERIC_CAPTIONS)

print("engine wiring (source-scan of engine.py):")
esrc = open(os.path.join(ROOT, "python_backend", "extraction", "engine.py"), encoding="utf-8").read()
i = esrc.find("VALUE-EQUALS-LABEL guard (mig 213")
block = esrc[i:esrc.find("# Supplier-scoped format first", i)]
check("the block exists after the mig-156 guard", i > 0 and esrc.find('NAME_ROLE_NONNAME_FLAG", "0") != "0"') < i)
check("env-gated NAME_VALUE_LABEL_FLAG (byte-identical OFF)", 'os.environ.get("NAME_VALUE_LABEL_FLAG", "0") != "0"' in block and esrc.count('os.environ.get("NAME_VALUE_LABEL_FLAG"') == 1)
check("gated on is_name_like_field", "value_quality.is_name_like_field(key)" in block)
check("defers to an existing note (one-note-per-field)", "not str(data.get('validation_note') or '').strip()" in block)
check("exempts accepted_names", "self._accept_norm(val) not in self.accepted_names" in block)
check("exempts curated/human methods", "'template_fixed', 'override', 'fixed', 'manual', '+confirmed_adopt', '+name_snap'" in block)
check("reads the field label AND the mapping anchor caption", "field_labels.get(key)" in block and "data.get('anchor')" in block)
check("calls the pure predicate", "value_quality.value_is_own_label(str(val), _vl_label, _vl_anchor)" in block)
check("its OWN note text (not mig-156's 'This reads like')", "This reads as the label" in block and "This reads like" not in block)
check("reuses the +nonname_flag sentinel (trust.js unchanged)", re.search(r"\{data\.get\('method'\) or 'unknown'\}\+nonname_flag", block) is not None)
check("caps confidence <= 69, keeps the value", "min(data.get('confidence') or 0, 69)" in block and "**data," in block)
check("trace event name_value_label_flag", 'self._t("name_value_label_flag"' in block)
check("routes to review (n_flagged + format_anomaly_flagged) then continue", "n_flagged += 1" in block and "format_anomaly_flagged = True" in block and block.rstrip().endswith("continue"))

print()
print(f"{fails} FAILED" if fails else "All NAME_VALUE_LABEL_FLAG pins passed")
sys.exit(1 if fails else 0)
