#!/usr/bin/env python3
"""tests/test_format_anomaly_variance.py — FORMAT_VARIANCE_RELAX
(2026-09-02, the Print Tracker make/model/serial noise; reggie + gary → Oracle SIGN-OFF-W/COND, DARK).

The Stage-4.5 "format differs from the usual — please verify" shape flag is CORRECT for a field with
a real dominant format (invoice/PO/account numbers) but pure NOISE for a field whose confirmed history
varies WILDLY (make/model/serial — every manufacturer a different structure, so there is no "usual
format" to differ from). When ON, the ENGINE's OWN text-field shape flag is suppressed on such a
field — but a single letter<->digit OCR SLIP off a confirmed value STILL flags (and offers the
confirmed value).

Oracle conditions PINNED here:
  • C1 — the relaxation is a PER-CALLER gate at the engine's terminal WRITE, NOT an early return in
    check_value; the mapper's DERIVED rungs (which call the same check_value) keep their review cap.
    Pinned two ways: check_value flags a high-variance value REGARDLESS of the flag (byte-identical),
    and the engine source carries the guard inside the text branch only, before the text "format
    differs" write.
  • C2 — FAIL-TOWARD-FLAGGING: _has_no_usual_format is False on any thin/absent signal.
  • C3 — the charset/impossible legs of check_value return BEFORE the shape leg, so they still fire.
  • C5 — the retained near-miss slip-catch: same-length single letter<->digit substitution off a
    confirmed value; digit<->digit EXCLUDED; substitution-only; never auto-applied.
  • Q2 — ref-role/structured fields are NOT in the text branch, so they are untouched.
  • the length-aware diversity signal (shape_families via shape_signature, NOT the length-blind
    _fold_shape) — different-length serials do not collapse into one family.
  • flag defaults OFF (DARK).

Run: PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_format_anomaly_variance.py
"""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop('FORMAT_VARIANCE_RELAX', None)
from extraction import format_anomaly_checker as f   # noqa: E402
import extraction.engine as E                         # noqa: E402

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


# ── flag defaults OFF (DARK) ─────────────────────────────────────────────────────
check("FORMAT_VARIANCE_RELAX defaults OFF in the checker (DARK)", f._FORMAT_VARIANCE_RELAX is False)
check("_FORMAT_VARIANCE_RELAX defaults OFF in the engine (DARK)", E._FORMAT_VARIANCE_RELAX is False)

# ── the two PURE predicates the engine caller reads ──────────────────────────────
# A high-variance scope: >=3 length-aware shape families, >=8 confirms, no dominant.
VC_HIVAR = {'TASKalfa 3252ci': 4, 'Ecosys PA2600cwx': 4, 'MP C4504ex': 3, 'AR-6020N': 3}
FE_HIVAR = {'class': 'alphanum_sep', 'shapes': frozenset(['@@@@@@@@ #@@']),
            'shape_families': f.shape_families(VC_HIVAR), 'value_counts': dict(VC_HIVAR)}
check("_has_no_usual_format TRUE on a high-variance scope (4 families, 14 confirms, none dominant)",
      f._has_no_usual_format(FE_HIVAR) is True)

# A dominant scope: one shape holds >=50% -> a real usual format exists.
VC_DOM = {'INV-0001': 6, 'INV-0002': 4, 'INV-9999': 1}
FE_DOM = {'class': 'alphanum_sep', 'shape_families': f.shape_families(VC_DOM), 'value_counts': dict(VC_DOM)}
check("_has_no_usual_format FALSE when a shape dominates (INV-#### is the usual format)",
      f._has_no_usual_format(FE_DOM) is False)

# C2 fail-toward-flagging: thin / absent signals never suppress.
check("C2: _has_no_usual_format FALSE with fewer than 3 families",
      f._has_no_usual_format({'shape_families': f.shape_families({'AA-11': 5, 'BB-22': 5})}) is False)
check("C2: _has_no_usual_format FALSE below 8 total confirms even with 3 families",
      f._has_no_usual_format({'shape_families': f.shape_families({'A1': 2, 'AB2': 2, 'ABC3': 2})}) is False)
check("C2: _has_no_usual_format FALSE when the families view is absent AND no value_counts",
      f._has_no_usual_format({'class': 'alphanum', 'shapes': frozenset(['@@'])}) is False)
check("C2: _has_no_usual_format FALSE on an empty entry / None",
      f._has_no_usual_format({}) is False and f._has_no_usual_format(None) is False)

# length-aware diversity: different-LENGTH digit serials must stay DISTINCT families (shape_signature,
# not the length-blind _fold_shape) — otherwise every digit serial folds to one '#' family and the
# diversity measure would never reach 3.
VC_LEN = {'12': 3, '1234': 3, '123456': 3, '12345678': 3}
fams_len = f.shape_families(VC_LEN)
check("length-aware: four different-length digit serials give four DISTINCT shape families",
      len(fams_len) == 4)
check("length-aware: that scope reads as high-variance (would be 1 family under a length-blind fold)",
      f._has_no_usual_format({'shape_families': fams_len, 'value_counts': VC_LEN}) is True)

# ── C5: the retained near-miss slip-catch ────────────────────────────────────────
check("near-miss: a single letter<->digit slip ('AR-602ON' vs 'AR-6020N') offers the confirmed value",
      f.near_miss_confirmed('AR-602ON', {'value_counts': {'AR-6020N': 3}}) == 'AR-6020N')
