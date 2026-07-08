#!/usr/bin/env python3
"""
tests/test_template_supplier_precedence.py
------------------------------------------
Guards _genuine_template_supplier — the DOMINANT-issuer identity a matched template contributes to
the Stage-2.5 template-supplier precedence rule (the #119 class). The rule prefers this identity
over an artifact-labelled identity anchor read that DISAGREES with it, so a swept "Contoso /
Document Issuer" anchor can't stamp "Solutions" onto a City-Office invoice at 90%.

The identity comes from the learned issuer DISTRIBUTION (templates.getAll emits dominant_supplier /
_count / _total), NOT the template's cosmetic NAME — a template NAMED after its first-confirmed
issuer can be named after a minority/garble ("50 Asia" x1 vs "Contoso Asia" x3). Only a STRICT
majority (> half, >= 2 agreeing) is trusted; a split or single-confirm template contributes nothing
(so the rule stays inert and the field read stands).

    py -3.12 python_backend/tests/test_template_supplier_precedence.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.engine import _genuine_template_supplier as dom  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")


def T(value, count, total, name='X'):
    return {'name': name, 'dominant_supplier': value,
            'dominant_supplier_count': count, 'dominant_supplier_total': total}


print("_genuine_template_supplier — DOMINANT confirmed issuer, strict majority only:")
check("clear majority (City Office NI 11/12) -> that identity",
      dom(T('City Office NI', 11, 12)) == 'City Office NI')
check("majority ignores the cosmetic NAME (name='50 Asia' but dominant='Contoso Asia' 3/4) -> dominant",
      dom(T('Contoso Asia', 3, 4, name='50 Asia')) == 'Contoso Asia')
check("SuperStore 115/118 -> that identity",
      dom(T('SuperStore', 115, 118)) == 'SuperStore')

print("\nNo clear majority / not enough evidence -> None (rule stays inert):")
check("exact tie 1/2 (not > half) -> None",
      dom(T('A', 1, 2)) is None)
check("50/50 split 2/4 (not > half) -> None",
      dom(T('A', 2, 4)) is None)
check("plurality but not majority (2 of 5) -> None",
      dom(T('A', 2, 5)) is None)
check("single confirm (1/1) -> None (needs >= 2 agreeing)",
      dom(T('A', 1, 1)) is None)
check("bare majority but only 1 agreeing is impossible; 3/5 -> that identity",
      dom(T('A', 3, 5)) == 'A')

print("\nMissing / malformed dominant fields -> None (backward-safe, rule inert):")
check("no dominant_supplier (old caller/DB) -> None",
      dom({'name': 'City Office NI', 'confirmed_count': 6}) is None)
check("empty dominant_supplier -> None", dom(T('', 5, 5)) is None)
check("None template -> None", dom(None) is None)
check("non-numeric counts -> None", dom(T('A', 'x', 'y')) is None)

if FAILS:
    print(f"\n{FAILS} FAILED")
    sys.exit(1)
print("\nAll template-supplier-precedence checks passed")
sys.exit(0)
