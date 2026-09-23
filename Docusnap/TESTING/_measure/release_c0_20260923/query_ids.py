#!/usr/bin/env python3
"""C0 (Oracle 2026-09-23, confusable RELEASE): find the owner's CONFIRMED docs that are the 18 soften-set
documents of the filtered `_absent` census, in a READ-ONLY copy of the live DB, and print their ids as an
RR_IDS list + the switch state the harness will mirror. Never touches the live DB.

Usage: py -3.12 query_ids.py "<path to copied docusnap.db>"
"""
import sqlite3, sys, json

DB = sys.argv[1]
# the 18 soften rows (census doc stems) — matched on original_filename, not the ref (a confirm may have fixed it)
STEMS = [
    "CopperfieldElectrical_purchase_order_07", "MarloweMedicalSupplies_purchase_order_09",
    "Pelican-Office_invoice_0025", "Pelican-Office_invoice_0044", "RidgewayPlantHire_sales_order_12",
    "SaltmarshSeafoods_purchase_order_05", "SaltmarshSeafoods_sales_order_16",
    "ThornburyFasteners_purchase_order_07", "ThornburyFasteners_purchase_order_16",
    "ThornburyFasteners_sales_order_05", "ThornburyFasteners_sales_order_12", "ThornburyFasteners_sales_order_16",
    "Vellum&CraneStationers_purchase_order_01", "Vellum&CraneStationers_purchase_order_17",
    "Vellum&CraneStationers_sales_order_03", "Vellum&CraneStationers_sales_order_06",
    "Vellum&CraneStationers_sales_order_09", "Vellum&CraneStationers_sales_order_16",
]
SETTINGS = ["filing_value_sanity_flags", "filing_sanity_confusable_soften", "filing_sanity_ref_corrob_soften",
            "filing_sanity_ref_history_soften", "filing_sanity_page_match_v2", "ref_confusable_flag",
            "ref_confusable_confirmed_literal_disarm", "trust_role_disagreement_refuse", "role_disagree_refuse_at100",
            "glyph_fallback_enabled", "glyph_confusable_resolve", "note_topic_dedup", "auto_file_threshold",
            "test_build_armed_rev"]

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
print("max migration:", con.execute("SELECT MAX(version) FROM migrations").fetchone()[0])
print("confirmed docs total:", con.execute("SELECT COUNT(*) FROM documents WHERE status='confirmed'").fetchone()[0])
for k in SETTINGS:
    r = con.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone()
    print(f"  {k} = {r['value'] if r else '<unset>'}")
ids = []
print("\nstem -> confirmed doc(s):")
for st in STEMS:
    rows = con.execute(
        "SELECT id, status, original_filename, reference_number, supplier_name, learning_excluded_at "
        "FROM documents WHERE original_filename LIKE ? ORDER BY id", (st + "%",)).fetchall()
    if not rows:
        print(f"  {st}: NONE")
        continue
    for r in rows:
        print(f"  {st}: #{r['id']} {r['status']} ref={r['reference_number']!r} sup={r['supplier_name']!r} "
              f"excl={r['learning_excluded_at']}")
        if r["status"] == "confirmed":
            ids.append(r["id"])
print("\nRR_IDS=" + ",".join(str(i) for i in ids))
