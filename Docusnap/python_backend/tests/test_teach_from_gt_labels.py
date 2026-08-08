"""Pins for stress_test/teach_from_gt.py's label-quality discipline (Oracle 2026-08-05,
Slice A — harness teach fidelity). The harness's find_label used to store a neighbouring
VALUE as the anchor label on columnar layouts (48/310 taught mappings — a date field
anchored on the ref value 'VXC4484'), structurally killing every label-anchored heal in
the taught arm. _clean_label_run mirrors the live wizard's rules
(src/windows/shared/anchorLabel.js sanitizeAnchorLabel + the value-shape strip).

Run: py -3.12 python_backend/tests/test_teach_from_gt_labels.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stress_test"))
import teach_from_gt as tfg

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


def W(text, x, y=0.5, w=0.05, h=0.01):
    return {"text": text, "x": x, "y": y, "w": w, "h": h}


def row(words, c=0.5, h=0.01):
    return {"c": c, "h": h, "words": sorted(words, key=lambda w: w["x"])}


def hit_for(run, r):
    return {"run": run, "row": r}


# ── _clean_label_run token rules (sanitizeAnchorLabel parity) ────────────────
check("real caption survives verbatim ('Invoice No.')",
      [w["text"] for w in tfg._clean_label_run([W("Invoice", 0.1), W("No.", 0.16)])]
      == ["Invoice", "No."])
check("standalone '#' kept ('SO #')",
      [w["text"] for w in tfg._clean_label_run([W("SO", 0.1), W("#", 0.14)])] == ["SO", "#"])
check("bare date token dropped, caption kept ('Date: 07-01-2026' -> 'Date:')",
      [w["text"] for w in tfg._clean_label_run([W("Date:", 0.1), W("07-01-2026", 0.16)])]
      == ["Date:"])
check("all-value run rejected (a bare code)",
      tfg._clean_label_run([W("VXC4484", 0.1)]) is None)
check(">=3-digit code-like token dropped even with letters ('INV12345')",
      tfg._clean_label_run([W("INV12345", 0.1)]) is None)
check("no-letter-survivor run rejected (bare number)",
      tfg._clean_label_run([W("12345", 0.1)]) is None)

# ── own-GT-value rejection (the 48/310 disease) ──────────────────────────────
gt = {tfg.norm(v) for v in ("VXC4484", "03-06-2026", "Veltrix Automotive Parts")}
check("run equal to another field's GT value rejected even though letter-bearing",
      tfg._clean_label_run([W("VXC4484", 0.1)], gt) is None)
check("kept-token join equal to a GT value rejected",
      tfg._clean_label_run([W("Veltrix", 0.1), W("Automotive", 0.16), W("Parts", 0.24)], gt)
      is None)
check("real caption unaffected by GT set",
      [w["text"] for w in tfg._clean_label_run([W("Credit", 0.1), W("Date", 0.16)], gt)]
      == ["Credit", "Date"])

# ── find_label ladder: rejected LEFT falls to ABOVE; both rejected -> None ───
# Same-row left neighbour is the ref VALUE; the row above carries the real caption.
val = W("03-06-2026", 0.30, y=0.50, w=0.07)
r_val = row([W("VXC4484", 0.20, y=0.50, w=0.06), val], c=0.505)
r_above = row([W("Credit", 0.29, y=0.485, w=0.04), W("Date", 0.335, y=0.485, w=0.03)], c=0.49)
rows = [r_above, r_val]
lbl = tfg.find_label(rows, hit_for([val], r_val), gt)
check("left VALUE rejected -> falls to ABOVE caption ('Credit Date')",
      lbl is not None and " ".join(w["text"] for w in lbl) == "Credit Date")

# PIN the trade-off (gary A, test e): an all-value left column with NO caption above
# returns None (position-only) — a future dev can't 'improve' recall by re-admitting
# value runs as labels.
r_val2 = row([W("VXC4484", 0.20, y=0.50, w=0.06), val], c=0.505)
lbl2 = tfg.find_label([r_val2], hit_for([val], r_val2), gt)
check("PIN: all-value neighbourhood -> None (position-only), never a value-as-label",
      lbl2 is None)

# Untouched happy path: real same-row caption still wins directly.
v3 = W("VXC9999", 0.30, y=0.60, w=0.06)
r3 = row([W("Credit", 0.16, y=0.60, w=0.045), W("Note", 0.21, y=0.60, w=0.032),
          W("No:", 0.245, y=0.60, w=0.02), v3], c=0.605)
lbl3 = tfg.find_label([r3], hit_for([v3], r3), gt)
check("real same-row caption still returned ('Credit Note No:')",
      lbl3 is not None and " ".join(w["text"] for w in lbl3) == "Credit Note No:")

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All teach_from_gt label-discipline checks passed.")
