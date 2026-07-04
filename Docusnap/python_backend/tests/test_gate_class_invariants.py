#!/usr/bin/env python3
"""
PERMANENT CLASS-GUARD for the Stage 4.5 format gate (format_anomaly_checker).

The recurring bug class this session: the gate OVER-FIRES on legitimately-variable data — it
WITHHOLDS / TRUNCATES / CORRUPTS a value whose shape/separator is under-represented. Instead of
guarding each fixed instance with a hand-picked case, this asserts the underlying INVARIANTS over a
GENERATED matrix (deterministic — no Hypothesis dependency, so it always runs), so a NEW instance of
the class trips it too. All invariants must hold:

  A. MAGNITUDE / SIGN — on a money corpus, extract_accepted_shape never MERGES two amounts and never
     strips a sign: given "a b" it returns None or exactly one WHOLE amount; "-x" is never "x".
  B. IDEMPOTENCE — a value whose folded shape is already ACCEPTED is never rewritten (eas -> None).
  C. NO MID-CODE TRUNCATION — a space-free (contiguous) value is returned WHOLE or not at all
     (eas(v) in {None, v}); a valid longer code is never trimmed to a shorter slice.
  D. FOLDED-FAMILY ACCEPTANCE — a length variant of a running-number shape, or an interchangeable
     ref-separator variant, is NOT flagged.
  E. STRUCTURE STILL ENFORCED — a value with a different GROUP STRUCTURE is still flagged (the guard
     is relaxed on length/separator, NEVER on structure), so mis-structured refs/garbage are caught.

Run: py -3.12 python_backend/tests/test_gate_class_invariants.py   (exit 0 = all invariants hold)
Designed with gary (format-gate audit). Guards: numeric-recovery corruption, single-run fold,
continuing-code guard, interchangeable ref separators.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction.format_anomaly_checker import (
    classify_format, check_value, extract_accepted_shape, _fold_shape, shape_signature,
)

fails = []
def fail(msg):
    fails.append(msg)
    print("  FAIL", msg)

def entry(values):
    counts = {v: 1 for v in values}
    return classify_format(list(counts), counts)


# ── A. MAGNITUDE / SIGN ────────────────────────────────────────────────────────
print("A. magnitude/sign: extract_accepted_shape never merges two amounts or strips a sign")
money = entry([f"{i}.{i % 100:02d}" for i in range(20, 90)])          # shapes == {'#.#'}
amounts = ["0.00", "5.50", "84.40", "699.20", "1,234.56", "4,699.20", "12.05", "1 234.56"]
checked_a = 0
for a in amounts:
    for b in amounts:
        for sep in (" ", "  "):
            out = extract_accepted_shape(f"{a}{sep}{b}", money)
            if out is not None and out != a and out != b:
                fail(f"A merge/partial: {a!r}{sep!r}{b!r} -> {out!r}")
            checked_a += 1
for a in amounts:
    if extract_accepted_shape(f"-{a}", money) == a:
        fail(f"A sign stripped: '-{a}' -> {a!r}")
    checked_a += 1
print(f"   {checked_a} amount pairs/signs checked")


# ── B. IDEMPOTENCE ─────────────────────────────────────────────────────────────
print("B. idempotence: an already-accepted value is never rewritten")
for values in (["INV001", "INV002", "INV003"],
               ["1234-5678-9", "2603-1351-1", "7602-1354-4"],
               [f"{i}.{i % 100:02d}" for i in range(20, 90)],
               [str(40000 + i) for i in range(70)]):
    e = entry(values)
    shapes = e.get('shapes') or frozenset()
    for v in values:
        if _fold_shape(shape_signature(v)) in shapes and extract_accepted_shape(v, e) is not None:
            fail(f"B rewrote an accepted value {v!r} (shapes {sorted(shapes)})")


# ── C. NO MID-CODE TRUNCATION ──────────────────────────────────────────────────
print("C. no mid-code truncation: a space-free value is returned WHOLE or None")
contiguous = ["5678-1234", "1234-5678-9", "12345", "1234ABCD", "AB-126", "INV1234",
              "84.40credit", "2605-0769-1", "9999/9999/9", "40000"]
corpora_c = [{"shapes": frozenset({"#", "####-####-#"})}, money,
             entry(["INV001", "INV002", "INV003"]),
             entry(["1234-5678-9", "2603-1351-1", "7602-1354-4"])]
for h in corpora_c:
    for v in contiguous:
        out = extract_accepted_shape(v, h)
        if out is not None and out != v:
            fail(f"C truncated a contiguous value: {v!r} (shapes {sorted(h.get('shapes', []))}) -> {out!r}")


# ── D. FOLDED-FAMILY ACCEPTANCE ────────────────────────────────────────────────
print("D. folded-family acceptance: length / interchangeable-separator variants not flagged")
inv = entry([f"INV{100 + i}" for i in range(20)])                      # @@@### running number
for v in ("INV1", "INV12345", "INV999999"):
    if check_value(v, inv) is not None:
        fail(f"D length variant flagged: {v!r} vs INV### corpus")
absl = entry([f"AB/{100 + i}" for i in range(12)])                     # AB/### separator '/'
for v in ("AB-126", "AB.126", "AB/126"):
    if check_value(v, absl) is not None:
        fail(f"D separator variant flagged: {v!r} vs AB/### corpus")
dig = entry([str(40000 + i) for i in range(70)])                       # 5-digit numbers
for v in ("152567", "1234567", "42"):
    if check_value(v, dig) is not None:
        fail(f"D digit-length variant flagged: {v!r} vs 5-digit corpus")


# ── E. STRUCTURE STILL ENFORCED ────────────────────────────────────────────────
print("E. structure still enforced: a different group structure is still flagged")
multi = entry([f"{1000 + i}-{2000 + i}-{i % 9}" for i in range(12)])   # ####-####-#
for v in ("9999-9999", "1234", "12-34-56-78", "AB-CD-EF"):
    if check_value(v, multi) is None:
        fail(f"E mis-structured value NOT flagged: {v!r} vs ####-####-# corpus")
# a WORD on a numeric field is still caught
if check_value("Aurora", dig) is None:
    fail("E a word 'Aurora' NOT flagged on a digits corpus")


if fails:
    print(f"\n{len(fails)} INVARIANT VIOLATION(S)")
    sys.exit(1)
print("\nAll format-gate class invariants hold.")
