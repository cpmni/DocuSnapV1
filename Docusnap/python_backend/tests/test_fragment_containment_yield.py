#!/usr/bin/env python3
"""tests/test_fragment_containment_yield.py — TEMPLATE_FRAGMENT_CONTAINMENT_YIELD
(2026-08-31, the CAD8 ⊂ CAD832694 exhibit, Castellan delivery_note_0005 — the sanctioned
successor to the 08-09 Q2 rejection; Oracle SIGN-OFF-W/COND C1-C8, DARK).

A taught inline CODE read can be TRUNCATED to a prefix by _read_inline_box's one-token split()
on a mid-token OCR space ('CAD8 32694' -> 'CAD8'), then committed as a template_mapping with a
false shapewarn. The fragment PASSES the hard reference_code pattern, so TEMPLATE_FORMAT_FAIL_YIELD
declines (correct-by-design) and BLIND_GEOM_DISAGREE_RECONCILE is scoped anchor_registration exactly.
When a confident keyword read STRICTLY PREFIX-CONTAINS the fragment, the Stage-1 merge adopts the
fuller keyword read + a NEUTRAL both-values note + cap 88, review-bound. REF-FAMILY ONLY; NEVER
currency/total.

Pins:
  • the containment predicate (CAD8 ⊂ CAD832694; separator-blind; core>=4; STRICT PREFIX only — the
    endswith mirror is a pinned trade-off; equal is not containment);
  • the currency/total role exclusion (class-F C2);
  • C3: the both-values note is NOT a verification-doubt mark (a future doubt-clear can't auto-file it);
  • the merge LEG itself (source-structure) — placement AFTER the format-fail-yield leg + BEFORE the
    final continue, the full guard conjunction, cap+note+continue — so DELETING the leg fails this file
    (the mechanical guard Oracle C1 mandates);
  • flag default OFF.

Run: py -3.12 python_backend/tests/test_fragment_containment_yield.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop('TEMPLATE_FRAGMENT_CONTAINMENT_YIELD', None)
import extraction.engine as E   # noqa: E402

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


# ── flag defaults OFF ───────────────────────────────────────────────────────────
check("TEMPLATE_FRAGMENT_CONTAINMENT_YIELD defaults OFF (DARK)",
      E.TEMPLATE_FRAGMENT_CONTAINMENT_YIELD is False)

# ── the containment predicate ───────────────────────────────────────────────────
FC = E._fragment_contained
check("EXHIBIT: 'CAD8' ⊂ 'CAD832694' (strict alnum prefix)", FC("CAD8", "CAD832694") is True)
check("separator-blind: 'CAD8' ⊂ 'CAD-832694' (via _code_norm)", FC("CAD8", "CAD-832694") is True)
check("separator on BOTH: 'CAD-8' ⊂ 'CAD832694'", FC("CAD-8", "CAD832694") is True)
check("equal is NOT containment ('CAD832694' vs 'CAD832694')", FC("CAD832694", "CAD832694") is False)
check("SHORT-CORE PIN: a <4-char fragment ('CAD') never hijacks a longer code", FC("CAD", "CAD832694") is False)
check("PREFIX-ONLY TRADE-OFF (C2): a SUFFIX fragment ('832694') is NOT contained (endswith mirror absent)",
      FC("832694", "CAD832694") is False)
check("a non-prefix code is not contained ('XYZ9' vs 'CAD832694')", FC("XYZ9", "CAD832694") is False)
check("empty fragment -> False", FC("", "CAD832694") is False and FC(None, "CAD832694") is False)
check("the 3 challengers can't fabricate containment ('The'/'Tel…'/'25-07-2025' don't prefix-hold 'CAD8')",
      not FC("CAD8", "The") and not FC("CAD8", "Tel 01632 964956") and not FC("CAD8", "25-07-2025"))

# ── currency/total role exclusion (class-F C2, C10/C11) ─────────────────────────
RC = E._fragment_yield_role_is_currency
check("total_amount is a currency role (NEVER contained-yielded)", RC("total_amount", {}) is True)
check("a currency-TYPED field is excluded", RC("payment_ref", {"payment_ref": "currency"}) is True)
check("money/amount typed excluded", RC("x", {"x": "money"}) is True and RC("y", {"y": "amount"}) is True)
check("po_ref / invoice_number are NOT currency roles", RC("po_ref", {}) is False and RC("invoice_number", {}) is False)

# ── C3: the both-values note is NOT a verification-doubt mark ────────────────────
_note = ("The taught box read “CAD8”; the field's label read the longer “CAD832694”. "
         "Kept the longer read — please confirm.")
check("C3: the fragment-containment note is NOT a verification-doubt note (un-sweepable)",
      E._is_verification_doubt_note(_note) is False)
check("C3: the note text is absent from the allowlist marks",
      all(_note != m for m, _how in E._verification_doubt_note_marks()))

# ── the MERGE LEG (source-structure — deleting the leg fails here) ───────────────
src = Path(E.__file__).read_text(encoding='utf-8')
i_ff = src.find("if (TEMPLATE_FORMAT_FAIL_YIELD")            # the sibling format-fail-yield leg
i_leg = src.find("if (TEMPLATE_FRAGMENT_CONTAINMENT_YIELD")  # our leg (the merge condition)
i_tail = src.find("continue\n            if (key in date_field_keys and existing")  # the final `continue`
check("the fragment-containment merge leg is present", i_leg != -1)
check("placed AFTER the format-fail-yield leg and BEFORE the final continue of the mapping block",
      i_ff != -1 and i_tail != -1 and i_ff < i_leg < i_tail)
_slice = src[i_leg:i_tail] if (i_leg != -1 and i_tail != -1) else ""
check("guards: template_mapping incumbent + NOT a date key",
      '(existing.get("method") or "").startswith("template_mapping")' in _slice
      and "key not in date_field_keys" in _slice)
check("guards: REF-FAMILY (_is_ref_field or _ref) + NOT name-like + NOT a currency role",
      '_is_ref_field(key) or key.endswith("_ref")' in _slice
      and "not value_quality.is_name_like_field(key)" in _slice
      and "not _fragment_yield_role_is_currency(key, _kw_types)" in _slice)
check("guards: the code-shaped OR-disjunct wires _code_shaped_containment_ok into the scope gate (Oracle B-C1)",
      "or self._code_shaped_containment_ok(key, existing.get(\"value\"), data.get(\"value\"), supplier_name, document_slug)" in _slice)
check("guards: challenger is keyword/keyword_override, has a value, conf >= _FRAGMENT_YIELD_KW_FLOOR",
      'data.get("method") in ("keyword", "keyword_override")' in _slice
      and "_FRAGMENT_YIELD_KW_FLOOR" in _slice)
check("guards: challenger PASSES its own format (not _stage05_format_fails) AND _fragment_contained",
      "not _stage05_format_fails(data.get(\"value\")" in _slice
      and "_fragment_contained(existing.get(\"value\"), data.get(\"value\"))" in _slice)
check("action: commit {**data} capped at _CONFLICT_CAP + a validation_note + own continue",
      "{**data," in _slice and "_CONFLICT_CAP" in _slice and "validation_note" in _slice
      and _slice.split("continue", 1)[0].count("results[key] =") == 1)
check("note is NEUTRAL (no causal 'cut short'): names BOTH values, 'Kept the longer read'",
      "the field's" in _slice and "read the longer" in _slice
      and "Kept the longer" in _slice and "cut short" not in _slice)
check("_FRAGMENT_YIELD_KW_FLOOR == 85 and _CONFLICT_CAP == 88 (review-bound, below auto-file)",
      E._FRAGMENT_YIELD_KW_FLOOR == 85 and E._CONFLICT_CAP == 88)

# ── Oracle 2026-09-02 revised B-C1: code-shaped, high-variance-safe admission (KNOWN-SET anchor) ──
CS = E._value_is_code_shaped
check("code-shaped: 'Ecosys PA2600cwx' (mixed token, internal space) qualifies", CS("Ecosys PA2600cwx") is True)
check("code-shaped: 'CAD832694' qualifies (existing ref exhibit, mixed)", CS("CAD832694") is True)
check("code-shaped REJECTS prose 'Widget Assembly' (no mixed token)", CS("Widget Assembly") is False)
check("code-shaped REJECTS word+bare-number 'Order 5'", CS("Order 5") is False)
check("code-shaped REJECTS pure-number '2500'", CS("2500") is False)
check("code-shaped REJECTS empty/None", CS("") is False and CS(None) is False)

# FIRING test (NON-VACUITY — Oracle: the 605 corpus is DOUBLY blind here: it never fires Stage-0.5
# template_mapping AND carries no high-variance model GT, so this is the ONLY automated gate that can
# fail on the owner's bug). Drives the REAL decision method through a set_formats-populated engine on
# the owner's LITERAL spaced value 'Ecosys PA2600cwx'.
eng = E.ExtractionEngine()
eng.set_formats([{
    'field_key': 'model', 'supplier_name': 'Print Tracker', 'document_type': 'print_tracker',
    'value_counts': {'Ecosys PA2600cwx': 3, 'TASKalfa 3252ci': 2, 'MP C4504ex': 1},   # HIGH-VARIANCE: no dominant
    'confirmed_count': 6,
}])
ok = eng._code_shaped_containment_ok('model', 'Ecosys PA2600cw)', 'Ecosys PA2600cwx', 'Print Tracker', 'print_tracker')
check("FIRING: the exhibit fires — clip incumbent 'Ecosys PA2600cw)' (NOT known) + known-good challenger "
      "'Ecosys PA2600cwx' on a HIGH-VARIANCE scope with NO dominant (dominant anchor would be inert)", ok is True)
check("FIRING: _fragment_contained agrees on the exhibit (the whole B decision holds end-to-end)",
      ok and E._fragment_contained('Ecosys PA2600cw)', 'Ecosys PA2600cwx') is True)
import extraction.ocr_corrector as _OC   # noqa: E402
check("NON-VACUITY CONTRAST: the OLD dominant anchor is INERT on this high-variance scope (why Oracle "
      "ruled KNOWN-SET, not dominant) — lookup_dominant returns None here",
      _OC.lookup_dominant(eng.dominant_index, 'model', 'Print Tracker', 'print_tracker') is None)

# ANTI-COLLISION PIN (Oracle): a scope that confirmed BOTH the shorter and the longer value.
eng2 = E.ExtractionEngine()
eng2.set_formats([{
    'field_key': 'model', 'supplier_name': 'Acme', 'document_type': 'acme_type',
    'value_counts': {'PA2600cw': 4, 'PA2600cwx': 3}, 'confirmed_count': 7,
}])
check("ANTI-COLLISION: incumbent == a KNOWN shorter value ('PA2600cw') -> B STANDS DOWN (mapping kept)",
      eng2._code_shaped_containment_ok('model', 'PA2600cw', 'PA2600cwx', 'Acme', 'acme_type') is False)
check("ANTI-COLLISION: same scope, incumbent is the NON-known clip ('PA2600c') -> B FIRES",
      eng2._code_shaped_containment_ok('model', 'PA2600c', 'PA2600cwx', 'Acme', 'acme_type') is True)
check("KNOWN-SET: an UNKNOWN challenger (never confirmed) -> B stands down (not a random longer code)",
      eng2._code_shaped_containment_ok('model', 'PA2600c', 'PA2600zzz9', 'Acme', 'acme_type') is False)
check("SCOPE: a different supplier scope does not resolve the value -> stands down",
      eng._code_shaped_containment_ok('model', 'Ecosys PA2600cw)', 'Ecosys PA2600cwx', 'Other Co', 'print_tracker') is False)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All TEMPLATE_FRAGMENT_CONTAINMENT_YIELD pins hold.")
