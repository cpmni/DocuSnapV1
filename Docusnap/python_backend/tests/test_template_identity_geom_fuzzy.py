"""GRADUATION-LICENSED FUZZY GEOMETRY SHED (gary -> Oracle SIGN-OFF-W/COND 2026-08-14).

The owner's Silverbeck class: a layout confirmed 91x/91 to ONE issuer whose SCANNED letterhead
reads garbled still carries "Company inferred from previously filed documents on this layout -
please confirm before filing." on every sibling, because the strict geometry shed needs an EXACT
letterhead match. `_should_shed_fill_note_geom_fuzzy` sheds the note when the SAME recipient-excluded
geometry pick reads the graduated issuer FUZZILY -- short tokens stay exact (Oracle C2), the fuzz is
licensed only by >=window/>=0.9-share human graduation (C3-idiom OFF byte-identical), and rapidfuzz is
lazy with a stdlib fallback (C4). This tests the PURE predicate directly (the whole arm is one fn).

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_template_identity_geom_fuzzy.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extraction import engine as E   # noqa: E402

fails = 0


def check(label, cond):
    global fails
    print(f"  {'ok ' if cond else 'BAD'} {label}")
    if not cond:
        fails += 1


ARMED = {"TEMPLATE_IDENTITY_GEOM_FUZZY_GRADUATE": "1"}
NOTE = E._TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY
W = 5   # graduation window


def fill(value, method="template_identity", note=NOTE):
    return {"method": method, "value": value, "validation_note": note}


SILVER = "Silverbeck Cleaning Supplies"

# ── 1. THE SHED (the owner's exhibit) ────────────────────────────────────────────────────────────
# 91/91 unanimous, garbled letterhead ('l'->'1' twice) -> shed.
check("garbled Silverbeck letterhead on a 91/91 layout SHEDS",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck C1eaning Supplies", 91, 91, W, env=ARMED) is True)

# ── 2. GRADUATION LICENSE (PIN — a thin / split layout never earns fuzz) ─────────────────────────
check("a 2/2 layout KEEPS the note (below the window, no fuzz license)",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck C1eaning Supplies", 2, 2, W, env=ARMED) is False)
check("a 6/10 split (share 0.6) KEEPS the note",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck C1eaning Supplies", 6, 10, W, env=ARMED) is False)
check("exactly window confirms, unanimous, SHEDS (boundary)",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck Cleaning Supplies", W, W, W, env=ARMED) is True)

# ── 3. RECIPIENT / BUYER-ISSUED (PIN the accepted safety) ────────────────────────────────────────
# The geometry pick reads the OWNER's own letterhead (a PO the business issued) — not the graduated
# supplier — so the fuzzy all-tokens match fails and the note is KEPT. This is the whole safety.
check("a recipient/owner letterhead ('Bramblewood Joinery') KEEPS the note",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Bramblewood Joinery Ltd", 91, 91, W, env=ARMED) is False)

# ── 4. SHORT-TOKEN EXACTNESS (PIN — Oracle C2) ───────────────────────────────────────────────────
# A 3-5 char distinctive token must match EXACTLY; a one-edit collision must NOT shed.
check("'Ace Cleaning' vs 'Ale Cleaning' KEEPS (short token 'ace' must be exact, not fuzzy)",
      E._should_shed_fill_note_geom_fuzzy(fill("Ace Cleaning"), "Ale Cleaning", 91, 91, W, env=ARMED) is False)
check("'Ace Cleaning' vs 'Ace Cleaning' SHEDS (short token exact-matches)",
      E._should_shed_fill_note_geom_fuzzy(fill("Ace Cleaning"), "Ace Cleaning", 91, 91, W, env=ARMED) is True)

# ── 5. FUZZ FLOOR — a genuinely different company that garble-collides is KEPT ────────────────────
check("'Silverbeck…' vs 'Silvercrest Ltd' KEEPS (different company beyond the per-token budget)",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Silvercrest Ltd", 91, 91, W, env=ARMED) is False)

# ── 6. FLAG OFF / NO WITNESS / IDEMPOTENT (PIN the trade-offs) ────────────────────────────────────
check("flag OFF (default) -> never sheds (byte-identical)",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck C1eaning Supplies", 91, 91, W, env={}) is False)
check("no geometry witness (None — a cached-text reprocess) KEEPS the note",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), None, 91, 91, W, env=ARMED) is False)
check("empty geometry witness KEEPS the note",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "   ", 91, 91, W, env=ARMED) is False)
check("IDEMPOTENT — an already-shed row (method template_identity_corroborated) never re-fires",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER, method="template_identity_corroborated"),
                                          "Si1verbeck C1eaning Supplies", 91, 91, W, env=ARMED) is False)
check("a non-fill supplier (template_fixed) is untouched",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER, method="template_fixed", note=None),
                                          "Silverbeck Cleaning Supplies", 91, 91, W, env=ARMED) is False)
check("a fill with NO note (already clean) is untouched",
      E._should_shed_fill_note_geom_fuzzy(fill(SILVER, note=None),
                                          "Si1verbeck C1eaning Supplies", 91, 91, W, env=ARMED) is False)

# ── 7. THE DISTANCE BACKEND (PIN Oracle C4 — the stdlib fallback is correct) ──────────────────────
check("bounded Levenshtein: identical -> 0", E._bounded_edit_distance("silverbeck", "silverbeck", 2) == 0)
check("bounded Levenshtein: one edit -> 1", E._bounded_edit_distance("silverbeck", "si1verbeck", 2) == 1)
check("bounded Levenshtein: early-exit over budget", E._bounded_edit_distance("silverbeck", "silvercrest", 1) == 2)
check("_token_within budget 0 is EXACT", E._token_within("ace", "ale", 0) is False and E._token_within("ace", "ace", 0) is True)
check("_token_within budget 1 tolerates one edit", E._token_within("silverbeck", "si1verbeck", 1) is True)
# Force rapidfuzz absent -> the fallback still answers (the arm never bets on rapidfuzz).
import builtins  # noqa: E402
_real_import = builtins.__import__
def _no_rapidfuzz(name, *a, **k):
    if name.startswith("rapidfuzz"):
        raise ImportError("blocked for the pin")
    return _real_import(name, *a, **k)
builtins.__import__ = _no_rapidfuzz
try:
    check("rapidfuzz BLOCKED -> stdlib fallback still matches the garble (fail-safe, C4)",
          E._token_within("silverbeck", "si1verbeck", 1) is True
          and E._should_shed_fill_note_geom_fuzzy(fill(SILVER), "Si1verbeck C1eaning Supplies", 91, 91, W, env=ARMED) is True)
finally:
    builtins.__import__ = _real_import

if fails:
    print(f"\n{fails} FAILED")
    sys.exit(1)
print("\nAll graduation-fuzzy-shed checks passed.")
sys.exit(0)
