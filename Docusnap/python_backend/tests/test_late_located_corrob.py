#!/usr/bin/env python3
"""
test_late_located_corrob.py -- Stage-2.6b LATE LOCATED CROP-CORROBORATION
(gary design + Oracle SIGN-OFF-WITH-CONDITIONS, 2026-07-24; kill LATE_RESCUE_LOCATED_CORROB).

When the supplier resolves late, an owned authoritative anchor never runs, so a keyword-filled
critical ref/date is capped by the taught-ownership guard. Stage 2.6b re-runs just that anchor and
remembers a GENUINELY-LOCATED read so the UNCHANGED _anchor_corroborates suppresses the cap.

Two halves are pinned:
  (A) _filter_located_corrob -- the PURE filter (Oracle C1 located-only/whitelist, C2 near-taught
      fail-closed, C3 date-canonicalise). PIN A (blind read never remembered) + PIN B (far
      duplicate-label dropped) are the load-bearing safety pins: a future dev cannot loosen them
      without turning these red.
  (B) _flag_taught_field_ownership -- the guard consumes the remembered ledger: a located candidate
      matching the committed value suppresses the cap; nothing / a disagreeing value keeps it (PIN C).

Tesseract-free. Run: cd python_backend && PYTHONUTF8=1 py -3.12 tests/test_late_located_corrob.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extraction import engine, anchor, validator

FILTER = engine._filter_located_corrob
ND = validator.normalise_date
TOLX, TOLY = anchor._SAME_LAYOUT_TOL_X, anchor._SAME_LAYOUT_TOL_Y

fails = 0


def check(label, cond):
    global fails
    print(("OK   " if cond else "BAD  ") + label)
    if not cond:
        fails += 1


# Taught box for po_date (top-left) — the anchor the corroboration re-runs.
TAUGHT = {'po_date': {'x_norm': 0.83, 'y_norm': 0.167}}
DATEKEYS = {'po_date'}


def cand(value='18/11/2026', method='anchor_inline', located=True,
         box=(0.83, 0.167), authoritative=True):
    d = {'value': value, 'method': method, 'located': located, 'authoritative': authoritative}
    if box is not None:
        d['box'] = {'x_norm': box[0], 'y_norm': box[1], 'w_norm': 0.10, 'h_norm': 0.02}
    return {'po_date': d}


def filt(candidates):
    return FILTER(candidates, TAUGHT, DATEKEYS, TOLX, TOLY, ND)


print("=== (A) _filter_located_corrob — Oracle C1/C2/C3 ===")

# LIFT: a located, whitelisted, near-taught read is kept AND its date is canonicalised (C3).
_r = filt(cand('18/11/2026'))
check("LIFT: located anchor_inline near taught -> kept, date -> 18-11-2026",
      _r.get('po_date', {}).get('value') == '18-11-2026')

# C3: anchor_crop_relocated is also whitelisted; a ref-style value is NOT date-normalised.
check("C3: anchor_crop_relocated kept; canonical date via validator",
      filt(cand('18-11-2026', method='anchor_crop_relocated')).get('po_date', {}).get('value') == '18-11-2026')

# PIN A (blind-authoritative bypass) — a whitelisted method but located=False is DROPPED. This is
# the exact bypass Oracle flagged: _anchor_corroborates accepts `authoritative OR located`, so a
# blind authoritative read must never reach the ledger.
check("PIN A: located=False (blind) -> DROPPED (never remembered)",
      filt(cand(located=False)) == {})

# C1 method-whitelist: a rigid anchor_crop (no genuine locate, no value box) is DROPPED.
check("C1: rigid anchor_crop method -> DROPPED",
      filt(cand(method='anchor_crop')) == {})
check("C1: registration method -> DROPPED",
      filt(cand(method='anchor_registration')) == {})

# PIN B (far duplicate-label) — a located read whose value box is OUTSIDE the taught row is DROPPED
# (a second "Order Date" elsewhere reading a different value cannot vouch).
check("PIN B: located but box far in Y (0.5 vs 0.167) -> DROPPED",
      filt(cand(box=(0.83, 0.50))) == {})
check("PIN B: located but box far in X -> DROPPED",
      filt(cand(box=(0.10, 0.167))) == {})

# C2 fail-closed: no positional evidence -> DROPPED (never passed).
check("C2 fail-closed: box=None -> DROPPED",
      filt(cand(box=None)) == {})
check("C2 fail-closed: no taught anchor for the key -> DROPPED",
      FILTER(cand('18/11/2026'), {}, DATEKEYS, TOLX, TOLY, ND) == {})

# near-taught boundary: just inside the Y tolerance is kept.
check("near-taught: box within tolerance kept",
      filt(cand(box=(0.83, 0.167 + TOLY - 0.001))).get('po_date') is not None)

# empty / junk input never explodes.
check("empty input -> {}", filt({}) == {} and filt(None) == {})
check("no value -> dropped", FILTER({'po_date': {'method': 'anchor_inline', 'located': True}},
                                    TAUGHT, DATEKEYS, TOLX, TOLY, ND) == {})


# ── (B) the guard consumes the remembered ledger ─────────────────────────────────────────────
class _FakeEngine:
    def __init__(self, candidates):
        self._field_candidates = candidates

    def log(self, *a, **k):
        pass


def run_guard(ledger, committed='18-11-2026', method='keyword'):
    """Drive _flag_taught_field_ownership on one owned po_date field; return (confidence, has_note)."""
    self = _FakeEngine(ledger)
    results = {'po_date': {'value': committed, 'method': method, 'confidence': 98}}
    field_defs = [{'key': 'po_date', 'type': 'date', 'label': 'PO Date'},
                  {'key': 'supplier_name', 'label': 'Document Issuer'}]
    anchors = [{'field_key': 'po_date', 'last_authoritative_at': '2026-07-01',
                'supplier_name': 'Thornbury Fasteners', 'document_type': 'purchase_order'}]
    _orig = anchor.anchor_admissible
    anchor.anchor_admissible = lambda a, s, d: True   # isolate: this owned anchor is admissible
    try:
        engine.ExtractionEngine._flag_taught_field_ownership(
            self, results, field_defs, 'Thornbury Fasteners', anchors, [], 'purchase_order', {})
    finally:
        anchor.anchor_admissible = _orig
    d = results['po_date']
    return d.get('confidence'), bool(str(d.get('validation_note') or '').strip())


def ledger(value='18-11-2026', located=True, authoritative=True):
    return {'po_date': [{'value': value, 'method': 'anchor_inline', 'stage': '2.6_late_corrob',
                         'located': located, 'authoritative': authoritative,
                         'box': {'x_norm': 0.83, 'y_norm': 0.167, 'w_norm': 0.1, 'h_norm': 0.02}}]}


print("\n=== (B) taught-ownership guard consumes the ledger ===")

# Control: NO corroboration -> the guard caps the keyword read to 69 + note (proves the guard ran).
_c, _n = run_guard({'po_date': []})
check("control: no ledger candidate -> capped 69 + note", _c == 69 and _n)

# LIFT: a located candidate matching the committed value -> guard does NOT cap.
_c, _n = run_guard(ledger('18-11-2026'))
check("LIFT: located candidate == committed -> NOT capped (98, no note)", _c == 98 and not _n)

# PIN C (date fail-closed on the compare side): a located but calendar-DIFFERENT date does NOT vouch.
_c, _n = run_guard(ledger('19-11-2026'))
check("PIN C: located candidate with a DIFFERENT date -> still capped 69", _c == 69 and _n)

# Defence-in-depth at the guard: even if a blind (located=False, authoritative=True) candidate
# somehow reached the ledger, _anchor_corroborates still accepts it via `authoritative` — which is
# EXACTLY why the FILTER (PIN A) must drop it upstream. This documents the guard's shared behaviour.
_c, _n = run_guard(ledger('18-11-2026', located=False, authoritative=True))
check("guard note: a blind authoritative ledger entry WOULD vouch (hence PIN A upstream)", _c == 98)


print("\n=== kill switch ===")
check("LATE_RESCUE_LOCATED_CORROB default ON (Oracle-signed 2026-07-24; set =0 for byte-identical off)",
      engine.LATE_RESCUE_LOCATED_CORROB is True)

if fails:
    print(f"\n{fails} FAIL(s)")
    sys.exit(1)
print("\nALL PASS")
