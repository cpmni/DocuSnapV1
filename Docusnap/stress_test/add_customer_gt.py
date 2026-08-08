"""One-off ground_truth.json enrichment (2026-08-05): add the RECIPIENT ("customer")
to every row of the existing Desktop corpus WITHOUT regenerating a single PDF — the
value is already printed on every page (draw_parties renders the owner company's block
under Bill To/Customer/Deliver To on every type), so only the truth file was missing
it. Keeping the PDFs byte-identical preserves comparability with every prior arm TAG.

The generator now writes the field itself (gen_customer_test.py gt dict), so this
script only matters for corpora generated before 2026-08-05. Idempotent.

Run: py -3.12 stress_test/add_customer_gt.py
"""
import json
from pathlib import Path

OWNER_NAME = "Bramblewood Joinery Ltd"
GT_PATH = Path.home() / "Desktop" / "Customer Doc Test" / "ground_truth.json"

gt = json.loads(GT_PATH.read_text(encoding="utf-8"))
added = sum(1 for e in gt if "customer" not in e)
for e in gt:
    e.setdefault("customer", OWNER_NAME)
GT_PATH.write_text(json.dumps(gt, indent=1), encoding="utf-8")
print(f"{len(gt)} rows; customer added to {added} (idempotent — 0 on rerun)")
