"""Pins for KEYWORD_SUPERSTRING_NAME_NOTE (2026-09-08; belt 2(b) of docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md
§6, Oracle-redirected). Engine, ZERO OCR, after Stage 4: a name-like non-supplier field whose winner is the un-suffixed
Stage-0.5 abs read, an un-noted keyword-family ledger candidate K that passes the name-grow SHAPE comparator, the winner
NOT word-bounded page-present while K IS → value UNCHANGED, corrected_to=K, cap <=70, a note if none. The exhibit:
'Willowbrook Nurserie:' (taught box) vs 'Willowbrook Nurseries' (keyword) on a page that prints the latter.
Run: py -3.12 python_backend/tests/test_keyword_superstring_name_note.py
"""
import copy
import inspect
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []
def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)

import extraction.engine as E

PAGE = "DELIVERY DOCKET\nDeliver To\nWillowbrook Nurseries\nGreenacres, Mill Lane\nTaunton\nTA1 4QN\nAcme\nAcme Ltd\n"
FIELDS = [{"key": "customer_name", "type": "text"}, {"key": "supplier_name", "type": "text"}]

def engine(cands):
    e = E.ExtractionEngine.__new__(E.ExtractionEngine)
    e._field_candidates = {"customer_name": cands, "supplier_name": copy.deepcopy(cands)}
    e._trace = False
    e._t = lambda *a, **k: None
    e.log = lambda *a, **k: None
    return e

def kw(value, conf=78, noted=False, stage="1_keyword"):
    return {"value": value, "method": "keyword_override", "confidence": conf, "stage": stage, "noted": noted}

def winner(value="Willowbrook Nurserie:", method="template_mapping", conf=90, **extra):
    return {"value": value, "confidence": conf, "method": method, **extra}

def run(results, cands, on=True, page=PAGE, fields=FIELDS):
    if on:
        os.environ['KEYWORD_SUPERSTRING_NAME_NOTE'] = '1'
    else:
        os.environ.pop('KEYWORD_SUPERSTRING_NAME_NOTE', None)
    e = engine(cands)
    r = copy.deepcopy(results)
    e._keyword_superstring_name_note(r, fields, page)
    return r

# ── OFF: byte-identical ───────────────────────────────────────────────────────
base = {"customer_name": winner()}
r = run(base, [kw("Willowbrook Nurseries")], on=False)
check("OFF: results untouched", r == base)

# ── the exhibit ───────────────────────────────────────────────────────────────
r = run(base, [kw("Willowbrook Nurseries")])
c = r["customer_name"]
check("exhibit: value UNCHANGED (never a swap)", c["value"] == "Willowbrook Nurserie:")
check("exhibit: corrected_to = the fuller keyword reading (one-click Use)", c.get("corrected_to") == "Willowbrook Nurseries")
check("exhibit: capped <=70 (the auto-file door for a non-role field closes on the note, the cap is belt)", c["confidence"] == 70)
check("exhibit: the note names both readings", "Willowbrook Nurserie:" in (c.get("validation_note") or "")
      and "Willowbrook Nurseries" in (c.get("validation_note") or ""))
check("exhibit: NO method suffix (S3 — a suffix corrupts the corroboration record)", c["method"] == "template_mapping")
check("exhibit: marker set, was_corrected NOT set", c.get("keyword_superstring_note") is True and not c.get("was_corrected"))

# ── the label-guard's note survives (the belt runs AFTER Stage 4) ─────────────
noted = {"customer_name": winner(validation_note="value looks like a label, not a field value", conf=35)}
r = run(noted, [kw("Willowbrook Nurseries")])
c = r["customer_name"]
check("existing note survives; corrected_to + cap still attached", c["validation_note"] == "value looks like a label, not a field value"
      and c.get("corrected_to") == "Willowbrook Nurseries" and c["confidence"] == 35)

# ── refusals (each the failure case the Oracle named) ─────────────────────────
r = run(base, [kw("Willowbrook Nurseries Site")])
check("over-capture 'Willowbrook Nurseries Site' (keyword-steered glue) -> NO fire", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseries Ltd")])
check("glued neighbour token -> NO fire (same token count required)", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseries", noted=True)])
check("a NOTED keyword candidate is no witness -> NO fire", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseries", stage="2_anchor")])
check("a non-keyword-family candidate -> NO fire (keyword family is the trigger)", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseries")], page="DELIVERY DOCKET\nDeliver To\nWillowbrook Nursery\n")
check("K not word-bounded page-present -> NO fire (the fuller reading must be printed)", "corrected_to" not in r["customer_name"])
r = run({"customer_name": winner("Acme")}, [kw("Acme Ltd")])
check("a REAL short name on the page ('Acme' word-bounded present) -> NO fire (C3: it defends itself)", "corrected_to" not in r["customer_name"])
r = run({"customer_name": winner(method="template_mapping_namegrow")}, [kw("Willowbrook Nurseries")])
check("a fired grow leg (method suffixed) owns its outcome -> NO fire (C6 disjoint owners)", "corrected_to" not in r["customer_name"])
r = run({"customer_name": winner(method="keyword_override")}, [kw("Willowbrook Nurseries")])
check("a keyword winner -> NO fire (the belt is for the taught abs read only)", "corrected_to" not in r["customer_name"])
r = run({"supplier_name": winner()}, [kw("Willowbrook Nurseries")])
check("supplier_name -> NO fire (the identity lane owns it)", "corrected_to" not in r["supplier_name"])
r = run({"customer_name": winner(corrected_to="Something")}, [kw("Willowbrook Nurseries")])
check("a field already carrying corrected_to -> untouched", r["customer_name"].get("corrected_to") == "Something")
r = run({"customer_name": winner(value="Willowbrook\nNurserie:")}, [kw("Willowbrook Nurseries")])
check("multi-line winner -> NO fire (single-line scope v1)", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseries")], fields=[{"key": "customer_name", "type": "alphanumeric"}])
check("a code-typed field -> NO fire (names only)", "corrected_to" not in r["customer_name"])
r = run(base, [kw("Willowbrook Nurseriez", conf=60), kw("Willowbrook Nurseries", conf=78)])
check("candidates: the highest-confidence passing K wins; a non-matching one is skipped", r["customer_name"].get("corrected_to") == "Willowbrook Nurseries")

# ── order pin: after Stage 4, before the name unclip ─────────────────────────
src = inspect.getsource(E.ExtractionEngine.extract)
i_val = src.index("validator.validate_and_adjust(")
i_note = src.index("self._keyword_superstring_name_note(")
i_unclip = src.index("self._reconcile_name_truncation(")
check("ORDER: the belt runs AFTER validator.validate_and_adjust and BEFORE the name unclip", i_val < i_note < i_unclip)
check("switch is read from KEYWORD_SUPERSTRING_NAME_NOTE at call time (OFF -> early return)",
      "os.environ.get('KEYWORD_SUPERSTRING_NAME_NOTE', '0') == '0'" in inspect.getsource(E.ExtractionEngine._keyword_superstring_name_note))

os.environ.pop('KEYWORD_SUPERSTRING_NAME_NOTE', None)
print()
if FAILED:
    print(f"{len(FAILED)} FAILED"); sys.exit(1)
print("all keyword-superstring-note pins green")
