#!/usr/bin/env python3
"""
tests/test_undetected_issuer.py
-------------------------------
The DECLARE-ISSUER-UNDETECTED gate (mig 195, DARK `issuer_undetected_blank`; reggie+gary -> Oracle
SIGN-OFF-W/COND 2026-09-21). When the resolved Document Issuer is a NON-NAME value read cold off the
page with NO backing, it is declared Undetected (blank + review note) instead of committing a garbage
heading (e.g. "The Supplier shall not be responsible..." caption-matched to "Supplier:").

Covers: the value predicate over the SHARED twin vectors; efficacy (the disclaimer blanks); Oracle
Condition 1 (note REPLACED, not composed + suggested_supplier dropped); Condition 3 (method allow-list,
fail-safe on unknown); the support-signal skips (template/logo/accepted); the overcorrection guard (real
names never blank); Condition 6 (byte-identical when the env is off); and the PINNED trade-off (an
all-lowercase multi-word cold read routes to Undetected — first-contact-only, recoverable, census-gated).

    py -3.12 python_backend/tests/test_undetected_issuer.py    (set PYTHONIOENCODING=utf-8 on Windows)
"""
import sys
import os
import io
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import keyword
from extraction.engine import ExtractionEngine

fail = 0


def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1


VEC = json.load(io.open(Path(__file__).parent / "issuer_implausible_vectors.json", encoding="utf-8"))
SENT = "shall not be responsible for any damage that may"

# ── 1. the predicate over the shared twin vectors ────────────────────────────────────────────────
print("keyword.issuer_read_looks_implausible over the shared twin vectors")
for v in VEC["must_blank"] + VEC["accepted_tradeoff_blank"]:
    check(f"blank: {v!r}", keyword.issuer_read_looks_implausible(v) is True)
for v in VEC["must_stay"]:
    check(f"stay:  {v!r}", keyword.issuer_read_looks_implausible(v) is False)


# ── engine method harness (a stub `self` — no full pipeline needed) ───────────────────────────────
class _Stub:
    def __init__(self, accepted=None):
        self.accepted_names = set(accepted or [])
        self.accepted_issuers = set()
    _accept_norm = staticmethod(ExtractionEngine._accept_norm)

    def log(self, *a, **k):
        pass


def run(fld, extra=None, env="1", accepted=None):
    results = {"supplier_name": dict(fld)}
    if extra:
        results.update(extra)
    old = os.environ.get("ISSUER_UNDETECTED_BLANK")
    if env is None:
        os.environ.pop("ISSUER_UNDETECTED_BLANK", None)
    else:
        os.environ["ISSUER_UNDETECTED_BLANK"] = env
    try:
        ExtractionEngine._declare_issuer_undetected(_Stub(accepted), results)
    finally:
        if old is None:
            os.environ.pop("ISSUER_UNDETECTED_BLANK", None)
        else:
            os.environ["ISSUER_UNDETECTED_BLANK"] = old
    return results


# ── 2. efficacy: the disclaimer blanks (cold, unsupported, env on) ────────────────────────────────
print("\nefficacy: the disclaimer sentence blanks (env on, no support)")
r = run({"value": SENT, "confidence": 40, "method": "keyword"})
f = r["supplier_name"]
check("value blanked, conf 0", f["value"] is None and f["confidence"] == 0)
check("method 'issuer_undetected'", f["method"] == "issuer_undetected")
check("a review note is present", bool(str(f.get("validation_note") or "").strip()))
check("_supplier_name blanked in lockstep", r["_supplier_name"] is None)
check("_needs_review set", r["_needs_review"] is True)

# ── 3. Condition 1: the note is REPLACED (not composed) + suggested_supplier dropped ──────────────
print("\nC1: prior note replaced (not composed) + suggested_supplier dropped")
r = run({"value": SENT, "confidence": 40, "method": "keyword",
         "validation_note": "This reads like a postcode, not a company name.",
         "suggested_supplier": "Acme Ltd", "corrected_to": "Acme"})
f = r["supplier_name"]
check("the prior 'postcode' note is gone (assigned, not appended)", "postcode" not in str(f.get("validation_note")))
check("suggested_supplier dropped (no 'Use X' button on a blank)", "suggested_supplier" not in f)
check("corrected_to dropped", "corrected_to" not in f)

# ── 4. Condition 3: method ALLOW-LIST, fail-safe on unknown ───────────────────────────────────────
print("\nC3: allow-list fail-safe — only a bare keyword read blanks")
for m in ["template_fixed", "logo", "operator_pin", "anchor_crop", "keyword_override",
          "letterhead_prefill", "hint", "memory", "some_future_method", ""]:
    r = run({"value": SENT, "confidence": 40, "method": m})
    check(f"method {m!r} NOT blanked", r["supplier_name"]["value"] == SENT)
r = run({"value": SENT, "confidence": 40, "method": "keyword_below"})
check("method 'keyword_below' IS blanked (a bare page read)", r["supplier_name"]["value"] is None)

# ── 5. support signals skip (template / logo / operator-accepted) ─────────────────────────────────
print("\nsupport signals skip")
check("matched template -> not blanked", run({"value": SENT, "confidence": 40, "method": "keyword"}, {"_template_id": 7})["supplier_name"]["value"] == SENT)
check("logo matched -> not blanked", run({"value": SENT, "confidence": 40, "method": "keyword"}, {"_logo_phash": "abc"})["supplier_name"]["value"] == SENT)
check("operator-accepted value -> not blanked", run({"value": SENT, "confidence": 40, "method": "keyword"}, accepted=[ExtractionEngine._accept_norm(SENT)])["supplier_name"]["value"] == SENT)

# ── 6. the overcorrection guard: real names / short brands are NEVER blanked ──────────────────────
print("\novercorrection guard: real names never blanked")
for v in ["Northgate Textiles", "BP", "IBM", "J S Bloggs", "Six Mile Software", "株式会社サンプル"]:
    check(f"{v!r} stays", run({"value": v, "confidence": 40, "method": "keyword"})["supplier_name"]["value"] == v)

# ── 7. Condition 6: byte-identical when the env is off ────────────────────────────────────────────
print("\nC6: env unset -> no-op (byte-identical)")
r = run({"value": SENT, "confidence": 40, "method": "keyword"}, env=None)
check("value untouched + no _supplier_name write", r["supplier_name"]["value"] == SENT and "_supplier_name" not in r)

# ── 8. PINNED TRADE-OFF (Oracle C5): all-lowercase multi-word cold read -> Undetected ─────────────
#    A future dev must NOT re-admit it (that would restore the very bug). It is first-contact-only
#    (a confirmed supplier gains a hint/scope -> supported -> never reaches here) and recoverable
#    (blank + note, the user types the name); the FLIP census measures the real-world denominator.
print("\nPINNED TRADE-OFF: an all-lowercase multi-word cold read routes to Undetected")
check("'acme joinery' (cold, all-lowercase, no support) -> blanked",
      run({"value": "acme joinery", "confidence": 40, "method": "keyword"})["supplier_name"]["value"] is None)

print(f"\n{fail} check(s) failed." if fail else "\nAll undetected-issuer checks passed.")
sys.exit(1 if fail else 0)
