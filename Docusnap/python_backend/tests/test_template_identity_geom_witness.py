#!/usr/bin/env python3
"""tests/test_template_identity_geom_witness.py — G: geometry-witness shed of the
template-identity fill note (2026-07-31; gary→Oracle SIGN-OFF-W/COND; kill
TEMPLATE_IDENTITY_GEOM_WITNESS, dark until gated).

The owner's doc-170 class: the fill resolves "Ironbridge Fabrication" (printed LARGE in the
letterhead) yet carries "Company inferred from one previously filed document — please
confirm before filing." forever. When the INDEPENDENT geometry-only letterhead read agrees
with the fill, the hedge is stale — shed it (conf 85, method template_identity_corroborated,
no note). Every doubtful path keeps the note.

    cd python_backend && PYTHONIOENCODING=utf-8 py -3.12 tests/test_template_identity_geom_witness.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction.engine import (ExtractionEngine, _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE,
                               _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY, _IDENTITY_STRUCTURAL_METHODS)

fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "BAD ") + name)
    if not cond:
        fails += 1


P = ExtractionEngine._should_shed_fill_note_geom
BAND = ExtractionEngine._should_shed_template_identity_note
norm = ExtractionEngine._accept_norm

ON = {"TEMPLATE_IDENTITY_GEOM_WITNESS": "1"}
OFF = {"TEMPLATE_IDENTITY_GEOM_WITNESS": "0"}


def fill(note, value="Ironbridge Fabrication", method="template_identity"):
    return {"value": value, "confidence": 70, "method": method, "validation_note": note}


IRON = norm("Ironbridge Fabrication")

print("§1 the shed (the new capability):")
check("geom agrees + SINGLE tier → shed (the owner's doc-170 class)",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE), IRON, IRON, env=ON) is True)
check("geom agrees + MAJORITY tier → shed",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY), IRON, IRON, env=ON) is True)

print("\n§2 fail-toward-keeping-the-note:")
check("PIN: no witness (geometry absent/abstained) → NO shed",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE), None, IRON, env=ON) is False)
check("geom names a DIFFERENT company → NO shed",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE), norm("Copperfield Electrical"), IRON, env=ON) is False)
check("PIN norm strictness: letterhead superset 'Ironbridge Fabrication Ltd' → NO shed "
      "(deliberate measured limit, Oracle G5)",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE), norm("Ironbridge Fabrication Ltd"), IRON, env=ON) is False)
check("kill switch OFF → NO shed (byte-identical)",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE), IRON, IRON, env=OFF) is False)
check("wrong method (hint_text_match) → NO shed",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE, method="hint_text_match"), IRON, IRON, env=ON) is False)
check("a DIFFERENT note (e.g. branding conflict) → NO shed (only the two fill notes qualify)",
      P(fill("The page branding reads 'X'…"), IRON, IRON, env=ON) is False)
check("value-less row → NO shed",
      P(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE, value=""), IRON, "", env=ON) is False)

print("\n§3 RE-PIN the band arm's own limits (Oracle G3 — the two arms must not blur):")
# The BAND arm alone must still never shed a SINGLE-tier fill — its substring evidence can be a
# recipient self-corroborating on a marker-free layout (the original C2 hole stays closed).
band_env = {"TEMPLATE_IDENTITY_BAND_GRADUATE": "1", "ISSUER_HINT_BAND": "1"}
check("band arm + SINGLE note + name in band → STILL no shed (single is geometry-arm territory)",
      BAND(fill(_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE),
           "Ironbridge Fabrication, Foundry Yard, Coalport Road", env=band_env) is False)

print("\n§4 method + confidence pins:")
check("'template_identity_corroborated' stays EXCLUDED from _IDENTITY_STRUCTURAL_METHODS (Oracle C3)",
      "template_identity_corroborated" not in _IDENTITY_STRUCTURAL_METHODS)
# Conf-85 do-not-raise pin (source-level): the G shed block must emit exactly 85 — hint parity,
# below the 95/100 floors until normal graduation. Raising it re-opens a silent-file path.
import inspect
_src = inspect.getsource(ExtractionEngine.extract)
_g_at = _src.find("G: GEOMETRY-WITNESS shed")
check("G shed block present in extract()", _g_at > 0)
_g_block = _src[_g_at - 3000:_g_at + 3000]
check("PIN: the G shed emits confidence 85 (do NOT raise — hint parity, sub-floor)",
      '"confidence": 85' in _g_block or "'confidence': 85" in _g_block
      or '"confidence":      85' in _g_block)

print()
if fails:
    print(f"{fails} CHECK(S) FAILED")
    sys.exit(1)
print("ALL PASS")
