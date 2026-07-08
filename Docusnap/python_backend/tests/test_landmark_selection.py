#!/usr/bin/env python3
"""
tests/test_landmark_selection.py
--------------------------------
Phase 2 (value-zone exclusion) + Phase 3 (cross-sample recurrence) landmark
selection — the AUTOMATIC, no-human-judgement path that replaces manual picking.

    py -3.12 python_backend/tests/test_landmark_selection.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ocr.landmarks import select_landmarks, select_cross_sample, _overlaps  # noqa: E402

FAILS = 0


def check(label, cond):
    global FAILS
    if not cond:
        FAILS += 1
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    return bool(cond)


def W(text, x, y, conf=95, w=0.08, h=0.02):
    return {"text": text, "conf": conf, "x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


# ── Phase 2: value-zone exclusion ────────────────────────────────────────────
print("select_landmarks(exclude_boxes):")
words = [W("SERVICE", 0.60, 0.03), W("Invoice", 0.05, 0.30), W("Customer", 0.05, 0.50)]
# Exclude the zone around "Customer" (a taught value/anchor box).
got = select_landmarks(words, exclude_boxes=[{"x": 0.04, "y": 0.49, "w": 0.10, "h": 0.04}])
labels = {l["label_text"] for l in got}
check("a word inside an excluded value zone is dropped", "Customer" not in labels)
check("words outside excluded zones are kept", {"SERVICE", "Invoice"} <= labels)
check("no exclusion -> all kept (byte-identical path)",
      len(select_landmarks(words)) == 3)
check("_overlaps true on intersection", _overlaps((0.05, 0.50, 0.08, 0.02), [(0.04, 0.49, 0.10, 0.04)]))
check("_overlaps false when disjoint", not _overlaps((0.6, 0.03, 0.08, 0.02), [(0.04, 0.49, 0.10, 0.04)]))

# ── Phase 3: cross-sample recurrence ─────────────────────────────────────────
print("select_cross_sample:")

# 3 docs. STABLE chrome ("Worksheet","Symptom","Signature") recurs at the same
# spot; a VALUE ("Beaumont"/"Rasaimant"/"Crawford") differs each doc; "Ticket"
# appears 4x per page (ambiguous); a word that recurs but MOVES is unstable.
def doc(value_word, ticket_y0):
    return [
        W("Worksheet", 0.70, 0.03),
        W("Symptom",   0.05, 0.40),
        W("Signature", 0.60, 0.92),
        W(value_word,  0.62, 0.14),                     # the per-doc VALUE (varies)
        W("Ticket", 0.05, ticket_y0), W("Ticket", 0.05, ticket_y0 + 0.04),
        W("Ticket", 0.05, ticket_y0 + 0.08), W("Ticket", 0.05, ticket_y0 + 0.12),
    ]

docs = [doc("Beaumont", 0.11), doc("Rasaimant", 0.11), doc("Crawford", 0.11)]
got = select_cross_sample(docs)
labels = {l["label_text"] for l in got}
check("stable recurring chrome selected (Worksheet/Symptom/Signature)",
      {"Worksheet", "Symptom", "Signature"} <= labels)
check("per-document VALUE not selected (Beaumont/Rasaimant/Crawford)",
      not ({"Beaumont", "Rasaimant", "Crawford"} & labels))
check("page-ambiguous word 'Ticket' (x4/page) not selected", "Ticket" not in labels)

# A word present in only 1 of 3 docs must be dropped (k-of-N, need >= ceil(0.6*3)=2).
docs2 = [
    [W("Worksheet", 0.70, 0.03), W("Oneoff", 0.30, 0.50)],
    [W("Worksheet", 0.70, 0.03)],
    [W("Worksheet", 0.70, 0.03)],
]
labels2 = {l["label_text"] for l in select_cross_sample(docs2)}
check("word in only 1/3 docs dropped (k-of-N)", "Oneoff" not in labels2)
check("word in 3/3 docs kept", "Worksheet" in labels2)

# A word that recurs in all docs but at a MOVING position is unstable -> dropped.
docs3 = [
    [W("Worksheet", 0.70, 0.03), W("Drifter", 0.20, 0.20)],
    [W("Worksheet", 0.70, 0.03), W("Drifter", 0.20, 0.40)],
    [W("Worksheet", 0.70, 0.03), W("Drifter", 0.20, 0.60)],
]
labels3 = {l["label_text"] for l in select_cross_sample(docs3)}
check("recurring-but-moving word dropped (positional stability)", "Drifter" not in labels3)
check("stable word still kept alongside", "Worksheet" in labels3)

# Value-zone exclusion also applies through the cross-sample path.
labels4 = {l["label_text"] for l in select_cross_sample(
    docs, exclude_boxes=[{"x": 0.04, "y": 0.39, "w": 0.10, "h": 0.04}])}
check("excluded zone removes 'Symptom' via cross-sample too", "Symptom" not in labels4)

print(f"\n{'ALL PASS' if FAILS == 0 else str(FAILS) + ' FAILED'}")
sys.exit(1 if FAILS else 0)