check("near-miss: O(letter)/0(digit) confusable is caught",
      f.near_miss_confirmed('AR-6O20N', {'value_counts': {'AR-6020N': 3}}) == 'AR-6020N')
check("near-miss: digit<->digit is EXCLUDED ('...0006' vs '...0008' is not a slip)",
      f.near_miss_confirmed('INV-0006', {'value_counts': {'INV-0008': 3}}) is None)
check("near-miss: letter<->letter is EXCLUDED (only cross letter/digit confusables)",
      f.near_miss_confirmed('ABCDE', {'value_counts': {'ABCDF': 3}}) is None)
check("near-miss: a two-character difference is NOT a single slip",
      f.near_miss_confirmed('AR-6O2ON', {'value_counts': {'AR-6020N': 3}}) is None)
check("near-miss: different length -> no substitution slip",
      f.near_miss_confirmed('ABCDE', {'value_counts': {'ABCD': 3}}) is None)
check("near-miss: absent value_counts -> nothing to offer (fail toward no suggestion)",
      f.near_miss_confirmed('AR-602ON', {'class': 'alphanum_sep'}) is None)
check("near-miss: on a clean value equal to a confirmed one -> None (no false slip)",
      f.near_miss_confirmed('AR-6020N', {'value_counts': {'AR-6020N': 3}}) is None)

# ── C1: check_value is BYTE-IDENTICAL — no early return keyed on the flag ─────────
# Suppression lives ONLY at the engine caller, so check_value flags the exact same anomaly whether
# the flag is on or off. (Proves the mapper's derived rungs, which call check_value, are untouched.)
NEW_MODEL = 'Bizhub C258'
an_off = f.check_value(NEW_MODEL, FE_HIVAR)
os.environ['FORMAT_VARIANCE_RELAX'] = '1'
import importlib   # noqa: E402
importlib.reload(f)
an_on = f.check_value(NEW_MODEL, FE_HIVAR)
os.environ.pop('FORMAT_VARIANCE_RELAX', None)
importlib.reload(f)
check("C1: check_value returns the SAME shape anomaly with the flag ON as OFF (no early return in it)",
      an_off is not None and an_on is not None and an_off == an_on)

# ── C3: the charset leg returns BEFORE the shape leg — still fires ────────────────
check("C3: a hard charset/class violation still flags high (returns before the shape leg)",
      (f.check_value('12A45', {'class': 'digits_only'}) or {}).get('severity') == 'high')

# ── build_format_class_index threads the predicates' inputs onto the entry ────────
idx = f.build_format_class_index([{
    'field_key': 'model', 'supplier_name': 'Print Tracker', 'document_type': 'print_tracker',
    'sample_values': list(VC_HIVAR.keys()), 'value_counts': dict(VC_HIVAR), 'confirmed_count': 14,
}])
fe = idx.get(('print tracker', 'print_tracker', 'model'))
check("index: the high-variance model scope is KEPT (alphanum_sep, not dropped as freetext)", fe is not None)
check("index: value_counts is threaded onto the entry (near-miss needs the literals)",
      bool(fe) and 'value_counts' in fe)
check("index: shape_families is threaded onto the entry (diversity signal)",
      bool(fe) and 'shape_families' in fe and len(fe['shape_families']) >= 3)
check("index: the built entry reads as high-variance end-to-end",
      bool(fe) and f._has_no_usual_format(fe) is True)

# ── the engine WRITE-SITE guard (mechanical — Oracle C1: deleting the leg fails this file) ─────────
src = Path(E.__file__).read_text(encoding='utf-8')
# The guard must sit in the TEXT branch, before the text "format differs" write, and do the near-miss
# + continue. Assert the shape: the _FORMAT_VARIANCE_RELAX + _has_no_usual_format conjunction, then a
# near_miss_confirmed call, then the text "format differs from the usual" write STILL below it.
guard = re.search(
    r"_FORMAT_VARIANCE_RELAX\s*\\?\s*\n?\s*and\s+format_anomaly_checker\._has_no_usual_format\(fmt_entry\)",
    src)
check("engine: the text-branch variance guard exists (_FORMAT_VARIANCE_RELAX and _has_no_usual_format)",
      guard is not None)
if guard:
    # Window widened 900 -> 4200 (2026-09-04): the RESOLVE_REF_NEAR_MISS (leg-b) AND RESOLVE_REF_POSITIONAL
    # (leg-a) blocks now sit between the guard and the near_miss_confirmed suggestion (still followed by the
    # text-write below), so the slip-catch is further down but structurally unchanged.
    tail = src[guard.start():guard.start() + 4200]
    check("engine: the guard calls near_miss_confirmed (the retained slip-catch)",
          'near_miss_confirmed' in tail)
    check("engine: the guard suppresses via a bare continue (no unconditional flag write)",
          re.search(r"\n\s+continue\b", tail) is not None)
    check("engine: the plain 'format differs' text write STILL follows the guard (only suppressed when it fires)",
          "format differs from the usual" in src[guard.start():])
# exactly ONE variance guard in the engine (text branch only — the structured/ref branch is untouched, Q2)
check("engine: exactly ONE _has_no_usual_format guard site (text branch only — ref/structured untouched, Q2)",
      len(re.findall(r"_has_no_usual_format\(fmt_entry\)", src)) == 1)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All FORMAT_VARIANCE_RELAX pins hold.")
