"""tests/test_identity_scope_post_repair.py — pins the FILING-IDENTITY COHERENCE slice.

Run: py -3.12 tests/test_identity_scope_post_repair.py

THE DEFECT THIS PINS.  `results['_supplier_name']` is not telemetry.  process_docs.py:956 pops
it, emits it at :1065, and processing/handler.js writes it to `documents.supplier_name` — which
is THE FILING FOLDER and THE UNIVERSAL LEARNING SCOPE KEY (database/modules/learning.js:1803).

It is assigned from the LOCAL `supplier_name`, whose last write is engine.py:7220.  Everything
that can HEAL the issuer runs after that: the Stage-4.5 name-lexicon repair, the identity-variant
adoption, and the late supplier writers.  So the engine could repair `results['supplier_name']` —
the value the operator sees, and the one that becomes the extraction row — while the document
still FILED under, and LEARNED under, the unrepaired string.  Extraction row says one company,
folder says another, and the company splits in two in the filing cabinet.

The staleness class was already known one guard over: `_flag_branding_conflict` is deliberately
SKIPPED when the identity-variant adoption fired, precisely because that adoption "may have
changed results['supplier_name'] while the local supplier_name var is stale".  That fix was
scoped to one caller; this closes the same seam for the filing identity.

PLACEMENT IS LOAD-BEARING and is pinned below.  The re-derivation was ADDED at the end of
extract(), NOT moved onto the original assignment — so `supported_keys` and
`_flag_branding_conflict`, the two existing consumers of the pre-repair local, are byte-identical.
Whether the branding cross-check should instead judge the POST-repair name is a separate,
deliberately unmade decision.

ACCEPTED TRADE-OFF, pinned: an EMPTY final value never wins.  `_supplier_name` can be resolved
from a logo, a hint or a template when no supplier FIELD was read at all; blanking it would send
the document to "Unknown Company" and destroy its learning scope — strictly worse than a
stale-but-real name.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import ExtractionEngine          # noqa: E402

FAILS = []


def check(label, cond):
    print(("OK   " if cond else "BAD  ") + label)
    if not cond:
        FAILS.append(label)


def arm(on):
    if on:
        os.environ["IDENTITY_SCOPE_POST_REPAIR"] = "1"
    else:
        os.environ.pop("IDENTITY_SCOPE_POST_REPAIR", None)


def results_with(final, stale, method="template_mapping"):
    return {"supplier_name": {"value": final, "confidence": 95, "method": method},
            "_supplier_name": stale}


rederive = ExtractionEngine._rederive_filing_identity

# ── DEFAULT OFF must be byte-identical ────────────────────────────────────────────────────
arm(False)
r = results_with("Bramblewood Joinery Ltd", "B8ramblewood Joinery Ltd")
check("flag OFF: returns None and the filing identity is untouched",
      rederive(r) is None and r["_supplier_name"] == "B8ramblewood Joinery Ltd")

# ── ARMED: the exhibit ────────────────────────────────────────────────────────────────────
arm(True)
r = results_with("Bramblewood Joinery Ltd", "B8ramblewood Joinery Ltd")
moved = rederive(r)
check("armed: a repaired field value moves the FILING identity with it  <- the whole point",
      moved is not None and r["_supplier_name"] == "Bramblewood Joinery Ltd")
check("armed: the move is reported as (was, now, method) for the log and the corpus arm",
      moved == ("B8ramblewood Joinery Ltd", "Bramblewood Joinery Ltd", "template_mapping"))

# ── ARMED: the no-ops ─────────────────────────────────────────────────────────────────────
r = results_with("Bramblewood Joinery Ltd", "Bramblewood Joinery Ltd")
check("armed: values already agree -> no move, no log line",
      rederive(r) is None and r["_supplier_name"] == "Bramblewood Joinery Ltd")

r = results_with("", "Oakhaven Electrical Wholesale")
check("armed: an EMPTY final value NEVER wins  <- pinned trade-off, do not 'simplify' away",
      rederive(r) is None and r["_supplier_name"] == "Oakhaven Electrical Wholesale")

r = results_with("   ", "Oakhaven Electrical Wholesale")
check("armed: a whitespace-only final value is treated as empty",
      rederive(r) is None and r["_supplier_name"] == "Oakhaven Electrical Wholesale")

r = {"_supplier_name": "Oakhaven Electrical Wholesale"}          # no supplier FIELD at all
check("armed: no supplier field (logo/hint-resolved identity) -> untouched",
      rederive(r) is None and r["_supplier_name"] == "Oakhaven Electrical Wholesale")

r = {"supplier_name": "not-a-dict", "_supplier_name": "Oakhaven Electrical Wholesale"}
check("armed: a non-dict supplier field is ignored, never crashes",
      rederive(r) is None and r["_supplier_name"] == "Oakhaven Electrical Wholesale")

r = {"supplier_name": {"value": "Pelican Office Interiors", "method": "keyword"}}
check("armed: fills a MISSING _supplier_name from the field (stale reads as empty)",
      rederive(r) is not None and r["_supplier_name"] == "Pelican Office Interiors")

# ── PLACEMENT (source pins) ───────────────────────────────────────────────────────────────
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "extraction", "engine.py"), encoding="utf-8").read()

check("the ORIGINAL pre-repair assignment is still in place — this slice ADDS a late "
      "re-derivation and moves nothing, so supported_keys and _flag_branding_conflict "
      "are byte-identical",
      'results["_supplier_name"]        = supplier_name' in src)

i_corrob = src.index('results["_corroboration_emit"]')
i_call = src.index("_rederive_filing_identity(results)", i_corrob)
i_ret = src.index("return results", i_call)
check("the re-derivation runs AFTER every writer of results['supplier_name'] and before "
      "extract() returns",
      i_corrob < i_call < i_ret)

check("_flag_branding_conflict still receives the PRE-repair local (the deliberately unmade "
      "decision — do not quietly change this without a ruling)",
      "self._flag_branding_conflict(results, supplier_name, templates, ocr_text)" in src)

arm(False)
print("\n%d FAILED" % len(FAILS) if FAILS else "\nAll pins passed")
sys.exit(1 if FAILS else 0)
